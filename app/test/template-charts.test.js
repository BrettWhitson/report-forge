'use strict';
// Runs the sales-summary example's chart script against a minimal fake DOM, to check that
// window.reportReady always settles: resolves on good data (and fills the totals), rejects on bad data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TEMPLATE = path.join(__dirname, '..', '..', 'html', 'sales-summary', 'template.html');

function chartScript() {
  const html = fs.readFileSync(TEMPLATE, 'utf8');
  const match = html.match(/<script>\s*(\/\/ Draws the revenue-versus-quota chart[\s\S]*?)<\/script>/);
  assert.ok(match, 'chart script not found in template.html');
  return match[1];
}

function run(reportData) {
  const totals = ['revenue', 'quota', 'attainment', 'deals'].map((name) => ({ getAttribute: () => name, textContent: '' }));
  const drawn = [];
  const box = { clientWidth: 600, appendChild: (n) => drawn.push(n) };
  const document = {
    fonts: { ready: Promise.resolve() },
    querySelectorAll: () => totals,
    querySelector: () => box,
    createElementNS: () => ({ setAttribute() {}, appendChild() {}, textContent: '' }),
  };
  const window = { reportData };
  vm.runInNewContext(chartScript(), { window, document, Promise, Math, Number, String, Array, Object, isFinite });
  const settle = Promise.race([
    window.reportReady.then(() => 'resolved', (err) => `rejected: ${err.message}`),
    new Promise((r) => setTimeout(() => r('pending'), 500)),
  ]);
  return settle.then((result) => ({ result, totals: Object.fromEntries(totals.map((t) => [t.getAttribute(), t.textContent])), drawn }));
}

const reps = [
  { repName: 'A', deals: 3, revenue: 120000, quota: 100000 },
  { repName: 'B', deals: 2, revenue: 80000, quota: 100000 },
];

test('reportReady resolves with valid data, draws the chart, and fills the totals', async () => {
  const { result, totals, drawn } = await run({ reps });
  assert.equal(result, 'resolved');
  assert.equal(drawn.length, 1);
  assert.deepEqual(totals, { revenue: '$200,000', quota: '$200,000', attainment: '100%', deals: '5' });
});

test('numbers given as text (CSV data) still chart', async () => {
  const { result } = await run({ reps: [{ repName: 'A', deals: '1', revenue: '5000', quota: '4000' }] });
  assert.equal(result, 'resolved');
});

test('reportReady rejects when the region has no rep rows', async () => {
  assert.match((await run({ reps: [] })).result, /^rejected: .*no sales rep rows/);
  assert.match((await run(undefined)).result, /^rejected: /);
});

test('reportReady rejects when revenue is not a number', async () => {
  const { result } = await run({ reps: [{ repName: 'Zed', revenue: '$5,000', quota: 4000 }] });
  assert.match(result, /^rejected: .*Zed/);
});
