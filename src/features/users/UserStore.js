import {UserEntity} from '../../domain/user/index.js';

export class UserStore {
    constructor() {
        this._state = {
            users: [],
            filtered: [],
            active: null,
            searchQuery: '',
            sortKey: 'createdAt',
            isLoading: false,
            roleChangeInFlight: false,
            details: null,
            detailsForUserId: null,
            detailsLoading: false,
            expandedTrainingId: null,
        };
        this._observers = new Set();
    }

    subscribe(fn) {
        this._observers.add(fn);
        return () => this._observers.delete(fn);
    }

    getState() {
        return {...this._state};
    }

    setUsers(users) {
        this._update({users, filtered: this._applyFilter(users, this._state.searchQuery)});
    }

    setActive(user) {
        // Re-selecting the same user (or refreshing the user object after a role
        // change) must NOT wipe the loaded details. Only a real change of identity
        // resets goal/workouts/weight state.
        const isSameUser = user && this._state.active?.id === user.id;
        if (isSameUser) {
            this._update({active: user});
            return;
        }
        this._update({
            active: user,
            details: null,
            detailsForUserId: null,
            detailsLoading: false,
            expandedTrainingId: null,
        });
    }

    clearActive() {
        this._update({
            active: null,
            details: null,
            detailsForUserId: null,
            detailsLoading: false,
            expandedTrainingId: null,
        });
    }

    setDetailsLoading(userId) {
        this._update({
            detailsForUserId: userId,
            detailsLoading: true,
        });
    }

    setDetails(userId, details) {
        if (this._state.active?.id !== userId) return;
        this._update({
            details,
            detailsForUserId: userId,
            detailsLoading: false,
        });
    }

    toggleExpandedTraining(trainingId) {
        const next = this._state.expandedTrainingId === trainingId ? null : trainingId;
        this._update({expandedTrainingId: next});
    }

    setSearchQuery(q) {
        this._update({searchQuery: q, filtered: this._applyFilter(this._state.users, q)});
    }

    setSortKey(key) {
        this._update({sortKey: key, filtered: this._sortItems([...this._state.filtered], key)});
    }

    setLoading(v) {
        this._update({isLoading: v});
    }

    setRoleChangeInFlight(v) {
        this._update({roleChangeInFlight: v});
    }

    updateUser(user) {
        const users = this._state.users.map(u => u.id === user.id ? user : u);
        this.setUsers(users);
        if (this._state.active?.id === user.id) this.setActive(user);
    }

    removeUser(id) {
        const users = this._state.users.filter(u => u.id !== id);
        this.setUsers(users);
        if (this._state.active?.id === id) this.clearActive();
    }

    _update(patch) {
        this._state = {...this._state, ...patch};
        for (const fn of this._observers) {
            try {
                fn(this._state);
            } catch (e) {
                console.error('[UserStore]', e);
            }
        }
    }

    _applyFilter(users, query) {
        if (!query) return this._sortItems([...users], this._state.sortKey);
        const q = query.toLowerCase();
        const filtered = users.filter(u =>
            (u.email || '').toLowerCase().includes(q) ||
            String(u.id || '').includes(q)
        );
        return this._sortItems(filtered, this._state.sortKey);
    }

    _sortItems(users, key) {
        return [...users].sort(UserEntity.comparator(key));
    }
}
