'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderHtml, TemplateError } = require('../lib/render');

const page = (body) => `<html><head><title>t</title></head><body>${body}</body></html>`;

test('substitutes top-level fields', () => {
  const out = renderHtml(page('<p>{{contactName}}</p>'), { view: { contactName: 'Mr. Sam Whitfield' } });
  assert.match(out, /<p>Mr\. Sam Whitfield<\/p>/);
});

test('repeats list sections once per row', () => {
  const view = { funds: [{ projectName: 'A' }, { projectName: 'B' }, { projectName: 'C' }] };
  const out = renderHtml(page('<table>{{#funds}}<tr><td>{{projectName}}</td></tr>{{/funds}}</table>'), { view });
  assert.equal((out.match(/<tr>/g) || []).length, 3);
  assert.ok(out.indexOf('>A<') < out.indexOf('>B<') && out.indexOf('>B<') < out.indexOf('>C<'));
});

test('escapes HTML in values', () => {
  const out = renderHtml(page('<p>{{contactName}}</p>'), { view: { contactName: `Smith & Sons <O'Brien>` } });
  assert.match(out, /Smith &amp; Sons &lt;O&#39;Brien&gt;/);
  assert.doesNotMatch(out, /<O'Brien>/);
});

test('blank values render empty', () => {
  const out = renderHtml(page('<td>{{fundsAwarded}}</td>'), { view: { fundsAwarded: '' } });
  assert.match(out, /<td><\/td>/);
});

test('injects raw data before </head>', () => {
  const out = renderHtml(page(''), { view: { a: 'x' }, raw: { a: 1 } });
  const head = out.slice(0, out.indexOf('</head>'));
  assert.match(head, /<script>window\.reportData = \{"a":1\};<\/script>/);
});

test('falls back to view when raw is missing', () => {
  const out = renderHtml(page(''), { view: { a: 'x' } });
  assert.match(out, /window\.reportData = \{"a":"x"\}/);
});

test('injected data cannot close the script tag', () => {
  const out = renderHtml(page(''), { view: { projectName: '</script><script>alert(1)</script>' } });
  const script = out.slice(out.indexOf('<script>window.reportData'), out.indexOf('</head>'));
  assert.equal((script.match(/<\/script>/g) || []).length, 1);
  assert.ok(script.includes(String.fromCharCode(92) + "u003c/script>"));
});

test('injects at start when there is no head', () => {
  const out = renderHtml('<p>{{a}}</p>', { view: { a: 'x' } });
  assert.ok(out.startsWith('<script>window.reportData'));
  assert.match(out, /<p>x<\/p>$/);
});

test('unclosed section throws TemplateError', () => {
  assert.throws(
    () => renderHtml(page('{{#funds}}<tr></tr>'), { view: { funds: [] } }),
    (err) => err instanceof TemplateError && err.name === 'TemplateError' && /^Template error: /.test(err.message),
  );
});
