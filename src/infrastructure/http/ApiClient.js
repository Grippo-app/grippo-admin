import {ENDPOINTS} from './endpoints.js';
import {ACCESS_TOKEN_TTL_MS} from '../../shared/constants/index.js';

export class ApiClient {
    /**
     * @param {{ storage: StorageManager, getLocale: () => string, onSessionExpired: () => void }} opts
     */
    constructor({storage, getLocale, onSessionExpired}) {
        this.storage = storage;
        this.getLocale = getLocale;
        this.onSessionExpired = onSessionExpired;

        this._accessToken = '';
        this._refreshToken = '';
        this._refreshPromise = null;
        this._refreshTimer = null;
        this._sessionVersion = 0;
    }

    /* ── token helpers ─────────────────────────────────── */

    get authToken() {
        return this._accessToken;
    }

    setTokens(accessToken, refreshToken) {
        this._sessionVersion++;
        this._applyTokens(accessToken, refreshToken);
    }

    _applyTokens(accessToken, refreshToken) {
        this._accessToken = accessToken || '';
        if (refreshToken !== undefined) {
            this._refreshToken = refreshToken || '';
            this.storage?.setRefreshToken(this._refreshToken);
        }
        this._scheduleRefresh();
    }

    clearAuthToken() {
        this._sessionVersion++;
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
        // Таймерный рефреш не разлогинивает при сбое — попытаемся ещё раз через минуту.
        this._refreshTimer = setTimeout(() => this.silentRefresh({force: false}), delay);
    }

    _cancelRefresh() {
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
    }

    /**
     * @param {{force?: boolean}} opts force=true — при провале сразу разлогинить
     *                                  (используется при ответе 401 от защищённого запроса).
     */
    async silentRefresh({force = true} = {}) {
        const version = this._sessionVersion;
        if (!this._refreshToken) this._refreshToken = this.storage?.getRefreshToken() || '';
        if (!this._refreshToken) {
            if (force) this._expireSession(version);
            return false;
        }

        // A protected request can join a background refresh, but still requires
        // session expiry if that shared refresh fails.
        if (this._refreshPromise && this._refreshVersion === version) {
            const ok = await this._refreshPromise;
            if (!ok && force) this._expireSession(version);
            return ok;
        }
        const refreshToken = this._refreshToken;
        const promise = (async () => {
            try {
                const resp = await fetch(ENDPOINTS.refresh, {
                    method: 'POST',
                    headers: {'content-type': 'application/json', accept: 'application/json'},
                    body: JSON.stringify({refreshToken})
                });
                if (!resp.ok) throw new Error(`refresh ${resp.status}`);
                const data = await resp.json();
                if (typeof data.accessToken !== 'string' || !data.accessToken) {
                    throw new Error('Missing access token');
                }
                // Logout or another login invalidates all earlier refreshes.
                if (version !== this._sessionVersion) return false;
                this._applyTokens(data.accessToken, data.refreshToken);
                return true;
            } catch {
                if (!force && version === this._sessionVersion) {
                    this._cancelRefresh();
                    this._refreshTimer = setTimeout(() => this.silentRefresh({force: false}), 60_000);
                }
                return false;
            }
        })();
        this._refreshVersion = version;
        this._refreshPromise = promise;
        const ok = await promise;
        if (this._refreshPromise === promise) this._refreshPromise = null;
        if (!ok && force) this._expireSession(version);
        return ok;
    }

    _expireSession(version) {
        if (version !== this._sessionVersion) return;
        this.clearAuthToken();
        this.onSessionExpired?.();
    }

    /* ── request helpers ───────────────────────────────── */

    bearer() {
        return this._accessToken ? {Authorization: `Bearer ${this._accessToken}`} : {};
    }

    buildHeaders({json = false, auth = true, accept = true, locale} = {}) {
        const headers = {};
        if (accept) headers.accept = 'application/json';
        headers['accept-language'] = locale || this.getLocale?.() || 'en';
        if (json) headers['content-type'] = 'application/json';
        if (auth) Object.assign(headers, this.bearer());
        return headers;
    }

    async _fetch(url, options = {}) {
        const version = this._sessionVersion;
        const requestHeaders = new Headers(options.headers);
        const sentAuthorization = requestHeaders.get('authorization');
        const isProtected = Boolean(sentAuthorization);
        let resp = await fetch(url, options);
        if (resp.status === 401 && isProtected && this._accessToken && version === this._sessionVersion) {
            // A late 401 may refer to a token that another request already renewed.
            const tokenAlreadyRotated = sentAuthorization !== `Bearer ${this._accessToken}`;
            const refreshed = tokenAlreadyRotated || await this.silentRefresh();
            if (refreshed && version === this._sessionVersion) {
                const updatedHeaders = new Headers(options.headers);
                updatedHeaders.set('Authorization', `Bearer ${this._accessToken}`);
                const retryAuthorization = updatedHeaders.get('authorization');
                resp = await fetch(url, {...options, headers: updatedHeaders});
                // A newer refresh can finish while this retry is still in flight.
                if (resp.status === 401 && retryAuthorization === `Bearer ${this._accessToken}`) this._expireSession(version);
            }
        }
        return resp;
    }

    /* ── auth endpoints (stay in ApiClient — needed at bootstrap) ── */

    async login(credentials) {
        let resp;
        try {
            resp = await fetch(ENDPOINTS.login, {
                method: 'POST',
                headers: this.buildHeaders({json: true, auth: false}),
                body: JSON.stringify(credentials)
            });
        } catch {
            throw new Error('Unable to connect to the sign-in service. Check your connection and try again.');
        }
        if (!resp.ok) {
            const messages = {
                400: 'Check the email and password fields and try again.',
                401: 'Invalid email or password.',
                403: 'Sign-in access was denied.',
                408: 'The sign-in request timed out. Try again.',
                429: 'Too many sign-in attempts. Try again later.',
            };
            const message = messages[resp.status] || (resp.status >= 500
                ? 'The sign-in service is temporarily unavailable. Try again later.'
                : 'Sign-in failed. Please try again.');
            throw new Error(`${message} (HTTP ${resp.status})`);
        }
        try {
            return await resp.json();
        } catch {
            throw new Error('The sign-in service returned an unreadable response. Please try again.');
        }
    }

    async serverLogout() {
        this.clearAuthToken();
    }
}
