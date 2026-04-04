import {UserEntity} from '../../domain/user/index.js';
import {formatIso} from '../../shared/utils/index.js';

export class UserDetailView {
    /**
     * @param {{
     *   store: UserStore,
     *   els: {
     *     userIdEl, userEmailEl, userCreatedEl, userActivityEl, userWorkoutsEl,
     *     userAuthPill, userAuthList,
     *     roleSegments, deleteUserBtn
     *   },
     *   onRoleChange: (role: string) => void,
     *   onDelete: () => void
     * }} deps
     */
    constructor({store, els, onRoleChange, onDelete}) {
        this._store = store;
        this._els = els;

        this._bindRoleSegment(onRoleChange);
        this._els.deleteUserBtn?.addEventListener('click', onDelete);

        store.subscribe(() => this.render());
    }

    render() {
        const {active, roleChangeInFlight} = this._store.getState();
        if (!active) {
            this._showEmpty();
            return;
        }

        // User ID, email, dates, workout count
        this._setText(this._els.userIdEl, active.id);
        this._setText(this._els.userEmailEl, active.email);
        this._setText(this._els.userCreatedEl, formatIso(UserEntity.createdAt(active)));
        this._setText(this._els.userActivityEl, formatIso(UserEntity.lastActivityAt(active)));
        this._setText(this._els.userWorkoutsEl, String(UserEntity.workoutsCount(active)));

        // Auth type indicators
        this._renderAuthIndicator(this._els.userAuthPill, active.authTypes);
        this._renderAuthTypeList(this._els.userAuthList, active.authTypes);

        // Role segment
        this._updateRoleSegment(active.role);

        // Actions state
        if (this._els.deleteUserBtn) {
            this._els.deleteUserBtn.disabled = roleChangeInFlight;
        }
    }

    // ── Auth indicator ────────────────────────────────────
    // Перенесено из app.js renderAuthIndicator() строки 806–833

    _renderAuthIndicator(el, authTypes = []) {
        if (!el) return;
        const types = UserEntity.getAuthTypes({authTypes});
        if (!types.length) {
            el.innerHTML = '<span class="auth-type-empty">—</span>';
            el.setAttribute('aria-label', 'No auth types');
            return;
        }
        el.innerHTML = types
            .map((authType) => {
                const {label, svg} = this._getAuthIcon(authType);
                return `<span class="auth-type-icon" title="${label}" aria-label="${label}">${svg}</span>`;
            })
            .join('');
        el.setAttribute('aria-label', `Auth types: ${types.join(', ')}`);
    }

    _renderAuthTypeList(el, authTypes = []) {
        if (!el) return;
        const types = UserEntity.getAuthTypes({authTypes});
        if (!types.length) {
            el.textContent = '—';
            return;
        }
        const labels = types.map((authType) => this._getAuthIcon(authType).label);
        el.textContent = labels.join(' · ');
    }

    _getAuthIcon(authType) {
        const type = (authType || '').toLowerCase();

        if (type === 'google') {
            return {
                label: 'Google',
                svg: '<svg aria-hidden="true" viewBox="0 0 24 24" class="auth-icon auth-icon-google"><path class="g-blue" d="M23.49 12.27c0-.79-.07-1.54-.21-2.27H12v4.3h6.44c-.28 1.38-1.09 2.55-2.32 3.34v2.77h3.75c2.2-2.03 3.62-5.02 3.62-8.14z"></path><path class="g-green" d="M12 24c3.15 0 5.8-1.04 7.73-2.86l-3.75-2.77c-1.04.7-2.37 1.11-3.98 1.11-3.06 0-5.64-2.06-6.57-4.84H1.56v3.03C3.47 21.43 7.43 24 12 24z"></path><path class="g-yellow" d="M5.43 14.64c-.23-.7-.36-1.44-.36-2.21s.13-1.51.36-2.21V7.19H1.56A11.98 11.98 0 0 0 0 12.43c0 1.94.46 3.77 1.56 5.24l3.87-3.03z"></path><path class="g-red" d="M12 4.73c1.71 0 3.24.6 4.45 1.77l3.3-3.3C17.79 1.3 15.15 0 12 0 7.43 0 3.47 2.57 1.56 6.19l3.87 3.03C6.36 6.79 8.94 4.73 12 4.73z"></path></svg>'
            };
        }

        if (type === 'apple') {
            return {
                label: 'Apple',
                svg: '<svg aria-hidden="true" viewBox="0 0 24 24" class="auth-icon auth-icon-apple"><path d="M16.39 12.27c.03 2.75 2.41 3.66 2.44 3.68-.02.06-.38 1.33-1.27 2.63-.77 1.12-1.57 2.23-2.83 2.25-1.24.02-1.64-.73-3.06-.73-1.42 0-1.86.71-3.03.75-1.22.05-2.16-1.23-2.94-2.35-1.6-2.32-2.83-6.56-1.18-9.42.82-1.42 2.29-2.32 3.88-2.34 1.21-.02 2.35.82 3.06.82.71 0 2.05-1.01 3.46-.86.59.03 2.23.24 3.29 1.81-.09.06-1.96 1.14-1.94 3.76zm-2.28-6.65c.64-.78 1.07-1.88.95-2.98-.92.04-2.04.61-2.7 1.39-.59.68-1.1 1.78-.96 2.84 1.03.08 2.07-.52 2.71-1.25z"></path></svg>'
            };
        }

        const label = type === 'email' ? 'Email' : authType || 'Unknown';
        return {
            label,
            svg: '<svg aria-hidden="true" viewBox="0 0 24 24" class="auth-icon auth-icon-email"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v.511l8 5.333 8-5.333V7H4zm16 10V9.489l-8 5.334-8-5.334V17h16z"></path></svg>'
        };
    }

    // ── Role segment ─────────────────────────────────────

    _bindRoleSegment(onRoleChange) {
        this._els.roleSegments?.forEach(btn => {
            btn.addEventListener('click', () => {
                if (!btn.dataset.role) return;
                onRoleChange(btn.dataset.role);
            });
        });
    }

    _updateRoleSegment(activeRole) {
        this._els.roleSegments?.forEach(btn => {
            btn.classList.toggle('segment--active', btn.dataset.role === activeRole);
        });
    }

    // ── Helpers ──────────────────────────────────────────

    _showEmpty() {
        // Hide detail or show placeholder
        if (this._els.userIdEl) this._setText(this._els.userIdEl, '');
        if (this._els.userEmailEl) this._setText(this._els.userEmailEl, '');
        if (this._els.userCreatedEl) this._setText(this._els.userCreatedEl, '');
        if (this._els.userActivityEl) this._setText(this._els.userActivityEl, '');
        if (this._els.userWorkoutsEl) this._setText(this._els.userWorkoutsEl, '');
        if (this._els.userAuthPill) this._els.userAuthPill.innerHTML = '';
        if (this._els.userAuthList) this._setText(this._els.userAuthList, '');
    }

    _setText(el, text) {
        if (el) el.textContent = text ?? '';
    }
}
