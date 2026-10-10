#!/usr/bin/env node
'use strict';
// Fill a template with the sample data file in its folder and print review PDFs using headless Microsoft Edge.
// Usage (from app/): node scripts/preview.js [templateId] [--keep-html]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { renderHtml } = require('../lib/render');
const { loadTemplate } = require('../lib/templates');
const { readTable } = require('../lib/import');
const { autoMap, applyMapping } = require('../lib/mapping');
const { buildRecords } = require('../lib/records');

const ROOT = path.resolve(__dirname, '..', '..');
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function findEdge() {
  const found = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`Microsoft Edge not found. Looked in:\n${EDGE_CANDIDATES.join('\n')}`);
  return found;
}

function printPdf(edge, profileDir, htmlPath, pdfPath) {
  fs.rmSync(pdfPath, { force: true });
  execFileSync(edge, [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--no-pdf-header-footer',
    `--user-data-dir=${profileDir}`, // throwaway profile: works even while the user's Edge is open
    '--virtual-time-budget=10000', // let fonts, images, and chart scripts finish
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ], { stdio: 'pipe', timeout: 60000 });
  if (!fs.existsSync(pdfPath)) throw new Error(`Edge did not create ${pdfPath}`);
}

function main() {
  const args = process.argv.slice(2);
  const keepHtml = args.includes('--keep-html');
  const templateId = args.find((a) => !a.startsWith('--')) || 'invoice';
  const templateDir = path.join(ROOT, 'html', templateId);
  const tpl = loadTemplate(templateDir);
  const templateHtml = tpl.html;
  const dataFile = fs.readdirSync(templateDir).find((f) => /^sample-data\./.test(f));
  if (!dataFile) throw new Error(`No sample-data file in ${templateDir}`);
  const table = readTable(path.join(templateDir, dataFile));
  const built = buildRecords(applyMapping(table.rows, autoMap(table.headers, tpl.fields)), table.rowNumbers, tpl);
  const records = built.records.map((r) => ({ ...r, name: r.title }));
  const outDir = path.join(ROOT, 'review');
  fs.mkdirSync(outDir, { recursive: true });

  const edge = findEdge();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-forge-edge-'));
  try {
    for (const record of records) {
      // The filled HTML must sit in the template folder so relative asset paths resolve.
      const htmlPath = path.join(templateDir, `_preview-${record.name}.html`);
      const pdfPath = path.join(outDir, `${record.name}.pdf`);
      fs.writeFileSync(htmlPath, renderHtml(templateHtml, record), 'utf8');
      try {
        printPdf(edge, profileDir, htmlPath, pdfPath);
        console.log(`ok   ${path.relative(ROOT, pdfPath)}`);
      } finally {
        if (!keepHtml) fs.rmSync(htmlPath, { force: true });
      }
    }
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main();
