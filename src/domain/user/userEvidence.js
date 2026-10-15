const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const idText = value => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Read evidence from the transport record, before display fallbacks have been applied. */
export const rawUser = user => user?.raw && typeof user.raw === 'object' ? user.raw : user || {};

export function userProfileEvidence(user) {
    const raw = rawUser(user);
    const outerId = idText(raw.profileId);
    const nestedId = idText(raw.profile?.id);
    const state = outerId || object(raw.profile) ? 'present'
        : Object.hasOwn(raw, 'profile') && raw.profile === null ? 'missing' : 'unknown';
    const conflict = raw.profile === null && outerId ? 'null-profile'
        : nestedId && Object.hasOwn(raw, 'profileId') && raw.profileId === null ? 'null-profile-id'
            : outerId && nestedId && outerId !== nestedId ? 'different-ids' : null;
    return {state, conflict, outerId, nestedId};
}

/** Preserves the existing diagnostic meaning: an API profile object or ID is reported presence. */
export function userProfileState(user) { return userProfileEvidence(user).state; }

export function parseUserWorkoutCount(value) {
    if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function readUserWorkoutCount(user) {
    const raw = rawUser(user);
    return Object.hasOwn(raw, 'workoutsCount') ? parseUserWorkoutCount(raw.workoutsCount) : null;
}

/** Strict timezone-bearing ISO dates and finite epoch/Date inputs; invalid evidence is never epoch zero. */
export function parseUserTimestamp(value) {
    if (value === undefined || value === null || value === '') return {known: false, timestamp: null};
    if (!(typeof value === 'string' || typeof value === 'number' || value instanceof Date)) return {known: true, timestamp: null};
    if (typeof value === 'string') {
        const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):?(\d{2}))$/.exec(value);
        if (!iso) return {known: true, timestamp: null};
        const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = iso.map(part => Number(part ?? 0));
        const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const maxDay = month === 2 ? (leapYear ? 29 : 28) : ([4, 6, 9, 11].includes(month) ? 30 : 31);
        if (month < 1 || month > 12 || day < 1 || day > maxDay || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return {known: true, timestamp: null};
    }
    const timestamp = new Date(value).getTime();
    return {known: true, timestamp: Number.isFinite(timestamp) ? timestamp : null};
}

/** Explicit null/invalid camelCase evidence must not be replaced by a legacy alias. */
export function readUserTimestamp(user, field) {
    const alias = {createdAt: 'created_at', lastActivity: 'last_activity'}[field];
    if (!alias) throw new TypeError('Unsupported user timestamp field.');
    const raw = rawUser(user);
    return parseUserTimestamp(Object.hasOwn(raw, field) ? raw[field] : raw[alias]);
}
