'use strict';
// Linear undo/redo over whole-template snapshots ({ body, css, settings }).

function sameSnapshot(a, b) {
  return Boolean(a && b) && a.body === b.body && a.css === b.css && a.settings === b.settings
    && (a.before ?? '') === (b.before ?? '') && (a.after ?? '') === (b.after ?? '');
}

class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.stack = [];
    this.index = -1;
  }

  push(snapshot) {
    if (sameSnapshot(this.current(), snapshot)) return false;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(snapshot);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  undo() {
    if (!this.canUndo()) return null;
    this.index -= 1;
    return this.stack[this.index];
  }

  redo() {
    if (!this.canRedo()) return null;
    this.index += 1;
    return this.stack[this.index];
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index < this.stack.length - 1;
  }

  current() {
    return this.stack[this.index] || null;
  }
}

module.exports = { History, sameSnapshot };
