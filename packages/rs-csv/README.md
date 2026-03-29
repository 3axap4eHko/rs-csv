# @rs-csv/core

Fast CSV parser powered by Rust with SIMD acceleration. Parses CSV into typed JavaScript values (numbers, booleans, bigints, nulls) with zero-copy string handling.

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

100K rows x 10 columns (11 MB):

| Parser | Time | Throughput | vs native |
|--------|------|------------|-----------|
| @rs-csv/core (SIMD) | ~8ms | ~1.4 GB/s | 1x |
| @rs-csv/core (WASM+SIMD) | ~9ms | ~1.2 GB/s | 1.1x |
| PapaParse (typed) | ~140ms | - | ~18x slower |
| PapaParse (strings) | ~60ms | - | ~8x slower |

## How it works

The Rust core parses CSV into a flat binary command stream (9-byte fixed frames) that references slices of the original input buffer. The JavaScript interpreter reads this stream and materializes typed values. This avoids per-field FFI overhead and keeps string values zero-copy until accessed.

SIMD character classification (x86_64: SSE4.1 + pclmulqdq, wasm: simd128) identifies structural characters (commas, quotes, newlines) 64 bytes at a time. Carryless multiply computes quote parity across each chunk in a single instruction.

## License

MIT
