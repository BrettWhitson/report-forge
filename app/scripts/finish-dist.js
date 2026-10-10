'use strict';
// After electron-builder: rename the unpacked app to dist/Report Forge and put the html/ template library inside it.
// The app is shipped as a folder (no self-extracting single .exe), so it starts in about a second.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const built = path.join(ROOT, 'dist', 'win-unpacked');
const appDir = path.join(ROOT, 'dist', 'Report Forge');

fs.rmSync(appDir, { recursive: true, force: true });
fs.renameSync(built, appDir);
fs.cpSync(path.join(ROOT, 'html'), path.join(appDir, 'html'), {
  recursive: true,
  filter: (src) => !/[\\/]_(render|preview)-[^\\/]*\.html$/i.test(src) && !/[\\/]\.backups([\\/]|$)/.test(src) && !/\.rf-tmp-\d+$/.test(src),
});
fs.copyFileSync(path.join(__dirname, '..', 'editor', 'dist', 'THIRD_PARTY_NOTICES.txt'), path.join(appDir, 'THIRD_PARTY_NOTICES.txt'));
console.log(`App ready: ${appDir}`);
