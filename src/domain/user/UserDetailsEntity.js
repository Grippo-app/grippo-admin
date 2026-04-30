/**
 * Normalize raw API responses for the user-detail panel.
 * Three independent endpoints, each maps to a single static method.
 */
export class UserDetailsEntity {
    static normalizeGoal(raw) {
        if (!raw) return null;
        return {
            primaryGoal: raw.primaryGoal || '',
            secondaryGoal: raw.secondaryGoal || null,
            target: raw.target || null,
            personalizations: Array.isArray(raw.personalizations) ? raw.personalizations : [],
            confidence: Number(raw.confidence ?? 0),
            createdAt: raw.createdAt || '',
            updatedAt: raw.updatedAt || '',
            lastConfirmedAt: raw.lastConfirmedAt || null,
        };
    }

    static normalizeTrainings(raw) {
        if (!Array.isArray(raw)) return [];
        return raw
            .map(UserDetailsEntity._normalizeTraining)
            // Backend sorts ASC; UI shows recent first.
            .sort((a, b) => UserDetailsEntity._ts(b.createdAt) - UserDetailsEntity._ts(a.createdAt));
    }

    static normalizeWeightHistory(raw) {
        if (!Array.isArray(raw)) return [];
        return raw.map(UserDetailsEntity._normalizeWeight);
    }

    static _normalizeTraining(training = {}) {
        const exercises = Array.isArray(training.exercises) ? training.exercises : [];
        return {
            id: training.id || '',
            createdAt: training.createdAt || '',
            duration: training.duration ?? null,
            volume: training.volume ?? null,
            repetitions: training.repetitions ?? null,
            exercisesCount: exercises.length,
            exercises: exercises.map(UserDetailsEntity._normalizeExercise),
        };
    }

    static _normalizeExercise(exercise = {}) {
        const iterations = Array.isArray(exercise.iterations) ? exercise.iterations : [];
        return {
            id: exercise.id || '',
            // After i18n on the backend, exerciseExample.name is the localized name.
            name: exercise.exerciseExample?.name || exercise.name || '—',
            iterations: iterations.map(UserDetailsEntity._normalizeIteration),
        };
    }

    static _normalizeIteration(iteration = {}) {
        return {
            id: iteration.id || '',
            externalWeight: iteration.externalWeight ?? null,
            bodyWeight: iteration.bodyWeight ?? null,
            extraWeight: iteration.extraWeight ?? null,
            assistWeight: iteration.assistWeight ?? null,
            bodyMultiplier: iteration.bodyMultiplier ?? null,
            repetitions: iteration.repetitions ?? null,
        };
    }

    static _normalizeWeight(weight = {}) {
        return {
            id: weight.id || '',
            weight: Number(weight.weight ?? 0),
            createdAt: weight.createdAt || '',
        };
    }

    static _ts(value) {
        if (!value) return 0;
        const t = new Date(value).getTime();
        return Number.isFinite(t) ? t : 0;
    }
}
