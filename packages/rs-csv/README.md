# @rs-csv/core

[![npm version](https://img.shields.io/npm/v/@rs-csv/core)](https://www.npmjs.com/package/@rs-csv/core)
[![npm downloads](https://img.shields.io/npm/dm/@rs-csv/core)](https://www.npmjs.com/package/@rs-csv/core)
[![CI](https://github.com/3axap4eHko/rs-csv/actions/workflows/ci.yml/badge.svg)](https://github.com/3axap4eHko/rs-csv/actions/workflows/ci.yml)

The fastest CSV parser for JavaScript. RFC 4180 compliant. Powered by Rust with SIMD acceleration. Parses CSV into typed JavaScript values (numbers, booleans, bigints, nulls) with zero-copy string handling.

## Install

```bash
npm install @rs-csv/core
```

Requires Node.js >= 24.

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
| `{ type: [converters] }` | `unknown[][]` |
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
| **@rs-csv/core** | **1,115** | **708** | **1x** |
| uDSV | 801 | 338 | 1.4-2.1x slower |
| d3-dsv | 341 | 194 | 3.3-3.6x slower |
| PapaParse | 219 | 142 | 5.0-5.1x slower |
| csv-parse | 53 | 46 | 15.4-21.0x slower |

### Typed output

| Parser | Unquoted | Quoted | vs @rs-csv/core |
|--------|----------|--------|-----------------|
| **@rs-csv/core** | **461** | **450** | **1x** |
| uDSV | 219 | 227 | 2.0-2.1x slower |
| PapaParse | 88 | 74 | 5.2-6.1x slower |
| d3-dsv | 65 | 72 | 6.3-7.1x slower |
| csv-parse | 41 | 36 | 11.2-12.5x slower |

## License

MIT
