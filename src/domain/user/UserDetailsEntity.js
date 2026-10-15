import {safeString, toTimestamp} from '../../shared/utils/index.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = field => { throw new Error(`The server returned an invalid user detail response (${field}). Please retry.`); };
const rows = (value, field) => {
    if (!Array.isArray(value) || value.some(row => !object(row))) invalid(field);
    return value;
};
const numericFields = (row, fields, path) => {
    for (const field of fields) if (row[field] !== undefined && row[field] !== null && UserDetailsEntity._number(row[field]) === null) invalid(`${path}.${field}`);
};

/** Normalize independent user-detail endpoint responses at the boundary. */
export class UserDetailsEntity {
    /** Validate transport rows before tolerant normalizers can discard invalid data. */
    static validateResponse(section, raw) {
        if (section === 'goal') {
            if (raw !== null && !object(raw)) invalid('goal');
            if (raw) {
                numericFields(raw, ['confidence'], 'goal');
                if (raw.target != null && !['string', 'number'].includes(typeof raw.target) && !(raw.target instanceof Date)) invalid('goal.target');
                if (raw.personalizations !== undefined && (!Array.isArray(raw.personalizations) || raw.personalizations.some(value => typeof value !== 'string'))) invalid('goal.personalizations');
            }
            return;
        }
        for (const [index, row] of rows(raw, section).entries()) {
            const path = `${section}[${index}]`;
            if (row.id !== undefined && (typeof row.id !== 'string' || !row.id.trim())) invalid(`${path}.id`);
            if (section === 'weightHistory') {
                const weight = UserDetailsEntity._number(row.weight);
                if (weight === null || weight <= 0) invalid(`${path}.weight`);
            } else if (section === 'deviceTokens') {
                if (typeof row.token !== 'string' || !row.token.trim()) invalid(`${path}.token`);
            } else if (section === 'recentTrainings') {
                numericFields(row, ['duration', 'volume', 'repetitions'], path);
                if (row.exercises === undefined) continue;
                for (const [exerciseIndex, exercise] of rows(row.exercises, `${path}.exercises`).entries()) {
                    const exercisePath = `${path}.exercises[${exerciseIndex}]`;
                    if (exercise.iterations === undefined) continue;
                    for (const iteration of rows(exercise.iterations, `${exercisePath}.iterations`)) {
                        numericFields(iteration, ['externalWeight', 'bodyWeight', 'extraWeight', 'assistWeight', 'bodyMultiplier', 'repetitions'], `${exercisePath}.iterations`);
                    }
                }
            }
        }
    }

    static normalizeGoal(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const confidence = UserDetailsEntity._number(raw.confidence);
        return {
            primaryGoal: safeString(raw.primaryGoal),
            secondaryGoal: safeString(raw.secondaryGoal),
            target: raw.target || null,
            personalizations: Array.isArray(raw.personalizations)
                ? raw.personalizations.filter(tag => typeof tag === 'string' && tag.trim()) : [],
            confidence: confidence === null ? null : Math.max(0, Math.min(1, confidence)),
            createdAt: raw.createdAt || '',
            updatedAt: raw.updatedAt || '',
            lastConfirmedAt: raw.lastConfirmedAt || null,
        };
    }

    static normalizeTrainings(raw) {
        return UserDetailsEntity._objects(raw)
            .map(UserDetailsEntity._normalizeTraining)
            .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
    }

    static normalizeWeightHistory(raw) {
        return UserDetailsEntity._objects(raw)
            .map(weight => ({
                id: safeString(weight.id),
                weight: UserDetailsEntity._number(weight.weight),
                createdAt: weight.createdAt ?? '',
            }))
            .filter(entry => entry.weight !== null && entry.weight > 0)
            .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
    }

    static normalizeDeviceTokens(raw) {
        return UserDetailsEntity._objects(raw)
            .map(token => ({
                id: safeString(token.id),
                token: typeof token.token === 'string' ? token.token : '',
                createdAt: token.createdAt || '',
            }))
            .filter(token => token.token)
            .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
    }

    static _normalizeTraining(training) {
        const exercises = UserDetailsEntity._objects(training.exercises);
        return {
            id: safeString(training.id),
            createdAt: training.createdAt || '',
            duration: UserDetailsEntity._number(training.duration),
            volume: UserDetailsEntity._number(training.volume),
            repetitions: UserDetailsEntity._number(training.repetitions),
            exercisesCount: exercises.length,
            exercises: exercises.map(UserDetailsEntity._normalizeExercise),
        };
    }

    static _normalizeExercise(exercise) {
        return {
            id: safeString(exercise.id),
            name: safeString(exercise.exerciseExample?.name || exercise.name) || 'Unnamed exercise',
            iterations: UserDetailsEntity._objects(exercise.iterations).map(UserDetailsEntity._normalizeIteration),
        };
    }

    static _normalizeIteration(iteration) {
        return {
            id: safeString(iteration.id),
            externalWeight: UserDetailsEntity._number(iteration.externalWeight),
            bodyWeight: UserDetailsEntity._number(iteration.bodyWeight),
            extraWeight: UserDetailsEntity._number(iteration.extraWeight),
            assistWeight: UserDetailsEntity._number(iteration.assistWeight),
            bodyMultiplier: UserDetailsEntity._number(iteration.bodyMultiplier),
            repetitions: UserDetailsEntity._number(iteration.repetitions),
        };
    }

    static _objects(raw) {
        return Array.isArray(raw) ? raw.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
    }

    static _number(value) {
        if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }
}
