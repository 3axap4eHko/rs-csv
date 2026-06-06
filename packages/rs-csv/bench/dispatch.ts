import 'overtake';
import { infer } from '../src/descriptor.ts';
import { readU32LE } from '../src/types.ts';

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
      else if (mod === 1) row.push(quoted ? `"user${i}@example.com"` : `user${i}@example.com`);
      else if (mod === 2) row.push(String(Math.random() > 0.5));
      else if (quoted && mod === 3) row.push(`"text${j}\nis\nwrapped"`);
      else if (quoted && mod === 4) row.push(`"he said ""hello"""`);
      else row.push(`2024-01-${String((i % 28) + 1).padStart(2, '0')}`);
    }
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

const csvU = generateCsv(ROWS, COLS, false);
const csvQ = generateCsv(ROWS, COLS, true);
const descU = infer(csvU, { headers: true });
const descQ = infer(csvQ, { headers: true });

const mb = (Buffer.byteLength(csvU) / 1024 / 1024).toFixed(2);
console.log(`Unquoted: ${mb} MB, Quoted: ${(Buffer.byteLength(csvQ) / 1024 / 1024).toFixed(2)} MB\n`);

const suite = benchmark('unquoted', () => ({ csv: csvU, desc: descU }))
  .feed('quoted', () => ({ csv: csvQ, desc: descQ }));

const t = suite.target('dispatch layers', async () => {
  const { parse } = await import('../src/parse.ts');
  const { interpretCompact } = await import('../src/interpret.ts');
  const { scanFieldsCompactJs, scanFieldsCompact, fusedTypedParseJs } = await import('../src/platform.ts');

  function parseUnquotedJS(csv: string, width: number): string[][] {
    let start = 0;
    if (csv.charCodeAt(0) === 0xFEFF) start = 1;
    const lastCol = width - 1;
    const rows: string[][] = [];
    let pos = start;
    const len = csv.length;
    while (pos < len) {
      if (csv.charCodeAt(pos) === 10) { pos++; continue; }
      if (csv.charCodeAt(pos) === 13 && csv.charCodeAt(pos + 1) === 10) { pos += 2; continue; }
      const row: string[] = new Array(width);
      for (let c = 0; c < lastCol; c++) {
        const next = csv.indexOf(',', pos);
        if (next === -1) { row[c] = csv.slice(pos); rows.push(row); return rows; }
        row[c] = csv.slice(pos, next);
        pos = next + 1;
      }
      const next = csv.indexOf('\n', pos);
      if (next === -1) { row[lastCol] = csv.slice(pos); rows.push(row); break; }
      const end = csv.charCodeAt(next - 1) === 13 ? next - 1 : next;
      row[lastCol] = csv.slice(pos, end);
      rows.push(row);
      pos = next + 1;
    }
    return rows;
  }

  return { parse, parseUnquotedJS, interpretCompact, scanFieldsCompactJs, scanFieldsCompact, fusedTypedParseJs };
});

// 1. Pure JS parse with hardcoded width (no dispatch, no descriptor)
t.measure('parseUnquotedJS(width=10)', ({ parseUnquotedJS }, { csv }) => {
  return parseUnquotedJS(csv, 10);
});

// 2. csv.includes check
t.measure('csv.includes(")', (_ctx, { csv }) => {
  return csv.includes('"');
});

// 3. infer() call
t.measure('infer(csv)', (_ctx, { csv }) => {
  return infer(csv, { headers: true });
});

// 4. readU32LE from descriptor (flags + width)
t.measure('read desc flags+width', (_ctx, { desc }) => {
  return readU32LE(desc, 0) | readU32LE(desc, 4);
});

// 5. resolvePlan cost: create the plan object with descriptor
t.measure('resolvePlan only (desc)', ({ parse, parseUnquotedJS }, { csv, desc }) => {
  const flags = (desc[0] | (desc[1] << 8) | (desc[2] << 16) | (desc[3] << 24)) >>> 0;
  const width = (desc[4] | (desc[5] << 8) | (desc[6] << 16) | (desc[7] << 24)) >>> 0;
  const hasQuotes = (flags & 1) !== 0;
  return hasQuotes ? null : parseUnquotedJS(csv, width);
});

// 6. parse(csv, { descriptor }) - raw with descriptor (full dispatch)
t.measure('parse(csv, {desc})', ({ parse }, { csv, desc }) => {
  return parse(csv, { descriptor: desc });
});

// 7. parse(csv) - raw no descriptor
t.measure('parse(csv)', ({ parse }, { csv }) => {
  return parse(csv);
});

// 7. parse(csv, {type:true, desc})
t.measure('parse(csv, {type:true, desc})', ({ parse }, { csv, desc }) => {
  return parse(csv, { type: true, descriptor: desc });
});

// 8. parse(csv, {type:true})
t.measure('parse(csv, {type:true})', ({ parse }, { csv }) => {
  return parse(csv, { type: true });
});
