import {Events} from '../../infrastructure/events/events.js';
import {Toast} from '../../shared/components/Toast.js';

export class LoginView {
    /**
     * @param {{
     *   authService: AuthService,
     *   bus: EventBus,
     *   els: { overlay, form, emailInput, passwordInput, errorEl }
     * }} deps
     */
    constructor({authService, bus, els}) {
        this._auth = authService;
        this._bus = bus;
        this._els = els;

        this._bindEvents();
        this._subscribeToBus();
    }

    show() {
        if (this._els.overlay) this._els.overlay.style.display = 'flex';
        this._els.emailInput?.focus();
    }

    hide() {
        if (this._els.overlay) this._els.overlay.style.display = 'none';
        this._clearError();
    }

    _subscribeToBus() {
        this._bus.on(Events.AUTH_LOGIN_SUCCESS, () => this.hide());
        this._bus.on(Events.AUTH_LOGOUT, () => this.show());
        this._bus.on(Events.AUTH_SESSION_EXPIRED, () => {
            this.show();
            Toast.show({
                title: 'Session expired',
                message: 'Please sign in again.',
                type: 'error',
                ms: 4000
            });
        });
    }

    _bindEvents() {
        this._els.form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = this._els.emailInput?.value.trim() || '';
            const password = this._els.passwordInput?.value || '';
            this._clearError();
            try {
                await this._auth.login({email, password});
                Toast.show({title: 'Logged in'});
            } catch (err) {
                this._showError(String(err.message || err));
                Toast.show({title: 'Login failed', message: String(err.message || err), type: 'error'});
            }
        });
    }

    _showError(msg) {
        if (!this._els.errorEl) return;
        this._els.errorEl.textContent = msg;
        this._els.errorEl.style.display = 'block';
    }

    _clearError() {
        if (!this._els.errorEl) return;
        this._els.errorEl.textContent = '';
        this._els.errorEl.style.display = 'none';
    }
}
