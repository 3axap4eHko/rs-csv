import 'overtake';
import { infer } from '../src/descriptor.ts';

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
const descU = infer(u.csv + u.tail, { headers: true });
const descQ = infer(q.csv + q.tail, { headers: true });
const mb = Buffer.byteLength(u.csv) / 1024 / 1024;
console.log(`CSV: ${ROWS} rows x ${COLS} cols, 5 chunks = ${mb.toFixed(2)} MB\n`);

const suite = benchmark(
  `${ROWS} rows x ${COLS} cols unquoted`,
  () => ({ ...u, desc: descU }),
).feed(
  `${ROWS} rows x ${COLS} cols quoted`,
  () => ({ ...q, desc: descQ }),
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

rscsv.measure('parse typed (desc)', ({ parse, fresh }, { desc }) => {
  parse(fresh, { type: true, descriptor: desc });
}).pre(rotate);

rscsv.measure('parse raw (desc)', ({ parse, fresh }, { desc }) => {
  parse(fresh, { descriptor: desc });
}).pre(rotate);
