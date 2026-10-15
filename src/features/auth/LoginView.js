import {Events} from '../../infrastructure/events/events.js';
import {ConfirmDialog} from '../../shared/components/ConfirmDialog.js';
import {Toast} from '../../shared/components/Toast.js';

export class LoginView {
    /**
     * @param {{
     *   authService: AuthService,
     *   bus: EventBus,
     *   els: { overlay, restoreEl, form, emailInput, passwordInput, errorEl }
     * }} deps
     */
    constructor({authService, bus, els}) {
        this._auth = authService;
        this._bus = bus;
        this._els = els;
        this._busy = false;
        this._restoring = false;
        this._uiVersion = 0;
        this._background = [];
        this._formLabelId = els.overlay?.getAttribute?.('aria-labelledby') || 'loginTitle';

        this._bindEvents();
        this._subscribeToBus();
        this.show({restoring: true});
    }

    show({restoring = false} = {}) {
        ++this._uiVersion;
        this._restoring = restoring;
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
        if (restoring) this._clearError();
        this._syncControls();
        if (restoring) this._focusRestore();
        else this._els.emailInput?.focus();
        return this._uiVersion;
    }

    /** A completion handle can only release the restore state that created it. */
    setRestoring(restoring, handle) {
        if (restoring) {
            if (this._busy || this._els.overlay?.hidden) return null;
            return this._restoring ? this._uiVersion : this.show({restoring: true});
        }
        if (!this._restoring || this._busy || handle !== this._uiVersion || this._els.overlay?.hidden) return false;
        this.show();
        return true;
    }

    hide() {
        ++this._uiVersion;
        this._restoring = false;
        if (this._els.overlay) this._els.overlay.hidden = true;
        this._syncControls();
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
        this._els.overlay?.addEventListener('keydown', e => {
            if (!this._restoring || e.key !== 'Tab') return;
            e.preventDefault();
            this._focusRestore();
        });
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
            if (this._busy || this._restoring) return;
            const version = ++this._uiVersion;
            const email = this._els.emailInput?.value.trim() || '';
            const password = this._els.passwordInput?.value || '';
            this._clearError();
            this._setBusy(true);
            try {
                const loggedIn = await this._auth.login({email, password});
                if (loggedIn) Toast.show({title: 'Logged in'});
            } catch (err) {
                if (version === this._uiVersion && !this._els.overlay?.hidden && !this._restoring) {
                    this._showError(String(err.message || err));
                    this._els.passwordInput?.focus();
                }
            } finally {
                this._setBusy(false);
            }
        });
    }

    _setBusy(busy) {
        this._busy = busy;
        this._syncControls();
    }

    _syncControls() {
        const {overlay, restoreEl, form, emailInput, passwordInput} = this._els;
        if (form) {
            form.hidden = this._restoring;
            form.inert = this._restoring;
            form.setAttribute('aria-busy', String(this._busy || this._restoring));
        }
        if (restoreEl) restoreEl.hidden = !this._restoring;
        if (emailInput) emailInput.disabled = this._restoring;
        if (passwordInput) passwordInput.disabled = this._restoring;
        overlay?.setAttribute('aria-labelledby', this._restoring && restoreEl?.id ? restoreEl.id : this._formLabelId);
        const button = this._els.form?.querySelector('button[type="submit"]');
        if (button) {
            button.disabled = this._busy || this._restoring;
            button.textContent = this._busy ? 'Signing in…' : 'Sign in';
        }
    }

    _focusRestore() {
        const target = this._els.restoreEl || this._els.overlay;
        if (!this._els.restoreEl) target?.setAttribute('tabindex', '-1');
        target?.focus();
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
