'use strict';
// Render filled template HTML to PDF in a hidden, network-blocked Chromium window.
const fs = require('fs');
const path = require('path');
const { BrowserWindow, session } = require('electron');

let renderSession = null;

function getSession() {
  if (!renderSession) {
    renderSession = session.fromPartition('report-forge-render'); // in-memory, separate from the app UI
    renderSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !/^(file|data|blob):/i.test(details.url) });
    });
  }
  return renderSession;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Waits for fonts, images, and the template's own window.reportReady; reports rejections as text.
const READY_SCRIPT = `
  Promise.all([
    document.fonts ? document.fonts.ready : null,
    ...Array.from(document.images).map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })),
    window.reportReady || null,
  ]).then(() => ({ ok: true }), (err) => ({ ok: false, message: String((err && err.message) || err) }))
`;

async function renderPdf({ html, templateDir, outPath, timeoutMs = 30000 }) {
  const tmp = path.join(templateDir, `_render-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    width: 816,
    height: 1056,
    webPreferences: { session: getSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await withTimeout(win.loadFile(tmp), timeoutMs, 'Loading the template timed out.');
    const ready = await withTimeout(win.webContents.executeJavaScript(READY_SCRIPT, true), timeoutMs, 'The template did not finish drawing in time.');
    if (!ready.ok) throw new Error(`Template script error: ${ready.message}`);
    const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
    fs.writeFileSync(outPath, pdf);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

module.exports = { renderPdf, getSession, READY_SCRIPT };
