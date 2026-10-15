import test from 'node:test';
import assert from 'node:assert/strict';
import {UserEntity} from '../src/domain/user/UserEntity.js';
import {UserRepository} from '../src/domain/user/UserRepository.js';
import {UserDetailsEntity} from '../src/domain/user/UserDetailsEntity.js';
import {UserStore} from '../src/features/users/UserStore.js';
import {UserController} from '../src/features/users/UserController.js';
import {UserDetailView} from '../src/features/users/UserDetailView.js';
import {formatDuration} from '../src/features/users/userFormatters.js';
import {USER_ROLES} from '../src/shared/constants/index.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Events} from '../src/infrastructure/events/events.js';
import {Toast} from '../src/shared/components/Toast.js';

const user = (id, patch = {}) => UserEntity.normalize({id, email: `${id}@example.com`, role: 'default', ...patch});
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
};
function fixture(t, overrides = {}) {
    t.mock.method(Toast, 'show', () => {});
    const store = new UserStore();
    const bus = new EventBus();
    const repository = {
        fetchAll: async () => [], fetchGoal: async () => null,
        fetchTrainings: async () => [], fetchWeightHistory: async () => [], fetchDeviceTokens: async () => [],
        setRole: async (id, role) => ({id, role}), delete: async () => {}, ...overrides,
    };
    const controller = new UserController({store, repository, bus, confirmDialog: {ask: async () => true}});
    return {store, bus, repository, controller};
}

test('user search matches trimmed name, email and case-insensitive IDs', () => {
    const store = new UserStore();
    store.setUsers([user('ABC', {name: 'Alice Walker', profileId: 'PROFILE-1'})]);
    for (const query of [' alice ', 'WALKER', 'abc', 'EXAMPLE.COM', 'profile-1']) {
        store.setSearchQuery(query);
        assert.equal(store.getState().filtered.length, 1, query);
    }
});

test('refresh synchronizes selection and clears details for a removed user', () => {
    const store = new UserStore();
    const original = user('a');
    store.setUsers([original]);
    store.setActive(original);
    const details = {goal: {primaryGoal: 'build_muscle'}};
    store.setDetails('a', details);
    const updated = user('a', {role: 'admin'});
    store.setUsers([updated]);
    assert.equal(store.getState().active, updated);
    assert.equal(store.getState().details, details);
    store.setUsers([]);
    assert.equal(store.getState().active, null);
    assert.equal(store.getState().details, null);
});

test('malformed optional API fields do not crash lists or invent zero-weight records', () => {
    assert.equal(UserEntity.normalize(null).id, '');
    assert.equal(UserEntity.normalize({id: 0}).id, '0');
    assert.equal(UserEntity.normalize({workoutsCount: 'invalid'}).workoutsCount, 0);
    assert.deepEqual(UserEntity.normalizeAuthTypes([null, {provider: 123}, ' Google ', 'google']), ['google']);
    assert.deepEqual(UserDetailsEntity.normalizeTrainings([null, 'wrong']), []);
    const [training] = UserDetailsEntity.normalizeTrainings([{id: 42, exercises: [null, {iterations: [null, {repetitions: '8'}]}]}]);
    assert.equal(training.id, '42');
    assert.equal(training.exercises[0].iterations[0].repetitions, 8);
    assert.deepEqual(UserDetailsEntity.normalizeWeightHistory([{weight: null}, {}, {weight: 'bad'}, {weight: 0}]), []);
    assert.equal(UserDetailsEntity.normalizeGoal({}).confidence, null);
    assert.equal(UserDetailsEntity.normalizeGoal({confidence: 'bad'}).confidence, null);
});

test('history ordering is deterministic with invalid dates and ascending server records', () => {
    const sorted = UserDetailsEntity.normalizeWeightHistory([
        {weight: 70, createdAt: '2026-01-01'}, {weight: 73, createdAt: 'invalid'}, {weight: 72, createdAt: '2026-02-01'},
    ]);
    assert.deepEqual(sorted.map(entry => entry.weight), [72, 70, 73]);
    const compare = UserEntity.comparator('createdAt');
    assert.ok(Number.isFinite(compare(user('a', {createdAt: 'bad'}), user('b', {createdAt: '2026-01-01'}))));
});

test('an older users response cannot overwrite a newer refresh or finish its spinner', async t => {
    const first = deferred();
    const second = deferred();
    let count = 0;
    const {store, controller} = fixture(t, {fetchAll: () => ++count === 1 ? first.promise : second.promise});
    const oldRequest = controller.loadUsers();
    const freshRequest = controller.loadUsers();
    first.resolve([{id: 'old'}]);
    await oldRequest;
    assert.equal(store.getState().isLoading, true);
    assert.deepEqual(store.getState().users, []);
    second.resolve([{id: 'fresh'}]);
    await freshRequest;
    assert.equal(store.getState().users[0].id, 'fresh');
    assert.equal(store.getState().isLoading, false);
});

test('logout clears private selection and ignores pending list/detail responses', async t => {
    const list = deferred();
    const goal = deferred();
    const {store, bus, controller} = fixture(t, {fetchAll: () => list.promise, fetchGoal: () => goal.promise});
    store.setUsers([user('a')]);
    const details = controller.selectUser(store.getState().users[0]);
    const loading = controller.loadUsers();
    bus.emit(Events.AUTH_LOGOUT);
    list.resolve([{id: 'a'}]);
    goal.resolve({primaryGoal: 'build_muscle'});
    await Promise.all([details, loading]);
    assert.deepEqual(store.getState().users, []);
    assert.equal(store.getState().active, null);
    assert.equal(store.getState().details, null);
    assert.equal(store.getState().isLoading, false);
});

test('switching away and back drops an earlier request for the same user', async t => {
    const oldGoal = deferred();
    const newGoal = deferred();
    let calls = 0;
    const {store, controller} = fixture(t, {fetchGoal: id => id === 'a' ? (++calls === 1 ? oldGoal.promise : newGoal.promise) : Promise.resolve(null)});
    const a = user('a');
    const b = user('b');
    store.setUsers([a, b]);
    const first = controller.selectUser(a);
    await Promise.resolve();
    const middle = controller.selectUser(b);
    await Promise.resolve();
    const last = controller.selectUser(a);
    await Promise.resolve();
    newGoal.resolve({primaryGoal: 'new_goal'});
    await last;
    oldGoal.resolve({primaryGoal: 'old_goal'});
    await Promise.all([first, middle]);
    assert.equal(store.getState().details.goal.primaryGoal, 'new_goal');
});

test('a failed detail section stays distinguishable from empty data and can be retried', async t => {
    let failing = true;
    const {store, controller} = fixture(t, {
        fetchGoal: async () => ({primaryGoal: 'strength'}),
        fetchWeightHistory: async () => { if (failing) throw new Error('503 Unavailable'); return [{weight: 80}]; },
    });
    const account = user('a');
    store.setUsers([account]);
    await controller.selectUser(account);
    assert.equal(store.getState().details.errors.weightHistory, '503 Unavailable');
    assert.equal(store.getState().details.goal.primaryGoal, 'strength');
    failing = false;
    await controller.reloadDetails();
    assert.deepEqual(store.getState().details.errors, {});
    assert.equal(store.getState().details.weightHistory[0].weight, 80);
});

test('re-selecting a user during detail loading does not issue duplicate requests', async t => {
    const goal = deferred();
    let calls = 0;
    const {store, controller} = fixture(t, {fetchGoal: () => { calls++; return goal.promise; }});
    const account = user('a');
    store.setUsers([account]);
    const pending = controller.selectUser(account);
    controller.selectUser(account);
    goal.resolve(null);
    await pending;
    assert.equal(calls, 1);
});

test('a successful role change updates its original user while selection moves elsewhere', async t => {
    const response = deferred();
    const {store, controller} = fixture(t, {setRole: () => response.promise});
    const a = user('a');
    const b = user('b');
    store.setUsers([a, b]);
    store.setActive(a);
    const mutation = controller.changeRole('admin');
    store.setActive(b);
    response.resolve({});
    await mutation;
    assert.equal(store.getState().active.id, 'b');
    assert.equal(store.getState().active.role, 'default');
    assert.equal(store.getState().users.find(account => account.id === 'a').role, 'admin');
});

test('late role mutations from a previous session cannot modify a new session', async t => {
    const response = deferred();
    const {store, bus, controller} = fixture(t, {setRole: () => response.promise});
    store.setUsers([user('a')]);
    store.setActive(store.getState().users[0]);
    const mutation = controller.changeRole('admin');
    bus.emit(Events.AUTH_SESSION_EXPIRED);
    store.setUsers([user('a')]);
    store.setActive(store.getState().users[0]);
    response.resolve({role: 'admin'});
    await mutation;
    assert.equal(store.getState().active.role, 'default');
});

test('a stale list refresh cannot restore a user after deletion', async t => {
    const list = deferred();
    const {store, controller} = fixture(t, {fetchAll: () => list.promise});
    store.setUsers([user('a')]);
    store.setActive(store.getState().users[0]);
    const loading = controller.loadUsers();
    await controller.deleteActiveUser();
    list.resolve([{id: 'a'}]);
    await loading;
    assert.deepEqual(store.getState().users, []);
    assert.equal(store.getState().active, null);
});

function detailView() {
    const view = Object.create(UserDetailView.prototype);
    const element = () => ({textContent: '', innerHTML: '', setAttribute() {}});
    view._els = {trainingsBody: element(), trainingsCount: element(), weightBody: element(), weightSummary: element(), goalBody: element(), goalSummary: element()};
    view._setBody = (body, html) => body.innerHTML = html;
    return view;
}

test('workout and weight histories expose every fetched record through show more', () => {
    const view = detailView();
    const trainings = UserDetailsEntity.normalizeTrainings(Array.from({length: 23}, (_, id) => ({id, exercises: []})));
    view._renderTrainings({state: 'ready', trainings, limit: 10});
    assert.match(view._els.trainingsBody.innerHTML, /more-trainings/);
    assert.equal((view._els.trainingsBody.innerHTML.match(/data-training-id=/g) || []).length, 10);
    view._renderTrainings({state: 'ready', trainings, limit: 30});
    assert.equal((view._els.trainingsBody.innerHTML.match(/data-training-id=/g) || []).length, 23);
    assert.doesNotMatch(view._els.trainingsBody.innerHTML, /more-trainings/);
    const entries = UserDetailsEntity.normalizeWeightHistory(Array.from({length: 20}, (_, index) => ({weight: 70 + index / 10, createdAt: `2026-01-${String(index + 1).padStart(2, '0')}`})));
    view._renderWeight({state: 'ready', entries, limit: 12});
    assert.match(view._els.weightBody.innerHTML, /more-weights/);
    assert.match(view._els.weightBody.innerHTML, /Weight history:/);
    assert.doesNotMatch(view._els.weightBody.innerHTML, /NaN|Infinity/);
    view._renderWeight({state: 'ready', entries, limit: 24});
    assert.equal((view._els.weightBody.innerHTML.match(/class="weight-row"/g) || []).length, 20);
    assert.doesNotMatch(view._els.weightBody.innerHTML, /more-weights/);
});

test('a failed section renders an explicit retry instead of a misleading empty state', () => {
    const view = detailView();
    view._renderTrainings({state: 'ready', error: '503 <unavailable>', trainings: []});
    assert.match(view._els.trainingsBody.innerHTML, /Could not load this section/);
    assert.match(view._els.trainingsBody.innerHTML, /data-user-action="retry"/);
    assert.match(view._els.trainingsBody.innerHTML, /503 &lt;unavailable&gt;/);
    assert.doesNotMatch(view._els.trainingsBody.innerHTML, /No workouts recorded/);
});

test('set details preserve body, extra and assisted load signals without zero-external masking', () => {
    const view = detailView();
    const iteration = UserDetailsEntity.normalizeTrainings([{exercises: [{iterations: [{externalWeight: 0, bodyWeight: 75, extraWeight: 10, assistWeight: 5, repetitions: 8}]}]}])[0].exercises[0].iterations[0];
    const html = view._trainingIteration(iteration, 0);
    assert.match(html, /Body 75\.0 kg/);
    assert.match(html, /Extra \+10\.0 kg/);
    assert.match(html, /Assistance −5\.0 kg/);
    assert.doesNotMatch(html, /External 0\.0/);
});


test('clearing selection removes private user content from hidden DOM even without a prior render', () => {
    const view = detailView();
    view._store = new UserStore();
    view._renderedSections = new Map();
    view._lastActive = null;
    view._els.userDetail = {hidden: false};
    view._els.userNameEl = {textContent: 'Private name'};
    view._els.userEmailEl = {textContent: 'private@example.test'};
    view._els.userActivityEl = {textContent: 'today', title: 'Private timestamp'};
    view._els.userIdEl = {value: 'private-user'};
    view._els.profileIdEl = {value: 'private-profile'};
    view._els.deviceTokensBody = {innerHTML: '<code>private-device-token</code>'};
    view._els.trainingsBody.innerHTML = '<div>Private workout history</div>';
    view._els.weightBody.innerHTML = '<div>Private weight history</div>';
    view._els.goalBody.innerHTML = '<div>Private goal</div>';
    view.render();
    assert.equal(view._els.userDetail.hidden, true);
    assert.equal(view._els.userEmailEl.textContent, '');
    assert.equal(view._els.userNameEl.textContent, '');
    assert.equal(view._els.userIdEl.value, '');
    assert.equal(view._els.profileIdEl.value, '');
    assert.equal(view._els.userActivityEl.title, '');
    for (const key of ['deviceTokensBody', 'trainingsBody', 'weightBody', 'goalBody']) assert.equal(view._els[key].innerHTML, '');
});


test('training durations use backend and mobile minutes rather than seconds', () => {
    assert.equal(formatDuration(25), '25m');
    assert.equal(formatDuration(45), '45m');
    assert.equal(formatDuration(90), '1h 30m');
    assert.equal(formatDuration(60), '1h');
    assert.equal(formatDuration(0), '0m');
    assert.equal(formatDuration(null), '—');
    assert.equal(formatDuration('invalid'), '—');
    const view = detailView();
    const [training] = UserDetailsEntity.normalizeTrainings([{id: 'minutes', duration: 45}]);
    view._renderTrainings({state: 'ready', trainings: [training]});
    assert.match(view._els.trainingsBody.innerHTML, /45m/);
    assert.doesNotMatch(view._els.trainingsBody.innerHTML, /45s/);
});

test('role response metadata defaults do not erase the latest list activity and workout count', async t => {
    const response = deferred();
    const account = user('a', {workoutsCount: 12, lastActivity: '2026-10-12T10:00:00.000Z'});
    const {store, controller} = fixture(t, {setRole: () => response.promise});
    store.setUsers([account]);
    store.setActive(account);
    const changing = controller.changeRole('admin');
    // A concurrent list refresh contains newer activity than the original selection.
    store.setUsers([user('a', {workoutsCount: 13, lastActivity: '2026-10-15T10:00:00.000Z'})]);
    response.resolve({id: 'a', email: 'a@example.com', role: 'admin', workoutsCount: 0, lastActivity: null,
        authTypes: ['Email'], profile: {id: 'profile-a', name: 'Admin account'}});
    await changing;
    const updated = store.getState().active;
    assert.equal(updated.role, 'admin');
    assert.equal(updated.workoutsCount, 13);
    assert.equal(updated.lastActivity, '2026-10-15T10:00:00.000Z');
    assert.equal(updated.name, 'Admin account');
    assert.deepEqual(updated.authTypes, ['email']);
});

test('default role and supported roles match the backend enum exactly', () => {
    assert.equal(UserEntity.normalize({id: 'a'}).role, 'default');
    assert.deepEqual(USER_ROLES, ['default', 'admin']);
});


test('device endpoint 404 stays unavailable and never claims the user has no devices', async t => {
    const repository = new UserRepository({
        buildHeaders: () => ({}),
        _fetch: async () => new Response(null, {status: 404, statusText: 'Not Found'}),
    });
    await assert.rejects(repository.fetchDeviceTokens('a'), error => error.status === 404);
    const {store, controller} = fixture(t, {fetchDeviceTokens: id => repository.fetchDeviceTokens(id)});
    const account = user('a');
    store.setUsers([account]);
    await controller.selectUser(account);
    const details = store.getState().details;
    assert.match(details.errors.deviceTokens, /unavailable on this API \(404\)/);
    assert.equal(details.errors.goal, undefined);
    const view = detailView();
    view._els.deviceTokensBody = {innerHTML: '', setAttribute() {}};
    view._els.deviceTokensSummary = {textContent: ''};
    view._renderDeviceTokens({state: 'ready', error: details.errors.deviceTokens, tokens: details.deviceTokens});
    assert.match(view._els.deviceTokensBody.innerHTML, /number of registered devices could not be determined/);
    assert.match(view._els.deviceTokensBody.innerHTML, /data-user-action="retry"/);
    assert.doesNotMatch(view._els.deviceTokensBody.innerHTML, /No devices registered/);
    assert.equal(view._els.deviceTokensSummary.textContent, 'Unavailable');
});
