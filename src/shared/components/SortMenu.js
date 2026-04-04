/**
 * SortMenu — popup dropdown sort selector.
 *
 * The outside-click handler uses `container.contains(e.target)` so clicks on
 * any child element (including <span> nodes inside the toggle button) are
 * correctly treated as "inside" — fixing the old e.target !== toggleEl bug.
 *
 * @param {{
 *   toggleEl:  HTMLButtonElement,
 *   menuEl:    HTMLElement,
 *   labelEl:   HTMLElement,
 *   options:   Record<string, {label: string}>,
 *   active:    string,
 *   onChange:  (key: string) => void
 * }} deps
 */
export class SortMenu {
    constructor({toggleEl, menuEl, labelEl, options, active, onChange}) {
        this._toggle    = toggleEl;
        this._menu      = menuEl;
        // Use the shared container (.sort-dropdown) so contains() covers both
        // the toggle button and the open menu
        this._container = toggleEl?.closest('.sort-dropdown') ?? menuEl?.parentElement;
        this._label     = labelEl;
        this._options   = options;
        this._active    = active;
        this._onChange  = onChange;
        this._open      = false;

        this._toggle?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Close on any click outside the whole .sort-dropdown container
        document.addEventListener('click', (e) => {
            if (this._open && !this._container?.contains(e.target)) {
                this.close();
            }
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (this._open && e.key === 'Escape') {
                this.close();
                this._toggle?.focus();
            }
        });

        this._renderItems();
        this._updateLabel();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    setActive(key) {
        if (key === this._active) return;
        this._active = key;
        this._updateLabel();
        this._renderItems();
    }

    open() {
        this._open = true;
        this._container?.classList.add('open');
        this._toggle?.setAttribute('aria-expanded', 'true');
    }

    close() {
        this._open = false;
        this._container?.classList.remove('open');
        this._toggle?.setAttribute('aria-expanded', 'false');
    }

    toggle() {
        this._open ? this.close() : this.open();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _renderItems() {
        if (!this._menu) return;
        this._menu.innerHTML = '';
        for (const [key, {label}] of Object.entries(this._options)) {
            const isActive = key === this._active;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.key = key;
            btn.className = 'sort-menu__item' + (isActive ? ' sort-menu__item--active' : '');
            btn.setAttribute('role', 'menuitemradio');
            btn.setAttribute('aria-checked', String(isActive));
            btn.textContent = label;
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
        if (this._label) this._label.textContent = this._options[this._active]?.label ?? '';
    }
}
