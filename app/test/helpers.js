'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const created = [];
process.on('exit', () => created.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-forge-test-'));
  created.push(dir);
  return dir;
}

async function writeTinyPdf(filePath, pages) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]);
  fs.writeFileSync(filePath, await doc.save());
}

module.exports = { tempDir, writeTinyPdf };
