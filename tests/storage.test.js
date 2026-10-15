import test from 'node:test';
import assert from 'node:assert/strict';
import {StorageManager} from '../src/infrastructure/storage/StorageManager.js';
import {STORAGE_KEYS} from '../src/shared/constants/index.js';

test('unsupported saved editor mode falls back to the visible form', () => {
    const values = new Map();
    const local = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
    const storage = new StorageManager({local, session: local});
    local.setItem(STORAGE_KEYS.viewMode, 'invalid-mode');
    assert.equal(storage.getViewMode(), 'form');
    storage.setViewMode('json');
    storage.setViewMode('unknown');
    assert.equal(storage.getViewMode(), 'json');
});

test('blocked browser storage getters do not prevent construction or safe preference defaults', t => {
    const previousWindow = globalThis.window;
    t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
    for (const blocked of ['localStorage', 'sessionStorage']) {
        const memory = {getItem: () => null, setItem() {}, removeItem() {}};
        globalThis.window = Object.defineProperty({localStorage: memory, sessionStorage: memory}, blocked, {
            get() { throw new DOMException('Storage unavailable', 'SecurityError'); },
        });
        const storage = new StorageManager();
        assert.equal(storage.getLocale(), 'en');
        assert.equal(storage.getViewMode(), 'form');
        assert.equal(storage.getRefreshToken(), '');
        assert.deepEqual(storage.loadUserInfo(), {id: '', profileId: ''});
        assert.deepEqual([...storage.loadEditedSet()], []);
        assert.doesNotThrow(() => {
            storage.setLocale('ua'); storage.setViewMode('json'); storage.setRefreshToken('synthetic');
            storage.clearRefreshToken(); storage.clearUserInfo(); storage.persistEditedSet(new Set(['id']));
        });
    }
});

test('explicit storage injection does not access blocked browser getters', t => {
    const previousWindow = globalThis.window;
    t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
    globalThis.window = {get localStorage() { throw new Error('Must not access local storage'); },
        get sessionStorage() { throw new Error('Must not access session storage'); }};
    const memory = {getItem: () => null, setItem() {}, removeItem() {}};
    assert.doesNotThrow(() => new StorageManager({local: memory, session: memory}));
});
