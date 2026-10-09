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
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    },
  };
}

module.exports = { createSettings };
