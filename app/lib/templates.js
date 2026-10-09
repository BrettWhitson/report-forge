'use strict';
// Discover template folders, load manifests, and detect merge fields from template HTML.
const fs = require('fs');
const path = require('path');
const Mustache = require('mustache');
const { TemplateError } = require('./render');

const FORMATS = ['text', 'currency', 'number', 'percent', 'date'];
const BUILT_INS = ['recordNumber', 'recordCount', 'templateName', 'today'];
const TEMP_FILE = /^_(render|preview)-.*\.html$/i;

function detectFields(html) {
  let tokens;
  try {
    tokens = Mustache.parse(html);
  } catch (err) {
    throw new TemplateError(err.message);
  }
  const top = [];
  const lists = {};
  const add = (arr, name) => {
    if (name !== '.' && !BUILT_INS.includes(name) && !arr.includes(name)) arr.push(name);
  };
  const walk = (list, inList) => {
    for (const t of list) {
      const [type, name] = t;
      if (type === 'name' || type === '&') {
        add(inList ? lists[inList] : top, name);
      } else if (type === '#' || type === '^') {
        const children = t[4] || [];
        const hasVars = children.some((c) => ['name', '&', '#', '^'].includes(c[0]));
        if (!inList && type === '#' && hasVars) {
          lists[name] = lists[name] || [];
          walk(children, name);
        } else {
          add(inList ? lists[inList] : top, name);
          walk(children, inList);
        }
      }
    }
  };
  walk(tokens, null);
  return { fields: top, lists };
}

function cleanTempFiles(dir) {
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (TEMP_FILE.test(name)) {
      fs.rmSync(path.join(dir, name), { force: true });
      removed += 1;
    }
  }
  return removed;
}

function readManifest(dir) {
  const file = path.join(dir, 'template.json');
  if (!fs.existsSync(file)) return {};
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('must be a JSON object');
    return m;
  } catch (err) {
    throw new TemplateError(`template.json: ${err.message}`);
  }
}

function loadTemplate(dir) {
  const id = path.basename(dir);
  cleanTempFiles(dir);
  const htmlPath = path.join(dir, 'template.html');
  if (!fs.existsSync(htmlPath)) throw new TemplateError(`template.html not found in ${dir}`);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const raw = readManifest(dir);
  const detected = detectFields(html);
  const declared = raw.fields && typeof raw.fields === 'object' ? raw.fields : {};
  const listNames = Object.keys(detected.lists);
  const manifest = {
    name: raw.name || id,
    locale: raw.locale || 'en-US',
    filename: raw.filename || '{{templateName}} - {{recordNumber}}',
    groupBy: raw.groupBy || null,
    list: raw.list || listNames[0] || 'rows',
  };
  for (const [name, f] of Object.entries(declared)) {
    if (f.format && !FORMATS.includes(f.format)) {
      throw new TemplateError(`template.json: field "${name}" has unknown format "${f.format}"`);
    }
  }
  // When grouping, a field belongs to the list unless the HTML uses it at top level (or it is the groupBy field).
  // This puts declared-but-unused fields such as projectCode in the list, so they never raise group conflicts.
  const listFields = manifest.groupBy ? detected.lists[manifest.list] || [] : [];
  const isListField = (name) => Boolean(manifest.groupBy) && name !== manifest.groupBy && !detected.fields.includes(name);
  const names = [];
  const push = (n) => { if (!names.includes(n) && !BUILT_INS.includes(n)) names.push(n); };
  detected.fields.forEach(push);
  if (!manifest.groupBy) Object.values(detected.lists).flat().forEach(push);
  listFields.forEach(push);
  Object.keys(declared).forEach(push);
  if (manifest.groupBy) push(manifest.groupBy);
  const fields = names
    .filter((n) => !(manifest.groupBy && n === manifest.list))
    .map((name) => {
      const f = declared[name] || {};
      return {
        name,
        label: f.label || name,
        aliases: Array.isArray(f.aliases) ? f.aliases : [],
        required: Boolean(f.required),
        format: f.format || 'text',
        decimals: f.decimals,
        currency: f.currency,
        dateFormat: f.dateFormat,
        blank: f.blank ?? '',
        inList: isListField(name),
      };
    });
  return { id, dir, name: manifest.name, html, manifest, fields };
}

function listTemplates(htmlDir) {
  if (!fs.existsSync(htmlDir)) return [];
  return fs.readdirSync(htmlDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(htmlDir, d.name, 'template.html')))
    .map((d) => {
      const dir = path.join(htmlDir, d.name);
      try {
        return { id: d.name, name: readManifest(dir).name || d.name, dir };
      } catch (err) {
        return { id: d.name, name: d.name, dir, error: err.message };
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const STARTER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{name}}</title>
  <style>
    /* Page size and margins. Change "Letter" to "A4" or "Legal" if needed. */
    @page { size: Letter; margin: 0; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #222; }
    .page { width: 8.5in; min-height: 11in; padding: 1in; box-sizing: border-box; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ccc; }
  </style>
</head>
<body>
  <section class="page">
    <h1>Hello, {{name}}</h1>
    <p>Each double-brace field is filled from the data column with the same name.</p>
    <table>
      <tr><th>Item</th><th>Amount</th></tr>
      {{#rows}}<tr><td>{{item}}</td><td>{{amount}}</td></tr>{{/rows}}
    </table>
  </section>
</body>
</html>
`;

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function createTemplate(htmlDir, displayName) {
  const id = slugify(displayName);
  if (!id) throw new TemplateError('Template name must contain letters or numbers.');
  const dir = path.join(htmlDir, id);
  if (fs.existsSync(dir)) throw new TemplateError(`A template folder named "${id}" already exists.`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'template.html'), STARTER_HTML);
  const manifest = {
    name: displayName,
    filename: '{{name}}',
    groupBy: 'name',
    list: 'rows',
    fields: {
      name: { label: 'Name', required: true },
      amount: { label: 'Amount', format: 'currency' },
    },
  };
  fs.writeFileSync(path.join(dir, 'template.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return id;
}

module.exports = { FORMATS, BUILT_INS, detectFields, loadTemplate, listTemplates, createTemplate, cleanTempFiles };
