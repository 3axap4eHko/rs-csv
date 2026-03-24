import { OP_STR, OP_APPEND, OP_NUM, OP_BOOL, OP_NULL, OP_BIGINT, OP_EOF, EOL_BIT, TYPE_MASK } from "./types.js";
import type { FieldValue, Row, ParseResult } from "./types.js";

const decoder = new TextDecoder();

export function interpret(input: Uint8Array, cmdBuf: Uint8Array): ParseResult {
  const view = new DataView(cmdBuf.buffer, cmdBuf.byteOffset, cmdBuf.byteLength);
  const headers: string[] = [];
  const rows: Row[] = [];
  let row: FieldValue[] = [];
  let pos = 0;
  let headerDone = false;

  for (;;) {
    const op = cmdBuf[pos];
    const type = op & TYPE_MASK;
    if (type === OP_EOF) break;
    const eol = op & EOL_BIT;

    let value: FieldValue;

    if (type === OP_STR) {
      const offset = view.getUint32(pos + 1, true);
      const len = view.getUint32(pos + 5, true);
      value = decoder.decode(input.subarray(offset, offset + len));
    } else if (type === OP_APPEND) {
      const offset = view.getUint32(pos + 1, true);
      const len = view.getUint32(pos + 5, true);
      const prev = row.length > 0 ? row[row.length - 1] : "";
      row[row.length - 1] = (prev as string) + decoder.decode(input.subarray(offset, offset + len));
      pos += 9;
      if (eol) {
        if (headerDone) rows.push(row);
        else { headers.push(...row as string[]); headerDone = true; }
        row = [];
      }
      continue;
    } else if (type === OP_BIGINT) {
      const offset = view.getUint32(pos + 1, true);
      const len = view.getUint32(pos + 5, true);
      value = BigInt(decoder.decode(input.subarray(offset, offset + len)));
    } else if (type === OP_NUM) {
      value = view.getFloat64(pos + 1, true);
    } else if (type === OP_BOOL) {
      value = Boolean(cmdBuf[pos + 1]);
    } else if (type === OP_NULL) {
      value = cmdBuf[pos + 1] === 1 ? null : undefined;
    } else {
      pos += 9;
      continue;
    }

    pos += 9;
    row.push(value);

    if (eol) {
      if (!headerDone) {
        headers.push(...row as string[]);
        headerDone = true;
      } else {
        rows.push(row);
      }
      row = [];
    }
  }

  return { headers, rows };
}
