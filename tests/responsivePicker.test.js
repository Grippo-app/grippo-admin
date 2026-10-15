import test from 'node:test';
import assert from 'node:assert/strict';
import {ResponsivePicker} from '../src/shared/components/ResponsivePicker.js';

function setup(t, mobile = true) {
    const oldDocument = globalThis.document;
    globalThis.document = {activeElement: null};
    t.after(() => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; });
    const events = new Map(), mediaEvents = new Map(), classes = new Set();
    const summary = {focus() { document.activeElement = summary; }};
    const details = {open: true, parentElement: {classList: {toggle(name, value) { value ? classes.add(name) : classes.delete(name); }}},
        querySelector: () => summary, contains: el => el === summary || el?.inside,
        addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); }};
    const media = {matches: mobile, addEventListener(name, fn) { mediaEvents.set(name, fn); }, removeEventListener(name) { mediaEvents.delete(name); }};
    const labelEl = {textContent: ''};
    const picker = new ResponsivePicker({details, labelEl, emptyLabel: 'Choose a record', media});
    return {picker, details, labelEl, media, events, mediaEvents, classes, summary};
}

test('mobile selection collapses the picker and repairs hidden focus without moving it on updates', t => {
    const {picker, details, labelEl, classes, summary} = setup(t);
    assert.equal(details.open, true);
    document.activeElement = {inside: true};
    picker.update({id: 'a', label: 'A'});
    assert.equal(details.open, false); assert.equal(document.activeElement, summary);
    assert.equal(labelEl.textContent, 'A'); assert.equal(classes.has('is-picker-collapsed'), true);
    details.open = true;
    picker.update({id: 'a', label: 'Updated A'});
    assert.equal(details.open, true); assert.equal(labelEl.textContent, 'Updated A');
    picker.update({id: 'b', label: 'B'}); assert.equal(details.open, false);
});

test('desktop always retains the list and responsive transitions preserve access to the selection', t => {
    const {picker, details, media, mediaEvents, events} = setup(t, false);
    picker.update({id: 'a', label: 'A'}); assert.equal(details.open, true);
    details.open = false; events.get('toggle')(); assert.equal(details.open, true);
    media.matches = true; mediaEvents.get('change')(); assert.equal(details.open, false);
    media.matches = false; mediaEvents.get('change')(); assert.equal(details.open, true);
});

test('reselecting the current row closes mobile picker, while reset removes the prior label', t => {
    const {picker, details, labelEl, events, mediaEvents, classes} = setup(t);
    picker.update({id: 'a', label: 'Private account'}); details.open = true;
    events.get('click')({target: {closest: () => ({dataset: {id: 'b'}})}}); assert.equal(details.open, true);
    events.get('click')({target: {closest: () => ({dataset: {id: 'a'}})}}); assert.equal(details.open, false);
    for (const key of ['Enter', ' ']) {
        details.open = true;
        events.get('keydown')({key, target: {closest: () => ({dataset: {id: 'a'}})}});
        assert.equal(details.open, false);
    }
    picker.update(null);
    assert.equal(details.open, true); assert.equal(labelEl.textContent, 'Choose a record');
    assert.equal(classes.has('is-picker-collapsed'), false);
    picker.destroy(); assert.equal(events.size, 0); assert.equal(mediaEvents.size, 0);
});
