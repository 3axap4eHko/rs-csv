# rs-csv

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

100K rows x 10 columns (11 MB):

| Parser | Throughput | vs @rs-csv/core |
|--------|------------|-----------------|
| @rs-csv/core (native SIMD) | ~1.4 GB/s | 1x |
| @rs-csv/core (WASM+SIMD) | ~1.2 GB/s | 1.1x |
| PapaParse (typed) | ~80 MB/s | ~18x slower |
| PapaParse (strings only) | ~180 MB/s | ~8x slower |

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
