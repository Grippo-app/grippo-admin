import {readUserTimestamp, readUserWorkoutCount, userProfileEvidence} from './userEvidence.js';

export const USER_FILTER_DEFAULTS = Object.freeze({profile: 'all', workouts: 'all', createdAt: 'all', lastActivity: 'all'});
const DATE_FILTER_VALUES = Object.freeze(['all', 'last7d', 'last30d', 'older30d', 'unknown']);
export const USER_FILTER_VALUES = Object.freeze({
    profile: Object.freeze(['all', 'present', 'missing', 'unknown']),
    workouts: Object.freeze(['all', 'with', 'without', 'unknown']),
    createdAt: DATE_FILTER_VALUES,
    lastActivity: DATE_FILTER_VALUES,
});
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeUserFilters(filters = {}) {
    return Object.fromEntries(Object.entries(USER_FILTER_VALUES).map(([key, values]) =>
        [key, values.includes(filters?.[key]) ? filters[key] : USER_FILTER_DEFAULTS[key]]));
}

export function userProfileFilterState(user) {
    const {state, conflict} = userProfileEvidence(user);
    return conflict ? 'unknown' : state;
}

export function userWorkoutsFilterState(user) {
    const count = readUserWorkoutCount(user);
    return count === null ? 'unknown' : count > 0 ? 'with' : 'without';
}

function matchesDateFilter(user, field, value, now) {
    if (value === 'all') return true;
    const {timestamp} = readUserTimestamp(user, field);
    const unknown = timestamp === null || !Number.isFinite(now) || timestamp > now;
    if (value === 'unknown') return unknown;
    if (unknown) return false;
    if (value === 'older30d') return timestamp < now - 30 * DAY_MS;
    return timestamp >= now - (value === 'last7d' ? 7 : 30) * DAY_MS;
}

/** Pure predicates over the loaded list: every active filter intersects, with one supplied clock snapshot. */
export function matchesUserFilters(user, filters = USER_FILTER_DEFAULTS, {now = Date.now()} = {}) {
    const options = normalizeUserFilters(filters);
    const timestamp = now instanceof Date ? now.getTime() : now;
    return (options.profile === 'all' || options.profile === userProfileFilterState(user))
        && (options.workouts === 'all' || options.workouts === userWorkoutsFilterState(user))
        && matchesDateFilter(user, 'createdAt', options.createdAt, timestamp)
        && matchesDateFilter(user, 'lastActivity', options.lastActivity, timestamp);
}
