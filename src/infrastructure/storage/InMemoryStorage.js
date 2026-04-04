import {DEFAULT_LANGUAGE} from '../../shared/constants/index.js';

/**
 * In-memory implementation of IStorage.
 * Drop-in replacement for StorageManager in tests or SSR.
 */
export class InMemoryStorage {
    constructor() {
        this._locale = DEFAULT_LANGUAGE;
        this._viewMode = 'form';
        this._userId = '';
        this._profileId = '';
        this._refreshToken = '';
        this._editedSet = new Set();
    }

    getLocale() {
        return this._locale;
    }

    setLocale(v) {
        this._locale = v;
    }

    getViewMode() {
        return this._viewMode;
    }

    setViewMode(v) {
        this._viewMode = v;
    }

    getUserId() {
        return this._userId;
    }

    setUserId(v) {
        this._userId = v || '';
    }

    getProfileId() {
        return this._profileId;
    }

    setProfileId(v) {
        this._profileId = v || '';
    }

    clearUserInfo() {
        this._userId = '';
        this._profileId = '';
    }

    loadUserInfo() {
        return {id: this._userId, profileId: this._profileId};
    }

    getRefreshToken() {
        return this._refreshToken;
    }

    setRefreshToken(v) {
        this._refreshToken = v || '';
    }

    clearRefreshToken() {
        this._refreshToken = '';
    }

    loadEditedSet() {
        return new Set(this._editedSet);
    }

    persistEditedSet(set) {
        this._editedSet = new Set(set || []);
    }
}
