'use strict';
// End-to-end check in real Electron: every example template with its sample data, page sizes, overflow, combined file.
// Run from app/: npm run render-test

// Report any startup error as a console failure instead of Electron's error dialog.
process.on('uncaughtException', (err) => { console.error('render-test: FAIL'); console.error(err); process.exit(1); });
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { app, BrowserWindow } = require('electron');
const { PDFDocument } = require('pdf-lib');
const { createController } = require('../main/controller');
const { createSettings } = require('../main/settings');
const { renderPdf } = require('../main/render-pdf');
const { createPreviewView } = require('../main/preview-view');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, '..', 'test', 'fixtures', 'templates');
const loadPdf = async (file) => PDFDocument.load(fs.readFileSync(file));
const pages = async (file) => (await loadPdf(file)).getPageCount();
// Page size in inches (Chromium rounds PDF page sizes to whole points, so compare within 0.02 in).
const pageSize = async (file) => {
  const { width, height } = (await loadPdf(file)).getPage(0).getSize();
  return [width / 72, height / 72];
};
const assertSize = (actual, expected, label) => {
  const ok = actual.every((v, i) => Math.abs(v - expected[i]) <= 0.02);
  assert.ok(ok, `${label}: page is ${actual.map((v) => v.toFixed(2)).join(' x ')} in, expected ${expected.join(' x ')} in`);
};
const EXAMPLES = {
  'certificate': { file: 'sample-data.csv', count: 6, size: [11, 8.5] },
  'sales-summary': { file: 'sample-data.json', count: 4, size: [8.5, 11] },
  'event-badge': { file: 'sample-data.csv', count: 8, size: [4, 3] },
  'welcome-letter': { file: 'sample-data.tsv', count: 4, size: [8.27, 11.69] },
};

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'report-forge-render-'));
  const settings = createSettings(path.join(work, 'settings.json'));
  const c = createController({ htmlDir: path.join(ROOT, 'html'), settings, renderPdf });

  // Invoice: grouped records, a combined file, and a long invoice that grows onto more sheets.
  c.selectTemplate('invoice');
  c.loadData(path.join(ROOT, 'html', 'invoice', 'sample-data.xlsx'));
  c.setOutputDir(path.join(work, 'invoice'));
  const result = await c.generate({ indices: null, combine: true });
  assert.deepEqual(result.failed, []);
  assert.equal(result.created.length, 5);
  const counts = [];
  for (const file of result.created) counts.push(await pages(file));
  assert.deepEqual(counts.slice(0, 4), [1, 1, 1, 1], 'short invoices fit one sheet');
  assert.ok(counts[4] >= 2, `the 42-line invoice should grow onto more sheets (got ${counts[4]})`);
  assert.equal(await pages(result.combinedPath), counts.reduce((a, b) => a + b, 0));
  assertSize(await pageSize(result.created[0]), [8.5, 11], 'invoice');
  console.log(`invoice: OK (pages ${counts.join(', ')})`);

  // Every other example renders every sample record at its own page size (the sales chart must draw).
  for (const [id, ex] of Object.entries(EXAMPLES)) {
    c.selectTemplate(id);
    c.loadData(path.join(ROOT, 'html', id, ex.file));
    c.setOutputDir(path.join(work, id));
    const r = await c.generate({ indices: null, combine: false });
    assert.deepEqual(r.failed, [], `${id}: ${JSON.stringify(r.failed)}`);
    assert.equal(r.created.length, ex.count, id);
    for (const file of r.created) {
      assert.equal(await pages(file), 1, file);
      assertSize(await pageSize(file), ex.size, file);
    }
    console.log(`${id}: OK (${r.created.length} PDFs)`);
  }

  const lettersCtl = createController({ htmlDir: FIXTURES, settings, renderPdf });
  lettersCtl.selectTemplate('simple-letter');
  lettersCtl.loadData(path.join(__dirname, '..', 'test', 'fixtures', 'simple.csv'));
  lettersCtl.setOutputDir(path.join(work, 'letters'));
  const letters = await lettersCtl.generate({ indices: null, combine: false });
  assert.equal(letters.created.length, 3);
  for (const file of letters.created) assert.equal(await pages(file), 1);

  for (const id of fs.readdirSync(path.join(ROOT, 'html'))) {
    const leftovers = fs.readdirSync(path.join(ROOT, 'html', id)).filter((f) => f.startsWith('_render-'));
    assert.deepEqual(leftovers, [], id);
  }
  // Preview isolation: template code in the preview must not reach the app API, Node, or the network.
  const host = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'main', 'preload.js'), contextIsolation: true, sandbox: true } });
  await host.loadURL('data:text/html,<p>host</p>');
  const previewView = createPreviewView(host);
  const evil = path.join(work, 'evil.html');
  fs.writeFileSync(evil, `<script>
    window.probe = (async () => {
      let net = 'blocked';
      try { await fetch('https://example.com/'); net = 'reached'; } catch { /* blocked */ }
      return { api: typeof window.parent.reportForge, top: typeof window.top.reportForge, node: typeof require, net };
    })();
  </script>`);
  await previewView.show(evil);
  const probe = await previewView.view.webContents.executeJavaScript('window.probe');
  assert.deepEqual(probe, { api: 'undefined', top: 'undefined', node: 'undefined', net: 'blocked' });
  await previewView.view.webContents.executeJavaScript("location.href = 'https://example.com/'; 1");
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(previewView.view.webContents.getURL().startsWith('file:'), 'preview navigated away');
  // Preview centering: the page sits in the middle of a wide preview pane, with no change to printed output.
  previewView.setBounds({ x: 0, y: 0, width: 1400, height: 900 }, true);
  await previewView.show(path.join(FIXTURES, 'simple-letter', 'template.html'));
  const box = await previewView.view.webContents.executeJavaScript(
    '(() => { const r = document.body.getBoundingClientRect(); return { left: r.left, right: document.documentElement.clientWidth - r.right }; })()');
  assert.ok(box.left > 50 && Math.abs(box.left - box.right) <= 2, `preview not centered: ${JSON.stringify(box)}`);
  host.destroy();

  console.log(`render-test: PASS (output in ${work})`);
}

// Each hidden render window is the only window; without this Electron quits after the first PDF.
app.on('window-all-closed', () => {});

app.whenReady().then(main).then(() => app.exit(0), (err) => {
  console.error('render-test: FAIL');
  console.error(err);
  app.exit(1);
});
