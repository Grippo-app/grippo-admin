/**
 * SortMenu — inline pill-group sort selector.
 *
 * Renders a flat row of pill buttons directly inside `containerEl`.
 * No popup, no toggle button — the active sort is always visible.
 *
 * @param {{
 *   containerEl: HTMLElement,   — .sort-group__pills wrapper
 *   options:     Record<string, {label: string}>,
 *   active:      string,        — initially active key
 *   onChange:    (key: string) => void
 * }} deps
 */
export class SortMenu {
    constructor({containerEl, options, active, onChange}) {
        this._container = containerEl;
        this._options = options;
        this._active = active;
        this._onChange = onChange;

        this._render();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    setActive(key) {
        if (key === this._active) return;
        this._active = key;
        this._render();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _render() {
        if (!this._container) return;
        this._container.innerHTML = '';

        for (const [key, {label}] of Object.entries(this._options)) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.key = key;
            btn.textContent = label;
            btn.className = 'sort-pill' + (key === this._active ? ' sort-pill--active' : '');
            btn.setAttribute('aria-pressed', String(key === this._active));
            btn.addEventListener('click', () => {
                if (key === this._active) return;
                this._active = key;
                this._render();
                this._onChange?.(key);
            });
            this._container.appendChild(btn);
        }
    }
}
