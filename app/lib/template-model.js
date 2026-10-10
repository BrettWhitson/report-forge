'use strict';
// Pure string transforms between template files and the editor's model. No DOM, no Node APIs:
// used by Node (tests, main process) and bundled into the editor window.

const SECTION_TAG = /\{\{\s*[#^/][^}]*\}\}/g;
const MARKER = /<!--rf:(\{\{\s*[#^/][^}]*\}\})-->/g;
const PLACEHOLDER = /<rf-script\b[^>]*?\bdata-rf-script="([^"]*)"[^>]*>\s*<\/rf-script>/gi;
const COMMENT_SPLIT = /(<!--[\s\S]*?-->)/;

function splitDocument(html) {
  const open = html.match(/<body\b[^>]*>/i);
  const close = html.search(/<\/body\s*>/i);
  if (!open || close === -1 || close < open.index) return { before: '', body: html, after: '' };
  const start = open.index + open[0].length;
  return { before: html.slice(0, start), body: html.slice(start, close), after: html.slice(close) };
}

function joinDocument({ before, body, after }) {
  return before + body + after;
}

// Splits HTML into comments, script blocks, other tags, and the text between them, in document order.
// Comments come first so a comment that mentions "<script>" is never mistaken for a script.
const TOKEN = /(<!--[\s\S]*?-->)|(<script\b[^>]*>[\s\S]*?<\/script\s*>)|(<[^>]*>)/gi;

function mapTokens(html, onText, onToken) {
  let out = '';
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(html); m; m = TOKEN.exec(html)) {
    out += onText(html.slice(last, m.index)) + onToken(m);
    last = TOKEN.lastIndex;
  }
  return out + onText(html.slice(last));
}

// Scripts become opaque placeholders (never executed or reformatted by the editor).
// Mustache section tags in text become comment markers so they survive table/list parsing;
// tags inside attributes and comments are left exactly as written.
function protect(body) {
  return mapTokens(
    body,
    (text) => text.replace(SECTION_TAG, (t) => `<!--rf:${t}-->`),
    (m) => (m[2] ? `<rf-script data-rf-script="${encodeURIComponent(m[2])}"></rf-script>` : m[0]),
  );
}

// GrapesJS drops comments that come before the first element; keep that leading part outside the editor.
function splitLead(body) {
  const lead = /^(?:\s|<!--[\s\S]*?-->)*/.exec(body)[0];
  return { lead, core: body.slice(lead.length) };
}

function restore(body) {
  return body.replace(MARKER, '$1').replace(PLACEHOLDER, (_m, encoded) => decodeURIComponent(encoded));
}

function extractHeadStyles(before) {
  const css = [];
  const takeStyles = (part) => part.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>\s*/gi, (_m, attrs, text) => {
    const media = /\bmedia\s*=\s*["']([^"']+)["']/i.exec(attrs);
    css.push(media && media[1].trim().toLowerCase() !== 'all' ? `@media ${media[1].trim()} {\n${text.trim()}\n}` : text.trim());
    return '';
  });
  // Commented-out <style> blocks stay commented out.
  const out = before.split(COMMENT_SPLIT).map((part) => (part.startsWith('<!--') ? part : takeStyles(part))).join('');
  return { before: out, css: css.join('\n\n') };
}

function findStylesheet(before) {
  const links = before.match(/<link\b[^>]*>/gi) || [];
  for (const link of links) {
    if (!/\brel\s*=\s*["']?stylesheet["']?/i.test(link)) continue;
    const href = link.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href[1]) && !href[1].startsWith('//')) return href[1];
  }
  return null;
}

function ensureStylesheetLink(before, cssFile) {
  if (findStylesheet(before)) return before;
  if (/<\/head>/i.test(before)) return before.replace(/<\/head>/i, `  <link rel="stylesheet" href="${cssFile}">\n</head>`);
  return `<link rel="stylesheet" href="${cssFile}">\n${before}`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// For Test PDF: render unsaved CSS by replacing the stylesheet link with an inline <style>.
function inlineStylesheet(html, cssFile, css) {
  const style = `<style>${css}</style>`;
  const link = new RegExp(`<link\\b[^>]*href\\s*=\\s*["']${escapeRegExp(cssFile)}["'][^>]*>`, 'i');
  if (link.test(html)) return html.replace(link, () => style);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => `${style}</head>`);
  return style + html;
}

const PAPER = {
  letter: { width: 8.5, height: 11, unit: 'in' },
  legal: { width: 8.5, height: 14, unit: 'in' },
  a4: { width: 210, height: 297, unit: 'mm' },
};

function pageDimensions(setup) {
  const base = setup.size === 'custom'
    ? { width: Number(setup.width), height: Number(setup.height), unit: setup.unit === 'mm' ? 'mm' : 'in' }
    : PAPER[setup.size] || PAPER.letter;
  return setup.orientation === 'landscape'
    ? { width: base.height, height: base.width, unit: base.unit }
    : { width: base.width, height: base.height, unit: base.unit };
}

const BLOCK_START = '/* === Report Forge page setup (managed by the editor) === */';
const BLOCK_END = '/* === end page setup === */';
const BLOCK = /\/\* === Report Forge page setup \(managed by the editor\) === \*\/[\s\S]*?\/\* === end page setup === \*\//;

function pageSetupCss(setup) {
  const d = pageDimensions(setup);
  const w = `${d.width}${d.unit}`;
  const h = `${d.height}${d.unit}`;
  return [
    BLOCK_START,
    `@page { size: ${w} ${h}; margin: 0; }`,
    `.page { position: relative; width: ${w}; height: ${h}; overflow: hidden; break-after: page; }`,
    '.page:last-of-type { break-after: auto; }',
    `.page.flow { height: auto; min-height: ${h}; overflow: visible; box-decoration-break: clone; -webkit-box-decoration-break: clone; }`,
    BLOCK_END,
  ].join('\n');
}

// The managed block goes at the end so its rules take precedence over older template rules.
function applyPageSetup(css, setup) {
  const block = pageSetupCss(setup);
  if (BLOCK.test(css)) return css.replace(BLOCK, () => block);
  return css.trim() ? `${css.replace(/\s+$/, '')}\n\n${block}\n` : `${block}\n`;
}

function fromDimensions(width, height, unit) {
  for (const [size, p] of Object.entries(PAPER)) {
    if (p.unit !== unit) continue;
    if (p.width === width && p.height === height) return { size, orientation: 'portrait' };
    if (p.width === height && p.height === width) return { size, orientation: 'landscape' };
  }
  return { size: 'custom', orientation: 'portrait', width, height, unit };
}

function parsePageSetup(css) {
  const managed = css.match(BLOCK);
  const source = managed ? managed[0] : css;
  const rule = source.match(/@page\s*\{[^}]*\bsize\s*:\s*([^;}]+)/i);
  if (!rule) return { size: 'letter', orientation: 'portrait' };
  const value = rule[1].trim().toLowerCase();
  const dims = value.match(/^([\d.]+)(in|mm)\s+([\d.]+)(in|mm)$/);
  if (dims && dims[2] === dims[4]) return fromDimensions(Number(dims[1]), Number(dims[3]), dims[2]);
  const size = ['letter', 'legal', 'a4'].find((s) => value.includes(s)) || 'letter';
  return { size, orientation: value.includes('landscape') ? 'landscape' : 'portrait' };
}

module.exports = {
  splitDocument, joinDocument, protect, restore, splitLead, extractHeadStyles, findStylesheet, ensureStylesheetLink,
  inlineStylesheet, PAPER, pageDimensions, pageSetupCss, parsePageSetup, applyPageSetup,
};
