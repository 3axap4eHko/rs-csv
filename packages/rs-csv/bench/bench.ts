import 'overtake';

const ROWS = 100_000;
const COLS = 10;

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

const csv = generateCsv(ROWS, COLS);
const mb = Buffer.byteLength(csv) / 1024 / 1024;
console.log(`CSV: ${ROWS} rows x ${COLS} cols = ${mb.toFixed(2)} MB\n`);

const suite = benchmark(`${ROWS} rows x ${COLS} cols`, () => [csv, Buffer.from(csv)] as const);

function napiSetup() {
  return async () => {
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const dir = dirname(fileURLToPath(import.meta.url));
    const devPath = resolve(dir, '../../../crates/napi/index.node');
    const parseCsv = require(devPath).parseCsv;
    const cmdBuf = Buffer.alloc(64 * 1024 * 1024);
    return { parseCsv, cmdBuf };
  };
}

suite
  .target('@rs-csv/core (typed)', napiSetup())
  .measure('parse', ({ parseCsv, cmdBuf }, [,input]) => {
    parseCsv(input, cmdBuf, 0, true);
  });

suite
  .target('@rs-csv/core (strings)', napiSetup())
  .measure('parse', ({ parseCsv, cmdBuf }, [,input]) => {
    parseCsv(input, cmdBuf, 0, false);
  });

suite
  .target('uDSV (typed)', async () => {
    const { inferSchema, initParser } = await import('udsv');
    return { inferSchema, initParser };
  })
  .measure('parse', ({ inferSchema, initParser }, [csv]) => {
    const schema = inferSchema(csv);
    const parser = initParser(schema);
    parser.typedArrs(csv);
  });

suite
  .target('uDSV (strings)', async () => {
    const { inferSchema, initParser } = await import('udsv');
    return { inferSchema, initParser };
  })
  .measure('parse', ({ inferSchema, initParser }, [csv]) => {
    const schema = inferSchema(csv);
    const parser = initParser(schema);
    parser.stringArrs(csv);
  });

suite
  .target('PapaParse (typed)', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const Papa = require('papaparse');
    return { Papa };
  })
  .measure('parse', ({ Papa }, [csv]) => {
    Papa.parse(csv, { header: false, skipEmptyLines: true, dynamicTyping: true });
  });

suite
  .target('PapaParse (strings)', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const Papa = require('papaparse');
    return { Papa };
  })
  .measure('parse', ({ Papa }, [csv]) => {
    Papa.parse(csv, { header: false, skipEmptyLines: true });
  });

suite
  .target('d3-dsv', async () => {
    const { csvParse } = await import('d3-dsv');
    return { csvParse };
  })
  .measure('parse', ({ csvParse }, [csv]) => {
    csvParse(csv);
  });
