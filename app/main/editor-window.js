'use strict';
// Template editor windows: one per template, network-blocked session, IPC scoped to the sender's template.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { BrowserWindow, ipcMain, dialog, session, shell } = require('electron');
const { readBundle, validateBundle, saveBundle, changedOnDisk, EditorSaveError } = require('./editor-files');
const { inlineStylesheet } = require('../lib/template-model');
const { renderPdf } = require('./render-pdf');

const editors = new Map(); // template id -> { win, dir, id, name, cssFile, mtimes, dirty, closing, asking }
let editorSession = null;

function getEditorSession() {
  if (!editorSession) {
    editorSession = session.fromPartition('report-forge-editor');
    editorSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !/^(file|data|blob|devtools):/i.test(details.url) });
    });
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

function cleanBundle(bundle) {
  return { html: String(bundle.html ?? ''), css: String(bundle.css ?? ''), settings: String(bundle.settings ?? '') };
}

function registerEditorIpc() {
  handle('load', (entry) => {
    const b = readBundle(entry.dir);
    entry.cssFile = b.cssFile;
    entry.mtimes = b.mtimes;
    return { id: entry.id, name: entry.name, html: b.html, css: b.css, settings: b.settings, assetsBase: pathToFileURL(entry.dir + path.sep).href };
  });
  handle('validate', (_entry, bundle) => validateBundle(cleanBundle(bundle)));
  handle('save', (entry, bundle) => {
    try {
      const result = saveBundle(entry.dir, cleanBundle(bundle), entry.cssFile);
      entry.mtimes = result.mtimes;
      entry.dirty = false;
      entry.win.setTitle(title(entry));
      return { ok: true };
    } catch (err) {
      if (err instanceof EditorSaveError) return { ok: false, problem: err.detail };
      throw err;
    }
  });
  handle('testPdf', async (entry, bundle) => {
    const b = cleanBundle(bundle);
    const outPath = path.join(os.tmpdir(), `report-forge-test-${entry.id}-${Date.now()}.pdf`);
    await renderPdf({ html: inlineStylesheet(b.html, entry.cssFile, b.css), templateDir: entry.dir, outPath });
    await shell.openPath(outPath);
    return { ok: true, path: outPath };
  });
  handle('setDirty', (entry, dirty) => {
    entry.dirty = Boolean(dirty);
    entry.win.setTitle(title(entry));
  });
  handle('closeAfterSave', (entry) => {
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
  const entry = { win, dir, id, name, cssFile: 'template.css', mtimes: null, dirty: false, closing: false, asking: false };
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
    if (choice === 0) win.webContents.send('rfe:save-and-close');
    if (choice === 1) {
      entry.closing = true;
      win.close();
    }
  });
  win.on('closed', () => editors.delete(id));

  win.on('focus', () => {
    if (entry.asking || !entry.mtimes || !changedOnDisk(dir, entry.cssFile, entry.mtimes)) return;
    entry.asking = true;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Reload', 'Keep editing'],
      defaultId: 0,
      cancelId: 1,
      message: 'This template was changed outside the editor.',
      detail: 'Reload discards your unsaved editor changes. Keep editing overwrites the outside changes on your next save (a backup is made first).',
    });
    entry.mtimes = readBundle(dir).mtimes;
    entry.asking = false;
    if (choice === 0) win.webContents.send('rfe:reload');
  });

  win.loadFile(path.join(__dirname, '..', 'editor', 'index.html'));
  return win;
}

function editorWindowFor(id) {
  const entry = editors.get(id);
  return entry && !entry.win.isDestroyed() ? entry.win : undefined;
}

module.exports = { registerEditorIpc, openEditor, editorWindowFor, getEditorSession };
