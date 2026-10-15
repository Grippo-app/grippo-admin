import test from 'node:test';
import assert from 'node:assert/strict';
import {UserEntity} from '../src/domain/user/UserEntity.js';
import {UserStore} from '../src/features/users/UserStore.js';
import {UserController} from '../src/features/users/UserController.js';
import {UserDetailView} from '../src/features/users/UserDetailView.js';
import {UserListView} from '../src/features/users/UserListView.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Events} from '../src/infrastructure/events/events.js';
import {Toast} from '../src/shared/components/Toast.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const user = id => UserEntity.normalize({id, email: `${id}@example.test`, role: 'default', profile: {id: `profile-${id}`}});
const element = () => {
    let html = ''; return {textContent: '', writes: 0, value: '', hidden: false, scrollTop: 0, attributes: {},
        get innerHTML() { return html; }, set innerHTML(value) { html = value; this.writes++; },
        setAttribute(key, value) { this.attributes[key] = value; }, contains() { return false; }, querySelectorAll() { return []; }};
};
function viewFor(store) {
    const view = Object.create(UserDetailView.prototype);
    view._store = store; view._lastActive = null; view._renderedSections = new Map();
    view._els = Object.fromEntries(['userDetail', 'userNameEl', 'userEmailEl', 'userCreatedEl', 'goalBody', 'goalSummary',
        'trainingsBody', 'trainingsCount', 'weightBody', 'weightSummary', 'deviceTokensBody', 'deviceTokensSummary'].map(key => [key, element()]));
    store.subscribe(() => view.render()); view.render(); return view;
}
function setup(t, overrides = {}) {
    const previousDocument = globalThis.document; globalThis.document = {activeElement: null};
    t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
    t.mock.method(Toast, 'show', () => {});
    const store = new UserStore(); const bus = new EventBus();
    const repository = {fetchAll: async () => [], fetchGoal: async () => null, fetchTrainings: async () => [], fetchWeightHistory: async () => [], fetchDeviceTokens: async () => [], ...overrides};
    const controller = new UserController({store, repository, bus, confirmDialog: {}});
    return {store, bus, controller, repository, view: viewFor(store)};
}
function pendingRepository() {
    const sections = Object.fromEntries(['goal', 'trainings', 'weight', 'devices'].map(key => [key, deferred()]));
    return {sections, fetchGoal: () => sections.goal.promise, fetchTrainings: () => sections.trainings.promise,
        fetchWeightHistory: () => sections.weight.promise, fetchDeviceTokens: () => sections.devices.promise};
}
const finish = sections => { sections.goal.resolve(null); sections.trainings.resolve([]); sections.weight.resolve([]); sections.devices.resolve([]); };

test('first-load section skeletons reserve their structure and fast responses appear before slow requests finish', async t => {
    const pending = pendingRepository(); const {store, controller, view, bus} = setup(t, pending);
    const account = user('a'); store.setUsers([account]); let completed = 0; bus.on(Events.USER_DETAILS_LOADED, () => completed++);
    const loading = controller.selectUser(account); await tick();
    assert.match(view._els.trainingsBody.innerHTML, /skeleton-row/);
    assert.match(view._els.trainingsBody.innerHTML, /aria-hidden="true"/);
    assert.match(view._els.trainingsBody.innerHTML, /sr-only.*Loading section/);
    assert.equal(view._els.trainingsBody.attributes['aria-busy'], 'true');
    pending.sections.trainings.resolve([{id: 'fast-workout', duration: 45}]); await tick();
    assert.match(view._els.trainingsBody.innerHTML, /fast-workout/);
    assert.doesNotMatch(view._els.trainingsBody.innerHTML, /skeleton-row/);
    assert.match(view._els.deviceTokensBody.innerHTML, /skeleton-row/);
    assert.equal(store.getState().detailsLoading, true);
    assert.equal(store.getState().detailSections.recentTrainings.loading, false);
    assert.equal(view._els.trainingsBody.attributes['aria-busy'], 'false');
    assert.equal(completed, 0);
    finish(pending.sections); await loading;
    assert.equal(store.getState().detailsLoading, false); assert.equal(completed, 1);
});

test('an independent section error is visible while unrelated sections keep loading', async t => {
    const pending = pendingRepository(); const {store, controller, view} = setup(t, pending);
    const account = user('a'); store.setUsers([account]); const loading = controller.selectUser(account); await tick();
    pending.sections.devices.reject(Object.assign(new Error('404 Not Found'), {status: 404})); await tick();
    assert.match(view._els.deviceTokensBody.innerHTML, /unavailable on this API/);
    assert.doesNotMatch(view._els.deviceTokensBody.innerHTML, /No devices registered/);
    assert.equal(store.getState().detailSections.deviceTokens.loading, false);
    assert.equal(store.getState().detailsLoading, true);
    assert.match(view._els.weightBody.innerHTML, /skeleton-row/);
    finish(pending.sections); await loading;
});

test('same-user retry retains cached contents, open workout and limits while other sections update', async t => {
    const {store, controller, repository, view} = setup(t, {fetchTrainings: async () => [{id: 't', duration: 45, exercises: []}]});
    const account = user('a'); store.setUsers([account]); await controller.selectUser(account);
    store.toggleExpandedTraining('t'); store.showMoreTrainings();
    const body = view._els.trainingsBody; const original = body.innerHTML; const writes = body.writes;
    const pending = pendingRepository(); Object.assign(repository, pending);
    const loading = controller.reloadDetails(); await tick();
    assert.equal(body.innerHTML, original); assert.equal(body.writes, writes);
    assert.match(view._els.trainingsCount.textContent, /Updating/);
    assert.equal(store.getState().expandedTrainingId, 't'); assert.equal(store.getState().trainingsLimit, 20);
    pending.sections.goal.resolve({primaryGoal: 'build_muscle'}); await tick();
    assert.equal(body.writes, writes, 'an unrelated response does not replace the cached workout DOM');
    pending.sections.trainings.resolve([{id: 't', duration: 46, exercises: []}]); await tick();
    assert.match(body.innerHTML, /aria-expanded="true"/); assert.match(body.innerHTML, /46m/);
    finish(pending.sections); await loading;
    assert.equal(store.getState().expandedTrainingId, 't');
});

test('a failed refresh keeps previous good content and exposes its error with a retry action', async t => {
    const {store, controller, repository, view} = setup(t, {fetchWeightHistory: async () => [{weight: '80.5'}]});
    const account = user('a'); store.setUsers([account]); await controller.selectUser(account);
    const original = view._els.weightBody.innerHTML; const writes = view._els.weightBody.writes;
    repository.fetchWeightHistory = async () => { throw new Error('503 Temporarily unavailable'); };
    await controller.reloadDetails();
    assert.equal(view._els.weightBody.innerHTML, original); assert.equal(view._els.weightBody.writes, writes);
    assert.match(view._els.weightSummary.innerHTML, /Refresh failed/);
    assert.match(view._els.weightSummary.innerHTML, /503 Temporarily unavailable/);
    assert.match(view._els.weightSummary.innerHTML, /data-user-action="retry"/);
    assert.equal(store.getState().detailSections.weightHistory.loaded, true);
    assert.equal(store.getState().details.weightHistory[0].weight, 80.5);
});

test('cached expand and show-more controls work during slow refresh and after refresh failure', async t => {
    const {store, controller, repository, view} = setup(t, {
        fetchTrainings: async () => Array.from({length: 15}, (_, index) => ({id: `t-${index}`, exercises: []})),
        fetchWeightHistory: async () => Array.from({length: 15}, (_, index) => ({weight: 80 + index / 10})),
    });
    const account = user('a'); store.setUsers([account]); await controller.selectUser(account);
    const pending = pendingRepository(); Object.assign(repository, pending); const loading = controller.reloadDetails(); await tick();
    store.toggleExpandedTraining('t-0'); store.showMoreTrainings(); store.showMoreWeights();
    assert.match(view._els.trainingsBody.innerHTML, /aria-expanded="true"/);
    assert.equal((view._els.trainingsBody.innerHTML.match(/data-training-id=/g) ?? []).length, 15);
    assert.doesNotMatch(view._els.weightBody.innerHTML, /more-weights/);
    assert.match(view._els.trainingsCount.textContent, /Updating/);
    assert.equal(view._els.trainingsBody.attributes['aria-busy'], 'true');
    pending.sections.trainings.reject(new Error('503 Offline')); pending.sections.weight.reject(new Error('503 Offline')); await tick();
    store.toggleExpandedTraining('t-0');
    assert.doesNotMatch(view._els.trainingsBody.innerHTML, /aria-expanded="true"/);
    assert.match(view._els.trainingsCount.innerHTML, /Refresh failed/);
    const writes = view._els.trainingsCount.writes;
    pending.sections.goal.resolve(null); await tick();
    assert.equal(view._els.trainingsCount.writes, writes, 'unrelated completion preserves the cached retry control');
    finish(pending.sections); await loading;
    assert.match(view._els.weightSummary.innerHTML, /Refresh failed/);
});

test('known empty responses remain visible while retrying and never regress into initial skeletons', async t => {
    const {store, controller, repository, view} = setup(t);
    const account = user('a'); store.setUsers([account]); await controller.selectUser(account);
    const before = view._els.goalBody.innerHTML; assert.match(before, /has not set a goal/);
    const pending = pendingRepository(); Object.assign(repository, pending); const loading = controller.reloadDetails(); await tick();
    assert.equal(view._els.goalBody.innerHTML, before);
    assert.doesNotMatch(view._els.goalBody.innerHTML, /skeleton-row/);
    assert.match(view._els.trainingsBody.innerHTML, /No workouts recorded/);
    finish(pending.sections); await loading;
});

test('switching users clears previous private sections before the next response and ignores old partial completions', async t => {
    const a = pendingRepository(), b = pendingRepository();
    const {store, controller, view} = setup(t, {fetchGoal: id => (id === 'a' ? a : b).fetchGoal(),
        fetchTrainings: id => (id === 'a' ? a : b).fetchTrainings(), fetchWeightHistory: id => (id === 'a' ? a : b).fetchWeightHistory(),
        fetchDeviceTokens: id => (id === 'a' ? a : b).fetchDeviceTokens()});
    const alice = user('a'), bob = user('b'); store.setUsers([alice, bob]);
    const first = controller.selectUser(alice); await tick(); a.sections.devices.resolve([{token: 'private-token-a'}]); await tick();
    assert.match(view._els.deviceTokensBody.innerHTML, /private-token-a/);
    const second = controller.selectUser(bob);
    assert.doesNotMatch(view._els.deviceTokensBody.innerHTML, /private-token-a/);
    assert.match(view._els.deviceTokensBody.innerHTML, /skeleton-row/);
    a.sections.trainings.resolve([{id: 'private-training-a'}]); finish(a.sections); await first;
    assert.equal(store.getState().active.id, 'b'); assert.equal(store.getState().details, null);
    finish(b.sections); await second;
    assert.doesNotMatch(view._els.trainingsBody.innerHTML, /private-training-a/);
});

test('session reset erases partial contents and late sections cannot restore them', async t => {
    const pending = pendingRepository(); const {store, controller, view, bus} = setup(t, pending);
    const account = user('a'); store.setUsers([account]); const loading = controller.selectUser(account); await tick();
    pending.sections.devices.resolve([{token: 'private-token'}]); await tick();
    assert.match(view._els.deviceTokensBody.innerHTML, /private-token/);
    bus.emit(Events.AUTH_LOGOUT);
    assert.deepEqual(store.getState().detailSections, {}); assert.equal(view._els.deviceTokensBody.innerHTML, '');
    finish(pending.sections); await loading;
    assert.equal(store.getState().details, null); assert.equal(view._els.deviceTokensBody.innerHTML, '');
});

test('initial list uses decorative stable skeleton rows while refresh keeps loaded rows and scroll intact', t => {
    const {store} = setup(t); const list = element(); const view = Object.create(UserListView.prototype);
    view._store = store; view._lastRender = null; view._sortMenu = {setActive() {}};
    view._els = {userList: list, userCount: element()};
    store.setLoading(true); view.render();
    assert.equal((list.innerHTML.match(/user-list-skeleton-row/g) ?? []).length, 6);
    assert.match(list.innerHTML, /aria-hidden="true"/); assert.match(list.innerHTML, /sr-only.*Loading users/);
    store.setUsers([user('a')]); store.setLoading(false); view.render();
    const html = list.innerHTML, writes = list.writes; list.scrollTop = 123;
    store.setLoading(true); view.render();
    assert.equal(list.innerHTML, html); assert.equal(list.writes, writes); assert.equal(list.scrollTop, 123);
    assert.equal(list.attributes['aria-busy'], 'true');
});
