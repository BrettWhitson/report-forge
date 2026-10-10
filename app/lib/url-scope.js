'use strict';
// Decide which URLs a sandboxed window may load: data/blob/devtools always; file: only inside allowed folders.
const path = require('path');
const { fileURLToPath } = require('url');

function isAllowedUrl(url, roots) {
  if (/^(data|blob|devtools):/i.test(url)) return true;
  if (!/^file:/i.test(url)) return false;
  let file;
  try {
    const parsed = new URL(url);
    if (parsed.host) return false; // UNC/network share
    file = path.resolve(fileURLToPath(parsed));
  } catch {
    return false;
  }
  const lower = file.toLowerCase();
  return roots.some((root) => {
    const r = path.resolve(root).toLowerCase();
    return lower === r || lower.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
  });
}

module.exports = { isAllowedUrl };
