import {USER_ROLES} from '../../shared/constants/index.js';
import {runDiagnosticRules} from '../diagnostics/index.js';

const PROFILE_REVIEW_AGE_MS = 24 * 60 * 60 * 1000;
const rawUser = user => user?.raw && typeof user.raw === 'object' ? user.raw : user || {};
const idText = value => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Missing data is not evidence that a user has no profile. */
export function userProfileState(user) {
    const raw = rawUser(user);
    if (idText(raw.profileId) || (raw.profile && typeof raw.profile === 'object' && !Array.isArray(raw.profile))) return 'present';
    return Object.hasOwn(raw, 'profile') && raw.profile === null ? 'missing' : 'unknown';
}

function registrationDate(user) {
    const raw = rawUser(user);
    const value = raw.createdAt ?? raw.created_at;
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

function checkTime(context) {
    const value = context.now instanceof Date ? context.now.getTime() : context.now;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export const USER_DIAGNOSTIC_RULES = Object.freeze([
    {
        id: 'user.profile-missing-after-24h', severity: 'warning', title: 'Registration needs review',
        evaluate(user, context) {
            const profile = userProfileState(user);
            if (profile === 'unknown') return null;
            if (profile === 'present') return [];
            const {timestamp} = registrationDate(user);
            const now = checkTime(context);
            if (timestamp === null || now === null || timestamp > now) return null;
            return now - timestamp > PROFILE_REVIEW_AGE_MS
                ? [{field: 'profile', message: 'This account was created more than 24 hours ago and the API reports no profile. Review the registration record.'}] : [];
        },
    },
    {
        id: 'user.workouts-without-profile', severity: 'error', title: 'Workout and profile data disagree',
        evaluate(user) {
            const profile = userProfileState(user);
            if (profile === 'unknown') return null;
            if (profile === 'present') return [];
            const value = rawUser(user).workoutsCount;
            if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
            const count = Number(value);
            if (!Number.isSafeInteger(count) || count < 0) return null;
            return count > 0 ? [{field: 'profile', message: 'The API reports recorded workouts and no profile for the same account. Review the account data.'}] : [];
        },
    },
    {
        id: 'user.registration-date-invalid', severity: 'warning', title: 'Registration date cannot be read',
        evaluate(user) {
            const date = registrationDate(user);
            if (!date.known) return null;
            return date.timestamp === null
                ? [{field: 'createdAt', message: 'The API returned an unreadable registration date. Account age could not be checked; review the registration record.'}] : [];
        },
    },
    {
        id: 'user.registration-date-future', severity: 'warning', title: 'Registration date is in the future',
        evaluate(user, context) {
            const {timestamp} = registrationDate(user);
            const now = checkTime(context);
            if (timestamp === null || now === null) return null;
            return timestamp > now
                ? [{field: 'createdAt', message: 'The registration date is later than the check time. Account age could not be assessed; review the registration date.'}] : [];
        },
    },
    {
        id: 'user.role-unknown', severity: 'warning', title: 'Unrecognized account role',
        evaluate(user) {
            const raw = rawUser(user);
            if (!Object.hasOwn(raw, 'role') || raw.role === null || raw.role === undefined) return null;
            if (USER_ROLES.includes(raw.role)) return [];
            return [{field: 'role', message: typeof raw.role === 'string'
                ? `The API returned an unrecognized role: ${raw.role || '(empty)'}. Review the account access data.`
                : 'The API returned an unsupported role format. Review the account access data.'}];
        },
    },
    {
        id: 'user.profile-id-mismatch', severity: 'warning', title: 'Profile references disagree',
        evaluate(user) {
            const raw = rawUser(user);
            const outer = idText(raw.profileId);
            const nested = idText(raw.profile?.id);
            if (raw.profile === null && outer) {
                return [{field: 'profileId', message: 'The API supplied a profile ID while reporting a null profile. Review the profile references.'}];
            }
            if (nested && Object.hasOwn(raw, 'profileId') && raw.profileId === null) {
                return [{field: 'profileId', message: 'The API supplied a nested profile while reporting a null profile ID. Review the profile references.'}];
            }
            if (userProfileState(user) === 'missing') return [];
            if ((nested && !Object.hasOwn(raw, 'profileId')) || (outer && !Object.hasOwn(raw, 'profile'))) return [];
            if (!outer || !nested) return null;
            return outer !== nested
                ? [{field: 'profileId', message: 'The profile ID and the nested profile ID do not match. Review the profile references.'}] : [];
        },
    },
].map(rule => Object.freeze(rule)));

export class UserDiagnostics {
    static evaluate(user, {now = Date.now()} = {}) {
        return runDiagnosticRules(USER_DIAGNOSTIC_RULES, user, {now});
    }
}
