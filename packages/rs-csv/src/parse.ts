import { interpret } from "./interpret.js";
import { loadParser } from "./platform.js";
import type { ParseResult } from "./types.js";

export { interpret } from "./interpret.js";
export type { ParseResult, FieldValue, Row } from "./types.js";

const MB = 1024 * 1024;
const DEFAULT_BUF = 16 * MB;

export interface ParseOptions {
  bufferSizeMB?: number;
}

let parseFn: ReturnType<typeof loadParser> | undefined;
let cmdBuf: Buffer | undefined;

function ensureLoaded() {
  if (!parseFn) parseFn = loadParser();
}

export function parse(csv: string | Buffer, opts?: ParseOptions): ParseResult {
  ensureLoaded();
  const input = typeof csv === "string" ? Buffer.from(csv) : csv;
  const size = opts?.bufferSizeMB ? opts.bufferSizeMB * MB : DEFAULT_BUF;
  if (!cmdBuf || cmdBuf.length < size) cmdBuf = Buffer.alloc(size);

  const headers: string[] = [];
  const rows: ParseResult["rows"] = [];
  let headerDone = false;

  for (let offset = 0;;) {
    const consumed = Number(parseFn!(input, cmdBuf, offset));
    if (consumed === 0) break;
    const result = interpret(input, cmdBuf);
    if (!headerDone) {
      headers.push(...result.headers);
      headerDone = true;
    }
    rows.push(...result.rows);
    offset += consumed;
  }

  return { headers, rows };
}

export function parseRaw(input: Buffer, cmdBuf: Buffer, offset: number = 0): number {
  ensureLoaded();
  return Number(parseFn!(input, cmdBuf, offset));
}
