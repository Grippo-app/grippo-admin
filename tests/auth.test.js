import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiClient} from '../src/infrastructure/http/ApiClient.js';
import {AuthService} from '../src/features/auth/AuthService.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Events} from '../src/infrastructure/events/events.js';

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return {promise, resolve};
}
function setup(t) {
    const storage = {
        refresh: '',
        getRefreshToken() { return this.refresh; },
        setRefreshToken(token) { this.refresh = token; },
        clearRefreshToken() { this.refresh = ''; },
        clearUserInfo() {},
    };
    let expired = 0;
    const api = new ApiClient({storage, getLocale: () => 'en', onSessionExpired: () => expired++});
    api.setTokens('access', 'refresh');
    t.after(() => api.clearAuthToken());
    return {api, storage, expired: () => expired};
}
const tokenResponse = () => Response.json({accessToken: 'renewed', refreshToken: 'rotated'});

test('refresh resolving after logout cannot restore tokens', async t => {
    const {api, storage} = setup(t);
    const pending = deferred();
    t.mock.method(globalThis, 'fetch', () => pending.promise);
    const refresh = api.silentRefresh();
    api.clearAuthToken();
    pending.resolve(tokenResponse());
    assert.equal(await refresh, false);
    assert.equal(api.authToken, '');
    assert.equal(storage.refresh, '');
});

test('old refresh failure cannot expire a newer login', async t => {
    const {api, expired} = setup(t);
    const pending = deferred();
    t.mock.method(globalThis, 'fetch', () => pending.promise);
    const refresh = api.silentRefresh();
    api.setTokens('new-login', 'new-refresh');
    pending.resolve(new Response(null, {status: 401}));
    assert.equal(await refresh, false);
    assert.equal(api.authToken, 'new-login');
    assert.equal(expired(), 0);
});

test('protected caller joining a failed background refresh expires once', async t => {
    const {api, expired, storage} = setup(t);
    const pending = deferred();
    t.mock.method(globalThis, 'fetch', () => pending.promise);
    const background = api.silentRefresh({force: false});
    const protectedRefresh = api.silentRefresh({force: true});
    pending.resolve(new Response(null, {status: 401}));
    assert.deepEqual(await Promise.all([background, protectedRefresh]), [false, false]);
    assert.equal(expired(), 1);
    assert.equal(storage.refresh, '');
    assert.equal(api._refreshTimer, null);
});

test('background refresh failure preserves the session and schedules retry', async t => {
    const {api, expired} = setup(t);
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
    assert.equal(await api.silentRefresh({force: false}), false);
    assert.equal(api.authToken, 'access');
    assert.equal(expired(), 0);
    assert.ok(api._refreshTimer);
});

test('a protected retry that still returns 401 expires the session', async t => {
    const {api, expired} = setup(t);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => ++calls === 2
        ? tokenResponse() : new Response(null, {status: 401}));
    const result = await api._fetch('/protected', {headers: api.buildHeaders()});
    assert.equal(result.status, 401);
    assert.equal(calls, 3);
    assert.equal(expired(), 1);
    assert.equal(api.authToken, '');
});

test('a public request returning 401 does not refresh or expire auth', async t => {
    const {api, expired} = setup(t);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, {status: 401}); });
    await api._fetch('/public', {headers: api.buildHeaders({auth: false})});
    assert.equal(calls, 1);
    assert.equal(api.authToken, 'access');
    assert.equal(expired(), 0);
});

test('a response from the previous login cannot refresh the new session', async t => {
    const {api, expired} = setup(t);
    const pending = deferred();
    let calls = 0;
    t.mock.method(globalThis, 'fetch', () => { calls++; return pending.promise; });
    const request = api._fetch('/protected', {headers: api.buildHeaders()});
    api.setTokens('new-login', 'new-refresh');
    pending.resolve(new Response(null, {status: 401}));
    await request;
    assert.equal(calls, 1);
    assert.equal(api.authToken, 'new-login');
    assert.equal(expired(), 0);
});

test('logout during current-user lookup suppresses late login-success', async t => {
    const {api, storage} = setup(t);
    const bus = new EventBus();
    const user = deferred();
    const auth = new AuthService({apiClient: api, storage, bus, userRepository: {fetchCurrentUser: () => user.promise}});
    let logins = 0;
    bus.on(Events.AUTH_LOGIN_SUCCESS, () => logins++);
    t.mock.method(api, 'login', async () => ({accessToken: 'login', refreshToken: 'login-refresh'}));
    const login = auth.login({email: 'admin@example.test', password: 'fixture'});
    await Promise.resolve();
    await auth.logout();
    user.resolve({id: 'admin'});
    assert.equal(await login, false);
    assert.equal(logins, 0);
    assert.equal(api.authToken, '');
});

test('expired current-user lookup cannot emit login-success', async t => {
    const {api, storage} = setup(t);
    const bus = new EventBus();
    let logins = 0;
    let expirations = 0;
    const auth = new AuthService({apiClient: api, storage, bus, userRepository: {fetchCurrentUser: async () => {
        api.onSessionExpired();
        throw new Error('401');
    }}});
    bus.on(Events.AUTH_LOGIN_SUCCESS, () => logins++);
    bus.on(Events.AUTH_SESSION_EXPIRED, () => expirations++);
    t.mock.method(api, 'login', async () => ({accessToken: 'login', refreshToken: 'login-refresh'}));
    assert.equal(await auth.login({}), false);
    assert.equal(logins, 0);
    assert.equal(expirations, 1);
});

test('malformed refresh success is rejected without clearing a background session', async t => {
    const {api, expired} = setup(t);
    t.mock.method(globalThis, 'fetch', async () => Response.json({refreshToken: 'bad'}));
    assert.equal(await api.silentRefresh({force: false}), false);
    assert.equal(api.authToken, 'access');
    assert.equal(expired(), 0);
});

test('late 401 reuses an already renewed token without another refresh', async t => {
    const {api, expired} = setup(t);
    const slow = deferred();
    let refreshCalls = 0;
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
        if (url.includes('/auth/refresh')) { refreshCalls++; return tokenResponse(); }
        calls.push(new Headers(options.headers).get('authorization'));
        return calls.length === 1 ? slow.promise : Response.json({ok: true});
    });
    const request = api._fetch('/slow', {headers: api.buildHeaders()});
    await api.silentRefresh({force: false});
    slow.resolve(new Response(null, {status: 401}));
    assert.equal((await request).status, 200);
    assert.equal(refreshCalls, 1);
    assert.deepEqual(calls, ['Bearer access', 'Bearer renewed']);
    assert.equal(expired(), 0);
});

test('sign-in HTTP failures distinguish credentials, validation, throttling and service outages without exposing bodies', async t => {
    const {api} = setup(t);
    const cases = [
        [400, /Check the email and password fields/],
        [401, /Invalid email or password/],
        [403, /access was denied/],
        [408, /timed out/],
        [429, /Too many sign-in attempts/],
        [500, /temporarily unavailable/],
        [502, /temporarily unavailable/],
        [418, /Sign-in failed/],
    ];
    let status;
    t.mock.method(globalThis, 'fetch', async () => Response.json({message: 'private server response marker'}, {status}));
    for (const [code, expected] of cases) {
        status = code;
        await assert.rejects(api.login({email: 'fixture@example.test', password: 'fixture'}), error => {
            assert.match(error.message, expected);
            assert.match(error.message, new RegExp(`HTTP ${code}`));
            assert.doesNotMatch(error.message, /private server response marker/);
            return true;
        });
    }
});

test('sign-in connection errors and malformed success responses produce safe actionable messages', async t => {
    const {api} = setup(t);
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('private network diagnostic'); });
    await assert.rejects(api.login({}), error => {
        assert.match(error.message, /Unable to connect/);
        assert.doesNotMatch(error.message, /private network diagnostic/);
        return true;
    });
    fetch.mock.mockImplementation(async () => new Response('<html>private response marker</html>'));
    await assert.rejects(api.login({}), error => {
        assert.match(error.message, /unreadable response/);
        assert.doesNotMatch(error.message, /private response marker/);
        return true;
    });
});

test('login rejects malformed tokens before persisting or loading a user', async t => {
    const {api, storage} = setup(t);
    const bus = new EventBus();
    let loads = 0;
    const auth = new AuthService({apiClient: api, storage, bus, userRepository: {fetchCurrentUser: async () => { loads++; }}});
    for (const data of [null, {}, {accessToken: {}}, {accessToken: 42}]) {
        t.mock.method(api, 'login', async () => data);
        await assert.rejects(auth.login({}), /access token/);
    }
    assert.equal(loads, 0);
    assert.equal(api.authToken, 'access');
    assert.equal(storage.refresh, 'refresh');
});

test('a late retry 401 cannot expire a token renewed again while that retry was pending', async t => {
    const {api, expired, storage} = setup(t);
    const pendingRetry = deferred();
    const retryStarted = deferred();
    let refreshes = 0;
    let protectedCalls = 0;
    t.mock.method(globalThis, 'fetch', async url => {
        if (url.includes('/auth/refresh')) return Response.json({accessToken: `renewed-${++refreshes}`, refreshToken: `rotated-${refreshes}`});
        if (++protectedCalls === 1) return new Response(null, {status: 401});
        retryStarted.resolve();
        return pendingRetry.promise;
    });
    const request = api._fetch('/protected', {headers: api.buildHeaders()});
    await retryStarted.promise;
    assert.equal(await api.silentRefresh({force: false}), true);
    pendingRetry.resolve(new Response(null, {status: 401}));
    assert.equal((await request).status, 401);
    assert.equal(api.authToken, 'renewed-2');
    assert.equal(storage.refresh, 'rotated-2');
    assert.equal(expired(), 0);
    assert.equal(protectedCalls, 2, 'no additional HTTP replay is introduced');
    assert.equal(refreshes, 2);
});
