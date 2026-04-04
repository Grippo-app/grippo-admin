import {SortMenu} from '../../shared/components/SortMenu.js';

const AVATAR_COLORS = [
    {bg: 'rgba(91,156,245,.15)', color: '#5b9cf5'},
    {bg: 'rgba(48,164,108,.15)', color: '#3dd68c'},
    {bg: 'rgba(229,166,62,.15)', color: '#e5a63e'},
    {bg: 'rgba(207,77,206,.15)', color: '#cf4dce'},
    {bg: 'rgba(78,184,232,.15)', color: '#4eb8e8'},
    {bg: 'rgba(242,124,94,.15)', color: '#f27c5e'},
    {bg: 'rgba(229,72,77,.15)', color: '#e5484d'},
];

export class UserListView {
    /**
     * @param {{
     *   store: UserStore,
     *   els: { userList, userSearch, userSortToggle, userSortMenu, userSortLabel, userCount? },
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
        const {filtered, users, active, isLoading, searchQuery} = this._store.getState();
        if (!this._els.userList) return;

        // Update count badge
        if (this._els.userCount) {
            if (isLoading) {
                this._els.userCount.textContent = 'Loading…';
            } else if (searchQuery) {
                this._els.userCount.textContent = `${filtered.length} of ${users.length}`;
            } else {
                this._els.userCount.textContent = `${users.length}`;
            }
        }

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

            const key = user.email || user.id || '?';
            const badge = key[0].toUpperCase();
            const {bg, color} = this._avatarColor(key);
            const roleClass = user.role === 'admin' ? 'pill pill-admin' : 'pill pill-subtle';

            const authIconsHtml = this._renderAuthIcons(user.authTypes || []);

            const workoutsPart = user.workoutsCount > 0
                ? `<span class="user-workouts">${user.workoutsCount} workouts</span>`
                : '';
            const datePart = user.createdAt
                ? `<span class="user-item-date">${this._relativeDate(user.createdAt)}</span>`
                : '';
            const metaParts = [workoutsPart, datePart].filter(Boolean);
            const metaHtml = metaParts.length
                ? `<div class="user-meta">${metaParts.join('<span class="user-meta-sep">·</span>')}</div>`
                : '';

            const hasProfile = Boolean(user.name);
            const displayName = user.name || user.email || user.id;
            const emailLine = user.name && user.email
                ? `<div class="user-email">${user.email}</div>`
                : '';
            const noProfileChip = !hasProfile
                ? `<span class="pill pill-no-profile" aria-label="No profile">no profile</span>`
                : '';

            el.innerHTML = `
                <div class="user-badge" style="background:${bg};color:${color};border-color:${color}33" aria-hidden="true">${badge}</div>
                <div class="user-copy">
                    <div class="user-name">${displayName}</div>
                    ${emailLine}
                    ${metaHtml}
                </div>
                <div class="user-tags">
                    <div class="user-auth-icons">${authIconsHtml}</div>
                    ${noProfileChip}
                    <span class="${roleClass} user-role">${user.role}</span>
                </div>
            `;

            el.addEventListener('click', () => this._onSelect(user));
            this._els.userList.appendChild(el);
        }
    }

    // ── Helpers ───────────────────────────────────────────

    _avatarColor(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
        return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
    }

    _relativeDate(isoDate) {
        if (!isoDate) return '';
        const ts = new Date(isoDate).getTime();
        if (!ts) return '';
        const diff = Date.now() - ts;
        const days = Math.floor(diff / 86400000);
        if (days === 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 30) return `${days}d ago`;
        const months = Math.floor(days / 30);
        if (months < 12) return `${months}mo ago`;
        return `${Math.floor(months / 12)}yr ago`;
    }

    _renderAuthIcons(authTypes) {
        if (!authTypes.length) return '';
        return authTypes.map(type => {
            const {label, svg} = this._getAuthIcon(type);
            return `<span class="user-auth-icon" title="${label}" aria-label="${label}">${svg}</span>`;
        }).join('');
    }

    _getAuthIcon(authType) {
        const type = (authType || '').toLowerCase();

        if (type === 'google') {
            return {
                label: 'Google',
                svg: `<svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285f4" d="M23.49 12.27c0-.79-.07-1.54-.21-2.27H12v4.3h6.44c-.28 1.38-1.09 2.55-2.32 3.34v2.77h3.75c2.2-2.03 3.62-5.02 3.62-8.14z"/>
                    <path fill="#34a853" d="M12 24c3.15 0 5.8-1.04 7.73-2.86l-3.75-2.77c-1.04.7-2.37 1.11-3.98 1.11-3.06 0-5.64-2.06-6.57-4.84H1.56v3.03C3.47 21.43 7.43 24 12 24z"/>
                    <path fill="#fbbc04" d="M5.43 14.64c-.23-.7-.36-1.44-.36-2.21s.13-1.51.36-2.21V7.19H1.56A11.98 11.98 0 0 0 0 12.43c0 1.94.46 3.77 1.56 5.24l3.87-3.03z"/>
                    <path fill="#ea4335" d="M12 4.73c1.71 0 3.24.6 4.45 1.77l3.3-3.3C17.79 1.3 15.15 0 12 0 7.43 0 3.47 2.57 1.56 6.19l3.87 3.03C6.36 6.79 8.94 4.73 12 4.73z"/>
                </svg>`
            };
        }

        if (type === 'apple') {
            return {
                label: 'Apple',
                svg: `<svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M16.39 12.27c.03 2.75 2.41 3.66 2.44 3.68-.02.06-.38 1.33-1.27 2.63-.77 1.12-1.57 2.23-2.83 2.25-1.24.02-1.64-.73-3.06-.73-1.42 0-1.86.71-3.03.75-1.22.05-2.16-1.23-2.94-2.35-1.6-2.32-2.83-6.56-1.18-9.42.82-1.42 2.29-2.32 3.88-2.34 1.21-.02 2.35.82 3.06.82.71 0 2.05-1.01 3.46-.86.59.03 2.23.24 3.29 1.81-.09.06-1.96 1.14-1.94 3.76zm-2.28-6.65c.64-.78 1.07-1.88.95-2.98-.92.04-2.04.61-2.7 1.39-.59.68-1.1 1.78-.96 2.84 1.03.08 2.07-.52 2.71-1.25z"/>
                </svg>`
            };
        }

        const label = type === 'email' ? 'Email' : (authType || 'Unknown');
        return {
            label,
            svg: `<svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v.511l8 5.333 8-5.333V7H4zm16 10V9.489l-8 5.334-8-5.334V17h16z"/>
            </svg>`
        };
    }
}
