import test from 'node:test';
import assert from 'node:assert/strict';
import {UserEntity} from '../src/domain/user/UserEntity.js';
import {UserDetailsEntity} from '../src/domain/user/UserDetailsEntity.js';
import {UserStore} from '../src/features/users/UserStore.js';
import {UserDetailView} from '../src/features/users/UserDetailView.js';

class Element {
    constructor(parent = null) {
        this.parent = parent; this.dataset = {}; this.scrollTop = 0; this.open = false;
        this.textContent = ''; this.hidden = false; this.attributes = {};
        this.classList = {toggle() {}};
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    contains(element) {
        for (let current = element; current; current = current.parent) if (current === this) return true;
        return false;
    }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
}

// Model the native details/button nodes that innerHTML replaces, including focus loss.
class WeightBody extends Element {
    get innerHTML() { return this._html || ''; }
    set innerHTML(value) {
        if (this.contains(document.activeElement)) document.activeElement = null;
        if (this.measurements) this.measurements.scrollTop = 0;
        this._html = value; this.scrollTop = 0; this.measurements = null; this.more = null;
        if (/<details class="weight-measurements"/.test(value)) {
            this.measurements = new Element(this);
            this.measurements.summary = new Element(this.measurements);
            this.measurements.querySelector = selector => selector === 'summary' ? this.measurements.summary : null;
            this.measurements.open = /<details class="weight-measurements"[^>]*\bopen(?:[\s=>])/.test(value);
            if (value.includes('data-user-action="more-weights"')) {
                this.more = new Element(this.measurements); this.more.dataset.userAction = 'more-weights';
            }
        }
    }
    querySelector(selector) { return selector === '.weight-measurements' ? this.measurements : null; }
    querySelectorAll(selector) { return selector === 'button' && this.more ? [this.more] : []; }
    closest(selector) { return selector === 'details:not([open])' && !this.section?.open ? this.section : null; }
}

const user = (id, workoutsCount = 3) => UserEntity.normalize({id, role: 'default', email: `${id}@example.test`, workoutsCount, profile: {id: `p-${id}`}});
const weights = (length = 30, start = 80) => UserDetailsEntity.normalizeWeightHistory(Array.from({length}, (_, index) =>
    ({weight: start + index / 10, createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString()})));
const details = weightHistory => ({goal: null, recentTrainings: [], deviceTokens: [], errors: {}, weightHistory});

function setup(t, entries = weights()) {
    const previousDocument = globalThis.document;
    globalThis.document = {activeElement: null};
    t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
    const store = new UserStore();
    const view = Object.create(UserDetailView.prototype);
    view._store = store; view._lastActive = null; view._renderedSections = new Map();
    view._els = Object.fromEntries(['panel', 'userDetail', 'accountDetails', 'accountActions', 'userEmailEl', 'goalBody', 'goalSummary',
        'trainingsBody', 'trainingsCount', 'weightSummary', 'deviceTokensBody', 'deviceTokensSummary'].map(key => [key, new Element()]));
    view._els.weightBody = new WeightBody();
    view._els.sectionElements = Object.fromEntries(['goal', 'recentTrainings', 'weightHistory', 'deviceTokens'].map(key => [key, new Element()]));
    view._els.weightBody.section = view._els.sectionElements.weightHistory;
    view._els.weightBody.section.summary = new Element(view._els.weightBody.section);
    view._els.weightBody.section.querySelector = selector => selector === 'summary' ? view._els.weightBody.section.summary : null;
    store.subscribe(() => view.render()); view.render();
    const a = user('a'); store.setUsers([a]); store.setActive(a); store.setDetails(a.id, details(entries));
    return {store, view, body: view._els.weightBody, a};
}

test('weight overview and caveats remain visible while the exact measurement table starts closed', t => {
    const entries = [{weight: 50, createdAt: ''}, {weight: 80, createdAt: '2026-01-01'}, {weight: 81, createdAt: '2026-01-01'}];
    const {body} = setup(t, entries);
    assert.ok(body.measurements);
    assert.equal(body.measurements.open, false);
    assert.match(body.innerHTML, /<summary>Measurements \(3\)<\/summary>/);
    const [overview, table] = body.innerHTML.split('<details class="weight-measurements"');
    assert.match(overview, /weight-overview/); assert.match(overview, /weight-trend/);
    assert.match(overview, /undated record/); assert.match(overview, /share timestamps/);
    assert.match(table, /weight-table-head/); assert.equal((table.match(/class="weight-row"/g) || []).length, 3);
});

test('same-user refresh preserves manual measurement disclosure, scroll and focused summary', t => {
    const {store, body} = setup(t);
    body.section.open = true;
    const old = body.measurements;
    old.open = true; old.scrollTop = 17; body.scrollTop = 121; old.summary.focus();
    store.setDetails('a', details(weights(30, 81)));
    assert.notEqual(body.measurements, old, 'changed records really rendered new native nodes');
    assert.equal(body.measurements.open, true); assert.equal(body.measurements.scrollTop, 17); assert.equal(body.scrollTop, 121);
    assert.equal(document.activeElement, body.measurements.summary);
    assert.deepEqual(document.activeElement.focusOptions, {preventScroll: true});
    body.measurements.open = false;
    store.setDetails('a', details(weights(30, 82)));
    assert.equal(body.measurements.open, false, 'a manually closed table stays closed too');
    const current = body.measurements;
    store.setDetailsLoading('a', ['weightHistory']);
    store.setDetailSection('a', 'weightHistory', {error: '503 unavailable'});
    assert.equal(body.measurements, current, 'cached retry/error notifications retain the exact disclosure node');
});

test('Show more keeps the table open and returns focus to its summary when the final button disappears', t => {
    const {store, body} = setup(t);
    body.section.open = true;
    body.measurements.open = true; body.scrollTop = 103; body.more.focus();
    const chart = body.innerHTML.split('<details class="weight-measurements"')[0];
    store.showMoreWeights();
    assert.equal(body.measurements.open, true); assert.equal(body.scrollTop, 103);
    assert.equal(document.activeElement, body.more); assert.deepEqual(body.more.focusOptions, {preventScroll: true});
    assert.equal((body.innerHTML.match(/class="weight-row"/g) || []).length, 24);
    assert.equal(body.innerHTML.split('<details class="weight-measurements"')[0], chart, 'the plotted full history does not change with table pagination');
    store.showMoreWeights();
    assert.equal(body.measurements.open, true); assert.equal(body.scrollTop, 103); assert.equal(body.more, null);
    assert.equal(document.activeElement, body.measurements.summary);
    assert.deepEqual(document.activeElement.focusOptions, {preventScroll: true});
    assert.equal((body.innerHTML.match(/class="weight-row"/g) || []).length, 30);
});

test('rerender after the weight section closes repairs focus to its visible outer summary', t => {
    const {store, body} = setup(t);
    body.section.open = true; body.measurements.open = true; body.more.focus();
    body.section.open = false;
    store.showMoreWeights();
    assert.equal(document.activeElement, body.section.summary);
    assert.equal(body.section.open, false, 'focus repair does not reopen a section the user closed');
    assert.deepEqual(document.activeElement.focusOptions, {preventScroll: true});
});

test('true selection changes close every section and reset measurement state; logout removes private table nodes', t => {
    const {store, view, body, a} = setup(t);
    for (const section of Object.values(view._els.sectionElements)) section.open = true;
    body.measurements.open = true; body.scrollTop = 111; body.measurements.scrollTop = 20;
    const b = user('b', 12); store.setUsers([a, b]); store.setActive(b); store.setDetails('b', details(weights(2, 65)));
    assert.equal(Object.values(view._els.sectionElements).some(section => section.open), false);
    assert.equal(body.measurements.open, false); assert.equal(body.measurements.scrollTop, 0); assert.equal(body.scrollTop, 0);
    assert.doesNotMatch(body.innerHTML, /82\.9 kg/);
    store.reset();
    assert.equal(body.innerHTML, ''); assert.equal(body.measurements, null);
});
