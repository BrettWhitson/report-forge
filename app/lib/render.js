'use strict';
const Mustache = require('mustache');

class TemplateError extends Error {
  constructor(message) {
    super(`Template error: ${message}`);
    this.name = 'TemplateError';
  }
}

const LT_ESCAPE = String.fromCharCode(92) + 'u003c'; // the six characters \u003c

// JSON that is safe inside an inline <script>: "<" is escaped so data can never close the tag.
function scriptSafeJson(value) {
  return JSON.stringify(value ?? null).replace(/</g, LT_ESCAPE);
}

function renderHtml(templateHtml, record) {
  let html;
  try {
    html = Mustache.render(templateHtml, record.view);
  } catch (err) {
    throw new TemplateError(err.message);
  }
  const data = record.raw === undefined ? record.view : record.raw;
  const script = `<script>window.reportData = ${scriptSafeJson(data)};</script>`;
  const headEnd = html.indexOf('</head>');
  return headEnd === -1 ? script + html : html.slice(0, headEnd) + script + html.slice(headEnd);
}

module.exports = { renderHtml, TemplateError };
