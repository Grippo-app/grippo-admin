export const API_BASE = 'https://grippo-app.com';

export const ENDPOINTS = {
  list: `${API_BASE}/exercise-examples`,
  detail: (id) => `${API_BASE}/exercise-examples/${encodeURIComponent(id)}`,
  create: `${API_BASE}/exercise-examples`,
  update: (id) => `${API_BASE}/exercise-examples?id=${encodeURIComponent(id)}`,
  login: `${API_BASE}/auth/login`,
  equipmentGroups: `${API_BASE}/equipments`,
  muscleGroups: `${API_BASE}/muscles`
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
  token: 'grippo_admin_token',
  refresh: 'grippo_admin_refresh',
  edited: 'grippo_edited_ids'
};
