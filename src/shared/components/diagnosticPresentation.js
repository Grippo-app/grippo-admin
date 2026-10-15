import {escapeHtml} from '../utils/index.js';

const SEVERITY_LABELS = Object.freeze({error: 'Error', warning: 'Warning', info: 'Information'});

function checkSummary(report) {
    if (!report || report.totalCount === 0) return 'Not checked';
    const remaining = report.totalCount - report.checkedCount;
    return `${report.checkedCount} of ${report.totalCount} checks completed${remaining > 0 ? `; ${remaining} not verified` : ''}`;
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
    const label = summary ? `${summary}${unchecked > 0 ? ` · ${unchecked} not verified` : ''}`
        : unchecked > 0 ? `No flags found · ${unchecked} not verified`
            : report?.totalCount > 0 ? 'No flags found' : 'Not checked';
    const severity = Object.hasOwn(SEVERITY_LABELS, report?.highestSeverity) ? report.highestSeverity
        : unchecked === 0 ? 'clean' : 'unchecked';
    return `<span class="diagnostic-badge diagnostic-badge--${severity}" title="${escapeHtml(checkSummary(report))}">${escapeHtml(label)}</span>`;
}

export function diagnosticPanelHtml(report, {title = 'Saved record checks'} = {}) {
    const findings = report?.findings ?? [];
    const content = findings.length ? `<ul class="diagnostic-findings">${findings.map(finding => {
        const severity = Object.hasOwn(SEVERITY_LABELS, finding.severity) ? finding.severity : 'info';
        return `<li class="diagnostic-panel__item diagnostic-item--${severity}"><strong class="diagnostic-panel__title">${SEVERITY_LABELS[severity]}: ${escapeHtml(finding.title)}</strong><p class="diagnostic-panel__message">${escapeHtml(finding.message)}</p>${finding.field ? `<span class="diagnostic-field">Field: ${escapeHtml(finding.field)}</span>` : ''}</li>`;
    }).join('')}</ul>` : `<p class="diagnostic-empty">${report?.totalCount > 0 ? 'No flags found in the completed checks.' : 'Checks have not run for this record.'}</p>`;
    const skippedNames = (report?.skippedChecks ?? []).map(check => escapeHtml(check.title)).join('; ');
    const unavailable = report?.totalCount > report?.checkedCount
        ? `<p class="diagnostic-unverified">${skippedNames ? `Not verified: ${skippedNames}.` : 'Some checks have not been verified.'} This does not mean those checks passed.</p>` : '';
    return `<details class="diagnostic-panel"${report?.highestSeverity === 'error' ? ' open' : ''}><summary class="diagnostic-panel__header"><span>${escapeHtml(title)}</span>${diagnosticBadgeHtml(report)}</summary><div class="diagnostic-panel__body"><p class="diagnostic-coverage">${escapeHtml(checkSummary(report))}</p><p class="diagnostic-scope">Checks describe the saved record, not unsaved edits.</p>${content}${unavailable}</div></details>`;
}
