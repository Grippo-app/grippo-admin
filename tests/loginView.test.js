import test from 'node:test';
import assert from 'node:assert/strict';
import {LoginView} from '../src/features/auth/LoginView.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Events} from '../src/infrastructure/events/events.js';
import {ConfirmDialog} from '../src/shared/components/ConfirmDialog.js';
import {Toast} from '../src/shared/components/Toast.js';

function element() {
    return {
        hidden: false, disabled: false, inert: false, isConnected: true, value: '', attributes: {}, listeners: {},
        focus() { document.activeElement = this; },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(event, handler) { this.listeners[event] = handler; },
        dispatch(event, properties = {}) {
            const e = {preventDefault() { this.defaultPrevented = true; }, ...properties};
            return {event: e, result: this.listeners[event]?.(e)};
        },
    };
}

function setup(t, login) {
    const trigger = element();
    const tab = element();
    const backgrounds = [element(), element()];
    backgrounds[1].inert = true;
    globalThis.document = {
        body: element(), activeElement: trigger,
        querySelectorAll: () => backgrounds,
        getElementById: () => tab,
    };
    const els = {overlay: element(), restoreEl: element(), form: element(), emailInput: element(), passwordInput: element(), errorEl: element()};
    els.restoreEl.id = 'loginRestore';
    els.overlay.hidden = true;
    els.errorEl.hidden = true;
    const submit = element();
    els.form.querySelector = () => submit;
    els.form.querySelectorAll = () => [els.emailInput, els.passwordInput, submit];
    const bus = new EventBus();
    const cancel = t.mock.method(ConfirmDialog, 'cancel');
    const toast = t.mock.method(Toast, 'show', () => {});
    const view = new LoginView({authService: {login}, bus, els});
    return {view, els, bus, submit, trigger, backgrounds, cancel, toast};
}

test('sign-in blocks duplicate submissions and restores controls after a request error', async t => {
    let reject;
    const calls = [];
    const pending = new Promise((resolve, fail) => { reject = fail; });
    const {view, els, submit, toast} = setup(t, credentials => { calls.push(credentials); return pending; });
    view.show();
    els.emailInput.value = ' admin@example.test ';
    els.passwordInput.value = 'fixture';
    const first = els.form.dispatch('submit').result;
    assert.equal(submit.disabled, true);
    assert.equal(els.form.attributes['aria-busy'], 'true');
    await els.form.dispatch('submit').result;
    assert.deepEqual(calls, [{email: 'admin@example.test', password: 'fixture'}]);
    reject(new Error('Unable to connect'));
    await first;
    assert.equal(submit.disabled, false);
    assert.equal(els.overlay.attributes['aria-labelledby'], 'loginTitle');
    assert.equal(els.form.attributes['aria-busy'], 'false');
    assert.equal(els.errorEl.hidden, false);
    assert.equal(els.errorEl.textContent, 'Unable to connect');
    assert.equal(document.activeElement, els.passwordInput);
    assert.equal(toast.mock.calls.length, 0);
});

test('session expiry cancels confirmation, clears the password, and keeps background controls inert', t => {
    const {view, els, bus, backgrounds, cancel} = setup(t, async () => false);
    els.passwordInput.value = 'old-secret';
    const cancellationsBefore = cancel.mock.calls.length;
    bus.emit(Events.AUTH_SESSION_EXPIRED);
    assert.equal(cancel.mock.calls.length, cancellationsBefore + 1);
    assert.equal(els.overlay.hidden, false);
    assert.equal(els.passwordInput.value, '');
    assert.equal(document.activeElement, els.emailInput);
    assert.deepEqual(backgrounds.map(el => el.inert), [true, true]);
    view.show();
    view.hide();
    assert.deepEqual(backgrounds.map(el => el.inert), [false, true]);
});

test('failed or superseded login does not announce success and allows another attempt', async t => {
    const {view, els, submit, toast} = setup(t, async () => false);
    view.show();
    await els.form.dispatch('submit').result;
    assert.equal(els.overlay.hidden, false);
    assert.equal(submit.disabled, false);
    assert.equal(toast.mock.calls.length, 0);
});

test('successful login restores background state, clears credentials, and returns focus', async t => {
    let bus;
    const fixture = setup(t, async () => { bus.emit(Events.AUTH_LOGIN_SUCCESS); return true; });
    bus = fixture.bus;
    const {view, els, trigger, backgrounds, toast} = fixture;
    view.show();
    els.passwordInput.value = 'fixture';
    await els.form.dispatch('submit').result;
    assert.equal(els.overlay.hidden, true);
    assert.equal(els.passwordInput.value, '');
    assert.deepEqual(backgrounds.map(el => el.inert), [false, true]);
    assert.equal(document.activeElement, trigger);
    assert.equal(toast.mock.calls[0].arguments[0].title, 'Logged in');
});

test('sign-in keyboard focus wraps over enabled fields while submission is pending', t => {
    const {view, els, submit} = setup(t, async () => false);
    view.show();
    submit.disabled = true;
    els.emailInput.focus();
    const backward = els.form.dispatch('keydown', {key: 'Tab', shiftKey: true});
    assert.equal(backward.event.defaultPrevented, true);
    assert.equal(document.activeElement, els.passwordInput);
    const forward = els.form.dispatch('keydown', {key: 'Tab'});
    assert.equal(forward.event.defaultPrevented, true);
    assert.equal(document.activeElement, els.emailInput);
});


test('sign-in returns focus to the selected primary tab when the old detail is hidden', t => {
    const {view, trigger} = setup(t, async () => true);
    trigger.closest = () => ({hidden: true});
    const selectedTab = element();
    document.querySelector = () => selectedTab;
    view.hide();
    assert.equal(document.activeElement, selectedTab);
});

test('session transitions clear prior private notifications before adding safe status notices', t => {
    const notices = ['synthetic-private-email'];
    if (typeof Toast.clear === 'function') t.mock.method(Toast, 'clear', () => { notices.length = 0; });
    const {bus, toast} = setup(t, async () => false);
    toast.mock.mockImplementation(({title}) => { notices.push(title); });
    notices.push('another private notice');
    bus.emit(Events.AUTH_SESSION_EXPIRED);
    assert.deepEqual(notices, ['Session expired']);
    notices.push('private previous account');
    bus.emit(Events.AUTH_LOGOUT);
    Toast.show({title: 'Logged out'});
    assert.deepEqual(notices, ['Logged out']);
});

test('bootstrap shows a neutral restore state without credential focus or submission', async t => {
    let signIns = 0;
    const {view, els, submit} = setup(t, async () => { signIns++; return true; });
    assert.equal(els.overlay.hidden, false);
    assert.equal(els.restoreEl.hidden, false);
    assert.equal(els.form.hidden, true);
    assert.equal(els.form.inert, true);
    assert.equal(els.emailInput.disabled, true);
    assert.equal(els.passwordInput.disabled, true);
    assert.equal(submit.disabled, true);
    assert.equal(els.overlay.attributes['aria-labelledby'], 'loginRestore');
    assert.equal(document.activeElement, els.restoreEl);
    await els.form.dispatch('submit').result;
    assert.equal(signIns, 0);
    const tab = els.overlay.dispatch('keydown', {key: 'Tab'});
    assert.equal(tab.event.defaultPrevented, true);
    assert.equal(document.activeElement, els.restoreEl);
    assert.equal(typeof view.setRestoring(true), 'number');
});

test('restore completion releases the normal form once for false results and unexpected errors', t => {
    const {view, els, submit} = setup(t, async () => false);
    const restore = view.setRestoring(true);
    assert.equal(view.setRestoring(false, restore), true);
    assert.equal(els.restoreEl.hidden, true);
    assert.equal(els.form.hidden, false);
    assert.equal(els.form.inert, false);
    assert.equal(els.emailInput.disabled, false);
    assert.equal(els.passwordInput.disabled, false);
    assert.equal(submit.disabled, false);
    assert.equal(document.activeElement, els.emailInput);
    assert.equal(view.setRestoring(false, restore), false);
    const retry = view.setRestoring(true);
    try { throw new Error('Synthetic restore failure'); }
    catch { /* The bootstrap finally block releases only its own restore handle. */ }
    finally { view.setRestoring(false, retry); }
    assert.equal(els.form.hidden, false);
    assert.equal(document.activeElement, els.emailInput);
});

test('late bootstrap completion cannot reopen the form or move focus after login success', t => {
    const {view, els, bus, trigger} = setup(t, async () => true);
    const restore = view.setRestoring(true);
    bus.emit(Events.AUTH_LOGIN_SUCCESS);
    assert.equal(els.overlay.hidden, true);
    assert.equal(document.activeElement, trigger);
    assert.equal(view.setRestoring(false, restore), false);
    assert.equal(view.setRestoring(true), null);
    assert.equal(els.overlay.hidden, true);
    assert.equal(document.activeElement, trigger);
});

test('session expiry supersedes restore UI and preserves its safe notice when bootstrap finally runs', t => {
    const {view, els, bus, toast} = setup(t, async () => false);
    const restore = view.setRestoring(true);
    bus.emit(Events.AUTH_SESSION_EXPIRED);
    assert.equal(els.form.hidden, false);
    assert.equal(els.restoreEl.hidden, true);
    assert.equal(document.activeElement, els.emailInput);
    assert.equal(view.setRestoring(false, restore), false);
    assert.equal(toast.mock.calls.at(-1).arguments[0].title, 'Session expired');
});

test('a pending sign-in is not hidden or unlocked by a late restore handle', async t => {
    let finish;
    const request = new Promise(resolve => { finish = resolve; });
    const {view, els, submit} = setup(t, () => request);
    const staleRestore = view.setRestoring(true);
    view.show();
    els.passwordInput.value = 'synthetic-password';
    const submitting = els.form.dispatch('submit').result;
    assert.equal(submit.disabled, true);
    assert.equal(view.setRestoring(true), null);
    assert.equal(view.setRestoring(false, staleRestore), false);
    assert.equal(els.form.hidden, false);
    assert.equal(els.passwordInput.value, 'synthetic-password');
    assert.equal(submit.disabled, true);
    finish(false);
    await submitting;
    assert.equal(submit.disabled, false);
});

test('an older restore handle cannot release a newer pending restore', t => {
    const {view, els} = setup(t, async () => false);
    const first = view.setRestoring(true);
    view.show();
    const second = view.setRestoring(true);
    assert.notEqual(first, second);
    assert.equal(view.setRestoring(false, first), false);
    assert.equal(els.form.hidden, true);
    assert.equal(view.setRestoring(false, second), true);
    assert.equal(els.form.hidden, false);
});

test('an old sign-in error does not replace the current session-expiry message or focus', async t => {
    let fail;
    const request = new Promise((resolve, reject) => { fail = reject; });
    const {view, els, bus, submit, toast} = setup(t, () => request);
    view.show();
    const submitting = els.form.dispatch('submit').result;
    bus.emit(Events.AUTH_SESSION_EXPIRED);
    assert.equal(document.activeElement, els.emailInput);
    fail(new Error('Old sign-in failure'));
    await submitting;
    assert.equal(els.errorEl.hidden, true);
    assert.equal(document.activeElement, els.emailInput);
    assert.equal(submit.disabled, false);
    assert.equal(toast.mock.calls.at(-1).arguments[0].title, 'Session expired');
});
