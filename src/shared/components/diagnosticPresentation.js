import {escapeHtml} from '../utils/index.js';

const SEVERITY_LABELS = Object.freeze({error: 'Error', warning: 'Warning', info: 'Information'});
const UNAVAILABLE_LABELS = Object.freeze({source: 'Source data unavailable', details: 'Details not loaded',
    reference: 'Reference data unavailable', dependency: 'Depends on other data', failed: 'Check could not run'});

export function primaryAttentionFinding(report) {
    return report?.findings?.find(finding => finding.severity === 'error')
        || report?.findings?.find(finding => finding.severity === 'warning') || null;
}

export function diagnosticReasonHtml(report) {
    const finding = primaryAttentionFinding(report);
    return finding ? `<span class="diagnostic-reason" title="${escapeHtml(finding.message)}">${escapeHtml(finding.title)}</span>` : '';
}

function checkSummary(report) {
    if (!report || report.totalCount === 0) return 'Not checked';
    const remaining = report.totalCount - report.checkedCount;
    return `${report.checkedCount} of ${report.totalCount} checks completed${remaining > 0 ? `; ${remaining} unavailable` : ''}`;
}

function findingSummary(report) {
    return ['error', 'warning', 'info'].flatMap(severity => {
        const count = report?.counts?.[severity] ?? 0;
        if (!count) return [];
        const label = severity === 'info' ? 'note' : severity;
        return [`${count} ${label}${count === 1 ? '' : 's'}`];
    }).join(' · ');
}

export function diagnosticBadgeHtml(report) {
    const summary = findingSummary(report);
    const unchecked = !report || report.totalCount === 0 ? null : report.totalCount - report.checkedCount;
    const label = summary || (unchecked > 0 ? `No flags found · ${unchecked} check${unchecked === 1 ? '' : 's'} unavailable`
            : report?.totalCount > 0 ? 'No flags found' : 'Not checked');
    const severity = Object.hasOwn(SEVERITY_LABELS, report?.highestSeverity) ? report.highestSeverity
        : unchecked === 0 ? 'clean' : 'unchecked';
    const icon = Object.hasOwn(SEVERITY_LABELS, severity)
        ? `<span class="diagnostic-badge__icon" aria-hidden="true">${severity === 'info' ? 'i' : '!'}</span>` : '';
    return `<span class="diagnostic-badge diagnostic-badge--${severity}" title="${escapeHtml(checkSummary(report))}">${icon}<span class="diagnostic-badge__label">${escapeHtml(label)}</span></span>`;
}

/** Shared explanations for individual records and library-wide aggregates. */
export function unavailableChecksHtml(checks) {
    const entries = (Array.isArray(checks) ? checks : []).filter(check => check && typeof check.title === 'string' && check.title.trim());
    if (!entries.length) return '';
    return `<ul class="diagnostic-unavailable-list">${entries.map(check => {
        const typed = typeof check.reason === 'string' && Object.hasOwn(UNAVAILABLE_LABELS, check.reason)
            && typeof check.message === 'string' && check.message.trim();
        const reason = typed ? UNAVAILABLE_LABELS[check.reason] : 'Evidence unavailable';
        const message = typed ? check.message : 'Required evidence is unavailable for this check.';
        const count = Number.isSafeInteger(check.count) && check.count >= 0
            ? `<span class="diagnostic-unavailable-count">${escapeHtml(check.count)} record${check.count === 1 ? '' : 's'}</span>` : '';
        return `<li class="diagnostic-unavailable-item"><strong class="diagnostic-unavailable-title">${escapeHtml(check.title)}</strong><span class="diagnostic-unavailable-reason">${escapeHtml(reason)}</span><p class="diagnostic-unavailable-message">${escapeHtml(message)}</p>${count}</li>`;
    }).join('')}</ul>`;
}

export function diagnosticPanelHtml(report, {title = 'Saved record checks'} = {}) {
    const findings = report?.findings ?? [];
    const content = findings.length ? `<ul class="diagnostic-findings">${findings.map(finding => {
        const severity = Object.hasOwn(SEVERITY_LABELS, finding.severity) ? finding.severity : 'info';
        return `<li class="diagnostic-panel__item diagnostic-item--${severity}"><strong class="diagnostic-panel__title">${SEVERITY_LABELS[severity]}: ${escapeHtml(finding.title)}</strong><p class="diagnostic-panel__message">${escapeHtml(finding.message)}</p>${finding.field ? `<span class="diagnostic-field">Field: ${escapeHtml(finding.field)}</span>` : ''}</li>`;
    }).join('')}</ul>` : `<p class="diagnostic-empty">${report?.totalCount > 0 ? 'No flags found in the completed checks.' : 'Checks have not run for this record.'}</p>`;
    const skipped = unavailableChecksHtml(report?.skippedChecks);
    const uncheckedCount = report?.totalCount - report?.checkedCount;
    const unavailable = uncheckedCount > 0
        ? `<details class="diagnostic-unverified"${findings.length ? '' : ' open'}><summary>Checks unavailable (${escapeHtml(uncheckedCount)})</summary>${skipped || '<p>Required evidence is unavailable for these checks.</p>'}<p>This does not mean those checks passed.</p></details>` : '';
    const quality = Object.hasOwn(SEVERITY_LABELS, report?.highestSeverity) ? ` data-quality="${report.highestSeverity}"` : '';
    return `<details class="diagnostic-panel"${quality}${report?.highestSeverity === 'error' ? ' open' : ''}><summary class="diagnostic-panel__header"><span>${escapeHtml(title)}</span>${diagnosticBadgeHtml(report)}</summary><div class="diagnostic-panel__body"><p class="diagnostic-coverage">${escapeHtml(checkSummary(report))} · Checks describe the saved record, not unsaved edits.</p>${content}${unavailable}</div></details>`;
}
