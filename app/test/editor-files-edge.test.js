'use strict';
// Edge cases for template saving: settings removal, validation detail, subfolder stylesheets, change detection.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readBundle, validateBundle, saveBundle, changedOnDisk } = require('../main/editor-files');
const { loadTemplate, createTemplate } = require('../lib/templates');
const { tempDir } = require('./helpers');

function tpl(files) {
  const dir = path.join(tempDir(), 'tpl');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

test('clearing Settings removes template.json (a backup keeps the old one)', () => {
  const dir = tpl({ 'template.html': '<p>x</p>', 'template.json': '{"name":"Old"}' });
  const r = saveBundle(dir, { html: '<p>x</p>', css: '', settings: '' }, 'template.css');
  assert.equal(fs.existsSync(path.join(dir, 'template.json')), false);
  assert.equal(fs.readFileSync(path.join(r.backupDir, 'template.json'), 'utf8'), '{"name":"Old"}');
});

test('an unknown format is reported on the line of that field\'s format', () => {
  const settings = '{\n  "fields": {\n    "money": { "label": "money" },\n    "amt": { "format": "money" }\n  }\n}';
  const p = validateBundle({ html: '<p>x</p>', css: '', settings });
  assert.equal(p.line, 4);
});

test('a field definition that is not an object is refused, and loading tolerates it', () => {
  const p = validateBundle({ html: '<p>{{a}}</p>', css: '', settings: '{"fields":{"a":null}}' });
  assert.match(p.message, /Field "a"/);
  const dir = tpl({ 'template.html': '<p>{{a}}</p>', 'template.json': '{"fields":{"a":null}}' });
  assert.doesNotThrow(() => loadTemplate(dir));
});

test('a damaged code-block placeholder or custom delimiters block saving with a clear message', () => {
  assert.match(validateBundle({ html: '<rf-script data-rf-script="%E0%A4%A"></rf-script>', css: '', settings: '' }).message, /code block/i);
  assert.match(validateBundle({ html: '{{=<% %>=}}<p><% a %></p>', css: '', settings: '' }).message, /delimiters/i);
});

test('a stylesheet in a subfolder is backed up and restored at its relative path', () => {
  const dir = tpl({ 'template.html': '<head><link rel="stylesheet" href="css/report.css"></head><body><p>x</p></body>', 'css/report.css': 'p{a:1}' });
  const b = readBundle(dir);
  assert.equal(b.cssFile, 'css/report.css');
  const r = saveBundle(dir, { html: b.html, css: 'p{a:2}', settings: '' }, b.cssFile);
  assert.equal(fs.readFileSync(path.join(r.backupDir, 'css', 'report.css'), 'utf8'), 'p{a:1}');
  assert.equal(fs.readFileSync(path.join(dir, 'css', 'report.css'), 'utf8'), 'p{a:2}');
});

test('change detection uses content, so edits within the same timestamp are still caught', () => {
  const dir = tpl({ 'template.html': '<p>x</p>' });
  const b = readBundle(dir);
  const st = fs.statSync(path.join(dir, 'template.html'));
  fs.writeFileSync(path.join(dir, 'template.html'), '<p>y</p>');
  fs.utimesSync(path.join(dir, 'template.html'), st.atime, st.mtime);
  assert.equal(changedOnDisk(dir, b.cssFile, b.stamps), true);
  const again = readBundle(dir);
  assert.equal(changedOnDisk(dir, again.cssFile, again.stamps), false);
});

test('saving into a template folder that was deleted fails with a clear message', () => {
  const dir = tpl({ 'template.html': '<p>x</p>' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.throws(() => saveBundle(dir, { html: '<p>x</p>', css: '', settings: '' }, 'template.css'), /no longer exists/);
  assert.equal(fs.existsSync(dir), false);
});

test('duplicating a template does not copy its backups', () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'src', '.backups', '2026-10-10_09-00-00'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'template.html'), '<p>{{a}}</p>');
  const id = createTemplate(root, 'Copy', { copyFrom: 'src' });
  assert.equal(fs.existsSync(path.join(root, id, '.backups')), false);
});
