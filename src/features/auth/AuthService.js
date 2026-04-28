import {Events} from '../../infrastructure/events/events.js';

export class AuthService {
    /**
     * @param {{
     *   apiClient: import('../../infrastructure/http/ApiClient.js').ApiClient,
     *   userRepository: import('../../domain/user/UserRepository.js').UserRepository,
     *   storage: import('../../infrastructure/storage/StorageManager.js').StorageManager,
     *   bus: import('../../infrastructure/events/EventBus.js').EventBus
     * }} deps
     */
    constructor({apiClient, userRepository, storage, bus}) {
        this._api = apiClient;
        this._userRepo = userRepository;
        this._storage = storage;
        this._bus = bus;

        // Wire ApiClient callback to EventBus
        this._api.onSessionExpired = () => this._onSessionExpired();
    }

    /**
     * Called once at app startup.
     * Tries to restore session via refresh token (from memory or localStorage).
     */
    async tryRestoreSession() {
        // Если refresh-токена нет вообще — это первый заход / разлогинились.
        // Не показываем «Session expired», просто эмитим LOGOUT → LoginView.show().
        const hasRefresh = !!this._storage.getRefreshToken();
        if (!hasRefresh) {
            this._bus.emit(Events.AUTH_LOGOUT);
            return false;
        }
        // force:false — при бутстрапе мы сами решаем, как реагировать (показ login overlay),
        // не надо чтобы ApiClient ещё раз дёргал onSessionExpired (двойной emit).
        const ok = await this._api.silentRefresh({force: false});
        if (ok) {
            await this._emitLoginSuccess();
        } else {
            // Токен был, но рефреш упал — реальное "истечение сессии"
            this._bus.emit(Events.AUTH_SESSION_EXPIRED);
        }
        return ok;
    }

    /**
     * Login with email/password.
     * @param {{ email: string, password: string }} credentials
     */
    async login(credentials) {
        const data = await this._api.login(credentials);  // throws on failure
        this._api.setTokens(data.accessToken || '', data.refreshToken || '');
        await this._emitLoginSuccess(data);
    }

    /**
     * Logout — clear tokens, notify listeners.
     */
    async logout() {
        await this._api.serverLogout();
        this._storage.clearUserInfo();
        this._bus.emit(Events.AUTH_LOGOUT);
    }

    /** Internal: called by ApiClient when refresh fails. */
    _onSessionExpired() {
        this._api.clearAuthToken();
        this._storage.clearUserInfo();
        this._bus.emit(Events.AUTH_SESSION_EXPIRED);
    }

    /** Fetch current user and emit AUTH_LOGIN_SUCCESS. */
    async _emitLoginSuccess(loginData = null) {
        let user = null;
        try {
            user = await this._userRepo.fetchCurrentUser();
        } catch {
            // Non-fatal: user info not critical for session validity
        }
        this._bus.emit(Events.AUTH_LOGIN_SUCCESS, {
            tokens: {
                accessToken: this._api.authToken,
                refreshToken: this._storage.getRefreshToken()
            },
            user: user || loginData?.user || loginData || null,
            loginData  // raw response if available
        });
    }
}
