import test from 'node:test';
import assert from 'node:assert/strict';
import {runDiagnosticRules, matchesDiagnosticFilter, summarizeDiagnosticReports, getDiagnosticFilterOptions} from '../src/domain/diagnostics/index.js';
import {diagnosticBadgeHtml, diagnosticPanelHtml} from '../src/shared/components/diagnosticPresentation.js';

const rule = (id, severity, result) => ({id, severity, title: `Rule ${id}`, evaluate: () => result});

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
        {value: 'unverified', label: 'Not fully checked (2)'},
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
    assert.match(diagnosticBadgeHtml(clean), /diagnostic-badge--clean[^>]*>No flags found/);
    assert.match(diagnosticBadgeHtml(skipped), /diagnostic-badge--unchecked[^>]*>No flags found · 1 not verified/);
    assert.match(diagnosticBadgeHtml(null), /diagnostic-badge--unchecked[^>]*>Not checked/);
    assert.match(diagnosticBadgeHtml(runDiagnosticRules([], {})), />Not checked/);
    assert.match(diagnosticPanelHtml(skipped), /0 of 1 checks completed; 1 not verified/);
    assert.match(diagnosticPanelHtml(skipped), /does not mean those checks passed/);
    assert.match(diagnosticPanelHtml(null), /Checks have not run/);
    assert.match(diagnosticPanelHtml(null), /^<details class="diagnostic-panel"><summary/);
    assert.match(diagnosticPanelHtml(runDiagnosticRules([rule('error', 'error', [{message: 'Problem'}])], {})), /^<details class="diagnostic-panel" open>/);
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
    assert.match(html, /Not verified: &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; missing text; Rule dictionary\./);
    assert.equal(html.includes('<img'), false);
    assert.doesNotMatch(html, /Rule clean|failed request|dictionary unavailable/);
    const {skippedChecks, ...legacyReport} = report;
    assert.match(diagnosticPanelHtml(legacyReport), /Some checks have not been verified/);
});
