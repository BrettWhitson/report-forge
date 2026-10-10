'use strict';
// Read, validate, and save a template's editable files (template.html, stylesheet, template.json).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { splitDocument, joinDocument, extractHeadStyles, findStylesheet, ensureStylesheetLink, cleanHref } = require('../lib/template-model');
const { detectFields, FORMATS } = require('../lib/templates');

const BACKUPS = '.backups';
const STAMP = /^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d(-\d+)?$/;
const RESERVED = new Set(['template.html', 'template.json']);

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

// Content fingerprint (not a timestamp): catches edits on drives with coarse timestamps.
function stampOf(file) {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

// A stylesheet name is usable only if it is a file inside the template folder and not another bundle file.
function stylesheetProblem(dir, cssFile) {
  const resolved = path.resolve(dir, cssFile);
  const rel = path.relative(path.resolve(dir), resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return 'outside the template folder';
  if (RESERVED.has(rel.toLowerCase()) || rel.split(/[\\/]/)[0] === BACKUPS) return 'not a stylesheet';
  return null;
}

function freeStylesheetName(dir) {
  for (let n = 0; ; n += 1) {
    const name = n === 0 ? 'template.css' : `template-${n}.css`;
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
}

function filesFor(dir, cssFile) {
  return { css: path.join(dir, cssFile), settings: path.join(dir, 'template.json'), html: path.join(dir, 'template.html') };
}

function stampsFor(dir, cssFile) {
  const f = filesFor(dir, cssFile);
  return { html: stampOf(f.html), css: stampOf(f.css), settings: stampOf(f.settings) };
}

function readBundle(dir) {
  const raw = readText(path.join(dir, 'template.html')) || '';
  const parts = splitDocument(raw);
  // A bare fragment (no <body>) has its stylesheet link at the top of the content itself.
  const href = findStylesheet(parts.before || raw);
  const linked = href ? cleanHref(href) : null;
  const settings = readText(path.join(dir, 'template.json')) || '';
  if (linked && !stylesheetProblem(dir, linked)) {
    // A stylesheet is linked: inline <style> blocks stay where they are (their order relative to the link matters).
    return { html: raw, css: readText(path.join(dir, linked)) || '', cssFile: linked, settings, stamps: stampsFor(dir, linked) };
  }
  // No usable link: inline styles move into a new stylesheet the template will link on save.
  const { before, css } = extractHeadStyles(parts.before);
  const cssFile = freeStylesheetName(dir);
  return { html: joinDocument({ ...parts, before }), css, cssFile, settings, stamps: stampsFor(dir, cssFile) };
}

function lineAt(text, index) {
  return text.slice(0, Math.max(0, index)).split('\n').length;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Line of `"format": "<value>"` inside the definition of field `name` (falls back to the field, then line 1).
function formatLine(settings, name, format) {
  const fieldAt = settings.search(new RegExp(`"${escapeRegExp(name)}"\\s*:\\s*\\{`));
  const from = fieldAt === -1 ? 0 : fieldAt;
  const rel = settings.slice(from).search(new RegExp(`"format"\\s*:\\s*"${escapeRegExp(format)}"`));
  if (rel !== -1) return lineAt(settings, from + rel);
  return fieldAt === -1 ? 1 : lineAt(settings, fieldAt);
}

// V8 JSON errors end with "(line N column M)" or contain "at position N"; only the message's own wording counts.
function jsonErrorLine(message, text) {
  const line = /\(line (\d+) column \d+\)\s*$/.exec(message);
  if (line) return Number(line[1]);
  const positions = [...message.matchAll(/ at position (\d+)/g)];
  return positions.length ? lineAt(text, Number(positions[positions.length - 1][1])) : 1;
}

function validateBundle({ html, settings }) {
  if (settings && settings.trim()) {
    let manifest;
    try {
      manifest = JSON.parse(settings);
    } catch (err) {
      return { tab: 'settings', line: jsonErrorLine(err.message, settings), message: `template.json: ${err.message}` };
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { tab: 'settings', line: 1, message: 'template.json must be a JSON object.' };
    }
    for (const [name, f] of Object.entries(manifest.fields || {})) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) {
        const at = settings.search(new RegExp(`"${escapeRegExp(name)}"\\s*:`));
        return { tab: 'settings', line: at === -1 ? 1 : lineAt(settings, at), message: `Field "${name}" must be an object, like { "label": "${name}" }.` };
      }
      if (f.format && !FORMATS.includes(f.format)) {
        return { tab: 'settings', line: formatLine(settings, name, f.format), message: `Field "${name}" has unknown format "${f.format}".` };
      }
    }
  }
  const damaged = html.search(/<rf-script\b|<!--rf-raw:/i);
  if (damaged !== -1) {
    return { tab: 'html', line: lineAt(html, damaged), message: 'A code block (script or style) was damaged while editing. Open Source to fix or remove it.' };
  }
  const delimiters = html.search(/\{\{\s*=/);
  if (delimiters !== -1) {
    return { tab: 'html', line: lineAt(html, delimiters), message: 'Custom Mustache delimiters ({{= =}}) are not supported by the editor. Edit this template by hand.' };
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

function stampedBackups(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((n) => STAMP.test(n) && fs.statSync(path.join(root, n)).isDirectory());
}

function newestBackup(root) {
  const all = stampedBackups(root).map((n) => ({ n, t: fs.statSync(path.join(root, n)).mtimeMs }));
  all.sort((a, b) => a.t - b.t);
  return all.length ? path.join(root, all[all.length - 1].n) : null;
}

// Backups keep each file at its path relative to the template folder (a stylesheet may live in a subfolder).
function backupPath(backupDir, dir, file) {
  return path.join(backupDir, path.relative(dir, file));
}

function sameAsBackup(dir, cssFile, backupDir) {
  return Object.values(filesFor(dir, cssFile)).every((file) => readText(file) === readText(backupPath(backupDir, dir, file)));
}

function makeBackup(dir, cssFile, now) {
  const root = path.join(dir, BACKUPS);
  const newest = newestBackup(root);
  if (newest && sameAsBackup(dir, cssFile, newest)) return { backupDir: newest, created: false };
  let target = path.join(root, backupStamp(now));
  for (let n = 2; fs.existsSync(target); n += 1) target = path.join(root, `${backupStamp(now)}-${n}`);
  fs.mkdirSync(target, { recursive: true });
  try {
    for (const file of Object.values(filesFor(dir, cssFile))) {
      if (!fs.existsSync(file)) continue;
      const to = backupPath(target, dir, file);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(file, to);
    }
  } catch (err) {
    fs.rmSync(target, { recursive: true, force: true });
    throw err;
  }
  return { backupDir: target, created: true };
}

// Keeps the oldest backup (the template as it was before editing) and the newest keep-1, by creation time.
// Never deletes the backup just made, and ignores folders that are not backup stamps.
function pruneBackups(dir, keep, justMade) {
  const root = path.join(dir, BACKUPS);
  const all = stampedBackups(root).map((n) => {
    const st = fs.statSync(path.join(root, n));
    return { n, t: st.birthtimeMs || st.mtimeMs };
  });
  all.sort((a, b) => a.t - b.t || a.n.localeCompare(b.n));
  if (all.length <= keep) return;
  const [oldest, ...rest] = all;
  const survivors = new Set([oldest.n, ...rest.slice(rest.length - (keep - 1)).map((b) => b.n), path.basename(justMade)]);
  for (const b of all) if (!survivors.has(b.n)) fs.rmSync(path.join(root, b.n), { recursive: true, force: true });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Windows can briefly lock files (antivirus, indexer, a viewer); retry renames and deletes a few times.
function withRetry(fn) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return fn();
    } catch (err) {
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(100 * (attempt + 1));
    }
  }
}

// Written and flushed to disk before the rename, so a power cut cannot leave a truncated file.
function writeTempFile(tmp, text) {
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function saveBundle(dir, bundle, cssFile, { now = new Date(), keep = 20 } = {}) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`The template folder no longer exists: ${dir}`);
  }
  const problem = validateBundle(bundle);
  if (problem) throw new EditorSaveError(problem);
  const cssProblem = stylesheetProblem(dir, cssFile);
  if (cssProblem) throw new Error(`Stylesheet "${cssFile}" is ${cssProblem}.`);

  // Link this template's own stylesheet unless it is already linked (another stylesheet link does not count).
  const parts = splitDocument(bundle.html);
  const html = parts.before
    ? joinDocument({ ...parts, before: ensureStylesheetLink(parts.before, cssFile) })
    : ensureStylesheetLink(bundle.html, cssFile);
  const f = filesFor(dir, cssFile);
  const keepSettings = Boolean(bundle.settings && bundle.settings.trim());
  // Order matters: the stylesheet and settings land before template.html, which is what points at them.
  const writes = [[f.css, bundle.css]];
  if (keepSettings) writes.push([f.settings, bundle.settings]);
  writes.push([f.html, html]);

  const { backupDir, created } = makeBackup(dir, cssFile, now);
  const temps = [];
  const done = [];
  try {
    for (const [file, text] of writes) {
      const tmp = `${file}.rf-tmp-${process.pid}`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeTempFile(tmp, text);
      temps.push([tmp, file]);
    }
    for (const [tmp, file] of temps) {
      withRetry(() => fs.renameSync(tmp, file));
      done.push(file);
    }
    // Clearing Settings removes template.json; the backup keeps the previous one.
    if (!keepSettings && fs.existsSync(f.settings)) {
      withRetry(() => fs.rmSync(f.settings));
      done.push(f.settings);
    }
  } catch (err) {
    for (const [tmp] of temps) fs.rmSync(tmp, { force: true });
    for (const file of done) {
      const saved = backupPath(backupDir, dir, file);
      if (fs.existsSync(saved)) fs.copyFileSync(saved, file);
      else fs.rmSync(file, { force: true });
    }
    throw err;
  }
  if (created) pruneBackups(dir, keep, backupDir);
  return { backupDir, stamps: stampsFor(dir, cssFile) };
}

function changedOnDisk(dir, cssFile, stamps) {
  const now = stampsFor(dir, cssFile);
  return now.html !== stamps.html || now.css !== stamps.css || now.settings !== stamps.settings;
}

module.exports = { readBundle, validateBundle, saveBundle, changedOnDisk, stampsFor, backupStamp, EditorSaveError };
