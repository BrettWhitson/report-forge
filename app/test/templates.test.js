'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { detectFields, loadTemplate, listTemplates, createTemplate, cleanTempFiles } = require('../lib/templates');
const { TemplateError } = require('../lib/render');
const { tempDir } = require('./helpers');

const HTML_DIR = path.join(__dirname, '..', '..', 'html');

function makeTemplate(root, id, html, manifest) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'template.html'), html);
  if (manifest !== undefined) fs.writeFileSync(path.join(dir, 'template.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return dir;
}

test('detectFields finds top-level fields and list sections, ignoring built-ins', () => {
  const r = detectFields('{{name}} {{{bio}}} {{recordNumber}} {{#items}}{{title}} {{price}}{{/items}} {{^empty}}x{{/empty}}');
  assert.deepEqual(r.fields, ['name', 'bio', 'empty']);
  assert.deepEqual(r.lists, { items: ['title', 'price'] });
});

test('detectFields reports template errors', () => {
  assert.throws(() => detectFields('{{#items}}'), TemplateError);
});

test('loads the statement template with manifest settings', () => {
  const t = loadTemplate(path.join(HTML_DIR, 'grouped-report'));
  assert.equal(t.id, 'grouped-report');
  assert.equal(t.name, 'Grouped Report');
  assert.equal(t.manifest.groupBy, 'contactId');
  assert.equal(t.manifest.list, 'funds');
  const byName = Object.fromEntries(t.fields.map((f) => [f.name, f]));
  assert.equal(byName.contactName.inList, false);
  assert.equal(byName.contactName.required, true);
  assert.equal(byName.auditedBalance.inList, true);
  assert.equal(byName.auditedBalance.format, 'currency');
  assert.equal(byName.contactId.inList, false);
  assert.equal(byName.fundsAwarded.blank, '');
  assert.equal(byName.projectCode.inList, true);
});

test('template without manifest gets defaults; every field is optional text', () => {
  const root = tempDir();
  const t = loadTemplate(makeTemplate(root, 'plain', '<p>{{name}} {{city}}</p>'));
  assert.equal(t.name, 'plain');
  assert.equal(t.manifest.filename, '{{templateName}} - {{recordNumber}}');
  assert.equal(t.manifest.groupBy, null);
  assert.deepEqual(t.fields.map((f) => [f.name, f.label, f.format, f.required, f.inList]), [
    ['name', 'name', 'text', false, false],
    ['city', 'city', 'text', false, false],
  ]);
});

test('invalid manifest JSON and unknown formats are template errors', () => {
  const root = tempDir();
  assert.throws(() => loadTemplate(makeTemplate(root, 'a', '{{x}}', '{bad')), /template\.json/);
  assert.throws(() => loadTemplate(makeTemplate(root, 'b', '{{x}}', { fields: { x: { format: 'money' } } })), /unknown format "money"/);
});

test('stale temp files are cleaned on load and never become fields or templates', () => {
  const root = tempDir();
  const dir = makeTemplate(root, 'clean', '{{a}}');
  fs.writeFileSync(path.join(dir, '_render-123.html'), '{{zzz}}');
  fs.writeFileSync(path.join(dir, '_preview-app.html'), '{{zzz}}');
  const t = loadTemplate(dir);
  assert.deepEqual(t.fields.map((f) => f.name), ['a']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['template.html']);
  assert.equal(cleanTempFiles(dir), 0);
});

test('listTemplates lists folders with template.html, sorted by name', () => {
  const root = tempDir();
  makeTemplate(root, 'zeta', '{{a}}', { name: 'Alpha Report' });
  makeTemplate(root, 'beta', '{{a}}');
  fs.mkdirSync(path.join(root, 'not-a-template'));
  fs.writeFileSync(path.join(root, 'loose.html'), 'x');
  assert.deepEqual(listTemplates(root).map((t) => [t.id, t.name]), [['zeta', 'Alpha Report'], ['beta', 'beta']]);
});

test('createTemplate writes a loadable starter template', () => {
  const root = tempDir();
  const id = createTemplate(root, 'Thank You Letter!');
  assert.equal(id, 'thank-you-letter');
  const t = loadTemplate(path.join(root, id));
  assert.equal(t.name, 'Thank You Letter!');
  assert.ok(t.fields.some((f) => f.name === 'name'));
  assert.throws(() => createTemplate(root, 'Thank You Letter!'), /already exists/);
  assert.throws(() => createTemplate(root, '***'), /name/);
});

test('createTemplate can copy an existing template under a new name', () => {
  const root = tempDir();
  const src = makeTemplate(root, 'annual', '<p>{{name}}</p>', { name: 'Annual Report', groupBy: 'name' });
  fs.mkdirSync(path.join(src, 'assets'));
  fs.writeFileSync(path.join(src, 'assets', 'logo.png'), 'png');
  fs.writeFileSync(path.join(src, '_render-1.html'), 'temp');
  const id = createTemplate(root, 'Annual Report 2027', { copyFrom: 'annual' });
  assert.equal(id, 'annual-report-2027');
  const t = loadTemplate(path.join(root, id));
  assert.equal(t.name, 'Annual Report 2027');
  assert.equal(t.manifest.groupBy, 'name');
  assert.equal(fs.readFileSync(path.join(root, id, 'assets', 'logo.png'), 'utf8'), 'png');
  assert.equal(fs.existsSync(path.join(root, id, '_render-1.html')), false);
  assert.equal(loadTemplate(src).name, 'Annual Report');
});

test('copying a template without a manifest creates one with the new name', () => {
  const root = tempDir();
  makeTemplate(root, 'plain', '<p>{{a}}</p>');
  const id = createTemplate(root, 'Plain Copy', { copyFrom: 'plain' });
  const t = loadTemplate(path.join(root, id));
  assert.equal(t.name, 'Plain Copy');
  assert.equal(t.html, '<p>{{a}}</p>');
});

test('copying from an unknown template is an error', () => {
  const root = tempDir();
  assert.throws(() => createTemplate(root, 'X', { copyFrom: 'missing' }), /not found/);
});
