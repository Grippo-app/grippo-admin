import { DEFAULT_LANGUAGE, ENDPOINTS, ACCESS_TOKEN_TTL_MS } from './constants.js';

/**
 * ApiClient — manages authenticated requests to the Grippo API.
 *
 * Security model:
 *   • Access token is kept ONLY in memory (`this._accessToken`).
 *     It is short-lived (≈10 min) and never written to Web Storage.
 *   • Refresh token lives in an HttpOnly, Secure, SameSite=Strict cookie
 *     set by the backend. The browser sends it automatically when
 *     `credentials: 'include'` is used.
 *   • On 401 the client tries a single silent refresh via POST /auth/refresh
 *     (cookie-based). If that also fails the user is logged out.
 */
export class ApiClient {
  constructor({ storage, getLocale, onSessionExpired }) {
    this.storage = storage;
    this.getLocale = getLocale;
    /** Called when both access + refresh tokens are invalid. */
    this.onSessionExpired = onSessionExpired;

    /** In-memory only — never persisted to disk / Web Storage. */
    this._accessToken = '';

    /** Prevents multiple concurrent refresh calls. */
    this._refreshPromise = null;

    /** Timer id for proactive silent refresh. */
    this._refreshTimer = null;
  }

  /* ────────────────────────── token helpers ────────────────────────── */

  get authToken() {
    return this._accessToken;
  }

  /**
   * Store a new access token in memory and schedule a proactive refresh.
   */
  setAuthToken(token) {
    this._accessToken = token || '';
    this._scheduleRefresh();
  }

  clearAuthToken() {
    this._accessToken = '';
    this._cancelRefresh();
  }

  /* ────────────────────────── silent refresh ────────────────────────── */

  /**
   * Schedule a background refresh slightly before the access token expires
   * so the user never sees a 401 during normal usage.
   */
  _scheduleRefresh() {
    this._cancelRefresh();
    if (!this._accessToken) return;

    // Refresh 60 s before expiry (minimum 5 s).
    const delay = Math.max(ACCESS_TOKEN_TTL_MS - 60_000, 5_000);
    this._refreshTimer = setTimeout(() => this.silentRefresh(), delay);
  }

  _cancelRefresh() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  /**
   * Ask the backend for a new access token using the HttpOnly refresh cookie.
   * Returns `true` on success, `false` on failure.
   */
  async silentRefresh() {
    // Deduplicate concurrent calls.
    if (this._refreshPromise) return this._refreshPromise;

    this._refreshPromise = (async () => {
      try {
        const resp = await fetch(ENDPOINTS.refresh, {
          method: 'POST',
          credentials: 'include',                 // sends HttpOnly cookie
          headers: { accept: 'application/json' }
        });
        if (!resp.ok) throw new Error(`refresh ${resp.status}`);

        const data = await resp.json();
        this.setAuthToken(data.accessToken || '');
        return true;
      } catch {
        this.clearAuthToken();
        this.onSessionExpired?.();
        return false;
      } finally {
        this._refreshPromise = null;
      }
    })();

    return this._refreshPromise;
  }

  /* ────────────────────────── request helpers ────────────────────────── */

  bearer() {
    return this._accessToken ? { Authorization: `Bearer ${this._accessToken}` } : {};
  }

  buildHeaders({ json = false, auth = true, accept = true, locale } = {}) {
    const headers = {};
    if (accept) headers.accept = 'application/json';
    headers['accept-language'] = locale || this.getLocale?.() || 'en';
    if (json) headers['content-type'] = 'application/json';
    if (auth) Object.assign(headers, this.bearer());
    return headers;
  }

  /**
   * Wrapper around fetch that adds `credentials: 'include'` (so the
   * HttpOnly refresh cookie travels with every request) and automatically
   * retries once on 401 after a silent refresh.
   */
  async _fetch(url, options = {}) {
    const opts = { ...options, credentials: 'include' };
    let resp = await fetch(url, opts);

    if (resp.status === 401 && this._accessToken) {
      const refreshed = await this.silentRefresh();
      if (refreshed) {
        // Rebuild Authorization header with new token.
        const updatedHeaders = { ...opts.headers, ...this.bearer() };
        resp = await fetch(url, { ...opts, headers: updatedHeaders });
      }
    }
    return resp;
  }

  /* ────────────────────────── public API ────────────────────────── */

  async fetchList() {
    const resp = await this._fetch(ENDPOINTS.list, {
      headers: this.buildHeaders({ locale: DEFAULT_LANGUAGE })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async fetchDetail(id, locale) {
    const resp = await this._fetch(ENDPOINTS.detail(id), {
      headers: this.buildHeaders({ locale })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async createExercise(payload) {
    const resp = await this._fetch(ENDPOINTS.create, {
      method: 'POST',
      headers: this.buildHeaders({ json: true }),
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.json();
  }

  async updateExercise(id, payload) {
    const resp = await this._fetch(ENDPOINTS.update(id), {
      method: 'PUT',
      headers: this.buildHeaders({ json: true }),
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.json().catch(() => null);
  }

  async deleteExercise(id) {
    const resp = await this._fetch(ENDPOINTS.remove(id), {
      method: 'DELETE',
      headers: this.buildHeaders({ json: false })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.text().catch(() => null);
  }

  async fetchEquipments() {
    const resp = await this._fetch(ENDPOINTS.equipmentGroups, {
      headers: this.buildHeaders({ auth: false })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async fetchMuscles() {
    const resp = await this._fetch(ENDPOINTS.muscleGroups, {
      headers: this.buildHeaders({ auth: false })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async fetchCurrentUser() {
    const resp = await this._fetch(ENDPOINTS.currentUser, {
      headers: this.buildHeaders()
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  /**
   * Log in with email + password.
   * Backend is expected to:
   *   1. Return { accessToken, user? } in the JSON body.
   *   2. Set the refresh token as a HttpOnly, Secure, SameSite cookie.
   */
  async login(credentials) {
    const resp = await fetch(ENDPOINTS.login, {
      method: 'POST',
      credentials: 'include',                     // receive Set-Cookie
      headers: this.buildHeaders({ json: true, auth: false }),
      body: JSON.stringify(credentials)
    });
    if (!resp.ok) throw new Error('Invalid credentials');
    return resp.json();
  }

  /**
   * Invalidate refresh cookie on the server side.
   */
  async serverLogout() {
    try {
      await fetch(ENDPOINTS.logout, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json' }
      });
    } catch {
      /* best-effort — token will expire anyway */
    }
    this.clearAuthToken();
  }

  async fetchUsers() {
    const resp = await this._fetch(ENDPOINTS.users, {
      headers: this.buildHeaders({ json: false })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async makeAdmin(email) {
    const resp = await this._fetch(ENDPOINTS.makeAdmin, {
      method: 'POST',
      headers: this.buildHeaders({ json: true }),
      body: JSON.stringify({ email })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.json();
  }

  async setUserRole(id, role) {
    const resp = await this._fetch(ENDPOINTS.userRole(id), {
      method: 'PUT',
      headers: this.buildHeaders({ json: true }),
      body: JSON.stringify({ role })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.json();
  }

  async deleteUser(id) {
    const resp = await this._fetch(ENDPOINTS.userDelete(id), {
      method: 'DELETE',
      headers: this.buildHeaders({ json: false })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.text().catch(() => null);
  }
}
