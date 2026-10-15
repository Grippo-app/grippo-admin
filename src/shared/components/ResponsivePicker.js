/** Keep the record list available on desktop and let the selected record lead on phones. */
export class ResponsivePicker {
    constructor({details, labelEl, emptyLabel, media = window.matchMedia('(max-width: 760px)')}) {
        this._details = details;
        this._labelEl = labelEl;
        this._emptyLabel = emptyLabel;
        this._media = media;
        this._id = '';
        this._summary = details.querySelector('summary');
        this._onMedia = () => this._setOpen(!media.matches || !this._id);
        this._onToggle = () => {
            if (!media.matches && !details.open) details.open = true;
            this._syncLayout();
        };
        this._onClick = event => {
            const row = event.target.closest?.('[role="option"]');
            if (media.matches && this._id && row?.dataset.id === this._id) this._setOpen(false);
        };
        this._onKey = event => {
            if (event.key === 'Enter' || event.key === ' ') this._onClick(event);
        };
        media.addEventListener('change', this._onMedia);
        details.addEventListener('toggle', this._onToggle);
        details.addEventListener('click', this._onClick);
        details.addEventListener('keydown', this._onKey);
        this.update(null);
    }

    update(selection) {
        const id = selection?.id || '';
        const label = selection?.label || this._emptyLabel;
        if (this._labelEl.textContent !== label) this._labelEl.textContent = label;
        if (id !== this._id || !id) {
            this._id = id;
            this._setOpen(!this._media.matches || !id);
        }
    }

    _setOpen(open) {
        const focusInside = !open && this._details.contains(document.activeElement)
            && document.activeElement !== this._summary;
        this._details.open = open;
        this._syncLayout();
        if (focusInside) this._summary.focus({preventScroll: true});
    }

    _syncLayout() {
        this._details.parentElement.classList.toggle('is-picker-collapsed', this._media.matches && !this._details.open);
    }

    destroy() {
        this._media.removeEventListener('change', this._onMedia);
        this._details.removeEventListener('toggle', this._onToggle);
        this._details.removeEventListener('click', this._onClick);
        this._details.removeEventListener('keydown', this._onKey);
    }
}
