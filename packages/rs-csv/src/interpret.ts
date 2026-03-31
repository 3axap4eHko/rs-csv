import type { FieldValue, Row } from "./types.js";

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

const STR_ESCAPED_BIT = 0x40000000;
const STR_META_MASK = 0x3fffffff;

function readU32LE(buf: Uint8Array, pos: number): number {
  return (buf[pos]
    | (buf[pos + 1] << 8)
    | (buf[pos + 2] << 16)
    | (buf[pos + 3] << 24)) >>> 0;
}

function sliceField(str: string | undefined, input: Uint8Array, off: number, len: number): string {
  if (str != null) {return str.slice(off, off + len);}
  return decoder.decode(input.subarray(off, off + len));
}

export function interpretStrings(input: Uint8Array, cmdBuf: Uint8Array, str?: string): string[][] {
  const u32 = new Uint32Array(cmdBuf.buffer, cmdBuf.byteOffset, cmdBuf.byteLength >> 2);
  const recordCount = u32[0];
  if (recordCount === 0) {return [];}
  const rowCount = u32[2];
  const width = u32[3];

  const rows: string[][] = new Array(rowCount);
  let idx = 4;
  let remaining = recordCount;

  for (let r = 0; r < rowCount; r++) {
    const rowWidth = Math.min(width, remaining);
    const row: string[] = new Array(rowWidth);
    for (let c = 0; c < rowWidth; c++) {
      const start = u32[idx];
      const meta = u32[idx + 1];

      const len = meta & STR_META_MASK;
      const field = sliceField(str, input, start, len);
      row[c] = (meta & STR_ESCAPED_BIT) ? field.replaceAll('""', '"') : field;

      idx += 2;
      remaining--;
    }
    rows[r] = row;
  }

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
