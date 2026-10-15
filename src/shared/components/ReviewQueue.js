import {matchesDiagnosticFilter} from '../../domain/diagnostics/index.js';
import {primaryAttentionFinding} from './diagnosticPresentation.js';

/** One entry per saved record, in the order of the current filtered/sorted view. */
export function buildReviewQueue(items, reports, getId) {
    const queue = [];
    const seen = new Set();
    for (const item of items ?? []) {
        const id = getId(item);
        if (typeof id !== 'string' || !id.trim() || seen.has(id)) continue;
        seen.add(id);
        const report = reports?.get(id);
        if (!matchesDiagnosticFilter(report, 'attention')) continue;
        queue.push({id, item, report, finding: primaryAttentionFinding(report)});
    }
    return queue;
}

/** Navigation follows confirmed selection; opening a record never advances a local cursor. */
export class ReviewQueue {
    constructor({root, getId, onSelect, onShowReason}) {
        this._root = root;
        this._getId = getId;
        this._onSelect = onSelect;
        this._onShowReason = onShowReason;
        this._queue = [];
        this._generation = 0;
        this._pending = null;
        this._enabled = false;
        this._busy = false;
        this._destroyed = false;
        this._selectedId = null;
        this._items = null;
        this._reports = null;
        this._loadError = false;
        this._error = '';

        root.classList.add('review-queue');
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', 'Saved record review queue');
        this._position = this._element('p', 'position');
        this._position.setAttribute('role', 'status');
        this._position.setAttribute('aria-live', 'polite');
        this._position.setAttribute('aria-atomic', 'true');
        this._reason = this._element('p', 'reason');
        this._status = this._element('p', 'status');
        this._status.setAttribute('role', 'status');
        this._actions = this._element('div', 'actions');
        this._previous = this._button('previous', 'Previous', 'Previous issue');
        this._next = this._button('next', 'Next', 'Next issue');
        this._why = this._button('why', 'Why?', 'Show saved record issue details');
        this._actions.append(this._previous, this._next, this._why);
        root.replaceChildren(this._position, this._reason, this._status, this._actions);
        this._onPrevious = () => { void this._select('previous'); };
        this._onNext = () => { void this._select('next'); };
        this._onWhy = () => { void this._showReason(); };
        this._previous.addEventListener('click', this._onPrevious);
        this._next.addEventListener('click', this._onNext);
        this._why.addEventListener('click', this._onWhy);
        this._render();
    }

    update({items, reports, selectedId = null, enabled = false, busy = false, loadError = ''}) {
        if (this._destroyed) return;
        if (!enabled) {
            this._clear();
            this._render();
            return;
        }
        if (!this._enabled || items !== this._items || reports !== this._reports) {
            this._generation++;
            this._queue = buildReviewQueue(items, reports, this._getId);
            this._items = items;
            this._reports = reports;
            this._error = '';
        }
        if (selectedId !== this._selectedId) {
            this._generation++;
            this._error = '';
        }
        this._enabled = true;
        this._selectedId = selectedId;
        this._busy = !!busy;
        this._loadError = !!loadError;
        this._render();
    }

    _element(tag, name) {
        const element = document.createElement(tag);
        element.className = `review-queue__${name}`;
        return element;
    }

    _button(name, label, accessibleLabel) {
        const button = this._element('button', name);
        button.className += ' btn muted';
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-label', accessibleLabel);
        return button;
    }

    _index() { return this._queue.findIndex(entry => entry.id === this._selectedId); }

    _candidate(direction) {
        const index = this._index();
        if (direction === 'previous') return index > 0 ? this._queue[index - 1] : null;
        return this._queue[index < 0 ? 0 : index + 1] ?? null;
    }

    async _select(direction) {
        if (!this._enabled || this._busy || this._pending || this._destroyed) return;
        const entry = this._candidate(direction);
        if (!entry) return;
        const operation = {generation: this._generation};
        this._pending = operation;
        this._error = '';
        const isCurrent = () => !this._destroyed && this._enabled
            && operation.generation === this._generation && this._pending === operation
            && this._candidate(direction)?.id === entry.id;
        this._render();
        try {
            await this._onSelect(entry.item, {isCurrent});
        } catch {
            if (isCurrent()) this._error = 'Could not open this record. Try again.';
        } finally {
            if (this._pending === operation) {
                this._pending = null;
                this._render();
            }
        }
    }

    async _showReason() {
        if (!this._enabled || this._busy || this._pending || !this._onShowReason || this._destroyed) return;
        const entry = this._queue[this._index()];
        if (!entry) return;
        const generation = this._generation;
        try { await this._onShowReason(entry); }
        catch {
            if (this._enabled && generation === this._generation && !this._destroyed) {
                this._error = 'Could not show these checks. Try again.';
                this._render();
            }
        }
    }

    _setText(element, value) {
        if (element.textContent !== value) element.textContent = value;
    }

    _render() {
        const root = this._root;
        root.hidden = !this._enabled;
        const blocked = this._busy || !!this._pending;
        root.setAttribute('aria-busy', this._enabled && blocked ? 'true' : 'false');
        if (!this._enabled) {
            for (const element of [this._position, this._reason, this._status]) this._setText(element, '');
            this._reason.removeAttribute('title');
            this._reason.removeAttribute('data-severity');
            this._previous.disabled = this._next.disabled = this._why.disabled = true;
            this._actions.hidden = true;
            return;
        }
        const index = this._index();
        const entry = this._queue[index];
        const size = this._queue.length;
        this._setText(this._position, entry ? `Record ${index + 1} of ${size}` : 'Review issues');
        this._reason.hidden = !entry;
        this._setText(this._reason, entry ? `Saved record: ${entry.finding.severity === 'error' ? 'Error' : 'Warning'} · ${entry.finding.title}` : '');
        if (entry) {
            this._reason.setAttribute('title', entry.finding.message);
            this._reason.setAttribute('data-severity', entry.finding.severity);
        } else {
            this._reason.removeAttribute('title');
            this._reason.removeAttribute('data-severity');
        }
        const notes = [];
        if (!size) notes.push('No flagged records in this view.');
        else if (!entry) notes.push(this._selectedId
            ? `Selected record is outside this queue. ${size} ${size === 1 ? 'record needs' : 'records need'} review in this view.`
            : `${size} ${size === 1 ? 'record needs' : 'records need'} review in this view.`);
        if (this._loadError) notes.push('Refresh failed. This review queue may be incomplete.');
        if (this._error) notes.push(this._error);
        this._setText(this._status, notes.join(' '));
        this._status.hidden = !notes.length;
        this._actions.hidden = !size;
        this._previous.hidden = !entry;
        this._previous.disabled = blocked || index <= 0;
        this._next.disabled = blocked || !this._candidate('next');
        this._setText(this._next, entry ? 'Next' : 'Start review');
        this._next.setAttribute('aria-label', entry ? 'Next issue' : 'Start review');
        this._why.hidden = !entry || !this._onShowReason;
        this._why.disabled = blocked;
    }

    _clear() {
        this._generation++;
        this._pending = null;
        this._enabled = false;
        this._busy = false;
        this._selectedId = null;
        this._items = this._reports = null;
        this._queue = [];
        this._loadError = false;
        this._error = '';
    }

    destroy() {
        this._clear();
        this._destroyed = true;
        this._previous.removeEventListener('click', this._onPrevious);
        this._next.removeEventListener('click', this._onNext);
        this._why.removeEventListener('click', this._onWhy);
        this._render();
    }
}
