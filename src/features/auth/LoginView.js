import {Events} from '../../infrastructure/events/events.js';
import {ConfirmDialog} from '../../shared/components/ConfirmDialog.js';
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
        this._busy = false;
        this._background = [];

        this._bindEvents();
        this._subscribeToBus();
        this.show();
    }

    show() {
        Toast.clear();
        ConfirmDialog.cancel();
        if (this._els.overlay?.hidden) {
            this._previousFocus = document.activeElement;
            this._background = [...document.querySelectorAll('.app-header, .primary-view')]
                .map(el => ({el, inert: el.inert}));
            this._background.forEach(({el}) => { el.inert = true; });
        }
        if (this._els.overlay) this._els.overlay.hidden = false;
        if (this._els.passwordInput) this._els.passwordInput.value = '';
        this._els.emailInput?.focus();
    }

    hide() {
        if (this._els.overlay) this._els.overlay.hidden = true;
        this._clearError();
        this._background.forEach(({el, inert}) => { el.inert = inert; });
        this._background = [];
        if (this._els.passwordInput) this._els.passwordInput.value = '';
        const previous = this._previousFocus;
        if (previous?.isConnected && previous !== document.body && !previous.disabled && !previous.closest?.('[hidden], [inert]')) previous.focus();
        else (document.querySelector?.('.primary-tabs [aria-selected="true"]') || document.getElementById('tabExercise'))?.focus();
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
        this._els.form?.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const focusable = [...this._els.form.querySelectorAll('input, button')].filter(el => !el.disabled);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        });
        this._els.form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (this._busy) return;
            const email = this._els.emailInput?.value.trim() || '';
            const password = this._els.passwordInput?.value || '';
            this._clearError();
            this._setBusy(true);
            try {
                const loggedIn = await this._auth.login({email, password});
                if (loggedIn) Toast.show({title: 'Logged in'});
            } catch (err) {
                this._showError(String(err.message || err));
                this._els.passwordInput?.focus();
            } finally {
                this._setBusy(false);
            }
        });
    }

    _setBusy(busy) {
        this._busy = busy;
        this._els.form?.setAttribute('aria-busy', String(busy));
        const button = this._els.form?.querySelector('button[type="submit"]');
        if (button) { button.disabled = busy; button.textContent = busy ? 'Signing in…' : 'Sign in'; }
    }

    _showError(msg) {
        if (!this._els.errorEl) return;
        this._els.errorEl.textContent = msg;
        this._els.errorEl.hidden = false;
    }

    _clearError() {
        if (!this._els.errorEl) return;
        this._els.errorEl.textContent = '';
        this._els.errorEl.hidden = true;
    }
}
