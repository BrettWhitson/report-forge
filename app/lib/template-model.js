'use strict';
// Pure string transforms between template files and the editor's model. No DOM, no Node APIs:
// used by Node (tests, main process) and bundled into the editor window.

// Elements whose content the editor must never parse or reformat (kept as opaque placeholders).
const RAW_ELEMENTS = ['script', 'style', 'textarea', 'title'];
// Elements where browsers move stray text and elements out of place ("foster parenting").
const TABLE_CONTEXT = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function maskComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
}

function splitDocument(html) {
  const masked = maskComments(html);
  const open = masked.match(/<body\b[^>]*>/i);
  const close = masked.toLowerCase().lastIndexOf('</body');
  if (!open || close === -1 || close < open.index) return { before: '', body: html, after: '' };
  const start = open.index + open[0].length;
  return { before: html.slice(0, start), body: html.slice(start, close), after: html.slice(close) };
}

function joinDocument({ before, body, after }) {
  return before + body + after;
}

// Splits HTML into text, comment, raw (script/style/textarea/title blocks), and tag tokens, in document
// order, in linear time. Comments are found first, so a comment that mentions "<script>" is just a comment.
function tokenize(html) {
  const lower = html.toLowerCase();
  const tokens = [];
  const closeCache = {}; // raw element name -> position of the next closing tag (or -1)
  let textStart = 0;
  let i = 0;
  const pushText = (end) => { if (end > textStart) tokens.push({ type: 'text', value: html.slice(textStart, end) }); };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      pushText(lt);
      const stop = end === -1 ? html.length : end + 3;
      tokens.push({ type: 'comment', value: html.slice(lt, stop) });
      i = textStart = stop;
      continue;
    }
    const raw = RAW_ELEMENTS.find((name) => lower.startsWith(`<${name}`, lt) && !/[a-z0-9-]/.test(lower[lt + name.length + 1] || ''));
    if (raw) {
      const cached = closeCache[raw];
      const close = cached !== undefined && (cached === -1 || cached > lt) ? cached : lower.indexOf(`</${raw}`, lt + raw.length + 1);
      closeCache[raw] = close;
      const gt = close === -1 ? -1 : html.indexOf('>', close);
      if (gt !== -1) {
        pushText(lt);
        tokens.push({ type: 'raw', value: html.slice(lt, gt + 1) });
        i = textStart = gt + 1;
        continue;
      }
    }
    if (/[a-zA-Z/!?]/.test(html[lt + 1] || '')) {
      const gt = html.indexOf('>', lt);
      if (gt === -1) break;
      pushText(lt);
      tokens.push({ type: 'tag', value: html.slice(lt, gt + 1) });
      i = textStart = gt + 1;
      continue;
    }
    i = lt + 1; // a stray "<" inside text
  }
  pushText(html.length);
  return tokens;
}

function tagName(tag) {
  const m = /^<\/?([a-zA-Z][\w-]*)/.exec(tag);
  return m ? m[1].toLowerCase() : null;
}

// Wraps Mustache tags in text as comment markers: section/inverted/closing/partial/comment tags always,
// every tag when the text sits directly in table structure (where browsers would move the text away).
function protectText(text, all) {
  let out = '';
  let i = 0;
  let close = -2;
  for (;;) {
    const open = text.indexOf('{{', i);
    if (open === -1) break;
    if (close !== -1 && close < open + 2) close = text.indexOf('}}', open + 2);
    if (close === -1) break;
    let end = close + 2;
    if (text[open + 2] === '{' && text[end] === '}') end += 1; // {{{triple}}}
    const tag = text.slice(open, end);
    const kind = tag.replace(/^\{\{\{?\s*/, '')[0] || '';
    out += text.slice(i, open) + (all || '#^/>!'.includes(kind) ? `<!--rf:${tag}-->` : tag);
    i = end;
  }
  return out + text.slice(i);
}

// Inline style attributes are parked as data-rf-style (GrapesJS would move them into its own stylesheet
// under generated ids), and class attributes containing Mustache tags as data-rf-class (GrapesJS would
// turn them into de-duplicated selectors). The canvas shows both; restore() puts them back.
const STYLE_ATTR = /(\s)style(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))/gi;
const CLASS_ATTR = /(\s)class(\s*=\s*(?:"([^"]*)"|'([^']*)'))/gi;
const PARKED_ATTR = /(\s)data-rf-(style|class)(\s*=)/gi;

function parkAttributes(tag) {
  return tag
    .replace(STYLE_ATTR, '$1data-rf-style$2')
    .replace(CLASS_ATTR, (all, space, rest, dq, sq) => ((dq ?? sq ?? '').includes('{{') ? `${space}data-rf-class${rest}` : all));
}

function protect(body) {
  const stack = [];
  return tokenize(body).map((t) => {
    const inTable = TABLE_CONTEXT.has(stack[stack.length - 1]);
    if (t.type === 'text') return protectText(t.value, inTable);
    if (t.type === 'comment') return t.value;
    if (t.type === 'raw') {
      const encoded = encodeURIComponent(t.value);
      return inTable ? `<!--rf-raw:${encoded}-->` : `<rf-script data-rf-script="${encoded}"></rf-script>`;
    }
    const name = tagName(t.value);
    if (t.value.startsWith('</')) {
      const at = stack.lastIndexOf(name);
      if (at !== -1) stack.length = at;
      return t.value;
    }
    if (name && !VOID_ELEMENTS.has(name) && !t.value.endsWith('/>')) stack.push(name);
    return name ? parkAttributes(t.value) : t.value;
  }).join('');
}

function decodeOr(encoded, fallback) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return fallback;
  }
}

function restore(body) {
  const tokens = tokenize(body);
  let out = '';
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === 'comment' && t.value.startsWith('<!--rf:') && t.value.endsWith('-->')) {
      out += t.value.slice(7, -3);
    } else if (t.type === 'comment' && t.value.startsWith('<!--rf-raw:') && t.value.endsWith('-->')) {
      out += decodeOr(t.value.slice(11, -3), t.value);
    } else if (t.type === 'tag' && /^<rf-script\b/i.test(t.value)) {
      const attr = /\bdata-rf-script="([^"]*)"/.exec(t.value);
      let j = i + 1;
      if (tokens[j] && tokens[j].type === 'text' && !tokens[j].value.trim()) j += 1;
      const closes = tokens[j] && tokens[j].type === 'tag' && /^<\/rf-script\s*>$/i.test(tokens[j].value);
      const decoded = attr ? decodeOr(attr[1], null) : null;
      if (decoded !== null && closes) {
        out += decoded;
        i = j;
      } else {
        out += t.value; // damaged placeholder: left visible so validation can refuse to save it
      }
    } else if (t.type === 'tag') {
      out += t.value.replace(PARKED_ATTR, '$1$2$3');
    } else {
      out += t.value;
    }
  }
  return out;
}

// GrapesJS drops comments that come before the first element; keep that leading part outside the editor.
function splitLead(body) {
  const lead = /^(?:\s|<!--[\s\S]*?-->)*/.exec(body)[0];
  return { lead, core: body.slice(lead.length) };
}

// Body as the editor needs it: protected, with the leading whitespace/comments (including a leading
// section marker) split off, because GrapesJS drops comments that come before the first element.
function prepareForEditor(body) {
  const { lead, core } = splitLead(protect(body));
  return { lead: restore(lead), core };
}

const COMMENT_SPLIT = /(<!--[\s\S]*?-->)/;

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

function hrefOf(link) {
  const m = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(link);
  return m ? m[1] ?? m[2] ?? m[3] : null;
}

function stylesheetLinks(html) {
  return (html.match(/<link\b[^>]*>/gi) || []).filter((link) => /\brel\s*=\s*["']?stylesheet["']?/i.test(link));
}

function findStylesheet(before) {
  for (const link of stylesheetLinks(maskComments(before))) {
    const href = hrefOf(link);
    if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//')) return href;
  }
  return null;
}

// Link href as a file name: query/hash removed and %-escapes decoded.
function cleanHref(href) {
  const bare = href.split(/[?#]/)[0];
  return decodeOr(bare, bare);
}

function normalizedFile(name) {
  return name.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function linkPointsAt(link, cssFile) {
  const href = hrefOf(link);
  return Boolean(href) && normalizedFile(cleanHref(href)) === normalizedFile(cssFile);
}

// True when the HTML already links this particular stylesheet (any other link does not count).
function linksStylesheet(html, cssFile) {
  return stylesheetLinks(maskComments(html)).some((link) => linkPointsAt(link, cssFile));
}

function ensureStylesheetLink(before, cssFile) {
  if (linksStylesheet(before, cssFile)) return before;
  if (/<\/head>/i.test(before)) return before.replace(/<\/head>/i, `  <link rel="stylesheet" href="${cssFile}">\n</head>`);
  return `<link rel="stylesheet" href="${cssFile}">\n${before}`;
}

function posixJoin(dir, rel) {
  const parts = [];
  for (const seg of `${dir}/${rel}`.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

// Stylesheet-relative url(...) values rewritten relative to the template folder, for CSS that is shown
// inline (canvas, Test PDF) instead of being loaded from its own subfolder.
function rebaseCssUrls(css, cssDir) {
  if (!cssDir || cssDir === '.') return css;
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (all, quote, url) => {
    if (/^(data:|[a-z][a-z0-9+.-]*:|\/|#)/i.test(url.trim())) return all;
    return `url(${quote}${posixJoin(cssDir.replace(/\\/g, '/'), url.trim())}${quote})`;
  });
}

function cssDirOf(cssFile) {
  const at = cssFile.replace(/\\/g, '/').lastIndexOf('/');
  return at === -1 ? '' : cssFile.slice(0, at);
}

// For Test PDF: render unsaved CSS by replacing this stylesheet's link with an inline <style>.
function inlineStylesheet(html, cssFile, css) {
  const style = `<style>${rebaseCssUrls(css, cssDirOf(cssFile))}</style>`;
  const link = stylesheetLinks(html).find((l) => linkPointsAt(l, cssFile));
  if (link) return html.replace(link, () => style);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => `${style}</head>`);
  return style + html;
}

const PAPER = {
  letter: { width: 8.5, height: 11, unit: 'in' },
  legal: { width: 8.5, height: 14, unit: 'in' },
  a4: { width: 210, height: 297, unit: 'mm' },
};

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function pageDimensions(setup) {
  let base;
  if (setup.size === 'custom') {
    const width = Number(setup.width);
    const height = Number(setup.height);
    if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
      throw new Error('Custom page size needs a positive width and height.');
    }
    if (setup.unit !== 'in' && setup.unit !== 'mm') throw new Error('Custom page size unit must be in or mm.');
    base = { width: round4(width), height: round4(height), unit: setup.unit };
  } else {
    base = PAPER[setup.size] || PAPER.letter;
  }
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

function hasPageSizing(css) {
  return BLOCK.test(css) || /(^|[\s,}])\.page\s*[,{]/.test(css.replace(/\/\*[\s\S]*?\*\//g, ''));
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
  const source = (managed ? managed[0] : css).replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = source.match(/@page\s*\{[^}]*\bsize\s*:\s*([^;}]+)/i);
  if (!rule) return { size: 'letter', orientation: 'portrait' };
  const value = rule[1].trim().toLowerCase();
  const dims = value.match(/^([\d.]+)(in|mm)\s+([\d.]+)(in|mm)(?:\s+(portrait|landscape))?$/);
  if (dims && dims[2] === dims[4]) {
    const result = fromDimensions(Number(dims[1]), Number(dims[3]), dims[2]);
    if (dims[5] && result.size !== 'custom') result.orientation = dims[5];
    return result;
  }
  const size = ['letter', 'legal', 'a4'].find((s) => value.includes(s)) || 'letter';
  return { size, orientation: value.includes('landscape') ? 'landscape' : 'portrait' };
}

module.exports = {
  splitDocument, joinDocument, tokenize, protect, restore, splitLead, prepareForEditor, extractHeadStyles,
  cleanHref, linksStylesheet, findStylesheet, ensureStylesheetLink, rebaseCssUrls, cssDirOf, inlineStylesheet,
  PAPER, pageDimensions, pageSetupCss, parsePageSetup, applyPageSetup, hasPageSizing,
};
