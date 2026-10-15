import test from 'node:test';
import assert from 'node:assert/strict';
import {UserEntity, UserDiagnostics, USER_DIAGNOSTIC_RULES, userProfileState} from '../src/domain/user/index.js';
import {UserStore} from '../src/features/users/UserStore.js';
import {UserController} from '../src/features/users/UserController.js';
import {UserListView} from '../src/features/users/UserListView.js';
import {UserDetailView} from '../src/features/users/UserDetailView.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Events} from '../src/infrastructure/events/events.js';
import {Toast} from '../src/shared/components/Toast.js';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const account = (id, patch = {}) => UserEntity.normalize({id, role: 'default', createdAt: new Date(NOW - 2 * DAY).toISOString(), profile: null, profileId: null, workoutsCount: 0, ...patch});
const report = user => UserDiagnostics.evaluate(user, {now: NOW});
const hasRule = (result, id) => result.findings.some(finding => finding.ruleId === id);
const overdue = 'user.profile-missing-after-24h';

test('profile review starts strictly after 24 hours, not at the exact boundary', () => {
    for (const age of [0, DAY - 1, DAY]) assert.equal(hasRule(report(account('a', {createdAt: new Date(NOW - age).toISOString()})), overdue), false);
    const result = report(account('a', {createdAt: new Date(NOW - DAY - 1).toISOString()}));
    assert.equal(hasRule(result, overdue), true);
    assert.equal(result.findings.find(finding => finding.ruleId === overdue).severity, 'warning');
    assert.match(result.findings.find(finding => finding.ruleId === overdue).message, /Review the registration/);
    assert.doesNotMatch(result.findings.map(finding => finding.message).join(' '), /delete|abandon|inactive/i);
});

test('missing or unknown profile fields do not mean an explicitly absent profile', () => {
    for (const raw of [
        {id: 'unknown', createdAt: new Date(NOW - 3 * DAY).toISOString()},
        {id: 'unknown', profile: undefined, profileId: null, createdAt: new Date(NOW - 3 * DAY).toISOString()},
        {id: 'unknown', profile: [], createdAt: new Date(NOW - 3 * DAY).toISOString()},
    ]) {
        const user = UserEntity.normalize(raw);
        assert.equal(userProfileState(user), 'unknown');
        const result = report(user);
        assert.equal(hasRule(result, overdue), false);
        assert.ok(result.skippedRuleIds.includes(overdue));
    }
    assert.equal(userProfileState(account('missing')), 'missing');
});

test('a present profile or a known profile ID prevents the aged no-profile flag', () => {
    for (const patch of [{profile: {id: 'p1'}, profileId: 'p1'}, {profile: {name: 'Present profile'}, profileId: null}, {profile: undefined, profileId: 'p1'}]) {
        const user = account('a', patch);
        assert.equal(userProfileState(user), 'present');
        assert.equal(hasRule(report(user), overdue), false);
    }
});

test('future, malformed, missing and impossible registration dates never infer overdue registration', () => {
    for (const date of [null, undefined, '', 'invalid', '2026-02-30T00:00:00.000Z', true, new Date(NOW + 1).toISOString()]) {
        assert.equal(hasRule(report(account('a', {createdAt: date})), overdue), false, String(date));
    }
    assert.equal(hasRule(report(account('future', {createdAt: new Date(NOW + 1).toISOString()})), 'user.registration-date-future'), true);
    for (const createdAt of ['invalid', '2026-02-30T00:00:00.000Z']) assert.equal(hasRule(report(account('invalid', {createdAt})), 'user.registration-date-invalid'), true);
    assert.equal(report(account('missing', {createdAt: null})).findings.length, 0);
});

test('ambiguous, timezoneless and impossible date strings never provide account-age evidence', () => {
    for (const createdAt of [
        '2026-02-30 12:00:00', '10/10/2026', '0', '2026-10-10',
        '2026-10-10T12:00:00', '2026-02-30T12:00:00+03:00',
        '2026-10-10T24:00:00Z',
    ]) {
        const result = report(account('a', {createdAt}));
        assert.equal(hasRule(result, overdue), false, createdAt);
        assert.ok(result.skippedRuleIds.includes(overdue), createdAt);
        assert.equal(hasRule(result, 'user.registration-date-invalid'), true, createdAt);
    }
});

test('explicit ISO offsets retain the strict 24-hour boundary and calendar validity', () => {
    for (const createdAt of ['2026-10-14T15:00:00+03:00', '2026-10-14T07:00:00-05:00']) {
        const user = account('a', {createdAt});
        assert.equal(hasRule(report(user), overdue), false);
        assert.equal(hasRule(UserDiagnostics.evaluate(user, {now: NOW + 1}), overdue), true);
        assert.equal(hasRule(report(user), 'user.registration-date-invalid'), false);
    }
    assert.equal(hasRule(report(account('leap', {createdAt: '2024-02-29T12:00:00+03:00'})), 'user.registration-date-invalid'), false);
    assert.equal(hasRule(report(account('not-leap', {createdAt: '2025-02-29T12:00:00+03:00'})), 'user.registration-date-invalid'), true);
    for (const createdAt of [NOW - 2 * DAY, new Date(NOW - 2 * DAY)]) assert.equal(hasRule(report(account('epoch', {createdAt})), overdue), true);
});

test('a contradictory profile ID is flagged as a reference issue, not an overdue missing profile', () => {
    for (const patch of [{profile: null, profileId: 'p1'}, {profile: {id: 'p1'}, profileId: 'p2'}, {profile: {id: 'p1'}, profileId: null}]) {
        const result = report(account('a', patch));
        assert.equal(hasRule(result, 'user.profile-id-mismatch'), true);
        assert.equal(hasRule(result, overdue), false);
    }
    assert.equal(hasRule(report(account('a', {profile: {id: 'p1'}, profileId: 'p1'})), 'user.profile-id-mismatch'), false);
});

test('a single canonical profile reference is sufficient when the redundant field is absent', () => {
    const base = {id: 'a', role: 'default', createdAt: new Date(NOW - DAY).toISOString(), workoutsCount: 0};
    for (const patch of [{profile: {id: 'p1'}}, {profileId: 'p1'}]) {
        const result = report(UserEntity.normalize({...base, ...patch}));
        assert.deepEqual(result.findings, []);
        assert.equal(result.checkedCount, USER_DIAGNOSTIC_RULES.length);
        assert.equal(result.skippedRuleIds.includes('user.profile-id-mismatch'), false);
    }
    for (const patch of [
        {profile: {id: 'p1'}, profileId: undefined},
        {profile: {id: 'p1'}, profileId: ''},
        {profileId: 'p1', profile: undefined},
        {profileId: 'p1', profile: {}},
        {profileId: 'p1', profile: []},
    ]) {
        const result = report(UserEntity.normalize({...base, ...patch}));
        assert.ok(result.skippedRuleIds.includes('user.profile-id-mismatch'));
    }
});

test('recorded workouts without an explicitly absent profile never trigger a data mismatch', () => {
    assert.equal(hasRule(report(account('a', {workoutsCount: 4})), 'user.workouts-without-profile'), true);
    assert.equal(hasRule(report(account('a', {workoutsCount: 4, profile: undefined, profileId: undefined})), 'user.workouts-without-profile'), false);
    assert.equal(hasRule(report(account('a', {workoutsCount: 0})), 'user.workouts-without-profile'), false);
});

test('diagnostics do not guess faults from Apple email, auth methods, activity or young registration', () => {
    const user = account('apple', {email: '', authTypes: [], lastActivity: null, createdAt: new Date(NOW - DAY / 2).toISOString()});
    assert.deepEqual(report(user).findings, []);
    assert.equal(report(user).checkedCount, USER_DIAGNOSTIC_RULES.length);
});

test('explicit unknown roles are reported while absent roles remain unverified', () => {
    const unknown = report(account('a', {role: '<script>administrator</script>'}));
    assert.equal(hasRule(unknown, 'user.role-unknown'), true);
    const absent = report(account('a', {role: undefined}));
    assert.equal(hasRule(absent, 'user.role-unknown'), false);
    assert.ok(absent.skippedRuleIds.includes('user.role-unknown'));
});

test('diagnostic filters intersect search and sorting without changing the selected user', () => {
    const store = new UserStore({now: () => NOW});
    const old = account('old', {name: 'Alice Old'});
    const young = account('young', {name: 'Alice Young', createdAt: new Date(NOW - DAY / 2).toISOString()});
    const other = account('other', {name: 'Bob', role: 'unexpected'});
    store.setUsers([old, young, other]);
    store.setActive(young);
    store.setDiagnosticFilter(`rule:${overdue}`);
    store.setSearchQuery('ALICE');
    store.setSortKey('email');
    assert.deepEqual(store.getState().filtered.map(user => user.id), ['old']);
    assert.equal(store.getState().active, young);
    store.setDiagnosticFilter('all');
    assert.deepEqual(store.getState().filtered.map(user => user.id), ['old', 'young']);
    store.setDiagnosticFilter('unknown-filter');
    assert.equal(store.getState().diagnosticFilter, 'all');
});

test('time refresh crosses the strict 24-hour boundary while stable ticks preserve reports, Map and focus observers', () => {
    const store = new UserStore({now: () => NOW});
    store.setUsers([account('a', {createdAt: new Date(NOW - DAY).toISOString()})]);
    const original = store.getState().diagnostics;
    let updates = 0;
    store.subscribe(() => updates++);
    assert.equal(store.refreshDiagnostics(NOW), false);
    assert.equal(store.getState().diagnostics, original);
    assert.equal(updates, 0);
    store.setDiagnosticFilter(`rule:${overdue}`);
    assert.equal(store.getState().filtered.length, 0);
    assert.equal(store.refreshDiagnostics(NOW + 1), true);
    assert.equal(store.getState().filtered[0].id, 'a');
    const changed = store.getState().diagnostics;
    const reportAfter = changed.get('a');
    assert.equal(store.refreshDiagnostics(NOW + 60_000), false);
    assert.equal(store.getState().diagnostics, changed);
    assert.equal(store.getState().diagnostics.get('a'), reportAfter);
});

test('user updates and removal recompute cached findings, and reset clears private diagnostic data', () => {
    const store = new UserStore({now: () => NOW});
    const original = account('a');
    store.setUsers([original]);
    store.setActive(original);
    store.setDiagnosticFilter('attention');
    assert.equal(store.getState().diagnosticSummary.attentionCount, 1);
    store.updateUser(account('a', {profile: {id: 'p1'}, profileId: 'p1'}));
    assert.equal(store.getState().diagnostics.get('a').findings.length, 0);
    assert.equal(store.getState().filtered.length, 0);
    assert.equal(store.getState().active.profileId, 'p1');
    store.removeUser('a');
    assert.equal(store.getState().diagnostics.size, 0);
    store.setUsers([original]);
    store.setActive(original);
    store.reset();
    assert.equal(store.getState().diagnostics.size, 0);
    assert.equal(store.getState().diagnosticFilter, 'all');
    assert.equal(store.getState().diagnosticSummary.recordCount, 0);
    assert.equal(store.getState().active, null);
});


test('malformed or unavailable workout counts stay unverified instead of coercing to a clean zero', () => {
    for (const workoutsCount of [undefined, null, '', ' ', [], {}, true, -1, 1.5, 'invalid']) {
        const result = report(account('a', {workoutsCount}));
        assert.ok(result.skippedRuleIds.includes('user.workouts-without-profile'), String(workoutsCount));
        assert.equal(hasRule(result, 'user.workouts-without-profile'), false);
    }
});

test('list badges escape API values, keep young accounts neutral, and do not call unknown profiles missing', () => {
    const view = Object.create(UserListView.prototype);
    const malicious = account('a', {role: '<script>alert(1)</script>', profile: {id: 'profile-a'}, profileId: 'profile-a'});
    const html = view._userItem(malicious, false, report(malicious));
    assert.match(html, /diagnostic-badge--warning/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    const young = account('young', {createdAt: new Date(NOW - DAY / 2).toISOString()});
    const youngHtml = view._userItem(young, false, report(young));
    assert.doesNotMatch(youngHtml, /No profile|diagnostic-badge/);
    const unknown = account('unknown', {profile: undefined, profileId: undefined});
    assert.doesNotMatch(view._userItem(unknown, false, report(unknown)), /No profile|diagnostic-badge/);
});

test('diagnostic filter options and summary render exact counts and unverified records', () => {
    const store = new UserStore({now: () => NOW});
    store.setUsers([account('old'), account('young', {createdAt: new Date(NOW - DAY / 2).toISOString()}), account('unknown', {profile: undefined, profileId: undefined})]);
    const view = Object.create(UserListView.prototype);
    view._els = {qualityFilter: {innerHTML: '', value: ''}, qualitySummary: {textContent: ''}};
    view._renderDiagnosticControls(store.getState());
    assert.match(view._els.qualitySummary.textContent, /1 of 3 need review/);
    assert.match(view._els.qualitySummary.textContent, /1 partially checked/);
    assert.match(view._els.qualityFilter.innerHTML, /rule:user.profile-missing-after-24h/);
    store.setDiagnosticFilter('unverified');
    assert.deepEqual(store.getState().filtered.map(user => user.id), ['unknown']);
});

function diagnosticView(store) {
    const view = Object.create(UserDetailView.prototype);
    view._store = store;
    view._els = {userDiagnostics: {innerHTML: '', hidden: true}};
    view._renderedSections = new Map();
    view._lastActive = null;
    view.writes = 0;
    view._setBody = (body, html) => { body.innerHTML = html; view.writes++; };
    return view;
}

test('detail diagnostics retain disclosure DOM across details notifications and stable clock ticks', () => {
    const store = new UserStore({now: () => NOW});
    const user = account('a');
    store.setUsers([user]);
    store.setActive(user);
    const view = diagnosticView(store);
    view.render();
    assert.equal(view.writes, 1);
    view._els.userDiagnostics.innerHTML += '<span>Expanded by the reviewer</span>';
    store.setDetailsLoading('a');
    view.render();
    store.setDetails('a', {goal: null, recentTrainings: [], weightHistory: [], deviceTokens: [], errors: {deviceTokens: '404'}});
    view.render();
    store.refreshDiagnostics(NOW + 60_000);
    view.render();
    assert.equal(view.writes, 1);
    assert.match(view._els.userDiagnostics.innerHTML, /Expanded by the reviewer/);
    assert.doesNotMatch(view._els.userDiagnostics.innerHTML, /404/);
    store.clearActive();
    view.render();
    assert.equal(view._els.userDiagnostics.innerHTML, '');
    assert.equal(view._els.userDiagnostics.hidden, true);
});

test('unknown profile data is explained as incomplete in details without a missing-profile warning', () => {
    const store = new UserStore({now: () => NOW});
    const user = account('a', {profile: undefined, profileId: undefined});
    store.setUsers([user]);
    store.setActive(user);
    const view = diagnosticView(store);
    view.render();
    assert.match(view._els.userDiagnostics.innerHTML, /Profile checks are incomplete/);
    assert.doesNotMatch(view._els.userDiagnostics.innerHTML, /diagnostic-item--warning|Warning: Registration needs review/);
    assert.match(view._els.userDiagnostics.innerHTML, /Not verified: Registration needs review/);
});

test('session reset clears cached diagnostics, active report and rendered private diagnostic messages', () => {
    const store = new UserStore({now: () => NOW});
    const bus = new EventBus();
    new UserController({store, bus, repository: {}, confirmDialog: {}});
    const user = account('a', {role: 'private-custom-role'});
    store.setUsers([user]);
    store.setActive(user);
    const view = diagnosticView(store);
    view.render();
    assert.match(view._els.userDiagnostics.innerHTML, /private-custom-role/);
    bus.emit(Events.AUTH_SESSION_EXPIRED);
    view.render();
    assert.equal(store.getState().diagnostics.size, 0);
    assert.equal(store.getState().active, null);
    assert.equal(view._els.userDiagnostics.innerHTML, '');
});

test('role updates preserve display metrics without fabricating available raw aggregate evidence', async t => {
    t.mock.method(Toast, 'show', () => {});
    for (const workoutsCount of [undefined, 'invalid', []]) {
        const store = new UserStore({now: () => NOW});
        const user = account('a', {workoutsCount, lastActivity: '2026-10-14T10:00:00.000Z'});
        if (workoutsCount === undefined) delete user.raw.workoutsCount;
        store.setUsers([user]);
        store.setActive(user);
        const controller = new UserController({store, bus: new EventBus(), confirmDialog: {}, repository: {
            setRole: async () => ({id: 'a', role: 'admin', workoutsCount: 0, lastActivity: null}),
        }});
        await controller.changeRole('admin');
        const updated = store.getState().active;
        assert.equal(updated.workoutsCount, user.workoutsCount);
        assert.equal(updated.lastActivity, user.lastActivity);
        assert.equal(Object.hasOwn(updated.raw, 'workoutsCount'), workoutsCount !== undefined);
        if (workoutsCount !== undefined) assert.equal(updated.raw.workoutsCount, workoutsCount);
        assert.ok(store.getState().diagnostics.get('a').skippedRuleIds.includes('user.workouts-without-profile'));
    }
});
