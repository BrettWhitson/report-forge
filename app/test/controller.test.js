'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createController } = require('../main/controller');
const { createSettings } = require('../main/settings');
const { tempDir, writeTinyPdf } = require('./helpers');

const ROOT = path.join(__dirname, '..', '..');
const HTML_DIR = path.join(ROOT, 'html');
const SAMPLE = path.join(__dirname, 'fixtures', 'sample-data.xlsx');

function make(renderPdf = async ({ outPath }) => writeTinyPdf(outPath, 4)) {
  const settings = createSettings(path.join(tempDir(), 's.json'));
  return { c: createController({ htmlDir: HTML_DIR, settings, renderPdf, today: new Date(2026, 9, 8) }), settings };
}

test('statement template + sample workbook → 5 records, nothing missing', () => {
  const { c } = make();
  c.selectTemplate('grouped-report');
  const s = c.loadData(SAMPLE);
  assert.deepEqual(s.missing, []);
  assert.equal(s.data.rowCount, 9);
  assert.deepEqual(s.records.map((r) => [r.title, r.listCount]), [
    ['Mr. and Mrs. Alan Reed - Statement', 1],
    ['Dr. and Mrs. Paul Carter - Statement', 1],
    ['Mr. Sam Whitfield - Statement', 1],
    ['Mr. and Mrs. Eric Lawson - Statement', 2],
    ['Dr. and Mrs. Neil Harmon - Statement', 4],
  ]);
  assert.equal(s.sample.auditedBalance, '$50,000.00');
});

test('mapping changes are saved per template and reused', () => {
  const { c, settings } = make();
  c.selectTemplate('grouped-report');
  c.loadData(SAMPLE);
  const s = c.setMapping({ ...c.status().mapping, contactName: null });
  assert.deepEqual(s.missing, ['Contact Name']);
  assert.equal(s.records.length, 0);
  assert.equal(settings.get('mapping:grouped-report').contactName, null);
});

test('template without manifest: one record per CSV row', () => {
  const { c } = make();
  c.selectTemplate('simple-letter');
  const s = c.loadData(path.join(__dirname, 'fixtures', 'simple.csv'));
  assert.equal(s.records.length, 3);
  assert.equal(s.records[0].title, 'simple-letter - 1');
});

test('preview writes a temp file inside the template folder', () => {
  const { c } = make();
  c.selectTemplate('grouped-report');
  c.loadData(SAMPLE);
  const file = c.previewFile(4);
  assert.equal(path.dirname(file), path.join(HTML_DIR, 'grouped-report'));
  assert.match(fs.readFileSync(file, 'utf8'), /Dr\. and Mrs\. Neil Harmon/);
  fs.rmSync(file);
});

test('generate uses the chosen output folder and selected indices', async () => {
  const { c } = make();
  c.selectTemplate('grouped-report');
  c.loadData(SAMPLE);
  const out = tempDir();
  c.setOutputDir(out);
  const result = await c.generate({ indices: [0, 4], combine: true });
  assert.equal(result.created.length, 2);
  assert.ok(fs.existsSync(path.join(out, 'Grouped Report - Combined.pdf')));
});

test('generate without an output folder is an error', async () => {
  const { c } = make();
  c.selectTemplate('grouped-report');
  c.loadData(SAMPLE);
  await assert.rejects(c.generate({ indices: null, combine: false }), /output folder/);
});

test('bad data file is reported in status, not thrown', () => {
  const { c } = make();
  c.selectTemplate('grouped-report');
  const s = c.loadData(path.join(tempDir(), 'missing.xlsx'));
  assert.match(s.dataError, /not found/);
  assert.equal(s.data, null);
});
