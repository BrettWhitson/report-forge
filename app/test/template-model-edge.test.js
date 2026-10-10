'use strict';
// Edge cases for the template model: unusual documents, malformed input, and Mustache in awkward places.
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../lib/template-model');

test('splitDocument uses the last </body>, so a "</body>" string in a script does not cut the body', () => {
  const html = '<html><head></head><body><script>document.write("</body>")</script><p>x</p></body></html>';
  const parts = m.splitDocument(html);
  assert.equal(parts.body, '<script>document.write("</body>")</script><p>x</p>');
  assert.equal(m.joinDocument(parts), html);
});

test('splitDocument ignores a <body> tag inside a head comment', () => {
  const html = '<head><!-- <body> --></head><body class="r"><p>x</p></body>';
  const parts = m.splitDocument(html);
  assert.ok(parts.before.endsWith('<body class="r">'));
  assert.equal(parts.body, '<p>x</p>');
});

test('malformed input is processed in linear time', () => {
  const time = (fn) => { const t = Date.now(); fn(); return Date.now() - t; };
  assert.ok(time(() => m.restore('<rf-script data-rf-script="'.repeat(2000))) < 1000, 'restore on unclosed placeholders');
  assert.ok(time(() => m.protect('{{#'.repeat(50000))) < 1000, 'protect on unclosed tags');
  assert.ok(time(() => m.protect('<script'.repeat(20000))) < 1000, 'protect on unclosed scripts');
  assert.ok(time(() => m.protect('<!--'.repeat(20000))) < 1000, 'protect on unclosed comments');
});

test('a damaged placeholder does not throw and stays visible', () => {
  const damaged = '<rf-script data-rf-script="%E0%A4%A"></rf-script>';
  assert.doesNotThrow(() => m.restore(damaged));
  assert.match(m.restore(damaged), /rf-script/);
});

test('textarea and title content in the body is kept opaque', () => {
  const body = '<textarea>{{#a}}x{{/a}}</textarea><title>{{#b}}y{{/b}}</title><p>{{c}}</p>';
  const p = m.protect(body);
  assert.equal((p.match(/<rf-script /g) || []).length, 2);
  assert.equal(m.restore(p), body);
});

test('partials and Mustache comments become markers too', () => {
  const body = '<p>{{>header}}{{! a note }}</p>';
  const p = m.protect(body);
  assert.match(p, /<!--rf:\{\{>header\}\}-->/);
  assert.match(p, /<!--rf:\{\{! a note \}\}-->/);
  assert.equal(m.restore(p), body);
});

test('any tag directly inside table structure is protected; tags in cells are not', () => {
  const body = '<table><tbody>{{name}}{{{raw}}}<tr><td>{{v}}</td></tr></tbody></table>';
  const p = m.protect(body);
  assert.match(p, /<tbody><!--rf:\{\{name\}\}--><!--rf:\{\{\{raw\}\}\}--><tr>/);
  assert.match(p, /<td>\{\{v\}\}<\/td>/);
  assert.equal(m.restore(p), body);
});

test('script or style inside table structure uses a comment placeholder (survives table parsing)', () => {
  const body = '<table><tbody><script>x()</script><tr><td>a</td></tr></tbody></table><script>y()</script>';
  const p = m.protect(body);
  assert.match(p, /<tbody><!--rf-raw:[^>]*--><tr>/);
  assert.equal((p.match(/<rf-script /g) || []).length, 1);
  assert.equal(m.restore(p), body);
});

test('class attributes containing Mustache tags are parked; plain classes are untouched', () => {
  const body = '<div class="a {{#odd}}odd{{/odd}}">x</div><span class="plain">y</span>';
  const p = m.protect(body);
  assert.match(p, /<div data-rf-class="a \{\{#odd\}\}odd\{\{\/odd\}\}">/);
  assert.match(p, /<span class="plain">/);
  assert.equal(m.restore(p), body);
});

test('parsePageSetup ignores commented-out rules and reads mm sizes with a landscape keyword', () => {
  assert.deepEqual(m.parsePageSetup('/* @page { size: A4 } */ @page { size: Legal }'), { size: 'legal', orientation: 'portrait' });
  assert.deepEqual(m.parsePageSetup('@page { size: 210mm 297mm landscape }'), { size: 'a4', orientation: 'landscape' });
});

test('pageDimensions validates custom sizes and rounds values', () => {
  assert.throws(() => m.pageDimensions({ size: 'custom', orientation: 'portrait', width: 'abc', height: 5, unit: 'in' }), /positive/);
  assert.throws(() => m.pageDimensions({ size: 'custom', orientation: 'portrait', width: 0, height: 5, unit: 'in' }), /positive/);
  assert.throws(() => m.pageDimensions({ size: 'custom', orientation: 'portrait', width: 5, height: 5, unit: 'cm' }), /unit/);
  assert.deepEqual(m.pageDimensions({ size: 'custom', orientation: 'portrait', width: 0.1 + 0.2, height: 5, unit: 'in' }), { width: 0.3, height: 5, unit: 'in' });
});

test('unquoted stylesheet hrefs are recognized', () => {
  assert.equal(m.findStylesheet('<link rel=stylesheet href=report.css>'), 'report.css');
  assert.equal(m.linksStylesheet('<link rel=stylesheet href=report.css>', 'report.css'), true);
});

test('rebaseCssUrls makes stylesheet-relative URLs relative to the template folder', () => {
  const css = 'a{background:url(../img/x.png)} b{src:url("f.woff2")} c{u:url(data:x)} d{u:url(/abs.png)} e{u:url(#id)} f{u:url(\'sub/g.png\')}';
  assert.equal(m.rebaseCssUrls(css, 'css'), 'a{background:url(img/x.png)} b{src:url("css/f.woff2")} c{u:url(data:x)} d{u:url(/abs.png)} e{u:url(#id)} f{u:url(\'css/sub/g.png\')}');
  assert.equal(m.rebaseCssUrls(css, ''), css);
});

test('inlineStylesheet replaces a link even when its href carries a query string', () => {
  const html = '<head><link rel="stylesheet" href="report.css?v=2"></head>';
  assert.equal(m.inlineStylesheet(html, 'report.css', 'p{}'), '<head><style>p{}</style></head>');
});
