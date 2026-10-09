'use strict';
// Value parsing and display formatting for merge fields, plus safe output filenames.

const EXCEL_EPOCH_OFFSET = 25569; // days from 1899-12-30 to 1970-01-01
const DAY_MS = 86400000;

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function parseNumber(raw) {
  if (isBlank(raw)) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== 'string') return NaN;
  let s = raw.trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s,$€£¥]/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
}

function utcDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

function parseDate(raw) {
  if (isBlank(raw)) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? 'invalid' : raw;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return 'invalid';
    return new Date(Math.round((raw - EXCEL_EPOCH_OFFSET) * DAY_MS));
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return utcDate(Number(m[1]), Number(m[2]), Number(m[3])) || 'invalid';
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return utcDate(Number(m[3]), Number(m[1]), Number(m[2])) || 'invalid';
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return 'invalid';
  return utcDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()) || 'invalid';
}

function formatDate(date, pattern, locale) {
  const month = (style) => new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(date);
  const pad = (n) => String(n).padStart(2, '0');
  return pattern.replace(/yyyy|MMMM|MMM|MM|M|dd|d/g, (token) => {
    switch (token) {
      case 'yyyy': return String(date.getUTCFullYear());
      case 'MMMM': return month('long');
      case 'MMM': return month('short');
      case 'MM': return pad(date.getUTCMonth() + 1);
      case 'M': return String(date.getUTCMonth() + 1);
      case 'dd': return pad(date.getUTCDate());
      default: return String(date.getUTCDate());
    }
  });
}

function numberFormat(locale, options, decimals) {
  return new Intl.NumberFormat(locale, { ...options, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatValue(raw, spec = {}, locale = 'en-US') {
  const format = spec.format || 'text';
  if (isBlank(raw)) return { text: spec.blank ?? '' };
  if (format === 'text') {
    if (raw instanceof Date) return { text: formatDate(raw, 'MMMM d, yyyy', locale) };
    return { text: String(raw).trim() };
  }
  if (format === 'date') {
    const date = parseDate(raw);
    if (date === 'invalid') return { text: String(raw), error: `"${raw}" is not a date` };
    return { text: formatDate(date, spec.dateFormat || 'MMMM d, yyyy', locale) };
  }
  let n;
  if (format === 'percent' && typeof raw === 'string' && raw.trim().endsWith('%')) {
    n = parseNumber(raw.trim().slice(0, -1));
    n = Number.isNaN(n) ? n : n / 100;
  } else {
    n = parseNumber(raw);
  }
  if (Number.isNaN(n)) return { text: String(raw), error: `"${raw}" is not a number` };
  if (format === 'currency') {
    return { text: numberFormat(locale, { style: 'currency', currency: spec.currency || 'USD' }, spec.decimals ?? 2).format(n) };
  }
  if (format === 'number') return { text: numberFormat(locale, { style: 'decimal' }, spec.decimals ?? 0).format(n) };
  if (format === 'percent') return { text: numberFormat(locale, { style: 'percent' }, spec.decimals ?? 0).format(n) };
  return { text: String(raw), error: `unknown format "${format}"` };
}

function safeFilename(name, used = new Set()) {
  let base = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (!base) base = 'document';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `_${base}`;
  base = base.slice(0, 150).trim();
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${base} (${n})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

module.exports = { isBlank, parseNumber, parseDate, formatDate, formatValue, safeFilename };
