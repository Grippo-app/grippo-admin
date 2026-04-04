import {UserEntity} from '../../domain/user/index.js';
import {formatIso} from '../../shared/utils/index.js';
import {getAuthIcon} from '../../shared/utils/authIcons.js';

export class UserDetailView {
    /**
     * @param {{
     *   store: UserStore,
     *   els: {
     *     userNameEl, userIdEl, userEmailEl, userCreatedEl, userActivityEl, userWorkoutsEl,
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

        // User name, ID, email, dates, workout count
        this._setText(this._els.userNameEl, active.name || active.email || active.id);
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
                const {label, svg} = getAuthIcon(authType);
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
        const labels = types.map((authType) => getAuthIcon(authType).label);
        el.textContent = labels.join(' · ');
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
        if (this._els.userNameEl) this._setText(this._els.userNameEl, '');
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
