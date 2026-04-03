import { interpretCompact, interpretTyped } from "./interpret.js";
import { parseFn, parseFnJs, scanFieldsCompact, scanFieldsCompactJs, scanFieldsJs, scanFieldsBuf, parseWithTypes as parseWithTypesNative, parseWithTypesJs as parseWithTypesJsNative, parseWithTypesJsUtf16 as parseWithTypesJsUtf16Native, scanParseWithTypesJs as scanParseWithTypesJsNative, scanParseWithTypesJsUtf16 as scanParseWithTypesJsUtf16Native } from "./platform.js";
import type { FieldValue, Row, Converter } from "./types.js";
import { Descriptor, Flag, readDescHeaders } from "./descriptor.js";
import { readU32LE } from "./types.js";

const MB = 1024 * 1024;
const cmdBuf = Buffer.alloc(16 * MB);
const emptyInput = new Uint8Array(0);
const encoder = new TextEncoder();

type ParseSource = {
  input: Uint8Array;
  nativeInput: string | Uint8Array;
  inputBuf?: Buffer;
  sliceStr: string | undefined;
  totalLength: number;
};

export interface ParseOptions {
  type?: boolean | Converter[];
  headers?: boolean;
  descriptor?: Descriptor | Uint8Array;
}

function parseUnquotedJS(csv: string, knownWidth?: number): string[][] {
  let start = 0;
  if (csv.charCodeAt(0) === 0xFEFF) {start = 1;}

  let width: number;
  if (knownWidth != null) {
    width = knownWidth;
  } else {
    const firstNl = csv.indexOf('\n', start);
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

let contentBuf: Buffer | null = null;
function getContentBuf(): Buffer {
  if (!contentBuf) {contentBuf = Buffer.alloc(16 * MB);}
  return contentBuf;
}

let inputBuf: Buffer | null = null;
function getInputBuf(size: number): Buffer {
  if (!inputBuf || inputBuf.length < size) {
    inputBuf = Buffer.alloc(Math.max(size, 16 * MB));
  }
  return inputBuf;
}

function parseQuotedRows(csv: string): string[][] {
  if (scanFieldsCompactJs) {
    const cb = getContentBuf();
    const ib = getInputBuf(Buffer.byteLength(csv) + 1);
    const contentLen = Number(scanFieldsCompactJs(csv, ib, cmdBuf, cb));
    const str = cb.toString('utf8', 0, contentLen);
    return interpretCompact(str, cmdBuf);
  }
  const input = encoder.encode(csv);
  const contentLen = Number(scanFieldsCompact!(input, cmdBuf));
  const str = new TextDecoder().decode(input.subarray(0, contentLen));
  return interpretCompact(str, cmdBuf);
}

function prepareParseSource(csv: string): ParseSource {
  if (parseFnJs) {
    const byteLength = Buffer.byteLength(csv);
    if (byteLength === csv.length) {
      return {
        input: emptyInput,
        nativeInput: csv,
        inputBuf: getInputBuf(byteLength + 1),
        sliceStr: csv,
        totalLength: byteLength,
      };
    }
  }

  const input = encoder.encode(csv);
  return {
    input,
    nativeInput: input,
    sliceStr: undefined,
    totalLength: input.length,
  };
}

function callRustParse(source: ParseSource, offset: number, typed: boolean, strRow: boolean): number {
  if (typeof source.nativeInput === "string") {
    return Number(parseFnJs!(source.nativeInput, source.inputBuf!, cmdBuf, offset, typed, strRow));
  }
  return Number(parseFn(source.nativeInput, cmdBuf, offset, typed, strRow));
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

let posBuf: Buffer | null = null;
function getPosBuf(): Buffer {
  if (!posBuf) {posBuf = Buffer.alloc(16 * MB);}
  return posBuf;
}

function parseWithDescriptor(csv: string, desc: Uint8Array, opts?: ParseOptions): unknown[] {
  const type = opts?.type;
  const wantHeaders = opts?.headers === true;
  const userSchema = Array.isArray(type) ? type : undefined;
  const flags = readU32LE(desc, 0);
  const width = readU32LE(desc, 4);
  const hasQuotes = (flags & Flag.HAS_QUOTES) !== 0;
  const descHeaders = wantHeaders ? readDescHeaders(desc, width) : null;

  const autotyped = type === true;

  if (autotyped && !userSchema) {
    const pb = getPosBuf();
    const typesView = desc.subarray(8, 8 + width);
    const hasNonAscii = (flags & Flag.HAS_NON_ASCII) !== 0;
    const needsUtf8Measure = hasNonAscii || (flags & Flag.HAS_BOM) !== 0;
    if (hasNonAscii && scanParseWithTypesJsUtf16Native) {
      const ib = getInputBuf((needsUtf8Measure ? Buffer.byteLength(csv) : csv.length) + 1);
      scanParseWithTypesJsUtf16Native(csv, ib, pb, cmdBuf, typesView);
    } else if (!hasNonAscii && scanParseWithTypesJsNative) {
      const ib = getInputBuf((needsUtf8Measure ? Buffer.byteLength(csv) : csv.length) + 1);
      scanParseWithTypesJsNative(csv, ib, pb, cmdBuf, typesView);
    } else if (hasNonAscii && scanFieldsJs && parseWithTypesJsUtf16Native) {
      const ib = getInputBuf(Buffer.byteLength(csv) + 1);
      scanFieldsJs(csv, ib, pb);
      parseWithTypesJsUtf16Native(csv, ib, pb, cmdBuf, typesView);
    } else if (!hasNonAscii && scanFieldsJs && parseWithTypesJsNative) {
      const ib = getInputBuf(csv.length + 1);
      scanFieldsJs(csv, ib, pb);
      parseWithTypesJsNative(csv, ib, pb, cmdBuf, typesView);
    } else {
      const buf = encoder.encode(csv);
      scanFieldsBuf!(buf, pb);
      parseWithTypesNative(buf, pb, cmdBuf, typesView);
    }
    const rows = interpretTyped(emptyInput, cmdBuf, csv);

    if (descHeaders) {
      const startIdx = wantHeaders ? 1 : 0;
      const headers = descHeaders;
      const out: Record<string, FieldValue>[] = new Array(rows.length - startIdx);
      for (let i = startIdx; i < rows.length; i++) {
        const obj: Record<string, FieldValue> = {};
        for (let j = 0; j < headers.length; j++) {obj[headers[j]] = rows[i][j];}
        out[i - startIdx] = obj;
      }
      return out;
    }

    if (wantHeaders && rows.length > 0) {
      const headers = rows[0].map(String);
      const out: Record<string, FieldValue>[] = new Array(rows.length - 1);
      for (let i = 1; i < rows.length; i++) {
        const obj: Record<string, FieldValue> = {};
        for (let j = 0; j < headers.length; j++) {obj[headers[j]] = rows[i][j];}
        out[i - 1] = obj;
      }
      return out;
    }

    return rows;
  }

  const rawRows = hasQuotes ? parseQuotedRows(csv) : parseUnquotedJS(csv, width);
  if (rawRows.length === 0) {return [];}

  const headers = descHeaders ?? (wantHeaders ? rawRows[0] : null);
  const dataRows = headers ? rawRows.slice(1) : rawRows;

  if (headers) {
    return rowsToObjects(headers, dataRows, userSchema);
  }

  if (userSchema) {return applySchema(dataRows, userSchema);}
  return dataRows;
}

export function parse(csv: string, opts?: ParseOptions): unknown[] {
  if (opts?.descriptor) {
    return parseWithDescriptor(csv, opts.descriptor, opts);
  }

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
