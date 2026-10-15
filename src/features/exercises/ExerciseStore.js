import {compareStrings, toTimestamp} from '../../shared/utils/index.js';
import {exerciseEntity, exerciseName, exerciseSearchText} from './exercisePresentation.js';
import {diagnoseExercise, EXERCISE_DIAGNOSTIC_RULES} from '../../domain/exercise/ExerciseDiagnostics.js';
import {getDiagnosticFilterOptions, matchesDiagnosticFilter, summarizeDiagnosticReports, summarizeUnavailableChecks} from '../../domain/diagnostics/index.js';

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
            isDetailLoading: false,
            selectingId: null,
            loadError: '',
            detailError: '',
            createIdentityMissing: false,
            translationProvenanceKnown: false,
            translationSnapshot: null,
            qualityFilter: 'all',
            diagnosticReports: new Map(),
            diagnosticOptions: getDiagnosticFilterOptions([], EXERCISE_DIAGNOSTIC_RULES),
            diagnosticSummary: summarizeDiagnosticReports([]),
            diagnosticCoverage: [],
        };
        this._diagnosticSources = new Map();
        this._diagnosticContext = {};
        this._diagnosticCache = new Map();
        this._diagnosticContextVersion = 0;
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

    setItems(items, {diagnosticSources, sourceVersion = 0} = {}) {
        items = Array.isArray(items) ? items.filter(item => item && typeof item === 'object') : [];
        const ids = new Set(items.map(item => exerciseEntity(item).id || item.id));
        for (const [id, source] of this._diagnosticSources) {
            const retainedSelection = !diagnosticSources && id === this._state.current?.id;
            if (!ids.has(id) && !retainedSelection && (!diagnosticSources || source.version <= sourceVersion)) {
                this._diagnosticSources.delete(id);
                this._diagnosticCache.delete(id);
            }
        }
        if (diagnosticSources) {
            // Compare request order so a late list cannot downgrade a newer detail read.
            for (const [id, record] of diagnosticSources) {
                if (this._diagnosticSources.get(id)?.version > sourceVersion) continue;
                this._diagnosticSources.set(id, {record: structuredClone(record), complete: false, translationSnapshot: null, version: sourceVersion});
            }
        }
        const diagnostics = this._rebuildDiagnostics(items);
        this._update({items, ...diagnostics, filtered: this._applyFilter(items, this._state.searchQuery, diagnostics.diagnosticReports)});
    }

    setDiagnosticSource(id, record, {complete = true, translationSnapshot = null, sourceVersion = 0} = {}) {
        if (!id || !record || typeof record !== 'object') return;
        if (this._diagnosticSources.get(id)?.version > sourceVersion) return;
        this._diagnosticSources.set(id, {record: structuredClone(record), complete,
            translationSnapshot: translationSnapshot ? structuredClone(translationSnapshot) : null, version: sourceVersion});
        const diagnostics = this._rebuildDiagnostics(this._state.items);
        this._update({...diagnostics, filtered: this._applyFilter(this._state.items, this._state.searchQuery, diagnostics.diagnosticReports)});
    }

    setDiagnosticContext(context = {}) {
        const keys = ['equipment', 'muscles', 'equipmentReady', 'musclesReady'];
        if (keys.every(key => this._diagnosticContext[key] === context[key])) return;
        this._diagnosticContext = Object.fromEntries(keys.map(key => [key, context[key]]));
        this._diagnosticContextVersion++;
        const diagnostics = this._rebuildDiagnostics(this._state.items);
        this._update({...diagnostics, filtered: this._applyFilter(this._state.items, this._state.searchQuery, diagnostics.diagnosticReports)});
    }

    getDiagnosticReport(id) { return this._state.diagnosticReports.get(id) ?? null; }

    setQualityFilter(value) {
        if (!this._state.diagnosticOptions.some(option => option.value === value)) return;
        this._update({qualityFilter: value, filtered: this._applyFilter(this._state.items, this._state.searchQuery, this._state.diagnosticReports, value)});
    }

    _rebuildDiagnostics(items) {
        const diagnosticReports = new Map();
        for (const [id, source] of this._diagnosticSources) {
            let cached = this._diagnosticCache.get(id);
            if (cached?.source !== source || cached.version !== this._diagnosticContextVersion) {
                cached = {source, version: this._diagnosticContextVersion, report: diagnoseExercise(source.record,
                    {...this._diagnosticContext, complete: source.complete, translationSnapshot: source.translationSnapshot})};
                this._diagnosticCache.set(id, cached);
            }
            diagnosticReports.set(id, cached.report);
        }
        const reports = items.map(item => diagnosticReports.get(exerciseEntity(item).id || item.id) ?? null);
        return {diagnosticReports, diagnosticOptions: getDiagnosticFilterOptions(reports, EXERCISE_DIAGNOSTIC_RULES),
            diagnosticSummary: summarizeDiagnosticReports(reports), diagnosticCoverage: summarizeUnavailableChecks(reports)};
    }

    setFiltered(filtered) {
        this._update({filtered});
    }

    setCurrent(exercise, {translationProvenanceKnown = false, translationSnapshot = null} = {}) {
        this._update({current: exercise, isNew: false, createIdentityMissing: false, translationProvenanceKnown, translationSnapshot});
    }

    /**
     * Точечное обновление полей current без сброса isNew.
     * Использовать для inline-правок формы (equipment, bundles, view-mode flush, etc.).
     */
    patchCurrent(patch) {
        if (!this._state.current) return;
        const merged = {...(this._state.current || {}), ...(patch || {})};
        this._update({current: merged});
    }

    setNew(exercise) {
        this._update({current: exercise, isNew: true, createIdentityMissing: false, translationProvenanceKnown: true, translationSnapshot: null});
    }

    clearCurrent() {
        this._update({current: null, isNew: false, createIdentityMissing: false, translationProvenanceKnown: false, translationSnapshot: null});
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

    setLoadError(message = '') {
        this._update({loadError: message});
    }

    setDetailLoading(value, selectingId = null) {
        this._update({isDetailLoading: value, selectingId, detailError: ''});
    }

    setDetailError(message = '') {
        this._update({detailError: message});
    }

    reset() {
        this._diagnosticSources.clear();
        this._diagnosticCache.clear();
        this._update({items: [], filtered: [], current: null, isNew: false, isLoading: false,
            isSaving: false, isDetailLoading: false, selectingId: null, loadError: '', detailError: '', createIdentityMissing: false, translationProvenanceKnown: false, translationSnapshot: null,
            qualityFilter: 'all', ...this._rebuildDiagnostics([])});
    }

    setSaving(v) {
        this._update({isSaving: v});
    }

    setCreateIdentityMissing(value) {
        this._update({createIdentityMissing: value});
    }

    /**
     * Update items list after save (replace or append).
     * Сравнивает по entity.id, потому что список приходит как { id, entity: { id } },
     * а после save сервер может вернуть либо обёртку, либо «голую» сущность.
     */
    upsertItem(item) {
        if (!item || typeof item !== 'object') return;
        const newId = item.entity?.id || item.id;
        if (!newId) {
            // нет идентификатора — просто добавляем, не трогая существующее
            this.setItems([...this._state.items, item]);
            return;
        }
        const items = this._state.items
            .filter(i => (i?.entity?.id || i?.id) !== newId)
            .concat(item);
        this.setItems(items);
    }

    removeItem(id) {
        this._diagnosticSources.delete(id);
        this._diagnosticCache.delete(id);
        const items = this._state.items.filter(i => (i?.entity?.id || i?.id) !== id);
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

    _applyFilter(items, query, reports = this._state.diagnosticReports, qualityFilter = this._state.qualityFilter) {
        let result = items.filter(item => matchesDiagnosticFilter(reports.get(exerciseEntity(item).id || item.id), qualityFilter));
        if (query?.trim()) {
            const q = query.trim().toLocaleLowerCase();
            result = result.filter(item => exerciseSearchText(item).includes(q));
        }
        return this._sortItems(result, this._state.sortKey);
    }

    _sortItems(items, key) {
        const compareNames = (a, b) => compareStrings(exerciseName(a), exerciseName(b));

        const getTs = (item) => {
            const entity = exerciseEntity(item);
            return toTimestamp(entity.createdAt ?? entity.created_at ?? item?.createdAt);
        };

        const hasImage = (item) =>
            typeof (exerciseEntity(item).imageUrl ?? exerciseEntity(item).image_url) === 'string'
                && !!(exerciseEntity(item).imageUrl ?? exerciseEntity(item).image_url).trim();

        const sorted = [...items];
        sorted.sort((a, b) => {
            switch (key) {
                case 'createdAt':
                    return (getTs(b) - getTs(a)) || compareNames(a, b);
                case 'hasImage':
                    return (Number(hasImage(b)) - Number(hasImage(a))) || compareNames(a, b);
                case 'missingImage':
                    return (Number(hasImage(a)) - Number(hasImage(b))) || compareNames(a, b);
                case 'name':
                default:
                    return compareNames(a, b);
            }
        });
        return sorted;
    }
}
