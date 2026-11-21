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
  displayRows?: unknown[][];
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

function toImportTable(
  name: string, grid: unknown[][], firstRowHeader: boolean, displayGrid?: unknown[][],
): ImportTable {
  const preamble = scanPreamble(grid);
  const start = preamble?.start ?? 0;
  const hasValue = preamble ? nonempty : (cell: unknown) => cell != null && cell !== '';
  const cleaned = grid.flatMap((row, index) =>
    index >= start && row.some(hasValue) ? [{ row, index }] : [],
  );
  const width = preamble
    ? cleaned.reduce<number>((max, { row }) => Math.max(max, row.findLastIndex(nonempty) + 1), preamble.columns.length)
    : cleaned.reduce((max, { row }) => Math.max(max, row.length), 1);
  const header = preamble?.columns ?? (firstRowHeader ? cleaned[0]?.row : undefined);
  const columns = Array.from({ length: width }, (_, col) =>
    String(header?.[col] ?? '').trim() || `Col${col + 1}`,
  );
  const body = firstRowHeader && !preamble ? cleaned.slice(1) : cleaned;
  return {
    name,
    columns,
    rows: body.map(({ row }) => row),
    displayRows: displayGrid && body.map(({ index }) => displayGrid[index]),
    fixedHeader: preamble ? true : undefined,
    skippedPreambleRows: preamble?.start,
  };
}

export function datasetFromTable(table: ImportTable, id: string): Dataset {
  const textColumns = table.columns.flatMap((_, col) => {
    const values = table.displayRows ?? table.rows;
    return values.some((row) => typeof row[col] === 'string' && paddedInteger.test(row[col].trim()))
      ? [col]
      : [];
  });
  const text = new Set(textColumns);
  return {
    id,
    name: table.name,
    columns: table.columns,
    textColumns,
    rows: table.rows.map((row, ri) => table.columns.map((_, ci) =>
      parseCell(text.has(ci) ? table.displayRows?.[ri]?.[ci] ?? row[ci] : row[ci], text.has(ci)),
    )),
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
  return { name, columns: columns.length ? columns : ['Col1'], rows, fixedHeader: true };
}

export async function inspectFile(file: File, firstRowHeader: boolean): Promise<ImportTable[]> {
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext && workbookExtensions.has(ext)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return wb.SheetNames.map((sheetName) => {
      const sheet = wb.Sheets[sheetName];
      const options = { header: 1 as const, defval: null };
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, options);
      const formatted = XLSX.utils.sheet_to_json<unknown[]>(sheet, { ...options, raw: false });
      const name = wb.SheetNames.length > 1 ? `${baseName} · ${sheetName}` : baseName;
      return { ...toImportTable(name, grid, firstRowHeader, formatted), sheet: sheetName };
    });
  }
  const text = await file.text();
  return [ext === 'json' ? inspectJson(text, baseName, firstRowHeader) : inspectDelimitedText(text, baseName, firstRowHeader)];
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
  return ds.columns
    .map((_, i) => i)
    .filter((i) => {
      const vals = ds.rows.map((r) => r[i]).filter((v) => v !== null);
      if (vals.length === 0) return false;
      const numeric = vals.filter((v) => typeof v === 'number').length;
      return numeric / vals.length > 0.6;
    });
}
