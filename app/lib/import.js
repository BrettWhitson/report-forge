'use strict';
// Read a spreadsheet, delimited text, or JSON file into headers + row objects.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { decodeText, detectDelimiter, parseDelimited } = require('./csv');

const SUPPORTED_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.xlsb', '.ods', '.csv', '.tsv', '.txt', '.json'];

class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') throw new ImportError(`File not found: ${filePath}`);
    if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
      throw new ImportError(`Cannot read ${path.basename(filePath)}: it is open or locked by another program.`);
    }
    throw new ImportError(`Cannot read ${path.basename(filePath)}: ${err.message}`);
  }
}

function cleanValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const s = value.trim();
    return s === '' ? null : s;
  }
  if (typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value);
  return value;
}

// date1904: the workbook counts days from 1904 (older Mac Excel) instead of 1900.
function cellValue(cell, date1904 = false) {
  if (!cell || cell.v === undefined || cell.v === null || cell.t === 'e') return null;
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    const d = XLSX.SSF.parse_date_code(cell.v, { date1904 });
    return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, Math.floor(d.S)));
  }
  if (cell.t === 'd' && cell.v instanceof Date) {
    const v = cell.v;
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds()));
  }
  return cleanValue(cell.v);
}

function sheetGrid(ws, date1904) {
  if (!ws || !ws['!ref']) return { grid: [], firstRow: 1 };
  const range = XLSX.utils.decode_range(ws['!ref']);
  const grid = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) row.push(cellValue(ws[XLSX.utils.encode_cell({ r, c })], date1904));
    grid.push(row);
  }
  return { grid, firstRow: range.s.r + 1 };
}

function uniqueHeaders(row) {
  const seen = new Map();
  return row.map((cell) => {
    if (cell === null) return null;
    const base = String(cell instanceof Date ? cell.toISOString().slice(0, 10) : cell).trim();
    const n = (seen.get(base.toLowerCase()) || 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

function gridToTable(grid, firstRow) {
  const isEmpty = (row) => row.every((v) => v === null);
  const h = grid.findIndex((row) => !isEmpty(row));
  if (h === -1) return { headers: [], rows: [], rowNumbers: [] };
  const headers = uniqueHeaders(grid[h]);
  const rows = [];
  const rowNumbers = [];
  for (let r = h + 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (isEmpty(row)) continue;
    const obj = {};
    headers.forEach((name, c) => {
      if (name !== null) obj[name] = row[c] === undefined ? null : row[c];
    });
    rows.push(obj);
    rowNumbers.push(firstRow + r);
  }
  return { headers: headers.filter((x) => x !== null), rows, rowNumbers };
}

function readWorkbook(buffer, sheet) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellNF: true, cellDates: false, WTF: false });
  } catch (err) {
    throw new ImportError(`Cannot read workbook: ${err.message}`);
  }
  const sheets = wb.SheetNames;
  const chosen = sheet && sheets.includes(sheet) ? sheet : sheets[0];
  const date1904 = Boolean(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
  const { grid, firstRow } = sheetGrid(wb.Sheets[chosen], date1904);
  return { sheets, sheet: chosen, ...gridToTable(grid, firstRow) };
}

function readDelimited(buffer, ext) {
  const text = decodeText(buffer);
  const delimiter = ext === '.tsv' ? '\t' : detectDelimiter(text);
  const grid = parseDelimited(text, delimiter).map((row) => row.map(cleanValue));
  return { sheets: [], sheet: null, ...gridToTable(grid, 1) };
}

function readJson(buffer) {
  let data;
  try {
    data = JSON.parse(decodeText(buffer));
  } catch (err) {
    throw new ImportError(`Invalid JSON: ${err.message}`);
  }
  if (!Array.isArray(data) || data.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
    throw new ImportError('JSON data must be an array of objects, one object per row.');
  }
  const headers = [];
  for (const r of data) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
  const rows = data.map((r) => Object.fromEntries(headers.map((k) => [k, cleanValue(r[k])])));
  return { sheets: [], sheet: null, headers, rows, rowNumbers: rows.map((_, i) => i + 1) };
}

function readTable(filePath, { sheet } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new ImportError(`Unsupported file type ${ext || '(none)'}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }
  const buffer = readFile(filePath);
  if (ext === '.json') return readJson(buffer);
  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') return readDelimited(buffer, ext);
  return readWorkbook(buffer, sheet);
}

module.exports = { readTable, ImportError, SUPPORTED_EXTENSIONS };
