import { ENDPOINTS } from '../../infrastructure/http/endpoints.js';

export class UserRepository {
  /** @param {import('../../infrastructure/http/ApiClient.js').ApiClient} client */
  constructor(client) {
    this._client = client;
  }

  async fetchCurrentUser() {
    const resp = await this._client._fetch(ENDPOINTS.currentUser, {
      headers: this._client.buildHeaders()
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async fetchAll() {
    const resp = await this._client._fetch(ENDPOINTS.users, {
      headers: this._client.buildHeaders()
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async setRole(id, role) {
    const resp = await this._client._fetch(ENDPOINTS.userRole(id), {
      method: 'PUT',
      headers: this._client.buildHeaders({ json: true }),
      body: JSON.stringify({ role })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.json();
  }

  async delete(id) {
    const resp = await this._client._fetch(ENDPOINTS.userDelete(id), {
      method: 'DELETE',
      headers: this._client.buildHeaders()
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.text().catch(() => null);
  }

  async makeAdmin(email) {
    const resp = await this._client._fetch(ENDPOINTS.makeAdmin, {
      method: 'POST',
      headers: this._client.buildHeaders({ json: true }),
      body: JSON.stringify({ email })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.json();
  }
}
