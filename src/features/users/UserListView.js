import {SortMenu} from '../../shared/components/SortMenu.js';

export class UserListView {
    /**
     * @param {{
     *   store: UserStore,
     *   els: { userList, userSearch, userSortToggle, userSortMenu, userSortLabel },
     *   onSelect: (user) => void,
     *   sortOptions: Record<string, { label: string }>
     * }} deps
     */
    constructor({store, els, onSelect, sortOptions}) {
        this._store = store;
        this._els = els;
        this._onSelect = onSelect;

        this._sortMenu = new SortMenu({
            toggleEl: els.userSortToggle,
            menuEl: els.userSortMenu,
            labelEl: els.userSortLabel,
            options: sortOptions,
            active: store.getState().sortKey,
            onChange: (key) => store.setSortKey(key)
        });

        els.userSearch?.addEventListener('input', (e) => store.setSearchQuery(e.target.value));

        store.subscribe(() => this.render());
    }

    render() {
        const {filtered, active, isLoading} = this._store.getState();
        if (!this._els.userList) return;
        if (isLoading) {
            this._els.userList.innerHTML = '<div class="list-loading">Loading…</div>';
            return;
        }

        this._els.userList.innerHTML = '';
        for (const user of filtered) {
            const el = document.createElement('div');
            el.dataset.id = user.id;
            el.className = 'item user-item' + (user.id === active?.id ? ' active' : '');
            el.setAttribute('role', 'option');
            el.tabIndex = 0;

            const badge = (user.email || user.id || '?')[0].toUpperCase();
            const roleClass = user.role === 'admin' ? 'pill pill-admin' : 'pill pill-subtle';
            const authTypes = (user.authTypes || []).join(', ') || '—';

            el.innerHTML = `
                <div class="user-badge" aria-hidden="true">${badge}</div>
                <div class="user-copy">
                    <div class="user-name">${user.email || user.id}</div>
                    <div class="user-email">${authTypes}</div>
                </div>
                <div class="user-tags">
                    <span class="${roleClass} user-role">${user.role}</span>
                </div>
            `;

            el.addEventListener('click', () => this._onSelect(user));
            this._els.userList.appendChild(el);
        }
    }
}
