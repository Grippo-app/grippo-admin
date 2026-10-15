import test from 'node:test';
import assert from 'node:assert/strict';
import {LoadingIndicator, loadingDescription} from '../src/shared/components/LoadingIndicator.js';

function setup(t) {
    let now = 0, nextId = 0;
    const pending = new Map();
    t.mock.method(Date, 'now', () => now);
    t.mock.method(globalThis, 'setTimeout', (fn, delay) => { const id = ++nextId; pending.set(id, {fn, at: now + delay}); return id; });
    t.mock.method(globalThis, 'clearTimeout', id => pending.delete(id));
    const tick = ms => {
        const end = now + ms;
        while (true) {
            const next = [...pending].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > end) break;
            now = next[1].at; pending.delete(next[0]); next[1].fn();
        }
        now = end;
    };
    const root = {hidden: false};
    const labelEl = {textContent: 'previous'};
    const indicator = new LoadingIndicator({root, labelEl});
    return {root, labelEl, indicator, tick, pending};
}

test('global progress stays quiet for fast requests and uses the latest label for overlapping work', t => {
    const {root, labelEl, indicator, tick, pending} = setup(t);
    indicator.update('Loading exercises…'); tick(100); indicator.update(''); tick(100);
    assert.equal(root.hidden, true); assert.equal(pending.size, 0);
    indicator.update('Loading exercises…'); tick(60); indicator.update('Loading account details…'); tick(60);
    assert.equal(root.hidden, false); assert.equal(labelEl.textContent, 'Loading account details…');
});

test('visible progress keeps a minimum interval and continues smoothly when another operation starts', t => {
    const {root, labelEl, indicator, tick} = setup(t);
    indicator.update('First'); tick(120); indicator.update(''); tick(200);
    assert.equal(root.hidden, false);
    indicator.update('Second'); tick(100);
    assert.equal(root.hidden, false); assert.equal(labelEl.textContent, 'Second');
    indicator.update(''); tick(0);
    assert.equal(root.hidden, true); assert.equal(labelEl.textContent, '');
});

test('session reset immediately removes visible and pending progress without a late reappearance', t => {
    const {root, labelEl, indicator, tick, pending} = setup(t);
    indicator.update('Pending'); indicator.reset(); tick(500);
    assert.equal(root.hidden, true); assert.equal(pending.size, 0);
    indicator.update('Visible'); tick(120); indicator.update(''); indicator.reset(); tick(500);
    assert.equal(root.hidden, true); assert.equal(labelEl.textContent, ''); assert.equal(pending.size, 0);
});

test('global descriptions follow the visible workspace and retain background mutation feedback', () => {
    const state = {authenticated: true, section: 'exercise', exercise: {isLoading: true}, users: {isLoading: true}};
    assert.equal(loadingDescription(state), 'Loading exercises…');
    assert.equal(loadingDescription({...state, section: 'users'}), 'Loading users…');
    assert.equal(loadingDescription({...state, authenticated: false}), '');
    assert.equal(loadingDescription({...state, exercise: {}, section: 'users', users: {detailsLoading: true}}), 'Loading account details…');
    assert.equal(loadingDescription({...state, exercise: {isSaving: true}, section: 'users'}), 'Updating exercise…');
    assert.equal(loadingDescription({...state, exercise: {}, users: {deleteInFlight: true}}), 'Updating account…');
    assert.equal(loadingDescription({...state, exercise: {items: [{}], isLoading: true}}), 'Refreshing exercises…');
    assert.equal(loadingDescription({...state, section: 'users', users: {users: [{}], isLoading: true}}), 'Refreshing users…');
    assert.equal(loadingDescription({...state, exercise: {}, users: {}, dictionaryLoading: true}), 'Loading muscles and equipment…');
    assert.equal(loadingDescription({...state, section: 'users', users: {}, dictionaryLoading: true}), '');
});
