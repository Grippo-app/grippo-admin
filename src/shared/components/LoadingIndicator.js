/** Describe visible work without disclosing record names or identifiers. */
export function loadingDescription({authenticated, section, exercise = {}, users = {}, dictionaryLoading = false}) {
    if (!authenticated) return '';
    if (exercise.isSaving) return 'Updating exercise…';
    if (users.deleteInFlight || users.roleChangeInFlight) return 'Updating account…';
    if (section === 'users') {
        if (users.detailsLoading) return 'Loading account details…';
        if (users.isLoading) return users.users?.length ? 'Refreshing users…' : 'Loading users…';
    } else {
        if (exercise.isDetailLoading) return 'Loading exercise and translations…';
        if (exercise.isLoading) return exercise.items?.length ? 'Refreshing exercises…' : 'Loading exercises…';
        if (dictionaryLoading) return 'Loading muscles and equipment…';
    }
    return '';
}

/** Fixed UI feedback: short requests stay quiet and overlapping requests do not flicker. */
export class LoadingIndicator {
    constructor({root, labelEl, showDelay = 120, minVisible = 280}) {
        this._root = root;
        this._labelEl = labelEl;
        this._showDelay = showDelay;
        this._minVisible = minVisible;
        this._showTimer = null;
        this._hideTimer = null;
        this._label = '';
        this._shownAt = 0;
        this.reset();
    }

    update(label) {
        this._label = label;
        if (!label) {
            clearTimeout(this._showTimer);
            this._showTimer = null;
            if (this._root.hidden || this._hideTimer !== null) return;
            const remaining = Math.max(0, this._minVisible - (Date.now() - this._shownAt));
            this._hideTimer = setTimeout(() => this.reset(), remaining);
            return;
        }
        clearTimeout(this._hideTimer);
        this._hideTimer = null;
        if (!this._root.hidden) {
            if (this._labelEl.textContent !== label) this._labelEl.textContent = label;
        } else if (this._showTimer === null) {
            this._showTimer = setTimeout(() => {
                this._showTimer = null;
                if (!this._label) return;
                this._labelEl.textContent = this._label;
                this._root.hidden = false;
                this._shownAt = Date.now();
            }, this._showDelay);
        }
    }

    reset() {
        clearTimeout(this._showTimer);
        clearTimeout(this._hideTimer);
        this._showTimer = null;
        this._hideTimer = null;
        this._label = '';
        this._root.hidden = true;
        this._labelEl.textContent = '';
    }
}
