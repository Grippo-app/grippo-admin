import {ENDPOINTS} from '../../infrastructure/http/index.js';
import {DEFAULT_LANGUAGE} from '../../shared/constants/index.js';

export class ExerciseRepository {
    /** @param {import('../../infrastructure/http/ApiClient.js').ApiClient} client */
    constructor(client) {
        this._client = client;
    }

    async fetchList(locale = DEFAULT_LANGUAGE) {
        const resp = await this._client._fetch(ENDPOINTS.exerciseList, {
            headers: this._client.buildHeaders({locale})
        });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        return resp.json();
    }

    async fetchDetail(id, locale) {
        const resp = await this._client._fetch(ENDPOINTS.exerciseDetail(id), {
            headers: this._client.buildHeaders({locale})
        });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        return resp.json();
    }

    async fetchTranslations(id) {
        const resp = await this._client._fetch(ENDPOINTS.exerciseTranslations(id), {
            headers: this._client.buildHeaders()
        });
        if (!resp.ok) {
            const error = new Error(`Raw translations could not load: ${resp.status} ${resp.statusText}`);
            error.status = resp.status;
            throw error;
        }
        try { return await resp.json(); }
        catch { throw new Error('The server returned unreadable raw translations. Retry loading this exercise.'); }
    }

    async create(payload) {
        const resp = await this._client._fetch(ENDPOINTS.exerciseCreate, {
            method: 'POST',
            headers: this._client.buildHeaders({json: true}),
            body: JSON.stringify(payload)
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
        }
        const saved = await resp.json().catch(() => null);
        const id = saved?.entity?.id || saved?.id;
        if (typeof id !== 'string' || !id.trim()) {
            const error = new Error('The server accepted the new exercise but did not return its ID. Refresh the library and select the created record before saving again.');
            error.code = 'CREATE_ID_MISSING';
            throw error;
        }
        return saved;
    }

    async update(id, payload) {
        const resp = await this._client._fetch(ENDPOINTS.exerciseUpdate(id), {
            method: 'PUT',
            headers: this._client.buildHeaders({json: true}),
            body: JSON.stringify(payload)
        });
        if (!resp.ok) {
            const error = new Error(`Exercise update failed: ${resp.status} ${resp.statusText}`);
            error.status = resp.status;
            if (resp.status === 409) {
                const body = await resp.json().catch(() => null);
                if (['EXERCISE_TRANSLATIONS_STALE', 'EXERCISE_TRANSLATIONS_INCOMPLETE'].includes(body?.code)) {
                    error.code = body.code;
                }
            }
            throw error;
        }
        // An empty PUT response acknowledges identity only; rows and revision require a raw read.
        return resp.json().catch(() => ({id}));
    }

    async delete(id) {
        const resp = await this._client._fetch(ENDPOINTS.exerciseDelete(id), {
            method: 'DELETE',
            headers: this._client.buildHeaders()
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
        }
        return resp.text().catch(() => null);
    }

    async fetchEquipments() {
        const resp = await this._client._fetch(ENDPOINTS.equipmentGroups, {
            headers: this._client.buildHeaders({auth: false})
        });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        return resp.json();
    }

    async fetchMuscles() {
        const resp = await this._client._fetch(ENDPOINTS.muscleGroups, {
            headers: this._client.buildHeaders({auth: false})
        });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        return resp.json();
    }
}
