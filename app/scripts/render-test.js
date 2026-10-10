'use strict';
// End-to-end check in real Electron: sample data → statement PDFs, overflow, combined file, second template.
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
const { renderHtml } = require('../lib/render');
const { createPreviewView } = require('../main/preview-view');

const ROOT = path.join(__dirname, '..', '..');
const pages = async (file) => (await PDFDocument.load(fs.readFileSync(file))).getPageCount();

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'report-forge-render-'));
  const settings = createSettings(path.join(work, 'settings.json'));
  const c = createController({ htmlDir: path.join(ROOT, 'html'), settings, renderPdf });

  c.selectTemplate('grouped-report');
  c.loadData(path.join(__dirname, '..', 'test', 'fixtures', 'sample-data.xlsx'));
  const out = path.join(work, 'statement');
  c.setOutputDir(out);
  const result = await c.generate({ indices: null, combine: true });
  assert.deepEqual(result.failed, []);
  assert.equal(result.created.length, 5);
  for (const file of result.created) assert.equal(await pages(file), 4, file);
  assert.equal(await pages(result.combinedPath), 20);

  const preview = JSON.parse(fs.readFileSync(path.join(__dirname, 'preview-data', 'grouped-report.json'), 'utf8'));
  const big = preview.find((r) => r.name === 'synthetic-18-funds');
  const tpl = fs.readFileSync(path.join(ROOT, 'html', 'grouped-report', 'template.html'), 'utf8');
  const bigPdf = path.join(work, 'overflow.pdf');
  await renderPdf({ html: renderHtml(tpl, big), templateDir: path.join(ROOT, 'html', 'grouped-report'), outPath: bigPdf });
  assert.equal(await pages(bigPdf), 5);

  c.selectTemplate('simple-letter');
  c.loadData(path.join(__dirname, '..', 'test', 'fixtures', 'simple.csv'));
  c.setOutputDir(path.join(work, 'letters'));
  const letters = await c.generate({ indices: null, combine: false });
  assert.equal(letters.created.length, 3);
  for (const file of letters.created) assert.equal(await pages(file), 1);

  const leftovers = fs.readdirSync(path.join(ROOT, 'html', 'grouped-report')).filter((f) => f.startsWith('_render-'));
  assert.deepEqual(leftovers, []);
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
  await previewView.show(path.join(ROOT, 'html', 'simple-letter', 'template.html'));
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
