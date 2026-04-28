import {SortMenu} from '../../shared/components/SortMenu.js';
import {FIELD} from '../../shared/constants/index.js';
import {escapeHtml, safeUrl} from '../../shared/utils/index.js';

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
     *   getItemName: (item) => string,
     *   sortOptions: Record<string, { label: string }>
     * }} deps
     */
    constructor({store, els, onSelect, onNew, onLoad, getItemName, sortOptions}) {
        this._store = store;
        this._els = els;
        this._onSelect = onSelect;
        this._getItemName = getItemName;

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
    }

    destroy() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    render() {
        const {filtered, current, isLoading} = this._store.getState();
        if (!this._els.list) return;
        if (isLoading) {
            this._els.list.innerHTML = '<div class="list-loading">Loading…</div>';
            return;
        }

        this._els.list.innerHTML = '';
        for (const item of filtered) {
            const el = document.createElement('div');
            // Compare via entity.id (real exercise ID), not the list-wrapper item.id
            const entityId = item.entity?.id || item.id;
            el.dataset.id = entityId || '';
            el.className = 'item exercise-item' + (current != null && entityId === current.id ? ' active' : '');
            el.setAttribute('role', 'option');
            el.tabIndex = 0;

            const name = this._getItemName(item);
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
                    ${pillsHtml ? `<div class="exercise-pills">${pillsHtml}</div>` : ''}
                    ${statsHtml ? `<div class="exercise-stats">${statsHtml}</div>` : ''}
                </div>
                ${thumbHtml}
            `;

            el.addEventListener('click', () => this._onSelect(item));
            this._els.list.appendChild(el);
        }
    }

    _bindEvents(onNew, onLoad) {
        this._els.search?.addEventListener('input', (e) => {
            this._store.setSearchQuery(e.target.value);
        });
        // Native <input type="search"> sends input event with empty value when user clears it,
        // so отдельная кнопка "clear" не нужна — событие input поднимет setSearchQuery('').
        this._els.newBtn?.addEventListener('click', onNew);
        this._els.loadBtn?.addEventListener('click', onLoad);
    }
}
