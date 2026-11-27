import Papa from 'papaparse';
import type { CellValue, Dataset } from '../types';

const workbookExtensions = new Set(['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'fods']);
const paddedInteger = /^[+-]?0[0-9]+$/;
const delimiters = [',', '\t', ';', '|'];
const scanParameters = new Set(['labels', 'type', 'start', 'stop', 'step', 'fixed/offset']);
const scanHeaderLimit = 128;

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export interface ImportTable {
  name: string;
  sheet?: string;
  columns: string[];
  rows: unknown[][];
  textColumns: number[];
  fixedHeader?: boolean;
  skippedPreambleRows?: number;
}

function nonempty(cell: unknown): boolean {
  return cell != null && String(cell).trim() !== '';
}

function numeric(cell: unknown): boolean {
  return typeof cell === 'number' ? Number.isFinite(cell) :
    typeof cell === 'string' && cell.trim() !== '' && Number.isFinite(Number(cell));
}

function scanPreamble(grid: unknown[][]): { start: number; columns: [string, string] } | undefined {
  const parameters = new Set<string>();
  let xAxis = '';
  let yAxis = '';
  for (let index = 0; index < Math.min(grid.length, scanHeaderLimit); index += 1) {
    const [key, value] = grid[index];
    if (numeric(key) && (!nonempty(value) || numeric(value))) {
      return xAxis && yAxis && parameters.size >= 2 ? { start: index, columns: [xAxis, yAxis] } : undefined;
    }
    const name = String(key ?? '').trim().toLowerCase().replace(/\s+/g, '');
    if (scanParameters.has(name)) parameters.add(name);
    if (name === 'xaxis') xAxis = String(value ?? '').trim();
    if (name === 'yaxis') yAxis = String(value ?? '').trim();
  }
}

export function parseCell(value: unknown, asText = false): CellValue {
  if (value == null) return null;
  const text = String(value).trim();
  if (text === '') return null;
  if (asText || (typeof value === 'string' && paddedInteger.test(text))) return text;
  if (typeof value === 'number') return value;
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

export function toImportTable(
  name: string, grid: unknown[][], firstRowHeader: boolean,
  formatted?: (row: number, column: number) => unknown,
): ImportTable {
  const preamble = scanPreamble(grid);
  const start = preamble?.start ?? 0;
  const hasValue = preamble ? nonempty : (cell: unknown) => cell != null && cell !== '';
  let width = preamble?.columns.length ?? 1;
  let header: unknown[] | undefined = preamble?.columns;
  const body: { row: unknown[]; index: number }[] = [];
  const textColumns = new Set<number>();
  for (let index = start; index < grid.length; index += 1) {
    const row = grid[index];
    if (!row.some(hasValue)) continue;
    width = Math.max(width, preamble ? row.findLastIndex(nonempty) + 1 : row.length);
    if (!header && firstRowHeader) {
      header = row;
      continue;
    }
    body.push({ row, index });
    for (let column = 0; column < row.length; column += 1) {
      if (textColumns.has(column)) continue;
      const value = formatted?.(index, column) ?? row[column];
      if (typeof value === 'string' && paddedInteger.test(value.trim())) textColumns.add(column);
    }
  }
  const columns = Array.from({ length: width }, (_, column) =>
    String(header?.[column] ?? '').trim() || `Col${column + 1}`,
  );
  return {
    name,
    columns,
    rows: body.map(({ row, index }) => formatted && textColumns.size
      ? row.map((value, column) => textColumns.has(column) ? formatted(index, column) ?? value : value)
      : row),
    textColumns: [...textColumns].sort((a, b) => a - b),
    fixedHeader: preamble ? true : undefined,
    skippedPreambleRows: preamble?.start,
  };
}

export function datasetFromTable(table: ImportTable, id: string): Dataset {
  const text = new Set(table.textColumns);
  return {
    id,
    name: table.name,
    columns: table.columns,
    textColumns: table.textColumns,
    rows: table.rows.map((row) => table.columns.map((_, column) => parseCell(row[column], text.has(column)))),
  };
}

export function inspectDelimitedText(text: string, name: string, firstRowHeader: boolean): ImportTable {
  let result = Papa.parse<string[]>(text, { delimitersToGuess: delimiters });
  // Uneven parameter rows can confuse delimiter guessing before it reaches the measurements.
  const prefix = text.slice(0, 32_768);
  if (/^\s*"?x\s*axis"?\s*[,\t;|]/im.test(prefix) &&
      /^\s*"?y\s*axis"?\s*[,\t;|]/im.test(prefix) && !scanPreamble(result.data)) {
    const detected = delimiters.find((delimiter) => delimiter !== result.meta.delimiter &&
      scanPreamble(Papa.parse<string[]>(text, { delimiter, preview: scanHeaderLimit }).data));
    if (detected) result = Papa.parse<string[]>(text, { delimiter: detected });
  }
  const brokenQuote = result.errors.find((error) => error.type === 'Quotes');
  if (brokenQuote) throw new Error(brokenQuote.message);
  return toImportTable(name, result.data, firstRowHeader);
}

function inspectJson(text: string, name: string, firstRowHeader: boolean): ImportTable {
  const entries: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!Array.isArray(entries)) throw new Error('Expected a JSON array of rows');
  if (entries.every(Array.isArray)) return toImportTable(name, entries, firstRowHeader);
  const records = entries.filter((entry): entry is Record<string, unknown> =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry));
  if (records.length !== entries.length) throw new Error('Expected rows with a consistent structure');
  const columns = [...new Set(records.flatMap(Object.keys))];
  const rows = records.map((record) => columns.map((key) => {
    const value = Object.hasOwn(record, key) ? record[key] : null;
    return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
  }));
  const table = toImportTable(name, [columns, ...rows], true);
  return { ...table, columns: columns.length ? columns : ['Col1'], rows, fixedHeader: true };
}

export interface ImportSheet {
  name: string;
  sheet?: string;
  read(): ImportTable;
}

export async function inspectFile(
  file: File | { name: string; buffer: ArrayBuffer }, firstRowHeader: boolean,
): Promise<ImportSheet[]> {
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext && workbookExtensions.has(ext)) {
    const XLSX = await import('xlsx');
    const buffer = 'buffer' in file ? file.buffer : await file.arrayBuffer();
    const { SheetNames: sheets } = XLSX.read(buffer, { type: 'array', bookSheets: true });
    return sheets.map((sheetName) => {
      const name = sheets.length > 1 ? `${baseName} · ${sheetName}` : baseName;
      const read = () => {
        const workbook = XLSX.read(buffer, { type: 'array', dense: true, sheets: sheetName });
        const sheet = workbook.Sheets[sheetName];
        const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
        const origin = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1').s;
        const formatted = (row: number, column: number) => {
          const r = row + origin.r;
          const c = column + origin.c;
          return (sheet['!data'] ? sheet['!data'][r]?.[c] : sheet[XLSX.utils.encode_cell({ r, c })])?.w;
        };
        return { ...toImportTable(name, grid, firstRowHeader, formatted), sheet: sheetName };
      };
      return { name, sheet: sheetName, read };
    });
  }
  const text = 'buffer' in file ? new TextDecoder().decode(file.buffer) : await file.text();
  const read = () => ext === 'json' ? inspectJson(text, baseName, firstRowHeader) : inspectDelimitedText(text, baseName, firstRowHeader);
  return [{ name: baseName, read }];
}

/** Extract numeric values of one column. */
export function numericColumn(ds: Dataset, col: number): number[] {
  if (col < 0 || col >= ds.columns.length) return [];
  return ds.rows
    .map((r) => r[col])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/** All column indices that contain mostly numbers. */
export function numericColumnIndices(ds: Dataset): number[] {
  const populated = new Uint32Array(ds.columns.length);
  const numeric = new Uint32Array(ds.columns.length);
  for (const row of ds.rows) {
    for (let column = 0; column < ds.columns.length; column += 1) {
      const value = row[column];
      if (value !== null) populated[column] += 1;
      if (typeof value === 'number') numeric[column] += 1;
    }
  }
  return ds.columns.flatMap((_, index) => numeric[index] > populated[index] * 0.6 ? [index] : []);
}
