export function pretty(json) {
    return JSON.stringify(json, null, 2);
}

export function formatIso(value) {
    if (value === null || value === undefined || value === '' || value === 0) return '—';
    const d = value instanceof Date ? value : new Date(value);
    const ts = d.getTime();
    if (!Number.isFinite(ts)) return '—';
    try {
        return d.toISOString().replace('T', ' ');
    } catch {
        return '—';
    }
}

export function uuidv4() {
    if (crypto?.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export function safeString(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    try {
        return String(value);
    } catch {
        return '';
    }
}

/**
 * Безопасный экран строки для подстановки в innerHTML.
 * Используется во всех местах, где пользовательские поля попадают в HTML.
 */
const HTML_ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
export function escapeHtml(value) {
    return safeString(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

/**
 * Санитизирует URL: разрешает только http(s) и относительные пути.
 * Запрещает `javascript:`, `data:`, `vbscript:`, и protocol-relative `//host`
 * (которые могут увести на внешний домен). Возвращает чистый URL без HTML-escape —
 * подходит для DOM-property (img.src, a.href и т.п.).
 *
 * Для подстановки в innerHTML/template literal оборачивайте дополнительно в escapeHtml.
 */
export function sanitizeUrl(value) {
    const s = safeString(value).trim();
    if (!s) return '';
    // protocol-relative (//host/path) — отвергаем, может увести на чужой домен
    if (s.startsWith('//')) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) return s;
    return '';
}

/**
 * URL для подстановки в HTML-атрибут (через innerHTML/template literal).
 * Сначала санитизирует, потом HTML-escape'ит — безопасно и не ломает & в query string.
 */
export function safeUrl(value) {
    return escapeHtml(sanitizeUrl(value));
}

const collator = typeof Intl !== 'undefined' && Intl.Collator
    ? new Intl.Collator(undefined, {sensitivity: 'base', numeric: true})
    : null;

export function compareStrings(a, b) {
    const strA = safeString(a);
    const strB = safeString(b);
    if (collator) return collator.compare(strA, strB);
    const cmp = strA.toLowerCase().localeCompare(strB.toLowerCase());
    if (cmp !== 0) return cmp;
    return strA.localeCompare(strB);
}

export function toTimestamp(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (value instanceof Date) {
        const ts = value.getTime();
        return Number.isFinite(ts) ? ts : 0;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}
