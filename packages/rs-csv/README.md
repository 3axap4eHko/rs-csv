# @rs-csv/core

[![npm version](https://img.shields.io/npm/v/@rs-csv/core)](https://www.npmjs.com/package/@rs-csv/core)
[![npm downloads](https://img.shields.io/npm/dm/@rs-csv/core)](https://www.npmjs.com/package/@rs-csv/core)
[![CI](https://github.com/3axap4eHko/rs-csv/actions/workflows/ci.yml/badge.svg)](https://github.com/3axap4eHko/rs-csv/actions/workflows/ci.yml)

The fastest CSV parser for JavaScript. RFC 4180 compliant. Powered by Rust with SIMD acceleration. Parses CSV into typed JavaScript values (numbers, booleans, bigints, nulls) with zero-copy string handling.

## Install

```bash
npm install @rs-csv/core
```

Platform-specific native binaries are installed automatically via `optionalDependencies`.

Supported platforms:
- Linux x64 (glibc)
- Linux arm64 (glibc)
- macOS x64, arm64
- Windows x64

A WASM fallback (`@rs-csv/core-wasm32`) is available for unsupported platforms.

## Usage

```js
import { parse } from "@rs-csv/core";

// Raw string arrays (default)
const rows = parse("name,age,active\nAlice,30,true\nBob,25,false");
// [["name","age","active"], ["Alice","30","true"], ["Bob","25","false"]]

// Auto-typed values
const typed = parse("name,age,active\nAlice,30,true", { type: true });
// [["name","age","active"], ["Alice", 30, true]]

// Objects with headers
const objects = parse("name,age\nAlice,30\nBob,25", { type: true, headers: true });
// [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }]

// Custom schema
const custom = parse("name,age\nAlice,30", {
  type: [String, Number],
  headers: true,
});
// [{ name: "Alice", age: 30 }]
```

## API

### `parse(csv: string, opts?: ParseOptions): unknown[]`

```ts
interface ParseOptions {
  type?: boolean | Converter[];  // true for auto-typing, array for custom schema
  headers?: boolean;             // first row becomes object keys
}

type Converter = (value: string) => unknown;
type FieldValue = string | number | bigint | boolean | null | undefined;
```

| Options | Return type |
|---------|-------------|
| `{}` or none | `string[][]` |
| `{ type: true }` | `FieldValue[][]` |
| `{ headers: true }` | `Record<string, string>[]` |
| `{ type: true, headers: true }` | `Record<string, FieldValue>[]` |
| `{ type: [converters], headers: true }` | `Record<string, unknown>[]` |

## Type detection

When `type: true`, unquoted values are automatically typed:

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

10K rows x 10 columns, mixed types (~1 MB). Node.js on Linux x64. Benchmarked with [overtake](https://github.com/3axap4ehko/overtake) using isolated worker threads and statistical convergence. All values in ops/s (higher is better).

### Raw string output

| Parser | Unquoted | Quoted | vs @rs-csv/core |
|--------|----------|--------|-----------------|
| **@rs-csv/core** | **1,100** | **425** | **1x** |
| uDSV | 796 | 344 | 1.2-1.4x slower |
| d3-dsv | 329 | 184 | 2.3-3.3x slower |
| PapaParse | 240 | 151 | 2.8-4.6x slower |
| csv-parse | 51 | 45 | 9.4-21.6x slower |

### Typed output

| Parser | Unquoted | Quoted | vs @rs-csv/core |
|--------|----------|--------|-----------------|
| **@rs-csv/core** | **408** | **425** | **1x** |
| uDSV | 202 | 209 | 2.0x slower |
| PapaParse | 91 | 78 | 4.5-5.4x slower |
| d3-dsv | 61 | 70 | 6.1-6.7x slower |
| csv-parse | 39 | 32 | 10.5-13.3x slower |

## How it works

The Rust core uses SIMD character classification (SSE4.1 + PCLMULQDQ on x86_64, simd128 on WASM) to identify structural characters -- commas, quotes, newlines -- 64 bytes at a time. Carryless multiply computes quote parity across each chunk in a single instruction, instantly determining which delimiters are inside or outside quoted fields.

The parser writes field offsets into a shared binary buffer. The JavaScript interpreter reads these offsets and extracts fields using `String.slice()`, producing V8 SlicedStrings that reference the original input with near-zero allocation cost.

## License

MIT
