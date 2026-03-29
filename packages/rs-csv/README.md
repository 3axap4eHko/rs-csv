# @rs-csv/core

[![npm version](https://img.shields.io/npm/v/@rs-csv/core)](https://www.npmjs.com/package/@rs-csv/core)
[![npm downloads](https://img.shields.io/npm/dm/@rs-csv/core)](https://www.npmjs.com/package/@rs-csv/core)
[![CI](https://github.com/3axap4eHko/rs-csv/actions/workflows/ci.yml/badge.svg)](https://github.com/3axap4eHko/rs-csv/actions/workflows/ci.yml)

The fastest CSV parser for JavaScript. Powered by Rust with SIMD acceleration. Parses CSV into typed JavaScript values (numbers, booleans, bigints, nulls) with zero-copy string handling.

## Install

```bash
npm install @rs-csv/core@next
```

Platform-specific native binaries are installed automatically via `optionalDependencies`.

Supported platforms:
- Linux x64 (glibc)
- Linux arm64 (glibc, musl)
- macOS x64, arm64
- Windows x64

## Usage

```js
import { parse } from "@rs-csv/core";

const result = parse("name,age,active\nAlice,30,true\nBob,25,false");

console.log(result.headers); // ["name", "age", "active"]
console.log(result.rows);    // [["Alice", 30, true], ["Bob", 25, false]]
```

## API

### `parse(csv: string | Buffer, opts?: ParseOptions): ParseResult`

Parses a CSV string or Buffer into headers and typed rows.

```ts
interface ParseResult {
  headers: string[];
  rows: (string | number | bigint | boolean | null | undefined)[][];
}

interface ParseOptions {
  typed?: boolean;       // auto-detect types (default true), false for all strings
  bufferSizeMB?: number; // internal command buffer size, default 16
}
```

### `parseRaw(input: Buffer, cmdBuf: Buffer, offset?: number): number`

Low-level API. Writes a binary command stream into `cmdBuf` and returns bytes consumed from `input`. Call in a loop with increasing offset until it returns 0.

## Type detection

Unquoted values are automatically typed:

| CSV value | JS type |
|-----------|---------|
| `42`, `3.14`, `-1` | `number` |
| `true`, `false` (case-insensitive) | `boolean` |
| empty field | `null` |
| `null` (case-insensitive) | `null` |
| integers > 15 digits | `bigint` |
| everything else | `string` |

Quoted values are always strings: `"42"` becomes `"42"`, not `42`.

## Performance

100K rows x 10 columns, mixed types (11 MB, Node.js, Linux x64). Benchmarked with [overtake](https://github.com/3axap4ehko/overtake) using isolated worker threads and statistical convergence.

| Parser | ops/s | vs @rs-csv/core | Heap |
|--------|-------|-----------------|------|
| **@rs-csv/core (strings)** | **356** | **1x** | **~0** |
| **@rs-csv/core (typed)** | **114** | 3.1x slower | **123 KB** |
| uDSV (strings) | 51.9 | 6.9x slower | 242 MB |
| d3-dsv (strings) | 24.2 | 14.7x slower | 94 MB |
| uDSV (typed) | 20.5 | 17.4x slower | 310 MB |
| PapaParse (strings) | 20.1 | 17.7x slower | 92 MB |
| PapaParse (typed) | 8.8 | 40.5x slower | 304 MB |

## How it works

The Rust core parses CSV into a flat binary command stream (9-byte fixed frames) that references slices of the original input buffer. The JavaScript interpreter reads this stream and materializes typed values. This avoids per-field FFI overhead and keeps string values zero-copy until accessed.

SIMD character classification (x86_64: SSE4.1 + pclmulqdq, wasm: simd128) identifies structural characters (commas, quotes, newlines) 64 bytes at a time. Carryless multiply computes quote parity across each chunk in a single instruction.

## License

MIT
