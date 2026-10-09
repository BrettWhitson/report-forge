'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { combinePdfs } = require('../lib/combine');
const { tempDir, writeTinyPdf } = require('./helpers');

test('combines PDFs in order; page count is the sum', async () => {
  const dir = tempDir();
  const a = path.join(dir, 'a.pdf');
  const b = path.join(dir, 'b.pdf');
  await writeTinyPdf(a, 4);
  await writeTinyPdf(b, 5);
  const out = path.join(dir, 'all.pdf');
  assert.equal(await combinePdfs([a, b], out), 9);
  assert.equal((await PDFDocument.load(fs.readFileSync(out))).getPageCount(), 9);
});
