'use strict';
// Electron checks for the template editor: save-without-changes fidelity, editing end to end, network block.
// Run from app/: npm run editor-test
process.on('uncaughtException', (err) => { console.error('editor-test: FAIL'); console.error(err); process.exit(1); });
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { app, BrowserWindow } = require('electron');
const { PDFDocument } = require('pdf-lib');
const { registerEditorIpc, openEditor, getEditorSession } = require('../main/editor-window');
const { renderPdf, READY_SCRIPT, getSession } = require('../main/render-pdf');
const { renderHtml } = require('../lib/render');
const { loadTemplate } = require('../lib/templates');

const ROOT = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return; } catch { /* not ready yet */ }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function capture(templateDir, record) {
  const tpl = loadTemplate(templateDir);
  const tmp = path.join(templateDir, `_render-capture-${Date.now()}.html`);
  fs.writeFileSync(tmp, renderHtml(tpl.html, record));
  const win = new BrowserWindow({ show: false, width: 816, height: 1056, webPreferences: { session: getSession(), sandbox: true, contextIsolation: true } });
  try {
    await win.loadFile(tmp);
    await win.webContents.executeJavaScript(READY_SCRIPT, true);
    const height = await win.webContents.executeJavaScript('document.documentElement.scrollHeight');
    win.setContentSize(816, height);
    await sleep(300);
    const image = await win.webContents.capturePage();
    const pdfPath = path.join(os.tmpdir(), `editor-test-${Date.now()}.pdf`);
    await renderPdf({ html: renderHtml(tpl.html, record), templateDir, outPath: pdfPath });
    const pages = (await PDFDocument.load(fs.readFileSync(pdfPath))).getPageCount();
    return { image, pages, text: await win.webContents.executeJavaScript('document.body.innerText') };
  } finally {
    win.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

function pixelDiffRatio(a, b) {
  const sa = a.getSize();
  const sb = b.getSize();
  assert.deepEqual(sa, sb, 'capture sizes differ');
  const x = a.toBitmap();
  const y = b.toBitmap();
  let differing = 0;
  for (let i = 0; i < x.length; i += 4) {
    if (Math.abs(x[i] - y[i]) > 24 || Math.abs(x[i + 1] - y[i + 1]) > 24 || Math.abs(x[i + 2] - y[i + 2]) > 24) differing += 1;
  }
  return differing / (x.length / 4);
}

async function openAndWait(htmlDir, id) {
  const win = openEditor({ htmlDir, id, name: id });
  await until(() => win.webContents.executeJavaScript('Boolean(window.rfEditor && window.rfEditor.ready)'), `editor ready (${id})`);
  return win;
}

async function main() {
  registerEditorIpc();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'report-forge-editor-'));
  const htmlDir = path.join(work, 'html');
  fs.cpSync(path.join(ROOT, 'html'), htmlDir, { recursive: true });
  const preview = JSON.parse(fs.readFileSync(path.join(__dirname, 'preview-data', 'grouped-report.json'), 'utf8'));
  const records = {
    'grouped-report': preview.find((r) => r.name === 'harmon-4-funds'),
    'simple-letter': { view: { name: 'Ann Lee', city: 'Reno', today: 'October 10, 2026' } },
  };

  // 1. Save without changes: output must match.
  for (const id of Object.keys(records)) {
    const dir = path.join(htmlDir, id);
    const before = await capture(dir, records[id]);
    const win = await openAndWait(htmlDir, id);
    const result = await win.webContents.executeJavaScript('window.rfEditor.save()');
    assert.equal(result.ok, true, `save failed for ${id}: ${JSON.stringify(result)}`);
    assert.equal(await win.webContents.executeJavaScript('window.rfEditor.isDirty()'), false);
    win.destroy();
    assert.ok(fs.readdirSync(path.join(dir, '.backups')).length >= 1, 'no backup made');
    const saved = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
    const original = fs.readFileSync(path.join(ROOT, 'html', id, 'template.html'), 'utf8');
    assert.equal((saved.match(/<!--/g) || []).length, (original.match(/<!--/g) || []).length, `${id}: comments were lost`);
    if (id === 'grouped-report') {
      assert.match(saved, /\{\{#funds\}\}/);
      assert.match(saved, /<script id="chart-data" type="application\/json">/);
      assert.match(saved, /window\.reportReady = new Promise/);
    }
    const after = await capture(dir, records[id]);
    assert.equal(after.pages, before.pages, `${id}: page count changed`);
    assert.equal(after.text, before.text, `${id}: text changed`);
    const ratio = pixelDiffRatio(before.image, after.image);
    assert.ok(ratio < 0.0002, `${id}: ${(ratio * 100).toFixed(3)}% of pixels differ`);
    console.log(`round-trip ${id}: OK (${before.pages} pages, ${(ratio * 100).toFixed(4)}% pixels differ)`);
  }

  // 2. Edit end to end on simple-letter.
  const win = await openAndWait(htmlDir, 'simple-letter');
  const js = (code) => win.webContents.executeJavaScript(code, true);
  await js(`(() => { const p = window.rfEditor.editor.getWrapper().find('p')[1]; p.components('Dear {{name}}, welcome back,'); window.rfEditor.flush(); })()`);
  await js('void window.rfEditor.addPage()');
  await js(`window.rfEditor.setPageSetup({ size: 'letter', orientation: 'landscape' })`);
  assert.equal(await js('window.rfEditor.pages().length'), 2);
  await js('window.rfEditor.undo()');
  assert.equal(await js('window.rfEditor.getPageSetup().orientation'), 'portrait', 'undo did not revert page setup');
  await js('window.rfEditor.redo()');
  // An undo must keep its redo step even after GrapesJS's delayed update events have fired.
  await js('window.rfEditor.undo()');
  await sleep(700);
  assert.equal(await js('window.rfEditor.canRedo()'), true, 'redo lost after undo');
  await js('window.rfEditor.redo()');
  assert.equal(await js('window.rfEditor.getPageSetup().orientation'), 'landscape');
  await js('window.rfEditor.enterSource()');
  await js(`window.rfEditor.setSource('css', window.rfEditor.snapshot().css + '\\n.page p { color: rgb(1, 2, 3); }')`);
  assert.equal(await js('window.rfEditor.leaveSource()'), true);
  await js('window.rfEditor.undo()');
  assert.doesNotMatch(await js('window.rfEditor.snapshot().css'), /rgb\(1, 2, 3\)/, 'undo after Source did not revert');
  await js('window.rfEditor.redo()');
  assert.equal(await js('window.rfEditor.isDirty()'), true);
  const saveResult = await js('window.rfEditor.save()');
  assert.equal(saveResult.ok, true);
  assert.equal(await js('window.rfEditor.isDirty()'), false, 'still dirty after save');
  const dir = path.join(htmlDir, 'simple-letter');
  const html = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'template.css'), 'utf8');
  assert.match(html, /Dear \{\{name\}\}, welcome back,/);
  assert.equal((html.match(/<section class="page/g) || []).length, 2);
  assert.match(html, /<link rel="stylesheet" href="template.css">/);
  assert.match(css, /size: 11in 8\.5in/);
  assert.match(css, /rgb\(1, 2, 3\)/);
  assert.deepEqual(loadTemplate(dir).fields.map((f) => f.name), ['name', 'city']);
  console.log('editor e2e: OK');

  // 3. One Ctrl+Z in the canvas undoes exactly one step (GrapesJS re-dispatches canvas keys to the window).
  await js('void window.rfEditor.addPage(); void window.rfEditor.addPage();');
  assert.equal(await js('window.rfEditor.pages().length'), 4);
  await js(`window.rfEditor.editor.Canvas.getDocument().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
  await sleep(600);
  assert.equal(await js('window.rfEditor.pages().length'), 3, 'one Ctrl+Z must undo exactly one step');
  await js('window.rfEditor.undo()');
  console.log('keyboard undo: OK');

  // 4. Text still being typed is saved.
  await js(`(async () => {
    const p = window.rfEditor.editor.getWrapper().find('p')[2];
    window.rfEditor.editor.select(p);
    await p.getView().onActive({ stopPropagation() {}, preventDefault() {} });
    p.getEl().innerHTML = 'Thank you for visiting us from {{city}} again.';
    p.getEl().dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
  assert.equal(await js('window.rfEditor.isDirty()'), true, 'typing did not mark the template changed');
  assert.ok(win.getTitle().startsWith('•'), `window title not marked unsaved: ${win.getTitle()}`);
  assert.equal((await js('window.rfEditor.save()')).ok, true);
  assert.match(fs.readFileSync(path.join(dir, 'template.html'), 'utf8'), /visiting us from \{\{city\}\} again\./, 'typed text was not saved');
  console.log('typing committed on save: OK');

  // 5. <head> edits in Source are tracked, saved, and undoable.
  await js('window.rfEditor.enterSource()');
  await js(`window.rfEditor.setSource('html', window.rfEditor.snapshot().before.replace('<title>Simple Letter</title>', '<title>Letter v2</title>') + window.rfEditor.snapshot().body + window.rfEditor.snapshot().after)`);
  assert.equal(await js('window.rfEditor.leaveSource()'), true);
  assert.equal(await js('window.rfEditor.isDirty()'), true, 'head-only edit not seen as a change');
  await js('window.rfEditor.undo()');
  assert.match(await js('window.rfEditor.snapshot().before'), /<title>Simple Letter<\/title>/, 'undo did not revert the head edit');
  await js('window.rfEditor.redo()');
  assert.equal((await js('window.rfEditor.save()')).ok, true);
  assert.match(fs.readFileSync(path.join(dir, 'template.html'), 'utf8'), /<title>Letter v2<\/title>/);
  console.log('head edits: OK');

  // 6. Invalid Source is refused and kept, with the right line.
  await js('window.rfEditor.enterSource()');
  await js(`window.rfEditor.setSource('settings', '{\\n  "name": "x",\\n}')`);
  assert.equal(await js('window.rfEditor.leaveSource()'), false);
  assert.match(await js('document.querySelector("#message").textContent'), /SETTINGS, line 3/);
  await js(`window.rfEditor.setSource('settings', '')`);
  assert.equal(await js('window.rfEditor.leaveSource()'), true);
  console.log('source validation: OK');

  // 6b. Cleared Settings removes template.json; Save in Source stays in Source; opening Source is not a change.
  assert.equal((await js('window.rfEditor.save()')).ok, true);
  assert.equal(fs.existsSync(path.join(dir, 'template.json')), false, 'cleared Settings left template.json');
  await js('window.rfEditor.enterSource()');
  assert.equal(await js('window.rfEditor.isDirty()'), false, 'opening Source marked the template changed');
  await js(`window.rfEditor.setSource('css', window.rfEditor.getSource('css') + '\\n.page h1 { color: rgb(4, 5, 6); }')`);
  assert.equal((await js('window.rfEditor.save()')).ok, true);
  assert.equal(await js('window.rfEditor.mode()'), 'source', 'Save left Source');
  assert.match(fs.readFileSync(path.join(dir, 'template.css'), 'utf8'), /rgb\(4, 5, 6\)/);
  assert.equal(await js('document.querySelector("#add-page").disabled'), true, 'page controls active in Source');
  assert.equal(await js('window.rfEditor.leaveSource()'), true);
  assert.equal(await js('document.querySelector("#add-page").disabled'), false);
  console.log('save in source: OK');

  // 7. Nothing outside the app or this template folder can be loaded.
  const external = await js(`[...document.querySelectorAll('link[href], script[src]'), ...window.rfEditor.editor.Canvas.getDocument().querySelectorAll('link[href], script[src]')]
    .map((e) => e.href || e.src).filter((u) => !/^(file|data|blob):/i.test(u))`);
  assert.deepEqual(external, [], `external resources: ${external.join(', ')}`);
  fs.copyFileSync(path.join(htmlDir, 'grouped-report', 'assets', 'photo.jpg'), path.join(dir, 'probe.jpg'));
  const probe = (file) => `new Promise((r) => { const i = new Image(); i.onload = () => r('loaded'); i.onerror = () => r('blocked'); i.src = ${JSON.stringify(require('url').pathToFileURL(file).href)}; })`;
  assert.equal(await js(probe(path.join(dir, 'probe.jpg'))), 'loaded', 'control image inside the template folder should load');
  assert.equal(await js(probe(path.join(htmlDir, 'grouped-report', 'assets', 'photo.jpg'))), 'blocked', 'editor loaded a file outside its template folder');
  console.log('file scope: OK');

  // 8. The editor session itself blocks the network (independent of the page's CSP).
  const sessionFetch = await getEditorSession().fetch('https://example.com/').then(() => 'reached', () => 'blocked');
  assert.equal(sessionFetch, 'blocked', 'editor session reached the network');
  console.log('network block: OK');
  win.destroy();

  // 9. A template that starts with a section tag keeps it.
  const leadDir = path.join(htmlDir, 'lead-tag');
  fs.mkdirSync(leadDir);
  fs.writeFileSync(path.join(leadDir, 'template.html'), '<!doctype html><html><head></head><body>\n{{#rows}}<section class="page"><p>{{a}}</p></section>{{/rows}}\n</body></html>');
  const leadWin = await openAndWait(htmlDir, 'lead-tag');
  assert.equal((await leadWin.webContents.executeJavaScript('window.rfEditor.save()', true)).ok, true);
  const leadSaved = fs.readFileSync(path.join(leadDir, 'template.html'), 'utf8');
  assert.match(leadSaved, /<body>\n\{\{#rows\}\}<section class="page"><p>\{\{a\}\}<\/p><\/section>\{\{\/rows\}\}/);
  console.log('leading section tag: OK');

  // 10. Add page goes after the last page and outside the list loop that closes after it.
  await leadWin.webContents.executeJavaScript('void window.rfEditor.addPage()', true);
  assert.equal((await leadWin.webContents.executeJavaScript('window.rfEditor.save()', true)).ok, true);
  leadWin.destroy();
  assert.match(fs.readFileSync(path.join(leadDir, 'template.html'), 'utf8'), /\{\{\/rows\}\}<section class="page"><\/section>\n<\/body>/);
  console.log('add page placement: OK');

  // 11. A template without page sections shows as one sheet at paper width.
  const looseDir = path.join(htmlDir, 'loose');
  fs.mkdirSync(looseDir);
  fs.writeFileSync(path.join(looseDir, 'template.html'), '<!doctype html><html><head></head><body><p>{{a}}</p></body></html>');
  const looseWin = await openAndWait(htmlDir, 'loose');
  const loose = await looseWin.webContents.executeJavaScript(`(() => {
    const doc = window.rfEditor.editor.Canvas.getDocument();
    return { implicit: doc.documentElement.classList.contains('rf-implicit'), width: doc.body.style.width,
      list: document.querySelector('#page-list').textContent };
  })()`, true);
  looseWin.destroy();
  assert.deepEqual([loose.implicit, loose.width], [true, '8.5in']);
  assert.match(loose.list, /Whole document/);
  console.log('implicit page: OK');

  console.log(`editor-test: PASS (work folder ${work})`);
}

app.on('window-all-closed', () => {});
app.whenReady().then(main).then(() => app.exit(0), (err) => {
  console.error('editor-test: FAIL');
  console.error(err);
  app.exit(1);
});
