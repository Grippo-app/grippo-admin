import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseExercise} from '../src/domain/exercise/ExerciseDiagnostics.js';
import {ExerciseNormalizer} from '../src/domain/exercise/ExerciseNormalizer.js';
import {ExerciseStore} from '../src/features/exercises/ExerciseStore.js';
import {ExerciseController} from '../src/features/exercises/ExerciseController.js';
import {ExerciseDiagnosticsView} from '../src/features/exercises/ExerciseDiagnosticsView.js';
import {exerciseDiagnosticSources, mergeLocalizedExerciseLists} from '../src/features/exercises/exercisePresentation.js';
import {EventBus} from '../src/infrastructure/events/EventBus.js';
import {Events} from '../src/infrastructure/events/events.js';
import {Toast} from '../src/shared/components/Toast.js';

Toast.show = () => {};
const record = (id = 'a') => ({id, name: 'Squat', description: 'Controlled movement',
    weightType: 'free', category: 'compound', experience: 'beginner', forceType: 'push', imageUrl: 'https://example.test/exercise.png',
    components: {externalWeight: {required: true}, bodyWeight: null, extraWeight: null, assistWeight: null},
    equipmentRefs: [{equipmentId: 'barbell'}], exerciseExampleBundles: [{muscleId: 'quads', percentage: 100}]});
const snapshot = (id = 'a') => ({id, base: {name: 'Squat', description: 'Controlled movement'},
    translations: [{language: 'en', name: 'Squat', description: 'Controlled movement'}], translationsRevision: 'a'.repeat(64)});
const context = {complete: true, musclesReady: true, equipmentReady: true,
    muscles: new Map([['quads', 'Quadriceps'], ['glutes', 'Glutes']]), equipment: new Map([['barbell', 'Barbell']]), translationSnapshot: snapshot()};
const findings = (raw, ruleId, ctx = context) => diagnoseExercise(raw, ctx).findings.filter(finding => finding.ruleId === ruleId);
const skippedCheck = (report, ruleId) => report.skippedChecks.find(check => check.ruleId === ruleId);
const rawSources = rows => new Map(rows.map(raw => [raw.id, raw]));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
function controllerSetup(repository = {}) {
    const store = new ExerciseStore();
    const bus = new EventBus();
    const repo = {fetchList: async () => [], fetchDetail: async id => record(id), fetchTranslations: async id => snapshot(id),
        update: async () => null, create: async () => ({id: 'created'}), delete: async () => {}, ...repository};
    const form = {hasUnsavedChanges: () => false, markSaved() {}};
    const controller = new ExerciseController({store, repository: repo, bus, formView: form, confirmDialog: {ask: async () => true}});
    return {store, controller, bus};
}

test('a complete valid stored record has no flags without science or missing-locale assumptions', () => {
    const report = diagnoseExercise(record(), context);
    assert.deepEqual(report.findings, []);
    assert.equal(report.checkedCount, report.totalCount);
    assert.deepEqual(report.skippedRuleIds, []);
});

test('raw missing, nonnumeric, fractional and out-of-range percentages are errors before normalization', () => {
    for (const percentage of [undefined, null, '', '50', NaN, -1, 101, 12.5]) {
        const raw = record(); raw.exerciseExampleBundles[0].percentage = percentage;
        const report = diagnoseExercise(raw, context);
        assert.equal(report.findings.some(finding => finding.ruleId === 'muscle-percentages'), true, String(percentage));
        assert.equal(report.findings.some(finding => finding.ruleId === 'muscle-total'), false, 'an invalid total is not asserted');
        assert.equal(report.skippedRuleIds.includes('muscle-total'), true);
    }
    const malformed = record(); malformed.exerciseExampleBundles = [null, {muscleId: 'quads', percentage: 100}];
    assert.equal(findings(malformed, 'muscle-percentages').length, 1);
});

test('a valid total must be exactly100 while zero is a warning and duplicate IDs are errors', () => {
    const raw = record();
    raw.exerciseExampleBundles = [{muscleId: 'quads', percentage: 60}, {muscleId: 'quads', percentage: 0}];
    raw.equipmentRefs.push({equipmentId: 'barbell'});
    assert.match(findings(raw, 'muscle-total')[0].message, /60%/);
    assert.equal(findings(raw, 'muscle-zero')[0].severity, 'warning');
    assert.equal(findings(raw, 'muscle-duplicates').length, 1);
    assert.equal(findings(raw, 'equipment-duplicates').length, 1);
});

test('raw component checks retain invalid flags, exclusions, dependencies and unclamped multiplier', () => {
    const raw = record(); raw.components.bodyWeight = {required: false, multiplier: 3};
    raw.components.extraWeight = {required: 'false'}; delete raw.components.assistWeight;
    const report = findings(raw, 'component-contract');
    assert.equal(report.some(finding => finding.field === 'components.extraWeight.required'), true);
    assert.equal(report.some(finding => finding.field === 'components.assistWeight'), true);
    assert.equal(report.some(finding => /cannot both/.test(finding.message)), true);
    assert.equal(report.some(finding => finding.field === 'components.bodyWeight.multiplier'), true);
    assert.equal(report.some(finding => finding.field === 'components.bodyWeight.required'), true);
    const normalized = ExerciseNormalizer.normalizeEntityShape(raw);
    assert.equal(normalized.components.bodyWeight.multiplier, 2);
    const dependent = record(); dependent.components.assistWeight = {required: false};
    assert.equal(findings(dependent, 'component-contract').some(finding => /require body weight/.test(finding.message)), true);
});

test('required enums and malformed equipment are diagnosed against actual contract', () => {
    const raw = record(); raw.forceType = 'rotation'; raw.category = null; raw.equipmentRefs = [null, {}];
    assert.deepEqual(findings(raw, 'required-enums').map(finding => finding.field), ['category', 'forceType']);
    assert.equal(findings(raw, 'equipment-entries').length, 2);
});

test('unknown references require successful dictionaries and successful empty dictionaries remain authoritative', () => {
    const raw = record();
    const unknown = {...context, muscles: new Map(), equipment: new Map()};
    assert.equal(findings(raw, 'unknown-muscles', unknown).length, 1);
    assert.equal(findings(raw, 'unknown-equipment', unknown).length, 1);
    const failed = diagnoseExercise(raw, {...unknown, musclesReady: false, equipmentReady: false});
    assert.equal(failed.findings.some(finding => finding.ruleId.startsWith('unknown-')), false);
    assert.equal(failed.skippedRuleIds.includes('unknown-muscles'), true);
    assert.equal(failed.skippedRuleIds.includes('unknown-equipment'), true);
});

test('English text uses raw provenance or explicit maps only, never localized fallback or missingUA/RU', () => {
    const raw = record(); raw.name = 'Fallback English';
    const unknown = diagnoseExercise(raw, {});
    assert.equal(unknown.skippedRuleIds.includes('english-text'), true);
    const missing = {...snapshot(), base: {name: null, description: null}, translations: [{language: 'ua', name: 'Текст', description: 'Опис'}]};
    assert.equal(findings(raw, 'english-text', {...context, translationSnapshot: missing}).length, 2);
    const legacy = {...snapshot(), translations: []};
    assert.deepEqual(findings(raw, 'english-text', {...context, translationSnapshot: legacy}), []);
    raw.nameTranslations = {en: ''}; raw.descriptionTranslations = {en: 'Known description'};
    assert.equal(findings(raw, 'english-text', {translationSnapshot: null}).length, 1);
});

test('partial records skip unavailable checks and missing image information stays neutral', () => {
    const partial = diagnoseExercise({id: 'partial'}, {});
    assert.equal(partial.findings.length, 0);
    assert.equal(partial.checkedCount, 0);
    const missing = record(); missing.imageUrl = '';
    assert.equal(findings(missing, 'missing-image')[0].severity, 'info');
    missing.imageUrl = 123;
    assert.equal(diagnoseExercise(missing, context).skippedRuleIds.includes('missing-image'), true);
});

test('unavailable English text distinguishes list evidence from server source limitations', () => {
    const raw = record();
    const listReport = diagnoseExercise(raw, {...context, complete: false, translationSnapshot: null});
    assert.equal(listReport.checkedCount, 11);
    assert.deepEqual(skippedCheck(listReport, 'english-text'), {
        ruleId: 'english-text', title: 'English text', reason: 'details',
        message: 'The list response does not include stored English fields. Source translations are checked when exercise details load, if supported by the server.',
    });
    const detailReport = diagnoseExercise(raw, {...context, translationSnapshot: null});
    assert.equal(detailReport.checkedCount, 11);
    assert.deepEqual(skippedCheck(detailReport, 'english-text'), {
        ruleId: 'english-text', title: 'English text', reason: 'source',
        message: 'The server did not provide source translations. Localized text may be a fallback, so stored English name and description cannot be confirmed.',
    });
    assert.deepEqual(detailReport.findings, [], 'localized scalar text proves neither missing nor present stored English');
    assert.equal(diagnoseExercise(raw, context).checkedCount, 12, 'the authoritative raw snapshot completes the check');
});

test('missing list fields explain unavailable details without claiming malformed or absent stored data', () => {
    const report = diagnoseExercise({id: 'partial'}, {...context, complete: false, translationSnapshot: null});
    assert.equal(report.checkedCount, 0);
    assert.equal(report.findings.length, 0);
    assert.equal(report.skippedChecks.length, 12);
    for (const check of report.skippedChecks) {
        assert.equal(check.reason, 'details', check.ruleId);
        assert.ok(check.message.length > 0, check.ruleId);
        assert.doesNotMatch(check.title, /^(Missing|Invalid|Duplicate|Unknown|No )/, check.ruleId);
    }
});

test('failed dictionaries stay reference limitations while malformed prerequisites keep real errors', () => {
    const unavailable = diagnoseExercise(record(), {...context, musclesReady: false, equipmentReady: false});
    assert.equal(skippedCheck(unavailable, 'unknown-muscles').reason, 'reference');
    assert.equal(skippedCheck(unavailable, 'unknown-equipment').reason, 'reference');
    assert.equal(unavailable.findings.length, 0);
    const raw = record(); raw.exerciseExampleBundles = null; raw.equipmentRefs = {}; raw.imageUrl = 123;
    const malformed = diagnoseExercise(raw, context);
    assert.deepEqual(malformed.findings.map(finding => finding.ruleId), ['muscle-percentages', 'equipment-entries']);
    for (const id of ['muscle-total', 'muscle-duplicates', 'muscle-zero', 'unknown-muscles', 'equipment-duplicates', 'unknown-equipment']) {
        assert.equal(skippedCheck(malformed, id).reason, 'dependency', id);
        assert.ok(skippedCheck(malformed, id).message.length > 0, id);
    }
    assert.equal(skippedCheck(malformed, 'missing-image').reason, 'source');
    assert.match(skippedCheck(malformed, 'missing-image').message, /unsupported format/);
    const invalidPercent = record(); invalidPercent.exerciseExampleBundles[0].percentage = 12.5;
    const percentages = diagnoseExercise(invalidPercent, context);
    assert.equal(skippedCheck(percentages, 'muscle-total').reason, 'dependency');
    assert.equal(percentages.counts.error, 1, 'invalid contributions remain actual errors');
});

test('partial attribute evidence keeps known errors without claiming the entire check completed', () => {
    for (const category of ['compound', 'unsupported']) {
        const report = diagnoseExercise({id: 'partial', category}, {complete: false});
        const skipped = skippedCheck(report, 'required-enums');
        assert.equal(skipped.reason, 'details');
        assert.match(skipped.message, /weightType/);
        assert.equal(report.checkedCount, 0);
        assert.deepEqual(report.findings.map(finding => finding.field), category === 'compound' ? [] : ['category']);
    }
    const complete = diagnoseExercise({id: 'partial', category: 'compound'}, {complete: true});
    assert.equal(complete.skippedRuleIds.includes('required-enums'), false);
    assert.deepEqual(complete.findings.filter(finding => finding.ruleId === 'required-enums').map(finding => finding.field), ['weightType', 'experience', 'forceType']);
});

test('one authoritative English map cannot certify the other map or hide its known errors', () => {
    for (const complete of [false, true]) {
        for (const name of ['Known name', '']) {
            const report = diagnoseExercise({...record(), nameTranslations: {en: name}}, {...context, complete, translationSnapshot: null});
            assert.equal(skippedCheck(report, 'english-text').reason, complete ? 'source' : 'details');
            assert.match(skippedCheck(report, 'english-text').message, /description/);
            assert.equal(report.checkedCount, 11);
            assert.deepEqual(report.findings.map(finding => finding.field), name ? [] : ['nameTranslations.en']);
        }
    }
    const knownMissing = diagnoseExercise({...record(), nameTranslations: {}, descriptionTranslations: {}}, {...context, translationSnapshot: null});
    assert.equal(knownMissing.skippedRuleIds.includes('english-text'), false);
    assert.equal(knownMissing.counts.error, 2, 'authoritative missing EN values stay real findings');
});

test('unexpected evaluator failures are unavailable rather than false clean checks', () => {
    const report = diagnoseExercise(record(), {...context, translationSnapshot: {translations: null}});
    assert.equal(skippedCheck(report, 'english-text').reason, 'failed');
    assert.equal(report.findings.some(finding => finding.ruleId === 'english-text'), false);
    assert.equal(report.checkedCount, 11);
});

test('source coverage changes retain an unsaved draft and keep normalized fallback maps outside evidence', () => {
    const raw = record();
    const responses = ['en', 'ua', 'ru', 'pt-BR', 'pt-PT'].map(locale => ({locale, list: [{entity: raw}]}));
    const sources = exerciseDiagnosticSources(responses);
    const items = mergeLocalizedExerciseLists(responses);
    assert.equal(items[0].entity.nameTranslations.en, raw.name, 'editable normalization creates a language map');
    const store = new ExerciseStore();
    store.setDiagnosticContext(context);
    store.setItems(items, {diagnosticSources: sources});
    store.setCurrent(items[0].entity);
    store.patchCurrent({descriptionTranslations: {en: 'Unsaved draft'}});
    const draft = store.getState().current;
    const serialized = JSON.stringify(draft);
    assert.equal(skippedCheck(store.getDiagnosticReport('a'), 'english-text').reason, 'details');
    store.setDiagnosticSource('a', raw, {translationSnapshot: snapshot()});
    assert.equal(store.getDiagnosticReport('a').skippedRuleIds.includes('english-text'), false);
    store.setItems(items, {diagnosticSources: sources});
    assert.equal(skippedCheck(store.getDiagnosticReport('a'), 'english-text').reason, 'details');
    assert.equal(store.getState().current, draft);
    assert.equal(JSON.stringify(draft), serialized, 'diagnostic provenance does not enter or rewrite the draft JSON');
});

test('stored diagnostics capture raw rows, remain immutable from caller/editor, and cache report identities', () => {
    const raw = record(); raw.exerciseExampleBundles = [{muscleId: 'quads'}];
    const responses = ['en', 'ua', 'ru', 'pt-BR', 'pt-PT'].map(locale => ({locale, list: [{entity: raw}]}));
    const sources = exerciseDiagnosticSources(responses);
    const items = mergeLocalizedExerciseLists(responses);
    assert.equal(items[0].entity.exerciseExampleBundles[0].percentage, 0, 'normalizer has substituted a missing value');
    const store = new ExerciseStore(); store.setItems(items, {diagnosticSources: sources});
    const report = store.getDiagnosticReport('a');
    assert.equal(report.findings.some(finding => finding.ruleId === 'muscle-percentages'), true);
    raw.exerciseExampleBundles[0].percentage = 100;
    store.setCurrent(items[0].entity); const current = store.getState().current;
    store.patchCurrent({imageUrl: 'edited'}); const edited = store.getState().current;
    store.setSearchQuery('squat'); store.setSortKey('missingImage');
    store.setDiagnosticContext({musclesReady: false});
    const recalculated = store.getDiagnosticReport('a');
    assert.equal(recalculated.findings.some(finding => finding.ruleId === 'muscle-percentages'), true);
    store.setDiagnosticContext({musclesReady: false});
    store.setQualityFilter('error');
    assert.equal(store.getDiagnosticReport('a'), recalculated);
    assert.equal(store.getState().current, edited);
    assert.notEqual(current, edited);
    assert.equal(JSON.stringify(edited).includes('diagnostic'), false);
    assert.equal(store.getState().diagnosticSummary.recordCount, 1);
});

test('quality filters compose with search and sort; summary always counts the entire loaded library', () => {
    const bad = record('bad'); bad.name = 'Zebra'; bad.exerciseExampleBundles[0].percentage = 90;
    const clean = record('clean'); clean.name = 'Alpha'; clean.imageUrl = '';
    const store = new ExerciseStore(); store.setItems([bad, clean], {diagnosticSources: rawSources([bad, clean])});
    store.setCurrent(clean);
    store.setQualityFilter('attention');
    assert.deepEqual(store.getState().filtered.map(item => item.id), ['bad']);
    store.setSearchQuery('alpha'); assert.equal(store.getState().filtered.length, 0);
    assert.equal(store.getState().diagnosticSummary.recordCount, 2);
    assert.equal(store.getState().diagnosticSummary.attentionCount, 1);
    assert.equal(store.getState().current.id, 'clean', 'filter never changes selection');
    store.setQualityFilter('info'); assert.deepEqual(store.getState().filtered.map(item => item.id), ['clean']);
    store.setSearchQuery(''); store.setQualityFilter('rule:muscle-total');
    assert.deepEqual(store.getState().filtered.map(item => item.id), ['bad']);
    const previous = store.getState().qualityFilter; store.setQualityFilter('unknown-filter');
    assert.equal(store.getState().qualityFilter, previous);
});

test('context refresh recalculates unknown references without editing current or existing sources', () => {
    const raw = record(); const store = new ExerciseStore();
    store.setItems([raw], {diagnosticSources: rawSources([raw])}); store.setCurrent(raw);
    const current = store.getState().current;
    store.setDiagnosticContext({...context, muscles: new Map()});
    assert.equal(store.getDiagnosticReport('a').findings.some(finding => finding.ruleId === 'unknown-muscles'), true);
    store.setDiagnosticContext({...context});
    assert.equal(store.getDiagnosticReport('a').findings.some(finding => finding.ruleId === 'unknown-muscles'), false);
    assert.equal(store.getState().current, current);
});

test('list load requests all five canonical locales and diagnoses unnormalized transport', async () => {
    const requests = []; const raw = record(); raw.exerciseExampleBundles = [null];
    const {store, controller} = controllerSetup({fetchList: async locale => { requests.push(locale); return [raw]; }});
    await controller.loadList();
    assert.deepEqual(requests, ['en', 'ua', 'ru', 'pt-BR', 'pt-PT']);
    assert.equal(store.getState().items[0].entity.exerciseExampleBundles.length, 0);
    assert.equal(store.getDiagnosticReport('a').findings.some(finding => finding.ruleId === 'muscle-percentages'), true);
});

test('detail source upgrades English provenance and preserves invalid raw fields outside normalized current', async () => {
    const raw = record(); raw.components.bodyWeight = {required: false, multiplier: 9};
    const {store, controller} = controllerSetup({fetchDetail: async () => raw});
    store.setItems([raw], {diagnosticSources: rawSources([raw])});
    await controller.selectItem(raw);
    assert.equal(store.getState().current.components.bodyWeight.multiplier, 2);
    assert.equal(store.getDiagnosticReport('a').findings.some(finding => finding.field === 'components.bodyWeight.multiplier'), true);
    assert.equal(store.getDiagnosticReport('a').skippedRuleIds.includes('english-text'), false);
    assert.equal(JSON.stringify(store.getState().current).includes('diagnostic'), false);
});

test('successful saves replace diagnostic source; delete and session reset remove retained sources', async () => {
    const raw = record(); raw.exerciseExampleBundles[0].percentage = 90;
    const {store, controller, bus} = controllerSetup();
    store.setItems([raw], {diagnosticSources: rawSources([raw])});
    store.setCurrent(ExerciseNormalizer.normalizeEntityShape(record()), {translationProvenanceKnown: true, translationSnapshot: snapshot()});
    assert.equal(store.getDiagnosticReport('a').findings.some(finding => finding.ruleId === 'muscle-total'), true);
    await controller.saveItem(store.getState().current);
    assert.equal(store.getDiagnosticReport('a').findings.some(finding => finding.ruleId === 'muscle-total'), false);
    await controller.deleteItem('a'); assert.equal(store.getDiagnosticReport('a'), null);
    store.setItems([raw], {diagnosticSources: rawSources([raw])});
    bus.emit(Events.AUTH_LOGOUT);
    assert.equal(store.getDiagnosticReport('a'), null);
    assert.equal(store.getState().diagnosticSummary.recordCount, 0);
});

test('late detail or list responses cannot restore diagnostic sources after logout', async () => {
    const pending = deferred(); const {store, controller, bus} = controllerSetup({fetchDetail: () => pending.promise, fetchList: () => pending.promise});
    const selecting = controller.selectItem({id: 'a'});
    const loading = controller.loadList(); await Promise.resolve(); bus.emit(Events.AUTH_LOGOUT);
    pending.resolve(record()); await Promise.all([selecting, loading]);
    assert.equal(store.getDiagnosticReport('a'), null);
    assert.equal(store.getState().items.length, 0);
});

test('diagnostic panel retains disclosure state across draft changes and clears on logout/new', () => {
    const raw = record(); const store = new ExerciseStore();
    store.setItems([raw], {diagnosticSources: rawSources([raw])}); store.setCurrent(raw);
    let writes = 0; const panel = {hidden: true, set innerHTML(value) { this.html = value; writes++; }, replaceChildren() { this.html = ''; writes++; }};
    const view = new ExerciseDiagnosticsView({store, panel}); view.render();
    const initial = writes;
    store.patchCurrent({name: 'Unsaved change'}); view.render();
    assert.equal(writes, initial);
    assert.match(panel.html, /saved record, not unsaved edits/);
    assert.equal(store.getState().current.name, 'Unsaved change');
    store.setNew(record('new')); view.render(); assert.equal(panel.hidden, true); assert.equal(panel.html, '');
    store.clearCurrent(); view.render(); assert.equal(panel.hidden, true);
});
