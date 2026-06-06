import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

export type NativeScanFieldsCompact = (input: Buffer | Uint8Array, out: Buffer | Uint8Array) => number | bigint;
const encoder = new TextEncoder();

function createWasmRegion(wasm: any) {
  let ptr = 0;
  let size = 0;

  return {
    ensure(minSize: number) {
      const nextSize = Math.max(minSize, 1);
      if (nextSize > size) {
        if (ptr !== 0) {wasm.wasm_free(ptr, size);}
        size = nextSize;
        ptr = wasm.wasm_alloc(size);
      }
      return ptr;
    },
  };
}

function writeBytes(view: Uint8Array, input: Uint8Array) {
  if (input.length > 0) {view.set(input);}
}

function encodeIntoWasm(wasm: any, ptr: number, capacity: number, input: string): number {
  const view = new Uint8Array(wasm.memory.buffer, ptr, Math.max(capacity, 1));
  const { read, written } = encoder.encodeInto(input, view);
  if (read !== input.length) {
    throw new Error("WASM string scratch buffer is too small");
  }
  return written;
}

const PLATFORM_PACKAGES: Record<string, string> = {
  "linux-x64": "@rs-csv/core-linux-x64-gnu",
  "linux-arm64": "@rs-csv/core-linux-arm64-gnu",
  "darwin-x64": "@rs-csv/core-darwin-x64",
  "darwin-arm64": "@rs-csv/core-darwin-arm64",
  "win32-x64": "@rs-csv/core-win32-x64-msvc",
};

const WASM_COMPAT_EXPORTS = [
  "inferCsv",
  "inferCsvJs",
  "scanFieldsCompact",
  "scanFieldsCompactJs",
  "fusedTypedParseJs",
] as const;

function hasWasmCompatExports(addon: Record<string, unknown>) {
  return WASM_COMPAT_EXPORTS.every((name) => typeof addon[name] === "function");
}

function wrapLegacyWasm(wasm: any): Record<string, unknown> {
  const inputRegion = createWasmRegion(wasm);
  const posRegion = createWasmRegion(wasm);
  const outputRegion = createWasmRegion(wasm);
  const colTypesRegion = createWasmRegion(wasm);

  const copyInput = (input: Buffer | Uint8Array, region = inputRegion) => {
    const ptr = region.ensure(input.length);
    writeBytes(new Uint8Array(wasm.memory.buffer, ptr, input.length), input);
    return ptr;
  };

  const copyBuffer = (sourcePtr: number, target: Buffer | Uint8Array) => {
    target.set(new Uint8Array(wasm.memory.buffer, sourcePtr, target.length));
  };

  const withEncodedString = (input: string, maxBytes: number, fn: (inputPtr: number, inputLen: number) => number | bigint) => {
    const inputPtr = inputRegion.ensure(maxBytes);
    const inputLen = encodeIntoWasm(wasm, inputPtr, maxBytes, input);
    return fn(inputPtr, inputLen);
  };

  return {
    ...wasm,
    inferCsv(input: Buffer | Uint8Array, out: Buffer, hasHeaders: boolean, maxSamples: number) {
      const inputPtr = copyInput(input);
      const outPtr = outputRegion.ensure(out.length);
      const written = wasm.infer_csv(inputPtr, input.length, outPtr, out.length, hasHeaders, maxSamples);
      copyBuffer(outPtr, out);
      return written;
    },
    inferCsvJs(input: string, _inputBuf: Buffer, out: Buffer, hasHeaders: boolean, maxSamples: number) {
      const outPtr = outputRegion.ensure(out.length);
      const written = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) =>
        wasm.infer_csv(inputPtr, inputLen, outPtr, out.length, hasHeaders, maxSamples)
      );
      copyBuffer(outPtr, out);
      return written;
    },
    fusedTypedParseJs(input: string, _inputBuf: Buffer, posBuf: Buffer, output: Buffer, sideBuf: Buffer, descriptor: Buffer, hasHeaders: boolean, maxSamples: number) {
      const posPtr = posRegion.ensure(posBuf.length);
      const outputPtr = outputRegion.ensure(output.length);
      const sidePtr = colTypesRegion.ensure(sideBuf.length);
      const descPtr = descriptor.length > 0 ? copyInput(descriptor, inputRegion) : 0;
      const written = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) =>
        wasm.fused_typed_parse(
          inputPtr, inputLen,
          posPtr, posBuf.length,
          outputPtr, output.length,
          sidePtr, sideBuf.length,
          descPtr, descriptor.length,
          hasHeaders, maxSamples,
        )
      );
      copyBuffer(posPtr, posBuf);
      copyBuffer(outputPtr, output);
      sideBuf.set(new Uint8Array(wasm.memory.buffer, sidePtr, sideBuf.length));
      return written;
    },
    scanFieldsCompact(input: Buffer | Uint8Array, out: Buffer | Uint8Array) {
      const inputPtr = copyInput(input);
      const outPtr = outputRegion.ensure(out.length);
      wasm.scan_fields(inputPtr, input.length, outPtr, out.length);
      const compactLen = wasm.compact_fields(inputPtr, input.length, outPtr, out.length);
      copyBuffer(outPtr, out);
      input.set(new Uint8Array(wasm.memory.buffer, inputPtr, compactLen), 0);
      return compactLen;
    },
    scanFieldsCompactJs(input: string, _inputBuf: Buffer, out: Buffer, content: Buffer) {
      const outPtr = outputRegion.ensure(out.length);
      let compactInputPtr = 0;
      const compactLen = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) => {
        compactInputPtr = inputPtr;
        wasm.scan_fields(inputPtr, inputLen, outPtr, out.length);
        return wasm.compact_fields(inputPtr, inputLen, outPtr, out.length);
      });
      copyBuffer(outPtr, out);
      content.set(new Uint8Array(wasm.memory.buffer, compactInputPtr, Number(compactLen)), 0);
      return compactLen;
    },
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
  if (wasm) { return hasWasmCompatExports(wasm) ? wasm : wrapLegacyWasm(wasm); }

  const wasmDevPath = resolve(dir, "../../../crates/wasm/pkg/rs_csv_wasm.js");
  const wasmDev = tryRequire(require, wasmDevPath);
  if (wasmDev) { return hasWasmCompatExports(wasmDev) ? wasmDev : wrapLegacyWasm(wasmDev); }

  throw new Error(`@rs-csv/core: no binding found for ${key}. Install a platform package or @rs-csv/core-wasm32.`);
}

const addon = loadAddon();

export const scanFieldsCompact = addon.scanFieldsCompact as NativeScanFieldsCompact | undefined;
export const scanFieldsCompactJs = addon.scanFieldsCompactJs as ((input: string, inputBuf: Buffer, out: Buffer, content: Buffer) => number | bigint) | undefined;
export const inferCsv = addon.inferCsv as (input: Buffer | Uint8Array, out: Buffer, hasHeaders: boolean, maxSamples: number) => number | bigint;
export const inferCsvJs = addon.inferCsvJs as ((input: string, inputBuf: Buffer, out: Buffer, hasHeaders: boolean, maxSamples: number) => number | bigint) | undefined;
export const fusedTypedParseJs = addon.fusedTypedParseJs as ((input: string, inputBuf: Buffer, posBuf: Buffer, output: Buffer, sideBuf: Buffer, descriptor: Buffer, hasHeaders: boolean, maxSamples: number) => number | bigint) | undefined;
