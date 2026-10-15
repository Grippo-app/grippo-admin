/** Keyboard-accessible sorting popup, positioned outside toolbar overflow. */
export class SortMenu {
    constructor({toggleEl, menuEl, labelEl, options, active, onChange}) {
        this._toggle = toggleEl;
        this._menu = menuEl;
        this._container = toggleEl?.closest('.sort-dropdown') ?? menuEl?.parentElement;
        this._label = labelEl;
        this._options = options;
        this._active = Object.hasOwn(options, active) ? active : Object.keys(options)[0];
        this._onChange = onChange;
        this._open = false;

        this._toggle?.setAttribute('aria-haspopup', 'menu');
        if (menuEl?.id) this._toggle?.setAttribute('aria-controls', menuEl.id);
        this._toggle?.addEventListener('click', () => this.toggle());
        this._toggle?.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            this.open();
            this._focusItem(e.key === 'ArrowUp' ? this._items().length - 1 : 0);
        });
        this._menu?.addEventListener('keydown', (e) => this._handleKeydown(e));
        document.addEventListener('click', (e) => {
            if (this._open && !this._container?.contains(e.target)) this.close();
        });
        document.addEventListener('focusin', (e) => {
            if (this._open && !this._container?.contains(e.target)) this.close();
        });
        document.addEventListener('keydown', (e) => {
            if (this._open && e.key === 'Escape') {
                e.preventDefault();
                this.close({restoreFocus: true});
            }
        });
        document.addEventListener('scroll', () => {
            if (this._open) this._position();
        }, true);
        window.addEventListener('resize', () => {
            if (this._open) this._position();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.close();
        });

        this._renderItems();
        this._updateLabel();
    }

    setActive(key) {
        if (key === this._active || !Object.hasOwn(this._options, key)) return;
        this._active = key;
        this._updateLabel();
        this._renderItems();
        if (this._open) this._focusActive();
    }

    open() {
        if (!this._toggle || !this._menu) return;
        this._open = true;
        this._container?.classList.add('open');
        this._toggle.setAttribute('aria-expanded', 'true');
        this._position();
        if (this._open) this._focusActive();
    }

    close({restoreFocus = false} = {}) {
        this._open = false;
        this._container?.classList.remove('open');
        this._toggle?.setAttribute('aria-expanded', 'false');
        if (restoreFocus) this._toggle?.focus();
    }

    toggle() {
        this._open ? this.close() : this.open();
    }

    _items() {
        return Array.from(this._menu?.children || []);
    }

    _focusItem(index) {
        const items = this._items();
        if (items.length) items[(index + items.length) % items.length].focus();
    }

    _focusActive() {
        this._focusItem(this._items().findIndex(item => item.dataset.key === this._active));
    }

    _handleKeydown(e) {
        const items = this._items();
        const index = items.indexOf(document.activeElement);
        if (e.key === 'Tab') {
            // Let native Tab continue from the toggle after hiding the popup.
            this.close({restoreFocus: true});
            return;
        }
        const destinations = {
            ArrowDown: index + 1,
            ArrowUp: index - 1,
            Home: 0,
            End: items.length - 1,
        };
        if (Object.hasOwn(destinations, e.key)) {
            e.preventDefault();
            this._focusItem(destinations[e.key]);
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
            const rotated = [...items.slice(index + 1), ...items.slice(0, index + 1)];
            const match = rotated.find(item => item.textContent.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()));
            if (match) {
                e.preventDefault();
                match.focus();
            }
        }
    }

    _position() {
        if (!this._toggle || !this._menu) return;
        if (this._toggle.closest('[hidden]')) {
            this.close();
            return;
        }
        const rect = this._toggle.getBoundingClientRect();
        const width = this._menu.offsetWidth;
        const height = this._menu.offsetHeight;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        const below = rect.bottom + 6;
        const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 6);
        this._menu.style.top = `${top}px`;
        this._menu.style.left = `${left}px`;
    }

    _renderItems() {
        if (!this._menu) return;
        this._menu.innerHTML = '';
        for (const [key, {label}] of Object.entries(this._options)) {
            const isActive = key === this._active;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.tabIndex = -1;
            btn.dataset.key = key;
            btn.className = 'sort-menu__item' + (isActive ? ' sort-menu__item--active' : '');
            btn.setAttribute('role', 'menuitemradio');
            btn.setAttribute('aria-checked', String(isActive));
            btn.textContent = label;
            btn.addEventListener('click', () => {
                this._active = key;
                this._updateLabel();
                this._renderItems();
                this.close({restoreFocus: true});
                this._onChange?.(key);
            });
            this._menu.appendChild(btn);
        }
    }

    _updateLabel() {
        if (this._label) this._label.textContent = this._options[this._active]?.label ?? '';
    }
}
