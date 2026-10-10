'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSettings } = require('../main/settings');
const { tempDir } = require('./helpers');

test('settings are saved through a temporary file, so a crash cannot leave a half-written file', () => {
  const dir = tempDir();
  const file = path.join(dir, 'settings.json');
  const s = createSettings(file);
  s.set('a', 1);
  s.set('b', { c: 2 });
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  assert.deepEqual(createSettings(file).get('b'), { c: 2 });
  const written = [];
  const real = fs.writeFileSync;
  fs.writeFileSync = (target, ...rest) => { written.push(path.basename(String(target))); return real.call(fs, target, ...rest); };
  try {
    s.set('a', 3);
  } finally {
    fs.writeFileSync = real;
  }
  assert.ok(written.length && written.every((n) => n !== 'settings.json'), `wrote ${written.join(', ')} directly`);
});

test('a damaged settings file starts fresh instead of crashing', () => {
  const file = path.join(tempDir(), 'settings.json');
  fs.writeFileSync(file, '{"a": 1,');
  assert.equal(createSettings(file).get('a', 'fallback'), 'fallback');
});
