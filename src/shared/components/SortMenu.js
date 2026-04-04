/**
 * SortMenu — переиспользуемый выпадающий список сортировки.
 *
 * Использование:
 *   const menu = new SortMenu({
 *     toggleEl, menuEl, labelEl,
 *     options: { name: { label: 'Name' }, date: { label: 'Date' } },
 *     active: 'name',
 *     onChange: (key) => store.setSortKey(key)
 *   });
 */
export class SortMenu {
  constructor({ toggleEl, menuEl, labelEl, options, active, onChange }) {
    this._toggle = toggleEl;
    this._menu   = menuEl;
    this._label  = labelEl;
    this._options = options;
    this._active  = active;
    this._onChange = onChange;
    this._open = false;

    this._toggle?.addEventListener('click', () => this.toggle());
    document.addEventListener('click', (e) => {
      if (this._open && !this._menu?.contains(e.target) && e.target !== this._toggle) {
        this.close();
      }
    });
    this._renderItems();
    this._updateLabel();
  }

  _renderItems() {
    if (!this._menu) return;
    this._menu.innerHTML = '';
    for (const [key, { label }] of Object.entries(this._options)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.key = key;
      btn.textContent = label;
      btn.className = 'sort-item' + (key === this._active ? ' sort-item--active' : '');
      btn.addEventListener('click', () => {
        this._active = key;
        this._updateLabel();
        this._renderItems();
        this.close();
        this._onChange?.(key);
      });
      this._menu.appendChild(btn);
    }
  }

  _updateLabel() {
    if (this._label) this._label.textContent = this._options[this._active]?.label || '';
  }

  open() {
    this._open = true;
    this._menu?.classList.add('open');
    this._position();
  }

  close() {
    this._open = false;
    this._menu?.classList.remove('open');
  }

  toggle() {
    this._open ? this.close() : this.open();
  }

  _position() {
    if (!this._toggle || !this._menu) return;
    const rect = this._toggle.getBoundingClientRect();
    this._menu.style.top  = `${rect.bottom + window.scrollY + 4}px`;
    this._menu.style.left = `${rect.left + window.scrollX}px`;
  }

  setActive(key) {
    this._active = key;
    this._updateLabel();
    this._renderItems();
  }
}
