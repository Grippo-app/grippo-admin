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
        if (this._els.count) this._els.count.textContent = isLoading ? 'Loading exercises…' : loadError ? `${items.length} exercises · Refresh failed` : searchQuery.trim() || qualityFilter !== 'all' ? `${filtered.length} of ${items.length} exercises` : `${items.length} exercises`;
        if (this._els.qualityFilter && this._diagnosticOptions !== diagnosticOptions) {
            this._els.qualityFilter.innerHTML = diagnosticOptions.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
            this._diagnosticOptions = diagnosticOptions;
        }
        if (this._els.qualityFilter) this._els.qualityFilter.value = qualityFilter;
        if (this._els.qualitySummary) {
            const {recordCount, attentionCount, counts, unverifiedCount} = diagnosticSummary;
            this._els.qualitySummary.textContent = `${attentionCount} of ${recordCount} stored exercises need attention · ${counts.error} with errors · ${counts.warning} with warnings · ${counts.info} with notes${unverifiedCount ? ` · ${unverifiedCount} partly unchecked` : ''}`;
        }
        if (this._els.loadBtn) {
            this._els.loadBtn.disabled = isLoading;
            this._els.loadBtn.textContent = isLoading ? 'Loading…' : 'Refresh';
        }
        const currentId = current?.id;
        if (this._rendered?.filtered === filtered && this._rendered.reports === diagnosticReports && this._rendered.currentId === currentId && this._rendered.isLoading === isLoading && this._rendered.loadError === loadError && this._rendered.selectingId === selectingId) return;
        this._rendered = {filtered, currentId, isLoading, loadError, selectingId, reports: diagnosticReports};
        const focusedId = this._els.list.contains(document.activeElement) ? document.activeElement?.dataset.id : null;
        const scrollTop = this._els.list.scrollTop;
        this._els.list.setAttribute('aria-busy', String(isLoading || !!selectingId));
        if (isLoading && !items.length) {
            this._els.list.innerHTML = '<div class="list-loading" role="status">Loading exercises…</div>';
            return;
        }
        if (!filtered.length) {
            const isFiltered = searchQuery.trim() || qualityFilter !== 'all';
            this._els.list.innerHTML = `<div class="exercise-list-empty" role="status"><strong>${loadError ? 'Could not load exercises' : isFiltered ? 'No matching exercises' : 'No exercises yet'}</strong><span>${loadError ? 'Use Refresh to try again.' : isFiltered ? 'Try another search or data-check filter.' : 'Create an exercise to start building your library.'}</span></div>`;
            return;
        }

        this._els.list.innerHTML = '';
        const tabstopId = focusedId || (filtered.some(item => (item.entity?.id || item.id) === currentId) ? currentId : filtered[0]?.entity?.id || filtered[0]?.id);
        for (const item of filtered) {
            const el = document.createElement('div');
            // Compare via entity.id (real exercise ID), not the list-wrapper item.id
            const entityId = item.entity?.id || item.id;
            el.dataset.id = entityId || '';
            el.className = 'item exercise-item' + (current != null && entityId === current.id ? ' active' : '');
            el.setAttribute('role', 'option');
            el.setAttribute('aria-selected', String(current != null && entityId === current.id));
            el.classList.toggle('is-loading', entityId === selectingId);
            el.tabIndex = entityId === tabstopId ? 0 : -1;

            const name = exerciseName(item);
            const report = diagnosticReports.get(entityId);
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
                    ${diagnosticBadgeHtml(report)}
                    ${pillsHtml ? `<div class="exercise-pills">${pillsHtml}</div>` : ''}
                    ${statsHtml ? `<div class="exercise-stats">${statsHtml}</div>` : ''}
                </div>
                ${thumbHtml}
            `;

            el.addEventListener('click', () => {
                this._els.list.querySelectorAll('[role="option"]').forEach(option => { option.tabIndex = -1; });
                el.tabIndex = 0;
                el.focus({preventScroll: true});
                this._onSelect(item);
            });
            el.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this._onSelect(item);
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
            this._els.list.appendChild(el);
        }
        this._els.list.scrollTop = scrollTop;
        if (focusedId) [...this._els.list.children].find(el => el.dataset.id === focusedId)?.focus({preventScroll: true});
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
