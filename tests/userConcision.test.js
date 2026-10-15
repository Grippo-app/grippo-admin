import test from 'node:test';
import assert from 'node:assert/strict';
import {UserEntity} from '../src/domain/user/UserEntity.js';
import {UserStore} from '../src/features/users/UserStore.js';
import {UserController} from '../src/features/users/UserController.js';
import {UserListView} from '../src/features/users/UserListView.js';
import {UserDetailView} from '../src/features/users/UserDetailView.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Events} from '../src/infrastructure/events/events.js';
import {Toast} from '../src/shared/components/Toast.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const raw = (id, patch = {}) => ({id, email: `${id}@example.test`, role: 'default', profile: {id: `p-${id}`}, ...patch});
const user = (id, patch) => UserEntity.normalize(raw(id, patch));
function setup(t, overrides = {}) {
    t.mock.method(Toast, 'show', () => {});
    const store = new UserStore(); const bus = new EventBus();
    const repository = {fetchGoal: async () => null, fetchTrainings: async () => [], fetchWeightHistory: async () => [], fetchDeviceTokens: async () => [], ...overrides};
    const controller = new UserController({store, bus, repository, confirmDialog: {}});
    return {store, bus, controller, repository};
}
const element = () => ({innerHTML: '', textContent: '', open: false, hidden: false, scrollTop: 0, setAttribute() {}, contains() { return false; }, querySelectorAll() { return []; }});
function detailView(store) {
    const view = Object.create(UserDetailView.prototype);
    view._store = store; view._lastActive = null; view._renderedSections = new Map();
    view._els = Object.fromEntries(['panel', 'userDetail', 'accountDetails', 'accountActions', 'userEmailEl', 'goalBody', 'goalSummary',
        'trainingsBody', 'trainingsCount', 'weightBody', 'weightSummary', 'deviceTokensBody', 'deviceTokensSummary'].map(key => [key, element()]));
    view._els.sectionElements = Object.fromEntries(['goal', 'recentTrainings', 'weightHistory', 'deviceTokens'].map(key => [key, element()]));
    view._setBody = (body, html) => { body.innerHTML = html; };
    store.subscribe(() => view.render()); view.render(); return view;
}

test('unchanged list refresh preserves normalized users, active record and filtered references; changed data stays current', () => {
    const store = new UserStore(); store.setUsers([user('a'), user('b')]); store.setActive(store.getState().users[0]);
    const before = store.getState(); store.setUsers([user('a'), user('b')]);
    assert.equal(store.getState().users, before.users); assert.equal(store.getState().filtered, before.filtered); assert.equal(store.getState().active, before.active);
    store.setSearchQuery('example'); assert.equal(store.getState().filtered, before.filtered);
    store.setUsers([user('a', {profile: {id: 'p-a', name: 'Updated name'}}), user('b')]);
    assert.equal(store.getState().active.name, 'Updated name'); assert.equal(store.getState().users[1], before.users[1]);
    assert.notEqual(store.getState().active, before.active);
});

test('keyed row reconciliation keeps unchanged DOM nodes and only replaces updated rows while preserving order', t => {
    const previousDocument = globalThis.document;
    class Row {
        constructor(id) { this.dataset = {id}; }
        remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    }
    globalThis.document = {createElement: () => ({set innerHTML(value) { this.firstElementChild = new Row(/data-id="([^"]+)"/.exec(value)[1]); }})};
    t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
    const a = user('a'), b = user('b'); const aRow = new Row('a'), bRow = new Row('b');
    const list = {children: [aRow, bRow], insertBefore(row, reference) {
        row.remove(); const index = reference ? this.children.indexOf(reference) : this.children.length;
        this.children.splice(index, 0, row); row.parent = this;
    }}; aRow.parent = list; bRow.parent = list;
    const view = Object.create(UserListView.prototype); view._els = {userList: list};
    view._rows = new Map([['a', {element: aRow, user: a}], ['b', {element: bRow, user: b}]]);
    view._reconcileRows([a, b], 'a', new Map());
    assert.equal(list.children[0], aRow); assert.equal(list.children[1], bRow);
    const changed = user('b', {name: 'Updated'}); view._reconcileRows([changed, a], 'a', new Map());
    assert.equal(list.children[1], aRow); assert.notEqual(list.children[0], bRow);
    assert.deepEqual(list.children.map(row => row.dataset.id), ['b', 'a']);
    assert.equal(bRow.parent, null);
});

test('stable live count and quality labels are not rewritten on unrelated notifications', () => {
    const view = Object.create(UserListView.prototype); let writes = 0, value = '2 users';
    const label = {get textContent() { return value; }, set textContent(next) { value = next; writes++; }};
    view._setText(label, '2 users'); assert.equal(writes, 0);
    view._setText(label, '3 users'); assert.equal(writes, 1);
});

test('a failed section retries independently while its slow sibling remains pending and does not restart healthy sections', async t => {
    const slow = deferred(); const calls = {goal: 0, trainings: 0, weight: 0, devices: 0};
    const {store, controller, bus} = setup(t, {
        fetchGoal: async () => { calls.goal++; return null; }, fetchTrainings: () => { calls.trainings++; return slow.promise; },
        fetchWeightHistory: async () => { calls.weight++; return []; },
        fetchDeviceTokens: async () => { if (++calls.devices === 1) throw new Error('503 Offline'); return [{token: 'fresh-token'}]; },
    });
    let loaded = 0; bus.on(Events.USER_DETAILS_LOADED, () => loaded++);
    const account = user('a'); store.setUsers([account]); const loading = controller.selectUser(account); await tick();
    assert.match(store.getState().details.errors.deviceTokens, /503/); assert.equal(store.getState().detailsLoading, true);
    await controller.reloadDetails('deviceTokens');
    assert.deepEqual(calls, {goal: 1, trainings: 1, weight: 1, devices: 2});
    assert.equal(store.getState().details.deviceTokens[0].token, 'fresh-token'); assert.equal(store.getState().details.errors.deviceTokens, undefined);
    assert.equal(store.getState().detailsLoading, true); assert.equal(loaded, 0);
    slow.resolve([]); await loading; assert.equal(store.getState().detailsLoading, false); assert.equal(loaded, 1);
});

test('scoped retries reject duplicates and cannot replace data after a user/session change', async t => {
    const retry = deferred(); let deviceCalls = 0;
    const {store, controller, bus} = setup(t, {fetchDeviceTokens: async id => {
        if (id === 'a' && ++deviceCalls === 2) return retry.promise;
        return [{token: `current-${id}-${deviceCalls}`}];
    }});
    const a = user('a'), b = user('b'); store.setUsers([a, b]); await controller.selectUser(a);
    const pending = controller.reloadDetails('deviceTokens'); await tick();
    assert.equal(controller.reloadDetails('deviceTokens'), undefined); assert.equal(controller.reloadDetails('unknown'), undefined);
    await controller.selectUser(b); await controller.selectUser(a);
    const fresh = store.getState().details.deviceTokens[0].token;
    retry.resolve([{token: 'old-retry'}]); await pending;
    assert.equal(store.getState().details.deviceTokens[0].token, fresh);
    const late = deferred(); controller._repo.fetchWeightHistory = () => late.promise;
    const loading = controller.reloadDetails('weightHistory'); await tick(); bus.emit(Events.AUTH_LOGOUT);
    late.resolve([{weight: 80}]); await loading; assert.equal(store.getState().details, null);
});

test('real user ID changes reset outer scroll and disclosures, while refresh and local interactions preserve them', () => {
    const store = new UserStore(); const view = detailView(store);
    const a = user('a', {workoutsCount: 5}), b = user('b'); store.setUsers([a, b]); store.setActive(a);
    assert.equal(view._els.sectionElements.recentTrainings.open, true); assert.equal(view._els.sectionElements.goal.open, false);
    view._els.panel.scrollTop = 727; view._els.accountDetails.open = true; view._els.accountActions.open = true; view._els.sectionElements.goal.open = true;
    store.setUsers([user('a', {workoutsCount: 5}), user('b')]); store.toggleExpandedTraining('t');
    assert.equal(view._els.panel.scrollTop, 727); assert.equal(view._els.accountDetails.open, true); assert.equal(view._els.sectionElements.goal.open, true);
    store.setActive(b); assert.equal(view._els.panel.scrollTop, 0); assert.equal(view._els.accountDetails.open, false); assert.equal(view._els.accountActions.open, false);
    assert.equal(Object.values(view._els.sectionElements).some(section => section.open), false);
    view._els.accountDetails.open = true; view._els.sectionElements.weightHistory.open = true; store.reset();
    assert.equal(view._els.accountDetails.open, false); assert.equal(view._els.sectionElements.weightHistory.open, false);
});

test('closed section summaries distinguish actual goals, empty data, loading and unavailable responses', () => {
    const store = new UserStore(); const view = detailView(store); const a = user('a'); store.setActive(a);
    assert.equal(view._els.goalSummary.textContent, 'Loading…');
    store.setDetailsLoading('a'); store.setDetailSection('a', 'goal', {value: {primaryGoal: 'build_muscle', personalizations: [], confidence: null}});
    assert.equal(view._els.goalSummary.textContent, 'Build muscle');
    store.setDetailSection('a', 'recentTrainings', {value: []}); assert.equal(view._els.trainingsCount.textContent, 'No recent workouts');
    const retryButton = {dataset: {userSection: 'deviceTokens'}};
    view._els.detailsSections = {querySelectorAll: () => [retryButton]};
    store.setDetailSection('a', 'deviceTokens', {error: '404 unavailable'}); assert.equal(view._els.deviceTokensSummary.textContent, 'Unavailable');
    assert.equal(store.getState().detailsLoading, true); assert.equal(retryButton.disabled, false);
    assert.match(view._els.deviceTokensBody.innerHTML, /data-user-section="deviceTokens"/);
});
