import { inferCsv } from "./platform.js";
import { readU32LE, writeU32LE } from "./types.js";

export enum Type {
  String,
  Number,
  Boolean,
  BigInt,
}

export const Flag = {
  HAS_QUOTES:    1 << 0,
  HAS_ESCAPES:   1 << 1,
  HAS_QUOTED_NL: 1 << 2,
  HAS_CRLF:      1 << 3,
  HAS_BOM:       1 << 4,
} as const;

// Binary layout:
// [0..4)   flags: u32
// [4..8)   width: u32
// [8..8+W) types: u8[width]
// [8+W..12+W) header_count: u32
// [12+W..) headers: (u16 length + utf8 bytes) repeated

const FLAGS_OFF = 0;
const WIDTH_OFF = 4;
const TYPES_OFF = 8;


export class Descriptor extends Uint8Array {
  get flags(): number { return readU32LE(this, FLAGS_OFF); }
  get width(): number { return readU32LE(this, WIDTH_OFF); }

  get types(): Type[] {
    const w = this.width;
    const out: Type[] = new Array(w);
    for (let i = 0; i < w; i++) { out[i] = this[TYPES_OFF + i]; }
    return out;
  }

  get headerCount(): number {
    return readU32LE(this, TYPES_OFF + this.width);
  }

  get headers(): string[] {
    const count = this.headerCount;
    if (count === 0) { return []; }
    const out: string[] = new Array(count);
    let off = TYPES_OFF + this.width + 4;
    for (let i = 0; i < count; i++) {
      const len = this[off] | (this[off + 1] << 8);
      off += 2;
      let s = "";
      for (let j = 0; j < len; j++) { s += String.fromCharCode(this[off + j]); }
      out[i] = s;
      off += len;
    }
    return out;
  }
}

export interface InferOptions {
  headers?: true | string[];
  types?: Type[];
  samples?: number;
}

let inferBuf: Buffer | null = null;
function getInferBuf(): Buffer {
  if (!inferBuf) {inferBuf = Buffer.alloc(64 * 1024);}
  return inferBuf;
}

export function infer(csv: string | string[], opts?: InferOptions): Descriptor {
  const userHeaders = opts?.headers;
  const userTypes = opts?.types;
  const samples = opts?.samples ?? 100;

  if (userTypes && Array.isArray(userHeaders) && userTypes.length > userHeaders.length) {
    throw new Error(`types length (${userTypes.length}) exceeds headers length (${userHeaders.length})`);
  }

  const csvs = Array.isArray(csv) ? csv : [csv];
  const hasHeaderRow = userHeaders === true;

  const ib = getInferBuf();

  // First CSV: full Rust infer (classify + types + headers)
  const firstBuf = Buffer.from(csvs[0]);
  inferCsv(firstBuf, ib, hasHeaderRow, samples);

  let flags = readU32LE(ib, FLAGS_OFF);
  let width = readU32LE(ib, WIDTH_OFF);
  const types = new Uint8Array(Math.max(width, 256));
  for (let i = 0; i < width; i++) { types[i] = ib[TYPES_OFF + i]; }

  for (let ci = 1; ci < csvs.length; ci++) {
    const buf = Buffer.from(csvs[ci]);
    inferCsv(buf, ib, hasHeaderRow, samples);
    flags |= readU32LE(ib, FLAGS_OFF);
    const w = readU32LE(ib, WIDTH_OFF);
    if (w > width) { width = w; }
    for (let i = 0; i < w; i++) {
      const cur = ib[TYPES_OFF + i];
      if (types[i] === 0xFF) {
        types[i] = cur;
      } else if (types[i] !== cur) {
        types[i] = Type.String;
      }
    }
  }

  if (csvs.length > 1) {
    inferCsv(firstBuf, ib, hasHeaderRow, samples);
  }

  const firstWidth = readU32LE(ib, WIDTH_OFF);
  const headers: string[] = Array.isArray(userHeaders) ? userHeaders : (
    hasHeaderRow ? readDescHeaders(ib, firstWidth) : []
  );
  if (headers.length > width) { width = headers.length; }

  // Apply user type overrides
  if (userTypes) {
    for (let i = 0; i < userTypes.length; i++) { types[i] = userTypes[i]; }
  }

  // Fill unset types with String
  for (let i = 0; i < width; i++) {
    if (types[i] === 0xFF) { types[i] = Type.String; }
  }

  // Build final binary descriptor
  const headerBytes: number[] = [];
  for (const h of headers) {
    const len = h.length;
    headerBytes.push(len & 0xFF, (len >> 8) & 0xFF);
    for (let i = 0; i < len; i++) { headerBytes.push(h.charCodeAt(i)); }
  }

  const totalSize = 4 + 4 + width + 4 + headerBytes.length;
  const out = new Uint8Array(totalSize);

  writeU32LE(out, FLAGS_OFF, flags);
  writeU32LE(out, WIDTH_OFF, width);
  for (let i = 0; i < width; i++) { out[TYPES_OFF + i] = types[i]; }
  writeU32LE(out, TYPES_OFF + width, headers.length);
  out.set(headerBytes, TYPES_OFF + width + 4);

  return Object.setPrototypeOf(out, Descriptor.prototype) as Descriptor;
}

export function readDescHeaders(buf: Uint8Array, width: number): string[] {
  const count = readU32LE(buf, TYPES_OFF + width);
  if (count === 0) { return []; }
  const out: string[] = new Array(count);
  let off = TYPES_OFF + width + 4;
  for (let i = 0; i < count; i++) {
    const len = buf[off] | (buf[off + 1] << 8);
    off += 2;
    let s = "";
    for (let j = 0; j < len; j++) { s += String.fromCharCode(buf[off + j]); }
    out[i] = s;
    off += len;
  }
  return out;
}
