/** Short-lived access token TTL (ms). Used to schedule silent refresh. */
export const ACCESS_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const SUPPORTED_LANGUAGES = ['en', 'ua', 'ru'];
export const DEFAULT_LANGUAGE = 'en';

export const FIELD = {
    equipmentRefs: 'equipmentRefs',
    bundles: 'exerciseExampleBundles',
    muscleId: 'muscleId',
    percentage: 'percentage'
};

export const STORAGE_KEYS = {
    locale: 'grippo_admin_locale',
    viewMode: 'grippo_view_mode',
    edited: 'grippo_edited_ids',
    userId: 'grippo_admin_user_id',
    profileId: 'grippo_admin_profile_id',
    /** Persisted refresh token (v2 key — v1 key was purged by migration). */
    refreshToken: 'grippo_admin_refresh_v2'
};

export const USER_ROLES = Object.freeze(['user', 'admin', 'moderator']);
