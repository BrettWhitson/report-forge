'use strict';
// App state and operations. Electron-free: the PDF renderer is passed in.
const fs = require('fs');
const path = require('path');
const { readTable } = require('../lib/import');
const { loadTemplate, listTemplates, createTemplate } = require('../lib/templates');
const { autoMap, applyMapping, missingRequired } = require('../lib/mapping');
const { buildRecords } = require('../lib/records');
const { renderHtml } = require('../lib/render');
const { formatValue } = require('../lib/format');
const { generate } = require('../lib/generate');

function createController({ htmlDir, settings, renderPdf, today }) {
  const s = {
    template: null, templateId: null, templateError: null,
    table: null, filePath: null, sheet: null, dataError: null,
    mapping: {}, built: null, missing: [],
  };

  function rebuild() {
    s.built = null;
    s.missing = [];
    if (!s.template) return;
    if (!s.table) {
      s.mapping = {};
      return;
    }
    const saved = settings.get(`mapping:${s.template.id}`, {});
    s.mapping = autoMap(s.table.headers, s.template.fields, saved);
    for (const [field, header] of Object.entries(saved)) {
      if (header === null && field in s.mapping) s.mapping[field] = null; // user chose "not mapped"
    }
    s.missing = missingRequired(s.template.fields, s.mapping);
    if (s.missing.length) return;
    s.built = buildRecords(applyMapping(s.table.rows, s.mapping), s.table.rowNumbers, s.template, { today: today || new Date() });
  }

  function sample() {
    if (!s.template || !s.table || !s.table.rows.length) return {};
    const first = s.table.rows[0];
    return Object.fromEntries(s.template.fields.map((f) => {
      const header = s.mapping[f.name];
      return [f.name, header ? formatValue(first[header], f, s.template.manifest.locale).text : ''];
    }));
  }

  function status() {
    return {
      htmlDir,
      templates: listTemplates(htmlDir),
      template: s.template ? { id: s.template.id, name: s.template.name, fields: s.template.fields } : null,
      templateError: s.templateError,
      data: s.table ? { filePath: s.filePath, sheets: s.table.sheets, sheet: s.table.sheet, headers: s.table.headers, rowCount: s.table.rows.length } : null,
      dataError: s.dataError,
      mapping: s.mapping,
      missing: s.missing,
      records: s.built ? s.built.records.map(({ index, title, listCount, warnings, skipped }) => ({ index, title, listCount, warnings, skipped })) : [],
      issues: s.built ? s.built.issues : [],
      outputDir: s.templateId ? settings.get(`output:${s.templateId}`, null) : null,
      sample: sample(),
    };
  }

  function selectTemplate(id) {
    s.templateId = id;
    s.template = null;
    s.templateError = null;
    try {
      s.template = loadTemplate(path.join(htmlDir, id));
      settings.set('lastTemplate', id);
    } catch (err) {
      s.templateError = err.message;
    }
    rebuild();
    return status();
  }

  function loadData(filePath, sheet) {
    s.filePath = filePath;
    s.dataError = null;
    try {
      s.table = readTable(filePath, { sheet });
      s.sheet = s.table.sheet;
    } catch (err) {
      s.table = null;
      s.dataError = err.message;
    }
    rebuild();
    return status();
  }

  function reload() {
    if (s.templateId) selectTemplate(s.templateId);
    if (s.filePath) loadData(s.filePath, s.sheet);
    return status();
  }

  function setMapping(mapping) {
    if (!s.template) throw new Error('Choose a template first.');
    settings.set(`mapping:${s.template.id}`, mapping);
    rebuild();
    return status();
  }

  function previewFile(index) {
    if (!s.template) throw new Error(s.templateError || 'Choose a template first.');
    const record = s.built && index !== null && index !== undefined ? s.built.records[index] : null;
    const html = renderHtml(s.template.html, record || { view: {} });
    const file = path.join(s.template.dir, '_preview-app.html');
    fs.writeFileSync(file, html, 'utf8');
    return file;
  }

  function setOutputDir(dir) {
    if (!s.templateId) throw new Error('Choose a template first.');
    settings.set(`output:${s.templateId}`, dir);
  }

  async function runGenerate({ indices = null, combine = false, onProgress } = {}) {
    if (!s.template) throw new Error('Choose a template first.');
    if (!s.built) throw new Error(s.missing.length ? `Map the required fields first: ${s.missing.join(', ')}` : 'Open a data file first.');
    const outDir = settings.get(`output:${s.templateId}`, null);
    if (!outDir) throw new Error('Choose an output folder first.');
    const chosen = indices ? s.built.records.filter((r) => indices.includes(r.index)) : s.built.records;
    return generate({ template: s.template, records: chosen, outDir, combine, renderPdf, onProgress });
  }

  function newTemplate(name) {
    const id = createTemplate(htmlDir, name);
    return selectTemplate(id);
  }

  return {
    listTemplates: () => listTemplates(htmlDir),
    selectTemplate, loadData, reload, setMapping, status, previewFile, setOutputDir,
    generate: runGenerate, newTemplate,
    state: () => ({ templateDir: s.template ? s.template.dir : null, filePath: s.filePath }),
  };
}

module.exports = { createController };
