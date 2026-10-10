'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { isAllowedUrl } = require('../lib/url-scope');

const root = path.resolve('C:/RF/app/editor');
const tpl = path.resolve('C:/RF/html/letter');
const url = (p) => pathToFileURL(path.resolve(p)).href;

test('files inside an allowed folder load', () => {
  assert.equal(isAllowedUrl(url('C:/RF/app/editor/index.html'), [root, tpl]), true);
  assert.equal(isAllowedUrl(url('C:/RF/html/letter/fonts/a.woff2'), [root, tpl]), true);
});

test('files outside the allowed folders are refused, including look-alike prefixes and ../', () => {
  assert.equal(isAllowedUrl(url('C:/Users/me/secret.txt'), [root, tpl]), false);
  assert.equal(isAllowedUrl(url('C:/RF/html/letter-other/x.css'), [root, tpl]), false);
  assert.equal(isAllowedUrl('file:///C:/RF/html/letter/../other/x.css', [root, tpl]), false);
});

test('data, blob, and devtools URLs are allowed; network URLs are not', () => {
  assert.equal(isAllowedUrl('data:text/plain,hi', []), true);
  assert.equal(isAllowedUrl('blob:file:///abc', []), true);
  assert.equal(isAllowedUrl('devtools://devtools/x', []), true);
  assert.equal(isAllowedUrl('https://example.com/', [root]), false);
  assert.equal(isAllowedUrl('file://server/share/x.css', [root]), false);
});
