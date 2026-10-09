'use strict';
// Electron entry point: window, IPC bridge to the controller, file watchers.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const { resolveHtmlDir } = require('./paths');
const { createSettings } = require('./settings');
const { createController } = require('./controller');
const { renderPdf } = require('./render-pdf');
const { createPreviewView } = require('./preview-view');
const { SUPPORTED_EXTENSIONS } = require('../lib/import');

let win = null;
let controller = null;
let preview = null;
let watchers = [];

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function handle(name, fn) {
  ipcMain.handle(`rf:${name}`, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function rewatch() {
  watchers.forEach((w) => w.close());
  watchers = [];
  const { templateDir, filePath } = controller.state();
  const changed = debounce(() => { controller.reload(); send('rf:changed'); }, 400);
  try {
    if (filePath && fs.existsSync(filePath)) watchers.push(fs.watch(filePath, changed));
    if (templateDir) {
      watchers.push(fs.watch(templateDir, { recursive: true }, (_event, file) => {
        if (file && /(^|[\\/])_(render|preview)-/.test(file)) return;
        changed();
      }));
    }
  } catch {
    // Watching is a convenience; ignore folders that cannot be watched.
  }
}

function ensureHtmlDir(dir) {
  if (fs.existsSync(dir)) return true;
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Create folder', 'Quit'],
    defaultId: 0,
    message: 'Template folder not found',
    detail: `Report Forge looks for templates in:\n${dir}\n\nCreate this folder now?`,
  });
  if (choice !== 0) return false;
  fs.mkdirSync(dir, { recursive: true });
  return true;
}

function registerIpc() {
  handle('status', () => controller.status());
  handle('selectTemplate', (id) => { const s = controller.selectTemplate(id); rewatch(); return s; });
  handle('openDataDialog', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Open data file',
      properties: ['openFile'],
      filters: [{ name: 'Data files', extensions: SUPPORTED_EXTENSIONS.map((e) => e.slice(1)) }],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('loadData', (filePath, sheet) => { const s = controller.loadData(filePath, sheet); rewatch(); return s; });
  handle('setMapping', (mapping) => controller.setMapping(mapping));
  handle('showPreview', (index) => preview.show(controller.previewFile(index)));
  handle('setPreviewBounds', (rect, visible) => preview.setBounds(rect, visible));
  handle('chooseOutputDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose output folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    controller.setOutputDir(r.filePaths[0]);
    return r.filePaths[0];
  });
  handle('generate', (options) => controller.generate({ ...options, onProgress: (p) => send('rf:progress', p) }));
  handle('newTemplate', (name) => {
    const s = controller.newTemplate(name);
    rewatch();
    const dir = controller.state().templateDir;
    if (dir) shell.openPath(dir);
    return s;
  });
  handle('openTemplateFolder', () => {
    const dir = controller.state().templateDir || controller.status().htmlDir;
    return shell.openPath(dir);
  });
  handle('openOutputFolder', () => {
    const dir = controller.status().outputDir;
    if (!dir) throw new Error('Choose an output folder first.');
    return shell.openPath(dir);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Report Forge',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  preview = createPreviewView(win);
}

app.whenReady().then(() => {
  const htmlDir = resolveHtmlDir({
    isPackaged: app.isPackaged,
    exePath: app.getPath('exe'),
    portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
    appDir: __dirname,
  });
  if (!ensureHtmlDir(htmlDir)) {
    app.quit();
    return;
  }
  // The app UI only ever loads local files; block any network request it might make.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(file|data|blob|devtools):/i.test(details.url) });
  });
  const settings = createSettings(path.join(app.getPath('userData'), 'settings.json'));
  controller = createController({ htmlDir, settings, renderPdf });
  const templates = controller.listTemplates();
  const last = settings.get('lastTemplate', null);
  const first = templates.find((t) => t.id === last) || templates[0];
  if (first) controller.selectTemplate(first.id);
  registerIpc();
  rewatch();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
