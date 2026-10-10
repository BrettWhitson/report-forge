'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readBundle, validateBundle, saveBundle, changedOnDisk, backupStamp } = require('../main/editor-files');
const { loadTemplate } = require('../lib/templates');
const { tempDir } = require('./helpers');

function tpl(files) {
  const dir = path.join(tempDir(), 'tpl');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
const doc = (head, body) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

test('backupStamp format', () => {
  assert.equal(backupStamp(new Date(2026, 9, 10, 9, 5, 7)), '2026-10-10_09-05-07');
});

test('readBundle uses the linked stylesheet and template.json', () => {
  const dir = tpl({ 'template.html': doc('<link rel="stylesheet" href="report.css">', '<p>{{a}}</p>'), 'report.css': 'p{color:red}', 'template.json': '{"name":"X"}' });
  const b = readBundle(dir);
  assert.equal(b.cssFile, 'report.css');
  assert.equal(b.css, 'p{color:red}');
  assert.equal(b.settings, '{"name":"X"}');
  assert.match(b.html, /<p>\{\{a\}\}<\/p>/);
});

test('readBundle moves inline head styles into template.css when no stylesheet is linked', () => {
  const dir = tpl({ 'template.html': doc('<style>p{margin:0}</style>', '<p>x</p>') });
  const b = readBundle(dir);
  assert.equal(b.cssFile, 'template.css');
  assert.equal(b.css, 'p{margin:0}');
  assert.doesNotMatch(b.html, /<style/);
  assert.equal(b.settings, '');
});

test('validateBundle reports JSON, format, and Mustache errors with lines', () => {
  const ok = { html: '<p>{{a}}</p>', css: '', settings: '' };
  assert.equal(validateBundle(ok), null);
  const badJson = validateBundle({ ...ok, settings: '{\n  "name": "x",\n}' });
  assert.equal(badJson.tab, 'settings');
  assert.equal(badJson.line, 3);
  const badFormat = validateBundle({ ...ok, settings: '{"fields":{"a":{"format":"money"}}}' });
  assert.match(badFormat.message, /unknown format "money"/);
  const badTag = validateBundle({ ...ok, html: '<p>\n\n{{#funds}}</p>' });
  assert.equal(badTag.tab, 'html');
  assert.equal(badTag.line, 3);
  assert.match(badTag.message, /Unclosed section/);
});

test('saveBundle backs up, writes atomically, links template.css, and stays loadable', () => {
  const dir = tpl({ 'template.html': doc('<style>p{margin:0}</style>', '<p>{{a}}</p>') });
  const b = readBundle(dir);
  const result = saveBundle(dir, { html: b.html.replace('{{a}}', '{{a}} edited'), css: b.css, settings: '' }, b.cssFile, { now: new Date(2026, 9, 10, 9, 0, 0) });
  assert.equal(path.basename(result.backupDir), '2026-10-10_09-00-00');
  assert.match(fs.readFileSync(path.join(result.backupDir, 'template.html'), 'utf8'), /<style>/);
  const html = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="template.css">/);
  assert.match(html, /edited/);
  assert.equal(fs.readFileSync(path.join(dir, 'template.css'), 'utf8'), 'p{margin:0}');
  assert.equal(fs.existsSync(path.join(dir, 'template.json')), false);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.rf-tmp')), []);
  assert.deepEqual(loadTemplate(dir).fields.map((f) => f.name), ['a']);
});

test('saving a bare fragment template adds a stylesheet link and keeps it loadable', () => {
  const dir = tpl({ 'template.html': '<p>{{a}}</p>' });
  const b = readBundle(dir);
  saveBundle(dir, { html: b.html, css: 'p{color:blue}', settings: '' }, b.cssFile);
  assert.equal(fs.readFileSync(path.join(dir, 'template.html'), 'utf8'), '<link rel="stylesheet" href="template.css">\n<p>{{a}}</p>');
  assert.equal(fs.readFileSync(path.join(dir, 'template.css'), 'utf8'), 'p{color:blue}');
});

test('two saves in the same second get separate backups', () => {
  const dir = tpl({ 'template.html': '<p>{{a}}</p>' });
  const now = new Date(2026, 9, 10, 9, 0, 0);
  const first = saveBundle(dir, { html: '<p>1</p>', css: '', settings: '' }, 'template.css', { now });
  const second = saveBundle(dir, { html: '<p>2</p>', css: '', settings: '' }, 'template.css', { now });
  assert.notEqual(first.backupDir, second.backupDir);
  assert.match(fs.readFileSync(path.join(second.backupDir, 'template.html'), 'utf8'), /<p>1<\/p>/);
});

test('only the newest 20 backups are kept', () => {
  const dir = tpl({ 'template.html': '<p>x</p>' });
  for (let i = 0; i < 23; i += 1) {
    saveBundle(dir, { html: `<p>${i}</p>`, css: '', settings: '' }, 'template.css', { now: new Date(2026, 9, 10, 9, 0, i) });
  }
  const backups = fs.readdirSync(path.join(dir, '.backups')).sort();
  assert.equal(backups.length, 20);
  assert.equal(backups[0], '2026-10-10_09-00-03');
});

test('an invalid bundle is rejected before anything is written', () => {
  const dir = tpl({ 'template.html': '<p>{{a}}</p>' });
  assert.throws(() => saveBundle(dir, { html: '{{#x}}', css: '', settings: '' }, 'template.css'), (e) => e.name === 'EditorSaveError' && e.detail.tab === 'html');
  assert.equal(fs.readFileSync(path.join(dir, 'template.html'), 'utf8'), '<p>{{a}}</p>');
  assert.equal(fs.existsSync(path.join(dir, '.backups')), false);
});

test('changedOnDisk detects edits made outside the editor', () => {
  const dir = tpl({ 'template.html': '<p>x</p>' });
  const b = readBundle(dir);
  assert.equal(changedOnDisk(dir, b.cssFile, b.mtimes), false);
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(path.join(dir, 'template.html'), '<p>y</p>');
  fs.utimesSync(path.join(dir, 'template.html'), later, later);
  assert.equal(changedOnDisk(dir, b.cssFile, b.mtimes), true);
});
