import type { FieldValue, Row } from "./types.js";
import { readU32LE } from "./types.js";

const decoder = new TextDecoder();
const SIDE_BUF_BIT = 0x80000000;
const NULL_SENTINEL_LO = 0x00000001;
const NULL_SENTINEL_HI = 0x7FF00000;
const TYPE_NUMBER = 1;
const TYPE_BOOLEAN = 2;
const TYPE_BIGINT = 3;

const COMPACT_EOL = 0x80000000;
const COMPACT_POS_MASK = 0x7FFFFFFF;

export function interpretCompact(str: string, posBuf: Uint8Array): string[][] {
  const u32 = new Uint32Array(posBuf.buffer, posBuf.byteOffset, posBuf.byteLength >> 2);
  const fieldCount = u32[0];
  if (fieldCount === 0) {return [];}
  const rowCount = u32[1];
  const width = u32[2];
  let idx = 4;
  let start = 0;

  if (fieldCount === rowCount * width) {
    const rows: string[][] = new Array(rowCount);
    for (let r = 0; r < rowCount; r++) {
      const row: string[] = new Array(width);
      for (let c = 0; c < width; c++) {
        const end = u32[idx++] & COMPACT_POS_MASK;
        row[c] = str.slice(start, end);
        start = end;
      }
      rows[r] = row;
    }
    return rows;
  }

  const rows: string[][] = [];
  let row: string[] = [];
  for (let i = 0; i < fieldCount; i++) {
    const entry = u32[idx++];
    const end = entry & COMPACT_POS_MASK;
    row.push(str.slice(start, end));
    start = end;
    if (entry & COMPACT_EOL) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) {rows.push(row);}
  return rows;
}

export function interpretAligned(csv: string, output: Uint8Array, sideBuf: Uint8Array): Row[] {
  const fieldCount = readU32LE(output, 0);
  if (fieldCount === 0) {return [];}
  const width = readU32LE(output, 4);
  const rowCount = readU32LE(output, 8);
  const recordStart = (16 + width + 7) & ~7;
  const byteOff = output.byteOffset + recordStart;
  const f64 = new Float64Array(output.buffer, byteOff, fieldCount);
  const u32 = new Uint32Array(output.buffer, byteOff, fieldCount * 2);
  const lastCol = width - 1;

  const metaOff = recordStart + fieldCount * 8 + 8;
  const fallbackCount = readU32LE(output, metaOff + 4);
  const fbOff = metaOff + 8;

  const rows: Row[] = new Array(rowCount);
  let ri = 0;
  let col = 0;
  let row: FieldValue[] = [];
  let fbIdx = 0;
  let idx = 0;

  for (let i = 0; i < fieldCount; i++) {
    const t = output[16 + col];
    const lo = u32[idx]; idx++;
    const hi = u32[idx]; idx++;

    if (lo === NULL_SENTINEL_LO && hi === NULL_SENTINEL_HI) {
      row.push(undefined);
    } else if (t === TYPE_NUMBER) {
      const val = f64[i];
      if (val === val) {
        row.push(val);
      } else if (fbIdx < fallbackCount) {
        const fo = readU32LE(output, fbOff + fbIdx * 8);
        const fl = readU32LE(output, fbOff + fbIdx * 8 + 4);
        row.push(csv.slice(fo, fo + fl));
        fbIdx++;
      } else {
        row.push(val);
      }
    } else if (t === TYPE_BOOLEAN) {
      row.push(lo !== 0);
    } else if (lo & SIDE_BUF_BIT) {
      const realOff = lo & ~SIDE_BUF_BIT;
      const s = decoder.decode(sideBuf.subarray(realOff, realOff + hi));
      row.push(t === TYPE_BIGINT ? BigInt(s) : s);
    } else {
      const s = csv.slice(lo, lo + hi);
      row.push(t === TYPE_BIGINT ? BigInt(s) : s);
    }

    if (col === lastCol) {
      rows[ri++] = row;
      row = [];
      col = 0;
    } else {
      col++;
    }
  }

  return rows;
}
