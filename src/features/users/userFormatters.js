/**
 * Convert snake/camel case enum values to a readable label.
 * e.g. 'build_muscle' -> 'Build muscle'.
 */
export function humanizeEnum(value) {
    if (!value || typeof value !== 'string') return '';
    return value
        .replace(/[_\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, c => c.toUpperCase());
}

function readableDate(value) {
    if (!(value instanceof Date) && typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

/** Short relative date: today / yesterday / 3d ago / 5mo ago / 2yr ago. */
export function relativeDate(value) {
    const date = readableDate(value);
    if (!date) return '';
    const ts = date.getTime();
    const diff = Date.now() - ts;
    if (diff < 0) return formatShortDate(value);
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}yr ago`;
}

/** YYYY-MM-DD HH:MM (UTC). */
export function formatShortDate(value) {
    const d = readableDate(value);
    if (!d) return '';
    return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Format the API's duration in minutes as "1h 12m" / "42m". */
export function formatDuration(minutes) {
    if (minutes === null || minutes === undefined || minutes === '') return '—';
    const total = Math.max(0, Math.round(Number(minutes)));
    if (!Number.isFinite(total)) return '—';
    const hours = Math.floor(total / 60);
    const remainder = total % 60;
    if (hours > 0) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
    return `${total}m`;
}

/** Format a number with thousand separators and an optional unit. */
export function formatNumber(value, {unit = '', decimals = 0} = {}) {
    if (value === null || value === undefined) return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    const formatted = num.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
    return unit ? `${formatted} ${unit}` : formatted;
}
