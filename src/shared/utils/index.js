export function toast({ title, message = '', type = 'success', ms = 3000 }) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="title">${title}</div>${message ? `<div>${message}</div>` : ''}`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function pretty(json) {
  return JSON.stringify(json, null, 2);
}

export function formatIso(value) {
  try {
    return new Date(value).toISOString().replace('T', ' ').replace('Z', 'Z');
  } catch {
    return String(value);
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

const collator = typeof Intl !== 'undefined' && Intl.Collator
  ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
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
