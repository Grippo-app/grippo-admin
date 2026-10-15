import {safeString, toTimestamp} from '../../shared/utils/index.js';

const AUTH_TYPE_RANK = {apple: 0, google: 1, email: 2};
const workoutCount = value => {
    if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return 0;
    const count = Number(value);
    return Number.isFinite(count) ? Math.max(0, count) : 0;
};

export class UserEntity {
    /** A malformed refresh must not replace a valid library with silently discarded rows. */
    static validateList(raw) {
        const ids = new Set();
        if (!Array.isArray(raw) || raw.some(row => {
            if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)) return true;
            ids.add(row.id);
            return false;
        })) throw new Error('The server returned an invalid users list. Please retry.');
    }

    /** Normalize raw API response to a canonical user shape. */
    static normalize(raw = {}) {
        if (!raw || typeof raw !== 'object') raw = {};
        const workoutsCount = workoutCount(raw.workoutsCount ?? raw.profile?.workoutsCount);
        return {
            id: safeString(raw.id),
            email: safeString(raw.email),
            name: safeString(raw.name || raw.profile?.name || raw.displayName),
            role: safeString(raw.role || 'default'),
            profileId: safeString(raw.profile?.id ?? raw.profileId),
            workoutsCount,
            createdAt: raw.createdAt || raw.created_at || '',
            updatedAt: raw.updatedAt || raw.updated_at || '',
            lastActivity: raw.lastActivity || raw.last_activity || '',
            authTypes: UserEntity.normalizeAuthTypes(raw.authTypes || raw.auth_types),
            raw,
        };
    }

    static updatedAt(user) {
        return toTimestamp(user?.updatedAt || user?.updated_at);
    }

    /** Parse and deduplicate provider names without trusting API value types. */
    static normalizeAuthTypes(authTypes = []) {
        if (!Array.isArray(authTypes)) return [];
        return [...new Set(authTypes
            .map(type => typeof type === 'string' ? type : type?.type || type?.provider)
            .filter(type => typeof type === 'string' && type.trim())
            .map(type => type.trim().toLowerCase()))];
    }

    static getAuthTypes(user) {
        return user?.authTypes ?? [];
    }

    static createdAt(user) {
        return toTimestamp(user?.createdAt || user?.created_at);
    }

    static lastActivityAt(user) {
        return toTimestamp(user?.lastActivity || user?.last_activity);
    }

    static workoutsCount(user) {
        return workoutCount(user?.workoutsCount);
    }

    static authRank(user) {
        const types = UserEntity.getAuthTypes(user);
        if (!types.length) return 99;
        return Math.min(...types.map(type => AUTH_TYPE_RANK[type] ?? 10));
    }

    /** Returns a comparator for the given sort key. */
    static comparator(key) {
        switch (key) {
            case 'createdAt':
                return (a, b) => UserEntity.createdAt(b) - UserEntity.createdAt(a);
            case 'lastActivity':
                return (a, b) => UserEntity.lastActivityAt(b) - UserEntity.lastActivityAt(a);
            case 'workoutsCount':
                return (a, b) => UserEntity.workoutsCount(b) - UserEntity.workoutsCount(a);
            case 'authType':
                return (a, b) => UserEntity.authRank(a) - UserEntity.authRank(b);
            case 'email':
                return (a, b) => (a.email || '').localeCompare(b.email || '');
            default:
                return () => 0;
        }
    }
}
