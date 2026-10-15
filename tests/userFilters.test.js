import test from 'node:test';
import assert from 'node:assert/strict';
import {UserEntity} from '../src/domain/user/UserEntity.js';
import {UserDiagnostics, userProfileState} from '../src/domain/user/UserDiagnostics.js';
import {UserStore} from '../src/features/users/UserStore.js';
import {parseUserTimestamp, readUserTimestamp, readUserWorkoutCount} from '../src/domain/user/userEvidence.js';
import {USER_FILTER_DEFAULTS, USER_FILTER_VALUES, matchesUserFilters, normalizeUserFilters, userProfileFilterState, userWorkoutsFilterState} from '../src/domain/user/UserFilters.js';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const DAY = 86_400_000;
const iso = value => new Date(value).toISOString();
const account = patch => UserEntity.normalize({id: 'a', role: 'default', profile: {id: 'p-a'}, profileId: 'p-a',
    workoutsCount: 2, createdAt: iso(NOW - 3 * DAY), lastActivity: iso(NOW - DAY), ...patch});
const matches = (user, filters, now = NOW) => matchesUserFilters(user, filters, {now});

test('profile filters preserve reported presence and separate conflicting references into unknown', () => {
    for (const patch of [{profile: {id: 'p-a'}, profileId: 'p-a'}, {profile: {name: 'Reported profile'}, profileId: undefined}, {profile: undefined, profileId: 'p-a'}]) {
        assert.equal(userProfileFilterState(account(patch)), 'present');
    }
    assert.equal(userProfileFilterState(account({profile: null, profileId: null})), 'missing');
    for (const patch of [{profile: undefined, profileId: null}, {profile: [], profileId: undefined},
        {profile: null, profileId: 'p-a'}, {profile: {id: 'p-a'}, profileId: null}, {profile: {id: 'p-a'}, profileId: 'different'}]) {
        const user = account(patch);
        assert.equal(userProfileFilterState(user), 'unknown');
        assert.equal(matches(user, {profile: 'present'}), false);
        assert.equal(matches(user, {profile: 'missing'}), false);
    }
    const conflict = account({profile: null, profileId: 'p-a'});
    assert.equal(userProfileState(conflict), 'present', 'the existing diagnostic presence semantics are unchanged');
    assert.equal(UserDiagnostics.evaluate(conflict, {now: NOW}).findings.some(finding => finding.ruleId === 'user.profile-id-mismatch'), true);
});

test('workout filters use raw safe integer evidence and never the display zero or nested fallback', () => {
    for (const workoutsCount of [undefined, null, '', ' ', true, false, [], [2], {}, -1, '-1', 0.5, '0.5', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const user = account({workoutsCount});
        assert.equal(readUserWorkoutCount(user), null, String(workoutsCount));
        assert.equal(userWorkoutsFilterState(user), 'unknown');
        assert.equal(matches(user, {workouts: 'without'}), false);
        assert.equal(matches(user, {workouts: 'unknown'}), true);
    }
    for (const workoutsCount of [0, '0', ' 0 ']) assert.equal(userWorkoutsFilterState(account({workoutsCount})), 'without');
    for (const workoutsCount of [1, '2', Number.MAX_SAFE_INTEGER]) assert.equal(userWorkoutsFilterState(account({workoutsCount})), 'with');
    const fallback = account({workoutsCount: undefined, profile: {id: 'p-a', workoutsCount: 12}});
    assert.equal(fallback.workoutsCount, 12); assert.equal(readUserWorkoutCount(fallback), null);
    const missing = account({workoutsCount: undefined}); delete missing.raw.workoutsCount;
    assert.equal(missing.workoutsCount, 0); assert.equal(userWorkoutsFilterState(missing), 'unknown');
});

test('the shared strict parser retains calendar and timezone validity without treating unknown as epoch zero', () => {
    for (const value of [undefined, null, '', 'invalid', '2026-02-30T12:00:00Z', '2025-02-29T12:00:00+03:00',
        '2026-10-15', '2026-10-15T12:00:00', '10/15/2026', true, false, [], {toString: null}, Infinity]) {
        assert.equal(parseUserTimestamp(value).timestamp, null, JSON.stringify(value));
        const user = account({createdAt: value, lastActivity: value});
        for (const field of ['createdAt', 'lastActivity']) {
            assert.equal(matches(user, {[field]: 'unknown'}), true);
            assert.equal(matches(user, {[field]: 'older30d'}), false);
        }
    }
    assert.equal(parseUserTimestamp('2024-02-29T12:00:00+03:00').timestamp, Date.parse('2024-02-29T09:00:00Z'));
    assert.equal(parseUserTimestamp(0).timestamp, 0);
    assert.equal(matches(account({createdAt: 0}), {createdAt: 'older30d'}), true);
    assert.equal(parseUserTimestamp(new Date(NOW)).timestamp, NOW);
});

test('explicit camelCase null or invalid evidence is never masked by a valid legacy alias in filters', () => {
    for (const field of ['createdAt', 'lastActivity']) {
        const alias = field === 'createdAt' ? 'created_at' : 'last_activity';
        for (const value of [null, '', undefined, 'invalid']) {
            const user = account({[field]: value, [alias]: iso(NOW - DAY)});
            assert.equal(readUserTimestamp(user, field).timestamp, null);
            assert.equal(matches(user, {[field]: 'unknown'}), true);
        }
        const legacy = account({[alias]: iso(NOW - DAY)}); delete legacy.raw[field];
        assert.equal(readUserTimestamp(legacy, field).timestamp, NOW - DAY);
    }
    const legacyDiagnostic = account({profile: null, profileId: null, createdAt: null, created_at: iso(NOW - 2 * DAY)});
    assert.equal(UserDiagnostics.evaluate(legacyDiagnostic, {now: NOW}).findings.some(finding => finding.ruleId === 'user.profile-missing-after-24h'), true);
    assert.equal(matches(legacyDiagnostic, {createdAt: 'unknown'}), true);
});

test('rolling date windows have exact inclusive recent boundaries and exclusive old boundaries', () => {
    for (const field of ['createdAt', 'lastActivity']) {
        assert.equal(matches(account({[field]: iso(NOW)}), {[field]: 'last7d'}), true);
        assert.equal(matches(account({[field]: iso(NOW - 7 * DAY)}), {[field]: 'last7d'}), true);
        assert.equal(matches(account({[field]: iso(NOW - 7 * DAY - 1)}), {[field]: 'last7d'}), false);
        const thirty = account({[field]: '2026-09-15T15:00:00+03:00'});
        assert.equal(matches(thirty, {[field]: 'last30d'}), true);
        assert.equal(matches(thirty, {[field]: 'older30d'}), false);
        assert.equal(matches(thirty, {[field]: 'older30d'}, NOW + 1), true);
        const future = account({[field]: iso(NOW + 1)});
        assert.equal(matches(future, {[field]: 'unknown'}), true);
        assert.equal(matches(future, {[field]: 'last7d'}), false);
        assert.equal(matches(future, {[field]: 'older30d'}), false);
    }
});

test('filter predicates intersect without mutating records, and invalid configuration safely normalizes', () => {
    const user = account({profile: null, profileId: null, workoutsCount: 0});
    const serialized = JSON.stringify(user);
    assert.equal(matches(user, {profile: 'missing', workouts: 'without', createdAt: 'last7d', lastActivity: 'last30d'}), true);
    assert.equal(matches(user, {profile: 'missing', workouts: 'with', createdAt: 'last7d'}), false);
    assert.equal(matches(user, USER_FILTER_DEFAULTS), true);
    assert.equal(JSON.stringify(user), serialized);
    assert.deepEqual(normalizeUserFilters({profile: 'unsupported', workouts: false, createdAt: null, extra: 'field'}), USER_FILTER_DEFAULTS);
    assert.equal(Object.isFrozen(USER_FILTER_DEFAULTS), true);
    assert.equal(Object.values(USER_FILTER_VALUES).every(Object.isFrozen), true);
});

test('Store combines structured filters with search, diagnostic queue and sort without changing selection or details', () => {
    const store = new UserStore({now: () => NOW});
    const missing = UserEntity.normalize({...account({profile: null, profileId: null, workoutsCount: 0, lastActivity: null}).raw,
        id: 'alice', name: 'Alice Example', email: 'alice@example.test'});
    const present = UserEntity.normalize({...account({workoutsCount: 0, lastActivity: null}).raw,
        id: 'bob', name: 'Alice With Profile', email: 'bob@example.test'});
    const unavailable = UserEntity.normalize({...missing.raw, id: 'unknown', name: 'Alice Unknown', workoutsCount: undefined});
    store.setUsers([missing, present, unavailable]); store.setActive(present);
    const details = {goal: null, recentTrainings: [], weightHistory: [], deviceTokens: [], errors: {}};
    store.setDetails('bob', details); const active = store.getState().active;
    store.setSearchQuery(' alice '); store.setDiagnosticFilter('attention'); store.setSortKey('email');
    store.setUserFilter('profile', 'missing'); store.setUserFilter('workouts', 'without');
    store.setUserFilter('createdAt', 'last7d'); store.setUserFilter('lastActivity', 'unknown');
    assert.deepEqual(store.getState().filtered.map(user => user.id), ['alice']);
    assert.equal(store.getState().active, active); assert.equal(store.getState().details, details);
    assert.equal(store.getState().diagnosticSummary.recordCount, 3);
    let resetNotifications = 0; store.subscribe(() => resetNotifications++);
    store.clearUserFilters();
    assert.deepEqual(store.getState().userFilters, USER_FILTER_DEFAULTS);
    assert.equal(store.getState().searchQuery, ' alice '); assert.equal(store.getState().diagnosticFilter, 'all');
    assert.deepEqual(store.getState().filtered.map(user => user.id), ['alice', 'unknown', 'bob']);
    assert.equal(resetNotifications, 1, 'all filter categories clear in one notification');
    assert.equal(store.getState().sortKey, 'email'); assert.equal(store.getState().active, active); assert.equal(store.getState().details, details);
});

test('clearing only a data-quality filter restores the current search without resetting the selected details', () => {
    const store = new UserStore({now: () => NOW});
    const a = account({name: 'Alice', email: 'alice@example.test'});
    store.setUsers([a]); store.setActive(a); const details = {goal: null}; store.setDetails('a', details);
    store.setSearchQuery('alice'); store.setDiagnosticFilter('attention');
    assert.equal(store.getState().filtered.length, 0);
    let notifications = 0; store.subscribe(() => notifications++);
    store.clearUserFilters();
    assert.equal(store.getState().diagnosticFilter, 'all');
    assert.deepEqual(store.getState().filtered, [a]);
    assert.equal(store.getState().active, a); assert.equal(store.getState().details, details);
    assert.equal(store.getState().searchQuery, 'alice'); assert.equal(notifications, 1);
    store.clearUserFilters(); assert.equal(notifications, 1, 'an already clear view stays quiet');
});

test('Store filters update from new raw evidence instead of stale normalized zeros, and reset clears filter state', () => {
    const store = new UserStore({now: () => NOW});
    store.setUserFilter('workouts', 'without'); store.setUsers([account({workoutsCount: undefined})]);
    assert.equal(store.getState().users[0].workoutsCount, 0); assert.deepEqual(store.getState().filtered, []);
    store.setUsers([account({workoutsCount: 0})]); assert.equal(store.getState().filtered.length, 1);
    store.setUserFilter('workouts', 'with'); assert.equal(store.getState().filtered.length, 0);
    store.setUsers([account({workoutsCount: '3'})]); assert.equal(store.getState().filtered.length, 1);
    const before = store.getState(); let notifications = 0; store.subscribe(() => notifications++);
    store.setUserFilter('unsupported', 'present'); store.setUserFilter('__proto__', 'present'); store.setUserFilter('profile', 'unsupported');
    assert.equal(store.getState().userFilters, before.userFilters); assert.equal(notifications, 0);
    store.reset(); assert.deepEqual(store.getState().userFilters, USER_FILTER_DEFAULTS); assert.deepEqual(store.getState().users, []);
    const count = notifications; store.clearUserFilters(); assert.equal(notifications, count);
});

test('clock ticks recompute date membership even when diagnostic reports are unchanged, then remain quiet when stable', () => {
    for (const [field, filter, age] of [['createdAt', 'last7d', 7], ['lastActivity', 'last30d', 30]]) {
        let now = NOW; const store = new UserStore({now: () => now});
        store.setUsers([account({[field]: iso(NOW - age * DAY)})]); store.setActive(store.getState().users[0]);
        const details = {goal: null}; store.setDetails('a', details); store.setUserFilter(field, filter);
        const before = store.getState(); assert.equal(before.filtered.length, 1);
        let notifications = 0; store.subscribe(() => notifications++);
        now++;
        assert.equal(store.refreshDiagnostics(), true); assert.equal(store.getState().filtered.length, 0);
        assert.equal(store.getState().diagnostics, before.diagnostics, 'the queue report did not change at this date boundary');
        assert.equal(store.getState().active, before.active); assert.equal(store.getState().details, details);
        assert.equal(notifications, 1);
        assert.equal(store.refreshDiagnostics(++now), false); assert.equal(notifications, 1);
    }
});

test('each operation captures one clock snapshot for diagnostics and filter membership', () => {
    let calls = 0;
    const store = new UserStore({now: () => NOW + calls++});
    store.setUserFilter('createdAt', 'last7d'); assert.equal(calls, 1);
    store.setUsers([account({createdAt: iso(NOW - 7 * DAY + 1)})]);
    assert.equal(calls, 2); assert.equal(store.getState().filtered.length, 1, 'the filter uses the exact same snapshot as diagnostics');
    store.setSearchQuery('a'); assert.equal(calls, 3);
    store.setDiagnosticFilter('all'); assert.equal(calls, 4);
    store.refreshDiagnostics(); assert.equal(calls, 5);
    store.refreshDiagnostics(NOW + 5); assert.equal(calls, 5, 'an explicit tick must not read a second clock');
});
