import { parseRaw } from "../src/parse.ts";
import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const dir = dirname(fileURLToPath(import.meta.url));
const Papa = require("papaparse");

// wasm loaded from build output in crates/wasm/pkg/
let wasmBinding: any;
try {
  wasmBinding = require(resolve(dir, "../../../crates/wasm/pkg/rs_csv_wasm.js"));
} catch {
  console.log("wasm not built, skipping wasm benchmarks. Run: RUSTFLAGS=\"-C target-feature=+simd128\" wasm-pack build crates/wasm --target nodejs --release");
}

const ROWS = 100_000;
const COLS = 10;
const RUNS = 10;

function generateCsv(rows: number, cols: number): string {
  const header = Array.from({ length: cols }, (_, i) => `col_${i}`).join(",");
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    const row: string[] = [];
    for (let j = 0; j < cols; j++) {
      const mod = j % 4;
      if (mod === 0) row.push(String(Math.floor(Math.random() * 100000)));
      else if (mod === 1) row.push(`user${i}@example.com`);
      else if (mod === 2) row.push(String(Math.random() > 0.5));
      else row.push(`2024-01-${String((i % 28) + 1).padStart(2, "0")}`);
    }
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function bench(name: string, fn: () => void): number {
  for (let i = 0; i < 3; i++) fn();
  let total = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    total += performance.now() - t0;
  }
  return total / RUNS;
}

const csv = generateCsv(ROWS, COLS);
const inputBuf = Buffer.from(csv);
const inputU8 = new Uint8Array(inputBuf);
const cmdBuf = Buffer.alloc(64 * 1024 * 1024);
const mb = inputBuf.length / 1024 / 1024;

console.log(`CSV: ${ROWS} rows x ${COLS} cols = ${mb.toFixed(2)} MB`);
console.log(`Runs: ${RUNS}\n`);

const native = bench("native", () => parseRaw(inputBuf, cmdBuf));
console.log(`rs-csv native (SIMD):    ${native.toFixed(2)}ms  (${(mb / (native / 1000)).toFixed(0)} MB/s)`);

if (wasmBinding) {
  const wasmInputPtr = wasmBinding.wasm_alloc(inputU8.length);
  const wasmCmdSize = 64 * 1024 * 1024;
  const wasmCmdPtr = wasmBinding.wasm_alloc(wasmCmdSize);
  new Uint8Array(wasmBinding.memory.buffer).set(inputU8, wasmInputPtr);

  const wasmTime = bench("wasm", () => wasmBinding.parse_csv(wasmInputPtr, inputU8.length, wasmCmdPtr, wasmCmdSize));
  console.log(`rs-csv wasm+SIMD:        ${wasmTime.toFixed(2)}ms  (${(mb / (wasmTime / 1000)).toFixed(0)} MB/s)  ${(wasmTime / native).toFixed(1)}x vs native`);

  wasmBinding.wasm_free(wasmInputPtr, inputU8.length);
  wasmBinding.wasm_free(wasmCmdPtr, wasmCmdSize);
}

const papaTyped = bench("papa-typed", () => Papa.parse(csv, { header: false, skipEmptyLines: true, dynamicTyping: true }));
const papaStr = bench("papa-str", () => Papa.parse(csv, { header: false, skipEmptyLines: true }));

console.log(`PapaParse (typed):       ${papaTyped.toFixed(2)}ms  ${(papaTyped / native).toFixed(1)}x vs native`);
console.log(`PapaParse (strings):     ${papaStr.toFixed(2)}ms  ${(papaStr / native).toFixed(1)}x vs native`);
