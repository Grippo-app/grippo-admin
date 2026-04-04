import { STORAGE_KEYS, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from '../../shared/constants/index.js';

/**
 * IStorage interface (implicit — JS duck typing):
 *
 *   getLocale()          → string
 *   setLocale(locale)    → void
 *   getViewMode()        → string
 *   setViewMode(mode)    → void
 *   getUserId()          → string
 *   setUserId(id)        → void
 *   getProfileId()       → string
 *   setProfileId(id)     → void
 *   clearUserInfo()      → void
 *   loadUserInfo()       → { id: string, profileId: string }
 *   getRefreshToken()    → string
 *   setRefreshToken(t)   → void
 *   clearRefreshToken()  → void
 *   loadEditedSet()      → Set<string>
 *   persistEditedSet(s)  → void
 */

/**
 * StorageManager — handles non-sensitive preferences and the refresh token.
 *
 * - Access token → held in memory only (see ApiClient). Never persisted.
 * - Refresh token → stored in localStorage under STORAGE_KEYS.refreshToken so
 *   that sessions survive page reloads. The backend's /auth/refresh endpoint
 *   accepts the token in the request body (no HttpOnly cookie mechanism).
 */
export class StorageManager {
  constructor({ local = window.localStorage, session = window.sessionStorage } = {}) {
    this.local = local;
    this.session = session;

    // ── One-time migration: wipe legacy token keys left by previous versions ──
    this._purge('grippo_admin_token');
    this._purge('grippo_admin_refresh');
  }

  /* ── Locale ── */

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

  /* ── View mode ── */

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

  /* ── User info (non-sensitive IDs for UI) ── */

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

  /* ── Refresh token ── */

  getRefreshToken() {
    try {
      return this.local.getItem(STORAGE_KEYS.refreshToken) || '';
    } catch {
      return '';
    }
  }

  setRefreshToken(token) {
    try {
      this.local.setItem(STORAGE_KEYS.refreshToken, token || '');
    } catch {
      /* ignore */
    }
  }

  clearRefreshToken() {
    try {
      this.local.removeItem(STORAGE_KEYS.refreshToken);
    } catch {
      /* ignore */
    }
  }

  /* ── Edited-IDs session set ── */

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

  /* ── Helpers ── */

  /** Remove a key from both storages (used for migration cleanup). */
  _purge(key) {
    try { this.local.removeItem(key); } catch { /* ignore */ }
    try { this.session.removeItem(key); } catch { /* ignore */ }
  }
}
