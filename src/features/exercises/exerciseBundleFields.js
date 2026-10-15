/** Read live rows before a click or save can run ahead of the browser's change event. */
export function readBundleRows(container, previous) {
    const rows = container?.querySelectorAll('[data-bundle-index]');
    if (!rows?.length) return previous;
    return Array.from(rows, row => {
        const original = Array.isArray(previous) ? previous[Number(row.dataset.bundleIndex)] : null;
        const muscle = row.querySelector('[data-bundle-muscle]');
        const percentage = row.querySelector('[data-bundle-percentage]');
        const raw = percentage?.value.trim() ?? '';
        return {...original, muscleId: muscle?.value ?? original?.muscleId ?? '',
            percentage: percentage ? raw === '' ? NaN : Number(raw) : original?.percentage};
    });
}

export function updateBundleSummary(element, sum) {
    if (!element) return;
    const rounded = Number(sum.toFixed(2));
    const complete = Math.abs(sum - 100) < 0.000001;
    element.textContent = complete ? '100% allocated · Ready to save' : `${rounded}% allocated · ${sum < 100 ? `${Number((100 - sum).toFixed(2))}% remaining` : `${Number((sum - 100).toFixed(2))}% over the limit`}`;
    element.className = `sum ${complete ? 'ok' : 'bad'}`;
}
