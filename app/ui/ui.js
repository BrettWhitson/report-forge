'use strict';
const rf = window.reportForge;
const $ = (sel) => document.querySelector(sel);
let status = null;
let active = null;
const checked = new Set();

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function showMessage(text, kind = 'error') {
  const box = $('#message');
  box.hidden = !text;
  box.textContent = text || '';
  box.className = `message ${kind === 'info' ? 'info' : ''}`;
}

async function run(fn) {
  try {
    return await fn();
  } catch (err) {
    showMessage(err.message);
    return null;
  }
}

function render() {
  const s = status;
  const sel = $('#template-select');
  sel.replaceChildren(...s.templates.map((t) => el('option', { value: t.id, selected: s.template && s.template.id === t.id }, t.name + (t.error ? ' (error)' : ''))));
  if (!s.templates.length) sel.append(el('option', { value: '' }, 'No templates found'));

  const errors = [s.templateError && `Template problem: ${s.templateError}`, s.dataError && `Data problem: ${s.dataError}`].filter(Boolean);
  if (s.missing.length) errors.push(`Map these required fields before generating: ${s.missing.join(', ')}`);
  if (s.issues.length) errors.push(...s.issues);
  showMessage(errors.join('\n'), s.templateError || s.dataError || s.missing.length ? 'error' : 'info');

  $('#data-file').textContent = s.data ? s.data.filePath : 'No data file. Open one or drop it on this window.';
  $('#sheet-wrap').hidden = !(s.data && s.data.sheets.length > 1);
  if (s.data && s.data.sheets.length > 1) {
    $('#sheet-select').replaceChildren(...s.data.sheets.map((name) => el('option', { value: name, selected: name === s.data.sheet }, name)));
  }
  const ready = s.records.filter((r) => !r.skipped).length;
  $('#record-count').textContent = s.data ? `${s.data.rowCount} rows → ${s.records.length} documents${s.records.length !== ready ? ` (${s.records.length - ready} skipped)` : ''}` : '';

  renderMapping();
  renderRecords();
  $('#output-dir').textContent = s.outputDir || 'Not chosen';
  const canGenerate = ready > 0 && s.outputDir;
  $('#generate-all').disabled = !canGenerate;
  $('#generate-selected').disabled = !canGenerate || ![...checked].some((i) => s.records[i] && !s.records[i].skipped);
}

function renderMapping() {
  const s = status;
  const body = $('#mapping-body');
  if (!s.template || !s.data) {
    body.replaceChildren();
    $('#mapping-status').textContent = s.template ? '(open a data file)' : '';
    return;
  }
  const mapped = s.template.fields.filter((f) => s.mapping[f.name]).length;
  $('#mapping-status').textContent = `${mapped} of ${s.template.fields.length} fields mapped`;
  if (s.missing.length) $('#mapping-panel').open = true;
  body.replaceChildren(...s.template.fields.map((f) => {
    const select = el('select', { onchange: (e) => changeMapping(f.name, e.target.value || null) },
      el('option', { value: '' }, '— not mapped —'),
      ...s.data.headers.map((h) => el('option', { value: h, selected: s.mapping[f.name] === h }, h)));
    return el('tr', {},
      el('td', { class: f.required ? 'req' : '' }, f.label + (f.inList ? ' (list)' : '')),
      el('td', {}, f.format),
      el('td', {}, select),
      el('td', { class: 'muted' }, s.sample[f.name] || ''));
  }));
}

async function changeMapping(field, header) {
  const next = await run(() => rf.setMapping({ [field]: header }));
  if (next) { status = next; render(); refreshPreview(); }
}

function renderRecords() {
  const term = $('#search').value.trim().toLowerCase();
  const list = $('#record-list');
  list.replaceChildren(...status.records
    .filter((r) => !term || r.title.toLowerCase().includes(term))
    .map((r) => {
      const box = el('input', { type: 'checkbox', checked: checked.has(r.index), disabled: r.skipped, onclick: (e) => {
        e.stopPropagation();
        if (e.target.checked) checked.add(r.index); else checked.delete(r.index);
        render();
      } });
      return el('li', { class: `${r.index === active ? 'active' : ''} ${r.skipped ? 'skipped' : ''}`, title: r.warnings.join('\n'), onclick: () => { active = r.index; renderRecords(); refreshPreview(); } },
        box,
        el('span', { class: 'title' }, r.title),
        r.listCount !== null ? el('span', { class: 'count' }, `${r.listCount}`) : '',
        r.warnings.length ? el('span', { class: 'warn', 'aria-label': 'warnings' }, '!') : '');
    }));
}

async function refreshPreview() {
  if (!status || !status.template) return;
  const index = status.records.some((r) => r.index === active) ? active : (status.records[0] ? status.records[0].index : null);
  active = index;
  await run(() => rf.showPreview(index));
}

// The preview is a separate native view layered over #preview-pane; keep it aligned and hide it under dialogs.
function syncPreviewBounds() {
  const r = $('#preview-pane').getBoundingClientRect();
  const dialogOpen = [...document.querySelectorAll('dialog')].some((d) => d.open);
  rf.setPreviewBounds({ x: r.left, y: r.top, width: r.width, height: r.height }, !dialogOpen).catch(() => {});
}

async function refresh() {
  const s = await run(() => rf.status());
  if (s) { status = s; render(); refreshPreview(); }
}

async function loadData(filePath, sheet) {
  const s = await run(() => rf.loadData(filePath, sheet));
  if (s) { status = s; checked.clear(); active = null; render(); refreshPreview(); }
}

async function doGenerate(indices) {
  const progress = $('#progress');
  progress.hidden = false;
  progress.value = 0;
  $('#generate-all').disabled = true;
  $('#generate-selected').disabled = true;
  const result = await run(() => rf.generate({ indices, combine: $('#combine').checked }));
  progress.hidden = true;
  render();
  if (!result) return;
  $('#open-output').hidden = false;
  const body = $('#summary-body');
  body.replaceChildren(
    el('h3', {}, 'Done'),
    el('p', { class: 'ok' }, `${result.created.length} PDF${result.created.length === 1 ? '' : 's'} created.`),
    result.combinedPath ? el('p', {}, `Combined: ${result.combinedPath}`) : '',
    result.skipped ? el('p', { class: 'muted' }, `${result.skipped} skipped because of data problems.`) : '',
    ...(result.failed.length ? [el('p', { class: 'err' }, `${result.failed.length} failed:`), el('ul', {}, ...result.failed.map((f) => el('li', {}, `${f.title}: ${f.error}`)))] : []));
  $('#summary-dialog').showModal();
  syncPreviewBounds();
}

$('#template-select').addEventListener('change', async (e) => {
  const s = await run(() => rf.selectTemplate(e.target.value));
  if (s) { status = s; checked.clear(); active = null; render(); refreshPreview(); }
});
$('#open-data').addEventListener('click', async () => {
  const file = await run(() => rf.openDataDialog());
  if (file) loadData(file);
});
$('#sheet-select').addEventListener('change', (e) => loadData(status.data.filePath, e.target.value));
$('#search').addEventListener('input', renderRecords);
$('#select-all').addEventListener('click', () => { status.records.filter((r) => !r.skipped).forEach((r) => checked.add(r.index)); render(); });
$('#select-none').addEventListener('click', () => { checked.clear(); render(); });
$('#choose-output').addEventListener('click', async () => { if (await run(() => rf.chooseOutputDir())) refresh(); });
$('#generate-all').addEventListener('click', () => doGenerate(null));
$('#generate-selected').addEventListener('click', () => doGenerate([...checked]));
$('#open-output').addEventListener('click', () => run(() => rf.openOutputFolder()));
$('#open-template-folder').addEventListener('click', () => run(() => rf.openTemplateFolder()));
$('#new-template').addEventListener('click', () => { $('#new-template-name').value = ''; $('#new-template-dialog').showModal(); syncPreviewBounds(); });
$('#summary-dialog').addEventListener('close', syncPreviewBounds);
$('#new-template-dialog').addEventListener('close', async () => {
  syncPreviewBounds();
  if ($('#new-template-dialog').returnValue !== 'ok') return;
  const s = await run(() => rf.newTemplate($('#new-template-name').value));
  if (s) { status = s; render(); refreshPreview(); }
});
new ResizeObserver(syncPreviewBounds).observe($('#preview-pane'));
window.addEventListener('resize', syncPreviewBounds);
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) loadData(rf.pathForFile(file));
});
rf.onProgress((p) => { const bar = $('#progress'); bar.max = Math.max(p.total, 1); bar.value = p.done; });
rf.onChanged(refresh);
refresh();
