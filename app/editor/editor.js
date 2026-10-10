'use strict';
// Template editor: GrapesJS canvas with print pages, page setup, snapshot undo, source view, save and Test PDF.
// Templates only: no data is ever loaded here; merge fields stay as raw {{tags}}.
import grapesjs from 'grapesjs';
import { createSourceEditors } from './source.js';

const model = require('../lib/template-model');
const { History, sameSnapshot } = require('../lib/history');

const api = window.editorApi;
const $ = (sel) => document.querySelector(sel);

// Canvas-only styling (never saved): pages on a gray desk, script placeholders visible.
const DESK_CSS = `
  html { background: #8a8d99; }
  @media (prefers-color-scheme: dark) { html { background: #2b2d33; } }
  body { margin: 0 !important; padding: 24px 0 !important; background: transparent !important; }
  section.page { margin: 0 auto 24px !important; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35); background: #fff; }
  rf-script { display: block; margin: 4px auto; width: 816px; max-width: 100%; padding: 4px 8px; font: 12px/1.4 Arial, sans-serif;
    color: #555; background: #f3f3f3; border: 1px dashed #999; border-radius: 4px; }
  rf-script::before { content: "Code block (script or style) — edit in Source"; }
`;

const state = {
  parts: { before: '', body: '', after: '' },
  css: '',
  settings: '',
  assetsBase: '',
  setup: { size: 'letter', orientation: 'portrait' },
  history: new History(),
  saved: null,
  mode: 'visual',
  sourceTab: 'html',
  sourceDirty: false,
  applying: false,
  ignoreUpdatesUntil: 0,
  saving: false,
  lead: '',
};
let editor = null;
let source = null;
let recordTimer = null;

function showMessage(text) {
  $('#message').hidden = !text;
  $('#message').textContent = text || '';
}

function stripBody(html) {
  return html.replace(/^\s*<body\b[^>]*>/i, '').replace(/<\/body>\s*$/i, '');
}

function snapshot() {
  return {
    body: state.lead + model.restore(stripBody(editor.getHtml())),
    css: state.css,
    settings: state.settings,
    before: state.parts.before,
    after: state.parts.after,
  };
}

// Text being typed lives only in the DOM until editing ends; commit it to the model before snapshots.
async function commitEditing() {
  const editing = editor && editor.getEditing();
  const view = editing && editing.getView();
  if (view && view.disableEditing) await view.disableEditing();
}

function fullHtml(snap) {
  return model.joinDocument({ before: snap.before ?? state.parts.before, body: snap.body, after: snap.after ?? state.parts.after });
}

function bundleFrom(snap) {
  return { html: fullHtml(snap), css: snap.css, settings: snap.settings };
}

function isDirty() {
  return state.sourceDirty || !sameSnapshot(state.history.current(), state.saved);
}

function updateChrome() {
  $('#undo').disabled = !state.history.canUndo() || state.mode === 'source';
  $('#redo').disabled = !state.history.canRedo() || state.mode === 'source';
  api.setDirty(isDirty()).catch(() => {});
}

function record() {
  clearTimeout(recordTimer);
  recordTimer = null;
  if (state.applying || !editor) return;
  state.history.push(snapshot());
  renderPages();
  updateChrome();
}

function scheduleRecord() {
  // GrapesJS fires 'update' asynchronously after setComponents; those echoes of an undo/redo/reload
  // must not be recorded, or they would wipe the redo steps.
  if (state.applying || Date.now() < state.ignoreUpdatesUntil) return;
  clearTimeout(recordTimer);
  recordTimer = setTimeout(record, 250);
}

// ----- canvas -----

function injectCanvas() {
  const doc = editor.Canvas.getDocument();
  if (!doc) return;
  let base = doc.querySelector('base#rf-base');
  if (!base) {
    base = doc.createElement('base');
    base.id = 'rf-base';
    doc.head.prepend(base);
  }
  base.href = state.assetsBase;
  let tpl = doc.getElementById('rf-template-css');
  if (!tpl) {
    tpl = doc.createElement('style');
    tpl.id = 'rf-template-css';
    doc.head.append(tpl);
  }
  tpl.textContent = state.css;
  let desk = doc.getElementById('rf-desk-css');
  if (!desk) {
    desk = doc.createElement('style');
    desk.id = 'rf-desk-css';
    doc.head.append(desk);
  }
  desk.textContent = DESK_CSS;
  doc.querySelectorAll('[data-rf-style]').forEach(showParkedStyle);
  // No keydown listener here: GrapesJS re-dispatches canvas key events to the parent document.
}

// Leading whitespace/comments are kept outside GrapesJS (it drops them) and re-attached by snapshot().
// Inline styles are parked as data-rf-style in the model (see template-model protect); show them on the canvas.
function showParkedStyle(el) {
  const parked = el.getAttribute('data-rf-style');
  if (parked !== null && el.getAttribute('style') !== parked) el.setAttribute('style', parked);
}

function loadComponents(body) {
  const { lead, core } = model.prepareForEditor(body);
  state.lead = lead;
  state.applying = true;
  editor.setComponents(core);
  state.applying = false;
}

function applySnapshot(snap) {
  clearTimeout(recordTimer);
  recordTimer = null;
  state.ignoreUpdatesUntil = Date.now() + 400;
  state.css = snap.css;
  state.settings = snap.settings;
  if (snap.before !== undefined) state.parts = { before: snap.before, body: snap.body, after: snap.after };
  loadComponents(snap.body);
  state.setup = model.parsePageSetup(state.css);
  injectCanvas();
  syncSetupControls();
  renderPages();
  updateChrome();
}

// ----- pages -----

function pages() {
  return editor.getWrapper().components().filter((c) => c.getClasses().includes('page'));
}

function pageLabel(page, n) {
  const heading = page.find('h1, h2, h3')[0];
  const text = heading ? heading.getEl()?.textContent?.trim() : '';
  return text ? text.slice(0, 40) : `Page ${n}`;
}

function movePage(page, delta) {
  const list = pages();
  const target = list[list.indexOf(page) + delta];
  if (!target) return;
  const wrapper = editor.getWrapper();
  page.remove({ temporary: true });
  const to = wrapper.components().indexOf(target);
  wrapper.append(page, { at: delta < 0 ? to : to + 1 });
  scheduleRecord();
}

function renderPages() {
  if (!editor) return;
  const list = $('#page-list');
  const all = pages();
  const hasLoose = editor.getWrapper().components().some((c) => !c.getClasses().includes('page') && c.get('type') !== 'textnode' && c.get('type') !== 'comment' && c.get('type') !== 'rf-script');
  $('#convert-pages').hidden = all.length > 0 || !hasLoose;
  const selected = editor.getSelected();
  list.replaceChildren(...all.map((page, i) => {
    const li = document.createElement('li');
    if (selected && (selected === page || selected.closest?.('section.page') === page)) li.className = 'selected';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = `${i + 1}. ${pageLabel(page, i + 1)}`;
    label.addEventListener('click', () => { editor.select(page); page.getEl()?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    const actions = document.createElement('div');
    actions.className = 'actions';
    const btn = (text, titleText, fn, disabled) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = titleText;
      b.disabled = Boolean(disabled);
      b.addEventListener('click', fn);
      return b;
    };
    const kind = document.createElement('select');
    kind.innerHTML = '<option value="fixed">Fixed</option><option value="flow">Grows</option>';
    kind.value = page.getClasses().includes('flow') ? 'flow' : 'fixed';
    kind.title = 'Fixed: one sheet. Grows: continues onto more sheets as content needs.';
    kind.addEventListener('change', () => {
      if (kind.value === 'flow') page.addClass('flow'); else page.removeClass('flow');
      scheduleRecord();
    });
    actions.append(
      btn('↑', 'Move up', () => movePage(page, -1), i === 0),
      btn('↓', 'Move down', () => movePage(page, 1), i === all.length - 1),
      btn('⧉', 'Duplicate', () => { const copy = page.clone(); editor.getWrapper().append(copy, { at: editor.getWrapper().components().indexOf(page) + 1 }); scheduleRecord(); }),
      btn('✕', 'Delete page', () => { if (window.confirm(`Delete page ${i + 1}?`)) { page.remove(); scheduleRecord(); } }),
      kind,
    );
    li.append(label, actions);
    return li;
  }));
}

function addPage() {
  const added = editor.getWrapper().append('<section class="page"></section>');
  record();
  return added[0];
}

function convertToPages() {
  const wrapper = editor.getWrapper();
  const children = wrapper.components().models.slice();
  const html = children.map((c) => c.toHTML()).join('');
  wrapper.components(`<section class="page">${html}</section>`);
  record();
}

// ----- page setup -----

function syncSetupControls() {
  const s = state.setup;
  $('#paper-size').value = s.size;
  $('#orientation').value = s.orientation;
  $('#custom-size').hidden = s.size !== 'custom';
  if (s.size === 'custom') {
    $('#custom-width').value = s.width;
    $('#custom-height').value = s.height;
    $('#custom-unit').value = s.unit;
  }
}

function setPageSetup(setup) {
  state.setup = setup;
  state.css = model.applyPageSetup(state.css, setup);
  injectCanvas();
  syncSetupControls();
  record();
}

function setupFromControls() {
  const size = $('#paper-size').value;
  const setup = { size, orientation: $('#orientation').value };
  if (size === 'custom') {
    const d = model.pageDimensions(state.setup.size === 'custom' ? state.setup : { ...state.setup, orientation: 'portrait' });
    setup.width = Number($('#custom-width').value) || d.width;
    setup.height = Number($('#custom-height').value) || d.height;
    setup.unit = $('#custom-unit').value || d.unit;
  }
  return setup;
}

// ----- source view -----

async function enterSource() {
  if (state.mode === 'source') return;
  await commitEditing();
  record();
  const snap = state.history.current();
  source.set('html', fullHtml(snap));
  source.set('css', snap.css);
  source.set('settings', snap.settings);
  state.sourceDirty = false;
  state.mode = 'source';
  $('#visual').hidden = true;
  $('#source').hidden = false;
  $('#mode-visual').classList.remove('active');
  $('#mode-source').classList.add('active');
  source.show(state.sourceTab);
  updateChrome();
}

function selectTab(tab) {
  state.sourceTab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  source.show(tab);
}

async function leaveSource() {
  if (state.mode !== 'source') return true;
  const bundle = { html: source.get('html'), css: source.get('css'), settings: source.get('settings') };
  let problem;
  try {
    problem = await api.validate(bundle);
  } catch (err) {
    showMessage(`Could not check the source: ${err.message}`);
    return false;
  }
  if (problem) {
    showMessage(`${problem.message} (${problem.tab.toUpperCase()}, line ${problem.line})`);
    selectTab(problem.tab);
    source.highlightLine(problem.tab, problem.line);
    return false;
  }
  showMessage('');
  if (state.sourceDirty) {
    const parts = model.splitDocument(bundle.html);
    applySnapshot({ body: parts.body, css: bundle.css, settings: bundle.settings, before: parts.before, after: parts.after });
  }
  state.sourceDirty = false;
  state.mode = 'visual';
  $('#source').hidden = true;
  $('#visual').hidden = false;
  $('#mode-source').classList.remove('active');
  $('#mode-visual').classList.add('active');
  editor.refresh();
  injectCanvas();
  record();
  return true;
}

// ----- save, test, undo -----

async function save() {
  if (state.saving) return { ok: false };
  state.saving = true;
  try {
    if (!(await leaveSource())) return { ok: false };
    await commitEditing();
    record();
    const snap = state.history.current();
    const result = await api.save(bundleFrom(snap));
    if (!result.ok) {
      showMessage(`${result.problem.message} (${result.problem.tab.toUpperCase()}, line ${result.problem.line})`);
      return result;
    }
    state.saved = snap;
    showMessage('');
    updateChrome();
    return result;
  } catch (err) {
    showMessage(`Save failed: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    state.saving = false;
  }
}

async function testPdf() {
  if (!(await leaveSource())) return;
  await commitEditing();
  record();
  try {
    await api.testPdf(bundleFrom(state.history.current()));
  } catch (err) {
    showMessage(`Test PDF failed: ${err.message}`);
  }
}

async function undo() {
  if (state.mode === 'source') return;
  await commitEditing();
  record();
  const snap = state.history.undo();
  if (snap) applySnapshot(snap);
}

async function redo() {
  if (state.mode === 'source') return;
  await commitEditing();
  // A pending edit would be a new branch; recording it first correctly drops redo.
  if (recordTimer) record();
  const snap = state.history.redo();
  if (snap) applySnapshot(snap);
}

function onKeyDown(e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 's') { e.preventDefault(); save(); return; }
  // Native undo inside code editors, form fields, and text being edited on the canvas.
  const field = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  if (state.mode === 'source' || field || editor.getEditing()) return;
  if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
}

// ----- startup -----

function defineScriptComponent() {
  editor.DomComponents.addType('rf-script', {
    isComponent: (el) => el.tagName === 'RF-SCRIPT',
    model: { defaults: { draggable: false, droppable: false, editable: false, copyable: false, removable: false, highlightable: true } },
  });
}

async function start() {
  const data = await api.load();
  document.title = `Edit — ${data.name}`;
  state.parts = model.splitDocument(data.html);
  state.css = data.css;
  state.settings = data.settings;
  state.assetsBase = data.assetsBase;
  state.setup = model.parsePageSetup(state.css);
  const prepared = model.prepareForEditor(state.parts.body);
  state.lead = prepared.lead;

  editor = grapesjs.init({
    container: '#gjs',
    height: '100%',
    width: 'auto',
    fromElement: false,
    telemetry: false,
    storageManager: false,
    cssIcons: '', // GrapesJS would otherwise load Font Awesome from a CDN
    canvas: { styles: [], scripts: [] },
    undoManager: false, // Report Forge keeps its own snapshot history
    panels: { defaults: [] },
    protectedCss: '',
    canvasCss: '',
    avoidInlineStyle: true,
    parser: { optionsHtml: { allowScripts: false, allowUnsafeAttr: true, allowUnsafeAttrValue: true, keepEmptyTextNodes: true } },
    richTextEditor: { actions: ['bold', 'italic', 'link'] },
    plugins: [(ed) => { editor = ed; defineScriptComponent(); }],
    components: prepared.core,
  });
  editor.on('canvas:frame:load', injectCanvas);
  editor.on('component:mount component:update:attributes', (c) => { const el = c.getEl(); if (el && el.getAttribute) showParkedStyle(el); });
  editor.on('load', () => {
    // Undo/redo shortcuts are handled by onKeyDown against Report Forge's history only.
    editor.Keymaps.remove('core:undo');
    editor.Keymaps.remove('core:redo');
    injectCanvas();
    syncSetupControls();
    state.history.push(snapshot());
    state.saved = state.history.current();
    renderPages();
    updateChrome();
    window.rfEditor.ready = true;
  });
  editor.on('update', scheduleRecord);
  editor.on('component:selected component:deselected', renderPages);

  source = createSourceEditors($('#source-editors'), () => { state.sourceDirty = true; updateChrome(); });

  $('#mode-visual').addEventListener('click', () => leaveSource());
  $('#mode-source').addEventListener('click', enterSource);
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  $('#paper-size').addEventListener('change', () => setPageSetup(setupFromControls()));
  $('#orientation').addEventListener('change', () => setPageSetup(setupFromControls()));
  ['#custom-width', '#custom-height', '#custom-unit'].forEach((s) => $(s).addEventListener('change', () => setPageSetup(setupFromControls())));
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#save').addEventListener('click', save);
  $('#test-pdf').addEventListener('click', testPdf);
  $('#add-page').addEventListener('click', addPage);
  $('#convert-pages').addEventListener('click', convertToPages);
  document.addEventListener('keydown', onKeyDown);

  api.onSaveAndClose(async () => { const r = await save(); if (r.ok) api.closeAfterSave(); });
  api.onReload(async () => {
    const fresh = await api.load();
    const parts = model.splitDocument(fresh.html);
    state.history = new History();
    applySnapshot({ body: parts.body, css: fresh.css, settings: fresh.settings, before: parts.before, after: parts.after });
    state.history.push(snapshot());
    state.saved = state.history.current();
    updateChrome();
  });
}

window.rfEditor = {
  ready: false,
  get editor() { return editor; },
  snapshot: () => snapshot(),
  flush: () => record(),
  save,
  isDirty,
  addPage,
  pages: () => pages(),
  setPageSetup,
  getPageSetup: () => state.setup,
  enterSource,
  leaveSource,
  setSource: (tab, text) => { source.set(tab, text); state.sourceDirty = true; },
  undo,
  redo,
  canUndo: () => state.history.canUndo(),
  canRedo: () => state.history.canRedo(),
};

start().catch((err) => showMessage(`Could not open the template: ${err.message}`));
