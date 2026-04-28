import {ENDPOINTS} from '../../infrastructure/http/index.js';
import {DEFAULT_LANGUAGE} from '../../shared/constants/index.js';

export class ExerciseRepository {
    /** @param {import('../../infrastructure/http/ApiClient.js').ApiClient} client */
    constructor(client) {
        this._client = client;
    }

    async fetchList() {
        const resp = await this._client._fetch(ENDPOINTS.exerciseList, {
            headers: this._client.buildHeaders({locale: DEFAULT_LANGUAGE})
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
        return resp.json();
    }

    async update(id, payload) {
        const resp = await this._client._fetch(ENDPOINTS.exerciseUpdate(id), {
            method: 'PUT',
            headers: this._client.buildHeaders({json: true}),
            body: JSON.stringify(payload)
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
        }
        // Some backends respond 204 / empty body on PUT — синтезируем минимальный ответ,
        // чтобы вызывающий код мог надёжно обновить локальный кэш.
        const fallback = {id, entity: {...payload, id}};
        return resp.json().catch(() => fallback);
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
