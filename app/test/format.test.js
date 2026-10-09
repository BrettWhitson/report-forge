'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isBlank, parseNumber, parseDate, formatDate, formatValue, safeFilename } = require('../lib/format');

test('isBlank', () => {
  assert.equal(isBlank(null), true);
  assert.equal(isBlank(undefined), true);
  assert.equal(isBlank('  '), true);
  assert.equal(isBlank(0), false);
  assert.equal(isBlank('x'), false);
});

test('parseNumber handles numbers, text, blanks, and junk', () => {
  assert.equal(parseNumber(1250), 1250);
  assert.equal(parseNumber('$1,250.50'), 1250.5);
  assert.equal(parseNumber(' 1 250 '), 1250);
  assert.equal(parseNumber('(1,250.00)'), -1250);
  assert.equal(parseNumber('-3'), -3);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber(null), null);
  assert.ok(Number.isNaN(parseNumber('abc')));
  assert.ok(Number.isNaN(parseNumber('1.2.3')));
});

test('parseDate converts Excel serials without time zone shift', () => {
  const d = parseDate(46301); // 2026-10-06
  assert.equal(d.toISOString().slice(0, 10), '2026-10-06');
});

test('parseDate accepts ISO and US text dates, rejects junk', () => {
  assert.equal(parseDate('2026-10-06').toISOString().slice(0, 10), '2026-10-06');
  assert.equal(parseDate('10/6/2026').toISOString().slice(0, 10), '2026-10-06');
  assert.equal(parseDate('October 6, 2026').toISOString().slice(0, 10), '2026-10-06');
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('not a date'), 'invalid');
});

test('formatDate tokens', () => {
  const d = new Date(Date.UTC(2026, 9, 6));
  assert.equal(formatDate(d, 'MMMM d, yyyy', 'en-US'), 'October 6, 2026');
  assert.equal(formatDate(d, 'MM/dd/yyyy', 'en-US'), '10/06/2026');
  assert.equal(formatDate(d, 'MMM d', 'en-US'), 'Oct 6');
});

test('formatValue currency', () => {
  const spec = { format: 'currency' };
  assert.deepEqual(formatValue(50000, spec, 'en-US'), { text: '$50,000.00' });
  assert.deepEqual(formatValue(185362.26, spec, 'en-US'), { text: '$185,362.26' });
  assert.deepEqual(formatValue(-1250, spec, 'en-US'), { text: '-$1,250.00' });
  assert.deepEqual(formatValue('$1,000', spec, 'en-US'), { text: '$1,000.00' });
  assert.deepEqual(formatValue(1000, { format: 'currency', decimals: 0 }, 'en-US'), { text: '$1,000' });
});

test('formatValue blank uses the blank text', () => {
  assert.deepEqual(formatValue(null, { format: 'currency' }, 'en-US'), { text: '' });
  assert.deepEqual(formatValue('', { format: 'currency', blank: '—' }, 'en-US'), { text: '—' });
});

test('formatValue reports unparseable values', () => {
  const r = formatValue('abc', { format: 'currency' }, 'en-US');
  assert.match(r.error, /not a number/);
});

test('formatValue number, percent, date, text', () => {
  assert.deepEqual(formatValue(1234.5, { format: 'number' }, 'en-US'), { text: '1,235' });
  assert.deepEqual(formatValue(0.05, { format: 'percent' }, 'en-US'), { text: '5%' });
  assert.deepEqual(formatValue('5%', { format: 'percent' }, 'en-US'), { text: '5%' });
  assert.deepEqual(formatValue(46301, { format: 'date' }, 'en-US'), { text: 'October 6, 2026' });
  assert.deepEqual(formatValue(243, {}, 'en-US'), { text: '243' });
  assert.deepEqual(formatValue('  hi  ', { format: 'text' }, 'en-US'), { text: 'hi' });
  assert.match(formatValue('nope', { format: 'date' }, 'en-US').error, /not a date/);
});

test('safeFilename strips illegal characters and trailing dots', () => {
  assert.equal(safeFilename('A/B:C*D?"E<F>G|H', new Set()), 'ABCDEFGH');
  assert.equal(safeFilename('Name. . ', new Set()), 'Name');
  assert.equal(safeFilename('   ', new Set()), 'document');
  assert.equal(safeFilename('CON', new Set()), '_CON');
});

test('safeFilename de-duplicates case-insensitively', () => {
  const used = new Set();
  assert.equal(safeFilename('Smith', used), 'Smith');
  assert.equal(safeFilename('smith', used), 'smith (2)');
  assert.equal(safeFilename('Smith', used), 'Smith (3)');
});
