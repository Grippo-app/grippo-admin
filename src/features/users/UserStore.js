import {UserEntity, UserDiagnostics, USER_DIAGNOSTIC_RULES} from '../../domain/user/index.js';
import {getDiagnosticFilterOptions, matchesDiagnosticFilter, summarizeDiagnosticReports} from '../../domain/diagnostics/index.js';

export class UserStore {
    constructor({now = Date.now} = {}) {
        this._now = now;
        this._state = this._initialState();
        this._observers = new Set();
    }

    _initialState() {
        return {
            users: [], filtered: [], active: null,
            searchQuery: '', sortKey: 'createdAt', diagnosticFilter: 'all',
            diagnostics: new Map(), diagnosticSummary: summarizeDiagnosticReports([]),
            diagnosticFilterOptions: getDiagnosticFilterOptions([], USER_DIAGNOSTIC_RULES),
            isLoading: false, loadError: '', roleChangeInFlight: false, deleteInFlight: false, deleteUserId: null,
            details: null, detailsForUserId: null, detailsLoading: false, detailSections: {},
            expandedTrainingId: null, trainingsLimit: 10, weightsLimit: 12,
        };
    }

    subscribe(fn) {
        this._observers.add(fn);
        return () => this._observers.delete(fn);
    }

    getState() {
        return {...this._state};
    }

    reset() {
        this._update(this._initialState());
    }

    setUsers(users) {
        const previous = new Map(this._state.users.map(user => [user.id, user]));
        users = users.map(user => {
            const cached = previous.get(user.id);
            return cached && JSON.stringify(cached) === JSON.stringify(user) ? cached : user;
        });
        users = this._reuseRows(this._state.users, users);
        const active = this._state.active
            ? users.find(user => user.id === this._state.active.id) || null : null;
        const selection = active ? {active} : this._clearedSelection();
        const diagnostics = this._diagnosticPatch(users, this._now());
        this._update({users, ...diagnostics, filtered: this._reuseRows(this._state.filtered, this._applyFilter(users, diagnostics)), ...selection});
    }

    setActive(user) {
        if (user && this._state.active?.id === user.id) {
            this._update({active: user});
            return;
        }
        this._update({...this._clearedSelection(), active: user});
    }

    clearActive() {
        this._update(this._clearedSelection());
    }

    _clearedSelection() {
        return {
            active: null, details: null, detailsForUserId: null,
            detailsLoading: false, detailSections: {}, expandedTrainingId: null,
            trainingsLimit: 10, weightsLimit: 12,
        };
    }

    setDetailsLoading(userId, keys = ['goal', 'recentTrainings', 'weightHistory', 'deviceTokens']) {
        if (this._state.active?.id !== userId) return;
        const detailSections = {...this._state.detailSections};
        for (const key of keys) detailSections[key] = {loading: true, loaded: !!detailSections[key]?.loaded, error: ''};
        this._update({detailsForUserId: userId, detailsLoading: true, detailSections});
    }

    setDetailSection(userId, key, {value, error = ''}) {
        if (this._state.active?.id !== userId || this._state.detailsForUserId !== userId || !Object.hasOwn(this._state.detailSections, key)) return;
        const previous = this._state.detailSections[key];
        const details = {...(this._state.details || {}), errors: {...this._state.details?.errors}};
        if (!error) { details[key] = value; delete details.errors[key]; }
        else { if (!previous.loaded) details[key] = key === 'goal' ? null : []; details.errors[key] = error; }
        const detailSections = {...this._state.detailSections, [key]: {loading: false, loaded: !error || previous.loaded, error}};
        this._update({details, detailSections, detailsLoading: Object.values(detailSections).some(section => section.loading)});
    }

    setDetails(userId, details) {
        if (this._state.active?.id !== userId) return;
        const detailSections = Object.fromEntries(['goal', 'recentTrainings', 'weightHistory', 'deviceTokens'].map(key => [key,
            {loading: false, loaded: Object.hasOwn(details, key) && !details.errors?.[key], error: details.errors?.[key] || ''}]));
        this._update({details, detailsForUserId: userId, detailsLoading: false, detailSections});
    }

    toggleExpandedTraining(trainingId) {
        const next = this._state.expandedTrainingId === trainingId ? null : trainingId;
        this._update({expandedTrainingId: next});
    }

    showMoreTrainings() {
        this._update({trainingsLimit: this._state.trainingsLimit + 10});
    }

    showMoreWeights() {
        this._update({weightsLimit: this._state.weightsLimit + 12});
    }

    setSearchQuery(query) {
        this._update({searchQuery: query, filtered: this._applyFilter(this._state.users, {searchQuery: query})});
    }

    setDiagnosticFilter(value) {
        const diagnosticFilter = this._state.diagnosticFilterOptions.some(option => option.value === value) ? value : 'all';
        this._update({diagnosticFilter, filtered: this._applyFilter(this._state.users, {diagnosticFilter})});
    }

    /** The app supplies clock ticks; unchanged reports retain their references and UI state. */
    refreshDiagnostics(now = this._now()) {
        if (!this._state.users.length) return false;
        const diagnostics = this._diagnosticPatch(this._state.users, now);
        if (diagnostics.diagnostics === this._state.diagnostics) return false;
        this._update({...diagnostics, filtered: this._applyFilter(this._state.users, diagnostics)});
        return true;
    }

    _diagnosticPatch(users, now) {
        const previous = this._state.diagnostics;
        const next = new Map(users.map(user => {
            const report = UserDiagnostics.evaluate(user, {now});
            const cached = previous.get(user.id);
            return [user.id, cached && JSON.stringify(cached) === JSON.stringify(report) ? cached : report];
        }));
        if (previous.size === next.size && [...next].every(([id, report]) => previous.get(id) === report)) {
            return {diagnostics: previous, diagnosticSummary: this._state.diagnosticSummary,
                diagnosticFilterOptions: this._state.diagnosticFilterOptions};
        }
        const reports = [...next.values()];
        return {diagnostics: next, diagnosticSummary: summarizeDiagnosticReports(reports),
            diagnosticFilterOptions: getDiagnosticFilterOptions(reports, USER_DIAGNOSTIC_RULES)};
    }

    setSortKey(key) {
        this._update({sortKey: key, filtered: this._applyFilter(this._state.users, {sortKey: key})});
    }

    setLoading(value) {
        this._update({isLoading: value, ...(value ? {loadError: ''} : {})});
    }

    setLoadError(message) {
        this._update({loadError: message});
    }

    setRoleChangeInFlight(value) {
        this._update({roleChangeInFlight: value});
    }

    setDeleteInFlight(value, userId = null) {
        this._update({deleteInFlight: value, deleteUserId: value ? userId : null});
    }

    updateUser(user) {
        this.setUsers(this._state.users.map(item => item.id === user.id ? user : item));
    }

    removeUser(id) {
        this.setUsers(this._state.users.filter(user => user.id !== id));
    }

    _update(patch) {
        this._state = {...this._state, ...patch};
        for (const fn of this._observers) {
            try {
                fn(this._state);
            } catch (error) {
                console.error('[UserStore]', error);
            }
        }
    }

    _reuseRows(previous, next) {
        return previous.length === next.length && next.every((row, index) => row === previous[index]) ? previous : next;
    }

    _applyFilter(users, patch = {}) {
        const options = {...this._state, ...patch};
        const query = options.searchQuery.trim().toLowerCase();
        const filtered = users.filter(user =>
            matchesDiagnosticFilter(options.diagnostics.get(user.id), options.diagnosticFilter) &&
            (!query || [user.name, user.email, user.id, user.profileId]
                .some(value => String(value || '').toLowerCase().includes(query)))
        ).sort(UserEntity.comparator(options.sortKey));
        return this._reuseRows(this._state.filtered, filtered);
    }
}
