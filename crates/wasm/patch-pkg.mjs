import { readFile, writeFile } from "node:fs/promises";

const jsPath = new URL("./pkg/rs_csv_wasm.js", import.meta.url);
const dtsPath = new URL("./pkg/rs_csv_wasm.d.ts", import.meta.url);

const compatMarker = "// rs-csv wasm native-addon compatibility layer";

const compatJs = `
${compatMarker}
exports.memory = wasm.memory;

const __compatEncoder = new TextEncoder();
const __compatF64Bits = new DataView(new ArrayBuffer(8));

function __createCompatRegion() {
    let ptr = 0;
    let size = 0;
    return {
        ensure(minSize) {
            const nextSize = Math.max(minSize, 1);
            if (nextSize > size) {
                if (ptr !== 0) {
                    wasm_free(ptr, size);
                }
                size = nextSize;
                ptr = wasm_alloc(size);
            }
            return ptr;
        },
    };
}

const __compatInput = __createCompatRegion();
const __compatPos = __createCompatRegion();
const __compatOutput = __createCompatRegion();
const __compatColTypes = __createCompatRegion();

function __copyInput(input, region = __compatInput) {
    const ptr = region.ensure(input.length);
    if (input.length > 0) {
        new Uint8Array(wasm.memory.buffer, ptr, input.length).set(input);
    }
    return ptr;
}

function __copyOut(ptr, target) {
    target.set(new Uint8Array(wasm.memory.buffer, ptr, target.length));
}

function __withEncodedString(input, fn) {
    const maxBytes = Buffer.byteLength(input);
    const ptr = __compatInput.ensure(maxBytes);
    const view = new Uint8Array(wasm.memory.buffer, ptr, Math.max(maxBytes, 1));
    const { read, written } = __compatEncoder.encodeInto(input, view);
    if (read !== input.length) {
        throw new Error("WASM string scratch buffer is too small");
    }
    return fn(ptr, written);
}

function parseCsv(input, cmdBuf, offset, typed, strRow) {
    const inputPtr = __copyInput(input);
    const cmdPtr = __compatOutput.ensure(cmdBuf.length);
    const consumed = parse_csv(inputPtr, input.length, cmdPtr, cmdBuf.length, offset, typed, strRow);
    __copyOut(cmdPtr, cmdBuf);
    return consumed;
}
exports.parseCsv = parseCsv;

function parseCsvJs(input, _inputBuf, cmdBuf, offset, typed, strRow) {
    const cmdPtr = __compatOutput.ensure(cmdBuf.length);
    const consumed = __withEncodedString(input, (inputPtr, inputLen) =>
        parse_csv(inputPtr, inputLen, cmdPtr, cmdBuf.length, offset, typed, strRow)
    );
    __copyOut(cmdPtr, cmdBuf);
    return consumed;
}
exports.parseCsvJs = parseCsvJs;

function scanPositionsJs(input, _inputBuf, out) {
    const outPtr = __compatOutput.ensure(out.length);
    const consumed = __withEncodedString(input, (inputPtr, inputLen) =>
        scan_positions(inputPtr, inputLen, outPtr, out.length)
    );
    __copyOut(outPtr, out);
    return consumed;
}
exports.scanPositionsJs = scanPositionsJs;

function inferCsv(input, out, hasHeaders, maxSamples) {
    const inputPtr = __copyInput(input);
    const outPtr = __compatOutput.ensure(out.length);
    const written = infer_csv(inputPtr, input.length, outPtr, out.length, hasHeaders, maxSamples);
    __copyOut(outPtr, out);
    return written;
}
exports.inferCsv = inferCsv;

function inferCsvJs(input, _inputBuf, out, hasHeaders, maxSamples) {
    const outPtr = __compatOutput.ensure(out.length);
    const written = __withEncodedString(input, (inputPtr, inputLen) =>
        infer_csv(inputPtr, inputLen, outPtr, out.length, hasHeaders, maxSamples)
    );
    __copyOut(outPtr, out);
    return written;
}
exports.inferCsvJs = inferCsvJs;

function parseWithTypes(input, posBuf, output, colTypes) {
    const inputPtr = __copyInput(input);
    const posPtr = __copyInput(posBuf, __compatPos);
    const outputPtr = __compatOutput.ensure(output.length);
    const colTypesPtr = __copyInput(colTypes, __compatColTypes);
    const written = parse_with_types(
        inputPtr,
        input.length,
        posPtr,
        posBuf.length,
        outputPtr,
        output.length,
        colTypesPtr,
        colTypes.length,
    );
    __copyOut(outputPtr, output);
    return written;
}
exports.parseWithTypes = parseWithTypes;

function parseWithTypesJs(input, _inputBuf, posBuf, output, colTypes) {
    const posPtr = __copyInput(posBuf, __compatPos);
    const outputPtr = __compatOutput.ensure(output.length);
    const colTypesPtr = __copyInput(colTypes, __compatColTypes);
    const written = __withEncodedString(input, (inputPtr, inputLen) =>
        parse_with_types(
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
    __copyOut(outputPtr, output);
    return written;
}
exports.parseWithTypesJs = parseWithTypesJs;

function parseWithTypesJsUtf16(input, _inputBuf, posBuf, output, colTypes) {
    const posPtr = __copyInput(posBuf, __compatPos);
    const outputPtr = __compatOutput.ensure(output.length);
    const colTypesPtr = __copyInput(colTypes, __compatColTypes);
    const written = __withEncodedString(input, (inputPtr, inputLen) =>
        parse_with_types_utf16(
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
    __copyOut(outputPtr, output);
    return written;
}
exports.parseWithTypesJsUtf16 = parseWithTypesJsUtf16;

function scanFieldsBuf(input, out) {
    const inputPtr = __copyInput(input);
    const outPtr = __compatOutput.ensure(out.length);
    const consumed = scan_fields(inputPtr, input.length, outPtr, out.length);
    __copyOut(outPtr, out);
    return consumed;
}
exports.scanFieldsBuf = scanFieldsBuf;

function scanFieldsJs(input, _inputBuf, out) {
    const outPtr = __compatOutput.ensure(out.length);
    const consumed = __withEncodedString(input, (inputPtr, inputLen) =>
        scan_fields(inputPtr, inputLen, outPtr, out.length)
    );
    __copyOut(outPtr, out);
    return consumed;
}
exports.scanFieldsJs = scanFieldsJs;

function scanFieldsCompact(input, out) {
    const inputPtr = __copyInput(input);
    const outPtr = __compatOutput.ensure(out.length);
    scan_fields(inputPtr, input.length, outPtr, out.length);
    const compactLen = compact_fields(inputPtr, input.length, outPtr, out.length);
    __copyOut(outPtr, out);
    input.set(new Uint8Array(wasm.memory.buffer, inputPtr, compactLen), 0);
    return compactLen;
}
exports.scanFieldsCompact = scanFieldsCompact;

function scanFieldsCompactJs(input, _inputBuf, out, content) {
    const outPtr = __compatOutput.ensure(out.length);
    let compactInputPtr = 0;
    const compactLen = __withEncodedString(input, (inputPtr, inputLen) => {
        compactInputPtr = inputPtr;
        scan_fields(inputPtr, inputLen, outPtr, out.length);
        return compact_fields(inputPtr, inputLen, outPtr, out.length);
    });
    __copyOut(outPtr, out);
    content.set(new Uint8Array(wasm.memory.buffer, compactInputPtr, compactLen), 0);
    return compactLen;
}
exports.scanFieldsCompactJs = scanFieldsCompactJs;

function scanParseWithTypesJs(input, _inputBuf, posBuf, output, colTypes) {
    const posPtr = __compatPos.ensure(posBuf.length);
    const outputPtr = __compatOutput.ensure(output.length);
    const colTypesPtr = __copyInput(colTypes, __compatColTypes);
    const written = __withEncodedString(input, (inputPtr, inputLen) => {
        scan_fields(inputPtr, inputLen, posPtr, posBuf.length);
        return parse_with_types(
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
    __copyOut(posPtr, posBuf);
    __copyOut(outputPtr, output);
    return written;
}
exports.scanParseWithTypesJs = scanParseWithTypesJs;

function scanParseWithTypesJsUtf16(input, _inputBuf, posBuf, output, colTypes) {
    const posPtr = __compatPos.ensure(posBuf.length);
    const outputPtr = __compatOutput.ensure(output.length);
    const colTypesPtr = __copyInput(colTypes, __compatColTypes);
    const written = __withEncodedString(input, (inputPtr, inputLen) => {
        scan_fields(inputPtr, inputLen, posPtr, posBuf.length);
        return parse_with_types_utf16(
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
    __copyOut(posPtr, posBuf);
    __copyOut(outputPtr, output);
    return written;
}
exports.scanParseWithTypesJsUtf16 = scanParseWithTypesJsUtf16;

function classifyCsvBuf(input, cls) {
    const inputPtr = __copyInput(input);
    const clsPtr = __compatOutput.ensure(cls.length);
    classify_csv(inputPtr, input.length, clsPtr, cls.length);
    __copyOut(clsPtr, cls);
    return input.length;
}
exports.classifyCsvBuf = classifyCsvBuf;

function classifyCsv(input, cls, _inputBuf) {
    const clsPtr = __compatOutput.ensure(cls.length);
    const written = __withEncodedString(input, (inputPtr, inputLen) => {
        classify_csv(inputPtr, inputLen, clsPtr, cls.length);
        return inputLen;
    });
    __copyOut(clsPtr, cls);
    return written;
}
exports.classifyCsv = classifyCsv;

function memchrIndex(input, needle) {
    return input.indexOf(needle);
}
exports.memchrIndex = memchrIndex;

function napiNoop() {
    return 0;
}
exports.napiNoop = napiNoop;

function napiAcceptU32(n) {
    return (n ^ 1) >>> 0;
}
exports.napiAcceptU32 = napiAcceptU32;

function napiAcceptF64(n) {
    __compatF64Bits.setFloat64(0, n, true);
    return __compatF64Bits.getUint32(0, true);
}
exports.napiAcceptF64 = napiAcceptF64;

function napiAcceptBool(b) {
    return Number(b);
}
exports.napiAcceptBool = napiAcceptBool;

function napiAcceptBigint(n) {
    return Number(n & 0xFFFFFFFFn);
}
exports.napiAcceptBigint = napiAcceptBigint;

function napiAcceptString(s) {
    return Buffer.byteLength(s);
}
exports.napiAcceptString = napiAcceptString;

function napiAcceptBuffer(buf) {
    return buf.length;
}
exports.napiAcceptBuffer = napiAcceptBuffer;

function napiAcceptBufferMut(buf) {
    if (buf.length > 0) {
        buf[0] ^= 1;
    }
    return buf.length;
}
exports.napiAcceptBufferMut = napiAcceptBufferMut;

function napiAcceptTwoBuffers(a, b) {
    return a.length + b.length;
}
exports.napiAcceptTwoBuffers = napiAcceptTwoBuffers;

function napiSumBytes(buf) {
    let sum = 0;
    for (const value of buf) {
        sum = (sum + value) >>> 0;
    }
    return sum;
}
exports.napiSumBytes = napiSumBytes;
`;

const compatDts = `

export const memory: WebAssembly.Memory;
export function parseCsv(input: Buffer | Uint8Array, cmdBuf: Buffer | Uint8Array, offset: number, typed: boolean, strRow: boolean): number;
export function parseCsvJs(input: string, inputBuf: Buffer, cmdBuf: Buffer | Uint8Array, offset: number, typed: boolean, strRow: boolean): number;
export function scanPositionsJs(input: string, inputBuf: Buffer, out: Buffer): number;
export function inferCsv(input: Buffer | Uint8Array, out: Buffer, hasHeaders: boolean, maxSamples: number): number;
export function inferCsvJs(input: string, inputBuf: Buffer, out: Buffer, hasHeaders: boolean, maxSamples: number): number;
export function parseWithTypes(input: Buffer | Uint8Array, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array): number;
export function parseWithTypesJs(input: string, inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array): number;
export function parseWithTypesJsUtf16(input: string, inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array): number;
export function scanFieldsBuf(input: Buffer | Uint8Array, out: Buffer): number;
export function scanFieldsJs(input: string, inputBuf: Buffer, out: Buffer): number;
export function scanFieldsCompact(input: Buffer | Uint8Array, out: Buffer | Uint8Array): number;
export function scanFieldsCompactJs(input: string, inputBuf: Buffer, out: Buffer, content: Buffer): number;
export function scanParseWithTypesJs(input: string, inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array): number;
export function scanParseWithTypesJsUtf16(input: string, inputBuf: Buffer, posBuf: Buffer, output: Buffer, colTypes: Buffer | Uint8Array): number;
export function classifyCsvBuf(input: Buffer | Uint8Array, cls: Buffer): number;
export function classifyCsv(input: string, cls: Buffer, inputBuf: Buffer): number;
export function memchrIndex(input: Buffer | Uint8Array, needle: number): number;
export function napiNoop(): number;
export function napiAcceptU32(n: number): number;
export function napiAcceptF64(n: number): number;
export function napiAcceptBool(b: boolean): number;
export function napiAcceptBigint(n: bigint): number;
export function napiAcceptString(s: string): number;
export function napiAcceptBuffer(buf: Buffer | Uint8Array): number;
export function napiAcceptBufferMut(buf: Buffer | Uint8Array): number;
export function napiAcceptTwoBuffers(a: Buffer | Uint8Array, b: Buffer | Uint8Array): number;
export function napiSumBytes(buf: Buffer | Uint8Array): number;
`;

const jsSource = await readFile(jsPath, "utf8");
if (!jsSource.includes(compatMarker)) {
  await writeFile(jsPath, `${jsSource}\n${compatJs}`);
}

const dtsSource = await readFile(dtsPath, "utf8");
if (!dtsSource.includes("export function parseCsv(")) {
  await writeFile(dtsPath, `${dtsSource}${compatDts}`);
}
