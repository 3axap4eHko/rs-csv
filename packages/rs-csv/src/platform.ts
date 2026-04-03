import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

export type NativeParse = (input: Buffer | Uint8Array, cmdBuf: Buffer | Uint8Array, offset: number, typed: boolean, strRow: boolean) => number | bigint;
export type NativeParseJs = (input: string, inputBuf: Buffer, cmdBuf: Buffer | Uint8Array, offset: number, typed: boolean, strRow: boolean) => number | bigint;
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
  "parseCsv",
  "parseCsvJs",
  "scanPositionsJs",
  "inferCsv",
  "inferCsvJs",
  "parseWithTypes",
  "parseWithTypesJs",
  "parseWithTypesJsUtf16",
  "scanFieldsBuf",
  "scanFieldsJs",
  "scanFieldsCompact",
  "scanFieldsCompactJs",
  "scanParseWithTypesJs",
  "scanParseWithTypesJsUtf16",
  "classifyCsv",
  "classifyCsvBuf",
  "memchrIndex",
  "napiNoop",
  "napiAcceptU32",
  "napiAcceptF64",
  "napiAcceptBool",
  "napiAcceptBigint",
  "napiAcceptString",
  "napiAcceptBuffer",
  "napiAcceptBufferMut",
  "napiAcceptTwoBuffers",
  "napiSumBytes",
] as const;

function hasWasmCompatExports(addon: Record<string, unknown>) {
  return WASM_COMPAT_EXPORTS.every((name) => typeof addon[name] === "function");
}

function wrapLegacyWasm(wasm: any): Record<string, unknown> {
  const inputRegion = createWasmRegion(wasm);
  const posRegion = createWasmRegion(wasm);
  const outputRegion = createWasmRegion(wasm);
  const colTypesRegion = createWasmRegion(wasm);
  const f64Bits = new DataView(new ArrayBuffer(8));

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
    parseCsv(input: Buffer | Uint8Array, cmdBuf: Buffer | Uint8Array, offset: number, typed: boolean, strRow: boolean) {
      const inputPtr = copyInput(input);
      const cmdPtr = outputRegion.ensure(cmdBuf.length);
      const consumed = wasm.parse_csv(inputPtr, input.length, cmdPtr, cmdBuf.length, offset, typed, strRow);
      copyBuffer(cmdPtr, cmdBuf);
      return consumed;
    },
    parseCsvJs(input: string, _inputBuf: Buffer, cmdBuf: Buffer | Uint8Array, offset: number, typed: boolean, strRow: boolean) {
      const cmdPtr = outputRegion.ensure(cmdBuf.length);
      const consumed = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) =>
        wasm.parse_csv(inputPtr, inputLen, cmdPtr, cmdBuf.length, offset, typed, strRow)
      );
      copyBuffer(cmdPtr, cmdBuf);
      return consumed;
    },
    scanPositionsJs(input: string, _inputBuf: Buffer, out: Buffer) {
      const outPtr = outputRegion.ensure(out.length);
      const consumed = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) =>
        wasm.scan_positions(inputPtr, inputLen, outPtr, out.length)
      );
      copyBuffer(outPtr, out);
      return consumed;
    },
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
    parseWithTypes(input: Buffer | Uint8Array, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array) {
      const inputPtr = copyInput(input);
      const posPtr = copyInput(posBuf, posRegion);
      const outputPtr = outputRegion.ensure(output.length);
      const colTypesPtr = copyInput(colTypes, colTypesRegion);
      const written = wasm.parse_with_types(
        inputPtr,
        input.length,
        posPtr,
        posBuf.length,
        outputPtr,
        output.length,
        colTypesPtr,
        colTypes.length,
      );
      copyBuffer(outputPtr, output);
      return written;
    },
    parseWithTypesJs(input: string, _inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array) {
      const posPtr = copyInput(posBuf, posRegion);
      const outputPtr = outputRegion.ensure(output.length);
      const colTypesPtr = copyInput(colTypes, colTypesRegion);
      const written = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) =>
        wasm.parse_with_types(
          inputPtr,
          inputLen,
          posPtr,
          posBuf.length,
          outputPtr,
          output.length,
          colTypesPtr,
          colTypes.length,
        )
      );
      copyBuffer(outputPtr, output);
      return written;
    },
    parseWithTypesJsUtf16(input: string, _inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array) {
      const posPtr = copyInput(posBuf, posRegion);
      const outputPtr = outputRegion.ensure(output.length);
      const colTypesPtr = copyInput(colTypes, colTypesRegion);
      const written = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) =>
        wasm.parse_with_types_utf16(
          inputPtr,
          inputLen,
          posPtr,
          posBuf.length,
          outputPtr,
          output.length,
          colTypesPtr,
          colTypes.length,
        )
      );
      copyBuffer(outputPtr, output);
      return written;
    },
    scanFieldsBuf(input: Buffer | Uint8Array, out: Buffer) {
      const inputPtr = copyInput(input);
      const outPtr = outputRegion.ensure(out.length);
      const consumed = wasm.scan_fields(inputPtr, input.length, outPtr, out.length);
      copyBuffer(outPtr, out);
      return consumed;
    },
    scanFieldsJs(input: string, _inputBuf: Buffer, out: Buffer) {
      const outPtr = outputRegion.ensure(out.length);
      const consumed = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) =>
        wasm.scan_fields(inputPtr, inputLen, outPtr, out.length)
      );
      copyBuffer(outPtr, out);
      return consumed;
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
    scanParseWithTypesJs(input: string, _inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array) {
      const posPtr = posRegion.ensure(posBuf.length);
      const outputPtr = outputRegion.ensure(output.length);
      const colTypesPtr = copyInput(colTypes, colTypesRegion);
      const written = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) => {
        wasm.scan_fields(inputPtr, inputLen, posPtr, posBuf.length);
        return wasm.parse_with_types(
          inputPtr,
          inputLen,
          posPtr,
          posBuf.length,
          outputPtr,
          output.length,
          colTypesPtr,
          colTypes.length,
        );
      });
      copyBuffer(posPtr, posBuf);
      copyBuffer(outputPtr, output);
      return written;
    },
    scanParseWithTypesJsUtf16(input: string, _inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array) {
      const posPtr = posRegion.ensure(posBuf.length);
      const outputPtr = outputRegion.ensure(output.length);
      const colTypesPtr = copyInput(colTypes, colTypesRegion);
      const written = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) => {
        wasm.scan_fields(inputPtr, inputLen, posPtr, posBuf.length);
        return wasm.parse_with_types_utf16(
          inputPtr,
          inputLen,
          posPtr,
          posBuf.length,
          outputPtr,
          output.length,
          colTypesPtr,
          colTypes.length,
        );
      });
      copyBuffer(posPtr, posBuf);
      copyBuffer(outputPtr, output);
      return written;
    },
    classifyCsvBuf(input: Buffer | Uint8Array, cls: Buffer) {
      const inputPtr = copyInput(input);
      const clsPtr = outputRegion.ensure(cls.length);
      wasm.classify_csv(inputPtr, input.length, clsPtr, cls.length);
      copyBuffer(clsPtr, cls);
      return input.length;
    },
    classifyCsv(input: string, cls: Buffer, _inputBuf: Buffer) {
      const clsPtr = outputRegion.ensure(cls.length);
      const written = withEncodedString(input, Buffer.byteLength(input), (inputPtr, inputLen) => {
        wasm.classify_csv(inputPtr, inputLen, clsPtr, cls.length);
        return inputLen;
      });
      copyBuffer(clsPtr, cls);
      return written;
    },
    memchrIndex(input: Buffer | Uint8Array, needle: number) {
      return input.indexOf(needle);
    },
    napiNoop() {
      return 0;
    },
    napiAcceptU32(n: number) {
      return (n ^ 1) >>> 0;
    },
    napiAcceptF64(n: number) {
      f64Bits.setFloat64(0, n, true);
      return f64Bits.getUint32(0, true);
    },
    napiAcceptBool(b: boolean) {
      return Number(b);
    },
    napiAcceptBigint(n: bigint) {
      return Number(n & 0xFFFF_FFFFn);
    },
    napiAcceptString(s: string) {
      return Buffer.byteLength(s);
    },
    napiAcceptBuffer(buf: Buffer | Uint8Array) {
      return buf.length;
    },
    napiAcceptBufferMut(buf: Buffer | Uint8Array) {
      if (buf.length > 0) {buf[0] ^= 1;}
      return buf.length;
    },
    napiAcceptTwoBuffers(a: Buffer | Uint8Array, b: Buffer | Uint8Array) {
      return a.length + b.length;
    },
    napiSumBytes(buf: Buffer | Uint8Array) {
      let sum = 0;
      for (const value of buf) {sum = (sum + value) >>> 0;}
      return sum;
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

export const parseFn = addon.parseCsv as NativeParse;
export const parseFnJs = addon.parseCsvJs as NativeParseJs | undefined;
export const scanPositionsJs = addon.scanPositionsJs as ((input: string, inputBuf: Buffer, out: Buffer) => number | bigint) | undefined;
export const scanFieldsJs = addon.scanFieldsJs as ((input: string, inputBuf: Buffer, out: Buffer) => number | bigint) | undefined;
export const scanFieldsCompact = addon.scanFieldsCompact as NativeScanFieldsCompact | undefined;
export const scanFieldsCompactJs = addon.scanFieldsCompactJs as ((input: string, inputBuf: Buffer, out: Buffer, content: Buffer) => number | bigint) | undefined;
export const classifyCsvBuf = addon.classifyCsvBuf as (input: Buffer, cls: Buffer) => number;
export const inferCsv = addon.inferCsv as (input: Buffer | Uint8Array, out: Buffer, hasHeaders: boolean, maxSamples: number) => number | bigint;
export const inferCsvJs = addon.inferCsvJs as ((input: string, inputBuf: Buffer, out: Buffer, hasHeaders: boolean, maxSamples: number) => number | bigint) | undefined;
export const parseWithTypes = addon.parseWithTypes as (input: Buffer | Uint8Array, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array) => number | bigint;
export const parseWithTypesJs = addon.parseWithTypesJs as ((input: string, inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array) => number | bigint) | undefined;
export const parseWithTypesJsUtf16 = addon.parseWithTypesJsUtf16 as ((input: string, inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array) => number | bigint) | undefined;
export const scanParseWithTypesJs = addon.scanParseWithTypesJs as ((input: string, inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array) => number | bigint) | undefined;
export const scanParseWithTypesJsUtf16 = addon.scanParseWithTypesJsUtf16 as ((input: string, inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array) => number | bigint) | undefined;
export const scanFieldsBuf = addon.scanFieldsBuf as ((input: Buffer | Uint8Array, out: Buffer) => number | bigint) | undefined;
export const memchrIndex = addon.memchrIndex as (input: Buffer, needle: number) => number;
