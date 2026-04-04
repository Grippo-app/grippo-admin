import { DEFAULT_LANGUAGE, ENDPOINTS, ACCESS_TOKEN_TTL_MS } from './constants.js';

/**
 * ApiClient — manages authenticated requests to the Grippo API.
 *
 * Security model:
 *   • Access token is kept ONLY in memory (`this._accessToken`).
 *     It is short-lived (≈10 min) and never written to Web Storage.
 *   • Refresh token is kept in memory (`this._refreshToken`).
 *     It is sent in the request body to POST /auth/refresh.
 *   • On 401 the client tries a single silent refresh via POST /auth/refresh.
 *     If that also fails the user is logged out.
 */
export class ApiClient {
  constructor({ storage, getLocale, onSessionExpired }) {
    this.storage = storage;
    this.getLocale = getLocale;
    /** Called when both access + refresh tokens are invalid. */
    this.onSessionExpired = onSessionExpired;

    /** In-memory only — never persisted to disk / Web Storage. */
    this._accessToken = '';

    /** In-memory only — sent in body for refresh requests. */
    this._refreshToken = '';

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
   * Store new tokens in memory, persist the refresh token to storage so it
   * survives page reloads, and schedule a proactive refresh.
   */
  setTokens(accessToken, refreshToken) {
    this._accessToken = accessToken || '';
    if (refreshToken !== undefined) {
      this._refreshToken = refreshToken || '';
      this.storage?.setRefreshToken(this._refreshToken);
    }
    this._scheduleRefresh();
  }

  /**
   * @deprecated Use setTokens() instead.
   */
  setAuthToken(token) {
    this._accessToken = token || '';
    this._scheduleRefresh();
  }

  clearAuthToken() {
    this._accessToken = '';
    this._refreshToken = '';
    this.storage?.clearRefreshToken();
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
   * Ask the backend for a new access token by sending the refresh token
   * in the request body. Returns `true` on success, `false` on failure.
   *
   * On page reload `_refreshToken` is empty; we first try to hydrate it from
   * localStorage so the session can be restored without re-login.
   */
  async silentRefresh() {
    if (!this._refreshToken) {
      // Fragile area: storage may throw or return stale data — hydrate defensively.
      const stored = this.storage?.getRefreshToken() || '';
      if (!stored) return false;
      this._refreshToken = stored;
    }

    // Deduplicate concurrent calls.
    if (this._refreshPromise) return this._refreshPromise;

    this._refreshPromise = (async () => {
      try {
        const resp = await fetch(ENDPOINTS.refresh, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json'
          },
          body: JSON.stringify({ refreshToken: this._refreshToken })
        });
        if (!resp.ok) throw new Error(`refresh ${resp.status}`);

        const data = await resp.json();
        this.setTokens(data.accessToken, data.refreshToken);
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
   * Wrapper around fetch that automatically retries once on 401
   * after a silent refresh.
   */
  async _fetch(url, options = {}) {
    let resp = await fetch(url, options);

    if (resp.status === 401 && this._accessToken) {
      const refreshed = await this.silentRefresh();
      if (refreshed) {
        // Rebuild Authorization header with new token.
        const updatedHeaders = { ...options.headers, ...this.bearer() };
        resp = await fetch(url, { ...options, headers: updatedHeaders });
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
   * Backend returns { id, accessToken, refreshToken }.
   */
  async login(credentials) {
    const resp = await fetch(ENDPOINTS.login, {
      method: 'POST',
      headers: this.buildHeaders({ json: true, auth: false }),
      body: JSON.stringify(credentials)
    });
    if (!resp.ok) throw new Error('Invalid credentials');
    return resp.json();
  }

  /**
   * Clear tokens locally. Backend has no dedicated logout endpoint —
   * tokens will simply expire.
   */
  async serverLogout() {
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
