import { STORAGE_KEYS, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from './constants.js';

export class StorageManager {
  constructor({ local = window.localStorage, session = window.sessionStorage } = {}) {
    this.local = local;
    this.session = session;
  }

  getLocale() {
    try {
      const stored = this.local.getItem(STORAGE_KEYS.locale);
      return stored && SUPPORTED_LANGUAGES.includes(stored) ? stored : DEFAULT_LANGUAGE;
    } catch {
      return DEFAULT_LANGUAGE;
    }
  }

  setLocale(locale) {
    if (!SUPPORTED_LANGUAGES.includes(locale)) return;
    try {
      this.local.setItem(STORAGE_KEYS.locale, locale);
    } catch {
      /* ignore */
    }
  }

  getViewMode() {
    try {
      return this.local.getItem(STORAGE_KEYS.viewMode) || 'form';
    } catch {
      return 'form';
    }
  }

  setViewMode(mode) {
    try {
      this.local.setItem(STORAGE_KEYS.viewMode, mode);
    } catch {
      /* ignore */
    }
  }

  getToken() {
    try {
      return this.local.getItem(STORAGE_KEYS.token) || '';
    } catch {
      return '';
    }
  }

  setToken(token) {
    try {
      this.local.setItem(STORAGE_KEYS.token, token || '');
    } catch {
      /* ignore */
    }
  }

  clearToken() {
    this.setToken('');
    try {
      this.local.removeItem(STORAGE_KEYS.refresh);
    } catch {
      /* ignore */
    }
  }

  getUserId() {
    try {
      return this.local.getItem(STORAGE_KEYS.userId) || '';
    } catch {
      return '';
    }
  }

  setUserId(id) {
    try {
      this.local.setItem(STORAGE_KEYS.userId, id || '');
    } catch {
      /* ignore */
    }
  }

  getProfileId() {
    try {
      return this.local.getItem(STORAGE_KEYS.profileId) || '';
    } catch {
      return '';
    }
  }

  setProfileId(id) {
    try {
      this.local.setItem(STORAGE_KEYS.profileId, id || '');
    } catch {
      /* ignore */
    }
  }

  clearUserInfo() {
    this.setUserId('');
    this.setProfileId('');
  }

  loadUserInfo() {
    return {
      id: this.getUserId(),
      profileId: this.getProfileId()
    };
  }

  setRefreshToken(token) {
    try {
      this.local.setItem(STORAGE_KEYS.refresh, token || '');
    } catch {
      /* ignore */
    }
  }

  loadEditedSet() {
    try {
      const raw = this.session.getItem(STORAGE_KEYS.edited) || '[]';
      const parsed = JSON.parse(raw);
      const values = Array.isArray(parsed) ? parsed : [];
      return new Set(values.map(String));
    } catch {
      return new Set();
    }
  }

  persistEditedSet(set) {
    try {
      const payload = JSON.stringify(Array.from(set || []));
      this.session.setItem(STORAGE_KEYS.edited, payload);
    } catch {
      /* ignore */
    }
  }
}
