const SEVERITIES = Object.freeze(['error', 'warning', 'info']);
const UNAVAILABLE_REASONS = Object.freeze(['source', 'details', 'reference', 'dependency', 'failed']);
const FAILED_CHECK = Object.freeze({status: 'unavailable', reason: 'failed', message: 'This check could not run. Try again later.'});
const nonemptyText = value => typeof value === 'string' && !!value.trim();

function validFindings(value) {
    if (!Array.isArray(value)) return false;
    for (const finding of value) {
        if (!finding || typeof finding !== 'object' || Array.isArray(finding) || !nonemptyText(finding.message)
            || (finding.field !== undefined && typeof finding.field !== 'string')) return false;
    }
    return true;
}

function validUnavailable(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && value.status === 'unavailable'
        && UNAVAILABLE_REASONS.includes(value.reason) && nonemptyText(value.message)
        && (!Object.hasOwn(value, 'findings') || validFindings(value.findings));
}

/** A check can retain proven findings while some of its required evidence is unavailable. */
export function unavailableCheck(reason, message, findings = []) {
    if (!UNAVAILABLE_REASONS.includes(reason) || !nonemptyText(message) || !validFindings(findings)) {
        throw new TypeError('Unavailable checks need a known reason, a message, and valid optional findings.');
    }
    return {status: 'unavailable', reason, message, ...(findings.length ? {findings} : {})};
}

/**
 * Rules are explicit, synchronous inputs. An empty result means checked and clean;
 * null retains legacy unavailable metadata; typed unavailable results explain missing
 * evidence and may retain findings. Invalid results and failures use safe fixed text.
 * Counts describe findings, while list filters and summaries count matching records.
 */
export function runDiagnosticRules(rules, record, context = {}) {
    if (!Array.isArray(rules)) throw new TypeError('Diagnostic rules must be an array.');
    const ids = new Set();
    for (const rule of rules) {
        if (!rule || typeof rule.id !== 'string' || !rule.id.trim() || ids.has(rule.id)
            || !SEVERITIES.includes(rule.severity) || typeof rule.title !== 'string' || !rule.title.trim()
            || (rule.checkTitle !== undefined && !nonemptyText(rule.checkTitle))
            || typeof rule.evaluate !== 'function') {
            throw new TypeError('Diagnostic rules need unique IDs, a severity, a title, and an evaluator.');
        }
        ids.add(rule.id);
    }

    const findings = [];
    const skippedRuleIds = [];
    const skippedChecks = [];
    const counts = {error: 0, warning: 0, info: 0};
    let checkedCount = 0;
    for (const rule of rules) {
        let result;
        try {
            result = rule.evaluate(record, context);
            if (result !== null && !validFindings(result) && !validUnavailable(result)) result = FAILED_CHECK;
        } catch { result = FAILED_CHECK; }
        if (result === null || !Array.isArray(result)) {
            skippedRuleIds.push(rule.id);
            skippedChecks.push({ruleId: rule.id, title: rule.checkTitle || rule.title,
                ...(result === null ? {} : {reason: result.reason, message: result.message})});
        } else checkedCount++;
        const evaluated = Array.isArray(result) ? result : result && Object.hasOwn(result, 'findings') ? result.findings : [];
        for (const finding of evaluated) {
            findings.push({ruleId: rule.id, severity: rule.severity, title: rule.title, message: finding.message,
                ...(finding.field === undefined ? {} : {field: finding.field})});
            counts[rule.severity]++;
        }
    }
    return {findings, skippedRuleIds, skippedChecks, checkedCount, totalCount: rules.length, counts,
        highestSeverity: SEVERITIES.find(severity => counts[severity] > 0) ?? null};
}

/** Aggregate typed unavailable checks, counting each exact explanation once per record. */
export function summarizeUnavailableChecks(reports) {
    const groups = new Map();
    for (const report of reports) {
        const seen = new Set();
        for (const check of Array.isArray(report?.skippedChecks) ? report.skippedChecks : []) {
            if (!check || !nonemptyText(check.ruleId) || !nonemptyText(check.title)
                || !UNAVAILABLE_REASONS.includes(check.reason) || !nonemptyText(check.message)) continue;
            const key = JSON.stringify([check.ruleId, check.reason, check.message]);
            if (seen.has(key)) continue;
            seen.add(key);
            if (!groups.has(key)) groups.set(key, {ruleId: check.ruleId, title: check.title,
                reason: check.reason, message: check.message, count: 0});
            groups.get(key).count++;
        }
    }
    return [...groups.values()];
}

export function matchesDiagnosticFilter(report, value = 'all') {
    if (value === 'all') return true;
    if (value === 'unverified') return !report || report.totalCount === 0 || report.checkedCount < report.totalCount;
    const findings = report?.findings ?? [];
    if (value === 'attention') return findings.some(finding => finding.severity === 'error' || finding.severity === 'warning');
    if (SEVERITIES.includes(value)) return findings.some(finding => finding.severity === value);
    if (typeof value === 'string' && value.startsWith('rule:')) return findings.some(finding => finding.ruleId === value.slice(5));
    return false;
}

/** Each severity/rule counts a record once, even when its rule emits several findings. */
export function summarizeDiagnosticReports(reports) {
    const counts = {error: 0, warning: 0, info: 0};
    const ruleCounts = new Map();
    let attentionCount = 0;
    let unverifiedCount = 0;
    for (const report of reports) {
        if (matchesDiagnosticFilter(report, 'unverified')) unverifiedCount++;
        if (matchesDiagnosticFilter(report, 'attention')) attentionCount++;
        for (const severity of SEVERITIES) if (matchesDiagnosticFilter(report, severity)) counts[severity]++;
        for (const ruleId of new Set((report?.findings ?? []).map(finding => finding.ruleId))) {
            ruleCounts.set(ruleId, (ruleCounts.get(ruleId) ?? 0) + 1);
        }
    }
    return {recordCount: reports.length, attentionCount, unverifiedCount, counts, ruleCounts: Object.fromEntries(ruleCounts)};
}

/** Stable option values; labels count records rather than individual findings. */
export function getDiagnosticFilterOptions(reports, rules) {
    const summary = summarizeDiagnosticReports(reports);
    return [
        {value: 'all', label: `All records (${summary.recordCount})`},
        {value: 'attention', label: `Needs attention (${summary.attentionCount})`},
        {value: 'unverified', label: `Checks unavailable (${summary.unverifiedCount})`},
        {value: 'error', label: `Errors (${summary.counts.error})`},
        {value: 'warning', label: `Warnings (${summary.counts.warning})`},
        {value: 'info', label: `Information (${summary.counts.info})`},
        ...rules.map(rule => ({value: `rule:${rule.id}`, label: `${rule.title} (${Object.hasOwn(summary.ruleCounts, rule.id) ? summary.ruleCounts[rule.id] : 0})`})),
    ];
}
