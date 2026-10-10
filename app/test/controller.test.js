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
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'templates');
const SAMPLE = path.join(HTML_DIR, 'invoice', 'sample-data.xlsx');

function make(renderPdf = async ({ outPath }) => writeTinyPdf(outPath, 4), htmlDir = HTML_DIR) {
  const settings = createSettings(path.join(tempDir(), 's.json'));
  return { c: createController({ htmlDir, settings, renderPdf, today: new Date(2026, 9, 8) }), settings };
}

const makeLetters = () => make(undefined, FIXTURE_DIR);

test('grouped template + sample workbook → one record per invoice, nothing missing', () => {
  const { c } = make();
  c.selectTemplate('invoice');
  const s = c.loadData(SAMPLE);
  assert.deepEqual(s.missing, []);
  assert.equal(s.data.rowCount, 59);
  assert.deepEqual(s.records.map((r) => [r.title, r.listCount]), [
    ['Invoice INV-2026-0141 - Bayview Marina', 3],
    ['Invoice INV-2026-0142 - Lindqvist Boatworks', 5],
    ['Invoice INV-2026-0147 - Mara Okafor', 1],
    ['Invoice INV-2026-0150 - Tidewater Rowing Club', 8],
    ['Invoice INV-2026-0153 - North Cove Harbor Authority', 42],
  ]);
  assert.equal(s.sample.amount, '$154.00');
  assert.equal(s.sample.invoiceDate, 'Sep 2, 2026');
});

test('mapping changes are saved per template and reused', () => {
  const { c, settings } = make();
  c.selectTemplate('invoice');
  c.loadData(SAMPLE);
  const s = c.setMapping({ ...c.status().mapping, customerName: null });
  assert.deepEqual(s.missing, ['Customer Name']);
  assert.equal(s.records.length, 0);
  assert.equal(settings.get('mapping:invoice').customerName, null);
});

test('template without manifest: one record per CSV row', () => {
  const { c } = makeLetters();
  c.selectTemplate('simple-letter');
  const s = c.loadData(path.join(__dirname, 'fixtures', 'simple.csv'));
  assert.equal(s.records.length, 3);
  assert.equal(s.records[0].title, 'simple-letter - 1');
});

test('preview writes a temp file inside the template folder', () => {
  const { c } = make();
  c.selectTemplate('invoice');
  c.loadData(SAMPLE);
  const file = c.previewFile(4);
  assert.equal(path.dirname(file), path.join(HTML_DIR, 'invoice'));
  assert.match(fs.readFileSync(file, 'utf8'), /North Cove Harbor Authority/);
  fs.rmSync(file);
});

test('generate uses the chosen output folder and selected indices', async () => {
  const { c } = make();
  c.selectTemplate('invoice');
  c.loadData(SAMPLE);
  const out = tempDir();
  c.setOutputDir(out);
  const result = await c.generate({ indices: [0, 4], combine: true });
  assert.equal(result.created.length, 2);
  assert.ok(fs.existsSync(path.join(out, 'Invoice - Combined.pdf')));
});

test('generate without an output folder is an error', async () => {
  const { c } = make();
  c.selectTemplate('invoice');
  c.loadData(SAMPLE);
  await assert.rejects(c.generate({ indices: null, combine: false }), /output folder/);
});

test('bad data file is reported in status, not thrown', () => {
  const { c } = make();
  c.selectTemplate('invoice');
  const s = c.loadData(path.join(tempDir(), 'missing.xlsx'));
  assert.match(s.dataError, /not found/);
  assert.equal(s.data, null);
});

const NL = String.fromCharCode(10);

test('setMapping merges single-field changes and ignores unknown fields', () => {
  const { c, settings } = makeLetters();
  c.selectTemplate('simple-letter');
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'a.csv'), ['Full Name', 'Ann', ''].join(NL));
  fs.writeFileSync(path.join(dir, 'b.csv'), ['Full Name,city', 'Bo,Reno', ''].join(NL));
  c.loadData(path.join(dir, 'a.csv'));
  c.setMapping({ name: 'Full Name' });
  c.setMapping({ city: null });
  c.setMapping({ city: 'Full Name' });
  c.setMapping({ city: null, other: 'x' });
  assert.deepEqual(settings.get('mapping:simple-letter'), { name: 'Full Name', city: null });
  const s = c.loadData(path.join(dir, 'b.csv'));
  assert.equal(s.mapping.city, null); // the user explicitly chose "not mapped" for city above
  assert.equal(s.mapping.name, 'Full Name');
});

test('status lists optional fields that are not mapped', () => {
  const { c } = makeLetters();
  c.selectTemplate('simple-letter');
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'a.csv'), ['name', 'Ann', ''].join(NL));
  const s = c.loadData(path.join(dir, 'a.csv'));
  assert.deepEqual(s.unmapped, ['city']);
});

test('unknown template ids are rejected', () => {
  const { c } = make();
  assert.throws(() => c.selectTemplate(path.join('..', '..', 'Windows')), /Unknown template/);
});

test('a second generate while one is running is rejected', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { c } = make(async ({ outPath }) => { await gate; await writeTinyPdf(outPath, 1); });
  c.selectTemplate('invoice');
  c.loadData(SAMPLE);
  c.setOutputDir(tempDir());
  const first = c.generate({ indices: [0] });
  await assert.rejects(c.generate({ indices: [1] }), /already running/);
  release();
  assert.equal((await first).created.length, 1);
});

test('outputDir is exposed for opening the folder', () => {
  const { c } = make();
  c.selectTemplate('invoice');
  const dir = tempDir();
  c.setOutputDir(dir);
  assert.equal(c.status().outputDir, dir);
});

test('newTemplate can copy the selected template and selects the copy', () => {
  const root = tempDir();
  fs.cpSync(path.join(FIXTURE_DIR, 'simple-letter'), path.join(root, 'simple-letter'), { recursive: true });
  const settings = createSettings(path.join(tempDir(), 's.json'));
  const c = createController({ htmlDir: root, settings, renderPdf: async () => {} });
  c.selectTemplate('simple-letter');
  const s = c.newTemplate('Letter Copy', { copyFrom: 'simple-letter' });
  assert.equal(s.template.id, 'letter-copy');
  assert.equal(s.template.name, 'Letter Copy');
  assert.deepEqual(s.template.fields.map((f) => f.name), ['name', 'city']);
  assert.deepEqual(s.templates.map((t) => t.id).sort(), ['letter-copy', 'simple-letter']);
});
