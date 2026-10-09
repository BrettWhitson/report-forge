'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeText, detectDelimiter, parseDelimited } = require('../lib/csv');

test('decodeText strips the UTF-8 BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Name\nJosé', 'utf8')]);
  assert.equal(decodeText(buf), 'Name\nJosé');
});

test('decodeText falls back to Windows-1252', () => {
  const buf = Buffer.from([0x4a, 0x6f, 0x73, 0xe9, 0x20, 0x80]); // "José €" in cp1252
  assert.equal(decodeText(buf), 'José €');
});

test('detectDelimiter picks the most frequent candidate outside quotes', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a|b|c'), '|');
  assert.equal(detectDelimiter('"x,y";b;c'), ';');
});

test('parseDelimited handles quotes, escaped quotes, CRLF, and embedded newlines', () => {
  const rows = parseDelimited('a,b\r\n"x, y","he said ""hi"""\n"multi\nline",2\n', ',');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', '2']]);
});
