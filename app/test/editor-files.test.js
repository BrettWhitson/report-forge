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

test('the first backup plus the newest 19 are kept', () => {
  const dir = tpl({ 'template.html': '<p>x</p>' });
  for (let i = 0; i < 23; i += 1) {
    saveBundle(dir, { html: `<p>${i}</p>`, css: '', settings: '' }, 'template.css', { now: new Date(2026, 9, 10, 9, 0, i) });
  }
  const backups = fs.readdirSync(path.join(dir, '.backups')).sort();
  assert.equal(backups.length, 20);
  assert.equal(backups[0], '2026-10-10_09-00-00', 'the first (pre-editor) backup is always kept');
  assert.equal(backups[1], '2026-10-10_09-00-04');
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

test('stylesheet hrefs outside the template folder are never used', () => {
  const root = tempDir();
  const dir = path.join(root, 'a', 'tpl');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, 'a', 'shared.css'), 'p{shared:1}');
  fs.writeFileSync(path.join(dir, 'template.html'), doc('<link rel="stylesheet" href="../shared.css">', '<p>x</p>'));
  const b = readBundle(dir);
  assert.equal(b.cssFile, 'template.css');
  assert.equal(b.css, '');
  saveBundle(dir, { html: b.html, css: 'p{mine:1}', settings: '' }, b.cssFile);
  assert.equal(fs.readFileSync(path.join(root, 'a', 'shared.css'), 'utf8'), 'p{shared:1}');
  assert.throws(() => saveBundle(dir, { html: b.html, css: '', settings: '' }, '../shared.css'), /outside the template folder/);
  assert.throws(() => saveBundle(dir, { html: b.html, css: '', settings: '' }, 'template.json'), /not a stylesheet/);
});

test('stylesheet hrefs with query strings or encoding resolve to the real file', () => {
  const dir = tpl({ 'template.html': doc('<link rel="stylesheet" href="my%20style.css?v=2#x">', '<p>x</p>'), 'my style.css': 'p{a:1}' });
  const b = readBundle(dir);
  assert.equal(b.cssFile, 'my style.css');
  assert.equal(b.css, 'p{a:1}');
});

test('a failed stylesheet write leaves the template untouched and no temp files', () => {
  const dir = tpl({ 'template.html': doc('<style>p{a:1}</style>', '<p>{{a}}</p>') });
  fs.mkdirSync(path.join(dir, 'template.css')); // a folder where the stylesheet must go: rename onto it fails
  const before = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
  const b = readBundle(dir);
  assert.throws(() => saveBundle(dir, { html: b.html, css: b.css, settings: '' }, 'template-x.css'.replace('-x', '')));
  assert.equal(fs.readFileSync(path.join(dir, 'template.html'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.rf-tmp')), []);
});

test('inline styles keep their media condition when merged', () => {
  const dir = tpl({ 'template.html': doc('<style media="print">p{x:1}</style><style>q{y:2}</style>', '<p>x</p>') });
  const b = readBundle(dir);
  assert.equal(b.css, ['@media print {', 'p{x:1}', '}', '', 'q{y:2}'].join(String.fromCharCode(10)));
});

test('when a stylesheet is linked, inline styles stay in the HTML', () => {
  const dir = tpl({ 'template.html': doc('<style>p{a:1}</style><link rel="stylesheet" href="r.css">', '<p>x</p>'), 'r.css': 'p{a:2}' });
  const b = readBundle(dir);
  assert.equal(b.css, 'p{a:2}');
  assert.match(b.html, /<style>p\{a:1\}<\/style><link/);
});

test('an unlinked template.css is not pulled in; a new stylesheet name is chosen', () => {
  const dir = tpl({ 'template.html': doc('<style>p{a:1}</style>', '<p>x</p>'), 'template.css': 'p{old:1}' });
  const b = readBundle(dir);
  assert.equal(b.cssFile, 'template-1.css');
  assert.equal(b.css, 'p{a:1}');
});

test('saving identical content does not create another backup', () => {
  const dir = tpl({ 'template.html': '<p>x</p>' });
  const first = saveBundle(dir, { html: '<p>y</p>', css: '', settings: '' }, 'template.css', { now: new Date(2026, 9, 10, 9, 0, 0) });
  const second = saveBundle(dir, { html: '<p>y</p>', css: '', settings: '' }, 'template.css', { now: new Date(2026, 9, 10, 9, 0, 5) });
  const third = saveBundle(dir, { html: '<p>y</p>', css: '', settings: '' }, 'template.css', { now: new Date(2026, 9, 10, 9, 0, 9) });
  assert.notEqual(second.backupDir, first.backupDir);
  assert.equal(third.backupDir, second.backupDir, 'unchanged files reuse the newest backup');
  assert.equal(fs.readdirSync(path.join(dir, '.backups')).length, 2);
});

test('pruning never deletes the backup just made or unrelated folders', () => {
  const dir = tpl({ 'template.html': '<p>0</p>' });
  fs.mkdirSync(path.join(dir, '.backups', '!original'), { recursive: true });
  saveBundle(dir, { html: '<p>1</p>', css: '', settings: '' }, 'template.css', { now: new Date(2026, 9, 10, 10, 0, 0), keep: 2 });
  saveBundle(dir, { html: '<p>2</p>', css: '', settings: '' }, 'template.css', { now: new Date(2026, 9, 10, 11, 0, 0), keep: 2 });
  const late = saveBundle(dir, { html: '<p>3</p>', css: '', settings: '' }, 'template.css', { now: new Date(2026, 9, 10, 5, 0, 0), keep: 2 });
  assert.ok(fs.existsSync(late.backupDir), 'backup from a clock set backwards was deleted');
  assert.ok(fs.existsSync(path.join(dir, '.backups', '!original')));
});

test('a bare fragment template reopens with its stylesheet and does not gain extra links', () => {
  const dir = tpl({ 'template.html': '<p>{{a}}</p>' });
  let b = readBundle(dir);
  saveBundle(dir, { html: b.html, css: 'p{color:blue}', settings: '' }, b.cssFile, { now: new Date(2026, 9, 10, 9, 0, 0) });
  b = readBundle(dir);
  assert.equal(b.cssFile, 'template.css');
  assert.equal(b.css, 'p{color:blue}');
  saveBundle(dir, { html: b.html, css: 'p{color:green}', settings: '' }, b.cssFile, { now: new Date(2026, 9, 10, 9, 0, 1) });
  const html = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
  assert.equal((html.match(/<link /g) || []).length, 1);
  assert.equal(fs.existsSync(path.join(dir, 'template-1.css')), false);
});

test('inline styles moved out of a template with an outside stylesheet link stay linked', () => {
  const root = tempDir();
  const dir = path.join(root, 'a', 'tpl');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, 'a', 'shared.css'), 'p{shared:1}');
  fs.writeFileSync(path.join(dir, 'template.html'), doc('<link rel="stylesheet" href="../shared.css"><style>p{own:1}</style>', '<p>x</p>'));
  const b = readBundle(dir);
  assert.equal(b.css, 'p{own:1}');
  saveBundle(dir, b, b.cssFile);
  const html = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
  assert.match(html, /href="\.\.\/shared\.css"/);
  assert.match(html, /<link rel="stylesheet" href="template.css">/);
  assert.equal(fs.readFileSync(path.join(dir, 'template.css'), 'utf8'), 'p{own:1}');
});
