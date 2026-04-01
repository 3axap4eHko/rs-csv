import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

export type NativeParse = (input: Buffer | Uint8Array, cmdBuf: Buffer | Uint8Array, offset: number, typed: boolean, strRow: boolean) => number | bigint;
export type NativeParseStr = (input: string, cmdBuf: Buffer | Uint8Array, offset: number, typed: boolean, strRow: boolean) => number | bigint;
export type NativeScanPositions = (input: string, out: Buffer | Uint8Array) => number | bigint;

const PLATFORM_PACKAGES: Record<string, string> = {
  "linux-x64": "@rs-csv/core-linux-x64-gnu",
  "linux-arm64": "@rs-csv/core-linux-arm64-gnu",
  "darwin-x64": "@rs-csv/core-darwin-x64",
  "darwin-arm64": "@rs-csv/core-darwin-arm64",
  "win32-x64": "@rs-csv/core-win32-x64-msvc",
};

function wrapWasm(wasm: any): NativeParse {
  let inputPtr = 0;
  let inputSize = 0;
  let cmdPtr = 0;
  let cmdSize = 0;

  return (input, cmdBuf, offset, typed, strRow) => {
    if (input.length > inputSize) {
      if (inputPtr) {wasm.wasm_free(inputPtr, inputSize);}
      inputSize = input.length;
      inputPtr = wasm.wasm_alloc(inputSize);
    }
    if (cmdBuf.length > cmdSize) {
      if (cmdPtr) {wasm.wasm_free(cmdPtr, cmdSize);}
      cmdSize = cmdBuf.length;
      cmdPtr = wasm.wasm_alloc(cmdSize);
    }

    new Uint8Array(wasm.memory.buffer).set(input as Uint8Array, inputPtr);
    const consumed = wasm.parse_csv(inputPtr, input.length, cmdPtr, cmdBuf.length, offset, typed, strRow);
    (cmdBuf as Uint8Array).set(new Uint8Array(wasm.memory.buffer, cmdPtr, cmdBuf.length));
    return consumed;
  };
}

function tryRequire(require: NodeRequire, id: string): Record<string, unknown> | null {
  try {
    return require(id) as Record<string, unknown>;
  } catch (e: any) {
    if (e?.code === "MODULE_NOT_FOUND") { return null; }
    throw e;
  }
}

function loadAddon(): Record<string, unknown> {
  const require = createRequire(import.meta.url);

  const key = `${process.platform}-${process.arch}`;
  const pkg = PLATFORM_PACKAGES[key];
  if (pkg) {
    const m = tryRequire(require, pkg);
    if (m) { return m; }
  }

  const dir = dirname(fileURLToPath(import.meta.url));
  const devPath = resolve(dir, "../../../crates/napi/index.node");
  const dev = tryRequire(require, devPath);
  if (dev) { return dev; }

  const wasm = tryRequire(require, "@rs-csv/core-wasm32");
  if (wasm) { return { parseCsv: wrapWasm(wasm) }; }

  const wasmDevPath = resolve(dir, "../../../crates/wasm/pkg/rs_csv_wasm.js");
  const wasmDev = tryRequire(require, wasmDevPath);
  if (wasmDev) { return { parseCsv: wrapWasm(wasmDev) }; }

  throw new Error(`@rs-csv/core: no binding found for ${key}. Install a platform package or @rs-csv/core-wasm32.`);
}

const addon = loadAddon();

export const parseFn = addon.parseCsv as NativeParse;
export const parseFnStr = addon.parseCsvStr as NativeParseStr | undefined;
export const scanPosFn = addon.scanPositions as NativeScanPositions | undefined;
export type NativeScanFields = (input: string | Buffer, out: Buffer | Uint8Array) => number | bigint;
export const scanFieldsStr = addon.scanFieldsStr as NativeScanFields | undefined;
export const scanFieldsBuf = addon.scanFieldsBuf as NativeScanFields | undefined;
