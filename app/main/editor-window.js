'use strict';
// Template editor windows: one per template, network-blocked session, IPC scoped to the sender's template.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { BrowserWindow, ipcMain, dialog, session, shell } = require('electron');
const { readBundle, validateBundle, saveBundle, changedOnDisk, stampsFor, EditorSaveError } = require('./editor-files');
const { inlineStylesheet } = require('../lib/template-model');
const { renderPdf } = require('./render-pdf');
const { isAllowedUrl } = require('../lib/url-scope');

const EDITOR_DIR = path.join(__dirname, '..', 'editor');
const TEST_PDF = /^report-forge-test-.*\.pdf$/;
const TEST_PDF_MAX_AGE = 24 * 60 * 60 * 1000;
const SAVE_AND_CLOSE_TIMEOUT = 15000;

const editors = new Map(); // template id -> { win, dir, id, name, cssFile, stamps, dirty, closing, asking, testPdf, closeTimer }
let editorSession = null;

function getEditorSession() {
  if (!editorSession) {
    editorSession = session.fromPartition('report-forge-editor');
    // Editor files and the requesting window's own template folder; nothing else on disk, nothing on the network.
    editorSession.webRequest.onBeforeRequest((details, callback) => {
      const owner = [...editors.values()].find((e) => !e.win.isDestroyed() && e.win.webContents.id === details.webContentsId);
      const roots = owner ? [EDITOR_DIR, owner.dir] : [EDITOR_DIR];
      callback({ cancel: !isAllowedUrl(details.url, roots) });
    });
    editorSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    editorSession.setPermissionCheckHandler(() => false);
  }
  return editorSession;
}

function entryFor(sender) {
  for (const entry of editors.values()) if (!entry.win.isDestroyed() && entry.win.webContents === sender) return entry;
  throw new Error('Unknown editor window.');
}

function title(entry) {
  return `${entry.dirty ? '• ' : ''}Edit — ${entry.name}`;
}

function handle(name, fn) {
  ipcMain.handle(`rfe:${name}`, async (event, ...args) => {
    try {
      return { ok: true, value: await fn(entryFor(event.sender), ...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function removeQuietly(file) {
  try {
    if (file) fs.rmSync(file, { force: true });
  } catch {
    // A PDF viewer may still hold the file open; it is cleaned up on a later start.
  }
}

// Test PDFs left in the temp folder by earlier sessions (older than a day, so open viewers are not disturbed).
function cleanOldTestPdfs() {
  const dir = os.tmpdir();
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => TEST_PDF.test(n));
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > TEST_PDF_MAX_AGE) removeQuietly(file);
    } catch {
      // Gone already.
    }
  }
}

function clearCloseTimer(entry) {
  clearTimeout(entry.closeTimer);
  entry.closeTimer = null;
}

function cleanBundle(bundle) {
  return { html: String(bundle.html ?? ''), css: String(bundle.css ?? ''), settings: String(bundle.settings ?? '') };
}

function registerEditorIpc() {
  cleanOldTestPdfs();
  handle('load', (entry) => {
    const b = readBundle(entry.dir);
    entry.cssFile = b.cssFile;
    entry.stamps = b.stamps;
    return { id: entry.id, name: entry.name, html: b.html, css: b.css, cssFile: b.cssFile, settings: b.settings, assetsBase: pathToFileURL(entry.dir + path.sep).href };
  });
  handle('validate', (_entry, bundle) => validateBundle(cleanBundle(bundle)));
  handle('save', (entry, bundle) => {
    // The renderer answered a Save-and-close request; its own messages take over from here.
    clearCloseTimer(entry);
    try {
      const result = saveBundle(entry.dir, cleanBundle(bundle), entry.cssFile);
      entry.stamps = result.stamps;
      entry.dirty = false;
      entry.win.setTitle(title(entry));
      return { ok: true };
    } catch (err) {
      if (err instanceof EditorSaveError) return { ok: false, problem: err.detail };
      // A failed write was rolled back from the backup; what is on disk now is what the editor last knew.
      if (fs.existsSync(entry.dir)) entry.stamps = stampsFor(entry.dir, entry.cssFile);
      throw err;
    }
  });
  handle('testPdf', async (entry, bundle) => {
    const b = cleanBundle(bundle);
    const outPath = path.join(os.tmpdir(), `report-forge-test-${entry.id}-${Date.now()}.pdf`);
    await renderPdf({ html: inlineStylesheet(b.html, entry.cssFile, b.css), templateDir: entry.dir, outPath });
    removeQuietly(entry.testPdf);
    entry.testPdf = outPath;
    const openError = await shell.openPath(outPath);
    if (openError) throw new Error(`The test PDF was saved to ${outPath} but could not be opened: ${openError}`);
    return { ok: true, path: outPath };
  });
  handle('setDirty', (entry, dirty) => {
    entry.dirty = Boolean(dirty);
    entry.win.setTitle(title(entry));
  });
  handle('closeAfterSave', (entry) => {
    clearCloseTimer(entry);
    entry.closing = true;
    entry.win.close();
  });
}

function openEditor({ htmlDir, id, name }) {
  const existing = editors.get(id);
  if (existing && !existing.win.isDestroyed()) {
    if (existing.win.isMinimized()) existing.win.restore();
    existing.win.focus();
    return existing.win;
  }
  const dir = path.join(htmlDir, id);
  if (!fs.existsSync(path.join(dir, 'template.html'))) throw new Error(`Template "${id}" not found.`);
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: `Edit — ${name}`,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-editor.js'),
      session: getEditorSession(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const entry = { win, dir, id, name, cssFile: 'template.css', stamps: null, dirty: false, closing: false, asking: false, testPdf: null, closeTimer: null };
  editors.set(id, entry);
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('page-title-updated', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());

  win.on('close', (event) => {
    if (!entry.dirty || entry.closing) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Save', 'Discard', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save changes to this template?',
    });
    if (choice === 0) {
      win.webContents.send('rfe:save-and-close');
      // If the editor page is stuck and never answers, offer a way out instead of a window that cannot close.
      clearCloseTimer(entry);
      entry.closeTimer = setTimeout(() => {
        entry.closeTimer = null;
        if (win.isDestroyed() || entry.closing) return;
        const stuck = dialog.showMessageBoxSync(win, {
          type: 'warning',
          buttons: ['Keep waiting', 'Close without saving'],
          defaultId: 0,
          cancelId: 0,
          message: 'The editor did not respond to Save.',
          detail: 'Close without saving discards your unsaved changes.',
        });
        if (stuck === 1 && !win.isDestroyed()) {
          entry.closing = true;
          win.close();
        }
      }, SAVE_AND_CLOSE_TIMEOUT);
    }
    if (choice === 1) {
      entry.closing = true;
      win.close();
    }
  });
  win.on('closed', () => {
    clearCloseTimer(entry);
    removeQuietly(entry.testPdf);
    if (editors.get(id) === entry) editors.delete(id);
  });

  win.on('focus', () => {
    if (entry.asking || !entry.stamps || !fs.existsSync(dir) || !changedOnDisk(dir, entry.cssFile, entry.stamps)) return;
    entry.asking = true;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Reload', 'Keep editing'],
      defaultId: 0,
      cancelId: 1,
      message: 'This template was changed outside the editor.',
      detail: 'Reload discards your unsaved editor changes. Keep editing overwrites the outside changes on your next save (a backup is made first).',
    });
    entry.stamps = stampsFor(dir, entry.cssFile);
    entry.asking = false;
    if (choice === 0) win.webContents.send('rfe:reload');
  });

  win.loadFile(path.join(__dirname, '..', 'editor', 'index.html'));
  return win;
}

function openEditorWindows() {
  return [...editors.values()].filter((e) => !e.win.isDestroyed()).map((e) => e.win);
}

function editorWindowFor(id) {
  const entry = editors.get(id);
  return entry && !entry.win.isDestroyed() ? entry.win : undefined;
}

module.exports = { registerEditorIpc, openEditor, editorWindowFor, openEditorWindows, getEditorSession };
