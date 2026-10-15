import test from 'node:test';
import assert from 'node:assert/strict';
import {UserEntity, UserDetailsEntity} from '../src/domain/user/index.js';
import {UserController} from '../src/features/users/UserController.js';
import {UserStore} from '../src/features/users/UserStore.js';
import {UserDetailView} from '../src/features/users/UserDetailView.js';
import {formatShortDate, relativeDate} from '../src/features/users/userFormatters.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Toast} from '../src/shared/components/Toast.js';

const account = id => UserEntity.normalize({id, email: `${id}@example.test`, role: 'default', profile: {id: `profile-${id}`}});
function setup(t, overrides = {}) {
    t.mock.method(Toast, 'show', () => {});
    const store = new UserStore();
    const repository = {fetchAll: async () => [], fetchGoal: async () => null, fetchTrainings: async () => [],
        fetchWeightHistory: async () => [], fetchDeviceTokens: async () => [], ...overrides};
    const controller = new UserController({store, repository, bus: new EventBus(), confirmDialog: {}});
    return {store, controller, repository};
}
const element = () => ({textContent: '', innerHTML: '', hidden: false, value: '', scrollTop: 0,
    setAttribute() {}, contains() { return false; }, querySelectorAll() { return []; }});
function detailView(store) {
    const view = Object.create(UserDetailView.prototype);
    view._store = store; view._lastActive = null; view._renderedSections = new Map();
    view._els = Object.fromEntries(['userDetail', 'userNameEl', 'userEmailEl', 'userIdEl', 'profileIdEl',
        'userCreatedEl', 'userUpdatedEl', 'userActivityEl', 'userWorkoutsEl', 'goalBody', 'goalSummary',
        'trainingsBody', 'trainingsCount', 'weightBody', 'weightSummary', 'deviceTokensBody', 'deviceTokensSummary'].map(key => [key, element()]));
    return view;
}

test('a malformed users row rejects refresh and retains the last good library and selection', async t => {
    for (const rows of [[null], [[]], ['wrong'], [{}], [{id: null}], [{id: ''}], [{id: {}}], [{id: '   '}], [{id: 'duplicate'}, {id: 'duplicate'}]]) {
        const {store, controller} = setup(t, {fetchAll: async () => rows});
        const original = account('original'); store.setUsers([original]); store.setActive(original);
        await controller.loadUsers();
        assert.equal(store.getState().users[0], original, JSON.stringify(rows));
        assert.equal(store.getState().active, original);
        assert.match(store.getState().loadError, /invalid/i);
    }
});

test('malformed detail rows produce section errors and retry UX instead of claiming empty records', async t => {
    const cases = [
        {fetchTrainings: async () => [null], key: 'recentTrainings'},
        {fetchTrainings: async () => [{id: {}, exercises: []}], key: 'recentTrainings'},
        {fetchTrainings: async () => [{id: 't', duration: []}], key: 'recentTrainings'},
        {fetchTrainings: async () => [{id: 't', exercises: [null]}], key: 'recentTrainings'},
        {fetchTrainings: async () => [{id: 't', exercises: [{iterations: [null]}]}], key: 'recentTrainings'},
        {fetchWeightHistory: async () => [{weight: 'invalid'}], key: 'weightHistory'},
        {fetchWeightHistory: async () => [{weight: null}], key: 'weightHistory'},
        {fetchWeightHistory: async () => [{weight: [80]}], key: 'weightHistory'},
        {fetchDeviceTokens: async () => [{token: null}], key: 'deviceTokens'},
        {fetchGoal: async () => ({target: {toString: null}}), key: 'goal'},
    ];
    for (const entry of cases) {
        const {store, controller} = setup(t, entry); const user = account('a'); store.setUsers([user]);
        await controller.selectUser(user);
        const details = store.getState().details;
        assert.match(details.errors[entry.key] ?? '', /invalid/i, entry.key);
        const view = detailView(store); view._setBody = (body, html) => { body.innerHTML = html; };
        if (entry.key === 'recentTrainings') view._renderTrainings({state: 'ready', error: details.errors[entry.key], trainings: details.recentTrainings});
        if (entry.key === 'weightHistory') view._renderWeight({state: 'ready', error: details.errors[entry.key], entries: details.weightHistory});
        if (entry.key === 'deviceTokens') view._renderDeviceTokens({state: 'ready', error: details.errors[entry.key], tokens: details.deviceTokens});
        if (entry.key === 'goal') view._renderGoal({state: 'ready', error: details.errors[entry.key], goal: details.goal});
        const body = view._els[entry.key === 'recentTrainings' ? 'trainingsBody' : entry.key === 'weightHistory' ? 'weightBody' : entry.key === 'goal' ? 'goalBody' : 'deviceTokensBody'];
        assert.match(body.innerHTML, /Could not load this section/);
        assert.match(body.innerHTML, /data-user-action="retry"/);
        assert.doesNotMatch(body.innerHTML, /No workouts recorded|No weight records|No devices registered/);
    }
});

test('only finite scalar numbers and nonblank numeric strings become measurements', () => {
    for (const value of [[], [250], {}, {toString: null}, true, false, ' ', '\n', Infinity, NaN]) {
        const training = UserDetailsEntity.normalizeTrainings([{duration: value, volume: value, repetitions: value}])[0];
        assert.equal(training.duration, null, JSON.stringify(value));
        assert.equal(training.volume, null);
        assert.equal(training.repetitions, null);
        assert.equal(UserEntity.normalize({workoutsCount: value}).workoutsCount, 0);
        assert.equal(UserEntity.workoutsCount({workoutsCount: value}), 0);
    }
    for (const value of [80.5, '80.5', ' 80.5 ']) {
        assert.equal(UserDetailsEntity.normalizeWeightHistory([{weight: value}])[0].weight, 80.5);
    }
});

test('malformed JSON dates never abort A-to-B rendering or retain the previous private sections', async t => {
    const previousDocument = globalThis.document;
    globalThis.document = {activeElement: null};
    t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
    const {store, controller} = setup(t, {
        fetchTrainings: async id => id === 'a' ? [{id: 'private-workout-a', exercises: []}] : [],
        fetchDeviceTokens: async id => id === 'a' ? [{token: 'private-device-token-a'}] : [],
    });
    const a = account('a');
    const b = UserEntity.normalize({id: 'b', email: 'b@example.test', role: 'default', createdAt: {toString: null}, updatedAt: true, lastActivity: {toString: null}});
    store.setUsers([a, b]); const view = detailView(store); store.subscribe(() => view.render());
    await controller.selectUser(a);
    assert.match(view._els.trainingsBody.innerHTML, /private-workout-a/);
    assert.match(view._els.deviceTokensBody.innerHTML, /private-device-token-a/);
    await controller.selectUser(b);
    assert.equal(view._els.userNameEl.textContent, 'b@example.test');
    assert.equal(view._els.userCreatedEl.textContent, '—');
    assert.doesNotMatch(view._els.trainingsBody.innerHTML, /private-workout-a/);
    assert.doesNotMatch(view._els.deviceTokensBody.innerHTML, /private-device-token-a/);
    assert.match(view._els.trainingsBody.innerHTML, /No workouts recorded/);
    assert.match(view._els.deviceTokensBody.innerHTML, /No devices registered/);
    for (const value of [{toString: null}, {}, [], true, false, null, '', '   ', Infinity]) {
        assert.doesNotThrow(() => formatShortDate(value));
        assert.doesNotThrow(() => relativeDate(value));
        assert.equal(formatShortDate(value), ''); assert.equal(relativeDate(value), '');
    }
    assert.equal(formatShortDate(new Date('2026-10-15T12:00:00Z')), '2026-10-15 12:00 UTC');
});

test('valid empty and partial optional responses remain valid with scalar decimal strings', async t => {
    const {store, controller, repository} = setup(t, {
        fetchTrainings: async () => [{id: 't', duration: null, volume: '250.5', exercises: [{iterations: [{bodyWeight: '80.5', repetitions: null}]}]}],
        fetchWeightHistory: async () => [{weight: '80.5'}], fetchDeviceTokens: async () => [{token: 'valid-token'}],
    });
    const user = account('a'); store.setUsers([user]); await controller.selectUser(user);
    assert.deepEqual(store.getState().details.errors, {});
    assert.equal(store.getState().details.goal, null);
    assert.equal(store.getState().details.recentTrainings[0].volume, 250.5);
    assert.equal(store.getState().details.weightHistory[0].weight, 80.5);
    repository.fetchTrainings = async () => []; repository.fetchWeightHistory = async () => []; repository.fetchDeviceTokens = async () => [];
    await controller.reloadDetails();
    assert.deepEqual(store.getState().details.errors, {});
    assert.deepEqual(store.getState().details.recentTrainings, []);
    repository.fetchAll = async () => []; await controller.loadUsers();
    assert.equal(store.getState().loadError, ''); assert.deepEqual(store.getState().users, []);
});
