import 'overtake';

const ROWS = 10_000;
const COLS = 10;

function generateCsv(rows: number, cols: number, quoted: boolean): { csv: string; header: string; tail: string; chunks: [number, number][] } {
  const header = Array.from({ length: cols }, (_, i) => `col_${i}`).join(',');
  const lines = [header];
  const chunkRows = Math.floor((rows - 1) / 5);
  const chunks: [number, number][] = [];
  let pos = header.length + 1;
  let chunkStart = pos;
  for (let i = 0; i < rows; i++) {
    const row: string[] = [];
    for (let j = 0; j < cols; j++) {
      const mod = j % 6;
      if (mod === 0) row.push(String(Math.floor(Math.random() * 100000)));
      else if (mod === 1) row.push(`user${i}@example.com`);
      else if (mod === 2) row.push(String(Math.random() > 0.5));
      else if (quoted && mod === 3) row.push(`"text${j}\nis\nwrapped"`);
      else if (quoted && mod === 4) row.push(`"he said ""hello"""`);
      else row.push(`2024-01-${String((i % 28) + 1).padStart(2, '0')}`);
    }
    const line = row.join(',');
    lines.push(line);
    pos += line.length + 1;
    if (i < rows - 1 && (i + 1) % chunkRows === 0 && chunks.length < 4) {
      chunks.push([chunkStart, pos]);
      chunkStart = pos;
    }
  }
  const tail = lines.pop()!;
  chunks.push([chunkStart, pos - tail.length - 1]);
  const csv = lines.join('\n') + '\n';
  return { csv, header: header + '\n', tail, chunks };
}

const u = generateCsv(ROWS, COLS, false);
const q = generateCsv(ROWS, COLS, true);
const mb = Buffer.byteLength(u.csv) / 1024 / 1024;
console.log(`CSV: ${ROWS} rows x ${COLS} cols, 5 chunks = ${mb.toFixed(2)} MB\n`);

const suite = benchmark(
  `${ROWS} rows x ${COLS} cols unquoted`,
  () => u,
).feed(
  `${ROWS} rows x ${COLS} cols quoted`,
  () => q,
);

const rotate = async (ctx: any, { csv, header, tail, chunks: c }: any) => {
  const o = ctx.idx++ % 5;
  ctx.fresh = header
    + csv.slice(c[(0 + o) % 5][0], c[(0 + o) % 5][1])
    + csv.slice(c[(1 + o) % 5][0], c[(1 + o) % 5][1])
    + csv.slice(c[(2 + o) % 5][0], c[(2 + o) % 5][1])
    + csv.slice(c[(3 + o) % 5][0], c[(3 + o) % 5][1])
    + csv.slice(c[(4 + o) % 5][0], c[(4 + o) % 5][1])
    + tail;
};

// --- @rs-csv/core ---
const rscsv = suite.target('@rs-csv/core', async () => {
  const { parse } = await import('../src/parse.ts');
  let idx = 0;
  let fresh = '';
  return { parse, idx, fresh };
});

rscsv.measure('parse typed', ({ parse, fresh }) => {
  parse(fresh, { type: true });
}).pre(rotate);

rscsv.measure('parse raw', ({ parse, fresh }) => {
  parse(fresh);
}).pre(rotate);

// --- uDSV ---
const udsv = suite.target('uDSV', async () => {
  const { inferSchema, initParser } = await import('udsv');
  let idx = 0;
  let fresh = '';
  return { inferSchema, initParser, idx, fresh };
});

udsv.measure('parse typed', ({ initParser, inferSchema, fresh }) => {
  const parser = initParser(inferSchema(fresh));
  parser.typedArrs(fresh);
}).pre(rotate);

udsv.measure('parse raw', ({ initParser, inferSchema, fresh }) => {
  const parser = initParser(inferSchema(fresh));
  parser.stringArrs(fresh);
}).pre(rotate);

// --- PapaParse ---
const papa = suite.target('PapaParse', async () => {
  const { default: { default: Papa } } = await import('papaparse');
  let idx = 0;
  let fresh = '';
  return { Papa, idx, fresh };
});

papa.measure('parse typed', ({ Papa, fresh }) => {
  Papa.parse(fresh, { header: false, dynamicTyping: true });
}).pre(rotate);

papa.measure('parse raw', ({ Papa, fresh }) => {
  Papa.parse(fresh, { header: false });
}).pre(rotate);

// --- d3-dsv ---
const d3 = suite.target('d3-dsv', async () => {
  const { csvParseRows, autoType } = await import('d3-dsv');
  let idx = 0;
  let fresh = '';
  return { csvParseRows, autoType, idx, fresh };
});

d3.measure('parse typed', ({ csvParseRows, autoType, fresh }) => {
  csvParseRows(fresh, autoType);
}).pre(rotate);

d3.measure('parse raw', ({ csvParseRows, fresh }) => {
  csvParseRows(fresh);
}).pre(rotate);

// --- csv-parse ---
const csvparse = suite.target('csv-parse', async () => {
  const { parse } = await import('csv-parse/sync');
  let idx = 0;
  let fresh = '';
  return { parse, idx, fresh };
});

csvparse.measure('parse typed', ({ parse, fresh }) => {
  parse(fresh, { cast: true, relax_column_count: true });
}).pre(rotate);

csvparse.measure('parse raw', ({ parse, fresh }) => {
  parse(fresh, { relax_column_count: true });
}).pre(rotate);
