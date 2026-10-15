const SEVERITIES = Object.freeze(['error', 'warning', 'info']);

/**
 * Rules are explicit, synchronous inputs. An empty result means checked and clean;
 * null, an invalid result, or an evaluator failure means the check was unavailable.
 * Counts describe findings, while list filters and summaries count matching records.
 */
export function runDiagnosticRules(rules, record, context = {}) {
    if (!Array.isArray(rules)) throw new TypeError('Diagnostic rules must be an array.');
    const ids = new Set();
    for (const rule of rules) {
        if (!rule || typeof rule.id !== 'string' || !rule.id.trim() || ids.has(rule.id)
            || !SEVERITIES.includes(rule.severity) || typeof rule.title !== 'string' || !rule.title.trim()
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
        try { result = rule.evaluate(record, context); }
        catch { result = null; }
        const valid = Array.isArray(result) && result.every(finding => finding && typeof finding === 'object'
            && typeof finding.message === 'string' && !!finding.message.trim()
            && (finding.field === undefined || typeof finding.field === 'string'));
        if (!valid) {
            skippedRuleIds.push(rule.id);
            skippedChecks.push({ruleId: rule.id, title: rule.title});
            continue;
        }
        checkedCount++;
        for (const finding of result) {
            findings.push({ruleId: rule.id, severity: rule.severity, title: rule.title, message: finding.message,
                ...(finding.field === undefined ? {} : {field: finding.field})});
            counts[rule.severity]++;
        }
    }
    return {findings, skippedRuleIds, skippedChecks, checkedCount, totalCount: rules.length, counts,
        highestSeverity: SEVERITIES.find(severity => counts[severity] > 0) ?? null};
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
        {value: 'unverified', label: `Not fully checked (${summary.unverifiedCount})`},
        {value: 'error', label: `Errors (${summary.counts.error})`},
        {value: 'warning', label: `Warnings (${summary.counts.warning})`},
        {value: 'info', label: `Information (${summary.counts.info})`},
        ...rules.map(rule => ({value: `rule:${rule.id}`, label: `${rule.title} (${Object.hasOwn(summary.ruleCounts, rule.id) ? summary.ruleCounts[rule.id] : 0})`})),
    ];
}
