'use strict';
// Bundle the template editor (GrapesJS + CodeMirror + editor code) into app/editor/dist. Fully local; no CDN.
// Also writes THIRD_PARTY_NOTICES.txt with the licence of every package that ends up in the bundle.
const fs = require('fs');
const path = require('path');

let esbuild;
try {
  esbuild = require('esbuild');
} catch (err) {
  console.error(`Could not load esbuild (${err.message}).`);
  console.error('Run "npm install" in the app folder. If npm skipped install scripts, allow the esbuild one with "npm install-scripts approve esbuild" (or reinstall with scripts enabled).');
  process.exit(1);
}

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'editor', 'dist');
const REQUIRED = ['editor.js', 'source.js', 'index.html', 'editor.css'];
const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(APP, 'editor', f)));
if (missing.length) {
  console.error(`Editor source files missing from app/editor: ${missing.join(', ')}`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const result = esbuild.buildSync({
  entryPoints: [path.join(APP, 'editor', 'editor.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  outfile: path.join(OUT, 'editor.bundle.js'),
  minify: true,
  legalComments: 'eof',
  metafile: true,
  logLevel: 'warning',
});
fs.copyFileSync(require.resolve('grapesjs/dist/css/grapes.min.css'), path.join(OUT, 'grapes.min.css'));

// Package folders that contributed code to the bundle (node_modules/<name> or node_modules/@scope/<name>).
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = input.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (m) packages.add(m[1]);
}
const sections = [];
for (const name of [...packages].sort()) {
  const dir = path.join(APP, 'node_modules', name);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const licenseFile = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  const text = licenseFile ? fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim() : `License: ${pkg.license || 'see package'}`;
  sections.push(`${name} ${pkg.version}\n${'-'.repeat(60)}\n${text}`);
}
fs.writeFileSync(path.join(OUT, 'THIRD_PARTY_NOTICES.txt'),
  `Report Forge template editor includes the following third-party software.\n\n${sections.join('\n\n\n')}\n`);
console.log(`Editor built: ${OUT} (${packages.size} bundled packages listed in THIRD_PARTY_NOTICES.txt)`);
