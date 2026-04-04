export class ExerciseStore {
    constructor() {
        this._state = {
            items: [],    // raw list from API
            filtered: [],    // after search filter
            current: null,  // selected exercise (canonical shape)
            isNew: false, // true if unsaved new exercise
            searchQuery: '',
            locale: 'en',
            viewMode: 'form', // 'form' | 'json'
            sortKey: 'name',
            isSaving: false,
            isLoading: false,
        };
        this._observers = new Set();
    }

    /** Subscribe to any state change. Returns unsubscribe fn. */
    subscribe(fn) {
        this._observers.add(fn);
        return () => this._observers.delete(fn);
    }

    /** Get a snapshot of current state (shallow copy). */
    getState() {
        return {...this._state};
    }

    /* ── Mutators ─────────────────────────────────────── */

    setItems(items) {
        this._update({items, filtered: this._applyFilter(items, this._state.searchQuery)});
    }

    setFiltered(filtered) {
        this._update({filtered});
    }

    setCurrent(exercise) {
        this._update({current: exercise, isNew: false});
    }

    setNew(exercise) {
        this._update({current: exercise, isNew: true});
    }

    clearCurrent() {
        this._update({current: null, isNew: false});
    }

    setSearchQuery(q) {
        this._update({searchQuery: q, filtered: this._applyFilter(this._state.items, q)});
    }

    setLocale(locale) {
        this._update({locale});
    }

    setViewMode(mode) {
        this._update({viewMode: mode});
    }

    setSortKey(key) {
        this._update({sortKey: key, filtered: this._sortItems(this._state.filtered, key)});
    }

    setLoading(v) {
        this._update({isLoading: v});
    }

    setSaving(v) {
        this._update({isSaving: v});
    }

    /** Update items list after save (replace or append). */
    upsertItem(item) {
        const items = this._state.items.filter(i => i.id !== item.id).concat(item);
        this.setItems(items);
    }

    removeItem(id) {
        const items = this._state.items.filter(i => i.id !== id);
        this.setItems(items);
    }

    _update(patch) {
        this._state = {...this._state, ...patch};
        for (const fn of this._observers) {
            try {
                fn(this._state);
            } catch (e) {
                console.error('[ExerciseStore]', e);
            }
        }
    }

    _applyFilter(items, query) {
        let result = items;
        if (query) {
            const q = query.toLowerCase();
            result = items.filter(item => {
                const name = item?.entity?.nameTranslations?.en?.toLowerCase()
                    || item?.entity?.name?.toLowerCase()
                    || item?.name?.toLowerCase() || '';
                return name.includes(q);
            });
        }
        return this._sortItems(result, this._state.sortKey);
    }

    _sortItems(items, key) {
        const getName = (item) =>
            (item?.entity?.nameTranslations?.en || item?.entity?.name || item?.name || '').toLowerCase();

        const getTs = (item) => {
            const raw = item?.entity?.createdAt ?? item?.entity?.created_at ?? item?.createdAt ?? '';
            return raw ? new Date(raw).getTime() : 0;
        };

        const hasImage = (item) =>
            !!(item?.entity?.imageUrl || item?.entity?.image_url || item?.imageUrl || '').trim();

        const sorted = [...items];
        sorted.sort((a, b) => {
            switch (key) {
                case 'createdAt':
                    return (getTs(b) - getTs(a)) || getName(a).localeCompare(getName(b));
                case 'hasImage':
                    return (Number(hasImage(b)) - Number(hasImage(a))) || getName(a).localeCompare(getName(b));
                case 'missingImage':
                    return (Number(hasImage(a)) - Number(hasImage(b))) || getName(a).localeCompare(getName(b));
                case 'name':
                default:
                    return getName(a).localeCompare(getName(b));
            }
        });
        return sorted;
    }
}
