import { DEFAULT_LANGUAGE, ENDPOINTS } from './constants.js';

export class ApiClient {
  constructor({ storage, getLocale }) {
    this.storage = storage;
    this.getLocale = getLocale;
    this.authToken = storage?.getToken() || '';
  }

  setAuthToken(token) {
    this.authToken = token || '';
    this.storage?.setToken(this.authToken);
  }

  clearAuthToken() {
    this.authToken = '';
    this.storage?.clearToken();
  }

  bearer() {
    return this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {};
  }

  buildHeaders({ json = false, auth = true, accept = true, locale } = {}) {
    const headers = {};
    if (accept) headers.accept = 'application/json';
    headers['accept-language'] = locale || this.getLocale?.() || 'en';
    if (json) headers['content-type'] = 'application/json';
    if (auth) Object.assign(headers, this.bearer());
    return headers;
  }

  async fetchList() {
    const resp = await fetch(ENDPOINTS.list, {
      headers: this.buildHeaders({ locale: DEFAULT_LANGUAGE })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async fetchDetail(id, locale) {
    const resp = await fetch(ENDPOINTS.detail(id), {
      headers: this.buildHeaders({ locale })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async createExercise(payload) {
    const resp = await fetch(ENDPOINTS.create, {
      method: 'POST',
      headers: this.buildHeaders({ json: true }),
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.json();
  }

  async updateExercise(id, payload) {
    const resp = await fetch(ENDPOINTS.update(id), {
      method: 'PUT',
      headers: this.buildHeaders({ json: true }),
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.json().catch(() => null);
  }

  async deleteExercise(id) {
    const resp = await fetch(ENDPOINTS.remove(id), {
      method: 'DELETE',
      headers: this.buildHeaders({ json: false })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.text().catch(() => null);
  }

  async fetchEquipments() {
    const resp = await fetch(ENDPOINTS.equipmentGroups, {
      headers: this.buildHeaders({ auth: false })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async fetchMuscles() {
    const resp = await fetch(ENDPOINTS.muscleGroups, {
      headers: this.buildHeaders({ auth: false })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async fetchCurrentUser() {
    const resp = await fetch(ENDPOINTS.currentUser, {
      headers: this.buildHeaders()
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async login(credentials) {
    const resp = await fetch(ENDPOINTS.login, {
      method: 'POST',
      headers: this.buildHeaders({ json: true, auth: false }),
      body: JSON.stringify(credentials)
    });
    if (!resp.ok) throw new Error('Invalid credentials');
    return resp.json();
  }

  async fetchUsers() {
    const resp = await fetch(ENDPOINTS.users, {
      headers: this.buildHeaders({ json: false })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  async makeAdmin(email) {
    const resp = await fetch(ENDPOINTS.makeAdmin, {
      method: 'POST',
      headers: this.buildHeaders({ json: true }),
      body: JSON.stringify({ email })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.json();
  }

  async setUserRole(id, role) {
    const resp = await fetch(ENDPOINTS.userRole(id), {
      method: 'PUT',
      headers: this.buildHeaders({ json: true }),
      body: JSON.stringify({ role })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.json();
  }

  async deleteUser(id) {
    const resp = await fetch(ENDPOINTS.userDelete(id), {
      method: 'DELETE',
      headers: this.buildHeaders({ json: false })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`);
    }
    return resp.text().catch(() => null);
  }
}
