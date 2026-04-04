import { ENDPOINTS } from './endpoints.js';
import { ACCESS_TOKEN_TTL_MS } from '../../shared/constants/index.js';

export class ApiClient {
  /**
   * @param {{ storage: StorageManager, getLocale: () => string, onSessionExpired: () => void }} opts
   */
  constructor({ storage, getLocale, onSessionExpired }) {
    this.storage = storage;
    this.getLocale = getLocale;
    this.onSessionExpired = onSessionExpired;

    this._accessToken = '';
    this._refreshToken = '';
    this._refreshPromise = null;
    this._refreshTimer = null;
  }

  /* ── token helpers ─────────────────────────────────── */

  get authToken() { return this._accessToken; }

  setTokens(accessToken, refreshToken) {
    this._accessToken = accessToken || '';
    if (refreshToken !== undefined) {
      this._refreshToken = refreshToken || '';
      this.storage?.setRefreshToken(this._refreshToken);
    }
    this._scheduleRefresh();
  }

  clearAuthToken() {
    this._accessToken = '';
    this._refreshToken = '';
    this.storage?.clearRefreshToken();
    this._cancelRefresh();
  }

  /* ── silent refresh ────────────────────────────────── */

  _scheduleRefresh() {
    this._cancelRefresh();
    if (!this._accessToken) return;
    const delay = Math.max(ACCESS_TOKEN_TTL_MS - 60_000, 5_000);
    this._refreshTimer = setTimeout(() => this.silentRefresh(), delay);
  }

  _cancelRefresh() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  async silentRefresh() {
    if (!this._refreshToken) {
      const stored = this.storage?.getRefreshToken() || '';
      if (!stored) return false;
      this._refreshToken = stored;
    }
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = (async () => {
      try {
        const resp = await fetch(ENDPOINTS.refresh, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
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

  /* ── request helpers ───────────────────────────────── */

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

  async _fetch(url, options = {}) {
    let resp = await fetch(url, options);
    if (resp.status === 401 && this._accessToken) {
      const refreshed = await this.silentRefresh();
      if (refreshed) {
        const updatedHeaders = { ...options.headers, ...this.bearer() };
        resp = await fetch(url, { ...options, headers: updatedHeaders });
      }
    }
    return resp;
  }

  /* ── auth endpoints (stay in ApiClient — needed at bootstrap) ── */

  async login(credentials) {
    const resp = await fetch(ENDPOINTS.login, {
      method: 'POST',
      headers: this.buildHeaders({ json: true, auth: false }),
      body: JSON.stringify(credentials)
    });
    if (!resp.ok) throw new Error('Invalid credentials');
    return resp.json();
  }

  async serverLogout() {
    this.clearAuthToken();
  }
}
