export const API_BASE = 'https://grippo-app.com';

export const ENDPOINTS = {
  list: `${API_BASE}/exercise-examples`,
  detail: (id) => `${API_BASE}/exercise-examples/${encodeURIComponent(id)}`,
  create: `${API_BASE}/admin/exercise-examples`,
  update: (id) => `${API_BASE}/admin/exercise-examples?id=${encodeURIComponent(id)}`,
  remove: (id) => `${API_BASE}/admin/exercise-examples/${encodeURIComponent(id)}`,
  login: `${API_BASE}/auth/login`,
  refresh: `${API_BASE}/auth/refresh`,
  currentUser: `${API_BASE}/users`,
  equipmentGroups: `${API_BASE}/equipments`,
  muscleGroups: `${API_BASE}/muscles`,

  users: `${API_BASE}/admin/users`,
  userRole: (id) => `${API_BASE}/admin/users/${encodeURIComponent(id)}/role`,
  userDelete: (id) => `${API_BASE}/admin/users/${encodeURIComponent(id)}`,
  makeAdmin: `${API_BASE}/admin/users/make-admin`
};

export const FIELD = {
  equipmentRefs: 'equipmentRefs',
  bundles: 'exerciseExampleBundles',
  muscleId: 'muscleId',
  percentage: 'percentage'
};

export const SUPPORTED_LANGUAGES = ['en', 'ua', 'ru'];
export const DEFAULT_LANGUAGE = 'en';

export const STORAGE_KEYS = {
  locale: 'grippo_admin_locale',
  viewMode: 'grippo_view_mode',
  edited: 'grippo_edited_ids',
  userId: 'grippo_admin_user_id',
  profileId: 'grippo_admin_profile_id',
  /** Persisted refresh token (v2 key — v1 key was purged by migration). */
  refreshToken: 'grippo_admin_refresh_v2'
};

/** Short-lived access token TTL (ms). Used to schedule silent refresh. */
export const ACCESS_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
