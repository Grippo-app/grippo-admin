export const Events = Object.freeze({
    // Auth
    AUTH_LOGIN_SUCCESS: 'auth:login-success',    // payload: { accessToken, refreshToken, user }
    AUTH_LOGOUT: 'auth:logout',            // payload: void
    AUTH_SESSION_EXPIRED: 'auth:session-expired',  // payload: void

    // Exercises
    EXERCISE_LIST_LOADED: 'exercise:list-loaded',    // payload: Exercise[]
    EXERCISE_SELECTED: 'exercise:selected',       // payload: Exercise | null
    EXERCISE_SAVED: 'exercise:saved',           // payload: Exercise
    EXERCISE_DELETED: 'exercise:deleted',         // payload: { id: string }
    EXERCISE_LOCALE_CHANGED: 'exercise:locale-changed', // payload: { locale: string }

    // Users
    USER_LIST_LOADED: 'user:list-loaded',   // payload: User[]
    USER_SELECTED: 'user:selected',      // payload: User | null
    USER_ROLE_CHANGED: 'user:role-changed',  // payload: User (updated)
    USER_DELETED: 'user:deleted',       // payload: { id: string }

    // Navigation
    NAV_SECTION_CHANGED: 'nav:section-changed', // payload: { section: 'exercise' | 'users' }

    // Dictionaries
    DICTS_LOADED: 'dicts:loaded',   // payload: { equipments, muscles }
});
