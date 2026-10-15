import test from 'node:test';
import assert from 'node:assert/strict';
import {ConfirmDialog} from '../src/shared/components/ConfirmDialog.js';
import {SortMenu} from '../src/shared/components/SortMenu.js';
import {Toast} from '../src/shared/components/Toast.js';

class Element {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.dataset = {};
        this.style = {};
        this.hidden = false;
        this.disabled = false;
        this.isConnected = true;
        this.tabIndex = tag === 'button' ? 0 : -1;
        this.className = '';
        this.offsetWidth = 180;
        this.offsetHeight = 150;
        this.classList = {
            add: (...names) => this.className = [...new Set([...this.className.split(' '), ...names])].join(' ').trim(),
            remove: (...names) => this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '),
        };
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(name, handler) {
        if (!this.listeners.has(name)) this.listeners.set(name, []);
        this.listeners.get(name).push(handler);
    }
    dispatch(name, props = {}) {
        const event = {target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...props};
        for (const handler of this.listeners.get(name) || []) handler(event);
        return event;
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    contains(child) { return child === this || this.children.some(element => element.contains(child)); }
    closest(selector) {
        if (selector === '.sort-dropdown' && this.className.split(' ').includes('sort-dropdown')) return this;
        if (selector.includes('[hidden]') && this.hidden) return this;
        return this.parentElement?.closest(selector) || null;
    }
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
    getClientRects() { return this.hidden ? [] : [{}]; }
    getBoundingClientRect() { return this.rect || {top: 20, left: 20, bottom: 50, right: 120}; }
    focus() { document.activeElement = this; }
    remove() {
        this.isConnected = false;
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    }
    set innerHTML(value) { this.children = []; }
}

function setupDocument() {
    globalThis.document = new Element();
    document.body = new Element('body');
    document.createElement = tag => new Element(tag);
    document.activeElement = new Element('button');
    globalThis.window = new Element();
    window.innerWidth = 1000;
    window.innerHeight = 700;
}

function dialogElements() {
    const overlay = new Element();
    overlay.hidden = true;
    const els = {overlay};
    for (const key of ['closeBtn', 'cancelBtn', 'acceptBtn']) els[key] = overlay.appendChild(new Element('button'));
    for (const key of ['titleEl', 'messageEl', 'detailEl', 'actionLabelEl']) els[key] = new Element();
    ConfirmDialog._initialized = false;
    ConfirmDialog._resolver = null;
    ConfirmDialog.init(els);
    return els;
}

test('confirmation defaults to cancel, traps keyboard focus, and restores the trigger', async () => {
    setupDocument();
    const trigger = document.activeElement;
    const els = dialogElements();
    const result = ConfirmDialog.ask({title: 'Delete user?'});
    assert.equal(els.overlay.hidden, false);
    assert.equal(document.activeElement, els.cancelBtn);
    els.acceptBtn.focus();
    assert.equal(document.dispatch('keydown', {key: 'Tab'}).defaultPrevented, true);
    assert.equal(document.activeElement, els.closeBtn);
    document.dispatch('keydown', {key: 'Tab', shiftKey: true});
    assert.equal(document.activeElement, els.acceptBtn);
    trigger.focus();
    document.dispatch('focusin', {target: trigger});
    assert.equal(document.activeElement, els.cancelBtn);
    document.dispatch('keydown', {key: 'Escape'});
    assert.equal(await result, false);
    assert.equal(els.overlay.hidden, true);
    assert.equal(document.activeElement, trigger);
});

test('replacing a confirmation settles the earlier request and preserves the original focus', async () => {
    setupDocument();
    const trigger = document.activeElement;
    const els = dialogElements();
    const first = ConfirmDialog.ask({title: 'First'});
    const second = ConfirmDialog.ask({title: 'Second'});
    assert.equal(await first, false);
    assert.equal(els.titleEl.textContent, 'Second');
    els.acceptBtn.dispatch('click');
    assert.equal(await second, true);
    assert.equal(document.activeElement, trigger);
});

test('confirmation fails closed when its overlay is unavailable', async () => {
    setupDocument();
    ConfirmDialog._els = null;
    assert.equal(await ConfirmDialog.ask(), false);
});

test('confirmation can cancel from the backdrop and does not restore disconnected focus', async () => {
    setupDocument();
    const trigger = document.activeElement;
    const els = dialogElements();
    const result = ConfirmDialog.ask();
    trigger.isConnected = false;
    els.overlay.dispatch('click');
    assert.equal(await result, false);
    assert.notEqual(document.activeElement, trigger);
});

test('confirmation remains keyboard-safe when all action buttons are disabled', async () => {
    setupDocument();
    const els = dialogElements();
    els.cancelBtn.disabled = els.closeBtn.disabled = els.acceptBtn.disabled = true;
    const result = ConfirmDialog.ask();
    assert.equal(document.activeElement, els.overlay);
    assert.equal(document.dispatch('keydown', {key: 'Tab'}).defaultPrevented, true);
    document.dispatch('keydown', {key: 'Escape'});
    assert.equal(await result, false);
});

test('session transitions can cancel an active confirmation without leaving pending actions', async () => {
    setupDocument();
    const els = dialogElements();
    const result = ConfirmDialog.ask({actionLabel: 'Delete'});
    ConfirmDialog.cancel();
    assert.equal(await result, false);
    assert.equal(els.overlay.hidden, true);
    const trigger = new Element('button');
    trigger.focus();
    ConfirmDialog.cancel();
    assert.equal(document.activeElement, trigger);
});

test('resolved confirmations scrub private text while preserving cancel, accept, and focus behavior', async () => {
    for (const action of ['cancel', 'accept', 'escape']) {
        setupDocument();
        const trigger = document.activeElement;
        const els = dialogElements();
        const result = ConfirmDialog.ask({title: 'Private account', message: 'synthetic-private-email',
            detail: 'synthetic-private-detail', actionLabel: 'Private action'});
        if (action === 'cancel') ConfirmDialog.cancel();
        if (action === 'accept') els.acceptBtn.dispatch('click');
        if (action === 'escape') document.dispatch('keydown', {key: 'Escape'});
        assert.equal(await result, action === 'accept');
        assert.equal(els.overlay.hidden, true);
        assert.equal(document.activeElement, trigger);
        for (const key of ['titleEl', 'messageEl', 'detailEl', 'actionLabelEl']) assert.equal(els[key].textContent, '', key);
        assert.equal(els.detailEl.hidden, true);
        const next = ConfirmDialog.ask({title: 'Fresh confirmation', message: 'Safe text'});
        assert.equal(els.titleEl.textContent, 'Fresh confirmation');
        assert.equal(els.messageEl.textContent, 'Safe text');
        ConfirmDialog.cancel();
        assert.equal(await next, false);
    }
});

function sortElements(onChange = () => {}) {
    const container = new Element();
    container.className = 'sort-dropdown';
    const toggle = container.appendChild(new Element('button'));
    const menu = container.appendChild(new Element());
    const label = new Element();
    const sort = new SortMenu({
        toggleEl: toggle,
        menuEl: menu,
        labelEl: label,
        options: {name: {label: 'Name'}, date: {label: 'Date'}, image: {label: 'Image'}},
        active: 'date',
        onChange,
    });
    return {container, toggle, menu, label, sort};
}

test('sort popup supports arrows, Home/End, type-ahead, Escape, and restores focus after selection', () => {
    setupDocument();
    const selections = [];
    const {sort, toggle, menu, label} = sortElements(key => selections.push(key));
    toggle.dispatch('click');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(document.activeElement.dataset.key, 'date');
    menu.dispatch('keydown', {key: 'ArrowDown'});
    assert.equal(document.activeElement.dataset.key, 'image');
    menu.dispatch('keydown', {key: 'ArrowDown'});
    assert.equal(document.activeElement.dataset.key, 'name');
    menu.dispatch('keydown', {key: 'ArrowUp'});
    assert.equal(document.activeElement.dataset.key, 'image');
    menu.dispatch('keydown', {key: 'Home'});
    assert.equal(document.activeElement.dataset.key, 'name');
    menu.dispatch('keydown', {key: 'End'});
    assert.equal(document.activeElement.dataset.key, 'image');
    menu.dispatch('keydown', {key: 'd'});
    assert.equal(document.activeElement.dataset.key, 'date');
    document.dispatch('keydown', {key: 'Escape'});
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(document.activeElement, toggle);
    toggle.dispatch('keydown', {key: 'ArrowDown'});
    assert.equal(document.activeElement.dataset.key, 'name');
    document.activeElement.dispatch('click');
    assert.deepEqual(selections, ['name']);
    assert.equal(label.textContent, 'Name');
    assert.equal(document.activeElement, toggle);
    assert.equal(menu.children[0].getAttribute('aria-checked'), 'true');
    sort.setActive('unavailable');
    assert.equal(label.textContent, 'Name');
});

test('sort popup stays in the viewport, follows scrolling, and closes when the section is hidden', () => {
    setupDocument();
    const {sort, toggle, menu, container} = sortElements();
    toggle.rect = {left: 980, top: 650, bottom: 680};
    sort.open();
    assert.equal(menu.style.left, '812px');
    assert.equal(menu.style.top, '494px');
    toggle.rect = {left: 30, top: 20, bottom: 50};
    document.dispatch('scroll');
    assert.equal(menu.style.left, '30px');
    assert.equal(menu.style.top, '56px');
    container.hidden = true;
    window.dispatch('resize');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('Tab and outside focus close sorting without committing a choice', () => {
    setupDocument();
    const selections = [];
    const {sort, toggle, menu} = sortElements(key => selections.push(key));
    toggle.dispatch('keydown', {key: 'ArrowUp'});
    assert.equal(document.activeElement.dataset.key, 'image');
    assert.equal(menu.dispatch('keydown', {key: 'Tab'}).defaultPrevented, undefined);
    assert.equal(document.activeElement, toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    sort.open();
    const outside = new Element('button');
    outside.focus();
    document.dispatch('focusin', {target: outside});
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(document.activeElement, outside);
    assert.deepEqual(selections, []);
});

test('notifications stack in one live region and errors stay visible longer', (t) => {
    setupDocument();
    Toast._container = null;
    const timers = new Map();
    let nextTimer = 0;
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
        const id = ++nextTimer;
        timers.set(id, {callback, delay});
        return id;
    });
    t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
    const previousRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = callback => callback();
    t.after(() => {
        Toast.clear?.();
        if (previousRaf) globalThis.requestAnimationFrame = previousRaf;
        else delete globalThis.requestAnimationFrame;
        Toast._container = null;
    });

    const info = Toast.show({title: 'Saved'});
    const error = Toast.show({title: '<Failure>', message: 'Try again', type: 'error'});
    const container = document.body.children[0];
    assert.equal(document.body.children.length, 1);
    assert.equal(container.children.length, 2);
    assert.equal(container.getAttribute('aria-live'), 'polite');
    assert.equal(container.getAttribute('aria-atomic'), 'false');
    assert.equal(error.children[0].textContent, '<Failure>');
    assert.match(error.className, /toast--error/);
    assert.deepEqual([...timers.values()].map(timer => timer.delay), [4000, 7000]);

    error.dispatch('mouseenter');
    assert.deepEqual([...timers.values()].map(timer => timer.delay), [4000]);
    error.dispatch('focusin');
    error.dispatch('focusout', {relatedTarget: null});
    assert.deepEqual([...timers.values()].map(timer => timer.delay), [4000]);
    error.dispatch('mouseleave');
    assert.deepEqual([...timers.values()].map(timer => timer.delay), [4000, 7000]);
    const trigger = document.activeElement;
    error.children.at(-1).focus();
    error.dispatch('focusin');
    error.children.at(-1).dispatch('click');
    assert.equal(document.activeElement, trigger);
    assert.doesNotMatch(error.className, /toast--visible/);
    assert.equal(error.children.at(-1).getAttribute('aria-label'), 'Dismiss notification');
    [...timers.values()].find(timer => timer.delay === 350).callback();
    assert.deepEqual(container.children, [info]);
});

test('clearing notifications removes private and paused content, cancels timers, and preserves new notices', t => {
    setupDocument();
    Toast._container = null;
    const timers = new Map();
    let nextTimer = 0;
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; });
    t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
    const previousRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = callback => callback();
    t.after(() => {
        Toast.clear?.();
        if (previousRaf) globalThis.requestAnimationFrame = previousRaf; else delete globalThis.requestAnimationFrame;
        Toast._container = null;
    });
    const paused = Toast.show({title: 'Private account', message: 'synthetic-private-email'});
    paused.dispatch('mouseenter');
    const dismissing = Toast.show({title: 'Private action'});
    dismissing.children.at(-1).dispatch('click');
    const loginFocus = new Element('button');
    loginFocus.focus();
    Toast.clear();
    assert.equal(document.body.children[0].children.length, 0);
    assert.equal(timers.size, 0);
    assert.equal(document.activeElement, loginFocus);
    paused.dispatch('mouseleave');
    assert.equal(timers.size, 0, 'cleared notifications cannot restart their lifetime');
    const safe = Toast.show({title: 'Session expired', message: 'Please sign in again.'});
    assert.deepEqual(document.body.children[0].children, [safe]);
    assert.equal(timers.size, 1);
});
