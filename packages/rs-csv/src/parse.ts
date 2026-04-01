import { interpretFields, interpretTyped } from "./interpret.js";
import { parseFn, parseFnStr, scanFieldsStr, scanFieldsBuf } from "./platform.js";
import type { FieldValue, Row, Converter } from "./types.js";

const MB = 1024 * 1024;
const cmdBuf = Buffer.alloc(16 * MB);
const emptyInput = new Uint8Array(0);

type ParseSource = {
  input: Uint8Array;
  nativeInput: string | Buffer;
  sliceStr: string | undefined;
  totalLength: number;
};

export interface ParseOptions {
  type?: boolean | Converter[];
  headers?: boolean;
}

function parseUnquotedJS(csv: string): string[][] {
  let start = 0;
  if (csv.charCodeAt(0) === 0xFEFF) {start = 1;}

  const firstNl = csv.indexOf('\n', start);
  let width = 1;
  const scanEnd = firstNl === -1 ? csv.length : firstNl;
  for (let i = start; i < scanEnd; i++) {
    if (csv.charCodeAt(i) === 44) {width++;}
  }

  const lastCol = width - 1;
  const rows: string[][] = [];
  let pos = start;
  const len = csv.length;

  while (pos < len) {
    if (csv.charCodeAt(pos) === 10) { pos++; continue; }
    if (csv.charCodeAt(pos) === 13 && csv.charCodeAt(pos + 1) === 10) { pos += 2; continue; }

    const row: string[] = new Array(width);
    for (let c = 0; c < lastCol; c++) {
      const next = csv.indexOf(',', pos);
      if (next === -1) {
        row[c] = csv.slice(pos);
        rows.push(row);
        return rows;
      }
      row[c] = csv.slice(pos, next);
      pos = next + 1;
    }
    const next = csv.indexOf('\n', pos);
    if (next === -1) {
      row[lastCol] = csv.slice(pos);
      rows.push(row);
      break;
    }
    const end = csv.charCodeAt(next - 1) === 13 ? next - 1 : next;
    row[lastCol] = csv.slice(pos, end);
    rows.push(row);
    pos = next + 1;
  }

  return rows;
}

function prepareParseSource(csv: string): ParseSource {
  if (parseFnStr) {
    const byteLength = Buffer.byteLength(csv);
    if (byteLength === csv.length) {
      return {
        input: emptyInput,
        nativeInput: csv,
        sliceStr: csv,
        totalLength: byteLength,
      };
    }
  }

  const input = Buffer.from(csv);
  return {
    input,
    nativeInput: input,
    sliceStr: undefined,
    totalLength: input.length,
  };
}

function callRustParse(source: ParseSource, offset: number, typed: boolean, strRow: boolean): number {
  if (typeof source.nativeInput === "string") {
    return Number(parseFnStr!(source.nativeInput, cmdBuf, offset, typed, strRow));
  }
  return Number(parseFn(source.nativeInput, cmdBuf, offset, typed, strRow));
}

function parseQuotedRows(csv: string): string[][] {
  if (scanFieldsStr && Buffer.byteLength(csv) === csv.length) {
    scanFieldsStr(csv, cmdBuf);
    return interpretFields(csv, cmdBuf);
  }
  const buf = Buffer.from(csv);
  scanFieldsBuf!(buf, cmdBuf);
  return interpretFields(csv, cmdBuf);
}

function parseAutotypedRows(csv: string): Row[] {
  const source = prepareParseSource(csv);
  const consumed = callRustParse(source, 0, true, false);
  if (consumed === 0) {return [];}

  const rows = interpretTyped(source.input, cmdBuf, source.sliceStr);
  if (consumed === source.totalLength) {return rows;}

  let wi = rows.length;
  for (let offset = consumed; offset < source.totalLength;) {
    const used = callRustParse(source, offset, true, false);
    if (used === 0) {break;}
    const chunk = interpretTyped(source.input, cmdBuf, source.sliceStr);
    for (let i = 0; i < chunk.length; i++) { rows[wi++] = chunk[i]; }
    offset += used;
  }

  return rows;
}

function parseAutotypedWithHeaders(csv: string): Record<string, FieldValue>[] {
  const source = prepareParseSource(csv);
  const consumed = callRustParse(source, 0, true, true);
  if (consumed === 0) {return [];}

  const firstChunk = interpretTyped(source.input, cmdBuf, source.sliceStr);
  if (firstChunk.length === 0) {return [];}

  const headers = firstChunk[0].map(String);
  const rows: Record<string, FieldValue>[] = new Array(firstChunk.length - 1);

  for (let i = 1; i < firstChunk.length; i++) {
    const obj: Record<string, FieldValue> = {};
    for (let j = 0; j < headers.length; j++) {obj[headers[j]] = firstChunk[i][j];}
    rows[i - 1] = obj;
  }

  let wi = rows.length;
  for (let offset = consumed; offset < source.totalLength;) {
    const used = callRustParse(source, offset, true, false);
    if (used === 0) {break;}
    const chunk = interpretTyped(source.input, cmdBuf, source.sliceStr);
    for (let i = 0; i < chunk.length; i++) {
      const row = chunk[i];
      const obj: Record<string, FieldValue> = {};
      for (let j = 0; j < headers.length; j++) {obj[headers[j]] = row[j];}
      rows[wi++] = obj;
    }
    offset += used;
  }

  return rows;
}

function rowsToObjects(headers: string[], rows: string[][], schema?: Converter[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const obj: Record<string, unknown> = {};
    const row = rows[i];
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = schema && j < schema.length ? schema[j](row[j]) : row[j];
    }
    out[i] = obj;
  }
  return out;
}

function applySchema(rawRows: string[][], schema: Converter[]): unknown[][] {
  const out: unknown[][] = new Array(rawRows.length);
  out[0] = rawRows[0];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    const converted: unknown[] = new Array(row.length);
    for (let j = 0; j < row.length; j++) {
      converted[j] = j < schema.length ? schema[j](row[j]) : row[j];
    }
    out[i] = converted;
  }
  return out;
}

export function parse(csv: string, opts?: ParseOptions): unknown[] {
  const type = opts?.type;
  const headers = opts?.headers === true;
  const schema = Array.isArray(type) ? type : undefined;
  const autotyped = type === true;
  const hasQuotes = csv.includes('"');

  if (autotyped) {
    return headers ? parseAutotypedWithHeaders(csv) : parseAutotypedRows(csv);
  }

  const rawRows = hasQuotes ? parseQuotedRows(csv) : parseUnquotedJS(csv);
  if (rawRows.length === 0) {return [];}

  if (headers) {
    return rowsToObjects(rawRows[0], rawRows.slice(1), schema);
  }

  if (schema) {return applySchema(rawRows, schema);}
  return rawRows;
}
