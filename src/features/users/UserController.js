import {Events} from '../../infrastructure/events/events.js';
import {UserDetailsEntity, UserEntity} from '../../domain/user/index.js';
import {Toast} from '../../shared/components/Toast.js';

export class UserController {
    /**
     * @param {{
     *   store: UserStore,
     *   listView: UserListView,
     *   detailView: UserDetailView,
     *   repository: UserRepository,
     *   bus: EventBus,
     *   confirmDialog: ConfirmDialog
     * }} deps
     */
    constructor({store, listView, detailView, repository, bus, confirmDialog}) {
        this._store = store;
        this._repo = repository;
        this._bus = bus;
        this._confirm = confirmDialog;

        bus.on(Events.AUTH_LOGIN_SUCCESS, () => this.loadUsers());
        bus.on(Events.AUTH_LOGOUT, () => store.setUsers([]));
        bus.on(Events.AUTH_SESSION_EXPIRED, () => store.setUsers([]));
    }

    async loadUsers() {
        this._store.setLoading(true);
        try {
            const raw = await this._repo.fetchAll();
            const users = (Array.isArray(raw) ? raw : []).map(UserEntity.normalize);
            this._store.setUsers(users);
            this._bus.emit(Events.USER_LIST_LOADED, users);
        } catch (err) {
            Toast.show({title: 'Failed to load users', message: err.message, type: 'error'});
        } finally {
            this._store.setLoading(false);
        }
    }

    selectUser(user) {
        this._store.setActive(user);
        this._bus.emit(Events.USER_SELECTED, user);
        if (user?.id) this._loadDetails(user.id);
    }

    async _loadDetails(userId) {
        this._store.setDetailsLoading(userId);
        const {start, end} = this._defaultTrainingsRange();

        const [goalRes, trainingsRes, weightsRes] = await Promise.allSettled([
            this._repo.fetchGoal(userId),
            this._repo.fetchTrainings(userId, {start, end}),
            this._repo.fetchWeightHistory(userId),
        ]);

        // If user switched while we were loading, drop the result silently.
        if (this._store.getState().active?.id !== userId) return;

        const details = {
            goal: goalRes.status === 'fulfilled'
                ? UserDetailsEntity.normalizeGoal(goalRes.value)
                : null,
            recentTrainings: trainingsRes.status === 'fulfilled'
                ? UserDetailsEntity.normalizeTrainings(trainingsRes.value)
                : [],
            weightHistory: weightsRes.status === 'fulfilled'
                ? UserDetailsEntity.normalizeWeightHistory(weightsRes.value)
                : [],
        };

        const failed = [goalRes, trainingsRes, weightsRes].find(r => r.status === 'rejected');
        if (failed) {
            Toast.show({
                title: 'Failed to load some user details',
                message: failed.reason?.message || 'Unknown error',
                type: 'error',
            });
        }

        this._store.setDetails(userId, details);
        this._bus.emit(Events.USER_DETAILS_LOADED, {userId, details});
    }

    /** Default range for the admin trainings query: last 60 days. */
    _defaultTrainingsRange() {
        const now = new Date();
        const start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        return {start: start.toISOString(), end: now.toISOString()};
    }

    async changeRole(role) {
        const {active} = this._store.getState();
        if (!active) return;
        if (active.role === role) return; // уже эта роль — нечего менять
        this._store.setRoleChangeInFlight(true);
        try {
            const updated = await this._repo.setRole(active.id, role);
            // Если бэкенд ответил пустым телом / странной формой — мерджим локально с новой ролью,
            // чтобы UI не оказался с пустыми полями юзера.
            const merged = (updated && typeof updated === 'object')
                ? {...active.raw, ...updated, id: active.id, role}
                : {...active.raw, id: active.id, role};
            const normalized = UserEntity.normalize(merged);
            this._store.updateUser(normalized);
            this._bus.emit(Events.USER_ROLE_CHANGED, normalized);
            Toast.show({title: `Role changed to ${role}`});
        } catch (err) {
            Toast.show({title: 'Role change failed', message: err.message, type: 'error'});
        } finally {
            this._store.setRoleChangeInFlight(false);
        }
    }

    async deleteActiveUser() {
        const {active} = this._store.getState();
        if (!active) return;

        const ok = await this._confirm.ask({
            title: 'Delete user',
            message: `Delete ${active.email || active.id}?`,
            detail: 'This action cannot be undone.',
            actionLabel: 'Delete'
        });
        if (!ok) return;

        try {
            await this._repo.delete(active.id);
            this._store.removeUser(active.id);
            this._bus.emit(Events.USER_DELETED, {id: active.id});
            Toast.show({title: 'User deleted'});
        } catch (err) {
            Toast.show({title: 'Delete failed', message: err.message, type: 'error'});
        }
    }
}
