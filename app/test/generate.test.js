'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { generate } = require('../lib/generate');
const { tempDir, writeTinyPdf } = require('./helpers');

const template = { dir: '/tpl', html: '<p>{{name}}</p>', manifest: { name: 'Thanks' } };
const rec = (title, extra = {}) => ({ title, view: { name: title }, skipped: false, ...extra });

test('renders each non-skipped record and reports progress', async () => {
  const outDir = path.join(tempDir(), 'out');
  const seen = [];
  const progress = [];
  const result = await generate({
    template,
    records: [rec('Ann'), rec('Bo', { skipped: true }), rec('Cy')],
    outDir,
    renderPdf: async ({ html, outPath }) => { seen.push(html); await writeTinyPdf(outPath, 1); },
    onProgress: (p) => progress.push(p),
  });
  assert.deepEqual(result.created.map((p) => path.basename(p)), ['Ann.pdf', 'Cy.pdf']);
  assert.equal(result.skipped, 1);
  assert.match(seen[0], /<p>Ann<\/p>/);
  assert.deepEqual(progress.at(-1), { done: 2, total: 2 });
  assert.equal(result.combinedPath, null);
});

test('a locked output file fails that record and the batch continues', async () => {
  const outDir = tempDir();
  const result = await generate({
    template,
    records: [rec('Locked'), rec('Fine')],
    outDir,
    renderPdf: async ({ outPath }) => {
      if (outPath.endsWith('Locked.pdf')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      await writeTinyPdf(outPath, 1);
    },
  });
  assert.deepEqual(result.failed, [{ title: 'Locked', error: 'The file is open in another program. Close it and try again.' }]);
  assert.equal(result.created.length, 1);
});

test('combine option writes "<template name> - Combined.pdf"', async () => {
  const outDir = tempDir();
  const result = await generate({
    template,
    records: [rec('Ann'), rec('Cy')],
    outDir,
    combine: true,
    renderPdf: async ({ outPath }) => writeTinyPdf(outPath, 2),
  });
  assert.equal(path.basename(result.combinedPath), 'Thanks - Combined.pdf');
  assert.ok(fs.existsSync(result.combinedPath));
});

test('the combined file never overwrites a record whose title matches its name', async () => {
  const outDir = path.join(tempDir(), 'out');
  const result = await generate({
    template,
    records: [rec('Thanks - Combined'), rec('Bo')],
    outDir,
    combine: true,
    renderPdf: async ({ outPath }) => writeTinyPdf(outPath, 1),
  });
  assert.equal(path.basename(result.combinedPath), 'Thanks - Combined (2).pdf');
  assert.equal(fs.readdirSync(outDir).length, 3);
});
