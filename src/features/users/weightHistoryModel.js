import {parseUserTimestamp} from '../../domain/user/userEvidence.js';

function weightTimestamp(value) {
    // The history endpoint also has legacy date-only records; treat those as UTC days.
    const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00Z` : value;
    return parseUserTimestamp(date).timestamp;
}

/** Prepare normalized weight rows without inventing ordering for unknown or equal dates. */
export function buildWeightHistoryModel(entries = []) {
    const rows = entries.map(entry => ({entry, timestamp: weightTimestamp(entry.createdAt), delta: null}));
    rows.sort((a, b) => a.timestamp === null ? b.timestamp === null ? 0 : 1
        : b.timestamp === null ? -1 : b.timestamp - a.timestamp);
    const dated = rows.filter(row => row.timestamp !== null).sort((a, b) => a.timestamp - b.timestamp);
    const groups = [];
    for (const row of dated) {
        const group = groups.at(-1);
        if (group?.timestamp === row.timestamp) group.rows.push(row);
        else groups.push({timestamp: row.timestamp, rows: [row]});
    }

    const first = groups[0];
    const last = groups.at(-1);
    const model = {rows, points: [], lineSegments: [], latestWeight: last?.rows.length === 1 ? last.rows[0].entry.weight : null,
        latestTime: last?.timestamp ?? null, change: null, axis: null,
        datedCount: dated.length, undatedCount: rows.length - dated.length,
        ambiguousCount: groups.reduce((count, group) => count + (group.rows.length > 1 ? group.rows.length : 0), 0),
        distinctTimeCount: groups.length};
    if (!dated.length) return model;

    let low = Infinity, high = -Infinity;
    for (const row of dated) {
        low = Math.min(low, row.entry.weight);
        high = Math.max(high, row.entry.weight);
    }
    const min = Math.max(0, Math.floor((low - 1) * 2) / 2);
    const max = Math.ceil((high + 1) * 2) / 2;
    model.axis = {min, mid: (min + max) / 2, max};

    let segment = [];
    for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        const previous = groups[index - 1];
        const x = first.timestamp === last.timestamp ? 0.5
            : (group.timestamp - first.timestamp) / (last.timestamp - first.timestamp);
        const points = group.rows.map(row => ({entry: row.entry, timestamp: row.timestamp, weight: row.entry.weight,
            x, y: (max - row.entry.weight) / (max - min)}));
        for (const point of points) model.points.push(point);
        if (group.rows.length === 1) {
            if (previous?.rows.length === 1) group.rows[0].delta = group.rows[0].entry.weight - previous.rows[0].entry.weight;
            segment.push(points[0]);
        } else {
            // Every measurement stays visible; a tied time supplies no chronological path through it.
            if (segment.length > 1) model.lineSegments.push(segment);
            segment = [];
        }
    }
    if (segment.length > 1) model.lineSegments.push(segment);
    if (groups.length > 1 && first.rows.length === 1 && last.rows.length === 1) {
        model.change = last.rows[0].entry.weight - first.rows[0].entry.weight;
    }
    return model;
}
