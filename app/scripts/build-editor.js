'use strict';
// Bundle the template editor (GrapesJS + CodeMirror + editor code) into app/editor/dist. Fully local; no CDN.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'editor', 'dist');
fs.mkdirSync(OUT, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(APP, 'editor', 'editor.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  outfile: path.join(OUT, 'editor.bundle.js'),
  legalComments: 'eof',
  logLevel: 'warning',
});
fs.copyFileSync(require.resolve('grapesjs/dist/css/grapes.min.css'), path.join(OUT, 'grapes.min.css'));
console.log(`Editor built: ${OUT}`);
