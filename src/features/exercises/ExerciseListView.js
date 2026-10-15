import {SortMenu} from '../../shared/components/SortMenu.js';
import {FIELD} from '../../shared/constants/index.js';
import {escapeHtml, safeUrl} from '../../shared/utils/index.js';
import {exerciseName} from './exercisePresentation.js';
import {diagnosticBadgeHtml} from '../../shared/components/diagnosticPresentation.js';

const CATEGORY_PILL = {
    compound: 'pill-compound',
    isolation: 'pill-isolation',
};

const EXPERIENCE_PILL = {
    beginner: 'pill-beginner',
    intermediate: 'pill-inter',
    advanced: 'pill-advanced',
    pro: 'pill-pro',
};

const WEIGHT_LABEL = {
    free: 'free',
    fixed: 'fixed',
    body_weight: 'bodyweight',
};

const LIST_SKELETON = `<span class="sr-only">Loading exercises…</span><div class="skeleton-list exercise-list-skeleton" aria-hidden="true">${Array.from({length: 6}, () =>
    '<div class="skeleton-row"><div class="skeleton-stack"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line skeleton-line--medium"></span><span class="skeleton skeleton-line skeleton-line--short"></span></div><span class="skeleton exercise-skeleton-thumb"></span></div>').join('')}</div>`;

export class ExerciseListView {
    /**
     * @param {{
     *   store: ExerciseStore,
     *   els: { list, search, sortToggle, sortMenu, sortLabel, newBtn, loadBtn },
     *   onSelect: (item) => void,
     *   onNew: () => void,
     *   onLoad: () => void,
     *   sortOptions: Record<string, { label: string }>
     * }} deps
     */
    constructor({store, els, onSelect, onNew, onLoad, sortOptions}) {
        this._store = store;
        this._els = els;
        this._onSelect = onSelect;
        this._rendered = null;

        this._sortMenu = new SortMenu({
            toggleEl: els.sortToggle,
            menuEl:   els.sortMenu,
            labelEl:  els.sortLabel,
            options:  sortOptions,
            active:   store.getState().sortKey,
            onChange: (key) => store.setSortKey(key)
        });

        this._bindEvents(onNew, onLoad);
        this._unsubscribe = store.subscribe(() => this.render());
        this.render();
    }

    destroy() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    render() {
        const {filtered, items, current, isLoading, searchQuery, loadError, selectingId, qualityFilter, diagnosticReports, diagnosticOptions, diagnosticSummary} = this._store.getState();
        if (!this._els.list) return;
        this._setText(this._els.count, isLoading && !items.length ? 'Loading exercises…' : loadError ? `${items.length} exercises · Refresh failed` : searchQuery.trim() || qualityFilter !== 'all' ? `${filtered.length} of ${items.length} exercises` : `${items.length} exercises`);
        if (this._els.qualityFilter && this._diagnosticOptions !== diagnosticOptions) {
            this._els.qualityFilter.innerHTML = diagnosticOptions.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
            this._diagnosticOptions = diagnosticOptions;
        }
        if (this._els.qualityFilter) this._els.qualityFilter.value = qualityFilter;
        if (this._els.qualitySummary) {
            const {recordCount, attentionCount, unverifiedCount} = diagnosticSummary;
            this._setText(this._els.qualitySummary, recordCount
                ? `${attentionCount} need review${unverifiedCount ? ` · ${unverifiedCount} not fully checked` : ''}`
                : 'Checks run when exercises load.');
        }
        if (this._els.loadBtn) {
            this._els.loadBtn.disabled = isLoading;
            this._els.loadBtn.textContent = isLoading ? 'Loading…' : 'Refresh';
        }
        const currentId = current?.id;
        const initialLoading = isLoading && !items.length;
        const rowSignatures = this._rendered?.filtered === filtered && this._rendered.reports === diagnosticReports
            ? this._rendered.rowSignatures : new Map(filtered.map(item => {
                const entity = item.entity || item;
                const id = entity.id || item.id;
                const report = diagnosticReports.get(id);
                return [id, JSON.stringify([exerciseName(item), entity.imageUrl || entity.image_url, entity.category,
                    entity.experience, entity.weightType, entity[FIELD.equipmentRefs]?.length, entity[FIELD.bundles]?.length,
                    report?.findings.length ? report : null])];
            }));
        const signature = JSON.stringify([...rowSignatures]);
        const emptyError = filtered.length ? '' : loadError;
        const emptyFiltered = !filtered.length && Boolean(searchQuery.trim() || qualityFilter !== 'all');
        const previous = this._rendered;
        this._rendered = {filtered, rowSignatures, signature, currentId, initialLoading, emptyError, emptyFiltered, selectingId, reports: diagnosticReports};
        this._rows ??= new Map();
        const loadedIds = new Set(items.map(item => item.entity?.id || item.id));
        for (const id of this._rows.keys()) if (!loadedIds.has(id)) this._rows.delete(id);
        this._els.list.setAttribute('aria-busy', String(isLoading || !!selectingId));
        if (previous?.signature === signature && previous.initialLoading === initialLoading && previous.emptyError === emptyError && previous.emptyFiltered === emptyFiltered) {
            if (previous.currentId !== currentId || previous.selectingId !== selectingId) this._syncRowState(currentId, selectingId, previous);
            return;
        }
        const focusedId = this._els.list.contains(document.activeElement) ? document.activeElement?.dataset.id : null;
        const scrollTop = this._els.list.scrollTop;
        if (initialLoading) {
            this._els.list.innerHTML = LIST_SKELETON;
            return;
        }
        if (!filtered.length) {
            const isFiltered = searchQuery.trim() || qualityFilter !== 'all';
            this._els.list.innerHTML = `<div class="exercise-list-empty" role="status"><strong>${loadError ? 'Could not load exercises' : isFiltered ? 'No matching exercises' : 'No exercises yet'}</strong><span>${loadError ? 'Use Refresh to try again.' : isFiltered ? 'Try another search or data-check filter.' : 'Create an exercise to start building your library.'}</span></div>`;
            return;
        }

        const elements = [];
        const visibleFocus = filtered.some(item => (item.entity?.id || item.id) === focusedId) ? focusedId : null;
        const tabstopId = visibleFocus || (filtered.some(item => (item.entity?.id || item.id) === currentId) ? currentId : filtered[0]?.entity?.id || filtered[0]?.id);
        for (const item of filtered) {
            const id = item.entity?.id || item.id;
            const cached = this._rows.get(id);
            if (cached?.signature === rowSignatures.get(id)) { elements.push(cached.element); continue; }
            const el = document.createElement('div');
            // Compare via entity.id (real exercise ID), not the list-wrapper item.id
            const entityId = item.entity?.id || item.id;
            el.dataset.id = entityId || '';
            el.className = 'item exercise-item' + (current != null && entityId === current.id ? ' active' : '');
            el.setAttribute('role', 'option');
            el.setAttribute('aria-selected', String(current != null && entityId === current.id));
            el.classList.toggle('is-loading', entityId === selectingId);
            el.setAttribute('aria-busy', String(entityId === selectingId));
            el.tabIndex = entityId === tabstopId ? 0 : -1;

            const name = exerciseName(item);
            const report = diagnosticReports.get(entityId);
            if (['error', 'warning', 'info'].includes(report?.highestSeverity)) el.dataset.quality = report.highestSeverity;
            el.title = name + (report?.findings.length ? ` — ${report.findings.map(finding => finding.title).filter((value, index, all) => all.indexOf(value) === index).join('; ')}` : '');
            const entity = item?.entity || item;
            const imageUrl = entity?.imageUrl || entity?.image_url || '';
            const category = entity?.category || '';
            const experience = entity?.experience || '';
            const weightType = entity?.weightType || '';
            const equipCount = (Array.isArray(entity?.[FIELD.equipmentRefs]) ? entity[FIELD.equipmentRefs] : []).length;
            const muscleCount = (Array.isArray(entity?.[FIELD.bundles]) ? entity[FIELD.bundles] : []).length;

            const catClass = CATEGORY_PILL[category] || 'pill-subtle';
            const expClass = EXPERIENCE_PILL[experience] || 'pill-subtle';
            const weightLabel = WEIGHT_LABEL[weightType] || weightType;

            const pillsHtml = [
                category ? `<span class="pill ${catClass} ex-pill">${escapeHtml(category)}</span>` : '',
                experience ? `<span class="pill ${expClass} ex-pill">${escapeHtml(experience)}</span>` : '',
                weightLabel ? `<span class="pill pill-subtle ex-pill">${escapeHtml(weightLabel)}</span>` : '',
            ].filter(Boolean).join('');

            const statsHtml = [
                muscleCount ? `${muscleCount} muscle${muscleCount > 1 ? 's' : ''}` : '',
                equipCount ? `${equipCount} equip` : '',
            ].filter(Boolean).join('<span class="ex-stat-sep">·</span>');

            const safeImg = safeUrl(imageUrl);
            const thumbHtml = safeImg
                ? `<div class="ex-thumb-wrap"><img src="${safeImg}" alt="" loading="lazy"/></div>`
                : `<div class="ex-thumb-wrap ex-thumb-empty">—</div>`;

            el.innerHTML = `
                <div class="exercise-main">
                    <div class="exercise-name">${escapeHtml(name) || '(no name)'}</div>
                    ${report?.findings.length ? diagnosticBadgeHtml(report) : ''}
                    ${pillsHtml ? `<div class="exercise-pills">${pillsHtml}</div>` : ''}
                    ${statsHtml ? `<div class="exercise-stats">${statsHtml}</div>` : ''}
                </div>
                ${thumbHtml}
            `;

            el.addEventListener('click', () => {
                this._els.list.querySelectorAll('[role="option"]').forEach(option => { option.tabIndex = -1; });
                el.tabIndex = 0;
                el.focus({preventScroll: true});
                this._selectLatest(entityId);
            });
            el.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this._selectLatest(entityId);
                } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const options = [...this._els.list.querySelectorAll('[role="option"]')];
                    const index = options.indexOf(el);
                    const next = event.key === 'Home' ? options[0] : event.key === 'End' ? options.at(-1) : options[Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
                    el.tabIndex = -1;
                    if (next) { next.tabIndex = 0; next.focus(); }
                }
            });
            const img = el.querySelector('img');
            img?.addEventListener('error', () => {
                const placeholder = document.createElement('span');
                placeholder.textContent = 'No image';
                img.replaceWith(placeholder);
                el.querySelector('.ex-thumb-wrap')?.classList.add('ex-thumb-empty');
            }, {once: true});
            this._rows.set(entityId, {element: el, signature: rowSignatures.get(entityId)});
            elements.push(el);
        }
        const keep = new Set(elements);
        for (const child of [...this._els.list.children]) if (!keep.has(child)) this._els.list.removeChild(child);
        elements.forEach((element, index) => {
            if (this._els.list.children[index] !== element) this._els.list.insertBefore(element, this._els.list.children[index] || null);
        });
        this._syncRowState(currentId, selectingId, previous || {}, true);
        this._els.list.scrollTop = scrollTop;
        if (focusedId) [...this._els.list.children].find(el => el.dataset.id === focusedId)?.focus({preventScroll: true});
    }

    _syncRowState(currentId, selectingId, previous, full = false) {
        const rows = [...this._els.list.children].filter(row => row.dataset.id);
        const focusedId = this._els.list.contains(document.activeElement) ? document.activeElement?.dataset.id : null;
        const tabstopId = focusedId || (rows.some(row => row.dataset.id === currentId) ? currentId : rows[0]?.dataset.id);
        for (const row of rows) {
            const id = row.dataset.id;
            if (full || [previous.currentId, currentId].includes(id)) {
                row.classList.toggle('active', id === currentId);
                row.setAttribute('aria-selected', String(id === currentId));
            }
            if (full || [previous.selectingId, selectingId].includes(id)) {
                row.classList.toggle('is-loading', id === selectingId);
                row.setAttribute('aria-busy', String(id === selectingId));
            }
            const tabIndex = id === tabstopId ? 0 : -1;
            if (row.tabIndex !== tabIndex) row.tabIndex = tabIndex;
        }
    }

    _selectLatest(id) {
        const item = this._store.getState().items.find(item => (item.entity?.id || item.id) === id);
        if (item) this._onSelect(item);
    }

    _setText(element, value) {
        if (element && element.textContent !== value) element.textContent = value;
    }

    _bindEvents(onNew, onLoad) {
        this._els.search?.addEventListener('input', (e) => {
            this._store.setSearchQuery(e.target.value);
        });
        // Native <input type="search"> sends input event with empty value when user clears it,
        // so отдельная кнопка "clear" не нужна — событие input поднимет setSearchQuery('').
        this._els.newBtn?.addEventListener('click', onNew);
        this._els.loadBtn?.addEventListener('click', onLoad);
        this._els.qualityFilter?.addEventListener('change', event => this._store.setQualityFilter(event.target.value));
    }
}
