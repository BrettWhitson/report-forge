'use strict';
// Runs the statement template's chart script against a minimal fake DOM, to check that
// window.reportReady always settles: resolves on good data, rejects on bad data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TEMPLATE = path.join(__dirname, '..', '..', 'html', 'grouped-report', 'template.html');

function chartScript() {
  const html = fs.readFileSync(TEMPLATE, 'utf8');
  const match = html.match(/<script>\s*(\/\/ Draws each \.chart[\s\S]*?)<\/script>/);
  assert.ok(match, 'chart drawing script not found in template.html');
  return match[1];
}

function fakeNode() {
  return { setAttribute() {}, appendChild() {}, textContent: '' };
}

function runWithChartData(json) {
  const box = { getAttribute: () => 'awarded', clientWidth: 330, clientHeight: 116, appendChild() {} };
  const document = {
    fonts: { ready: Promise.resolve() },
    getElementById: () => ({ textContent: json }),
    querySelectorAll: () => [box],
    createElementNS: () => fakeNode(),
  };
  const window = {};
  vm.runInNewContext(chartScript(), { window, document, Promise, JSON, Object });
  return window.reportReady;
}

const withTimeout = (promise) => Promise.race([
  promise.then(() => 'resolved', (err) => `rejected: ${err.message}`),
  new Promise((r) => setTimeout(() => r('pending'), 500)),
]);

const good = JSON.stringify({ awarded: { unit: 'mil', min: 3, max: 6, step: 1, prefix: '$',
  points: [{ label: '2020', value: 4 }, { label: '2021', value: 5, show: true }] } });

test('reportReady resolves with valid chart data', async () => {
  assert.equal(await withTimeout(runWithChartData(good)), 'resolved');
});

test('reportReady rejects when chart data is not valid JSON', async () => {
  const result = await withTimeout(runWithChartData('{ "awarded": { "min": 3, } }'));
  assert.match(result, /^rejected: /);
});

test('reportReady rejects when a chart step is not positive', async () => {
  const bad = good.replace('"step":1', '"step":0');
  const result = await withTimeout(runWithChartData(bad));
  assert.match(result, /^rejected: .*step/);
});

test('reportReady rejects when a chart has fewer than 2 points', async () => {
  const bad = JSON.stringify({ awarded: { unit: 'mil', min: 3, max: 6, step: 1, prefix: '$', points: [{ label: '2020', value: 4 }] } });
  const result = await withTimeout(runWithChartData(bad));
  assert.match(result, /^rejected: .*points/);
});
