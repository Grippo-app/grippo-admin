import test from 'node:test';
import assert from 'node:assert/strict';
import {runDiagnosticRules, matchesDiagnosticFilter, summarizeDiagnosticReports, getDiagnosticFilterOptions} from '../src/domain/diagnostics/index.js';
import * as diagnostics from '../src/domain/diagnostics/index.js';
import {diagnosticBadgeHtml, diagnosticPanelHtml, diagnosticReasonHtml, primaryAttentionFinding} from '../src/shared/components/diagnosticPresentation.js';
import * as presentation from '../src/shared/components/diagnosticPresentation.js';

const rule = (id, severity, result) => ({id, severity, title: `Rule ${id}`, evaluate: () => result});

test('row reasons use the highest attention finding and escape title and explanation; info and unknown stay neutral', () => {
    const report = runDiagnosticRules([rule('warning', 'warning', [{message: 'A warning'}]),
        {...rule('error', 'error', [{message: '<b>Required</b>'}]), title: '<script>bad</script>'}], {});
    assert.equal(primaryAttentionFinding(report).severity, 'error');
    assert.match(diagnosticReasonHtml(report), /title="&lt;b&gt;Required&lt;\/b&gt;">&lt;script&gt;bad&lt;\/script&gt;/);
    for (const value of [null, runDiagnosticRules([rule('info', 'info', [{message: 'Note'}])], {}), runDiagnosticRules([rule('unknown', 'error', null)], {})]) {
        assert.equal(primaryAttentionFinding(value), null); assert.equal(diagnosticReasonHtml(value), '');
    }
});

test('rules preserve stable IDs, finding order and severity precedence without mutating their inputs', () => {
    const record = Object.freeze({name: 'Fixture'});
    const context = Object.freeze({loaded: true});
    const rules = [rule('note', 'info', [{message: 'Optional detail'}]), rule('warn', 'warning', [{message: 'First'}, {message: 'Second', field: 'name'}]),
        {id: 'error', severity: 'error', title: 'Required data', evaluate: (r, c) => { assert.equal(r, record); assert.equal(c, context); return [{message: 'Missing required data'}]; }},
        rule('clean', 'error', []), rule('unavailable', 'warning', null)];
    const report = runDiagnosticRules(rules, record, context);
    assert.deepEqual(report.findings, [
        {ruleId: 'note', severity: 'info', title: 'Rule note', message: 'Optional detail'},
        {ruleId: 'warn', severity: 'warning', title: 'Rule warn', message: 'First'},
        {ruleId: 'warn', severity: 'warning', title: 'Rule warn', message: 'Second', field: 'name'},
        {ruleId: 'error', severity: 'error', title: 'Required data', message: 'Missing required data'},
    ]);
    assert.deepEqual(report.counts, {error: 1, warning: 2, info: 1});
    assert.deepEqual(report.skippedRuleIds, ['unavailable']);
    assert.deepEqual(report.skippedChecks, [{ruleId: 'unavailable', title: 'Rule unavailable'}]);
    assert.equal(report.checkedCount, 4);
    assert.equal(report.totalCount, 5);
    assert.equal(report.highestSeverity, 'error');
    assert.deepEqual(runDiagnosticRules(rules, record, context), report);
});

test('clean, unavailable, malformed and failing checks cannot be confused', () => {
    const rules = [rule('clean', 'error', []), rule('unknown', 'warning', null), rule('undefined', 'info', undefined),
        rule('invalid', 'error', [{message: 'Valid'}, {message: 3}]), rule('bad-field', 'info', [{message: 'Text', field: {}}]),
        {id: 'failure', severity: 'warning', title: 'Failed evaluation', evaluate() { throw new Error('Synthetic failure'); }}];
    const report = runDiagnosticRules(rules, null);
    assert.deepEqual(report.findings, []);
    assert.equal(report.checkedCount, 1);
    assert.equal(report.highestSeverity, null);
    assert.deepEqual(report.skippedRuleIds, ['unknown', 'undefined', 'invalid', 'bad-field', 'failure']);
    assert.deepEqual(runDiagnosticRules([], {}), {findings: [], skippedRuleIds: [], skippedChecks: [], checkedCount: 0, totalCount: 0,
        counts: {error: 0, warning: 0, info: 0}, highestSeverity: null});
});

test('invalid rule definitions fail before any evaluation begins', () => {
    let calls = 0;
    const first = {id: 'same', severity: 'error', title: 'First', evaluate: () => { calls++; return []; }};
    for (const invalid of [rule('same', 'info', []), rule('', 'warning', []), rule('bad', 'danger', []),
        {...rule('bad', 'warning', []), evaluate: null}, {...rule('bad', 'warning', []), title: ''}]) {
        assert.throws(() => runDiagnosticRules([first, invalid], {}), TypeError);
    }
    assert.equal(calls, 0);
    assert.throws(() => runDiagnosticRules(null, {}), TypeError);
});

test('record filters match all severities and stable rule IDs; attention excludes information alone', () => {
    const report = runDiagnosticRules([rule('multi:one', 'warning', [{message: 'A'}, {message: 'B'}]), rule('note', 'info', [{message: 'C'}])], {});
    for (const value of ['all', 'attention', 'warning', 'info', 'rule:multi:one', 'rule:note']) assert.equal(matchesDiagnosticFilter(report, value), true);
    for (const value of ['error', 'rule:absent', 'unknown', null]) assert.equal(matchesDiagnosticFilter(report, value), false);
    assert.equal(matchesDiagnosticFilter(runDiagnosticRules([rule('note', 'info', [{message: 'Only note'}])], {}), 'attention'), false);
    assert.equal(matchesDiagnosticFilter(null, 'all'), true);
    assert.equal(matchesDiagnosticFilter(null, 'attention'), false);
});

test('summaries and filter options count matching records once and keep zero-count rules available', () => {
    const rules = [rule('warn', 'warning', [{message: 'One'}, {message: 'Two'}]), rule('note', 'info', [{message: 'Note'}]), rule('clean', 'error', [])];
    const reports = [runDiagnosticRules(rules, {}), runDiagnosticRules([rules[1]], {}), null, runDiagnosticRules([rule('unknown', 'error', null)], {})];
    assert.deepEqual(summarizeDiagnosticReports(reports), {recordCount: 4, attentionCount: 1, unverifiedCount: 2,
        counts: {error: 0, warning: 1, info: 2}, ruleCounts: {warn: 1, note: 2}});
    assert.deepEqual(getDiagnosticFilterOptions(reports, rules), [
        {value: 'all', label: 'All records (4)'}, {value: 'attention', label: 'Needs attention (1)'},
        {value: 'unverified', label: 'Checks unavailable (2)'},
        {value: 'error', label: 'Errors (0)'}, {value: 'warning', label: 'Warnings (1)'}, {value: 'info', label: 'Information (2)'},
        {value: 'rule:warn', label: 'Rule warn (1)'}, {value: 'rule:note', label: 'Rule note (2)'}, {value: 'rule:clean', label: 'Rule clean (0)'},
    ]);
    const prototypeId = runDiagnosticRules([rule('__proto__', 'warning', [{message: 'Safe identifier'}])], {});
    assert.equal(summarizeDiagnosticReports([prototypeId]).ruleCounts.__proto__, 1);
    assert.equal(getDiagnosticFilterOptions([], [rule('constructor', 'warning', [])]).at(-1).label, 'Rule constructor (0)');
});

test('unverified coverage is separately filterable without implying a problem or a clean check', () => {
    const clean = runDiagnosticRules([rule('clean', 'error', [])], {});
    const partial = runDiagnosticRules([rule('problem', 'error', [{message: 'Problem'}]), rule('unknown', 'warning', null)], {});
    const skipped = runDiagnosticRules([rule('unknown', 'warning', null)], {});
    assert.equal(matchesDiagnosticFilter(clean, 'unverified'), false);
    for (const report of [null, runDiagnosticRules([], {}), partial, skipped]) assert.equal(matchesDiagnosticFilter(report, 'unverified'), true);
    assert.equal(matchesDiagnosticFilter(partial, 'attention'), true);
    assert.equal(matchesDiagnosticFilter(skipped, 'attention'), false);
    assert.equal(summarizeDiagnosticReports([clean, partial, skipped, null]).unverifiedCount, 3);
});

test('HTML labels distinguish clean, skipped and unconfigured checks without relying on color', () => {
    const clean = runDiagnosticRules([rule('clean', 'error', [])], {});
    const skipped = runDiagnosticRules([rule('unavailable', 'error', null)], {});
    assert.match(diagnosticBadgeHtml(clean), /diagnostic-badge--clean[^>]*><span[^>]*>No flags found/);
    assert.match(diagnosticBadgeHtml(skipped), /diagnostic-badge--unchecked[^>]*><span[^>]*>No flags found · 1 check unavailable/);
    assert.match(diagnosticBadgeHtml(null), /diagnostic-badge--unchecked[^>]*><span[^>]*>Not checked/);
    assert.match(diagnosticBadgeHtml(runDiagnosticRules([], {})), />Not checked/);
    assert.match(diagnosticPanelHtml(skipped), /0 of 1 checks completed; 1 unavailable/);
    assert.match(diagnosticPanelHtml(skipped), /does not mean those checks passed/);
    assert.match(diagnosticPanelHtml(null), /Checks have not run/);
    assert.match(diagnosticPanelHtml(null), /^<details class="diagnostic-panel"><summary/);
    assert.match(diagnosticPanelHtml(runDiagnosticRules([rule('error', 'error', [{message: 'Problem'}])], {})), /^<details class="diagnostic-panel" data-quality="error" open>/);
    assert.match(diagnosticPanelHtml(clean), /saved record, not unsaved edits/);
});

test('HTML presentation escapes API messages, field names, rule titles and custom panel titles', () => {
    const injected = '<img src=x onerror="alert(1)"> & \'unsafe\'';
    const report = runDiagnosticRules([{id: injected, title: injected, severity: 'warning', evaluate: () => [{message: injected, field: injected}]}], {});
    const html = diagnosticPanelHtml(report, {title: injected});
    assert.equal(html.includes('<img'), false);
    assert.equal(html.includes('onerror="'), false);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;unsafe&#39;/);
    assert.match(html, /Warning:/);
    assert.match(html, /1 warning/);
    assert.match(html, /<summary[^>]*><span>&lt;img/);
});

test('unverified checks expose their escaped rule titles without inventing explanations', () => {
    const title = '<img src=x onerror="alert(1)"> & missing text';
    const rules = [{...rule('english', 'error', null), title}, rule('dictionary', 'error', null), rule('clean', 'info', [])];
    const report = runDiagnosticRules(rules, {});
    assert.deepEqual(report.skippedChecks, [{ruleId: 'english', title}, {ruleId: 'dictionary', title: 'Rule dictionary'}]);
    const html = diagnosticPanelHtml(report);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; missing text/);
    assert.match(html, /Rule dictionary/);
    assert.match(html, /Required evidence is unavailable for this check/);
    assert.equal(html.includes('<img'), false);
    assert.doesNotMatch(html, /Rule clean|failed request|dictionary unavailable/);
    const {skippedChecks, ...legacyReport} = report;
    assert.match(diagnosticPanelHtml(legacyReport), /Required evidence is unavailable for these checks/);
});

test('severity styling is paired with visible text and decorative icons while unknown checks stay neutral', () => {
    for (const [severity, label] of [['error', '1 error'], ['warning', '1 warning'], ['info', '1 note']]) {
        const report = runDiagnosticRules([rule('finding', severity, [{message: 'Review the stored value'}])], {});
        assert.match(diagnosticBadgeHtml(report), /class="diagnostic-badge__icon" aria-hidden="true">[!i]/);
        assert.ok(diagnosticBadgeHtml(report).includes(`<span class="diagnostic-badge__label">${label}</span>`));
        assert.ok(diagnosticPanelHtml(report).includes(`data-quality="${severity}"`));
    }
    for (const report of [null, runDiagnosticRules([rule('unavailable', 'error', null)], {}), runDiagnosticRules([rule('clean', 'error', [])], {})]) {
        assert.doesNotMatch(diagnosticPanelHtml(report), /data-quality=/);
        assert.doesNotMatch(diagnosticBadgeHtml(report), /diagnostic-badge__icon|diagnostic-badge--error|diagnostic-badge--warning/);
    }
    assert.doesNotMatch(diagnosticPanelHtml({highestSeverity: 'error" onclick="unsafe', findings: []}), /data-quality=|onclick=/);
});

test('compact panels keep findings visible and tuck skipped check names into a separate native disclosure', () => {
    const report = runDiagnosticRules([
        rule('error', 'error', [{message: 'Required value is missing'}]),
        {...rule('unknown', 'warning', null), title: '<Unverified title>'},
    ], {});
    const html = diagnosticPanelHtml(report);
    assert.match(html, /^<details class="diagnostic-panel" data-quality="error" open>/);
    assert.match(html, /<p class="diagnostic-coverage">1 of 2 checks completed; 1 unavailable · Checks describe the saved record, not unsaved edits\.<\/p>/);
    assert.doesNotMatch(html, /class="diagnostic-scope"/);
    assert.match(html, /<details class="diagnostic-unverified"><summary>Checks unavailable \(1\)<\/summary>/);
    assert.match(html, /&lt;Unverified title&gt;/);
    assert.match(html, /This does not mean those checks passed/);
    assert.ok(html.indexOf('Required value is missing') < html.indexOf('<details class="diagnostic-unverified"'));
    assert.doesNotMatch(html, /<Unverified title>/);
    const clean = diagnosticPanelHtml(runDiagnosticRules([rule('clean', 'error', [])], {}));
    assert.doesNotMatch(clean, /diagnostic-unverified/);
});

test('typed unavailable checks keep positive names and safe reasons without changing legacy null metadata', () => {
    const unavailable = {status: 'unavailable', reason: 'details', message: 'Open the exercise to read original text.'};
    const report = runDiagnosticRules([{id: 'english', severity: 'error', title: 'Missing English text', checkTitle: 'English text', evaluate: () => unavailable},
        rule('legacy', 'warning', null), rule('clean', 'info', [])], {});
    assert.deepEqual(report.skippedChecks, [{ruleId: 'english', title: 'English text', reason: 'details', message: unavailable.message},
        {ruleId: 'legacy', title: 'Rule legacy'}]);
    assert.deepEqual(runDiagnosticRules([{...rule('old', 'warning', null), checkTitle: 'Profile evidence'}], {}).skippedChecks,
        [{ruleId: 'old', title: 'Profile evidence'}]);
    assert.equal(report.checkedCount, 1); assert.equal(report.totalCount, 3);
    assert.deepEqual(report.counts, {error: 0, warning: 0, info: 0});
    assert.equal(report.highestSeverity, null);
    for (const reason of ['source', 'details', 'reference', 'dependency', 'failed']) {
        assert.deepEqual(diagnostics.unavailableCheck(reason, 'Evidence unavailable'), {status: 'unavailable', reason, message: 'Evidence unavailable'});
    }
    for (const args of [['unknown', 'Text'], ['details', '  '], ['source', null], ['failed', 'Text', [{message: ''}]]]) {
        assert.throws(() => diagnostics.unavailableCheck(...args), TypeError);
    }
    assert.throws(() => runDiagnosticRules([{...rule('invalid-title', 'info', []), checkTitle: ''}], {}), TypeError);
});

test('known findings and missing evidence can coexist without falsely completing a grouped rule', () => {
    const result = {status: 'unavailable', reason: 'source', message: 'The other required field was not supplied.',
        findings: [{field: 'category', message: 'The supplied category is invalid.'}]};
    const report = runDiagnosticRules([{id: 'attributes', severity: 'error', title: 'Invalid attributes', checkTitle: 'Exercise attributes', evaluate: () => result},
        rule('clean', 'info', [])], {});
    assert.deepEqual(report.findings, [{ruleId: 'attributes', severity: 'error', title: 'Invalid attributes', field: 'category', message: result.findings[0].message}]);
    assert.deepEqual(report.skippedChecks, [{ruleId: 'attributes', title: 'Exercise attributes', reason: 'source', message: result.message}]);
    assert.equal(report.counts.error, 1); assert.equal(report.highestSeverity, 'error');
    assert.equal(report.checkedCount, 1); assert.equal(report.checkedCount + report.skippedRuleIds.length, report.totalCount);
    assert.equal(matchesDiagnosticFilter(report, 'attention'), true); assert.equal(matchesDiagnosticFilter(report, 'unverified'), true);
    assert.deepEqual(diagnostics.unavailableCheck('source', result.message, result.findings), result);
});

test('failed evaluators and malformed unavailable atoms expose only fixed failure metadata and no partial findings', () => {
    const secret = 'synthetic-private-value';
    const invalid = [undefined, [{message: 'Valid'}, {message: 3}],
        {status: 'unavailable', reason: 'unknown', message: secret, findings: [{message: 'Do not emit this'}]},
        {status: 'unavailable', reason: 'source', message: '', findings: [{message: 'Do not emit this'}]},
        {status: 'unavailable', reason: 'source', message: secret, findings: [{message: 'Do not emit this'}, {message: ''}]},
        {status: 'unavailable', reason: 'source', message: secret, findings: undefined},
        {status: 'unavailable', reason: 'source', message: secret, findings: Array(2)}];
    const rules = invalid.map((result, index) => rule(`bad-${index}`, 'error', result));
    rules.push({id: 'throw', severity: 'error', title: 'Failed check', checkTitle: 'Safe check', evaluate() { throw new Error(secret); }});
    const report = runDiagnosticRules(rules, {});
    assert.equal(report.checkedCount, 0); assert.deepEqual(report.findings, []);
    assert.equal(report.skippedChecks.length, rules.length);
    for (const check of report.skippedChecks) {
        assert.equal(check.reason, 'failed'); assert.equal(check.message, 'This check could not run. Try again later.');
    }
    assert.equal(report.skippedChecks.at(-1).title, 'Safe check');
    assert.equal(JSON.stringify(report).includes(secret), false);
});

test('unavailable summaries preserve occurrence order and count each record once per exact rule, reason and message', () => {
    const first = Object.freeze({ruleId: '__proto__', title: 'English text', reason: 'details', message: 'Open details.'});
    const second = Object.freeze({ruleId: 'dictionary', title: 'Muscle references', reason: 'reference', message: 'Load dictionaries.'});
    const changed = Object.freeze({...first, reason: 'source', message: 'Original text is unavailable.'});
    const reports = [Object.freeze({skippedChecks: Object.freeze([first, first, second])}),
        Object.freeze({skippedChecks: Object.freeze([{...first, title: 'Later title'}, changed])}),
        {skippedChecks: [{ruleId: 'legacy', title: 'Legacy check'}]}, null];
    assert.deepEqual(diagnostics.summarizeUnavailableChecks(reports), [{...first, count: 2}, {...second, count: 1}, {...changed, count: 1}]);
    assert.deepEqual(diagnostics.summarizeUnavailableChecks([]), []);
    assert.deepEqual(diagnostics.summarizeUnavailableChecks([{skippedChecks: [{...first, reason: 'invalid'}, {...first, message: ''}]}]), []);
});

test('unavailable HTML shares escaped positive explanations and generic record counts between panels and aggregates', () => {
    const injected = '<img src=x onerror="private"> & \'quoted\'';
    const check = {ruleId: 'english', title: injected, reason: 'source', message: injected};
    const html = presentation.unavailableChecksHtml([{...check, count: 2}, {...check, count: 1}]);
    assert.match(html, /class="diagnostic-unavailable-list"/);
    assert.match(html, /class="diagnostic-unavailable-title"/);
    assert.match(html, /Source data unavailable/); assert.match(html, /2 records/); assert.match(html, /1 record</);
    assert.equal(html.includes('<img'), false); assert.equal(html.includes('onerror="'), false);
    assert.match(html, /&lt;img src=x onerror=&quot;private&quot;&gt; &amp; &#39;quoted&#39;/);
    assert.equal(presentation.unavailableChecksHtml([]), '');
    assert.doesNotMatch(presentation.unavailableChecksHtml([{...check, count: '2 private'}]), /2 private|records/);
    const legacy = presentation.unavailableChecksHtml([{ruleId: 'old', title: 'Older check'}]);
    assert.match(legacy, /Required evidence is unavailable for this check/);
    assert.doesNotMatch(legacy, /Details not loaded|Source data unavailable|Check could not run/);
    assert.match(presentation.unavailableChecksHtml([{...check, reason: {toString: null}}]), /Evidence unavailable/);
    for (const [reason, label] of Object.entries({source: 'Source data unavailable', details: 'Details not loaded',
        reference: 'Reference data unavailable', dependency: 'Depends on other data', failed: 'Check could not run'})) {
        assert.ok(presentation.unavailableChecksHtml([{...check, reason}]).includes(label));
    }
});

test('colored badges show findings alone while neutral incomplete checks explain unavailable coverage', () => {
    const unavailable = {status: 'unavailable', reason: 'details', message: 'Open details to inspect original text.'};
    const partial = runDiagnosticRules([rule('error', 'error', [{message: 'Missing required value'}]), rule('unknown', 'warning', unavailable)], {});
    for (const severity of ['error', 'warning', 'info']) {
        const colored = runDiagnosticRules([rule('finding', severity, [{message: 'A finding'}]), rule('unknown', 'warning', unavailable)], {});
        assert.doesNotMatch(diagnosticBadgeHtml(colored), /class="diagnostic-badge__label">[^<]*unavailable/);
        assert.match(diagnosticBadgeHtml(colored), /title="1 of 2 checks completed; 1 unavailable"/);
    }
    assert.match(diagnosticBadgeHtml(partial), /class="diagnostic-badge__label">1 error<\/span>/);
    assert.match(diagnosticPanelHtml(partial), /1 of 2 checks completed; 1 unavailable/);
    assert.match(diagnosticPanelHtml(partial), /<details class="diagnostic-unverified"><summary>Checks unavailable \(1\)/);
    const skipped = runDiagnosticRules([rule('unknown', 'warning', unavailable)], {});
    assert.match(diagnosticBadgeHtml(skipped), /No flags found · 1 check unavailable/);
    assert.match(diagnosticPanelHtml(skipped), /<details class="diagnostic-unverified" open><summary>Checks unavailable \(1\)/);
    assert.match(diagnosticPanelHtml(skipped), /Details not loaded/); assert.match(diagnosticPanelHtml(skipped), /Open details to inspect original text/);
});
