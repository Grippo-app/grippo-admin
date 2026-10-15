import {Events} from '../../infrastructure/events/events.js';
import {UserDetailsEntity, UserEntity} from '../../domain/user/index.js';
import {Toast} from '../../shared/components/Toast.js';

export class UserController {
    constructor({store, repository, bus, confirmDialog}) {
        this._store = store;
        this._repo = repository;
        this._bus = bus;
        this._confirm = confirmDialog;
        this._sessionVersion = 0;
        this._loadVersion = 0;
        this._detailsVersion = 0;
        this._deleteConfirming = false;

        bus.on(Events.AUTH_LOGIN_SUCCESS, () => this.loadUsers());
        const reset = () => {
            this._sessionVersion++;
            this._loadVersion++;
            this._detailsVersion++;
            store.reset();
        };
        bus.on(Events.AUTH_LOGOUT, reset);
        bus.on(Events.AUTH_SESSION_EXPIRED, reset);
    }

    async loadUsers() {
        const version = ++this._loadVersion;
        this._store.setLoading(true);
        try {
            const raw = await this._repo.fetchAll();
            if (version !== this._loadVersion) return;
            UserEntity.validateList(raw);
            const users = raw.map(UserEntity.normalize);
            this._store.setUsers(users);
            this._bus.emit(Events.USER_LIST_LOADED, users);
        } catch (error) {
            if (version !== this._loadVersion) return;
            this._store.setLoadError(error.message || 'Please try again.');
            Toast.show({title: 'Failed to load users', message: error.message, type: 'error'});
        } finally {
            if (version === this._loadVersion) this._store.setLoading(false);
        }
    }

    selectUser(user) {
        const previous = this._store.getState();
        if (previous.active?.id === user?.id && previous.detailsLoading) return;
        const alreadyLoaded = previous.detailsForUserId === user?.id && previous.details && !previous.detailsLoading;
        if (previous.active?.id !== user?.id) this._detailsVersion++;
        this._store.setActive(user);
        this._bus.emit(Events.USER_SELECTED, user);
        if (user?.id && !alreadyLoaded) return this._loadDetails(user.id);
    }

    reloadDetails() {
        const {active, detailsLoading} = this._store.getState();
        if (active && !detailsLoading) return this._loadDetails(active.id);
    }

    async _loadDetails(userId) {
        const version = ++this._detailsVersion;
        this._store.setDetailsLoading(userId);
        const {start, end} = this._defaultTrainingsRange();
        const keys = ['goal', 'recentTrainings', 'weightHistory', 'deviceTokens'];
        const normalizers = [
            UserDetailsEntity.normalizeGoal,
            UserDetailsEntity.normalizeTrainings,
            UserDetailsEntity.normalizeWeightHistory,
            UserDetailsEntity.normalizeDeviceTokens,
        ];
        const requests = [
            () => this._repo.fetchGoal(userId),
            () => this._repo.fetchTrainings(userId, {start, end}),
            () => this._repo.fetchWeightHistory(userId),
            () => this._repo.fetchDeviceTokens(userId),
        ];
        const isCurrent = () => version === this._detailsVersion && this._store.getState().active?.id === userId;
        await Promise.all(requests.map(async (request, index) => {
            const key = keys[index];
            try {
                const raw = await Promise.resolve().then(request);
                if (!isCurrent()) return;
                UserDetailsEntity.validateResponse(key, raw);
                this._store.setDetailSection(userId, key, {value: normalizers[index](raw)});
            } catch (error) {
                if (!isCurrent()) return;
                const message = key === 'deviceTokens' && error?.status === 404
                    ? 'Device token data is unavailable on this API (404). The number of registered devices could not be determined.'
                    : error?.message || 'Please try again.';
                this._store.setDetailSection(userId, key, {error: message});
            }
        }));
        if (version !== this._detailsVersion || this._store.getState().active?.id !== userId) return;

        const {details} = this._store.getState();
        this._bus.emit(Events.USER_DETAILS_LOADED, {userId, details});
    }

    /** Default range for the admin trainings query: last 60 days. */
    _defaultTrainingsRange() {
        const now = new Date();
        const start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        return {start: start.toISOString(), end: now.toISOString()};
    }

    async changeRole(role) {
        const {active, roleChangeInFlight, deleteInFlight} = this._store.getState();
        if (!active || active.role === role || roleChangeInFlight || deleteInFlight || typeof role !== 'string') return;
        const session = this._sessionVersion;
        this._store.setRoleChangeInFlight(true);
        try {
            const updated = await this._repo.setRole(active.id, role);
            if (session !== this._sessionVersion) return;
            this._loadVersion++;
            this._store.setLoading(false);
            const current = this._store.getState().users.find(user => user.id === active.id) || active;
            // Role responses omit aggregate metadata and serialize its defaults (0/null).
            // A role change does not change activity; retain the latest list aggregates.
            const merged = {...current.raw, ...(updated && typeof updated === 'object' ? updated : {}), id: active.id, role};
            for (const field of ['workoutsCount', 'lastActivity']) {
                if (Object.hasOwn(current.raw, field)) merged[field] = current.raw[field];
                else delete merged[field];
            }
            // Keep display aggregates while retaining absent/malformed raw evidence for diagnostics.
            const normalized = {...UserEntity.normalize(merged), workoutsCount: current.workoutsCount, lastActivity: current.lastActivity};
            this._store.updateUser(normalized);
            this._bus.emit(Events.USER_ROLE_CHANGED, normalized);
            Toast.show({title: `Role changed to ${role}`, message: active.email || active.name || active.id});
        } catch (error) {
            if (session === this._sessionVersion) Toast.show({title: 'Role change failed', message: error.message, type: 'error'});
        } finally {
            if (session === this._sessionVersion) this._store.setRoleChangeInFlight(false);
        }
    }

    async deleteActiveUser() {
        const {active, deleteInFlight, roleChangeInFlight} = this._store.getState();
        if (!active || deleteInFlight || roleChangeInFlight || this._deleteConfirming) return;
        const session = this._sessionVersion;
        this._deleteConfirming = true;
        let confirmed;
        try {
            confirmed = await this._confirm.ask({
                title: 'Delete user',
                message: `Delete ${active.email || active.name || active.id}?`,
                detail: 'Their account will be permanently deleted. This action cannot be undone.',
                actionLabel: 'Delete user',
            });
        } finally {
            this._deleteConfirming = false;
        }
        if (!confirmed || session !== this._sessionVersion) return;
        this._store.setDeleteInFlight(true, active.id);
        try {
            await this._repo.delete(active.id);
            if (session !== this._sessionVersion) return;
            this._loadVersion++;
            this._store.setLoading(false);
            this._store.removeUser(active.id);
            this._bus.emit(Events.USER_DELETED, {id: active.id});
            Toast.show({title: 'User deleted', message: active.email || active.name || active.id});
        } catch (error) {
            if (session === this._sessionVersion) Toast.show({title: 'Delete failed', message: error.message, type: 'error'});
        } finally {
            if (session === this._sessionVersion) this._store.setDeleteInFlight(false);
        }
    }
}
