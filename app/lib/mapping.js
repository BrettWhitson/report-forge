'use strict';
// Match data columns to template fields by normalized name.

function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function autoMap(headers, fields, saved = {}) {
  const byKey = new Map();
  for (const h of headers) {
    const k = normalize(h);
    if (k && !byKey.has(k)) byKey.set(k, h);
  }
  const mapping = {};
  for (const f of fields) {
    if (saved[f.name] && headers.includes(saved[f.name])) {
      mapping[f.name] = saved[f.name];
      continue;
    }
    const keys = [f.name, f.label, ...(f.aliases || [])].map(normalize);
    mapping[f.name] = keys.map((k) => byKey.get(k)).find(Boolean) || null;
  }
  return mapping;
}

function applyMapping(rows, mapping) {
  const pairs = Object.entries(mapping);
  return rows.map((row) => Object.fromEntries(pairs.map(([field, header]) => [field, header ? row[header] ?? null : null])));
}

function missingRequired(fields, mapping) {
  return fields.filter((f) => f.required && !mapping[f.name]).map((f) => f.label);
}

module.exports = { normalize, autoMap, applyMapping, missingRequired };
