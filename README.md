# rs-csv

[![npm version](https://img.shields.io/npm/v/@rs-csv/core)](https://www.npmjs.com/package/@rs-csv/core)
[![npm downloads](https://img.shields.io/npm/dm/@rs-csv/core)](https://www.npmjs.com/package/@rs-csv/core)
[![CI](https://github.com/3axap4eHko/rs-csv/actions/workflows/ci.yml/badge.svg)](https://github.com/3axap4eHko/rs-csv/actions/workflows/ci.yml)

High-performance CSV parsing library with a Rust core and SIMD acceleration, available as a Node.js native addon and WebAssembly module.

## Packages

| Package | Description |
|---------|-------------|
| [@rs-csv/core](packages/rs-csv) | Main package - CSV parser with automatic type detection |

## Architecture

```
crates/
  core/     Rust parsing engine (SIMD character classification, type detection)
  napi/     Node.js native addon binding
  wasm/     WebAssembly binding with SIMD128
packages/
  rs-csv/   TypeScript API, interpreter, platform resolution
```

The parser produces a flat binary command stream (fixed 9-byte frames) that references slices of the original input. The JavaScript interpreter reads this stream and materializes typed values. This keeps the Rust-to-JS boundary to a single FFI call with shared memory.

### SIMD

- **x86_64**: SSE4.1 nibble lookup + pclmulqdq carryless multiply for quote parity
- **wasm32**: SIMD128 with i8x16 swizzle + software prefix XOR
- **Scalar fallback**: memchr-accelerated delimiter scanning

### Performance

100K rows x 10 columns, mixed types (11 MB, Node.js, Linux x64). Benchmarked with [overtake](https://github.com/3axap4ehko/overtake).

| Parser | ops/s | vs @rs-csv/core | Heap |
|--------|-------|-----------------|------|
| **@rs-csv/core (strings)** | **356** | **1x** | **~0** |
| **@rs-csv/core (typed)** | **114** | 3.1x slower | **123 KB** |
| uDSV (strings) | 51.9 | 6.9x slower | 242 MB |
| d3-dsv (strings) | 24.2 | 14.7x slower | 94 MB |
| uDSV (typed) | 20.5 | 17.4x slower | 310 MB |
| PapaParse (strings) | 20.1 | 17.7x slower | 92 MB |
| PapaParse (typed) | 8.8 | 40.5x slower | 304 MB |

## Development

```bash
# Build native addon
cd crates/napi && ./node_modules/.bin/napi build --release --platform

# Build WASM
RUSTFLAGS="-C target-feature=+simd128" wasm-pack build crates/wasm --target nodejs --release

# Test
bun test packages/rs-csv/test/

# Bench
bun run packages/rs-csv/bench/bench.ts
```

## Publishing

Push a version tag to trigger CI build + publish:

```bash
git tag v0.1.0
git push origin v0.1.0
```

- Tags with `-` (e.g. `v0.1.0-rc.0`) publish to the `next` dist-tag
- Clean tags (e.g. `v0.1.0`) publish to `latest`

## License

[MIT](LICENSE)
