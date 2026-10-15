import {readUserWorkoutCount} from '../../domain/user/userEvidence.js';
import {diagnosticBadgeHtml, diagnosticReasonHtml} from '../../shared/components/diagnosticPresentation.js';
import {SortMenu} from '../../shared/components/SortMenu.js';
import {escapeHtml} from '../../shared/utils/index.js';
import {formatNumber} from './userFormatters.js';

export class UserListView {
    constructor({store, els, onSelect, sortOptions}) {
        this._store = store;
        this._els = els;
        this._onSelect = onSelect;
        this._lastRender = null;
        this._sortMenu = new SortMenu({
            toggleEl: els.userSortToggle,
            menuEl: els.userSortMenu,
            labelEl: els.userSortLabel,
            options: sortOptions,
            active: store.getState().sortKey,
            onChange: key => store.setSortKey(key),
        });
        els.userSearch?.addEventListener('input', event => store.setSearchQuery(event.target.value));
        els.qualityFilter?.addEventListener('change', event => store.setDiagnosticFilter(event.target.value));
        els.filters?.addEventListener('change', event => {
            const key = event.target.dataset.userFilter;
            if (key) store.setUserFilter(key, event.target.value);
        });
        els.clearFiltersBtn?.addEventListener('click', () => store.clearUserFilters());
        els.userList?.addEventListener('click', event => this._selectRow(event.target.closest('.user-item')));
        els.userList?.addEventListener('keydown', event => this._onKeyDown(event));
        this._unsubscribe = store.subscribe(() => this.render());
        this.render();
    }

    destroy() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    render() {
        const state = this._store.getState();
        const {filtered, users, active, isLoading, searchQuery, loadError} = state;
        const list = this._els.userList;
        if (!list) return;
        list.setAttribute('aria-busy', String(isLoading));
        this._renderDiagnosticControls(state);
        this._renderUserFilters(state);
        if (this._renderedSort !== state.sortKey) { this._sortMenu.setActive(state.sortKey); this._renderedSort = state.sortKey; }
        if (this._els.userSearch && this._els.userSearch.value !== searchQuery) this._els.userSearch.value = searchQuery;
        if (this._els.reloadUsersBtn) {
            this._els.reloadUsersBtn.disabled = isLoading;
            this._setText(this._els.reloadUsersBtn, isLoading ? 'Loading…' : 'Refresh users');
        }
        if (this._els.userCount) {
            this._setText(this._els.userCount, isLoading && !users.length ? 'Loading users…'
                : searchQuery.trim() || state.diagnosticFilter !== 'all' || Object.values(state.userFilters || {}).some(value => value !== 'all') ? `${filtered.length} of ${users.length} users`
                    : `${users.length} user${users.length === 1 ? '' : 's'}`);
        }

        const previous = this._lastRender;
        if (previous?.filtered === filtered && previous.diagnostics === state.diagnostics && previous.loadError === loadError &&
            (users.length > 0 || previous.isLoading === isLoading)) {
            if (previous.activeId !== active?.id) this._updateSelection(active?.id);
            this._lastRender = {filtered, diagnostics: state.diagnostics, loadError, isLoading, activeId: active?.id};
            return;
        }
        this._lastRender = {filtered, diagnostics: state.diagnostics, loadError, isLoading, activeId: active?.id};
        const focusedId = list.contains(document.activeElement) ? document.activeElement.closest('.user-item')?.dataset.id : null;
        const scrollTop = list.scrollTop;

        if (isLoading && !users.length) {
            this._rows = new Map();
            list.innerHTML = `<div class="user-list-skeleton" role="status"><span class="sr-only">Loading users…</span><div class="skeleton-list" aria-hidden="true">${Array.from({length: 6}, () => '<div class="skeleton-row user-list-skeleton-row"><span class="skeleton skeleton-avatar"></span><div class="skeleton-stack"><span class="skeleton skeleton-line skeleton-line--medium"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line skeleton-line--short"></span></div></div>').join('')}</div></div>`;
            return;
        }
        const error = loadError ? `<div class="user-list-error" role="status"><strong>Could not refresh users</strong><span>${escapeHtml(loadError)}</span><span>Use Refresh users to try again.</span></div>` : '';
        if (!filtered.length) {
            this._rows = new Map();
            list.innerHTML = error + `<div class="user-list-message"><span class="user-list-message-icon" aria-hidden="true">⌕</span><span class="user-list-message-title">${users.length ? 'No matching users' : 'No users to display'}</span><span>${users.length ? 'Try another name, email or ID, or clear your filters.' : loadError ? 'The user list could not be loaded.' : 'Accounts will appear here when users join.'}</span></div>`;
            return;
        }

        if (this._rows?.size && !loadError && !previous?.loadError) this._reconcileRows(filtered, active?.id, state.diagnostics);
        else {
            list.innerHTML = error + filtered.map(user => this._userItem(user, user.id === active?.id, state.diagnostics.get(user.id))).join('');
            const elements = new Map(Array.from(list.querySelectorAll('.user-item')).map(row => [row.dataset.id, row]));
            this._rows = new Map(filtered.filter(user => elements.has(user.id)).map(user => [user.id,
                {element: elements.get(user.id), user, report: state.diagnostics.get(user.id)}]));
        }
        this._updateSelection(active?.id, focusedId);
        list.scrollTop = scrollTop;
        if (focusedId) {
            const row = Array.from(list.querySelectorAll('.user-item')).find(item => item.dataset.id === focusedId);
            row?.focus({preventScroll: true});
        }
    }

    _renderDiagnosticControls(state) {
        const select = this._els.qualityFilter;
        if (select && this._lastDiagnosticOptions !== state.diagnosticFilterOptions) {
            select.innerHTML = state.diagnosticFilterOptions.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
            this._lastDiagnosticOptions = state.diagnosticFilterOptions;
        }
        if (select) select.value = state.diagnosticFilter;
        if (this._els.qualitySummary) {
            const summary = state.diagnosticSummary;
            this._setText(this._els.qualitySummary, !summary.recordCount ? 'Checks run when users load.'
                : `${summary.attentionCount} of ${summary.recordCount} need review${summary.unverifiedCount ? ` · ${summary.unverifiedCount} partially checked` : ''}`);
        }
    }

    _renderUserFilters(state) {
        const filters = state.userFilters || {};
        const activeCount = Object.values(filters).filter(value => value !== 'all').length
            + (state.diagnosticFilter && state.diagnosticFilter !== 'all' ? 1 : 0);
        this._els.filters?.querySelectorAll('[data-user-filter]').forEach(select => {
            const value = filters[select.dataset.userFilter] || 'all';
            if (select.value !== value) select.value = value;
        });
        if (this._els.filterCount) this._setText(this._els.filterCount, activeCount ? `${activeCount} active` : 'Any');
        if (this._els.clearFiltersBtn) this._els.clearFiltersBtn.disabled = !activeCount;
        if (!state.users.length && !activeCount && this._els.filters) this._els.filters.open = false;
    }

    _userItem(user, selected, report) {
        const key = user.name || user.email || user.id || '?';
        const count = readUserWorkoutCount(user);
        const admin = user.role === 'admin';
        const quality = ['error', 'warning', 'info'].includes(report?.highestSeverity) ? ` data-quality="${report.highestSeverity}"` : '';
        return `<div class="item user-item${admin ? ' user-item--admin' : ''}${selected ? ' active' : ''}" data-id="${escapeHtml(user.id)}"${quality} role="option" aria-selected="${selected}" tabindex="-1">
            <div class="user-badge user-badge--${this._avatarColor(key)}" aria-hidden="true">${escapeHtml(Array.from(key)[0].toUpperCase())}</div>
            <div class="user-copy">
                <div class="user-name-row"><span class="user-name" title="${escapeHtml(key)}">${escapeHtml(key)}</span>${report?.findings.length ? diagnosticBadgeHtml(report) : ''}</div>
                ${diagnosticReasonHtml(report)}
                ${user.name && user.email ? `<div class="user-email" title="${escapeHtml(user.email)}">${escapeHtml(user.email)}</div>` : ''}
                <div class="user-meta"><span class="user-workouts">${count === null ? 'Workout count unknown' : `${formatNumber(count)} workout${count === 1 ? '' : 's'}`}</span></div>
            </div>
            ${admin ? '<span class="pill pill-admin user-role">Admin</span>' : ''}
        </div>`;
    }

    _reconcileRows(users, activeId, diagnostics) {
        const list = this._els.userList;
        const next = new Map();
        for (const [index, user] of users.entries()) {
            const report = diagnostics.get(user.id);
            let row = this._rows.get(user.id);
            if (!row || row.user !== user || row.report !== report) {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = this._userItem(user, user.id === activeId, report);
                row = {element: wrapper.firstElementChild, user, report};
            }
            next.set(user.id, row);
            if (list.children[index] !== row.element) list.insertBefore(row.element, list.children[index] || null);
        }
        for (const [id, row] of this._rows) if (!next.has(id) || next.get(id).element !== row.element) row.element.remove();
        this._rows = next;
    }

    _setText(element, value) {
        if (element.textContent !== value) element.textContent = value;
    }

    _updateSelection(activeId, focusedId) {
        const rows = Array.from(this._els.userList.querySelectorAll('.user-item'));
        const selectedVisible = rows.some(row => row.dataset.id === activeId);
        const focusedVisible = focusedId && rows.some(row => row.dataset.id === focusedId);
        rows.forEach((row, index) => {
            const selected = row.dataset.id === activeId;
            row.classList.toggle('active', selected);
            row.setAttribute('aria-selected', String(selected));
            row.tabIndex = focusedVisible ? row.dataset.id === focusedId ? 0 : -1 : selected || (!selectedVisible && index === 0) ? 0 : -1;
        });
    }

    _selectRow(row) {
        if (!row) return;
        const user = this._store.getState().filtered.find(item => item.id === row.dataset.id);
        if (user) this._onSelect(user);
    }

    _onKeyDown(event) {
        const row = event.target.closest('.user-item');
        if (!row) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this._selectRow(row);
            return;
        }
        const rows = Array.from(this._els.userList.querySelectorAll('.user-item'));
        const index = rows.indexOf(row);
        let next;
        if (event.key === 'ArrowDown') next = rows[Math.min(index + 1, rows.length - 1)];
        if (event.key === 'ArrowUp') next = rows[Math.max(index - 1, 0)];
        if (event.key === 'Home') next = rows[0];
        if (event.key === 'End') next = rows[rows.length - 1];
        if (!next) return;
        event.preventDefault();
        rows.forEach(item => item.tabIndex = item === next ? 0 : -1);
        next.focus();
    }

    _avatarColor(value) {
        let hash = 0;
        for (let i = 0; i < value.length; i++) hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
        return Math.abs(hash) % 7;
    }
}
