import test from 'node:test';
import assert from 'node:assert/strict';
import {ExerciseController} from '../src/features/exercises/ExerciseController.js';
import {ExerciseStore} from '../src/features/exercises/ExerciseStore.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Toast} from '../src/shared/components/Toast.js';

Toast.show = () => {};
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return {promise, resolve, reject}; };
const record = (id, percentage = 100) => ({id, name: 'Squat', description: 'Controlled movement',
    weightType: 'free', category: 'compound', experience: 'beginner', forceType: 'push', imageUrl: 'https://example.test/a.png',
    components: {externalWeight: {required: true}, bodyWeight: null, extraWeight: null, assistWeight: null},
    equipmentRefs: [], exerciseExampleBundles: [{muscleId: 'quads', percentage}]});
const snapshot = id => ({id, base: {name: 'Squat', description: 'Controlled movement'},
    translations: [{language: 'en', name: 'Squat', description: 'Controlled movement'}]});
function setup(repository) {
    const store = new ExerciseStore();
    const controller = new ExerciseController({store, repository: {fetchTranslations: async id => snapshot(id), ...repository},
        bus: new EventBus(), formView: {hasUnsavedChanges: () => false, markSaved() {}}, confirmDialog: {ask: async () => true}});
    return {store, controller};
}

test('queue eligibility is rechecked after draft confirmation and cannot discard the draft for a removed target', async () => {
    const confirmation = deferred(); let requests = 0; let eligible = true;
    const {store, controller} = setup({fetchDetail: async id => { requests++; return record(id); }});
    controller._form.hasUnsavedChanges = () => true;
    controller._confirm.ask = () => confirmation.promise;
    store.setCurrent({...record('a'), description: 'Keep my draft'});
    const current = store.getState().current;
    const selecting = controller.selectItem({id: 'b'}, {canSelect: () => eligible});
    eligible = false; confirmation.resolve(true); await selecting;
    assert.equal(requests, 0); assert.equal(store.getState().current, current);
    assert.equal(store.getState().isDetailLoading, false);
});

for (const delayedRead of ['localized', 'raw']) test(`queue invalidation during ${delayedRead} reads preserves the draft and saved checks`, async () => {
    const response = deferred();
    const started = deferred();
    const {store, controller} = setup({
        fetchDetail: async id => {
            if (delayedRead === 'localized') { started.resolve(); await response.promise; }
            return record(id);
        },
        fetchTranslations: async id => {
            if (delayedRead === 'raw') { started.resolve(); await response.promise; }
            return snapshot(id);
        },
    });
    store.setItems([record('a'), record('b', 90)]);
    store.setCurrent({...record('a'), description: 'Keep this current draft'}, {
        translationProvenanceKnown: true, translationSnapshot: snapshot('a'),
    });
    store.setQualityFilter('attention');
    const queuedItems = store.getState().filtered;
    const current = store.getState().current;
    const savedChecks = store.getDiagnosticReport('b');
    const canSelect = () => store.getState().qualityFilter === 'attention' && store.getState().filtered === queuedItems;
    const selecting = controller.selectItem({id: 'b'}, {canSelect});
    await started.promise;
    assert.equal(store.getState().selectingId, 'b');
    store.setQualityFilter('all');
    assert.equal(canSelect(), false);
    response.resolve();
    await selecting;
    assert.equal(store.getState().current, current);
    assert.equal(store.getState().translationSnapshot.id, 'a');
    assert.equal(store.getDiagnosticReport('b'), savedChecks);
    assert.equal(store.getState().isDetailLoading, false);
    assert.equal(store.getState().selectingId, null);

    await controller.selectItem({id: 'b'}, {canSelect: () => true});
    assert.equal(store.getState().current.id, 'b', 'a later eligible selection still completes');
    assert.equal(store.getState().translationSnapshot.id, 'b');
    assert.notEqual(store.getDiagnosticReport('b'), savedChecks);
    assert.equal(store.getState().isDetailLoading, false);
});

test('a failed invalidated queue selection cannot add an error over the retained record', async t => {
    const response = deferred();
    const started = deferred();
    const show = Toast.show;
    let notifications = 0;
    Toast.show = () => { notifications++; };
    t.after(() => { Toast.show = show; });
    const {store, controller} = setup({fetchDetail: async id => record(id),
        fetchTranslations: () => { started.resolve(); return response.promise; }});
    store.setItems([record('a'), record('b', 90)]);
    store.setCurrent(record('a'), {translationProvenanceKnown: true, translationSnapshot: snapshot('a')});
    store.setQualityFilter('attention');
    const current = store.getState().current;
    const savedChecks = store.getDiagnosticReport('b');
    const selecting = controller.selectItem({id: 'b'}, {canSelect: () => store.getState().qualityFilter === 'attention'});
    await started.promise;
    store.setQualityFilter('all');
    response.reject(new Error('Failure from the cancelled selection'));
    await selecting;
    assert.equal(store.getState().current, current);
    assert.equal(store.getState().translationSnapshot.id, 'a');
    assert.equal(store.getDiagnosticReport('b'), savedChecks);
    assert.equal(store.getState().detailError, '');
    assert.equal(notifications, 0);
    assert.equal(store.getState().isDetailLoading, false);
    assert.equal(store.getState().selectingId, null);
});

test('returning to current A cancels pending B without discarding the current A draft', async () => {
    const pendingB = deferred();
    const {store, controller} = setup({fetchDetail: () => pendingB.promise});
    store.setCurrent({...record('a'), description: 'Current unsaved draft'}, {translationProvenanceKnown: true, translationSnapshot: snapshot('a')});
    const current = store.getState().current;
    const openingB = controller.selectItem({id: 'b'});
    await Promise.resolve();
    assert.equal(store.getState().selectingId, 'b');
    await controller.selectItem({id: 'a'});
    assert.equal(store.getState().isDetailLoading, false);
    assert.equal(store.getState().selectingId, null);
    assert.equal(store.getState().current, current);
    pendingB.resolve(record('b'));
    await openingB;
    assert.equal(store.getState().current, current);
    assert.equal(store.getState().translationSnapshot.id, 'a');
    assert.equal(store.getDiagnosticReport('b'), null);
});

test('returning to current A supersedes B before B has started loading', async () => {
    let requests = 0;
    const {store, controller} = setup({fetchDetail: async id => { requests++; return record(id); }});
    store.setCurrent(record('a'));
    const current = store.getState().current;
    const openingB = controller.selectItem({id: 'b'});
    await controller.selectItem({id: 'a'});
    await openingB;
    assert.equal(store.getState().current, current);
    assert.equal(store.getState().isDetailLoading, false);
    assert.equal(requests, 0);
});

test('returning to current A also suppresses a pending B raw translation response', async () => {
    const pendingRaw = deferred();
    const rawStarted = deferred();
    const {store, controller} = setup({fetchDetail: async id => record(id), fetchTranslations: () => { rawStarted.resolve(); return pendingRaw.promise; }});
    store.setCurrent(record('a'), {translationProvenanceKnown: true, translationSnapshot: snapshot('a')});
    const current = store.getState().current;
    const openingB = controller.selectItem({id: 'b'});
    await rawStarted.promise;
    await controller.selectItem({id: 'a'});
    pendingRaw.resolve(snapshot('b'));
    await openingB;
    assert.equal(store.getState().current, current);
    assert.equal(store.getState().isDetailLoading, false);
    assert.equal(store.getState().translationSnapshot.id, 'a');
    assert.equal(store.getDiagnosticReport('b'), null);
});

test('an older list response cannot replace newer selected-detail diagnostic evidence', async () => {
    const pendingList = deferred();
    const {store, controller} = setup({fetchList: () => pendingList.promise, fetchDetail: async id => record(id)});
    const listLoading = controller.loadList();
    await controller.selectItem({id: 'a'});
    const selected = store.getState().current;
    const detailReport = store.getDiagnosticReport('a');
    assert.equal(detailReport.findings.some(finding => finding.ruleId === 'muscle-total'), false);
    assert.equal(detailReport.skippedRuleIds.includes('english-text'), false);
    pendingList.resolve([record('a', 90)]);
    await listLoading;
    assert.equal(store.getState().current, selected);
    assert.equal(store.getDiagnosticReport('a'), detailReport);
    assert.equal(store.getState().translationSnapshot.id, 'a');
});

test('a list started after a detail refreshes that record and reports unavailable translation provenance honestly', async () => {
    const {store, controller} = setup({fetchList: async () => [record('a', 90)], fetchDetail: async id => record(id)});
    await controller.selectItem({id: 'a'});
    const current = store.getState().current;
    const translationSnapshot = store.getState().translationSnapshot;
    await controller.loadList();
    const report = store.getDiagnosticReport('a');
    assert.equal(report.findings.some(finding => finding.ruleId === 'muscle-total'), true);
    assert.equal(report.skippedRuleIds.includes('english-text'), true);
    assert.equal(store.getState().current, current);
    assert.equal(store.getState().translationSnapshot, translationSnapshot);
});

test('a slower detail cannot overwrite diagnostic evidence from a list that started later', async () => {
    const pendingDetail = deferred();
    const {store, controller} = setup({fetchList: async () => [record('a', 90)], fetchDetail: () => pendingDetail.promise});
    const selecting = controller.selectItem({id: 'a'});
    await Promise.resolve();
    await controller.loadList();
    const newerListReport = store.getDiagnosticReport('a');
    pendingDetail.resolve(record('a'));
    await selecting;
    assert.equal(store.getDiagnosticReport('a'), newerListReport);
    assert.equal(newerListReport.findings.some(finding => finding.ruleId === 'muscle-total'), true);
    assert.equal(store.getState().translationSnapshot.id, 'a');
});

test('an older list that omits a newly selected record cannot erase its newer diagnostic source', async () => {
    const pendingList = deferred();
    const {store, controller} = setup({fetchList: () => pendingList.promise, fetchDetail: async id => record(id)});
    const listLoading = controller.loadList();
    await controller.selectItem({id: 'a'});
    const report = store.getDiagnosticReport('a');
    pendingList.resolve([]);
    await listLoading;
    assert.equal(store.getDiagnosticReport('a'), report);
    assert.equal(store.getState().diagnosticSummary.recordCount, 0);
});

test('an unrelated save preserves a selected detail omitted by an older list, while its explicit deletion clears it', async () => {
    const pendingList = deferred();
    const pendingSave = deferred();
    const {store, controller} = setup({fetchList: () => pendingList.promise, fetchDetail: async id => record(id),
        update: () => pendingSave.promise, delete: async () => {}});
    const b = {...record('b'), nameTranslations: {en: 'Squat'}, descriptionTranslations: {en: 'Controlled movement'}};
    store.setItems([record('a'), b]);
    store.setCurrent(b, {translationProvenanceKnown: true, translationSnapshot: snapshot('b')});
    const savingB = controller.saveItem(b);
    const loadingList = controller.loadList();
    await controller.selectItem({id: 'a'});
    const aReport = store.getDiagnosticReport('a');
    const aCurrent = store.getState().current;
    pendingList.resolve([record('b')]);
    await loadingList;
    assert.equal(store.getDiagnosticReport('a'), aReport);
    pendingSave.resolve({id: 'b'});
    await savingB;
    assert.equal(store.getState().current, aCurrent);
    assert.equal(store.getDiagnosticReport('a'), aReport);
    await controller.deleteItem('a');
    assert.equal(store.getDiagnosticReport('a'), null);
    assert.equal(store.getState().current, null);
    assert.deepEqual(store.getState().items.map(item => item.entity?.id || item.id), ['b']);
});
