import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const addon = require(resolve(dir, "../../../crates/napi/index.node"));

const ITERATIONS = 1_000_000;
const SIZES = [64, 1024, 64 * 1024, 1024 * 1024, 16 * 1024 * 1024];

function bench(name: string, n: number, fn: () => number) {
  let sink = 0;
  for (let i = 0; i < Math.min(n, 1000); i++) sink += fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) sink += fn();
  const elapsed = performance.now() - t0;
  const nsPerCall = (elapsed / n) * 1e6;
  const opsPerSec = (n / elapsed) * 1000;
  if (sink === -Infinity) console.log("never");
  console.log(
    `  ${name.padEnd(44)} ${nsPerCall.toFixed(0).padStart(8)} ns/call   ${formatOps(opsPerSec).padStart(10)} ops/s`,
  );
}

function formatOps(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024) + "MB";
  if (bytes >= 1024) return (bytes / 1024) + "KB";
  return bytes + "B";
}

function itersForSize(size: number): number {
  return Math.min(ITERATIONS, Math.max(1000, Math.floor(5e8 / size)));
}

// ---------------------------------------------------------------------------
console.log("All functions return u32 to keep return marshaling constant.\n");

console.log("=== Baseline: call overhead ===\n");
bench("noop() -> u32", ITERATIONS, () => addon.napiNoop());

// ---------------------------------------------------------------------------
console.log("\n=== Pass scalars ===\n");
bench("u32 -> u32", ITERATIONS, () => addon.napiAcceptU32(42));
bench("f64 -> u32", ITERATIONS, () => addon.napiAcceptF64(3.14));
bench("bool -> u32", ITERATIONS, () => addon.napiAcceptBool(true));
bench("BigInt -> u32", ITERATIONS, () => addon.napiAcceptBigint(9007199254740993n));

// ---------------------------------------------------------------------------
console.log("\n=== Pass string (Rust copies into String) ===\n");
for (const size of SIZES) {
  const s = "x".repeat(size);
  bench(`string ${formatSize(size)} -> u32`, itersForSize(size), () => addon.napiAcceptString(s));
}

// ---------------------------------------------------------------------------
console.log("\n=== Pass Buffer (zero-copy, read-only) ===\n");
for (const size of SIZES) {
  const buf = Buffer.alloc(size, 0x41);
  bench(`buffer ${formatSize(size)} -> u32`, itersForSize(size), () => addon.napiAcceptBuffer(buf));
}

// ---------------------------------------------------------------------------
console.log("\n=== Pass Buffer (zero-copy, mutable write) ===\n");
for (const size of SIZES) {
  const buf = Buffer.alloc(size, 0x41);
  bench(`buffer mut ${formatSize(size)} -> u32`, itersForSize(size), () => addon.napiAcceptBufferMut(buf));
}

// ---------------------------------------------------------------------------
console.log("\n=== Pass two Buffers ===\n");
for (const size of SIZES) {
  const a = Buffer.alloc(size, 0x41);
  const b = Buffer.alloc(size, 0x42);
  bench(`2x buffer ${formatSize(size)} -> u32`, itersForSize(size), () => addon.napiAcceptTwoBuffers(a, b));
}

// ---------------------------------------------------------------------------
console.log("\n=== Read all bytes in Rust (sum u8[]) ===\n");
for (const size of SIZES) {
  const buf = Buffer.alloc(size, 0x41);
  bench(`sum bytes ${formatSize(size)} -> u32`, itersForSize(size), () => addon.napiSumBytes(buf));
}

// ---------------------------------------------------------------------------
console.log("\n=== JS Buffer.from(string) baseline (no FFI) ===\n");
for (const size of SIZES) {
  const s = "x".repeat(size);
  bench(`Buffer.from(str) ${formatSize(size)}`, itersForSize(size), () => Buffer.from(s).length);
}

// ---------------------------------------------------------------------------
console.log("\n=== String vs Buffer.from+Buffer: same data, side by side ===\n");
for (const size of SIZES) {
  const s = "x".repeat(size);
  const buf = Buffer.from(s);
  bench(`  string -> rust  ${formatSize(size)}`, itersForSize(size), () => addon.napiAcceptString(s));
  bench(`  Buffer.from()   ${formatSize(size)}`, itersForSize(size), () => Buffer.from(s).length);
  bench(`  pre-buf -> rust ${formatSize(size)}`, itersForSize(size), () => addon.napiAcceptBuffer(buf));
  console.log();
}
