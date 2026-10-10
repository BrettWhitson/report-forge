'use strict';
const { contextBridge, ipcRenderer } = require('electron');

async function call(name, ...args) {
  const result = await ipcRenderer.invoke(`rfe:${name}`, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

contextBridge.exposeInMainWorld('editorApi', {
  load: () => call('load'),
  validate: (bundle) => call('validate', bundle),
  save: (bundle) => call('save', bundle),
  testPdf: (bundle) => call('testPdf', bundle),
  setDirty: (dirty) => call('setDirty', Boolean(dirty)),
  closeAfterSave: () => call('closeAfterSave'),
  onSaveAndClose: (cb) => ipcRenderer.on('rfe:save-and-close', () => cb()),
  onReload: (cb) => ipcRenderer.on('rfe:reload', () => cb()),
});
