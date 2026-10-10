'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { History, sameSnapshot } = require('../lib/history');

const s = (body, css = '', settings = '') => ({ body, css, settings });

test('push ignores duplicates of the current snapshot', () => {
  const h = new History();
  assert.equal(h.push(s('a')), true);
  assert.equal(h.push(s('a')), false);
  assert.equal(h.canUndo(), false);
});

test('undo and redo walk the stack', () => {
  const h = new History();
  h.push(s('a')); h.push(s('b')); h.push(s('c'));
  assert.deepEqual(h.undo(), s('b'));
  assert.deepEqual(h.undo(), s('a'));
  assert.equal(h.undo(), null);
  assert.deepEqual(h.redo(), s('b'));
  assert.deepEqual(h.current(), s('b'));
});

test('a new push after undo drops the redo branch (linear history)', () => {
  const h = new History();
  h.push(s('a')); h.push(s('b')); h.undo();
  h.push(s('source edit', 'x{}'));
  assert.equal(h.canRedo(), false);
  assert.deepEqual(h.undo(), s('a'));
});

test('limit keeps the newest snapshots', () => {
  const h = new History(3);
  ['a', 'b', 'c', 'd'].forEach((b) => h.push(s(b)));
  assert.deepEqual(h.undo(), s('c'));
  assert.deepEqual(h.undo(), s('b'));
  assert.equal(h.undo(), null);
});

test('sameSnapshot compares all three parts', () => {
  assert.equal(sameSnapshot(s('a', 'c', 'j'), s('a', 'c', 'j')), true);
  assert.equal(sameSnapshot(s('a', 'c', 'j'), s('a', 'c', 'k')), false);
  assert.equal(sameSnapshot(null, s('a')), false);
});

test('sameSnapshot also compares head and tail parts when present', () => {
  assert.equal(sameSnapshot({ ...s('a'), before: '<head><title>1</title>', after: '' }, { ...s('a'), before: '<head><title>2</title>', after: '' }), false);
  assert.equal(sameSnapshot({ ...s('a'), before: 'x', after: 'y' }, { ...s('a'), before: 'x', after: 'y' }), true);
});
