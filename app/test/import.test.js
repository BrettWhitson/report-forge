'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { readTable, ImportError } = require('../lib/import');
const { tempDir } = require('./helpers');

const SAMPLE = path.join(__dirname, '..', '..', 'html', 'invoice', 'sample-data.xlsx');

test('reads the example workbook: headers, typed values, blank cells', () => {
  const t = readTable(SAMPLE);
  assert.deepEqual(t.headers, ['Invoice Number', 'Invoice Date', 'Due Date', 'Customer Name', 'Customer Address', 'Customer City', 'Terms', 'Notes',
    'SKU', 'Description', 'Quantity', 'Unit Price', 'Amount', 'Subtotal', 'Tax', 'Total']);
  assert.equal(t.rows.length, 59);
  assert.equal(t.rows[0]['Customer Name'], 'Bayview Marina');
  assert.equal(t.rows[0].Amount, 154);
  assert.equal(t.rows[8].Terms, null);
  assert.deepEqual(t.rowNumbers.slice(0, 2), [2, 3]);
  assert.equal(t.sheet, t.sheets[0]);
});

function writeWorkbook(file, sheets, bookType) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), name);
  XLSX.writeFile(wb, file, { bookType });
}

test('date cells come back as the same calendar day in UTC', () => {
  const file = path.join(tempDir(), 'dates.xlsx');
  writeWorkbook(file, { S: [['When'], [new Date(2026, 9, 6)]] }, 'xlsx');
  const t = readTable(file);
  assert.ok(t.rows[0].When instanceof Date);
  assert.equal(t.rows[0].When.toISOString().slice(0, 10), '2026-10-06');
});

test('multi-sheet workbooks list sheets and read the chosen one', () => {
  const file = path.join(tempDir(), 'multi.xlsx');
  writeWorkbook(file, { First: [['A'], [1]], Second: [['B'], [2], [3]] }, 'xlsx');
  const t = readTable(file, { sheet: 'Second' });
  assert.deepEqual(t.sheets, ['First', 'Second']);
  assert.equal(t.sheet, 'Second');
  assert.deepEqual(t.rows.map((r) => r.B), [2, 3]);
});

test('reads .ods', () => {
  const file = path.join(tempDir(), 'data.ods');
  writeWorkbook(file, { S: [['Name', 'Amount'], ['Ann', 5]] }, 'ods');
  assert.deepEqual(readTable(file).rows, [{ Name: 'Ann', Amount: 5 }]);
});

test('header row is the first non-empty row; duplicate headers get suffixes', () => {
  const file = path.join(tempDir(), 'h.csv');
  fs.writeFileSync(file, '\n\nName,Name,City\nAnn,Annie,Reno\n');
  const t = readTable(file);
  assert.deepEqual(t.headers, ['Name', 'Name (2)', 'City']);
  assert.deepEqual(t.rows[0], { Name: 'Ann', 'Name (2)': 'Annie', City: 'Reno' });
  assert.deepEqual(t.rowNumbers, [4]);
});

test('csv values are trimmed text and blanks are null', () => {
  const file = path.join(tempDir(), 'v.csv');
  fs.writeFileSync(file, 'A;B\n  x ; \n;\n');
  const t = readTable(file);
  assert.deepEqual(t.rows, [{ A: 'x', B: null }]);
});

test('tsv uses tab', () => {
  const file = path.join(tempDir(), 'v.tsv');
  fs.writeFileSync(file, 'A\tB\n1,5\t2\n');
  assert.deepEqual(readTable(file).rows, [{ A: '1,5', B: '2' }]);
});

test('json array of objects', () => {
  const file = path.join(tempDir(), 'v.json');
  fs.writeFileSync(file, JSON.stringify([{ a: ' x ', b: 2 }, { b: 3, c: true }]));
  const t = readTable(file);
  assert.deepEqual(t.headers, ['a', 'b', 'c']);
  assert.deepEqual(t.rows, [{ a: 'x', b: 2, c: null }, { a: null, b: 3, c: true }]);
});

test('json that is not an array of objects is rejected', () => {
  const file = path.join(tempDir(), 'bad.json');
  fs.writeFileSync(file, '{"a":1}');
  assert.throws(() => readTable(file), (e) => e instanceof ImportError && /array of objects/.test(e.message));
});

test('unsupported extension and missing file give readable errors', () => {
  assert.throws(() => readTable('x.pdf'), (e) => e instanceof ImportError && /Unsupported file type \.pdf/.test(e.message));
  assert.throws(() => readTable(path.join(tempDir(), 'nope.csv')), (e) => e instanceof ImportError && /not found/.test(e.message));
});

test('workbooks using the 1904 date system (old Mac Excel) read the right calendar day', () => {
  const file = path.join(tempDir(), 'mac.xlsx');
  // 2026-10-10 is serial 46305 in the 1900 system and 46305 - 1462 in the 1904 system.
  const ws = XLSX.utils.aoa_to_sheet([['When'], [46305 - 1462]]);
  ws.A2.z = 'yyyy-mm-dd';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S');
  wb.Workbook = { WBProps: { date1904: true } };
  XLSX.writeFile(wb, file);
  assert.equal(readTable(file).rows[0].When.toISOString().slice(0, 10), '2026-10-10');
});
