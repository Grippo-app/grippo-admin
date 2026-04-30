const API_BASE = 'https://grippo-app.com';

export const ENDPOINTS = Object.freeze({
    // Public
    login: `${API_BASE}/auth/login`,
    refresh: `${API_BASE}/auth/refresh`,
    equipmentGroups: `${API_BASE}/equipments`,
    muscleGroups: `${API_BASE}/muscles`,

    // Exercise examples
    exerciseList: `${API_BASE}/exercise-examples`,
    exerciseDetail: (id) => `${API_BASE}/exercise-examples/${encodeURIComponent(id)}`,
    exerciseCreate: `${API_BASE}/admin/exercise-examples`,
    exerciseUpdate: (id) => `${API_BASE}/admin/exercise-examples?id=${encodeURIComponent(id)}`,
    exerciseDelete: (id) => `${API_BASE}/admin/exercise-examples/${encodeURIComponent(id)}`,

    // Users
    currentUser: `${API_BASE}/users`,
    users: `${API_BASE}/admin/users`,
    userRole: (id) => `${API_BASE}/admin/users/${encodeURIComponent(id)}/role`,
    userDelete: (id) => `${API_BASE}/admin/users/${encodeURIComponent(id)}`,
    userGoal: (id) => `${API_BASE}/admin/users/${encodeURIComponent(id)}/goal`,
    userTrainings: (id, start, end) => `${API_BASE}/admin/users/${encodeURIComponent(id)}/trainings?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    userWeightHistory: (id) => `${API_BASE}/admin/users/${encodeURIComponent(id)}/weight-history`,
    makeAdmin: `${API_BASE}/admin/users/make-admin`,
});
