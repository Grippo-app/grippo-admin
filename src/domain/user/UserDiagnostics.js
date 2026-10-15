import {USER_ROLES} from '../../shared/constants/index.js';
import {runDiagnosticRules} from '../diagnostics/index.js';
import {parseUserTimestamp, parseUserWorkoutCount, rawUser, userProfileEvidence, userProfileState} from './userEvidence.js';
export {userProfileState};

const PROFILE_REVIEW_AGE_MS = 24 * 60 * 60 * 1000;

function registrationDate(user) {
    const raw = rawUser(user);
    // Retain the diagnostic's legacy alias fallback; filters intentionally use field presence instead.
    return parseUserTimestamp(raw.createdAt ?? raw.created_at);
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
            const count = parseUserWorkoutCount(rawUser(user).workoutsCount);
            if (count === null) return null;
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
            const {outerId: outer, nestedId: nested, conflict} = userProfileEvidence(user);
            if (conflict === 'null-profile') {
                return [{field: 'profileId', message: 'The API supplied a profile ID while reporting a null profile. Review the profile references.'}];
            }
            if (conflict === 'null-profile-id') {
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
