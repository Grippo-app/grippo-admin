import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewQueue, ReviewQueue} from '../src/shared/components/ReviewQueue.js';

const item = id => ({id});
const finding = (severity, title = `${severity} title`, message = `${severity} message`) => ({severity, title, message});
const report = (...findings) => ({findings});
const pending = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
};
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.attributes = new Map();
        this.events = new Map();
        this.textWrites = 0;
        this._text = '';
        this.className = '';
        this.classList = {add: name => { this.className += ` ${name}`; }};
    }
    set textContent(value) { this._text = value; this.textWrites++; }
    get textContent() { return this._text; }
    set innerHTML(_) { throw new Error('Review queue data must not be parsed as HTML.'); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, callback) { this.events.set(name, callback); }
    removeEventListener(name) { this.events.delete(name); }
    click() { if (!this.disabled && !this.hidden) this.events.get('click')?.(); }
}

function setup(t, callbacks = {}) {
    const previousDocument = globalThis.document;
    globalThis.document = {createElement: tag => new Element(tag)};
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    const root = new Element('div');
    const queue = new ReviewQueue({root, getId: row => row.id, onSelect: () => {}, ...callbacks});
    const nodes = Object.fromEntries(['position', 'reason', 'status', 'actions', 'previous', 'next', 'why'].map(name => {
        const all = [...root.children, ...root.children.flatMap(child => child.children)];
        return [name, all.find(child => child.className.split(' ').includes(`review-queue__${name}`))];
    }));
    const a = item('a'), b = item('b'), c = item('c');
    const state = {items: [a, b, c], reports: new Map([
        ['a', report(finding('warning'))], ['b', report(finding('error'))], ['c', report(finding('info'))],
    ]), selectedId: 'a', enabled: true};
    queue.update(state);
    return {queue, root, nodes, state, a, b, c};
}

test('pure queue keeps current view order and unique IDs, excludes info and unverified records', () => {
    const a = item('a'), b = item('b'), info = item('info'), unknown = item('unknown');
    const warning = finding('warning'), error = finding('error');
    const reports = new Map([
        ['a', report(warning, error)], ['b', report(warning)], ['info', report(finding('info'))],
        ['unknown', {findings: [], checkedCount: 0, totalCount: 5}], ['global-only', report(error)],
    ]);
    const queue = buildReviewQueue([b, info, a, unknown, a, item(''), item(null)], reports, row => row.id);
    assert.deepEqual(queue.map(entry => entry.id), ['b', 'a']);
    assert.equal(queue[0].item, b);
    assert.equal(queue[1].report, reports.get('a'));
    assert.equal(queue[1].finding, error, 'primary issue is an error even when warning was evaluated first');
    assert.deepEqual(buildReviewQueue([], reports, row => row.id), []);
    assert.deepEqual(buildReviewQueue([a], null, row => row.id), []);
});

test('navigation uses confirmed selection, is bounded, and Start opens the first record in this view', async t => {
    const selected = [];
    const {queue, nodes, state, b} = setup(t, {onSelect: row => { selected.push(row); }});
    assert.equal(nodes.position.textContent, 'Record 1 of 2');
    assert.equal(nodes.previous.disabled, true);
    assert.equal(nodes.next.getAttribute('aria-label'), 'Next issue');
    nodes.next.click(); await flush();
    assert.deepEqual(selected, [b]);
    assert.equal(nodes.position.textContent, 'Record 1 of 2', 'resolved callback does not advance a local cursor');
    queue.update({...state, selectedId: 'b'});
    assert.equal(nodes.position.textContent, 'Record 2 of 2');
    assert.equal(nodes.next.disabled, true);
    assert.equal(nodes.previous.disabled, false);
    queue.update({...state, selectedId: 'c'});
    assert.match(nodes.status.textContent, /Selected record is outside this queue/);
    assert.equal(nodes.next.textContent, 'Start review');
    assert.equal(nodes.next.getAttribute('aria-label'), 'Start review');
    assert.equal(nodes.previous.hidden, true);
    nodes.next.click(); await flush();
    assert.equal(selected.at(-1), state.items[0]);
    queue.update({...state, items: [state.items[2]]});
    assert.equal(nodes.status.textContent, 'No flagged records in this view.');
    assert.equal(nodes.actions.hidden, true);
    assert.doesNotMatch(nodes.status.textContent, /passed|clean/i);
});

test('cancelling selection keeps the same position and next candidate without showing an error', async t => {
    const selected = [];
    const {nodes, b} = setup(t, {onSelect: row => { selected.push(row); return false; }});
    nodes.next.click(); await flush();
    assert.equal(nodes.position.textContent, 'Record 1 of 2');
    assert.equal(nodes.status.textContent, '');
    nodes.next.click(); await flush();
    assert.deepEqual(selected, [b, b]);
});

test('pending selection blocks double clicks and parent busy blocks all queue actions', async t => {
    const operation = pending();
    let calls = 0, canSelect;
    const {queue, nodes, state, root} = setup(t, {onSelect: (_, {isCurrent}) => {
        calls++; canSelect = isCurrent; return operation.promise;
    }});
    nodes.next.events.get('click')();
    nodes.next.events.get('click')();
    assert.equal(calls, 1);
    assert.equal(canSelect(), true);
    assert.equal(root.getAttribute('aria-busy'), 'true');
    assert.equal(nodes.next.disabled, true);
    queue.update({...state, busy: true});
    assert.equal(canSelect(), true, 'loading notifications do not invalidate this request');
    operation.resolve(); await flush();
    nodes.next.events.get('click')();
    assert.equal(calls, 1);
    queue.update(state);
    assert.equal(nodes.next.disabled, false);
    assert.equal(root.getAttribute('aria-busy'), 'false');
});

test('rejected selection is handled, reports a generic retry message, and preserves confirmed position', async t => {
    let calls = 0;
    const {nodes} = setup(t, {onSelect: () => { calls++; throw new Error('<private backend response>'); }});
    nodes.next.click(); await flush();
    assert.equal(nodes.position.textContent, 'Record 1 of 2');
    assert.equal(nodes.status.textContent, 'Could not open this record. Try again.');
    assert.doesNotMatch(nodes.status.textContent, /private/);
    assert.equal(nodes.next.disabled, false);
    nodes.next.click(); await flush();
    assert.equal(calls, 2);
});

test('filter or diagnostic source changes invalidate delayed selection without changing the selected record', async t => {
    const operation = pending();
    let canSelect;
    const {queue, nodes, state, a, b, c} = setup(t, {onSelect: (_, {isCurrent}) => {
        canSelect = isCurrent; return operation.promise;
    }});
    nodes.next.click();
    queue.update({...state, items: [b, a, c]});
    assert.equal(canSelect(), false, 'sort/filter change during a dirty confirmation cancels its old intent');
    operation.resolve(false); await flush();
    assert.equal(nodes.position.textContent, 'Record 2 of 2');
    assert.equal(nodes.next.disabled, true);

    const next = pending();
    let sourceIsCurrent;
    queue._onSelect = (_, {isCurrent}) => { sourceIsCurrent = isCurrent; return next.promise; };
    nodes.previous.click();
    assert.equal(sourceIsCurrent(), true);
    queue.update({...state, items: [b, a, c], reports: new Map(state.reports)});
    assert.equal(sourceIsCurrent(), false);
    next.reject(new Error('stale failure')); await flush();
    assert.equal(nodes.status.textContent, '');
});

test('an external selection during confirmation invalidates the old direction candidate', async t => {
    const operation = pending();
    let canSelect;
    const {queue, nodes, state} = setup(t, {onSelect: (_, {isCurrent}) => { canSelect = isCurrent; return operation.promise; }});
    nodes.next.click();
    queue.update({...state, selectedId: 'b'});
    assert.equal(canSelect(), false);
    queue.update(state);
    assert.equal(canSelect(), false, 'returning to the original record must not revive an old selection intent');
    operation.resolve(false); await flush();
    assert.equal(nodes.position.textContent, 'Record 1 of 2');
});

test('changing between two outside-queue selections invalidates Start even when its target is unchanged', async t => {
    const operation = pending();
    let canSelect;
    const {queue, nodes, state} = setup(t, {onSelect: (_, {isCurrent}) => { canSelect = isCurrent; return operation.promise; }});
    queue.update({...state, selectedId: 'outside-one'});
    nodes.next.click();
    assert.equal(canSelect(), true);
    queue.update({...state, selectedId: 'outside-two'});
    assert.equal(canSelect(), false);
    operation.resolve(false); await flush();
    assert.match(nodes.status.textContent, /outside this queue/);
});

test('disable/reset scrubs saved reason and invalidates pending callbacks without resurrecting prior-session state', async t => {
    const oldOperation = pending(), newOperation = pending();
    const checks = [];
    let calls = 0;
    const {queue, root, nodes, state} = setup(t, {onSelect: (_, {isCurrent}) => {
        checks.push(isCurrent); return calls++ ? newOperation.promise : oldOperation.promise;
    }});
    nodes.next.click();
    queue.update({enabled: false});
    assert.equal(checks[0](), false);
    assert.equal(root.hidden, true);
    for (const node of [nodes.reason, nodes.position, nodes.status]) assert.equal(node.textContent, '');
    assert.equal(nodes.reason.getAttribute('title'), null);
    nodes.next.events.get('click')();
    assert.equal(calls, 1);

    queue.update({...state, reports: new Map([['a', report(finding('warning', 'New session'))], ['b', report(finding('error'))]])});
    nodes.next.click();
    assert.equal(checks[1](), true);
    oldOperation.reject(new Error('old secret')); await flush();
    assert.equal(root.getAttribute('aria-busy'), 'true', 'old finally must not clear a new operation');
    assert.equal(checks[1](), true);
    assert.match(nodes.reason.textContent, /New session/);
    assert.doesNotMatch(nodes.status.textContent, /old secret|Could not/);
    newOperation.resolve(); await flush();
    assert.equal(root.getAttribute('aria-busy'), 'false');
});

test('status-only updates reuse the queue and static DOM, with cautious cached load-error copy', t => {
    let lookups = 0;
    const {queue, root, nodes, state} = setup(t, {getId: row => { lookups++; return row.id; }});
    const children = [...root.children], writes = nodes.reason.textWrites;
    assert.equal(lookups, 3);
    queue.update({...state, busy: true, loadError: '503 details'});
    queue.update({...state, busy: false, loadError: '503 details'});
    assert.equal(lookups, 3);
    assert.deepEqual(root.children, children);
    assert.equal(nodes.reason.textWrites, writes);
    assert.equal(nodes.status.textContent, 'Refresh failed. This review queue may be incomplete.');
    queue.update({...state, reports: new Map(state.reports)});
    assert.equal(lookups, 6);
});

test('an initial failed load never claims that saved checks were previously loaded or passed', t => {
    const {queue, nodes, state} = setup(t);
    queue.update({...state, items: [], reports: new Map(), selectedId: null, loadError: '503'});
    assert.equal(nodes.status.textContent, 'No flagged records in this view. Refresh failed. This review queue may be incomplete.');
    assert.equal(nodes.actions.hidden, true);
    assert.doesNotMatch(nodes.status.textContent, /previously|passed|clean/i);
});

test('reason data remains text and Why resolves only the currently confirmed saved report', async t => {
    const shown = [];
    const {queue, nodes, state, a} = setup(t, {onShowReason: entry => shown.push(entry)});
    const malicious = finding('warning', '<img src=x onerror=alert(1)>', '" onmouseover="private');
    const reports = new Map([['a', report(malicious)]]);
    queue.update({...state, reports});
    assert.equal(nodes.reason.textContent, `Saved record: Warning · ${malicious.title}`);
    assert.equal(nodes.reason.getAttribute('title'), malicious.message);
    nodes.why.click(); await flush();
    assert.equal(shown[0].item, a);
    assert.equal(shown[0].report, reports.get('a'));
    assert.equal(shown[0].finding, malicious);
    queue.update({...state, reports, selectedId: 'outside'});
    nodes.why.events.get('click')(); await flush();
    assert.equal(shown.length, 1);
    queue.update({enabled: false});
    nodes.why.events.get('click')(); await flush();
    assert.equal(shown.length, 1);
});

test('a delayed Why failure after disable cannot restore stale text or expose an unhandled rejection', async t => {
    const operation = pending();
    const {queue, root, nodes} = setup(t, {onShowReason: () => operation.promise});
    nodes.why.click();
    queue.update({enabled: false});
    operation.reject(new Error('private')); await flush();
    assert.equal(root.hidden, true);
    assert.equal(nodes.status.textContent, '');
});

test('a delayed Why failure cannot appear after selecting a different record and returning', async t => {
    const operation = pending();
    const {queue, nodes, state} = setup(t, {onShowReason: () => operation.promise});
    nodes.why.click();
    queue.update({...state, selectedId: 'b'});
    queue.update(state);
    operation.reject(new Error('stale reason')); await flush();
    assert.equal(nodes.status.textContent, '');
});

test('destroy removes listeners, clears private references and ignores later updates', t => {
    const {queue, root, nodes, state} = setup(t);
    queue.destroy();
    queue.update(state);
    assert.equal(root.hidden, true);
    assert.equal(nodes.reason.textContent, '');
    assert.equal(nodes.reason.getAttribute('title'), null);
    assert.equal(nodes.previous.events.size + nodes.next.events.size + nodes.why.events.size, 0);
});
