const AUTH_TYPE_RANK = {apple: 0, google: 1, email: 2};

export class UserEntity {

    /** Normalize raw API response to a canonical user shape. */
    static normalize(raw = {}) {
        return {
            id: raw.id ? String(raw.id) : '',
            email: raw.email || '',
            role: raw.role || 'user',
            profileId: raw.profile?.id || raw.profileId || '',
            workoutsCount: Number(raw.workoutsCount ?? raw.profile?.workoutsCount ?? 0),
            createdAt: raw.createdAt || raw.created_at || '',
            lastActivity: raw.lastActivity || raw.last_activity || '',
            authTypes: UserEntity.normalizeAuthTypes(raw.authTypes || raw.auth_types),
            raw,  // keep original for display purposes
        };
    }

    /** Parse authTypes array from various API shapes. */
    static normalizeAuthTypes(authTypes = []) {
        if (!Array.isArray(authTypes)) return [];
        return authTypes
            .map(t => (typeof t === 'string' ? t : t?.type || t?.provider || ''))
            .filter(Boolean)
            .map(t => t.toLowerCase());
    }

    static getAuthTypes(user) {
        return user?.authTypes ?? [];
    }

    static createdAt(user) {
        const raw = user?.createdAt || user?.created_at || '';
        return raw ? new Date(raw).getTime() : 0;
    }

    static lastActivityAt(user) {
        const raw = user?.lastActivity || user?.last_activity || '';
        return raw ? new Date(raw).getTime() : 0;
    }

    static workoutsCount(user) {
        return Number(user?.workoutsCount ?? 0);
    }

    static authRank(user) {
        const types = UserEntity.getAuthTypes(user);
        if (!types.length) return 99;
        return Math.min(...types.map(t => AUTH_TYPE_RANK[t] ?? 10));
    }

    /**
     * Returns a comparator function for the given sort key.
     * Compatible with Array.sort(comparator).
     *
     * @param {'createdAt'|'lastActivity'|'workoutsCount'|'authType'|'email'} key
     * @returns {(a: object, b: object) => number}
     */
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
