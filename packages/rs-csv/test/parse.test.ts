import { describe, test, expect } from "bun:test";
import { parse, parseRaw } from "../src/parse.ts";

describe("basic parsing", () => {
  test("simple csv", () => {
    const result = parse("name,age,city\nAlice,30,NYC\nBob,25,LA");
    expect(result.headers).toEqual(["name", "age", "city"]);
    expect(result.rows).toEqual([
      ["Alice", 30, "NYC"],
      ["Bob", 25, "LA"],
    ]);
  });

  test("single row", () => {
    const result = parse("a,b\n1,2");
    expect(result.headers).toEqual(["a", "b"]);
    expect(result.rows).toEqual([[1, 2]]);
  });
});

describe("quoted fields", () => {
  test("commas inside quotes", () => {
    const result = parse('a,b\n"hello, world",123');
    expect(result.rows[0][0]).toBe("hello, world");
  });

  test("first field quoted", () => {
    const result = parse('"abc",def\n1,2');
    expect(result.headers).toEqual(["abc", "def"]);
  });

  test("middle field quoted", () => {
    const result = parse('a,"abc",c\n1,2,3');
    expect(result.headers).toEqual(["a", "abc", "c"]);
  });

  test("empty quoted field", () => {
    const result = parse('a,b\n"",2');
    expect(result.rows[0][0]).toBe("");
  });
});

describe("escaped quotes", () => {
  test("double quotes become single", () => {
    const result = parse('a\n"he said ""hi"""');
    expect(result.rows[0][0]).toBe('he said "hi"');
  });

  test("single escaped pair", () => {
    const result = parse('a\n"b""c"');
    expect(result.rows[0][0]).toBe('b"c');
  });
});

describe("blank lines", () => {
  test("blank line between rows", () => {
    const result = parse("a,b\n\n1,2");
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]).toEqual([1, 2]);
  });

  test("multiple blank lines", () => {
    const result = parse("a,b\n\n\n\n1,2");
    expect(result.rows.length).toBe(1);
  });
});

describe("trailing comma", () => {
  test("trailing comma with newline", () => {
    const result = parse("a,b,c\n1,2,\n4,5,6");
    expect(result.rows[0]).toEqual([1, 2, null]);
  });

  test("trailing comma at EOF", () => {
    const result = parse("a,b,c\n1,2,");
    expect(result.rows[0]).toEqual([1, 2, null]);
  });
});

describe("type detection", () => {
  test("numbers", () => {
    const result = parse("v\n42\n3.14\n-1\n+0.5");
    expect(result.rows.map((r) => r[0])).toEqual([42, 3.14, -1, 0.5]);
  });

  test("booleans", () => {
    const result = parse("v\ntrue\nfalse\nTRUE\nFalse");
    expect(result.rows.map((r) => r[0])).toEqual([true, false, true, false]);
  });

  test("nulls", () => {
    const result = parse("v\n\nnull\nNULL");
    // blank lines are skipped, so only null/NULL rows remain
    expect(result.rows.map((r) => r[0])).toEqual([null, null]);
  });

  test("quoted values stay strings", () => {
    const result = parse('v\n"42"\n"true"\n"null"');
    expect(result.rows.map((r) => r[0])).toEqual(["42", "true", "null"]);
  });
});

describe("line endings", () => {
  test("CRLF", () => {
    const result = parse("a,b\r\n1,2\r\n3,4");
    expect(result.rows).toEqual([[1, 2], [3, 4]]);
  });

  test("CR only", () => {
    const result = parse("a,b\r1,2\r3,4");
    expect(result.rows).toEqual([[1, 2], [3, 4]]);
  });
});

describe("BOM", () => {
  test("UTF-8 BOM is stripped", () => {
    const csv = Buffer.from("a,b\n1,2");
    const input = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv]);
    const result = parse(input);
    expect(result.headers).toEqual(["a", "b"]);
  });
});

describe("overflow", () => {
  test("tiny buffer returns 0 (no room for a row + EOF)", () => {
    const input = Buffer.from("a,b,c\n1,2,3");
    const tinyBuf = Buffer.alloc(9);
    const result = parseRaw(input, tinyBuf);
    expect(result).toBe(0);
  });
});
