'use strict';
// Turn mapped data rows into output records: grouping, validation, formatting, built-ins, titles.
const Mustache = require('mustache');
const { isBlank, formatValue, formatDate, safeFilename } = require('./format');

function groupKey(value) {
  if (isBlank(value)) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s;
}

function rawValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value === undefined ? null : value;
}

function renderTitle(pattern, view) {
  try {
    return Mustache.render(pattern, view, {}, { escape: (s) => String(s) });
  } catch {
    return '';
  }
}

function buildRecords(fieldRows, rowNumbers, template, { today = new Date() } = {}) {
  const { manifest, fields } = template;
  const locale = manifest.locale;
  const topFields = fields.filter((f) => !f.inList);
  const listFields = fields.filter((f) => f.inList);
  const issues = [];

  let groups;
  if (manifest.groupBy) {
    const byKey = new Map();
    const groupLabel = (fields.find((f) => f.name === manifest.groupBy) || {}).label || manifest.groupBy;
    fieldRows.forEach((row, i) => {
      const key = groupKey(row[manifest.groupBy]);
      if (key === null) {
        if (Object.values(row).some((v) => !isBlank(v))) issues.push(`Row ${rowNumbers[i]}: ${groupLabel} is blank, so the row was skipped.`);
        return;
      }
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(i);
    });
    groups = [...byKey.values()];
  } else {
    groups = fieldRows.map((_, i) => [i]);
  }

  const todayText = formatDate(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())), 'MMMM d, yyyy', locale);
  const usedTitles = new Set();

  const records = groups.map((idxs, gi) => {
    const warnings = [];
    let skipped = false;
    const put = (view, raw, f, value, rowNo) => {
      if (f.required && isBlank(value)) {
        warnings.push(`Row ${rowNo}: ${f.label} is blank.`);
        skipped = true;
      }
      const { text, error } = formatValue(value, f, locale);
      if (error) {
        warnings.push(`Row ${rowNo}: ${f.label}: ${error}`);
        skipped = true;
      }
      view[f.name] = text;
      raw[f.name] = rawValue(value);
    };

    const view = {};
    const raw = {};
    const first = fieldRows[idxs[0]];
    for (const f of topFields) {
      const value = first[f.name];
      for (const i of idxs.slice(1)) {
        const other = fieldRows[i][f.name];
        if (!isBlank(other) && !isBlank(value) && groupKey(other) !== groupKey(value)) {
          warnings.push(`${f.label} differs within this group (row ${rowNumbers[i]} has "${other}"); using "${value}".`);
          break;
        }
      }
      put(view, raw, f, value, rowNumbers[idxs[0]]);
    }
    if (manifest.groupBy) {
      view[manifest.list] = [];
      raw[manifest.list] = [];
      for (const i of idxs) {
        const item = {};
        const rawItem = {};
        for (const f of listFields) put(item, rawItem, f, fieldRows[i][f.name], rowNumbers[i]);
        view[manifest.list].push(item);
        raw[manifest.list].push(rawItem);
      }
    }
    Object.assign(view, { recordNumber: gi + 1, recordCount: groups.length, templateName: manifest.name, today: todayText });
    const title = safeFilename(renderTitle(manifest.filename, view), usedTitles);
    return {
      index: gi,
      title,
      view,
      raw,
      listCount: manifest.groupBy ? idxs.length : null,
      warnings,
      skipped,
      rowNumbers: idxs.map((i) => rowNumbers[i]),
    };
  });

  return { records, issues };
}

module.exports = { buildRecords };
