import test from 'node:test';
import assert from 'node:assert/strict';
import {ExerciseController} from '../src/features/exercises/ExerciseController.js';
import {ExerciseStore} from '../src/features/exercises/ExerciseStore.js';
import {ExerciseNormalizer} from '../src/domain/exercise/ExerciseNormalizer.js';
import {ExerciseTranslations} from '../src/domain/exercise/ExerciseTranslations.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Events} from '../src/infrastructure/events/events.js';
import {Toast} from '../src/shared/components/Toast.js';

Toast.show = () => {};
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return {promise, resolve, reject}; };
const record = (id, percentage = 100) => ({id, name: 'Squat', description: 'Controlled movement',
    weightType: 'free', category: 'compound', experience: 'beginner', forceType: 'push', imageUrl: 'https://example.test/a.png',
    components: {externalWeight: {required: true}, bodyWeight: null, extraWeight: null, assistWeight: null},
    equipmentRefs: [], exerciseExampleBundles: [{muscleId: 'quads', percentage}]});
const snapshot = (id, translationsRevision = 'a'.repeat(64)) => ({id, base: {name: 'Squat', description: 'Controlled movement'},
    translations: [{language: 'en', name: 'Squat', description: 'Controlled movement'}], translationsRevision});
function setup(repository) {
    const store = new ExerciseStore();
    const bus = new EventBus();
    const form = {hasUnsavedChanges: () => false, markSaved() {}, readFormToEntity: () => store.getState().current};
    const controller = new ExerciseController({store, repository: {fetchTranslations: async id => snapshot(id), ...repository},
        bus, formView: form, confirmDialog: {ask: async () => true}});
    return {store, controller, bus, form};
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

test('selection waits for all five localized reads and one trusted raw snapshot', async () => {
    const portuguese = deferred(); const requested = []; let rawReads = 0;
    const {store, controller} = setup({
        fetchDetail: async (id, locale) => {
            requested.push(locale);
            if (locale === 'pt-PT') await portuguese.promise;
            return {...record(id), name: `Localized ${locale}`};
        },
        fetchTranslations: async id => { rawReads++; return snapshot(id); },
    });
    const opening = controller.selectItem({id: 'a'});
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(requested, ['en', 'ua', 'ru', 'pt-BR', 'pt-PT']);
    assert.equal(rawReads, 1);
    assert.equal(store.getState().current, null);
    assert.equal(store.getState().isDetailLoading, true);
    portuguese.resolve(); await opening;
    assert.equal(store.getState().current.nameTranslations.en, 'Squat');
    assert.equal(store.getState().current.nameTranslations['pt-PT'], '', 'localized English fallback is absent from raw rows');
    assert.equal(store.getState().translationSnapshot.translationsRevision, 'a'.repeat(64));
    assert.equal(store.getState().isDetailLoading, false);
});

const conflict = code => Object.assign(new Error('Synthetic translation conflict'), {status: 409, code});
const conflictCodes = ['EXERCISE_TRANSLATIONS_STALE', 'EXERCISE_TRANSLATIONS_INCOMPLETE'];
const edit = (id, raw = snapshot(id)) => ExerciseTranslations.applySnapshot(ExerciseNormalizer.normalizeEntityShape(record(id)), raw);
const importedSnapshot = id => ({...snapshot(id, 'b'.repeat(64)), translations: [
    {language: 'en', name: 'New server name', description: 'New server description'},
    {language: 'ru', name: 'Импортированное имя', description: 'Импортированное описание'},
    {language: 'pt-BR', name: 'Agachamento', description: 'Movimento controlado'},
    {language: 'pt-PT', name: 'Agachamento PT', description: null},
]});

for (const code of conflictCodes) test(`${code} retains the live draft and original baseline until explicit review, then rebases without retrying PUT`, async () => {
    const review = deferred(); const opened = deferred(); const payloads = []; const reads = [];
    const original = snapshot('a'); const latest = importedSnapshot('a');
    const {store, controller} = setup({
        update: async (id, payload) => { payloads.push({id, payload}); if (payloads.length === 1) throw conflict(code); return null; },
        fetchTranslations: async id => { reads.push(id); return latest; },
    });
    const draft = edit('a', original);
    draft.nameTranslations.en = 'My edited name';
    draft.imageUrl = 'https://example.test/local-draft.png';
    store.setCurrent(draft, {translationProvenanceKnown: true, translationSnapshot: original});
    let dialog;
    controller._confirm.ask = options => { dialog = options; opened.resolve(); return review.promise; };
    const saving = controller.saveItem(draft);
    await opened.promise;
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].payload.translationsRevision, original.translationsRevision);
    assert.deepEqual(reads, ['a']);
    assert.equal(store.getState().current, draft);
    assert.equal(store.getState().translationProvenanceKnown, false);
    assert.equal(store.getState().translationSnapshot, null, 'a failed token is not reused');
    assert.equal(store.getState().translationReload.baseline, original, 'retain the complete original baseline, not the new token alone');
    assert.equal(dialog.actionLabel, 'Apply reviewed text');
    for (const language of ['en', 'ua', 'ru', 'pt-BR', 'pt-PT']) assert.ok(dialog.detail.includes(`${language} name`));
    assert.match(dialog.detail, /Agachamento/);
    assert.match(dialog.detail, /My edited name/);
    review.resolve(true); await saving;
    const reviewed = store.getState();
    assert.equal(reviewed.current.nameTranslations.en, 'My edited name');
    assert.equal(reviewed.current.descriptionTranslations.en, 'New server description');
    assert.equal(reviewed.current.nameTranslations.ru, 'Импортированное имя');
    assert.equal(reviewed.current.nameTranslations['pt-BR'], 'Agachamento');
    assert.equal(reviewed.current.descriptionTranslations['pt-PT'], '');
    assert.equal(reviewed.current.imageUrl, 'https://example.test/local-draft.png');
    assert.deepEqual(reviewed.translationSnapshot, latest);
    assert.equal(reviewed.translationProvenanceKnown, true);
    assert.equal(reviewed.translationReload, null);
    assert.equal(payloads.length, 1, 'review does not automatically retry an old request body');
    await controller.saveItem(reviewed.current);
    assert.equal(payloads.length, 2, 'only the next explicit save issues another PUT');
    assert.equal(payloads[1].payload.translationsRevision, latest.translationsRevision);
    assert.equal(payloads[1].payload.name.find(entry => entry.language === 'pt-BR').value, 'Agachamento');
    assert.equal(payloads[1].payload.name.find(entry => entry.language === 'en').value, 'My edited name');
});

for (const code of conflictCodes) test(`cancelling ${code} review keeps the draft blocked and a later explicit reload reuses its original baseline`, async () => {
    let writes = 0; let reads = 0; let prompts = 0;
    const original = snapshot('a'); const latest = importedSnapshot('a');
    const {store, controller} = setup({update: async () => { writes++; throw conflict(code); },
        fetchTranslations: async () => { reads++; return latest; }});
    const draft = edit('a', original); draft.descriptionTranslations.en = 'Local description';
    store.setCurrent(draft, {translationProvenanceKnown: true, translationSnapshot: original});
    controller._confirm.ask = async () => ++prompts > 1;
    await controller.saveItem(draft);
    assert.equal(store.getState().current, draft);
    assert.equal(store.getState().translationReload.baseline, original);
    assert.equal(store.getState().translationProvenanceKnown, false);
    assert.equal(store.getState().translationSnapshot, null);
    await controller.saveItem(draft);
    assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(prompts, 1);
    await controller.reloadTranslations();
    assert.equal(reads, 2); assert.equal(prompts, 2); assert.equal(writes, 1);
    assert.equal(store.getState().current.descriptionTranslations.en, 'Local description');
    assert.equal(store.getState().current.nameTranslations['pt-PT'], 'Agachamento PT');
    assert.equal(store.getState().translationProvenanceKnown, true);
});

test('conflict review preserves an intentional Portuguese deletion while importing an untouched Portuguese locale', async () => {
    const original = {...snapshot('a'), translations: [...snapshot('a').translations,
        {language: 'pt-BR', name: 'Stored BR name', description: 'Stored BR description'}]};
    const {store, controller} = setup({update: async () => { throw conflict(conflictCodes[0]); },
        fetchTranslations: async () => importedSnapshot('a')});
    const draft = edit('a', original);
    draft.nameTranslations['pt-BR'] = ''; draft.descriptionTranslations['pt-BR'] = '';
    store.setCurrent(draft, {translationProvenanceKnown: true, translationSnapshot: original});
    let details;
    controller._confirm.ask = async options => { details = options.detail; return true; };
    await controller.saveItem(draft);
    assert.equal(store.getState().current.nameTranslations['pt-BR'], '');
    assert.equal(store.getState().current.descriptionTranslations['pt-BR'], '');
    assert.equal(store.getState().current.nameTranslations['pt-PT'], 'Agachamento PT');
    assert.ok(details.includes('pt-BR name\nLatest: "Agachamento"\nDraft: ""\nResult: ""'));
    assert.equal(store.getState().translationProvenanceKnown, true);
});

for (const code of conflictCodes) test(`failed raw refetch after ${code} keeps original baseline and blocks subsequent saves`, async () => {
    let writes = 0; let reads = 0; let prompts = 0;
    const original = snapshot('a');
    const {store, controller} = setup({update: async () => { writes++; throw conflict(code); },
        fetchTranslations: async () => { reads++; throw new Error('Synthetic raw reload failure'); }});
    const draft = edit('a', original); draft.nameTranslations['pt-BR'] = 'Local BR edit';
    store.setCurrent(draft, {translationProvenanceKnown: true, translationSnapshot: original});
    controller._confirm.ask = async () => { prompts++; return true; };
    await controller.saveItem(draft);
    assert.equal(store.getState().current, draft);
    assert.equal(store.getState().translationReload.reason, 'conflict');
    assert.equal(store.getState().translationReload.baseline, original);
    assert.equal(store.getState().translationProvenanceKnown, false);
    assert.equal(store.getState().isSaving, false);
    await controller.saveItem(draft);
    assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(prompts, 0);
});

for (const error of [new Error('Synthetic PUT network failure'),
    Object.assign(new Error('Synthetic ordinary 409'), {status: 409}),
    Object.assign(new Error('Synthetic non-translation 409'), {status: 409, code: 'OTHER_CONFLICT'}),
    Object.assign(new Error('Synthetic 500'), {status: 500, code: 'EXERCISE_TRANSLATIONS_STALE'})]) {
    test(`ordinary failed PUT retains the trusted baseline and does not refetch or retry: ${error.message}`, async () => {
        let writes = 0; let reads = 0; let prompts = 0;
        const original = snapshot('a');
        const {store, controller} = setup({update: async () => { writes++; throw error; },
            fetchTranslations: async () => { reads++; return importedSnapshot('a'); }});
        const draft = edit('a', original); draft.nameTranslations.en = 'Keep my draft';
        store.setCurrent(draft, {translationProvenanceKnown: true, translationSnapshot: original});
        controller._confirm.ask = async () => { prompts++; return true; };
        await controller.saveItem(draft);
        assert.equal(writes, 1); assert.equal(reads, 0); assert.equal(prompts, 0);
        assert.equal(store.getState().current, draft);
        assert.equal(store.getState().translationSnapshot, original);
        assert.equal(store.getState().translationProvenanceKnown, true);
        assert.equal(store.getState().translationReload, null);
        assert.equal(store.getState().isSaving, false);
    });
}

test('successful empty PUT waits for a joint raw rows/revision reload before the next save', async () => {
    const raw = deferred(); const started = deferred(); let writes = 0;
    const original = snapshot('a'); const latest = importedSnapshot('a');
    const {store, controller} = setup({update: async () => { writes++; return null; },
        fetchTranslations: () => { started.resolve(); return raw.promise; }});
    const draft = edit('a', original);
    store.setCurrent(draft, {translationProvenanceKnown: true, translationSnapshot: original});
    const saving = controller.saveItem(draft); await started.promise;
    assert.equal(store.getState().isSaving, true);
    assert.equal(store.getState().translationSnapshot, original);
    await controller.saveItem(draft); assert.equal(writes, 1);
    raw.resolve(latest); await saving;
    assert.deepEqual(store.getState().translationSnapshot, latest);
    assert.equal(store.getState().current.nameTranslations['pt-BR'], 'Agachamento');
    assert.equal(store.getState().translationProvenanceKnown, true);
    assert.equal(store.getState().isSaving, false);
});

test('failed post-204 raw reload keeps successful save identity and edits made in flight while blocking future PUT', async () => {
    const raw = deferred(); const started = deferred(); let writes = 0; let savedEvents = 0;
    const original = snapshot('a');
    const {store, controller, bus} = setup({update: async () => { writes++; return null; },
        fetchTranslations: () => { started.resolve(); return raw.promise; }});
    const draft = edit('a', original); draft.nameTranslations.en = 'Submitted text';
    store.setCurrent(draft, {translationProvenanceKnown: true, translationSnapshot: original});
    bus.on(Events.EXERCISE_SAVED, () => { savedEvents++; });
    const saving = controller.saveItem(draft); await started.promise;
    store.patchCurrent({nameTranslations: {...draft.nameTranslations, 'pt-PT': 'New edit while saving'}, imageUrl: 'https://example.test/in-flight.png'});
    raw.reject(new Error('Synthetic raw reload failure')); await saving;
    const retained = store.getState();
    assert.equal(savedEvents, 1, 'the accepted write is still reported as saved');
    assert.equal(retained.current.id, 'a');
    assert.equal(retained.isNew, false);
    assert.equal(retained.current.nameTranslations['pt-PT'], 'New edit while saving');
    assert.equal(retained.current.imageUrl, 'https://example.test/in-flight.png');
    assert.equal(retained.translationSnapshot, null);
    assert.equal(retained.translationProvenanceKnown, false);
    assert.equal(retained.translationReload.reason, 'saved');
    assert.equal(retained.items[0].entity.id, 'a');
    assert.equal(retained.isSaving, false);
    await controller.saveItem(retained.current);
    assert.equal(writes, 1, 'a successful write with failed reload cannot reuse its consumed revision');
});

for (const changedDraft of ['valid', 'invalid JSON']) test(`${changedDraft} edits during successful post-save reload require review before a fresh revision can authorize PUT`, async () => {
    const raw = deferred(); const started = deferred(); let writes = 0; let reads = 0; let prompts = 0;
    const original = snapshot('a'); const latest = importedSnapshot('a');
    const {store, controller, form} = setup({update: async () => { writes++; return null; },
        fetchTranslations: () => { reads++; started.resolve(); return reads === 1 ? raw.promise : Promise.resolve(latest); }});
    const draft = edit('a', original); draft.nameTranslations.en = 'Submitted English';
    store.setCurrent(draft, {translationProvenanceKnown: true, translationSnapshot: original});
    controller._confirm.ask = async () => { prompts++; return true; };
    const saving = controller.saveItem(draft); await started.promise;
    if (changedDraft === 'valid') store.patchCurrent({nameTranslations: {...draft.nameTranslations, en: 'Newer English edit'}});
    else form.readFormToEntity = () => { throw new Error('Synthetic invalid JSON draft'); };
    raw.resolve(latest); await saving;
    const retained = store.getState();
    assert.equal(retained.current.id, 'a');
    assert.equal(retained.translationProvenanceKnown, false);
    assert.equal(retained.translationSnapshot, null, 'fresh token cannot authorize a stale or unreadable graph');
    assert.equal(retained.translationReload.reason, 'draft');
    assert.deepEqual(retained.translationReload.baseline, ExerciseTranslations.fromEntity(draft));
    assert.equal(retained.current.nameTranslations['pt-BR'], '', 'the unreviewed draft retains its previous PT values');
    await controller.saveItem(retained.current);
    assert.equal(writes, 1); assert.equal(prompts, 0);
    form.readFormToEntity = () => store.getState().current;
    await controller.reloadTranslations();
    assert.equal(reads, 2); assert.equal(prompts, 1); assert.equal(writes, 1);
    assert.equal(store.getState().current.nameTranslations['pt-BR'], 'Agachamento');
    assert.equal(store.getState().current.nameTranslations.en, changedDraft === 'valid' ? 'Newer English edit' : 'New server name');
    assert.equal(store.getState().translationProvenanceKnown, true);
    assert.deepEqual(store.getState().translationSnapshot, latest);
});

for (const boundary of ['logout', 'selection']) test(`${boundary} during conflict raw reload suppresses the late snapshot and review prompt`, async () => {
    const raw = deferred(); const started = deferred(); let prompts = 0;
    const original = snapshot('a');
    const {store, controller, bus} = setup({update: async () => { throw conflict(conflictCodes[1]); },
        fetchDetail: async id => record(id), fetchTranslations: async id => {
            if (id === 'a') { started.resolve(); return raw.promise; }
            return importedSnapshot(id);
        }});
    const draft = edit('a', original);
    store.setCurrent(draft, {translationProvenanceKnown: true, translationSnapshot: original});
    controller._confirm.ask = async () => { prompts++; return true; };
    const saving = controller.saveItem(draft); await started.promise;
    if (boundary === 'logout') bus.emit(Events.AUTH_LOGOUT);
    else await controller.selectItem({id: 'b'});
    const retained = store.getState().current;
    raw.resolve(importedSnapshot('a')); await saving;
    assert.equal(prompts, 0);
    assert.equal(store.getState().current, retained);
    assert.equal(store.getState().isSaving, false);
    if (boundary === 'selection') assert.equal(store.getState().translationSnapshot.id, 'b');
    else assert.equal(store.getState().translationSnapshot, null);
});

for (const boundary of ['logout', 'selection', 'edit']) test(`${boundary} during conflict confirmation cannot apply a stale review`, async () => {
    const review = deferred(); const opened = deferred(); let writes = 0;
    const original = snapshot('a');
    const {store, controller, bus} = setup({update: async () => { writes++; throw conflict(conflictCodes[0]); },
        fetchDetail: async id => record(id), fetchTranslations: async id => importedSnapshot(id)});
    const draft = edit('a', original); draft.nameTranslations.en = 'Local name';
    store.setCurrent(draft, {translationProvenanceKnown: true, translationSnapshot: original});
    controller._confirm.ask = () => { opened.resolve(); return review.promise; };
    const saving = controller.saveItem(draft); await opened.promise;
    if (boundary === 'logout') bus.emit(Events.AUTH_LOGOUT);
    if (boundary === 'selection') await controller.selectItem({id: 'b'});
    if (boundary === 'edit') store.patchCurrent({descriptionTranslations: {...draft.descriptionTranslations, en: 'Newer live edit'}});
    const retained = store.getState().current;
    review.resolve(true); await saving;
    assert.equal(writes, 1);
    assert.equal(store.getState().current, retained);
    assert.equal(store.getState().isSaving, false);
    if (boundary === 'logout') {
        assert.equal(store.getState().current, null);
        assert.equal(store.getState().translationSnapshot, null);
        assert.equal(store.getState().translationReload, null);
    } else if (boundary === 'selection') {
        assert.equal(store.getState().current.id, 'b');
        assert.equal(store.getState().translationSnapshot.id, 'b');
    } else {
        assert.equal(store.getState().current.descriptionTranslations.en, 'Newer live edit');
        assert.equal(store.getState().translationProvenanceKnown, false);
        assert.equal(store.getState().translationReload.baseline, original);
        await controller.saveItem(store.getState().current);
        assert.equal(writes, 1);
    }
});
