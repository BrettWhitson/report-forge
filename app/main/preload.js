'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(name, ...args) {
  const result = await ipcRenderer.invoke(`rf:${name}`, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const api = {};
for (const name of ['status', 'selectTemplate', 'openDataDialog', 'loadData', 'setMapping', 'showPreview', 'setPreviewBounds',
  'chooseOutputDir', 'generate', 'newTemplate', 'openTemplateFolder', 'openOutputFolder', 'getTheme', 'setTheme']) {
  api[name] = (...args) => call(name, ...args);
}
api.onProgress = (cb) => ipcRenderer.on('rf:progress', (_event, p) => cb(p));
api.onChanged = (cb) => ipcRenderer.on('rf:changed', () => cb());
api.pathForFile = (file) => webUtils.getPathForFile(file);

contextBridge.exposeInMainWorld('reportForge', api);
