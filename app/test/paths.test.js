'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveHtmlDir } = require('../main/paths');
const { createSettings } = require('../main/settings');
const fs = require('fs');
const { tempDir } = require('./helpers');

test('development uses the project html folder', () => {
  assert.equal(resolveHtmlDir({ isPackaged: false, appDir: path.join('C:', 'proj', 'app', 'main') }), path.join('C:', 'proj', 'html'));
});

test('portable build uses the folder next to the exe', () => {
  assert.equal(resolveHtmlDir({ isPackaged: true, exePath: 'C:\\tmp\\x\\RF.exe', portableDir: 'D:\\Tools' }), path.join('D:\\Tools', 'html'));
  assert.equal(resolveHtmlDir({ isPackaged: true, exePath: path.join('E:', 'App', 'RF.exe') }), path.join('E:', 'App', 'html'));
});

test('settings persist and survive a corrupt file', () => {
  const file = path.join(tempDir(), 'settings.json');
  const s = createSettings(file);
  assert.equal(s.get('x', 5), 5);
  s.set('x', 7);
  assert.equal(createSettings(file).get('x'), 7);
  fs.writeFileSync(file, '{oops');
  assert.equal(createSettings(file).get('x', 1), 1);
});
