'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecords } = require('../lib/records');

const field = (name, extra = {}) => ({ name, label: extra.label || name, aliases: [], required: false, format: 'text', blank: '', inList: false, ...extra });
const tpl = (manifest, fields) => ({ id: 't', name: manifest.name || 'T', manifest: { name: 'T', locale: 'en-US', filename: '{{templateName}} - {{recordNumber}}', groupBy: null, list: 'rows', ...manifest }, fields });
const TODAY = new Date(2026, 9, 8);

test('ungrouped: one record per row with formatting and built-ins', () => {
  const t = tpl({ filename: '{{name}}' }, [field('name'), field('amount', { format: 'currency' })]);
  const { records, issues } = buildRecords([{ name: 'Ann', amount: 5 }, { name: 'Bo', amount: '1,000' }], [2, 3], t, { today: TODAY });
  assert.deepEqual(issues, []);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].view, { name: 'Ann', amount: '$5.00', recordNumber: 1, recordCount: 2, templateName: 'T', today: 'October 8, 2026' });
  assert.deepEqual(records[0].raw, { name: 'Ann', amount: 5 });
  assert.equal(records[1].title, 'Bo');
  assert.equal(records[0].listCount, null);
});

const groupedFields = [
  field('contactId', { label: 'Contact Id', required: true }),
  field('contactName', { label: 'Contact Name', required: true }),
  field('projectName', { label: 'Project Name', required: true, inList: true }),
  field('auditedBalance', { label: 'Audited Balance', format: 'currency', required: true, inList: true }),
  field('fundsAwarded', { label: 'Funds Awarded', format: 'currency', inList: true }),
];
const grouped = tpl({ name: 'Statement', filename: '{{contactName}} - Statement', groupBy: 'contactId', list: 'funds' }, groupedFields);
const row = (contactId, contactName, projectName, auditedBalance, fundsAwarded = null) => ({ contactId, contactName, projectName, auditedBalance, fundsAwarded });

test('grouped: rows sharing groupBy become one record with a list', () => {
  const rows = [row(1, 'Reed', 'A', 100), row(2, 'Harmon', 'B', 200, 5), row(2, 'Harmon', 'C', 300)];
  const { records } = buildRecords(rows, [2, 3, 4], grouped, { today: TODAY });
  assert.equal(records.length, 2);
  const harmon = records[1];
  assert.equal(harmon.title, 'Harmon - Statement');
  assert.equal(harmon.listCount, 2);
  assert.deepEqual(harmon.view.funds, [
    { projectName: 'B', auditedBalance: '$200.00', fundsAwarded: '$5.00' },
    { projectName: 'C', auditedBalance: '$300.00', fundsAwarded: '' },
  ]);
  assert.deepEqual(harmon.raw.funds[1], { projectName: 'C', auditedBalance: 300, fundsAwarded: null });
  assert.deepEqual(harmon.rowNumbers, [3, 4]);
  assert.equal(harmon.view.contactName, 'Harmon');
});

test('group keys ignore number/text differences', () => {
  const rows = [row(243, 'Reed', 'A', 1), row('243', 'Reed', 'B', 2), row('243.0', 'Reed', 'C', 3)];
  const { records } = buildRecords(rows, [2, 3, 4], grouped);
  assert.equal(records.length, 1);
  assert.equal(records[0].listCount, 3);
});

test('blank groupBy rows are skipped with an issue; fully blank rows silently', () => {
  const rows = [row(null, 'Nobody', 'A', 1), row(null, null, null, null), row(1, 'Reed', 'B', 2)];
  const { records, issues } = buildRecords(rows, [2, 3, 4], grouped);
  assert.equal(records.length, 1);
  assert.deepEqual(issues, ['Row 2: Contact Id is blank, so the row was skipped.']);
});

test('required blank or unparseable values skip the record with warnings', () => {
  const rows = [row(1, null, 'A', 1), row(2, 'Harmon', 'B', 'lots')];
  const { records } = buildRecords(rows, [2, 3], grouped);
  assert.equal(records[0].skipped, true);
  assert.match(records[0].warnings[0], /Row 2: Contact Name is blank/);
  assert.equal(records[1].skipped, true);
  assert.match(records[1].warnings[0], /Row 3: Audited Balance: "lots" is not a number/);
});

test('top-level values that differ inside a group warn but still generate', () => {
  const rows = [row(1, 'Reed', 'A', 1), row(1, 'J. Reed', 'B', 2)];
  const { records } = buildRecords(rows, [2, 3], grouped);
  assert.equal(records[0].skipped, false);
  assert.equal(records[0].view.contactName, 'Reed');
  assert.match(records[0].warnings[0], /Contact Name differs/);
});

test('titles are unique, filesystem-safe, and not HTML-escaped', () => {
  const rows = [row(1, 'A/B', 'X', 1), row(2, 'a/b', 'Y', 1), row(3, 'Smith & Sons', 'Z', 1)];
  const { records } = buildRecords(rows, [2, 3, 4], grouped);
  assert.deepEqual(records.map((r) => r.title), ['AB - Statement', 'ab - Statement (2)', 'Smith & Sons - Statement']);
});

test('raw dates are ISO day strings', () => {
  const t = tpl({}, [field('when', { format: 'date' })]);
  const { records } = buildRecords([{ when: new Date(Date.UTC(2026, 9, 6)) }], [2], t);
  assert.equal(records[0].raw.when, '2026-10-06');
  assert.equal(records[0].view.when, 'October 6, 2026');
});

test('very long numeric ids are never merged by float rounding', () => {
  const rows = [row('12345678901234567891', 'A', 'X', 1), row('12345678901234567892', 'B', 'Y', 1), row('12345678901234567891.0', 'A', 'Z', 1)];
  const { records } = buildRecords(rows, [2, 3, 4], grouped);
  assert.deepEqual(records.map((r) => r.listCount), [2, 1]);
});
