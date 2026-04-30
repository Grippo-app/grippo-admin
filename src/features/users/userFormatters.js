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

/** Short relative date: today / yesterday / 3d ago / 5mo ago / 2yr ago. */
export function relativeDate(value) {
    if (!value) return '';
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) return '';
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
    if (!value) return '';
    const d = new Date(value);
    const ts = d.getTime();
    if (!Number.isFinite(ts)) return '';
    return d.toISOString().slice(0, 16).replace('T', ' ');
}

/** Convert seconds into "1h 12m" / "42m" / "30s". */
export function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    const total = Math.max(0, Math.round(Number(seconds)));
    if (!Number.isFinite(total)) return '—';
    if (total === 0) return '0s';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return s && m < 5 ? `${m}m ${s}s` : `${m}m`;
    return `${s}s`;
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
