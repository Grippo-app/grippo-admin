// Local QA fixture: all API calls stay inside this document. No production data.
const source = await (await fetch('/index.html')).text();
const template = new DOMParser().parseFromString(source, 'text/html');
template.querySelectorAll('script').forEach(script => script.remove());
document.body.replaceChildren(...template.body.childNodes);
const banner = document.createElement('div');
banner.className = 'fixture-banner';
banner.textContent = 'LOCAL PREVIEW · Synthetic data · API requests mocked';
document.body.prepend(banner);

class MemoryStorage {
    constructor() { this.values = new Map([['grippo_admin_refresh_v2', 'fixture-refresh']]); }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}
Object.defineProperty(window, 'localStorage', {value: new MemoryStorage()});
Object.defineProperty(window, 'sessionStorage', {value: new MemoryStorage()});
const ago = days => new Date(Date.now() - days * 86_400_000).toISOString();
let exercises = [
    ['bench', 'Bench press', 'Жим лежачи', 'compound', 'beginner', 'free', 'push'],
    ['squat', 'Barbell squat', 'Присідання зі штангою', 'compound', 'intermediate', 'free', 'push'],
    ['pullup', 'Pull-up', 'Підтягування', 'compound', 'advanced', 'body_weight', 'pull'],
    ['curl', 'Dumbbell curl', 'Згинання рук з гантелями', 'isolation', 'beginner', 'free', 'pull'],
    ['deadlift', 'Romanian deadlift', 'Румунська тяга', 'compound', 'intermediate', 'free', 'hinge'],
    ['fly', 'Cable fly', 'Зведення рук у кросовері', 'isolation', 'beginner', 'fixed', 'push'],
].map(([id, name, ua, category, experience, weightType, forceType], index) => ({
    id, name, nameTranslations: {en: name, ua, ru: ''},
    description: 'A controlled movement focused on strength and consistent technique.',
    descriptionTranslations: {en: 'A controlled movement focused on strength and consistent technique.', ua: 'Контрольований рух для розвитку сили та правильної техніки.', ru: ''},
    category, experience, weightType, forceType, createdAt: ago(index * 9), imageUrl: '',
    components: {externalWeight: weightType === 'body_weight' ? null : {required: true}, bodyWeight: weightType === 'body_weight' ? {required: true, multiplier: 1} : null, extraWeight: null, assistWeight: null},
    equipmentRefs: [{equipmentId: 'barbell'}],
    exerciseExampleBundles: [{muscleId: 'chest', percentage: 70}, {muscleId: 'triceps', percentage: 30}],
}));
// Persisted malformed data must be visible before editor normalization can sanitize it.
exercises.find(exercise => exercise.id === 'fly').exerciseExampleBundles = [{muscleId: 'chest', percentage: 75}, {muscleId: 'triceps'}];
exercises.find(exercise => exercise.id === 'squat').exerciseExampleBundles = [{muscleId: 'quads', percentage: 80}, {muscleId: 'glutes', percentage: 10}];
let users = [
    {id: 'user-alex', email: 'alex.morgan@example.test', profile: {id: 'profile-alex', name: 'Alex Morgan'}, role: 'default', workoutsCount: 84, createdAt: ago(180), updatedAt: ago(1), lastActivity: ago(0.1), authTypes: ['apple', 'email']},
    {id: 'user-sam', email: 'sam.taylor@example.test', profile: {id: 'profile-sam', name: 'Sam Taylor'}, role: 'admin', workoutsCount: 32, createdAt: ago(120), updatedAt: ago(3), lastActivity: ago(2), authTypes: ['google']},
    {id: 'user-olena', email: 'olena@example.test', profile: {id: 'profile-olena', name: 'Олена Коваль'}, role: 'default', workoutsCount: 56, createdAt: ago(90), updatedAt: ago(0), lastActivity: ago(0), authTypes: ['email']},
    {id: 'user-new', email: 'new.member@example.test', profile: null, role: 'default', workoutsCount: 0, createdAt: ago(2), updatedAt: ago(2), authTypes: ['email']},
    {id: 'user-recent', email: 'recent.member@example.test', profile: null, role: 'default', workoutsCount: 0, createdAt: ago(0.1), updatedAt: ago(0.1), authTypes: ['email']},
    {id: 'user-unknown', email: 'unknown.profile@example.test', role: 'default', workoutsCount: 0, createdAt: ago(20), updatedAt: ago(20), authTypes: ['email']},
];
const trainings = Array.from({length: 16}, (_, index) => ({id: `training-${index}`, createdAt: ago(index * 3), duration: 45 + index, volume: 3500 + index * 85, repetitions: 64 + index, exercises: [
    {id: 'bench', exerciseExample: {name: 'Bench press'}, iterations: [{externalWeight: 60, repetitions: 10}, {externalWeight: 65, repetitions: 8}, {externalWeight: 65, repetitions: 8}]},
    {id: 'pullup', exerciseExample: {name: 'Pull-up'}, iterations: [{bodyWeight: 78, bodyMultiplier: 1, extraWeight: 5, repetitions: 8}]},
]}));
const weights = Array.from({length: 24}, (_, index) => ({id: `weight-${index}`, weight: +(77.4 + index * 0.12 + Math.sin(index) * 0.4).toFixed(1), createdAt: ago(index * 4)}));
const rawSnapshots = new Map(exercises.map(entity => [entity.id, {
    id: entity.id, base: {name: entity.name, description: entity.description},
    translations: ['en', 'ua'].map(language => ({language, name: entity.nameTranslations[language], description: entity.descriptionTranslations[language]})),
}]));
// Offline QA cases: confirmed English only, legacy base only, and an older deployed API.
rawSnapshots.get('curl').translations = rawSnapshots.get('curl').translations.filter(row => row.language === 'en');
rawSnapshots.get('bench').translations = [];
banner.title = 'Raw translation examples: Dumbbell curl = English only; Bench press = legacy base only; Cable fly = compatibility 404.';
let failedGoal = false;
const response = value => Response.json(value);
window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== 'https://grippo-app.com') throw new Error('Fixture preview blocks external requests.');
    await new Promise(resolve => setTimeout(resolve, 140));
    const path = url.pathname;
    const method = options.method || 'GET';
    const payload = options.body ? JSON.parse(options.body) : null;
    const localized = entity => {
        if (!entity) return null;
        const locale = new Headers(options.headers).get('accept-language') || 'en';
        const snapshot = rawSnapshots.get(entity.id);
        const direct = snapshot?.translations.find(row => row.language === locale);
        const english = snapshot?.translations.find(row => row.language === 'en');
        const selected = direct ?? english;
        const {nameTranslations, descriptionTranslations, ...fields} = entity;
        return {...fields, name: snapshot ? (selected?.name ?? snapshot.base.name) : entity.name,
            description: snapshot ? (selected?.description ?? snapshot.base.description) : entity.description};
    };
    if (path === '/auth/refresh' || path === '/auth/login') return response({accessToken: 'fixture-access', refreshToken: 'fixture-refresh'});
    if (path === '/users') return response(users[0]);
    if (path === '/equipments') return response([{id: 'weights', name: 'Free weights', equipments: [{id: 'barbell', name: 'Barbell'}, {id: 'dumbbell', name: 'Dumbbells'}, {id: 'bench', name: 'Flat bench'}, {id: 'pullup-bar', name: 'Pull-up bar'}]}]);
    if (path === '/muscles') return response([{id: 'upper', name: 'Upper body', muscles: [{id: 'chest', name: 'Chest'}, {id: 'triceps', name: 'Triceps'}, {id: 'back', name: 'Back'}, {id: 'biceps', name: 'Biceps'}, {id: 'quads', name: 'Quadriceps'}, {id: 'glutes', name: 'Glutes'}]}]);
    if (path === '/exercise-examples') return response(exercises.map((entity, i) => ({id: `wrapper-${entity.id}`, entity: localized(entity), usageCount: 10 + i * 13})));
    if (path.startsWith('/exercise-examples/')) return response({entity: localized(exercises.find(exercise => exercise.id === path.split('/').pop()))});
    const rawTranslationRoute = path.match(/^\/admin\/exercise-examples\/([^/]+)\/translations$/);
    if (rawTranslationRoute && method === 'GET') {
        const id = decodeURIComponent(rawTranslationRoute[1]);
        return id !== 'fly' && rawSnapshots.has(id) ? response(rawSnapshots.get(id)) : new Response(null, {status: 404, statusText: 'Raw translation route unavailable'});
    }
    if (path === '/admin/exercise-examples' && method !== 'GET') {
        const id = url.searchParams.get('id') || payload.id || `exercise-${Date.now()}`;
        const nameTranslations = Object.fromEntries(payload.name.map(entry => [entry.language, entry.value || '']));
        const descriptionTranslations = Object.fromEntries(payload.description.map(entry => [entry.language, entry.value || '']));
        const entity = {...payload, id, name: nameTranslations.en, description: descriptionTranslations.en, nameTranslations, descriptionTranslations};
        exercises = exercises.filter(exercise => exercise.id !== id).concat(entity);
        rawSnapshots.set(id, {id, base: {name: entity.name, description: entity.description},
            translations: ['en', 'ua', 'ru'].map(language => ({language, name: nameTranslations[language] || null, description: descriptionTranslations[language] || null}))
                .filter(row => row.name !== null || row.description !== null)});
        return response({entity});
    }
    if (path.startsWith('/admin/exercise-examples/') && method === 'DELETE') {
        exercises = exercises.filter(exercise => exercise.id !== path.split('/').pop());
        return new Response(null, {status: 204});
    }
    if (path === '/admin/users') return response(users);
    if (path.startsWith('/admin/users/')) {
        const [, , , id, resource] = path.split('/');
        if (method === 'DELETE') { users = users.filter(user => user.id !== id); return new Response(null, {status: 204}); }
        if (resource === 'role') { const user = users.find(user => user.id === id); user.role = payload.role; return response(user); }
        if (id === 'user-new') return response(resource === 'goal' ? null : []);
        if (resource === 'goal') {
            if (id === 'user-sam' && !failedGoal) { failedGoal = true; return new Response(null, {status: 503, statusText: 'Service unavailable'}); }
            return response({primaryGoal: 'build_muscle', secondaryGoal: 'improve_strength', personalizations: ['three_days_per_week', 'gym_access'], confidence: 0.87, updatedAt: ago(4), lastConfirmedAt: ago(3)});
        }
        if (resource === 'trainings') return response(trainings);
        if (resource === 'weight-history') return response(weights);
        if (resource === 'device-tokens') return response([{id: 'device-1', token: 'fixture-device-token-alex-iphone-0000000000', createdAt: ago(5)}]);
    }
    return new Response(null, {status: 404, statusText: 'Fixture not found'});
};
await import('../src/main.js');
