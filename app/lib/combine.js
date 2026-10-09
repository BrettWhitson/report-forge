'use strict';
// Merge several PDFs into one, in the given order.
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

async function combinePdfs(paths, outPath) {
  const out = await PDFDocument.create();
  for (const p of paths) {
    const src = await PDFDocument.load(fs.readFileSync(p));
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  fs.writeFileSync(outPath, await out.save());
  return out.getPageCount();
}

module.exports = { combinePdfs };
