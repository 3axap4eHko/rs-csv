import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

export type NativeParse = (input: Buffer | Uint8Array, cmdBuf: Buffer | Uint8Array, offset: number, typed: boolean) => number | bigint;

const PLATFORM_PACKAGES: Record<string, string> = {
  "linux-x64": "@rs-csv/core-linux-x64-gnu",
  "linux-arm64": "@rs-csv/core-linux-arm64-gnu",
  "darwin-x64": "@rs-csv/core-darwin-x64",
  "darwin-arm64": "@rs-csv/core-darwin-arm64",
  "win32-x64": "@rs-csv/core-win32-x64-msvc",
};

let cached: NativeParse | undefined;

export function loadParser(): NativeParse {
  if (cached) return cached;
  const require = createRequire(import.meta.url);

  // 1. platform-specific native package
  const key = `${process.platform}-${process.arch}`;
  const pkg = PLATFORM_PACKAGES[key];
  if (pkg) {
    try {
      cached = require(pkg).parseCsv;
      return cached!;
    } catch {}
  }

  // 2. local dev build (.node)
  const dir = dirname(fileURLToPath(import.meta.url));
  const devPath = resolve(dir, "../../../crates/napi/index.node");
  try {
    cached = require(devPath).parseCsv;
    return cached!;
  } catch {}

  // 3. wasm fallback
  try {
    cached = require("@rs-csv/core-wasm32").parseCsv;
    return cached!;
  } catch {}

  throw new Error(`@rs-csv/core: no binding found for ${key}. Install a platform package or @rs-csv/core-wasm32.`);
}
