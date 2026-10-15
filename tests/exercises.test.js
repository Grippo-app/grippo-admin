import test from 'node:test';
import assert from 'node:assert/strict';
import {ExerciseController} from '../src/features/exercises/ExerciseController.js';
import {ExerciseStore} from '../src/features/exercises/ExerciseStore.js';
import {ExerciseFormView} from '../src/features/exercises/ExerciseFormView.js';
import {ExerciseListView} from '../src/features/exercises/ExerciseListView.js';
import {ExerciseNormalizer as Normalizer} from '../src/domain/exercise/ExerciseNormalizer.js';
import {ExerciseValidator} from '../src/domain/exercise/ExerciseValidator.js';
import {ExerciseRepository} from '../src/domain/exercise/ExerciseRepository.js';
import {DictionaryStore} from '../src/domain/exercise/DictionaryStore.js';
import {ExerciseTranslations} from '../src/domain/exercise/ExerciseTranslations.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Events} from '../src/infrastructure/events/events.js';
import {Toast} from '../src/shared/components/Toast.js';
import {buildReviewPrompt} from '../src/features/exercises/exercisePrompts.js';

Toast.show = () => {};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const exercise = id => ({...Normalizer.emptyTemplate(), id,
    name: 'Squat', description: 'Controlled squat', nameTranslations: {en: 'Squat', ua: 'Присідання', ru: ''},
    descriptionTranslations: {en: 'Controlled squat', ua: 'Контрольоване присідання', ru: ''},
    weightType: 'free', category: 'compound', experience: 'beginner', forceType: 'push',
    exerciseExampleBundles: [{muscleId: 'quadriceps', percentage: 100}], equipmentRefs: []});

class Element {
    constructor(tagName = '') {
        this.tagName = tagName; this.dataset = {};
        this.value = ''; this.checked = false; this.listeners = new Map(); this.children = [];
        const classes = new Set();
        this.classList = {toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key), add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key)};
    }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    dispatch(name, event = {}) { return this.listeners.get(name)?.({target: this, preventDefault() {}, ...event}); }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    querySelectorAll(selector) {
        const key = {'[data-bundle-index]': 'bundleIndex', '[data-bundle-muscle]': 'bundleMuscle', '[data-bundle-percentage]': 'bundlePercentage',
            '[data-equipment-id]': 'equipmentId', '[data-equipment-label]': 'equipmentLabel'}[selector];
        if (!key && selector !== 'button') return [];
        const matches = [];
        const visit = element => {
            for (const child of element.children) {
                if (key ? Object.hasOwn(child.dataset, key) : child.tagName === 'button') matches.push(child);
                visit(child);
            }
        };
        visit(this);
        return matches;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    set innerHTML(value) { this.children = []; this._innerHTML = value; }
    get innerHTML() { return this._innerHTML || ''; }
    focus(options) { if (globalThis.document) document.activeElement = this; this.focusOptions = options; }
    appendChild(child) { this.children.push(child); if (this.tagName === 'select' && (this.children.length === 1 || child.selected)) this.value = child.value; }
    replaceChildren(...children) { this.children = children; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    insertBefore(child, reference) {
        const existing = this.children.indexOf(child);
        if (existing >= 0) this.children.splice(existing, 1);
        const index = reference ? this.children.indexOf(reference) : this.children.length;
        this.children.splice(index, 0, child);
    }
}

function formSetup(current = exercise('a')) {
    const store = new ExerciseStore();
    const keys = ['builder', 'editorWrap', 'editor', 'viewForm', 'viewJson', 'saveBtn', 'deleteBtn', 'jsonStatus',
        'currentId', 'nameLabel', 'descriptionLabel', 'localeHint', 'inputsSection', 'equipmentSection', 'inputsSummary', 'equipmentSummary',
        'fId', 'fName', 'fDescription', 'fImage', 'fWeightType', 'fCategory', 'fExperience', 'fForceType',
        'fRulesExternalWeightEnabled', 'fRulesExternalWeightRequired', 'fRulesBodyWeightEnabled',
        'fRulesBodyWeightMultiplier', 'fRulesBodyWeightMultiplierValue', 'fRulesExtraWeightEnabled',
        'fRulesExtraWeightRequired', 'fRulesAssistanceEnabled', 'fRulesAssistanceRequired'];
    const els = Object.fromEntries(keys.map(key => [key, new Element()]));
    let saves = 0;
    let savedEntity;
    const form = new ExerciseFormView({store, els, validator: {validate: () => ({ok: true, errors: [], warnings: []})},
        dictionaries: {equipment: new Map(), muscles: new Map(), getEquipmentName(id) { return this.equipment.get(id); }}, onSave: async entity => { saves++; savedEntity = entity; }});
    if (current) store.setCurrent(current);
    return {store, form, els, saves: () => saves, savedEntity: () => savedEntity};
}

test('exercise heading uses localized names with English fallback while language requirements match validation', () => {
    const {store, els} = formSetup();
    assert.equal(els.currentId.textContent, 'Squat');
    assert.equal(els.fId.value, 'a');
    assert.equal(els.nameLabel.textContent, 'English name *');
    assert.equal(els.descriptionLabel.textContent, 'English description *');
    assert.equal(els.fName.required, true);
    store.setLocale('ua');
    assert.equal(els.currentId.textContent, 'Присідання');
    assert.equal(els.nameLabel.textContent, 'Ukrainian name (optional)');
    assert.equal(els.descriptionLabel.textContent, 'Ukrainian description (optional)');
    assert.equal(els.fName.required, false);
    assert.equal(els.fDescription['aria-required'], 'false');
    assert.match(els.localeHint.textContent, /Save includes all languages/);
    store.setLocale('ru');
    assert.equal(els.currentId.textContent, 'Squat');
    assert.equal(els.nameLabel.textContent, 'Russian name (optional)');
    store.setNew({...exercise('new'), name: '', nameTranslations: {en: '', ua: '', ru: ''}});
    assert.equal(els.currentId.textContent, 'New exercise');
});

test('configuration disclosures preserve drafts and their open state across language, mode and same-record refreshes', () => {
    const {store, form, els} = formSetup();
    assert.equal(els.inputsSection.open, false);
    assert.equal(els.equipmentSection.open, false);
    els.inputsSection.open = els.equipmentSection.open = true;
    assert.equal(form.hasUnsavedChanges(), false);
    els.fName.value = 'Draft squat';
    form.flush(); store.setLocale('ua');
    els.viewJson.dispatch('click'); els.viewForm.dispatch('click');
    store.setCurrent({...store.getState().current});
    assert.equal(els.inputsSection.open, true);
    assert.equal(els.equipmentSection.open, true);
    assert.equal(form.readFormToEntity().nameTranslations.en, 'Draft squat');
    assert.equal(form.hasUnsavedChanges(), true);
    store.setCurrent(exercise('b'));
    assert.equal(els.inputsSection.open, false);
    assert.equal(els.equipmentSection.open, false);
    els.inputsSection.open = els.equipmentSection.open = true;
    store.setNew(exercise('new'));
    assert.equal(els.inputsSection.open, false);
    els.inputsSection.open = els.equipmentSection.open = true;
    store.reset();
    assert.equal(els.inputsSection.open, false);
    assert.equal(els.equipmentSection.open, false);
});

for (const edited of [false, true]) test(`create identity acknowledgement retains open settings and focused inputs with ${edited ? 'an edited' : 'an unchanged'} draft`, withBundleDocument(async () => {
    const {store, form, els} = formSetup(null);
    const pending = deferred();
    const controller = new ExerciseController({store, formView: form, bus: new EventBus(), confirmDialog: {ask: async () => true},
        repository: {create: () => pending.promise, fetchDetail: async id => exercise(id), fetchTranslations: async id => ExerciseTranslations.fromEntity(exercise(id))}});
    form._onSave = entity => controller.saveItem(entity);
    const referenceFields = new Element();
    const querySelectorAll = els.builder.querySelectorAll.bind(els.builder);
    els.builder.querySelectorAll = selector => selector === '.exercise-reference-fields' ? [referenceFields] : querySelectorAll(selector);
    store.setNew(exercise('local-draft'));
    els.inputsSection.open = els.equipmentSection.open = true;
    referenceFields.open = true;
    els.fRulesExternalWeightEnabled.focus();
    const saving = els.saveBtn.dispatch('click');
    if (edited) els.fName.value = 'Draft edited during create';
    pending.resolve({id: 'server-created-id'});
    await saving;
    assert.equal(store.getState().current.id, 'server-created-id');
    assert.equal(store.getState().isNew, false);
    assert.equal(els.inputsSection.open, true);
    assert.equal(els.equipmentSection.open, true);
    assert.equal(referenceFields.open, true);
    assert.equal(document.activeElement, els.fRulesExternalWeightEnabled);
    assert.equal(els.fName.value, edited ? 'Draft edited during create' : 'Squat');
    await controller.selectItem({id: 'other'});
    assert.equal(els.inputsSection.open, false, 'a real later selection still collapses settings');
    assert.equal(els.equipmentSection.open, false);
    assert.equal(referenceFields.open, false);
    els.inputsSection.open = els.equipmentSection.open = true;
    await controller.newItem();
    assert.equal(els.inputsSection.open, false, 'a real New action still collapses settings');
    els.inputsSection.open = els.equipmentSection.open = true;
    store.reset();
    assert.equal(els.inputsSection.open, false);
    assert.equal(els.equipmentSection.open, false);
}));

test('collapsed configuration summaries reflect live inputs, exact loaded multipliers and bounded equipment names', () => {
    const components = {externalWeight: null, bodyWeight: {required: true, multiplier: 0.73}, extraWeight: {required: false}, assistWeight: {required: true}};
    const {store, form, els} = formSetup({...exercise('a'), components});
    assert.equal(els.inputsSummary.textContent, 'Body weight 0.73× · Extra optional · Assistance required');
    els.fRulesBodyWeightMultiplier.value = '0.8'; els.fRulesBodyWeightMultiplier.dispatch('input');
    assert.match(els.inputsSummary.textContent, /Body weight 0.80×/);
    form._dicts.equipment = new Map([['barbell', 'Barbell'], ['bench', 'Bench'], ['plates', 'Plates']]);
    store.setCurrent({...store.getState().current, equipmentRefs: [...form._dicts.equipment.keys()].map(equipmentId => ({equipmentId}))});
    assert.equal(els.equipmentSummary.textContent, 'Barbell, Bench +1');
    assert.equal(els.equipmentSummary.title, 'Barbell, Bench, Plates');
    form._dicts.equipment.set('barbell', 'Updated barbell'); form.refreshOptionLists();
    assert.equal(els.equipmentSummary.textContent, 'Updated barbell, Bench +1');
});

test('invalid JSON cannot change language labels or discard open configuration panels', () => {
    const {store, form, els} = formSetup();
    const ua = new Element(); ua.dataset.locale = 'ua'; els.localeButtons = [ua]; form._bindEvents();
    els.inputsSection.open = true;
    els.viewJson.dispatch('click'); els.editor.value = '{invalid';
    ua.dispatch('click'); els.viewForm.dispatch('click');
    assert.equal(store.getState().locale, 'en');
    assert.equal(store.getState().viewMode, 'json');
    assert.equal(els.nameLabel.textContent, 'English name *');
    assert.equal(els.inputsSection.open, true);
    assert.equal(els.editor.value, '{invalid');
});

test('validation links reveal collapsed configuration fields without changing the draft', withBundleDocument(() => {
    const {form, els} = formSetup();
    els.validationSummary = new Element(); els.equipSingle = new Element();
    els.fRulesExternalWeightEnabled.closest = () => els.inputsSection;
    els.equipSingle.closest = () => els.equipmentSection;
    form._showValidation([{field: 'components', message: 'Fix weight inputs'}, {field: 'equipmentRefs', message: 'Replace unknown equipment'}]);
    const buttons = els.validationSummary.children[1].children.map(item => item.children[0]);
    buttons[0].dispatch('click');
    assert.equal(els.inputsSection.open, true);
    assert.equal(document.activeElement, els.fRulesExternalWeightEnabled);
    buttons[1].dispatch('click');
    assert.equal(els.equipmentSection.open, true);
    assert.equal(document.activeElement, els.equipSingle);
    assert.equal(form.hasUnsavedChanges(), false);
}));

function controllerSetup(repo = {}, form = {}) {
    const store = new ExerciseStore();
    const bus = new EventBus();
    const repository = {fetchTranslations: async () => { const error = new Error('Raw translation route unavailable'); error.status = 404; throw error; }, ...repo};
    const controller = new ExerciseController({store, repository, bus, formView: form,
        confirmDialog: {ask: async () => true}});
    return {store, bus, controller};
}

test('JSON edits survive returning to Form and preserve other languages', () => {
    const {form, els} = formSetup();
    els.viewJson.dispatch('click');
    const draft = JSON.parse(els.editor.value);
    draft.nameTranslations.en = 'Front squat';
    els.editor.value = JSON.stringify(draft);
    els.viewForm.dispatch('click');
    assert.equal(els.fName.value, 'Front squat');
    assert.equal(form.readFormToEntity().nameTranslations.ua, 'Присідання');
    assert.equal(form.hasUnsavedChanges(), true);
});

test('invalid JSON blocks save, locale flush, and returning to Form', async () => {
    const {form, store, els, saves} = formSetup();
    els.viewJson.dispatch('click');
    els.editor.value = '{bad';
    await els.saveBtn.dispatch('click');
    els.viewForm.dispatch('click');
    assert.equal(saves(), 0);
    assert.equal(store.getState().viewMode, 'json');
    assert.equal(form.flush(), false);
    assert.equal(els.editor.value, '{bad');
    assert.equal(form.hasUnsavedChanges(), true);
});

test('JSON rejects primitive values, arrays, and edited identity', () => {
    const {form, els} = formSetup();
    els.viewJson.dispatch('click');
    for (const value of ['null', '[]', '42', JSON.stringify({...exercise('other')})]) {
        els.editor.value = value;
        assert.throws(() => form.readFormToEntity());
    }
});

test('opening JSON without selection never creates a fake existing record', () => {
    const {store, els} = formSetup(null);
    els.viewJson.dispatch('click');
    store.patchCurrent(exercise('fake'));
    assert.equal(store.getState().current, null);
    assert.equal(els.saveBtn.disabled, true);
});

test('dirty state survives form flush and resets when explicitly marked saved', () => {
    const {form, els} = formSetup();
    assert.equal(form.hasUnsavedChanges(), false);
    els.fName.value = 'Edited squat';
    assert.equal(form.flush(), true);
    assert.equal(form.hasUnsavedChanges(), true);
    form.markSaved(form.readFormToEntity());
    assert.equal(form.hasUnsavedChanges(), false);
});

test('localized scalar refresh replaces old text and explicit empty translations remain empty', () => {
    const previous = exercise('a');
    const refreshed = Normalizer.normalizeEntityShape({name: 'New squat', description: 'New description'}, {locale: 'en', previous});
    assert.equal(refreshed.name, 'New squat');
    assert.equal(refreshed.nameTranslations.ua, 'Присідання');
    const cleared = Normalizer.normalizeEntityShape({nameTranslations: {ua: ''}}, {locale: 'ua', previous});
    assert.equal(cleared.nameTranslations.ua, '');
});

test('list search and sorting support localized arrays and all translation languages', () => {
    const store = new ExerciseStore();
    store.setItems([{entity: {id: '2', name: [{language: 'en', value: 'Zulu'}]}},
        {entity: {id: '1', name: [{language: 'en', value: 'Alpha'}, {language: 'ua', value: 'Присідання'}]}}]);
    assert.equal(store.getState().filtered[0].entity.id, '1');
    store.setSearchQuery('  присідання  ');
    assert.equal(store.getState().filtered.length, 1);
    store.setSearchQuery('2');
    assert.equal(store.getState().filtered[0].entity.id, '2');
});

test('New invalidates pending exercise selection', async () => {
    const pending = deferred();
    const {store, controller} = controllerSetup({fetchDetail: () => pending.promise});
    const selection = controller.selectItem({id: 'old'});
    await Promise.resolve();
    await controller.newItem();
    const newId = store.getState().current.id;
    pending.resolve(exercise('old'));
    await selection;
    assert.equal(store.getState().current.id, newId);
    assert.equal(store.getState().isNew, true);
});

test('logout clears selected data and discards in-flight list and detail responses', async () => {
    const pending = deferred();
    const {store, bus, controller} = controllerSetup({fetchDetail: () => pending.promise, fetchList: () => pending.promise});
    store.setCurrent(exercise('selected'));
    const loading = controller.loadList();
    const selecting = controller.selectItem({id: 'other'});
    await Promise.resolve();
    bus.emit(Events.AUTH_LOGOUT);
    pending.resolve(exercise('other'));
    await Promise.all([loading, selecting]);
    assert.equal(store.getState().current, null);
    assert.deepEqual(store.getState().items, []);
    assert.equal(store.getState().isLoading, false);
    assert.equal(store.getState().isDetailLoading, false);
});

test('changing locale uses loaded translations without a request or data overwrite', () => {
    let requests = 0;
    const {store, controller} = controllerSetup({fetchDetail: () => { requests++; }});
    store.setCurrent(exercise('a'));
    controller.selectLocale('ua');
    assert.equal(requests, 0);
    assert.equal(store.getState().locale, 'ua');
    assert.equal(store.getState().current.nameTranslations.ua, 'Присідання');
});

test('save completion updates the list without replacing a later selected exercise', async () => {
    const pending = deferred();
    const {store, controller} = controllerSetup({update: () => pending.promise, fetchDetail: async () => exercise('b')});
    store.setCurrent(exercise('a'));
    const saving = controller.saveItem(exercise('a'));
    await controller.selectItem({id: 'b'});
    pending.resolve({id: 'a'});
    await saving;
    assert.equal(store.getState().current.id, 'b');
    assert.equal(store.getState().items[0].entity.id, 'a');
    assert.equal(store.getState().items[0].entity.name, 'Squat');
});

test('save completion after logout cannot restore exercise data', async () => {
    const pending = deferred();
    const {store, bus, controller} = controllerSetup({update: () => pending.promise});
    store.setCurrent(exercise('a'), {translationProvenanceKnown: true});
    const saving = controller.saveItem(exercise('a'));
    bus.emit(Events.AUTH_LOGOUT);
    pending.resolve(exercise('a'));
    await saving;
    assert.equal(store.getState().current, null);
    assert.deepEqual(store.getState().items, []);
});

test('validation rejects malformed components, duplicate muscles, and nonnumeric percentages', () => {
    const dictionaries = new DictionaryStore({});
    dictionaries.muscles.set('quadriceps', 'Quadriceps');
    const validator = new ExerciseValidator(dictionaries);
    assert.equal(validator.validate(exercise('a')).ok, true);
    assert.equal(validator.validate({...exercise('a'), components: []}).ok, false);
    assert.equal(validator.validate({...exercise('a'), components: {externalWeight: false}}).ok, false);
    assert.equal(validator.validate({...exercise('a'), exerciseExampleBundles: [{muscleId: 'quadriceps', percentage: '100'}]}).ok, false);
    assert.equal(validator.validate({...exercise('a'), exerciseExampleBundles: [{muscleId: 'quadriceps', percentage: 50}, {muscleId: 'quadriceps', percentage: 50}]}).ok, false);
});

test('an empty successful create response requires identity recovery instead of a fabricated ID', async () => {
    const repo = new ExerciseRepository({_fetch: async () => new Response(null, {status: 204}), buildHeaders: () => ({})});
    await assert.rejects(() => repo.create(Normalizer.buildPersistencePayload(exercise('draft'))), error => error.code === 'CREATE_ID_MISSING');
});

test('review prompt preserves translation maps and components in its schema', () => {
    const prompt = buildReviewPrompt(exercise('a'), {muscles: new Map(), equipment: new Map()});
    assert.match(prompt, /nameTranslations/);
    assert.match(prompt, /Preserve all translation maps, components/);
});

test('cancelling a later selection does not leave an earlier detail request stuck loading', async () => {
    const pending = deferred();
    let dirty = false;
    const {store, controller} = controllerSetup({fetchDetail: () => pending.promise}, {hasUnsavedChanges: () => dirty});
    const first = controller.selectItem({id: 'a'});
    await Promise.resolve();
    assert.equal(store.getState().isDetailLoading, true);
    dirty = true;
    controller._confirm = {ask: async () => false};
    await controller.selectItem({id: 'b'});
    pending.resolve(exercise('a'));
    await first;
    assert.equal(store.getState().isDetailLoading, false);
    assert.equal(store.getState().current.id, 'a');
});

test('dictionary failures expose readiness and retain successful options for retry', async () => {
    let shouldFail = true;
    const dicts = new DictionaryStore({fetchEquipments: async () => [{id: 'barbell', name: 'Barbell'}],
        fetchMuscles: async () => { if (shouldFail) throw new Error('Offline'); return [{id: 'quadriceps', name: 'Quadriceps'}]; }});
    const failed = await dicts.loadAll();
    assert.equal(failed.ok, false);
    assert.equal(dicts.loading, false);
    assert.equal(dicts.isReady, false);
    assert.match(dicts.errors[0], /Offline/);
    assert.equal(dicts.getEquipmentName('barbell'), 'Barbell');
    shouldFail = false;
    await dicts.loadAll();
    assert.equal(dicts.isReady, true);
    assert.deepEqual(dicts.errors, []);
    assert.equal(dicts.getMuscleName('quadriceps'), 'Quadriceps');
});


test('editor mode tabs support keyboard selection and keep invalid JSON selected', () => {
    const {store, els} = formSetup();
    assert.equal(els.viewForm.tabIndex, 0);
    assert.equal(els.viewJson.tabIndex, -1);
    els.viewForm.dispatch('keydown', {key: 'ArrowRight'});
    assert.equal(store.getState().viewMode, 'json');
    assert.equal(els.viewJson.tabIndex, 0);
    els.editor.value = '{invalid';
    els.viewJson.dispatch('keydown', {key: 'Home'});
    assert.equal(store.getState().viewMode, 'json');
    assert.equal(els.viewJson.tabIndex, 0);
    assert.equal(els.viewForm.tabIndex, -1);
});

for (const action of ['save', 'form', 'locale']) test(`a repaired in-flight JSON draft uses the generated create identity when continuing with ${action}`, async () => {
    const localId = '11111111-1111-4111-8111-111111111111';
    const serverId = '22222222-2222-4222-8222-222222222222';
    const {store, form, els} = formSetup(null);
    store.setNew(exercise(localId));
    let creates = 0;
    const updates = [];
    const pending = deferred();
    const controller = new ExerciseController({store, formView: form, bus: new EventBus(), confirmDialog: {},
        repository: {create: () => { creates++; return pending.promise; }, update: async (id, payload) => {
            updates.push({id, payload}); return {id: serverId};
        }}});
    els.viewJson.dispatch('click');
    const saving = controller.saveItem(form.readFormToEntity());
    const edited = {...exercise(localId), nameTranslations: {...exercise(localId).nameTranslations, en: 'Keep my later JSON edit'}};
    const repaired = JSON.stringify(edited, null, 2);
    const invalid = repaired.replace(/\n}$/, ',\n}');
    els.editor.value = invalid;
    pending.resolve({id: serverId});
    await saving;
    assert.equal(store.getState().current.id, serverId);
    assert.equal(store.getState().isNew, false);
    assert.equal(els.editor.value, invalid, 'acknowledgement must not rewrite invalid JSON or lose later edits');
    assert.equal(form.hasUnsavedChanges(), true);
    els.editor.value = repaired;
    assert.equal(form.hasUnsavedChanges(), true); assert.equal(form.hasUnsavedChanges(), true);
    assert.equal(form.readFormToEntity().id, serverId, 'dirty checks must not consume the exact old-to-new ID acknowledgement');
    els.editor.value = JSON.stringify({...edited, id: '33333333-3333-4333-8333-333333333333'});
    assert.throws(() => form.readFormToEntity(), /ID cannot be changed/);
    els.editor.value = repaired;
    if (action === 'save') {
        await controller.saveItem(form.readFormToEntity());
        assert.equal(updates.length, 1); assert.equal(updates[0].id, serverId);
        assert.equal(updates[0].payload.name.find(row => row.language === 'en').value, 'Keep my later JSON edit');
    } else if (action === 'form') {
        els.viewForm.dispatch('click');
        assert.equal(store.getState().viewMode, 'form');
        assert.equal(els.fName.value, 'Keep my later JSON edit');
        els.viewJson.dispatch('click');
    } else {
        const ua = new Element(); ua.dataset.locale = 'ua'; els.localeButtons = [ua]; form._bindEvents();
        ua.dispatch('click'); assert.equal(store.getState().locale, 'ua');
        assert.equal(store.getState().current.nameTranslations.en, 'Keep my later JSON edit');
    }
    assert.equal(creates, 1);
    assert.equal(JSON.parse(els.editor.value).id, serverId);
    els.editor.value = repaired;
    assert.throws(() => form.readFormToEntity(), /ID cannot be changed/, 'the old ID is no longer accepted after canonical JSON has been written');
});

for (const reset of ['select', 'new', 'logout']) test(`created JSON identity acknowledgement is revoked after ${reset}`, async () => {
    const {store, form, els} = formSetup(null);
    const bus = new EventBus(), pending = deferred();
    const controller = new ExerciseController({store, formView: form, bus, confirmDialog: {ask: async () => true},
        repository: {create: () => pending.promise}});
    store.setNew(exercise('local-id')); els.viewJson.dispatch('click');
    const repaired = els.editor.value;
    const saving = controller.saveItem(form.readFormToEntity());
    els.editor.value = repaired.replace(/\n}$/, ',\n}');
    pending.resolve({id: 'saved-id'}); await saving;
    if (reset === 'select') store.setCurrent(exercise('other-id'));
    else if (reset === 'new') await controller.newItem();
    else bus.emit(Events.AUTH_LOGOUT);
    store.setCurrent(exercise('saved-id'));
    els.editor.value = repaired;
    assert.throws(() => form.readFormToEntity(), /ID cannot be changed/);
});

test('an acknowledged created draft remains recoverable if JSON becomes invalid again during its first update', async () => {
    const {store, form, els} = formSetup(null);
    const create = deferred(), update = deferred();
    const controller = new ExerciseController({store, formView: form, bus: new EventBus(), confirmDialog: {},
        repository: {create: () => create.promise, update: () => update.promise}});
    store.setNew(exercise('local-id')); els.viewJson.dispatch('click');
    const draft = JSON.parse(els.editor.value);
    const saving = controller.saveItem(form.readFormToEntity());
    els.editor.value = JSON.stringify(draft, null, 2).replace(/\n}$/, ',\n}');
    create.resolve({id: 'saved-id'}); await saving;
    draft.nameTranslations.en = 'First repaired edit';
    els.editor.value = JSON.stringify(draft, null, 2);
    const updating = controller.saveItem(form.readFormToEntity());
    draft.descriptionTranslations.en = 'Another edit while updating';
    const repaired = JSON.stringify(draft, null, 2);
    els.editor.value = repaired.replace(/\n}$/, ',\n}');
    update.resolve({id: 'saved-id'}); await updating;
    els.editor.value = repaired;
    assert.equal(form.readFormToEntity().id, 'saved-id');
    assert.equal(form.readFormToEntity().descriptionTranslations.en, 'Another edit while updating');
    assert.equal(form.hasUnsavedChanges(), true);
    els.viewForm.dispatch('click');
    assert.equal(store.getState().viewMode, 'form');
    assert.equal(els.fDescription.value, 'Another edit while updating');
});

test('a list response started before save cannot replace the updated local list', async () => {
    const pending = deferred();
    const {store, controller} = controllerSetup({fetchList: () => pending.promise, update: async () => ({...exercise('a'), imageUrl: '/updated.png'})});
    store.setCurrent(exercise('a'));
    const loading = controller.loadList();
    await controller.saveItem(exercise('a'));
    pending.resolve([{entity: exercise('a')}]);
    await loading;
    assert.equal(store.getState().items[0].entity.imageUrl, '/updated.png');
    assert.equal(store.getState().isLoading, false);
});

test('malformed list responses preserve cached exercises and expose an error', async () => {
    const {store, controller} = controllerSetup({fetchList: async () => ({unexpected: true})});
    store.setItems([{entity: exercise('cached')}]);
    await controller.loadList();
    assert.equal(store.getState().items[0].entity.id, 'cached');
    assert.match(store.getState().loadError, /Unexpected exercise list response/);
    assert.equal(store.getState().isLoading, false);
});

test('malformed imported array entries remain removable and do not crash equipment or muscle additions', () => {
    const previousDocument = globalThis.document;
    globalThis.document = {createElement: tag => new Element(tag), createDocumentFragment: () => new Element()};
    try {
        const {store, form, els} = formSetup(null);
        const dicts = new DictionaryStore({});
        dicts.equipment.set('barbell', 'Barbell');
        dicts.muscles.set('quadriceps', 'Quadriceps');
        dicts.muscles.set('hamstrings', 'Hamstrings');
        form._dicts = dicts;
        for (const key of ['equipAdd', 'equipSingle', 'equipTokens', 'bundleAdd', 'muscleSelect', 'percentInput', 'bundles']) els[key] = new Element();
        form._bindEvents();
        store.setCurrent({...exercise('a'), equipmentRefs: [null], exerciseExampleBundles: [null]});
        els.equipSingle.value = 'barbell';
        assert.doesNotThrow(() => els.equipAdd.dispatch('click'));
        assert.equal(store.getState().current.equipmentRefs[1].equipmentId, 'barbell');
        els.muscleSelect.value = 'quadriceps';
        els.percentInput.value = '50';
        assert.doesNotThrow(() => els.bundleAdd.dispatch('click'));
        assert.equal(store.getState().current.exerciseExampleBundles[1].muscleId, 'quadriceps');
        const muscleSelect = els.bundles.children.at(-1).children[0].children[0];
        muscleSelect.value = 'hamstrings';
        assert.doesNotThrow(() => muscleSelect.dispatch('change'));
        assert.equal(store.getState().current.exerciseExampleBundles[0].muscleId, 'hamstrings');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test('a list response started before deletion cannot restore the deleted exercise', async () => {
    const pending = deferred();
    const {store, controller} = controllerSetup({fetchList: () => pending.promise, delete: async () => {}});
    store.setItems([{entity: exercise('a')}]);
    store.setCurrent(exercise('a'));
    const loading = controller.loadList();
    await controller.deleteItem('a');
    pending.resolve([{entity: exercise('a')}]);
    await loading;
    assert.deepEqual(store.getState().items, []);
    assert.equal(store.getState().current, null);
    assert.equal(store.getState().isLoading, false);
});

test('JSON and validation reject non-text translations before normalization can coerce them', () => {
    const dicts = new DictionaryStore({});
    dicts.muscles.set('quadriceps', 'Quadriceps');
    const validator = new ExerciseValidator(dicts);
    const {form, store, els} = formSetup();
    els.viewJson.dispatch('click');
    for (const value of [{}, [], 42, true, null]) {
        for (const field of ['nameTranslations', 'descriptionTranslations']) {
            const draft = {...exercise('a'), [field]: {en: value}};
            assert.equal(validator.validate(draft).ok, false);
            els.editor.value = JSON.stringify(draft);
            assert.throws(() => form.readFormToEntity(), /must be text/);
            els.viewForm.dispatch('click');
            assert.equal(store.getState().viewMode, 'json');
            assert.deepEqual(JSON.parse(els.editor.value)[field].en, value);
        }
    }
});

function bundleFormSetup() {
    const setup = formSetup(null);
    const {form, store, els} = setup;
    const dicts = new DictionaryStore({});
    dicts.muscles = new Map([['chest', 'Chest'], ['triceps', 'Triceps'], ['hamstrings', 'Hamstrings']]);
    form._dicts = dicts;
    for (const key of ['bundleAdd', 'muscleSelect', 'percentInput', 'bundles', 'bundleSumInfo', 'equipTokens', 'previewCard', 'previewImg', 'previewEmpty', 'previewFrame']) els[key] = new Element();
    form._bindEvents();
    store.setCurrent({...exercise('a'), imageUrl: '/squat.png', exerciseExampleBundles: [{muscleId: 'chest', percentage: 70}, {muscleId: 'triceps', percentage: 30}]});
    const rows = () => els.bundles.querySelectorAll('[data-bundle-index]');
    return {...setup, rows};
}

function withBundleDocument(fn) {
    return async () => {
        const previousDocument = globalThis.document;
        globalThis.document = {createElement: tag => new Element(tag), createDocumentFragment: () => new Element()};
        try { await fn(); }
        finally {
            if (previousDocument === undefined) delete globalThis.document;
            else globalThis.document = previousDocument;
        }
    };
}

test('removing a focused muscle moves to the nearest surviving row, then the Add selector when no rows remain', withBundleDocument(() => {
    const {store, els, rows} = bundleFormSetup();
    const removeFirst = rows()[0].querySelector('button');
    removeFirst.focus(); removeFirst.dispatch('click');
    assert.equal(store.getState().current.exerciseExampleBundles.length, 1);
    assert.equal(document.activeElement, rows()[0].querySelector('[data-bundle-muscle]'));
    assert.deepEqual(document.activeElement.focusOptions, {preventScroll: true});
    const removeLast = rows()[0].querySelector('button');
    removeLast.focus(); removeLast.dispatch('click');
    assert.equal(store.getState().current.exerciseExampleBundles.length, 0);
    assert.equal(document.activeElement, els.muscleSelect);
    assert.deepEqual(els.muscleSelect.focusOptions, {preventScroll: true});
}));

test('removing the final focused row keeps the preceding muscle row reachable', withBundleDocument(() => {
    const {rows} = bundleFormSetup();
    const removeLast = rows()[1].querySelector('button');
    removeLast.focus(); removeLast.dispatch('click');
    assert.equal(document.activeElement, rows()[0].querySelector('[data-bundle-muscle]'));
    assert.deepEqual(document.activeElement.focusOptions, {preventScroll: true});
}));

test('removing focused equipment uses a surviving token, then the Add selector, without collapsing settings', withBundleDocument(() => {
    const {store, form, els} = bundleFormSetup();
    form._dicts.equipment = new Map([['barbell', 'Barbell'], ['bench', 'Bench']]);
    els.equipSingle = new Element();
    store.setCurrent({...store.getState().current, equipmentRefs: [{equipmentId: 'barbell'}, {equipmentId: 'bench'}]});
    els.equipmentSection.open = true;
    const tokens = () => els.equipTokens.querySelectorAll('[data-equipment-id]');
    const first = tokens()[0].querySelector('button'); first.focus(); first.dispatch('click');
    assert.deepEqual(store.getState().current.equipmentRefs, [{equipmentId: 'bench'}]);
    assert.equal(document.activeElement, tokens()[0].querySelector('button'));
    assert.deepEqual(document.activeElement.focusOptions, {preventScroll: true});
    const last = tokens()[0].querySelector('button'); last.focus(); last.dispatch('click');
    assert.equal(store.getState().current.equipmentRefs.length, 0);
    assert.equal(document.activeElement, els.equipSingle);
    assert.deepEqual(els.equipSingle.focusOptions, {preventScroll: true});
    assert.equal(els.equipmentSection.open, true);
}));

test('removal never steals focus when the removed button was not active', withBundleDocument(() => {
    const {store, form, els, rows} = bundleFormSetup();
    els.fName.focus(); rows()[0].querySelector('button').dispatch('click');
    assert.equal(document.activeElement, els.fName);
    form._dicts.equipment = new Map([['barbell', 'Barbell']]); els.equipSingle = new Element();
    store.setCurrent({...store.getState().current, equipmentRefs: [{equipmentId: 'barbell'}]});
    els.fName.focus(); els.equipTokens.querySelectorAll('[data-equipment-id]')[0].querySelector('button').dispatch('click');
    assert.equal(document.activeElement, els.fName);
}));

test('Save reads all live muscle percentages without waiting for blur', withBundleDocument(async () => {
    const {els, rows, savedEntity} = bundleFormSetup();
    rows()[0].querySelector('[data-bundle-percentage]').value = '65';
    rows()[1].querySelector('[data-bundle-percentage]').value = '35';
    await els.saveBtn.dispatch('click');
    assert.deepEqual(savedEntity().exerciseExampleBundles.map(bundle => bundle.percentage), [65, 35]);
}));

test('adding a muscle preserves an unblurred percentage edit in another row', withBundleDocument(() => {
    const {store, els, rows} = bundleFormSetup();
    rows()[0].querySelector('[data-bundle-percentage]').value = '65';
    els.muscleSelect.value = 'hamstrings';
    els.percentInput.value = '5';
    els.bundleAdd.dispatch('click');
    assert.deepEqual(store.getState().current.exerciseExampleBundles.map(bundle => bundle.percentage), [65, 30, 5]);
    assert.match(els.bundleSumInfo.textContent, /100% allocated/);
}));

test('removing a muscle preserves an unblurred percentage edit in another row', withBundleDocument(() => {
    const {store, els, rows} = bundleFormSetup();
    rows()[0].querySelector('[data-bundle-percentage]').value = '65';
    rows()[1].children[2].dispatch('click');
    assert.deepEqual(store.getState().current.exerciseExampleBundles, [{muscleId: 'chest', percentage: 65}]);
    assert.match(els.bundleSumInfo.textContent, /65% allocated/);
}));

test('typing a percentage updates state and total without replacing focused rows or remove buttons', withBundleDocument(() => {
    const {store, form, els, rows} = bundleFormSetup();
    const initialRows = rows();
    const percent = initialRows[0].querySelector('[data-bundle-percentage]');
    const removeTriceps = initialRows[1].children[2];
    let renders = 0;
    const originalRender = form._renderBundles.bind(form);
    form._renderBundles = (...args) => { renders++; originalRender(...args); };
    percent.value = '65';
    percent.dispatch('input');
    assert.equal(renders, 0);
    assert.equal(rows()[0], initialRows[0]);
    assert.equal(rows()[1].children[2], removeTriceps);
    assert.equal(store.getState().current.exerciseExampleBundles[0].percentage, 65);
    assert.match(els.bundleSumInfo.textContent, /95% allocated/);
    removeTriceps.dispatch('click');
    assert.deepEqual(store.getState().current.exerciseExampleBundles, [{muscleId: 'chest', percentage: 65}]);
}));

test('dictionary refresh keeps live row inputs, token controls, form values and scroll in place', withBundleDocument(() => {
    const {form, store, els, rows} = bundleFormSetup();
    form._dicts.equipment = new Map([['barbell', 'Barbell']]);
    store.patchCurrent({equipmentRefs: [{equipmentId: 'barbell'}]});
    const row = rows()[0];
    const percentage = row.querySelector('[data-bundle-percentage]');
    const equipmentDom = els.equipTokens.children[0];
    percentage.value = '63';
    els.fName.value = 'Unsaved name';
    els.builder.scrollTop = 240;
    form._dicts.muscles = new Map([['chest', 'Chest refreshed'], ['triceps', 'Triceps']]);
    form._dicts.equipment = new Map([['barbell', 'Barbell refreshed']]);
    form.refreshOptionLists();
    assert.equal(rows()[0], row);
    assert.equal(row.querySelector('[data-bundle-percentage]'), percentage);
    assert.equal(percentage.value, '63');
    assert.equal(els.equipTokens.children[0], equipmentDom);
    assert.equal(els.fName.value, 'Unsaved name');
    assert.equal(els.builder.scrollTop, 240);
    assert.equal(form.readFormToEntity().exerciseExampleBundles[0].percentage, 63);
    assert.match(row.querySelector('[data-bundle-muscle]').children.find(option => option.value === 'chest').textContent, /refreshed/);
    els.viewJson.dispatch('click');
    els.editor.value = '{incomplete';
    form.refreshOptionLists();
    assert.equal(els.editor.value, '{incomplete');
    assert.equal(form.hasUnsavedChanges(), true);
}));

test('text locale switches flush all live values without rebuilding muscle or equipment DOM', withBundleDocument(() => {
    const {form, store, els, rows} = bundleFormSetup();
    const ua = new Element(); ua.dataset.locale = 'ua';
    els.localeButtons = [ua]; form._bindEvents();
    const before = rows()[0], equipment = els.equipTokens.children[0];
    let renders = 0;
    const original = form._renderBundles.bind(form);
    form._renderBundles = (...args) => { renders++; original(...args); };
    const percentage = before.querySelector('[data-bundle-percentage]');
    percentage.value = '63'; percentage.focus();
    els.fName.value = 'English edit';
    ua.dispatch('click');
    assert.equal(store.getState().locale, 'ua');
    assert.equal(store.getState().current.nameTranslations.en, 'English edit');
    assert.equal(store.getState().current.exerciseExampleBundles[0].percentage, 63);
    assert.equal(els.fName.value, 'Присідання');
    assert.equal(renders, 0);
    assert.equal(rows()[0], before);
    assert.equal(els.equipTokens.children[0], equipment);
    assert.equal(document.activeElement, percentage);
}));

test('reference fields preserve disclosure state for the same record and validation reveals hidden image input', withBundleDocument(() => {
    const {form, store, els} = formSetup();
    const disclosure = {open: true};
    els.builder.querySelectorAll = selector => selector === '.exercise-reference-fields' ? [disclosure] : [];
    els.fImage.closest = () => disclosure;
    els.validationSummary = new Element();
    store.patchCurrent({category: 'isolation'});
    store.setLocale('ua');
    assert.equal(disclosure.open, true);
    store.setCurrent(exercise('b'));
    assert.equal(disclosure.open, false);
    form._showValidation([{field: 'imageUrl', message: 'Check image URL'}]);
    els.validationSummary.children[1].children[0].children[0].dispatch('click');
    assert.equal(disclosure.open, true);
    assert.equal(document.activeElement, els.fImage);
}));

test('detail loading masks the previous editor without replacing its draft or adding a layout status row', withBundleDocument(() => {
    const {form, store, els, rows} = bundleFormSetup();
    const panel = new Element();
    els.builder.closest = () => panel;
    els.detailLoading = new Element();
    form._bindEvents();
    els.currentId = new Element();
    const row = rows()[0];
    els.fName.value = 'Unsaved name';
    els.builder.scrollTop = 240;
    store.setDetailLoading(true, 'b');
    assert.equal(panel.classList.contains('is-detail-loading'), true);
    assert.equal(panel['aria-busy'], 'true');
    assert.match(els.detailLoading.innerHTML, /skeleton/);
    assert.match(els.detailLoading.innerHTML, /aria-hidden="true"/);
    assert.equal(els.fName.value, 'Unsaved name');
    assert.equal(rows()[0], row);
    assert.equal(els.currentId.textContent, '—');
    store.setDetailLoading(false);
    assert.equal(panel.classList.contains('is-detail-loading'), false);
    assert.equal(els.detailLoading.hidden, true);
    assert.equal(els.fName.value, 'Unsaved name');
    assert.equal(els.builder.scrollTop, 240);
    assert.equal(rows()[0], row);
    assert.equal(form.hasUnsavedChanges(), true);
    store.setDetailError('Network unavailable');
    assert.equal(panel.classList.contains('is-detail-loading'), false);
    assert.match(els.detailLoading.innerHTML, /Your previous exercise is still open/);
    assert.equal(els.detailLoading.classList.contains('error'), true);
    assert.equal(els.fName.value, 'Unsaved name');
    assert.match(els.detailLoading.innerHTML, /Dismiss/);
    els.detailLoading.dispatch('click', {target: {closest: () => ({dataset: {exerciseAction: 'dismiss-detail-error'}})}});
    assert.equal(store.getState().detailError, '');
    assert.equal(els.detailLoading.hidden, true);
    assert.equal(document.activeElement, els.fName);
    assert.equal(els.fName.value, 'Unsaved name');
    assert.equal(els.builder.scrollTop, 240);
    assert.equal(rows()[0], row);
}));

test('dictionary loading without a current record stays in the global indicator while errors remain visible', withBundleDocument(() => {
    const {form, els} = formSetup(null);
    els.dictionaryStatus = new Element();
    form._dicts.loading = true;
    form._dicts.errors = [];
    form._updateDictionaryStatus();
    assert.equal(els.dictionaryStatus.hidden, true);
    form._dicts.errors = ['Equipment unavailable'];
    form._updateDictionaryStatus();
    assert.equal(els.dictionaryStatus.hidden, false);
}));

test('initial list skeletons are decorative and cached rows survive list and selection refresh states', withBundleDocument(() => {
    const store = new ExerciseStore();
    const list = new Element(); list.contains = target => list.children.includes(target);
    const view = Object.create(ExerciseListView.prototype);
    view._store = store; view._els = {list, count: new Element(), qualitySummary: new Element()}; view._onSelect = () => {}; view._rendered = null;
    store.setLoading(true); view.render();
    assert.match(list.innerHTML, /skeleton-list/);
    assert.match(list.innerHTML, /aria-hidden="true"/);
    assert.match(list.innerHTML, /sr-only/);
    assert.equal(view._els.qualitySummary.textContent, 'Checks run when exercises load.');
    const a = exercise('a'), b = exercise('b');
    store.setItems([a, b]); store.setLoading(false); view.render();
    const row = list.children[0];
    const other = list.children[1];
    row.focus(); list.scrollTop = 168;
    const count = view._els.count.textContent;
    store.setLoading(true); view.render();
    assert.equal(list.children[0], row);
    assert.equal(list['aria-busy'], 'true');
    assert.equal(view._els.count.textContent, count);
    store.setItems([{...a}, {...b}]); store.setLoading(false); view.render();
    assert.equal(list.children[0], row);
    store.setDetailLoading(true, 'a'); view.render();
    assert.equal(list.children[0], row);
    assert.equal(row.classList.contains('is-loading'), true);
    assert.equal(row['aria-busy'], 'true');
    store.setCurrent(b); view.render();
    assert.equal(list.children[0], row);
    assert.equal(list.children[1], other);
    assert.equal(document.activeElement, row);
    assert.equal(list.scrollTop, 168);
    assert.equal(other['aria-selected'], 'true');
    assert.equal(other.classList.contains('active'), true);
    assert.equal(row['aria-selected'], 'false');
    assert.equal(row.dataset.quality, undefined);
}));

function filterListSetup(store = new ExerciseStore()) {
    const list = new Element(); list.contains = target => list.children.includes(target);
    const view = Object.create(ExerciseListView.prototype);
    view._store = store; view._onSelect = () => {}; view._rendered = null;
    view._els = {list, filters: new Element(), filterCount: new Element(), filterResults: new Element(),
        clearFiltersBtn: new Element(), qualityFilter: new Element()};
    view._bindEvents(() => {}, () => {});
    store.subscribe(() => view.render()); view.render();
    return {view, store, ...view._els};
}

test('exercise filters count only the quality selection and report honest loading, loaded and failed-refresh results', withBundleDocument(() => {
    const {store, filters, filterCount, filterResults, clearFiltersBtn} = filterListSetup();
    assert.equal(filterCount.textContent, 'Any'); assert.equal(clearFiltersBtn.disabled, true);
    filters.open = true; store.setLoading(true);
    assert.equal(filterResults.textContent, 'Loading exercises…'); assert.equal(filters.open, false);
    store.setItems([exercise('a'), exercise('b')]); store.setLoading(false);
    assert.equal(filterResults.textContent, '2 of 2 exercises');
    filters.open = true; store.setQualityFilter('attention');
    assert.equal(filterCount.textContent, '1 active'); assert.equal(clearFiltersBtn.disabled, false);
    assert.equal(filterResults.textContent, '0 of 2 exercises');
    assert.equal(filters.open, true, 'zero matches in a loaded library must not close active filters');
    store.setLoadError('503 <private response>');
    assert.equal(filterResults.textContent, '0 of 2 exercises · Refresh failed');
    store.reset();
    assert.equal(filterCount.textContent, 'Any'); assert.equal(filterResults.textContent, '0 of 0 exercises');
    assert.equal(clearFiltersBtn.disabled, true); assert.equal(filters.open, false);
}));

for (const mode of ['form', 'json']) test(`clearing exercise quality filters preserves search, sorting and the live ${mode} draft`, withBundleDocument(() => {
    const {store, form, els} = formSetup();
    store.setItems([{...exercise('a'), nameTranslations: {en: 'Needle squat'}}, exercise('b')]);
    const {clearFiltersBtn, filterCount, filterResults, filters} = filterListSetup(store);
    store.setSearchQuery('needle'); store.setSortKey('createdAt'); store.setQualityFilter('attention');
    filters.open = true;
    els.fName.value = 'Unsaved local name';
    if (mode === 'json') { els.viewJson.dispatch('click'); els.editor.value = '{invalid unsaved JSON'; }
    const before = store.getState();
    assert.equal(form.hasUnsavedChanges(), true);
    clearFiltersBtn.dispatch('click');
    assert.equal(store.getState().qualityFilter, 'all');
    assert.equal(store.getState().searchQuery, 'needle'); assert.equal(store.getState().sortKey, 'createdAt');
    assert.equal(store.getState().current, before.current); assert.equal(store.getState().viewMode, before.viewMode);
    assert.equal(form.hasUnsavedChanges(), true);
    if (mode === 'json') assert.equal(els.editor.value, '{invalid unsaved JSON');
    else assert.equal(els.fName.value, 'Unsaved local name');
    assert.equal(filterCount.textContent, 'Any'); assert.equal(clearFiltersBtn.disabled, true);
    assert.equal(filterResults.textContent, '1 of 2 exercises'); assert.equal(filters.open, true);
}));

test('empty list messaging changes when search or quality filters become active', withBundleDocument(() => {
    const store = new ExerciseStore();
    const list = new Element(); list.contains = () => false;
    const view = Object.create(ExerciseListView.prototype);
    view._store = store; view._els = {list}; view._onSelect = () => {}; view._rendered = null;
    view.render();
    assert.match(list.innerHTML, /No exercises yet/);
    store.setSearchQuery('squat'); view.render();
    assert.match(list.innerHTML, /No matching exercises/);
    store.setSearchQuery(''); view.render();
    assert.match(list.innerHTML, /No exercises yet/);
    store.setQualityFilter('attention'); view.render();
    assert.match(list.innerHTML, /No matching exercises/);
}));

test('one diagnostic upgrade preserves unrelated rows and reused callbacks resolve the latest item', withBundleDocument(() => {
    const store = new ExerciseStore();
    const raw = id => { const value = {...exercise(id), imageUrl: '/squat.png'}; delete value.nameTranslations; delete value.descriptionTranslations; return value; };
    const a = {...raw('a'), exerciseExampleBundles: [{muscleId: 'quadriceps', percentage: 90}]}, b = raw('b');
    store.setItems([a, b], {diagnosticSources: new Map([['a', a], ['b', b]])});
    const list = new Element(); list.contains = target => list.children.includes(target);
    const view = Object.create(ExerciseListView.prototype);
    let selected;
    view._store = store; view._els = {list}; view._onSelect = item => { selected = item; }; view._rendered = null;
    view.render();
    const bRow = list.children[1];
    assert.doesNotMatch(bRow.innerHTML, /No flags found|not verified/);
    const bReport = store.getDiagnosticReport('b');
    store.setDiagnosticSource('a', a, {translationSnapshot: {id: 'a', base: {name: 'Squat', description: 'Controlled squat'}, translations: [{language: 'en', name: 'Squat', description: 'Controlled squat'}]}});
    view.render();
    assert.equal(store.getDiagnosticReport('b'), bReport);
    assert.equal(list.children[1], bRow);
    const refreshedB = {...b, description: 'New server text'};
    store.setItems([a, refreshedB]); view.render();
    assert.equal(list.children[1], bRow);
    bRow.dispatch('click');
    assert.equal(selected, refreshedB);
}));

test('reset clears hidden exercise form, JSON, preview and row data while preserving editor preference', withBundleDocument(() => {
    const {store, els} = bundleFormSetup();
    els.viewJson.dispatch('click');
    assert.match(els.editor.value, /Squat/);
    store.reset();
    assert.equal(store.getState().viewMode, 'json');
    assert.equal(els.editor.value, '');
    for (const key of ['fId', 'fName', 'fDescription', 'fImage', 'fCategory', 'fExperience', 'fWeightType', 'fForceType']) assert.equal(els[key].value, '');
    assert.equal(els.previewImg.src, undefined);
    assert.equal(els.equipTokens.children[0].children.length, 0);
    assert.equal(els.bundles.querySelectorAll('[data-bundle-index]').length, 0);
}));

test('a realistic full GET entity produces only the strict backend write DTO at every level', () => {
    const raw = {...exercise('11111111-1111-4111-8111-111111111111'), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
        usageCount: 7, componentsEntity: {id: 'readonly'}, exercises: [],
        components: {externalWeight: {required: true, id: 'readonly'}, bodyWeight: null, extraWeight: null, assistWeight: null, readOnlyFlag: true},
        exerciseExampleBundles: [{id: 'bundle-readonly', exerciseExampleId: 'readonly', muscleId: '22222222-2222-4222-8222-222222222222', percentage: 100, muscle: {name: 'Quadriceps'}, createdAt: 'readonly'}],
        equipmentRefs: [{id: 'ref-readonly', equipmentId: '33333333-3333-4333-8333-333333333333', equipment: {name: 'Barbell'}, exerciseExampleId: 'readonly'}]};
    const payload = Normalizer.buildPersistencePayload(raw);
    assert.deepEqual(Object.keys(payload).sort(), ['name', 'description', 'weightType', 'category', 'experience', 'forceType', 'imageUrl', 'components', 'exerciseExampleBundles', 'equipmentRefs'].sort());
    assert.deepEqual(payload.exerciseExampleBundles, [{muscleId: '22222222-2222-4222-8222-222222222222', percentage: 100}]);
    assert.deepEqual(payload.equipmentRefs, [{equipmentId: '33333333-3333-4333-8333-333333333333'}]);
    assert.deepEqual(payload.components, {externalWeight: {required: true}, bodyWeight: null, extraWeight: null, assistWeight: null});
    assert.deepEqual(payload.name[0], {language: 'en', value: 'Squat'});
    assert.equal(Normalizer.buildPersistencePayload({...raw, imageUrl: undefined}).imageUrl, '');
});

test('validation matches backend integer percentages, explicit component keys, and required bodyweight', () => {
    const dicts = new DictionaryStore({});
    dicts.muscles.set('quadriceps', 'Quadriceps');
    dicts.muscles.set('hamstrings', 'Hamstrings');
    const validator = new ExerciseValidator(dicts);
    const fractional = {...exercise('a'), exerciseExampleBundles: [{muscleId: 'quadriceps', percentage: 33.3}, {muscleId: 'hamstrings', percentage: 66.7}]};
    assert.match(validator.validate(fractional).errors.join(' '), /whole-number/);
    assert.equal(validator.validate({...exercise('a'), components: {}}).ok, false);
    const falseBody = {...exercise('a'), components: {externalWeight: null, bodyWeight: {required: false, multiplier: 1}, extraWeight: null, assistWeight: null}};
    assert.match(validator.validate(falseBody).errors.join(' '), /required set to true/);
});

test('create uses the actual server-generated identity rather than the draft UUID', async () => {
    const {store, controller} = controllerSetup({create: async payload => {
        assert.equal(Object.hasOwn(payload, 'id'), false);
        return {id: 'server-generated'};
    }});
    store.setNew(exercise('draft-uuid'));
    await controller.saveItem(exercise('draft-uuid'));
    assert.equal(store.getState().current.id, 'server-generated');
    assert.equal(store.getState().items[0].entity.id, 'server-generated');
    assert.equal(store.getState().isNew, false);
});

test('a create response without identity blocks duplicate creates until the created record is selected', async () => {
    const {store, form, els} = formSetup(null);
    store.setNew(exercise('draft-uuid'));
    let requests = 0;
    const repo = new ExerciseRepository({_fetch: async () => { requests++; return new Response(null, {status: 204}); }, buildHeaders: () => ({})});
    const controller = new ExerciseController({store, formView: form, repository: repo, bus: new EventBus(), confirmDialog: {}});
    await controller.saveItem(form.readFormToEntity());
    assert.equal(store.getState().createIdentityMissing, true);
    assert.equal(els.saveBtn.disabled, true);
    assert.equal(store.getState().items.length, 0);
    await controller.saveItem(form.readFormToEntity());
    assert.equal(requests, 1);
    store.setCurrent(exercise('found-server-record'));
    assert.equal(store.getState().createIdentityMissing, false);
});

test('list loading fetches every locale and supports real scalar translated names in search', async () => {
    const requested = [];
    const localizedNames = {en: 'Barbell Bench Press', ua: 'Жим штанги лежачи', ru: 'Жим штанги лёжа'};
    const {store, controller} = controllerSetup({fetchList: async locale => {
        requested.push(locale);
        return [{entity: {id: 'bench', name: localizedNames[locale], description: 'Localized description', exerciseExampleBundles: [], equipmentRefs: []}, usageCount: 2}];
    }});
    await controller.loadList();
    assert.deepEqual(requested.sort(), ['en', 'ru', 'ua']);
    assert.equal(store.getState().items.length, 1);
    store.setSearchQuery('Жим штанги лежачи');
    assert.equal(store.getState().filtered.length, 1);
    assert.equal(store.getState().filtered[0].entity.name, 'Barbell Bench Press');
    assert.equal(store.getState().filtered[0].usageCount, 2);
});

test('cancelling replacement of unknown-provenance translations sends no save request', async () => {
    let confirmations = 0;
    let updates = 0;
    const {store, controller} = controllerSetup({update: async () => { updates++; return {id: 'a'}; }});
    store.setCurrent(exercise('a'));
    // An editor field cannot change trusted provenance metadata held separately in the store.
    store.patchCurrent({translationProvenanceKnown: true});
    controller._confirm = {ask: async options => { confirmations++; assert.match(options.detail, /English fallback/); return false; }};
    await controller.saveItem({...exercise('a'), translationProvenanceKnown: true});
    assert.equal(confirmations, 1);
    assert.equal(updates, 0);
    assert.equal(store.getState().translationProvenanceKnown, false);
});

test('confirming localized replacement saves all text and establishes known saved content', async () => {
    let confirmations = 0;
    let updates = 0;
    const {store, controller} = controllerSetup({update: async (_, payload) => {
        updates++;
        assert.deepEqual(payload.name.map(entry => entry.language), ['en', 'ua', 'ru']);
        return {id: 'a'};
    }});
    store.setCurrent(exercise('a'));
    controller._confirm = {ask: async () => { confirmations++; return true; }};
    await controller.saveItem(exercise('a'));
    assert.equal(updates, 1);
    assert.equal(store.getState().translationProvenanceKnown, true);
    await controller.saveItem(exercise('a'));
    assert.equal(updates, 2);
    assert.equal(confirmations, 1);
});

test('new exercises and authoritative raw language maps do not need fallback replacement confirmation', async () => {
    let confirmations = 0;
    const {store, controller} = controllerSetup({create: async () => ({id: 'new-saved'}),
        update: async () => ({id: 'a'}), fetchDetail: async () => ({entity: exercise('a')}),
        fetchTranslations: async () => ExerciseTranslations.fromEntity(exercise('a'))});
    controller._confirm = {ask: async () => { confirmations++; return true; }};
    store.setNew(exercise('draft'));
    await controller.saveItem(exercise('draft'));
    await controller.selectItem({id: 'a'});
    assert.equal(store.getState().translationProvenanceKnown, true);
    await controller.saveItem(exercise('a'));
    assert.equal(confirmations, 0);
});

test('a failed locale list refresh preserves the old searchable cache and exposes the error', async () => {
    const previous = [{entity: exercise('cached')}];
    const {store, controller} = controllerSetup({fetchList: async locale => {
        if (locale === 'ua') throw new Error('Ukrainian response unavailable');
        return [{entity: exercise('replacement')}];
    }});
    store.setItems(previous);
    await controller.loadList();
    assert.equal(store.getState().items[0].entity.id, 'cached');
    assert.match(store.getState().loadError, /Ukrainian response unavailable/);
    assert.equal(store.getState().isLoading, false);
});

test('localized fallback text is visibly unverified and cannot claim complete translation coverage', () => {
    const {store, els} = formSetup();
    const languageButton = new Element();
    languageButton.dataset.locale = 'ua';
    els.localeButtons = [languageButton];
    els.translationNotice = new Element();
    store.setCurrent(exercise('a'));
    assert.equal(languageButton.classList.contains('has-translation'), false);
    assert.equal(languageButton.classList.contains('translation-unverified'), true);
    assert.match(languageButton.title, /coverage is unknown/);
    assert.equal(els.translationNotice.hidden, false);
    store.setNew(exercise('new'));
    assert.equal(els.translationNotice.hidden, true);
    assert.equal(languageButton.classList.contains('has-translation'), true);
});

test('unchanged Push Up components and a 0.7 multiplier survive Form/JSON roundtrips without dirty state', () => {
    const components = {externalWeight: null, bodyWeight: {required: true, multiplier: 0.7}, extraWeight: {required: false}, assistWeight: null};
    const {form, els} = formSetup({...exercise('push-up'), weightType: 'body_weight', components});
    assert.equal(form.hasUnsavedChanges(), false);
    els.viewJson.dispatch('click');
    els.viewForm.dispatch('click');
    assert.deepEqual(form.readFormToEntity().components, components);
    assert.equal(form.hasUnsavedChanges(), false);
    els.fRulesBodyWeightMultiplier.value = '0.8';
    els.fRulesBodyWeightMultiplier.dispatch('input');
    assert.equal(form.readFormToEntity().components.bodyWeight.multiplier, 0.8);
    assert.equal(form.hasUnsavedChanges(), true);
});

test('native slider quantization does not alter an exact loaded multiplier before user input', () => {
    const components = {externalWeight: null, bodyWeight: {required: true, multiplier: 0.73}, extraWeight: {required: false}, assistWeight: null};
    const {form, els} = formSetup({...exercise('push-up'), weightType: 'body_weight', components});
    // Native range controls snap off-grid values to their configured 0.05 step when rendered.
    els.fRulesBodyWeightMultiplier.value = '0.75';
    form._syncBodyWeightMultiplierLabel();
    assert.equal(form.readFormToEntity().components.bodyWeight.multiplier, 0.73);
    assert.equal(els.fRulesBodyWeightMultiplierValue.textContent, '0.73×');
    assert.equal(form.hasUnsavedChanges(), false);
    els.fRulesBodyWeightMultiplier.dispatch('input');
    assert.equal(form.readFormToEntity().components.bodyWeight.multiplier, 0.75);
    assert.equal(form.hasUnsavedChanges(), true);
});

test('optional API nulls and read-only metadata do not create unsaved changes during mode switches', () => {
    const {form, els} = formSetup({...exercise('nullable'), imageUrl: null, createdAt: '2026-01-01', updatedAt: '2026-01-02', legacyRulesMetadata: {version: 1}});
    assert.equal(form.hasUnsavedChanges(), false);
    els.viewJson.dispatch('click');
    const draft = JSON.parse(els.editor.value);
    draft.updatedAt = '2026-01-03';
    els.editor.value = JSON.stringify(draft);
    assert.equal(form.hasUnsavedChanges(), false);
    els.viewForm.dispatch('click');
    assert.equal(form.hasUnsavedChanges(), false);
    els.fImage.value = '/new-image.png';
    assert.equal(form.hasUnsavedChanges(), true);
});

test('native textarea line-ending normalization is not an edit while changed description text is', () => {
    const original = {...exercise('multiline'), description: 'First line\r\nSecond line', descriptionTranslations: {en: 'First line\r\nSecond line', ua: '', ru: ''}};
    const {form, els} = formSetup(original);
    // A native textarea exposes LF endings even when the API supplied CRLF.
    els.fDescription.value = 'First line\nSecond line';
    assert.equal(form.hasUnsavedChanges(), false);
    els.fDescription.value += '\nThird line';
    assert.equal(form.hasUnsavedChanges(), true);
});

const rawSnapshot = (id = 'a', translations = [{language: 'en', name: 'Squat', description: 'Controlled squat'}], base = {name: 'Squat', description: 'Controlled squat'}) => ({id, base, translations});
const localizedExercise = id => {
    const {nameTranslations, descriptionTranslations, ...entity} = exercise(id);
    return {entity};
};

function rawTranslationSetup(snapshot, overrides = {}) {
    const setup = formSetup(null);
    const payloads = [];
    let confirmations = 0;
    const repository = {fetchDetail: async id => localizedExercise(id), fetchTranslations: async () => snapshot,
        update: async (id, payload) => { payloads.push(payload); return {id}; }, ...overrides};
    const controller = new ExerciseController({store: setup.store, formView: setup.form, repository, bus: new EventBus(),
        confirmDialog: {ask: async () => { confirmations++; return true; }}});
    return {...setup, controller, payloads, confirmations: () => confirmations};
}

test('the raw translation repository uses the protected admin read route and preserves status failures', async () => {
    let requested;
    const repository = new ExerciseRepository({buildHeaders: () => ({Authorization: 'Bearer synthetic'}),
        _fetch: async (url, options) => { requested = {url, options}; return Response.json(rawSnapshot()); }});
    assert.deepEqual(await repository.fetchTranslations('a'), rawSnapshot());
    assert.match(requested.url, /\/admin\/exercise-examples\/a\/translations$/);
    assert.equal(requested.options.headers.Authorization, 'Bearer synthetic');
    repository._client._fetch = async () => new Response(null, {status: 404});
    await assert.rejects(() => repository.fetchTranslations('a'), error => error.status === 404);
});

test('an English-only raw snapshot stays without UA/RU values after an attribute-only edit', async () => {
    const {controller, store, form, els, payloads, confirmations} = rawTranslationSetup(rawSnapshot());
    await controller.selectItem({id: 'a'});
    assert.equal(store.getState().translationProvenanceKnown, true);
    assert.equal(store.getState().current.nameTranslations.ua, '');
    assert.equal(store.getState().current.descriptionTranslations.ru, '');
    els.fCategory.value = 'isolation';
    await controller.saveItem(form.readFormToEntity());
    assert.equal(confirmations(), 0);
    assert.deepEqual(payloads[0].name.filter(entry => entry.value), [{language: 'en', value: 'Squat'}]);
    assert.deepEqual(payloads[0].description.filter(entry => entry.value), [{language: 'en', value: 'Controlled squat'}]);
    assert.deepEqual(store.getState().translationSnapshot.translations, rawSnapshot().translations);
});

test('raw nullable fields remain independent while distinct untouched UA/RU text survives a form save', async () => {
    const translations = [{language: 'en', name: 'Squat', description: 'Controlled squat'},
        {language: 'ua', name: null, description: 'Український опис'},
        {language: 'ru', name: 'Приседание', description: null}];
    const {controller, store, form, els, payloads} = rawTranslationSetup(rawSnapshot('a', translations));
    await controller.selectItem({id: 'a'});
    assert.deepEqual(store.getState().current.nameTranslations, {en: 'Squat', ua: '', ru: 'Приседание'});
    assert.deepEqual(store.getState().current.descriptionTranslations, {en: 'Controlled squat', ua: 'Український опис', ru: ''});
    store.setLocale('ua');
    assert.equal(els.fName.value, '');
    assert.equal(els.fDescription.value, 'Український опис');
    els.fExperience.value = 'intermediate';
    await controller.saveItem(form.readFormToEntity());
    assert.deepEqual(payloads[0].name.find(entry => entry.language === 'ua'), {language: 'ua'});
    assert.deepEqual(payloads[0].description.find(entry => entry.language === 'ua'), {language: 'ua', value: 'Український опис'});
    assert.deepEqual(payloads[0].name.find(entry => entry.language === 'ru'), {language: 'ru', value: 'Приседание'});
    assert.deepEqual(store.getState().translationSnapshot.translations, translations);
});

test('explicitly clearing a stored locale removes that content without clearing another locale', async () => {
    const translations = [{language: 'en', name: 'Squat', description: 'Controlled squat'},
        {language: 'ua', name: 'Присідання', description: 'Український опис'},
        {language: 'ru', name: 'Приседание', description: 'Русское описание'}];
    const {controller, store, form, els, payloads} = rawTranslationSetup(rawSnapshot('a', translations));
    await controller.selectItem({id: 'a'});
    store.setLocale('ua');
    els.fName.value = '';
    els.fDescription.value = '';
    await controller.saveItem(form.readFormToEntity());
    assert.deepEqual(payloads[0].name.find(entry => entry.language === 'ua'), {language: 'ua'});
    assert.deepEqual(payloads[0].description.find(entry => entry.language === 'ua'), {language: 'ua'});
    assert.deepEqual(store.getState().translationSnapshot.translations.map(row => row.language), ['en', 'ru']);
    assert.deepEqual(store.getState().translationSnapshot.translations[1], translations[2]);
});

test('legacy base-only English remains readable, warns about promotion, and never creates UA/RU text', async () => {
    const snapshot = rawSnapshot('a', [], {name: 'Legacy squat', description: 'Legacy base description'});
    const {controller, store, form, els, payloads} = rawTranslationSetup(snapshot);
    els.translationNotice = new Element();
    await controller.selectItem({id: 'a'});
    assert.equal(els.fName.value, 'Legacy squat');
    assert.equal(els.fDescription.value, 'Legacy base description');
    assert.equal(els.translationNotice.hidden, false);
    assert.match(els.translationNotice.innerHTML, /<details><summary>Legacy translation text/);
    assert.match(els.translationNotice.innerHTML, /Saving will store that text in an English translation row/);
    assert.deepEqual(store.getState().translationSnapshot.translations, []);
    els.fCategory.value = 'isolation';
    await controller.saveItem(form.readFormToEntity());
    assert.deepEqual(payloads[0].name.filter(entry => entry.value), [{language: 'en', value: 'Legacy squat'}]);
    assert.deepEqual(store.getState().translationSnapshot.translations.map(row => row.language), ['en']);
    assert.equal(els.translationNotice.hidden, true);
});

test('legacy base versus English divergence is disclosed while stored translation values remain authoritative', async () => {
    const snapshot = rawSnapshot('a', [{language: 'en', name: 'Stored English', description: 'Stored description'}], {name: 'Different base', description: 'Different base description'});
    const {controller, store, els} = rawTranslationSetup(snapshot);
    els.translationNotice = new Element();
    await controller.selectItem({id: 'a'});
    assert.equal(store.getState().current.nameTranslations.en, 'Stored English');
    assert.match(els.translationNotice.innerHTML, /base text differs/);
    assert.match(els.translationNotice.innerHTML, /normalize the base text/);
});

test('the concise persistent translation disclosure preserves its DOM for the same record and resets for another', async () => {
    const legacy = rawSnapshot('a', [], {name: 'Legacy squat', description: 'Legacy description'});
    const {controller, store, els} = rawTranslationSetup(legacy);
    els.translationNotice = new Element();
    await controller.selectItem({id: 'a'});
    assert.match(els.translationNotice.innerHTML, /^<details><summary>Legacy translation text/);
    assert.match(els.translationNotice.innerHTML, /<p>Legacy English base text/);
    const disclosure = {open: true};
    els.translationNotice.querySelector = () => disclosure;
    const html = els.translationNotice.innerHTML;
    store.setSearchQuery('squat'); store.setLocale('ua');
    assert.equal(els.translationNotice.innerHTML, html);
    assert.equal(disclosure.open, true);
    store.setCurrent({...store.getState().current, id: 'b'}, {translationProvenanceKnown: true, translationSnapshot: {...legacy, id: 'b'}});
    assert.match(els.translationNotice.innerHTML, /^<details><summary>/);
    store.reset();
    assert.equal(els.translationNotice.hidden, true);
    assert.equal(els.translationNotice.innerHTML, '');
});

test('raw 404 compatibility fallback is used only after successful localized reads and stays unverified', async () => {
    const localized = deferred();
    let rawRequests = 0;
    const {store, controller} = controllerSetup({fetchDetail: () => localized.promise, fetchTranslations: async () => {
        rawRequests++;
        const error = new Error('Old deployed API'); error.status = 404; throw error;
    }});
    const selecting = controller.selectItem({id: 'a'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rawRequests, 1, 'raw read runs while the localized reads are pending');
    assert.equal(store.getState().current, null, '404 fallback is not applied before localized success');
    localized.resolve(localizedExercise('a'));
    await selecting;
    assert.equal(rawRequests, 1);
    assert.equal(store.getState().current.id, 'a');
    assert.equal(store.getState().translationProvenanceKnown, false);
    assert.equal(store.getState().translationSnapshot, null);
});

test('failed localized reads cannot apply an already-started raw snapshot or replace the existing selection', async () => {
    let rawRequests = 0;
    const {store, controller} = controllerSetup({fetchDetail: async (_, locale) => {
        if (locale === 'ua') throw new Error('Localized exercise failed');
        return localizedExercise('candidate');
    }, fetchTranslations: async () => { rawRequests++; return rawSnapshot('candidate'); }});
    const previous = exercise('previous');
    store.setCurrent(previous);
    await controller.selectItem({id: 'candidate'});
    assert.equal(rawRequests, 1);
    assert.equal(store.getState().current, previous);
    assert.match(store.getState().detailError, /Localized exercise failed/);
});

test('early parallel raw authorization or service failures remain fail-closed after localized success', async () => {
    for (const status of [401, 503]) {
        const localized = deferred(), rawStarted = deferred();
        const {store, controller} = controllerSetup({fetchDetail: () => localized.promise, fetchTranslations: async () => {
            rawStarted.resolve();
            throw Object.assign(new Error(`Raw endpoint failed ${status}`), {status});
        }});
        const previous = exercise('previous'); store.setCurrent(previous);
        const selecting = controller.selectItem({id: 'candidate'});
        await rawStarted.promise;
        assert.equal(store.getState().current, previous);
        localized.resolve(localizedExercise('candidate'));
        await selecting;
        assert.equal(store.getState().current, previous);
        assert.match(store.getState().detailError, new RegExp(String(status)));
    }
});

test('malformed, duplicate, mismatched and failed raw snapshots cannot overwrite the current record', async () => {
    const invalid = [rawSnapshot('wrong'), {...rawSnapshot('candidate'), base: {name: 42, description: null}},
        rawSnapshot('candidate', [{language: 'ua', name: null, description: 'A'}, {language: 'ua', name: 'B', description: null}]),
        rawSnapshot('candidate', [{language: 'unsupported', name: 'A', description: null}]),
        rawSnapshot('candidate', [{language: 'ua', name: {}, description: null}])];
    for (const raw of invalid) {
        const {store, controller} = controllerSetup({fetchDetail: async () => localizedExercise('candidate'), fetchTranslations: async () => raw});
        const previous = exercise('previous');
        const previousSnapshot = rawSnapshot('previous');
        store.setCurrent(previous, {translationProvenanceKnown: true, translationSnapshot: previousSnapshot});
        await controller.selectItem({id: 'candidate'});
        assert.equal(store.getState().current, previous);
        assert.equal(store.getState().translationSnapshot, previousSnapshot);
        assert.equal(store.getState().isDetailLoading, false);
        assert.ok(store.getState().detailError);
    }
    for (const status of [403, 500]) {
        const {store, controller} = controllerSetup({fetchDetail: async () => localizedExercise('candidate'), fetchTranslations: async () => {
            const error = new Error(`Raw endpoint failed ${status}`); error.status = status; throw error;
        }});
        store.setCurrent(exercise('previous'));
        await controller.selectItem({id: 'candidate'});
        assert.equal(store.getState().current.id, 'previous');
        assert.match(store.getState().detailError, /Raw endpoint failed/);
    }
});

test('late raw snapshots cannot replace a new exercise, a newer selection, or a logged-out session', async () => {
    for (const transition of ['new', 'select', 'logout']) {
        const pendingRaw = deferred();
        const started = deferred();
        const {store, controller, bus} = controllerSetup({fetchDetail: async id => localizedExercise(id), fetchTranslations: async id => {
            if (id === 'a') { started.resolve(); return pendingRaw.promise; }
            return rawSnapshot(id);
        }});
        const selecting = controller.selectItem({id: 'a'});
        await started.promise;
        if (transition === 'new') await controller.newItem();
        if (transition === 'select') await controller.selectItem({id: 'b'});
        if (transition === 'logout') bus.emit(Events.AUTH_LOGOUT);
        const current = store.getState().current;
        pendingRaw.resolve(rawSnapshot('a'));
        await selecting;
        assert.equal(store.getState().current, current);
        if (transition === 'select') assert.equal(store.getState().translationSnapshot.id, 'b');
        else assert.equal(store.getState().translationSnapshot, null);
    }
});

test('raw snapshot metadata stays outside editable JSON and JSON fields cannot override it', async () => {
    const {store, controller, form, els} = rawTranslationSetup(rawSnapshot());
    await controller.selectItem({id: 'a'});
    const trustedSnapshot = store.getState().translationSnapshot;
    els.viewJson.dispatch('click');
    const json = JSON.parse(els.editor.value);
    assert.equal(Object.hasOwn(json, 'translationSnapshot'), false);
    json.translationSnapshot = rawSnapshot('forged', [{language: 'ua', name: 'forged', description: 'forged'}]);
    json.translationProvenanceKnown = false;
    els.editor.value = JSON.stringify(json);
    assert.equal(form.flush(), true);
    assert.equal(store.getState().translationSnapshot, trustedSnapshot);
    assert.equal(store.getState().translationProvenanceKnown, true);
});
