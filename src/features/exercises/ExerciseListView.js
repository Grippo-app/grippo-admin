import {SortMenu} from '../../shared/components/SortMenu.js';

export class ExerciseListView {
    /**
     * @param {{
     *   store: ExerciseStore,
     *   els: { list, search, clearSearch, sortToggle, sortMenu, sortLabel, newBtn, loadBtn },
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

        // SortMenu как shared компонент — не дублируем логику
        this._sortMenu = new SortMenu({
            toggleEl: els.sortToggle,
            menuEl: els.sortMenu,
            labelEl: els.sortLabel,
            options: sortOptions,
            active: store.getState().sortKey,
            onChange: (key) => store.setSortKey(key)
        });

        this._bindEvents(onNew, onLoad);
        store.subscribe(() => this.render());
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
            el.dataset.id = item.id;
            el.className = 'item' + (item.id === current?.id ? ' active' : '');
            el.setAttribute('role', 'option');
            el.tabIndex = 0;

            const name = this._getItemName(item);
            const imageUrl = item?.entity?.imageUrl || item?.imageUrl || '';

            el.innerHTML = `
                ${imageUrl ? `<img class="thumb" src="${imageUrl}" alt="" loading="lazy"/>` : ''}
                <div class="name">${name}</div>
            `;

            el.addEventListener('click', () => this._onSelect(item));
            this._els.list.appendChild(el);
        }
    }

    _bindEvents(onNew, onLoad) {
        this._els.search?.addEventListener('input', (e) => {
            this._store.setSearchQuery(e.target.value);
        });
        this._els.clearSearch?.addEventListener('click', () => {
            if (this._els.search) this._els.search.value = '';
            this._store.setSearchQuery('');
        });
        this._els.newBtn?.addEventListener('click', onNew);
        this._els.loadBtn?.addEventListener('click', onLoad);
    }
}
