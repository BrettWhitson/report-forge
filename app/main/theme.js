'use strict';
// App color theme: follow Windows ("system") or force light/dark.

const THEMES = ['system', 'light', 'dark'];

function normalizeTheme(value) {
  return THEMES.includes(value) ? value : 'system';
}

module.exports = { THEMES, normalizeTheme };
