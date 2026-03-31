import 'overtake';

const ROWS = 50_000;
const COLS = 10;

function generateHeavyQuoted(rows: number, cols: number): string {
  const header = Array.from({ length: cols }, (_, i) => `col_${i}`).join(',');
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    const row: string[] = [];
    for (let j = 0; j < cols; j++) {
      const mod = j % 6;
      if (mod === 0) row.push(String(Math.floor(Math.random() * 100000)));
      else if (mod === 1) row.push(`"user${i}@example.com"`);
      else if (mod === 2) row.push(String(Math.random() > 0.5));
      else if (mod === 3) row.push(`"text ${j}\nwith\nnewlines"`);
      else if (mod === 4) row.push(`"he said ""hello"""`);
      else row.push(`2024-01-${String((i % 28) + 1).padStart(2, '0')}`);
    }
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

function generateLightQuoted(rows: number, cols: number): string {
  const header = Array.from({ length: cols }, (_, i) => `col_${i}`).join(',');
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    const row: string[] = [];
    for (let j = 0; j < cols; j++) {
      const mod = j % 6;
      if (mod === 0) row.push(String(Math.floor(Math.random() * 100000)));
      else if (mod === 1) row.push(`"user${i}@example.com"`);
      else if (mod === 2) row.push(String(Math.random() > 0.5));
      else row.push(`2024-01-${String((i % 28) + 1).padStart(2, '0')}`);
    }
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

const csvHeavy = generateHeavyQuoted(ROWS, COLS);
const csvLight = generateLightQuoted(ROWS, COLS);

const heavyMb = (Buffer.byteLength(csvHeavy) / (1024 * 1024)).toFixed(2);
const lightMb = (Buffer.byteLength(csvLight) / (1024 * 1024)).toFixed(2);
console.log(`Heavy: ${heavyMb} MB, Light: ${lightMb} MB\n`);

const suite = benchmark('heavy quoted (newlines + escapes)', () => csvHeavy)
  .feed('light quoted (simple quoted fields)', () => csvLight);

// All compound measures use parseCsv(buf) for identical Rust time.
// Subtract "Rust parse" from any compound to isolate the JS cost.
// Compare compounds against each other to see incremental costs:
//   scan    -> alloc    = array allocation cost
//   alloc   -> flat     = string creation cost
//   flat    -> nested   = nested row array overhead
//   nested  -> full     = escape handling overhead
const t = suite.target('quoted str pipeline', async () => {
  const { createRequire } = await import('module');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const d = dirname(fileURLToPath(import.meta.url));
  const r = createRequire(import.meta.url);
  const addon = r(resolve(d, '../../../crates/napi/index.node'));

  const parseCsv = addon.parseCsv as (input: Buffer, cmd: Buffer, off: number, typed: boolean, strRow: boolean) => number;
  const parseCsvStr = addon.parseCsvStr as (input: string, cmd: Buffer, off: number, typed: boolean, strRow: boolean) => number;

  const { interpretStrings } = await import('../src/interpret.ts');
  const { parse } = await import('../src/parse.ts');

  const cmdBuf = Buffer.alloc(16 * 1024 * 1024);

  let cachedBuf: Buffer;
  let cachedCsv: string;
  const ensureBuf = (csv: string) => {
    if (csv !== cachedCsv) { cachedBuf = Buffer.from(csv); cachedCsv = csv; }
    return cachedBuf;
  };

  function readU32LE(buf: Uint8Array, pos: number): number {
    return (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
  }

  function scanRecords(): number {
    const recordCount = readU32LE(cmdBuf, 0);
    let pos = 16;
    let acc = 0;
    for (let i = 0; i < recordCount; i++) {
      acc += readU32LE(cmdBuf, pos);
      acc += readU32LE(cmdBuf, pos + 4);
      pos += 8;
    }
    return acc;
  }

  function allocRows(): string[][] {
    const rowCount = readU32LE(cmdBuf, 8);
    const width = readU32LE(cmdBuf, 12);
    const rows: string[][] = new Array(rowCount);
    for (let r = 0; r < rowCount; r++) {
      rows[r] = new Array(width);
    }
    return rows;
  }

  function sliceFlat(str: string): string[] {
    const recordCount = readU32LE(cmdBuf, 0);
    const fields: string[] = new Array(recordCount);
    let pos = 16;
    for (let i = 0; i < recordCount; i++) {
      const start = readU32LE(cmdBuf, pos);
      const len = readU32LE(cmdBuf, pos + 4) & 0x3fffffff;
      fields[i] = str.slice(start, start + len);
      pos += 8;
    }
    return fields;
  }

  function sliceNested(str: string): string[][] {
    const recordCount = readU32LE(cmdBuf, 0);
    if (recordCount === 0) return [];
    const rowCount = readU32LE(cmdBuf, 8);
    const width = readU32LE(cmdBuf, 12);
    const rows: string[][] = new Array(rowCount);
    let pos = 16;
    for (let r = 0; r < rowCount; r++) {
      const row: string[] = new Array(width);
      for (let c = 0; c < width; c++) {
        const start = readU32LE(cmdBuf, pos);
        const len = readU32LE(cmdBuf, pos + 4) & 0x3fffffff;
        row[c] = str.slice(start, start + len);
        pos += 8;
      }
      rows[r] = row;
    }
    return rows;
  }

  return {
    cmdBuf, ensureBuf, parseCsv, parseCsvStr,
    interpretStrings, parse,
    scanRecords, allocRows, sliceFlat, sliceNested,
  };
});

t.measure('Buffer.from(csv)', (_ctx, csv) => {
  Buffer.from(csv);
});

t.measure('Rust parse (buf)', ({ cmdBuf, ensureBuf, parseCsv }, csv) => {
  parseCsv(ensureBuf(csv), cmdBuf, 0, false, false);
});

t.measure('Rust parse (str)', ({ cmdBuf, parseCsvStr }, csv) => {
  parseCsvStr(csv, cmdBuf, 0, false, false);
});

t.measure('Rust + scan records', ({ cmdBuf, ensureBuf, parseCsv, scanRecords }, csv) => {
  parseCsv(ensureBuf(csv), cmdBuf, 0, false, false);
  return scanRecords();
});

t.measure('Rust + alloc rows', ({ cmdBuf, ensureBuf, parseCsv, allocRows }, csv) => {
  parseCsv(ensureBuf(csv), cmdBuf, 0, false, false);
  return allocRows();
});

t.measure('Rust + slice flat', ({ cmdBuf, ensureBuf, parseCsv, sliceFlat }, csv) => {
  parseCsv(ensureBuf(csv), cmdBuf, 0, false, false);
  return sliceFlat(csv);
});

t.measure('Rust + slice nested', ({ cmdBuf, ensureBuf, parseCsv, sliceNested }, csv) => {
  parseCsv(ensureBuf(csv), cmdBuf, 0, false, false);
  return sliceNested(csv);
});

t.measure('Rust + interpretStr slice', ({ cmdBuf, ensureBuf, parseCsv, interpretStrings }, csv) => {
  const buf = ensureBuf(csv);
  parseCsv(buf, cmdBuf, 0, false, false);
  return interpretStrings(buf, cmdBuf, csv);
});

t.measure('Rust + interpretStr decode', ({ cmdBuf, ensureBuf, parseCsv, interpretStrings }, csv) => {
  const buf = ensureBuf(csv);
  parseCsv(buf, cmdBuf, 0, false, false);
  return interpretStrings(buf, cmdBuf);
});

t.measure('parse(csv)', ({ parse }, csv) => {
  parse(csv);
});
