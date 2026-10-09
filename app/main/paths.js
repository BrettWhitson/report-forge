'use strict';
const path = require('path');

// Templates live in html/ next to the portable .exe, or in the project root during development.
function resolveHtmlDir({ isPackaged, exePath, portableDir, appDir }) {
  if (!isPackaged) return path.resolve(appDir, '..', '..', 'html');
  return path.join(portableDir || path.dirname(exePath), 'html');
}

module.exports = { resolveHtmlDir };
