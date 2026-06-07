import { interpretAligned, interpretCompact } from "./interpret.js";
import { fusedTypedParseJs as fusedTypedParseJsNative, scanFieldsCompact, scanFieldsCompactJs } from "./platform.js";
import type { FieldValue, Row, Converter } from "./types.js";
import { Descriptor, readDescHeaderCount, readDescHeaders } from "./descriptor.js";
import { readU32LE } from "./types.js";

const MB = 1024 * 1024;
const encoder = new TextEncoder();
const EMPTY_DESC = Buffer.alloc(0);

export interface ParseOptions {
  type?: boolean | Converter[];
  headers?: boolean;
  descriptor?: Descriptor | Uint8Array;
}

let inputBuf: Buffer | null = null;
function getInputBuf(size: number): Buffer {
  if (!inputBuf || inputBuf.length < size) {
    inputBuf = Buffer.alloc(Math.max(size, 16 * MB));
  }
  return inputBuf;
}

let contentBuf: Buffer | null = null;
function getContentBuf(size: number): Buffer {
  if (!contentBuf || contentBuf.length < size) {
    contentBuf = Buffer.alloc(Math.max(size, 16 * MB));
  }
  return contentBuf;
}

let posBuf: Buffer | null = null;
function getPosBuf(size: number): Buffer {
  if (!posBuf || posBuf.length < size) {
    posBuf = Buffer.alloc(Math.max(size, 16 * MB));
  }
  return posBuf;
}

let alignedBuf: Buffer | null = null;
function getAlignedBuf(size: number): Buffer {
  if (!alignedBuf || alignedBuf.length < size) {
    alignedBuf = Buffer.alloc(Math.max(size, 16 * MB));
  }
  return alignedBuf;
}

let sideBuf: Buffer | null = null;
function getSideBuf(size: number): Buffer {
  if (!sideBuf || sideBuf.length < size) {
    sideBuf = Buffer.alloc(Math.max(size, 4 * MB));
  }
  return sideBuf;
}

function parseUnquotedJS(csv: string, knownWidth?: number): string[][] {
  let start = 0;
  if (csv.charCodeAt(0) === 0xFEFF) {start = 1;}

  let width: number;
  if (knownWidth != null) {
    width = knownWidth;
  } else {
    const firstNl = csv.indexOf("\n", start);
    width = 1;
    const scanEnd = firstNl === -1 ? csv.length : firstNl;
    for (let i = start; i < scanEnd; i++) {
      if (csv.charCodeAt(i) === 44) {width++;}
    }
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
      const next = csv.indexOf(",", pos);
      if (next === -1) {
        row[c] = csv.slice(pos);
        rows.push(row);
        return rows;
      }
      row[c] = csv.slice(pos, next);
      pos = next + 1;
    }
    const next = csv.indexOf("\n", pos);
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

function parseQuotedRows(csv: string): string[][] {
  const byteLength = Buffer.byteLength(csv);
  const positions = getPosBuf(16 + byteLength * 4 + 64);
  if (scanFieldsCompactJs) {
    const content = getContentBuf(byteLength + 1);
    const input = getInputBuf(byteLength + 1);
    const contentLen = Number(scanFieldsCompactJs(csv, input, positions, content));
    const str = content.toString("utf8", 0, contentLen);
    return interpretCompact(str, positions);
  }
  const input = encoder.encode(csv);
  const contentLen = Number(scanFieldsCompact!(input, positions));
  const str = new TextDecoder().decode(input.subarray(0, contentLen));
  return interpretCompact(str, positions);
}

function parseHeaderRow(csv: string, hasQuotes: boolean): string[] {
  return hasQuotes ? parseQuotedHeaderRow(csv) : parseUnquotedHeaderRow(csv);
}

function parseUnquotedHeaderRow(csv: string): string[] {
  let pos = 0;
  if (csv.charCodeAt(0) === 0xFEFF) {pos = 1;}

  const headers: string[] = [];
  while (pos <= csv.length) {
    const nextComma = csv.indexOf(",", pos);
    const nextNl = csv.indexOf("\n", pos);
    if (nextNl === -1 && nextComma === -1) {
      headers.push(csv.slice(pos));
      return headers;
    }
    if (nextComma !== -1 && (nextNl === -1 || nextComma < nextNl)) {
      headers.push(csv.slice(pos, nextComma));
      pos = nextComma + 1;
      continue;
    }
    const end = nextNl > 0 && csv.charCodeAt(nextNl - 1) === 13 ? nextNl - 1 : nextNl;
    headers.push(csv.slice(pos, end));
    return headers;
  }
  return headers;
}

function parseQuotedHeaderRow(csv: string): string[] {
  let pos = 0;
  if (csv.charCodeAt(0) === 0xFEFF) {pos = 1;}

  const headers: string[] = [];
  let field = "";
  let inQuotes = false;

  while (pos < csv.length) {
    const ch = csv.charCodeAt(pos);
    if (inQuotes) {
      if (ch === 34) {
        if (pos + 1 < csv.length && csv.charCodeAt(pos + 1) === 34) {
          field += "\"";
          pos += 2;
        } else {
          inQuotes = false;
          pos += 1;
        }
        continue;
      }
      field += csv[pos];
      pos += 1;
      continue;
    }

    if (ch === 34) { inQuotes = true; pos += 1; continue; }
    if (ch === 44) { headers.push(field); field = ""; pos += 1; continue; }
    if (ch === 10) {
      if (field.endsWith("\r")) {field = field.slice(0, -1);}
      headers.push(field);
      return headers;
    }
    field += csv[pos];
    pos += 1;
  }

  headers.push(field);
  return headers;
}

function toObjects(headers: string[], rows: Row[], startIdx: number): Record<string, FieldValue>[] {
  const out: Record<string, FieldValue>[] = new Array(rows.length - startIdx);
  for (let i = startIdx; i < rows.length; i++) {
    const obj: Record<string, FieldValue> = {};
    for (let j = 0; j < headers.length; j++) {obj[headers[j]] = rows[i][j];}
    out[i - startIdx] = obj;
  }
  return out;
}

function toObjectsStr(headers: string[], rows: string[][], schema?: Converter[]): Record<string, unknown>[] {
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

function descriptorBuffer(descriptor: Uint8Array): Buffer {
  if (descriptor instanceof Buffer) {return descriptor;}
  return Buffer.from(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength);
}

function parseTypedAligned(csv: string, descriptor: Uint8Array | undefined, skipHeaderRow: boolean): Row[] {
  const byteLength = Buffer.byteLength(csv);
  const input = getInputBuf(byteLength + 1);
  const positions = getPosBuf(16 + byteLength * 4 + 64);
  const descBuf = descriptor ? descriptorBuffer(descriptor) : EMPTY_DESC;

  let output = getAlignedBuf(byteLength * 4 + 256);
  let side = getSideBuf(byteLength + 256);

  for (let attempt = 0; attempt < 8; attempt++) {
    const written = Number(
      fusedTypedParseJsNative!(csv, input, positions, output, side, descBuf, skipHeaderRow, 100),
    );
    if (written > 0) {
      return interpretAligned(csv, output.subarray(0, written), side);
    }
    output = getAlignedBuf(output.length * 2);
    side = getSideBuf(side.length * 2);
  }

  throw new Error("typed parse scratch buffers exhausted");
}

function getHeaders(csv: string, descriptor: Uint8Array | undefined, descriptorProvided: boolean, wantHeaders: boolean): string[] {
  if (wantHeaders) {
    const firstNl = csv.indexOf("\n");
    const headerLine = firstNl === -1 ? csv : csv.slice(0, firstNl);
    return parseHeaderRow(csv, headerLine.includes("\""));
  }
  if (descriptor) {
    const width = readU32LE(descriptor, 4);
    if (readDescHeaderCount(descriptor, width) > 0) {
      return readDescHeaders(descriptor, width);
    }
  }
  return [];
}

export function parse(csv: string, opts?: ParseOptions): unknown[] {
  const type = opts?.type;
  const wantHeaders = opts?.headers === true;
  const schema = Array.isArray(type) ? type : undefined;
  const autotyped = type === true;
  const descriptorProvided = opts?.descriptor != null;
  const descriptor = opts?.descriptor;

  const hasQuotes = descriptor
    ? (readU32LE(descriptor, 0) & 1) !== 0
    : csv.includes("\"");
  const width = descriptor ? readU32LE(descriptor, 4) : undefined;

  if (autotyped) {
    if (!fusedTypedParseJsNative) {
      throw new Error("@rs-csv/core: typed parsing requires the fused native or WASM binding");
    }
    const useDescHeaders = !!(opts?.headers !== false && !wantHeaders && descriptorProvided && descriptor
      && readDescHeaderCount(descriptor, width!) > 0);
    const skipHeader = wantHeaders || useDescHeaders;
    const rows = parseTypedAligned(csv, descriptorProvided ? descriptor : undefined, skipHeader);
    if (wantHeaders || useDescHeaders) {
      const headers = getHeaders(csv, descriptor, descriptorProvided, wantHeaders);
      return toObjects(headers, rows, 0);
    }
    return rows;
  }

  const rawRows = hasQuotes ? parseQuotedRows(csv) : parseUnquotedJS(csv, width);
  if (rawRows.length === 0) {return [];}

  if (wantHeaders) {
    const headers = descriptor ? getHeaders(csv, descriptor, descriptorProvided, wantHeaders) : rawRows[0];
    return toObjectsStr(headers, rawRows.slice(1), schema);
  }

  if (schema) {return applySchema(rawRows, schema);}
  return rawRows;
}
