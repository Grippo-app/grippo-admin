import { SortMenu }   from '../../shared/components/SortMenu.js';
import { UserEntity } from '../../domain/user/UserEntity.js';

export class UserListView {
  /**
   * @param {{
   *   store: UserStore,
   *   els: { userList, userSearch, userSortToggle, userSortMenu, userSortLabel },
   *   onSelect: (user) => void,
   *   sortOptions: Record<string, { label: string }>
   * }} deps
   */
  constructor({ store, els, onSelect, sortOptions }) {
    this._store    = store;
    this._els      = els;
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
    const { filtered, active, isLoading } = this._store.getState();
    if (!this._els.userList) return;
    if (isLoading) { this._els.userList.innerHTML = '<li class="list-loading">Loading…</li>'; return; }

    this._els.userList.innerHTML = '';
    for (const user of filtered) {
      const li = document.createElement('li');
      li.dataset.id = user.id;
      li.className = 'list-item' + (user.id === active?.id ? ' list-item--active' : '');
      li.innerHTML = `
        <span class="user-item__email">${user.email || user.id}</span>
        <span class="user-item__role user-item__role--${user.role}">${user.role}</span>
      `;
      li.addEventListener('click', () => this._onSelect(user));
      this._els.userList.appendChild(li);
    }
  }
}
