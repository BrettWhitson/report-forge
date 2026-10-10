'use strict';
// Read, validate, and save a template's editable files (template.html, stylesheet, template.json).
const fs = require('fs');
const path = require('path');
const { splitDocument, joinDocument, extractHeadStyles, findStylesheet, ensureStylesheetLink } = require('../lib/template-model');
const { detectFields, FORMATS } = require('../lib/templates');

const BACKUPS = '.backups';

class EditorSaveError extends Error {
  constructor(detail) {
    super(detail.message);
    this.name = 'EditorSaveError';
    this.detail = detail;
  }
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function mtime(file) {
  return fs.existsSync(file) ? fs.statSync(file).mtimeMs : null;
}

function filesFor(dir, cssFile) {
  return { html: path.join(dir, 'template.html'), css: path.join(dir, cssFile), settings: path.join(dir, 'template.json') };
}

function mtimesFor(dir, cssFile) {
  const f = filesFor(dir, cssFile);
  return { html: mtime(f.html), css: mtime(f.css), settings: mtime(f.settings) };
}

function readBundle(dir) {
  const raw = readText(path.join(dir, 'template.html')) || '';
  const parts = splitDocument(raw);
  const { before, css: inlineCss } = extractHeadStyles(parts.before);
  const cssFile = findStylesheet(before) || 'template.css';
  const fileCss = readText(path.join(dir, cssFile)) || '';
  const css = [fileCss.trim() ? fileCss : '', inlineCss].filter(Boolean).join('\n\n');
  return {
    html: joinDocument({ ...parts, before }),
    css,
    cssFile,
    settings: readText(path.join(dir, 'template.json')) || '',
    mtimes: mtimesFor(dir, cssFile),
  };
}

function lineAt(text, index) {
  return text.slice(0, Math.max(0, index)).split('\n').length;
}

function validateBundle({ html, settings }) {
  if (settings && settings.trim()) {
    let manifest;
    try {
      manifest = JSON.parse(settings);
    } catch (err) {
      const pos = /position (\d+)/.exec(err.message);
      const line = /line (\d+)/.exec(err.message);
      return { tab: 'settings', line: line ? Number(line[1]) : pos ? lineAt(settings, Number(pos[1])) : 1, message: `template.json: ${err.message}` };
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { tab: 'settings', line: 1, message: 'template.json must be a JSON object.' };
    }
    for (const [name, f] of Object.entries(manifest.fields || {})) {
      if (f && f.format && !FORMATS.includes(f.format)) {
        return { tab: 'settings', line: lineAt(settings, settings.indexOf(`"${f.format}"`)), message: `Field "${name}" has unknown format "${f.format}".` };
      }
    }
  }
  try {
    detectFields(html);
  } catch (err) {
    const pos = / at (\d+)/.exec(err.message);
    return { tab: 'html', line: pos ? lineAt(html, Number(pos[1])) : 1, message: err.message };
  }
  return null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function backupStamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function makeBackup(dir, cssFile, now) {
  const root = path.join(dir, BACKUPS);
  let target = path.join(root, backupStamp(now));
  for (let n = 2; fs.existsSync(target); n += 1) target = path.join(root, `${backupStamp(now)}-${n}`);
  fs.mkdirSync(target, { recursive: true });
  for (const file of Object.values(filesFor(dir, cssFile))) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, path.basename(file)));
  }
  return target;
}

function pruneBackups(dir, keep) {
  const root = path.join(dir, BACKUPS);
  const names = fs.readdirSync(root).sort();
  for (const name of names.slice(0, Math.max(0, names.length - keep))) fs.rmSync(path.join(root, name), { recursive: true, force: true });
}

function writeAtomic(file, text) {
  const tmp = `${file}.rf-tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function saveBundle(dir, bundle, cssFile, { now = new Date(), keep = 20 } = {}) {
  const problem = validateBundle(bundle);
  if (problem) throw new EditorSaveError(problem);
  const parts = splitDocument(bundle.html);
  const html = joinDocument({ ...parts, before: ensureStylesheetLink(parts.before, cssFile) });
  const backupDir = makeBackup(dir, cssFile, now);
  const f = filesFor(dir, cssFile);
  writeAtomic(f.html, html);
  writeAtomic(f.css, bundle.css);
  if (bundle.settings && bundle.settings.trim()) writeAtomic(f.settings, bundle.settings);
  pruneBackups(dir, keep);
  return { backupDir, mtimes: mtimesFor(dir, cssFile) };
}

function changedOnDisk(dir, cssFile, mtimes) {
  const now = mtimesFor(dir, cssFile);
  return now.html !== mtimes.html || now.css !== mtimes.css || now.settings !== mtimes.settings;
}

module.exports = { readBundle, validateBundle, saveBundle, changedOnDisk, backupStamp, EditorSaveError };
