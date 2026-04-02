import type { FieldValue, Row } from "./types.js";
import { readU32LE } from "./types.js";

const decoder = new TextDecoder();

const OP_STR = 0;
const OP_APPEND = 1;
const OP_NUM = 2;
const OP_BOOL = 3;
const OP_NULL = 4;
const OP_BIGINT = 5;
const OP_EOF = 0x7f;
const EOL_BIT = 0x80;
const TYPE_MASK = 0x7f;

const COMPACT_EOL = 0x80000000;
const COMPACT_POS_MASK = 0x7FFFFFFF;

function sliceField(str: string | undefined, input: Uint8Array, off: number, len: number): string {
  if (str != null) {return str.slice(off, off + len);}
  return decoder.decode(input.subarray(off, off + len));
}

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

export function interpretTyped(input: Uint8Array, cmdBuf: Uint8Array, str?: string): Row[] {
  const view = new DataView(cmdBuf.buffer, cmdBuf.byteOffset, cmdBuf.byteLength);
  const rows: Row[] = [];
  let row: FieldValue[] = [];
  let pos = 0;

  for (;;) {
    const op = cmdBuf[pos];
    const type = op & TYPE_MASK;
    if (type === OP_EOF) {break;}
    const eol = op & EOL_BIT;

    if (type === OP_APPEND) {
      const offset = readU32LE(cmdBuf, pos + 1);
      const len = readU32LE(cmdBuf, pos + 5);
      const prev = row.length > 0 ? row[row.length - 1] : "";
      row[row.length - 1] = (prev as string) + sliceField(str, input, offset, len);
      pos += 9;
      if (eol) { rows.push(row); row = []; }
      continue;
    }

    if (type === OP_STR || type === OP_BIGINT) {
      const offset = readU32LE(cmdBuf, pos + 1);
      const len = readU32LE(cmdBuf, pos + 5);
      const s = sliceField(str, input, offset, len);
      row.push(type === OP_BIGINT ? BigInt(s) : s);
    } else if (type === OP_NUM) {
      row.push(view.getFloat64(pos + 1, true));
    } else if (type === OP_BOOL) {
      row.push(Boolean(cmdBuf[pos + 1]));
    } else if (type === OP_NULL) {
      row.push(cmdBuf[pos + 1] === 1 ? null : undefined);
    }

    pos += 9;
    if (eol) { rows.push(row); row = []; }
  }

  return rows;
}
