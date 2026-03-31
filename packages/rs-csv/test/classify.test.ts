import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const addon = require(resolve(dir, "../../../crates/napi/index.node"));

const CLS_HAS_QUOTES    = 1 << 0;
const CLS_HAS_ESCAPES   = 1 << 1;
const CLS_HAS_QUOTED_NL = 1 << 2;
const CLS_HAS_CRLF      = 1 << 3;
const CLS_HAS_BOM       = 1 << 4;

const clsBuf = Buffer.alloc(16);
const inputBuf = Buffer.alloc(1024);

function classify(csv: string) {
  addon.classifyCsv(csv, clsBuf, inputBuf);
  const v = new Uint32Array(clsBuf.buffer, clsBuf.byteOffset, 4);
  return { rows: v[0], cols: v[1], fields: v[2], flags: v[3] };
}

function classifyBuf(csv: Buffer) {
  addon.classifyCsvBuf(csv, clsBuf);
  const v = new Uint32Array(clsBuf.buffer, clsBuf.byteOffset, 4);
  return { rows: v[0], cols: v[1], fields: v[2], flags: v[3] };
}

describe("classify string", () => {
  test("simple unquoted", () => {
    const r = classify("a,b,c\n1,2,3\n4,5,6");
    assert.equal(r.rows, 3);
    assert.equal(r.cols, 3);
    assert.equal(r.fields, 9);
    assert.equal(r.flags, 0);
  });

  test("single row no trailing newline", () => {
    const r = classify("a,b,c");
    assert.equal(r.rows, 1);
    assert.equal(r.cols, 3);
    assert.equal(r.fields, 3);
  });

  test("single column", () => {
    const r = classify("a\n1\n2");
    assert.equal(r.rows, 3);
    assert.equal(r.cols, 1);
    assert.equal(r.fields, 3);
  });

  test("trailing newline", () => {
    const r = classify("a,b\n1,2\n");
    assert.equal(r.rows, 2);
    assert.equal(r.cols, 2);
    assert.equal(r.fields, 4);
  });

  test("detects quotes", () => {
    const r = classify('a,b\n"hello",world');
    assert.equal(r.rows, 2);
    assert.equal(r.cols, 2);
    assert.equal(r.flags & CLS_HAS_QUOTES, CLS_HAS_QUOTES);
    assert.equal(r.flags & CLS_HAS_ESCAPES, 0);
    assert.equal(r.flags & CLS_HAS_QUOTED_NL, 0);
  });

  test("detects escaped quotes", () => {
    const r = classify('a,b\n"he said ""hi""",world');
    assert.equal(r.rows, 2);
    assert.equal(r.cols, 2);
    assert.equal(r.flags & CLS_HAS_QUOTES, CLS_HAS_QUOTES);
    assert.equal(r.flags & CLS_HAS_ESCAPES, CLS_HAS_ESCAPES);
  });

  test("detects quoted newlines", () => {
    const r = classify('a,b\n"line1\nline2",world');
    assert.equal(r.rows, 2);
    assert.equal(r.cols, 2);
    assert.equal(r.flags & CLS_HAS_QUOTES, CLS_HAS_QUOTES);
    assert.equal(r.flags & CLS_HAS_QUOTED_NL, CLS_HAS_QUOTED_NL);
  });

  test("detects CRLF", () => {
    const r = classify("a,b\r\n1,2\r\n3,4");
    assert.equal(r.rows, 3);
    assert.equal(r.cols, 2);
    assert.equal(r.flags & CLS_HAS_CRLF, CLS_HAS_CRLF);
  });

  test("all flags combined", () => {
    const r = classify('\xEF\xBB\xBFa,b\r\n"he ""said""\nhi",world\r\n');
    assert.equal(r.rows, 2);
    assert.equal(r.cols, 2);
    assert.equal(r.flags & CLS_HAS_QUOTES, CLS_HAS_QUOTES);
    assert.equal(r.flags & CLS_HAS_ESCAPES, CLS_HAS_ESCAPES);
    assert.equal(r.flags & CLS_HAS_QUOTED_NL, CLS_HAS_QUOTED_NL);
    assert.equal(r.flags & CLS_HAS_CRLF, CLS_HAS_CRLF);
  });

  test("empty string", () => {
    const r = classify("");
    assert.equal(r.rows, 0);
    assert.equal(r.fields, 0);
  });
});

describe("classify buffer", () => {
  test("simple unquoted", () => {
    const r = classifyBuf(Buffer.from("a,b,c\n1,2,3\n4,5,6"));
    assert.equal(r.rows, 3);
    assert.equal(r.cols, 3);
    assert.equal(r.fields, 9);
    assert.equal(r.flags, 0);
  });

  test("detects BOM", () => {
    const r = classifyBuf(Buffer.from([0xEF, 0xBB, 0xBF, ...Buffer.from("a,b\n1,2")]));
    assert.equal(r.rows, 2);
    assert.equal(r.cols, 2);
  });

  test("detects escaped quotes", () => {
    const r = classifyBuf(Buffer.from('a,b\n"he said ""hi""",world'));
    assert.equal(r.flags & CLS_HAS_QUOTES, CLS_HAS_QUOTES);
    assert.equal(r.flags & CLS_HAS_ESCAPES, CLS_HAS_ESCAPES);
  });
});
