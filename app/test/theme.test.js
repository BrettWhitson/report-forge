'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { THEMES, normalizeTheme } = require('../main/theme');

test('theme choices are system, light, and dark', () => {
  assert.deepEqual(THEMES, ['system', 'light', 'dark']);
});

test('valid theme values pass through', () => {
  for (const t of THEMES) assert.equal(normalizeTheme(t), t);
});

test('anything else falls back to system', () => {
  assert.equal(normalizeTheme(undefined), 'system');
  assert.equal(normalizeTheme('purple'), 'system');
  assert.equal(normalizeTheme({}), 'system');
});
