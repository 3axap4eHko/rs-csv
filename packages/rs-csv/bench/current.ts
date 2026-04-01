import 'overtake';

const ROWS = 10_000;
const COLS = 10;

function generateCsv(rows: number, cols: number, quoted: boolean): string {
  const header = Array.from({ length: cols }, (_, i) => `col_${i}`).join(',');
  const lines = [header];
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
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

const csv = generateCsv(ROWS, COLS, false);
const csvQ = generateCsv(ROWS, COLS, true);
const mb = Buffer.byteLength(csv) / 1024 / 1024;
console.log(`CSV: ${ROWS} rows x ${COLS} cols = ${mb.toFixed(2)} MB\n`);

const suite = benchmark(`${ROWS} rows x ${COLS} cols unquoted`, () => csv)
  .feed(`${ROWS} rows x ${COLS} cols quoted`, () => csvQ);

const rscsv = suite.target('@rs-csv/core', async () => {
  const { parse } = await import('../src/parse.ts');
  return { parse };
});

rscsv.measure('parse typed', ({ parse }, csv) => {
  parse(csv, { type: true });
});

rscsv.measure('parse raw', ({ parse }, csv) => {
  parse(csv);
});

