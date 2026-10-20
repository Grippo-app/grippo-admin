// Local QA fixture: all API calls stay inside this document. No production data.
const source = await (await fetch('/index.html')).text();
const template = new DOMParser().parseFromString(source, 'text/html');
template.querySelectorAll('script').forEach(script => script.remove());
document.body.replaceChildren(...template.body.childNodes);
const banner = document.createElement('div');
banner.className = 'fixture-banner';
banner.textContent = 'LOCAL PREVIEW · Synthetic data · API requests mocked';
document.body.prepend(banner);
// Optional controlled latency makes loading, refresh and partial completion inspectable.
const previewParams = new URL(location.href).searchParams;
const previewDelay = (key, fallback) => {
    const value = Number(previewParams.get(key));
    return previewParams.has(key) && Number.isFinite(value) ? Math.max(0, Math.min(value, 15000)) : fallback;
};
const latency = previewDelay('latency', 140);
const deviceLatency = previewDelay('deviceLatency', latency);
const mutationLatency = previewDelay('mutationLatency', latency);
let exerciseFailurePending = previewParams.get('failExercise');
const fixtureLanguages = ['en', 'ua', 'ru', 'pt-BR', 'pt-PT'];
let translationConflictPending = previewParams.get('conflict');
let failedSavePending = previewParams.get('failSave') === '1';
let postSaveRawFailurePending = previewParams.get('postSaveRawFailure') === '1';
let failedRawReloadId = null;
const exerciseRequests = [];
// Mock counters stand in for opaque server tokens; this fixture never hashes client text.
let revisionCounter = 0;
const nextRevision = () => (++revisionCounter).toString(16).padStart(64, '0');
const copy = value => JSON.parse(JSON.stringify(value));

class MemoryStorage {
    constructor() {
        this.values = new Map([['grippo_admin_refresh_v2', 'fixture-refresh']]);
        const locale = previewParams.get('locale');
        if (fixtureLanguages.includes(locale)) this.values.set('grippo_admin_locale', locale);
    }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}
Object.defineProperty(window, 'localStorage', {value: new MemoryStorage()});
Object.defineProperty(window, 'sessionStorage', {value: new MemoryStorage()});
const ago = days => new Date(Date.now() - days * 86_400_000).toISOString();
let exercises = [
    ['bench', 'Bench press', 'Жим лежачи', 'Жим лёжа', 'Supino reto', 'Supino plano', 'compound', 'beginner', 'free', 'push'],
    ['squat', 'Barbell squat', 'Присідання зі штангою', 'Приседания со штангой', 'Agachamento com barra', 'Agachamento com barra', 'compound', 'intermediate', 'free', 'push'],
    ['pullup', 'Pull-up', 'Підтягування', 'Подтягивания', 'Barra fixa', 'Elevação na barra', 'compound', 'advanced', 'body_weight', 'pull'],
    ['curl', 'Dumbbell curl', 'Згинання рук з гантелями', 'Сгибание рук с гантелями', 'Rosca com halteres', 'Flexão de braços com halteres', 'isolation', 'beginner', 'free', 'pull'],
    ['deadlift', 'Romanian deadlift', 'Румунська тяга', 'Румынская тяга', 'Levantamento terra romeno', 'Peso morto romeno', 'compound', 'intermediate', 'free', 'hinge'],
    ['fly', 'Cable fly', 'Зведення рук у кросовері', 'Сведение рук в кроссовере', 'Crucifixo no cabo', 'Aberturas no cabo', 'isolation', 'beginner', 'fixed', 'push'],
].map(([id, name, ua, ru, br, pt, category, experience, weightType, forceType], index) => ({
    id, name, nameTranslations: {en: name, ua, ru, 'pt-BR': br, 'pt-PT': pt},
    description: 'A controlled movement focused on strength and consistent technique.',
    descriptionTranslations: {en: 'A controlled movement focused on strength and consistent technique.', ua: 'Контрольований рух для розвитку сили та правильної техніки.', ru: 'Контролируемое движение для развития силы и правильной техники.',
        'pt-BR': 'Movimento controlado para desenvolver força e manter a técnica.', 'pt-PT': 'Movimento controlado para desenvolver força e manter uma técnica consistente.'},
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
    {id: 'user-unknown', email: 'unknown.profile@example.test', role: 'default', createdAt: ago(20), updatedAt: ago(20), authTypes: ['email']},
];
const trainings = Array.from({length: 16}, (_, index) => ({id: `training-${index}`, createdAt: ago(index * 3), duration: 45 + index, volume: 3500 + index * 85, repetitions: 64 + index, exercises: [
    {id: 'bench', exerciseExample: {name: 'Bench press'}, iterations: [{externalWeight: 60, repetitions: 10}, {externalWeight: 65, repetitions: 8}, {externalWeight: 65, repetitions: 8}]},
    {id: 'pullup', exerciseExample: {name: 'Pull-up'}, iterations: [{bodyWeight: 78, bodyMultiplier: 1, extraWeight: 5, repetitions: 8}]},
]}));
const weightScenarios = {
    two: [{weight: 80, createdAt: ago(30)}, {weight: 80.1, createdAt: ago(1)}],
    single: [{weight: 80, createdAt: ago(1)}],
    flat: [{weight: 80, createdAt: ago(30)}, {weight: 80, createdAt: ago(1)}],
    'same-time': [{weight: 80, createdAt: '2026-10-01T09:00:00Z'}, {weight: 82, createdAt: '2026-10-01T09:00:00Z'}],
    undated: [{weight: 50}, {weight: 80, createdAt: '2026-10-01'}, {weight: 90, createdAt: '2026-10-03'}],
    intraday: [{weight: 80, createdAt: '2026-10-01T09:00:05.100Z'}, {weight: 81, createdAt: '2026-10-01T09:00:05.200Z'}],
};
const weights = weightScenarios[previewParams.get('weightScenario')]
    || Array.from({length: 24}, (_, index) => ({id: `weight-${index}`, weight: +(77.4 + index * 0.12 + Math.sin(index) * 0.4).toFixed(1), createdAt: ago(index * 4)}));
const rawSnapshots = new Map(exercises.map(entity => [entity.id, {
    id: entity.id, translationsRevision: nextRevision(), base: {name: entity.name, description: entity.description},
    translations: fixtureLanguages.map(language => ({language, name: entity.nameTranslations[language], description: entity.descriptionTranslations[language]})),
}]));
// Offline QA cases: confirmed English only, legacy base only, and an older deployed API.
rawSnapshots.get('curl').translations = rawSnapshots.get('curl').translations.filter(row => row.language === 'en');
rawSnapshots.get('bench').translations = [];
if (previewParams.get('translations') === 'beforeImport') {
    for (const snapshot of rawSnapshots.values()) snapshot.translations = snapshot.translations.filter(row => !row.language.startsWith('pt-'));
}
if (previewParams.get('translations') === 'partial') {
    rawSnapshots.get('pullup').translations.find(row => row.language === 'pt-BR').name = null;
    rawSnapshots.get('pullup').translations.find(row => row.language === 'pt-PT').description = null;
}
banner.title = 'Raw translation examples: Pull-up = all five languages; Dumbbell curl = English only; Bench press = legacy base only; Cable fly = compatibility 404.';
let failedGoal = false;
const response = value => Response.json(value);
const saveError = (status, code, message) => Response.json({code, message}, {status});
Object.defineProperty(window, '__exercisePreview', {value: Object.freeze({
    get requests() { return copy(exerciseRequests); },
    get snapshots() { return copy(Object.fromEntries(rawSnapshots)); },
})});
window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== 'https://grippo-app.com') throw new Error('Fixture preview blocks external requests.');
    const authRequest = ['/auth/login', '/auth/refresh', '/users'].includes(url.pathname);
    const requestDelay = authRequest ? 140 : ['POST', 'PUT', 'DELETE'].includes(options.method) ? mutationLatency
        : url.pathname.endsWith('/device-tokens') ? deviceLatency : latency;
    await new Promise(resolve => setTimeout(resolve, requestDelay));
    const path = url.pathname;
    const method = options.method || 'GET';
    const payload = options.body ? JSON.parse(options.body) : null;
    if (path.includes('exercise-examples')) exerciseRequests.push({method, path: `${path}${url.search}`, payload: copy(payload)});
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
    if (path.startsWith('/exercise-examples/')) {
        const id = path.split('/').pop();
        if (exerciseFailurePending === id) {
            exerciseFailurePending = null;
            return new Response(null, {status: 503, statusText: 'Fixture exercise temporarily unavailable'});
        }
        return response({entity: localized(exercises.find(exercise => exercise.id === id))});
    }
    const rawTranslationRoute = path.match(/^\/admin\/exercise-examples\/([^/]+)\/translations$/);
    if (rawTranslationRoute && method === 'GET') {
        const id = decodeURIComponent(rawTranslationRoute[1]);
        if (previewParams.get('raw404') === '1' || previewParams.get('translations') === 'raw404' || id === 'fly' || !rawSnapshots.has(id)) {
            return new Response(null, {status: 404, statusText: 'Raw translation route unavailable'});
        }
        if (failedRawReloadId === id) {
            failedRawReloadId = null;
            return new Response(null, {status: 503, statusText: 'Fixture saved snapshot temporarily unavailable'});
        }
        const snapshot = copy(rawSnapshots.get(id));
        if (previewParams.get('translations') === 'legacy') delete snapshot.translationsRevision;
        return response(snapshot);
    }
    if (path === '/admin/exercise-examples' && ['POST', 'PUT'].includes(method)) {
        const id = method === 'POST' ? crypto.randomUUID() : url.searchParams.get('id') || payload.id;
        if (method === 'POST' && Object.hasOwn(payload, 'translationsRevision')) {
            return saveError(400, 'FIXTURE_INVALID_BODY', 'POST does not accept translationsRevision.');
        }
        if (!Array.isArray(payload.name) || !Array.isArray(payload.description)
            || [payload.name, payload.description].some(entries => entries.some(entry => !fixtureLanguages.includes(entry?.language)
                || (entry.value !== undefined && typeof entry.value !== 'string')))) {
            return saveError(400, 'FIXTURE_INVALID_BODY', 'Use canonical language entries and string values.');
        }
        if (Object.hasOwn(payload, 'translationsRevision') && (typeof payload.translationsRevision !== 'string'
            || payload.translationsRevision.length !== 64 || !/^[a-f0-9]{64}$/.test(payload.translationsRevision))) {
            return saveError(400, 'FIXTURE_INVALID_BODY', 'Invalid translationsRevision.');
        }
        const current = rawSnapshots.get(id);
        const isPortuguese = language => language === 'pt-BR' || language === 'pt-PT';
        if (method === 'PUT') {
            if (!current) return new Response(null, {status: 404, statusText: 'Exercise not found'});
            if (['stale', 'incomplete'].includes(translationConflictPending)) {
                const code = translationConflictPending === 'stale' ? 'EXERCISE_TRANSLATIONS_STALE' : 'EXERCISE_TRANSLATIONS_INCOMPLETE';
                translationConflictPending = null;
                // Simulate a concurrent import while the editor still holds its earlier snapshot.
                current.translations = current.translations.filter(row => row.language !== 'pt-PT').concat({language: 'pt-PT',
                    name: 'Tradução importada para revisão', description: 'Descrição sintética importada durante a edição.'});
                current.translationsRevision = nextRevision();
                return saveError(409, code, 'Fixture translation snapshot changed. Review the imported text.');
            }
            if (failedSavePending) {
                failedSavePending = false;
                return new Response('Synthetic save failure', {status: 503, statusText: 'Fixture save temporarily unavailable'});
            }
            const portugueseRows = current.translations.filter(row => isPortuguese(row.language));
            const hasPortugueseInput = [payload.name, payload.description].some(entries => entries.some(entry => isPortuguese(entry.language) && entry.value?.trim()));
            if ((portugueseRows.length || hasPortugueseInput || payload.translationsRevision !== undefined)
                && payload.translationsRevision !== current.translationsRevision) {
                return saveError(409, 'EXERCISE_TRANSLATIONS_STALE', 'Reload the stored translations before saving.');
            }
            if (portugueseRows.some(row => [payload.name, payload.description].some(entries => !entries.some(entry => entry.language === row.language && typeof entry.value === 'string')))) {
                return saveError(409, 'EXERCISE_TRANSLATIONS_INCOMPLETE', 'Both fields must explicitly include each existing Portuguese translation.');
            }
        }
        const toMap = entries => Object.fromEntries(fixtureLanguages.map(language => [language, entries.find(entry => entry.language === language)?.value?.trim() || '']));
        const nameTranslations = toMap(payload.name);
        const descriptionTranslations = toMap(payload.description);
        const {translationsRevision, ...fields} = payload;
        const entity = {...fields, id, name: nameTranslations.en, description: descriptionTranslations.en, nameTranslations, descriptionTranslations};
        exercises = exercises.filter(exercise => exercise.id !== id).concat(entity);
        rawSnapshots.set(id, {id, translationsRevision: nextRevision(), base: {name: entity.name, description: entity.description},
            translations: fixtureLanguages.map(language => ({language, name: nameTranslations[language] || null, description: descriptionTranslations[language] || null}))
                .filter(row => row.name !== null || row.description !== null)});
        if (postSaveRawFailurePending) {
            postSaveRawFailurePending = false;
            failedRawReloadId = id;
        }
        return method === 'POST' ? Response.json({id}, {status: 201}) : new Response(null, {status: 204});
    }
    if (path.startsWith('/admin/exercise-examples/') && method === 'DELETE') {
        exercises = exercises.filter(exercise => exercise.id !== path.split('/').pop());
        rawSnapshots.delete(path.split('/').pop());
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
