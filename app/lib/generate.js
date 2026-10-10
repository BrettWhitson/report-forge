'use strict';
// Generate one PDF per record (renderer injected), then optionally combine them.
const fs = require('fs');
const path = require('path');
const { renderHtml } = require('./render');
const { combinePdfs } = require('./combine');
const { safeFilename } = require('./format');

function friendlyError(err) {
  if (err && ['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) return 'The file is open in another program. Close it and try again.';
  return err && err.message ? err.message : String(err);
}

async function generate({ template, records, outDir, combine = false, renderPdf, onProgress = () => {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  const todo = records.filter((r) => !r.skipped);
  const created = [];
  const failed = [];
  for (let i = 0; i < todo.length; i += 1) {
    const record = todo[i];
    onProgress({ done: i, total: todo.length, title: record.title });
    const outPath = path.join(outDir, `${record.title}.pdf`);
    try {
      await renderPdf({ html: renderHtml(template.html, record), templateDir: template.dir, outPath });
      created.push(outPath);
    } catch (err) {
      failed.push({ title: record.title, error: friendlyError(err) });
    }
  }
  onProgress({ done: todo.length, total: todo.length });
  let combinedPath = null;
  if (combine && created.length) {
    // Never reuse a name just written for a record (a record could be titled "<template> - Combined").
    const used = new Set(created.map((p) => path.basename(p, '.pdf').toLowerCase()));
    combinedPath = path.join(outDir, `${safeFilename(`${template.manifest.name} - Combined`, used)}.pdf`);
    try {
      await combinePdfs(created, combinedPath);
    } catch (err) {
      failed.push({ title: path.basename(combinedPath), error: friendlyError(err) });
      combinedPath = null;
    }
  }
  return { created, failed, combinedPath, skipped: records.length - todo.length };
}

module.exports = { generate, friendlyError };
