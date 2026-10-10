'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const m = require('../lib/template-model');

const DOC = '<!doctype html>\n<html><head><title>t</title><link rel="stylesheet" href="report.css"></head>\n<body class="x">\n<p>{{name}}</p>\n</body>\n</html>\n';

test('splitDocument and joinDocument round-trip', () => {
  const parts = m.splitDocument(DOC);
  assert.equal(parts.body, '\n<p>{{name}}</p>\n');
  assert.ok(parts.before.endsWith('<body class="x">'));
  assert.ok(parts.after.startsWith('</body>'));
  assert.equal(m.joinDocument(parts), DOC);
});

test('fragment without body is all body', () => {
  assert.deepEqual(m.splitDocument('<p>x</p>'), { before: '', body: '<p>x</p>', after: '' });
});

test('protect turns section tags into comment markers and restore reverses it', () => {
  const body = '<table><tbody>{{#funds}}<tr><td>{{projectName}}</td></tr>{{/funds}}{{^funds}}<tr><td>none</td></tr>{{/funds}}</tbody></table>';
  const p = m.protect(body);
  assert.match(p, /<tbody><!--rf:\{\{#funds\}\}--><tr>/);
  assert.match(p, /<!--rf:\{\{\/funds\}\}--><!--rf:\{\{\^funds\}\}-->/);
  assert.match(p, /\{\{projectName\}\}/);
  assert.equal(m.restore(p), body);
});

test('protect leaves tags inside existing comments alone', () => {
  const body = '<!-- old: {{#x}}y{{/x}} --><p>{{#a}}b{{/a}}</p>';
  const p = m.protect(body);
  assert.ok(p.startsWith('<!-- old: {{#x}}y{{/x}} -->'));
  assert.equal(m.restore(p), body);
});

test('scripts become opaque placeholders and come back byte for byte', () => {
  const script = '<script id="chart-data" type="application/json">\n{"a": "<b>&\\"x\\""}\n</script>';
  const body = `<p>hi</p>${script}<script>window.x = 1 < 2 && "{{#no}}";</script>`;
  const p = m.protect(body);
  assert.equal((p.match(/<rf-script /g) || []).length, 2);
  assert.doesNotMatch(p, /<script/);
  assert.doesNotMatch(p, /\{\{#no\}\}/);
  assert.equal(m.restore(p), body);
});

test('restore tolerates extra attributes on placeholders', () => {
  const p = m.protect('<script>a()</script>').replace('<rf-script ', '<rf-script id="i9" ');
  assert.equal(m.restore(p), '<script>a()</script>');
});

test('the statement template body survives protect/restore exactly', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'html', 'grouped-report', 'template.html'), 'utf8');
  const { body } = m.splitDocument(html);
  assert.equal(m.restore(m.protect(body)), body);
});

test('extractHeadStyles moves inline styles out of the head', () => {
  const r = m.extractHeadStyles('<html><head><style>a{b:c}</style>\n<style>d{e:f}</style></head><body>');
  assert.equal(r.before, '<html><head></head><body>');
  assert.equal(r.css, 'a{b:c}\n\nd{e:f}');
});

test('findStylesheet finds the first relative stylesheet in either attribute order', () => {
  assert.equal(m.findStylesheet('<link href="report.css" rel="stylesheet">'), 'report.css');
  assert.equal(m.findStylesheet('<link rel="stylesheet" href="https://x/y.css"><link rel=stylesheet href=\'a.css\'>'), 'a.css');
  assert.equal(m.findStylesheet('<head></head>'), null);
});

test('ensureStylesheetLink adds a link before </head>, or prepends for fragments', () => {
  assert.equal(m.ensureStylesheetLink('<head></head><body>', 'template.css'), '<head>  <link rel="stylesheet" href="template.css">\n</head><body>');
  assert.equal(m.ensureStylesheetLink('', 'template.css'), '<link rel="stylesheet" href="template.css">\n');
  assert.equal(m.ensureStylesheetLink('<link rel="stylesheet" href="r.css">', 'template.css'), '<link rel="stylesheet" href="r.css">');
});

test('inlineStylesheet swaps the link for a style block', () => {
  const html = '<head><link rel="stylesheet" href="report.css"></head><body></body>';
  assert.equal(m.inlineStylesheet(html, 'report.css', 'p{}'), '<head><style>p{}</style></head><body></body>');
  assert.equal(m.inlineStylesheet('<head></head>', 'x.css', 'p{}'), '<head><style>p{}</style></head>');
  assert.equal(m.inlineStylesheet('<p>x</p>', 'x.css', 'p{}'), '<style>p{}</style><p>x</p>');
});

test('pageDimensions handles sizes and orientation', () => {
  assert.deepEqual(m.pageDimensions({ size: 'letter', orientation: 'portrait' }), { width: 8.5, height: 11, unit: 'in' });
  assert.deepEqual(m.pageDimensions({ size: 'a4', orientation: 'landscape' }), { width: 297, height: 210, unit: 'mm' });
  assert.deepEqual(m.pageDimensions({ size: 'custom', orientation: 'portrait', width: 5, height: 7, unit: 'in' }), { width: 5, height: 7, unit: 'in' });
});

test('applyPageSetup appends a managed block once and replaces it after', () => {
  const css1 = m.applyPageSetup('body{margin:0}', { size: 'legal', orientation: 'portrait' });
  assert.ok(css1.startsWith('body{margin:0}'));
  assert.match(css1, /@page \{ size: 8\.5in 14in; margin: 0; \}/);
  assert.match(css1, /\.page \{ position: relative; width: 8\.5in; height: 14in;/);
  const css2 = m.applyPageSetup(css1, { size: 'a4', orientation: 'landscape' });
  assert.equal((css2.match(/Report Forge page setup/g) || []).length, 1);
  assert.match(css2, /size: 297mm 210mm/);
  assert.doesNotMatch(css2, /14in/);
});

test('parsePageSetup reads the managed block, plain @page rules, or defaults to Letter portrait', () => {
  const managed = m.applyPageSetup('', { size: 'letter', orientation: 'landscape' });
  assert.deepEqual(m.parsePageSetup(managed), { size: 'letter', orientation: 'landscape' });
  assert.deepEqual(m.parsePageSetup('@page { size: A4; margin: 0 }'), { size: 'a4', orientation: 'portrait' });
  assert.deepEqual(m.parsePageSetup('@page { size: Legal landscape }'), { size: 'legal', orientation: 'landscape' });
  assert.deepEqual(m.parsePageSetup('@page { size: 5in 7in }'), { size: 'custom', orientation: 'portrait', width: 5, height: 7, unit: 'in' });
  assert.deepEqual(m.parsePageSetup('p{}'), { size: 'letter', orientation: 'portrait' });
});
