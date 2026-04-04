import {SortMenu} from '../../shared/components/SortMenu.js';
import {getAuthIcon} from '../../shared/utils/authIcons.js';

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
            menuEl:   els.userSortMenu,
            labelEl:  els.userSortLabel,
            options:  sortOptions,
            active:   store.getState().sortKey,
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
                    <div class="user-name-row">
                        <span class="user-name">${displayName}</span>
                        ${noProfileChip}
                    </div>
                    ${emailLine}
                    ${metaHtml}
                </div>
                <div class="user-tags">
                    <div class="user-auth-icons">${authIconsHtml}</div>
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
            const {label, svg} = getAuthIcon(type);
            return `<span class="user-auth-icon" title="${label}" aria-label="${label}">${svg}</span>`;
        }).join('');
    }
}
