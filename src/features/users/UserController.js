import {Events} from '../../infrastructure/events/events.js';
import {UserEntity} from '../../domain/user/index.js';
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
    }

    async changeRole(role) {
        const {active} = this._store.getState();
        if (!active) return;
        this._store.setRoleChangeInFlight(true);
        try {
            const updated = await this._repo.setRole(active.id, role);
            const normalized = UserEntity.normalize(updated);
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
