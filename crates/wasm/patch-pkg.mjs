import { readFile, writeFile } from "node:fs/promises";

const jsPath = new URL("./pkg/rs_csv_wasm.js", import.meta.url);
const dtsPath = new URL("./pkg/rs_csv_wasm.d.ts", import.meta.url);

const compatMarker = "// rs-csv wasm native-addon compatibility layer";

const compatJs = `
${compatMarker}
exports.memory = wasm.memory;

const __compatEncoder = new TextEncoder();

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
const __compatSide = __createCompatRegion();
const __compatDesc = __createCompatRegion();

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

function fusedTypedParseJs(input, _inputBuf, posBuf, output, sideBuf, descriptor, hasHeaders, maxSamples) {
    const posPtr = __compatPos.ensure(posBuf.length);
    const outputPtr = __compatOutput.ensure(output.length);
    const sidePtr = __compatSide.ensure(sideBuf.length);
    const descPtr = descriptor.length > 0 ? __copyInput(descriptor, __compatDesc) : 0;
    const written = __withEncodedString(input, (inputPtr, inputLen) =>
        fused_typed_parse(
            inputPtr, inputLen,
            posPtr, posBuf.length,
            outputPtr, output.length,
            sidePtr, sideBuf.length,
            descPtr, descriptor.length,
            hasHeaders, maxSamples,
        )
    );
    __copyOut(posPtr, posBuf);
    __copyOut(outputPtr, output);
    sideBuf.set(new Uint8Array(wasm.memory.buffer, sidePtr, sideBuf.length));
    return written;
}
exports.fusedTypedParseJs = fusedTypedParseJs;
`;

const compatDts = `

export const memory: WebAssembly.Memory;
export function inferCsv(input: Buffer | Uint8Array, out: Buffer, hasHeaders: boolean, maxSamples: number): number;
export function inferCsvJs(input: string, inputBuf: Buffer, out: Buffer, hasHeaders: boolean, maxSamples: number): number;
export function scanFieldsCompact(input: Buffer | Uint8Array, out: Buffer | Uint8Array): number;
export function scanFieldsCompactJs(input: string, inputBuf: Buffer, out: Buffer, content: Buffer): number;
export function fusedTypedParseJs(input: string, inputBuf: Buffer, posBuf: Buffer, output: Buffer, sideBuf: Buffer, descriptor: Buffer, hasHeaders: boolean, maxSamples: number): number;
`;

const jsSource = await readFile(jsPath, "utf8");
if (!jsSource.includes(compatMarker)) {
  await writeFile(jsPath, `${jsSource}\n${compatJs}`);
}

const dtsSource = await readFile(dtsPath, "utf8");
if (!dtsSource.includes("export function fusedTypedParseJs(")) {
  await writeFile(dtsPath, `${dtsSource}${compatDts}`);
}
