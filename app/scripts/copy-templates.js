'use strict';
// Copy the html/ template library next to the built portable .exe (temp files excluded).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const from = path.join(ROOT, 'html');
const to = path.join(ROOT, 'dist', 'html');
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true, filter: (src) => !/[\\/]_(render|preview)-[^\\/]*\.html$/i.test(src) });
console.log(`Copied templates to ${to}`);
