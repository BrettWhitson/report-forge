'use strict';
// Tiny JSON settings store (one file in the user's app-data folder).
const fs = require('fs');
const path = require('path');

function createSettings(file) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    data = {};
  }
  return {
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
    },
    set(key, value) {
      data[key] = value;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Write a temporary file, then swap it in, so a crash mid-write cannot leave a half-written settings file.
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      try {
        fs.renameSync(tmp, file);
      } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
    },
  };
}

module.exports = { createSettings };
