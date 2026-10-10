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

test('re-pushing the current snapshot after undo keeps the redo step', () => {
  const h = new History();
  h.push(s('a')); h.push(s('b'));
  h.undo();
  assert.equal(h.push(s('a')), false);
  assert.equal(h.canRedo(), true);
  assert.deepEqual(h.redo(), s('b'));
});

test('the limit still holds after undo then push', () => {
  const h = new History(3);
  ['a', 'b', 'c'].forEach((b) => h.push(s(b)));
  h.undo();
  h.push(s('d')); h.push(s('e'));
  assert.deepEqual(h.undo(), s('d'));
  assert.deepEqual(h.undo(), s('b'));
  assert.equal(h.undo(), null);
});

test('a limit below 1 is treated as 1', () => {
  const h = new History(0);
  h.push(s('a')); h.push(s('b'));
  assert.deepEqual(h.current(), s('b'));
  assert.equal(h.canUndo(), false);
});

test('stored snapshots cannot be changed afterwards', () => {
  const h = new History();
  const snap = s('a');
  h.push(snap);
  assert.throws(() => { 'use strict'; h.current().body = 'changed'; });
});
