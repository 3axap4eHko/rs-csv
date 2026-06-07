import { describe, test, expect } from "bun:test";
import { infer, Type } from "../src/descriptor.ts";
import { parse } from "../src/parse.ts";

describe("basic parsing (default = raw strings)", () => {
  test("simple csv", () => {
    const rows = parse("name,age,city\nAlice,30,NYC\nBob,25,LA");
    expect(rows).toEqual([
      ["name", "age", "city"],
      ["Alice", "30", "NYC"],
      ["Bob", "25", "LA"],
    ]);
  });

  test("single row", () => {
    const rows = parse("a,b\n1,2");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("headers mode", () => {
    const rows = parse("name,age\nAlice,30\nBob,25", { headers: true });
    expect(rows).toEqual([
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);
  });
});

describe("quoted fields", () => {
  test("commas inside quotes", () => {
    const rows = parse('a,b\n"hello, world",123', { type: true });
    expect(rows[1][0]).toBe("hello, world");
  });

  test("first field quoted", () => {
    const rows = parse('"abc",def\n1,2');
    expect(rows[0]).toEqual(["abc", "def"]);
  });

  test("middle field quoted", () => {
    const rows = parse('a,"abc",c\n1,2,3');
    expect(rows[0]).toEqual(["a", "abc", "c"]);
  });

  test("empty quoted field", () => {
    const rows = parse('a,b\n"",2');
    expect(rows[1][0]).toBe("");
  });
});

describe("escaped quotes", () => {
  test("double quotes become single", () => {
    const rows = parse('a\n"he said ""hi"""');
    expect(rows[1][0]).toBe('he said "hi"');
  });

  test("single escaped pair", () => {
    const rows = parse('a\n"b""c"');
    expect(rows[1][0]).toBe('b"c');
  });

  test("with commas and escapes", () => {
    const rows = parse('a,b\n"x,""y""",z');
    expect(rows[1]).toEqual(['x,"y"', "z"]);
  });
});

describe("blank lines", () => {
  test("blank line between rows", () => {
    const rows = parse("a,b\n\n1,2");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("multiple blank lines", () => {
    const rows = parse("a,b\n\n\n\n1,2");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("CRLF blank line between rows", () => {
    const rows = parse("a,b\r\n\r\n1,2");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("multiple CRLF blank lines", () => {
    const rows = parse("a,b\r\n\r\n\r\n1,2");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("trailing comma", () => {
  test("trailing comma with newline", () => {
    const rows = parse("a,b,c\n1,2,\n4,5,6", { type: true });
    expect(rows[1]).toEqual([1, 2, undefined]);
  });

  test("trailing comma at EOF", () => {
    const rows = parse("a,b,c\n1,2,", { type: true });
    expect(rows[1]).toEqual([1, 2, undefined]);
  });
});

describe("type: true (autotype)", () => {
  test("numbers", () => {
    const rows = parse("v\n42\n3.14\n-1\n+0.5", { type: true });
    expect(rows.slice(1).map((r: any) => r[0])).toEqual([42, 3.14, -1, 0.5]);
  });

  test("booleans", () => {
    const rows = parse("v\ntrue\nfalse\nTRUE\nFalse", { type: true });
    expect(rows.slice(1).map((r: any) => r[0])).toEqual([true, false, true, false]);
  });

  test("nulls", () => {
    const rows = parse("v\n\nnull\nNULL", { type: true });
    expect(rows.slice(1).map((r: any) => r[0])).toEqual([undefined, "null", "NULL"]);
  });

  test("quoted values stay strings", () => {
    const rows = parse('v\n"42"\n"true"\n"null"', { type: true });
    expect(rows.slice(1).map((r: any) => r[0])).toEqual(["42", "true", "null"]);
  });

  test("autotyped with headers", () => {
    const rows = parse("name,age\nAlice,30\nBob,25", { type: true, headers: true });
    expect(rows).toEqual([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ]);
  });

  test("autotyped without headers infers types from row 2 onward", () => {
    expect(parse("1\ntrue", { type: true })).toEqual([[false], [true]]);
    expect(parse("name\n42\n99", { type: true })).toEqual([["name"], [42], [99]]);
  });

  test("autotyped inferred number columns fall back to strings instead of NaN", () => {
    const csv = ["a", ...Array.from({ length: 100 }, (_, i) => String(i)), "x"].join("\n");
    expect(parse(csv, { type: true, headers: true }).at(-1)).toEqual({ a: "x" });
  });

  test("forced NUMBER column keeps literal nan distinct from a non-numeric fallback", () => {
    const desc = infer("0", { types: [Type.Number] });
    const rows = parse("nan\nx\n5\n", { type: true, descriptor: desc }) as unknown[][];
    expect(Number.isNaN(rows[0][0])).toBe(true);
    expect(rows[1][0]).toBe("x");
    expect(rows[2][0]).toBe(5);
  });
});

describe("default (raw strings)", () => {
  test("all values are strings", () => {
    const rows = parse("a\n42\ntrue\nnull");
    expect(rows.slice(1).map((r: any) => r[0])).toEqual(["42", "true", "null"]);
  });

  test("unquoted raw rows", () => {
    const rows = parse("name,age\nAlice,30\nBob,25");
    expect(rows).toEqual([
      ["name", "age"],
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
  });

  test("raw with headers", () => {
    const csv = 'name,quote\nAlice,"he said ""hi"""';
    expect(parse(csv, { headers: true })).toEqual([
      { name: "Alice", quote: 'he said "hi"' },
    ]);
  });
});

describe("type: Converter[] (schema)", () => {
  test("converters applied positionally", () => {
    const rows = parse("a,b,c\n1,2,3", { type: [Number, String, Number] });
    expect(rows).toEqual([["a", "b", "c"], [1, "2", 3]]);
  });

  test("schema with headers", () => {
    const rows = parse("name,age,active\nAlice,30,true", {
      type: [String, Number, (v: string) => v === "true"],
      headers: true,
    });
    expect(rows).toEqual([{ name: "Alice", age: 30, active: true }]);
  });

  test("missing converter uses passthrough", () => {
    const rows = parse("a,b,c\nx,2,y", { type: [String, Number] });
    expect(rows).toEqual([["a", "b", "c"], ["x", 2, "y"]]);
  });

  test("schema on quoted csv", () => {
    const rows = parse('a,b\n"hello",42', { type: [String, Number] });
    expect(rows).toEqual([["a", "b"], ["hello", 42]]);
  });
});

describe("unicode strings", () => {
  test("non-ascii autotyped", () => {
    const rows = parse("name,city,age\nAndr\u00e9,S\u00e3o Paulo,30\nZo\u00eb,M\u00fcnchen,25", { type: true, headers: true });
    expect(rows).toEqual([
      { name: "Andr\u00e9", city: "S\u00e3o Paulo", age: 30 },
      { name: "Zo\u00eb", city: "M\u00fcnchen", age: 25 },
    ]);
  });

  test("non-ascii raw", () => {
    const rows = parse("name,city\nAndr\u00e9,S\u00e3o Paulo\nZo\u00eb,M\u00fcnchen");
    expect(rows).toEqual([
      ["name", "city"],
      ["Andr\u00e9", "S\u00e3o Paulo"],
      ["Zo\u00eb", "M\u00fcnchen"],
    ]);
  });

  test("non-ascii multi-chunk autotyped input does not truncate", () => {
    const expectedRow = ["\u{1F600}", "\u{1F600}", "\u{1F600}", "\u{1F600}", "\u{1F600}"];
    const rowCount = 380_000;
    const csv = `${expectedRow.join(",")}\n`.repeat(rowCount);
    const rows = parse(csv, { type: true }) as string[][];

    expect(rows.length).toBe(rowCount);
    expect(rows[0]).toEqual(expectedRow);
    expect(rows.at(-1)).toEqual(expectedRow);
  }, 10000);

  test("descriptor autotyped path preserves astral strings without trailing newline", () => {
    const csv = "name\n\u{1F600}";
    const desc = infer(csv, { headers: true });
    expect(parse(csv, { type: true, headers: true, descriptor: desc })).toEqual([
      { name: "\u{1F600}" },
    ]);
  });

  test("descriptor autotyped path preserves escaped and empty quoted strings", () => {
    const csv = 'name,quote,empty\nAlice,"he said ""hi""",""';
    const desc = infer(csv, { headers: true });
    expect(parse(csv, { type: true, headers: true, descriptor: desc })).toEqual([
      { name: "Alice", quote: 'he said "hi"', empty: "" },
    ]);
  });

  test("headers: true ignores descriptor header names and parses the current header row", () => {
    const desc = infer("name\n1", { headers: true });
    expect(parse('"first,name"\n1', { type: true, headers: true, descriptor: desc })).toEqual([
      { "first,name": 1 },
    ]);
  });

  test("descriptor headers are reused when headers is omitted", () => {
    const desc = infer("name\n1", { headers: true });
    expect(parse("ignored\n2", { type: true, descriptor: desc })).toEqual([{ name: 2 }]);
  });

  test("headers: false disables descriptor headers", () => {
    const desc = infer("name\n1", { headers: true });
    expect(parse("ignored\n2", { type: true, headers: false, descriptor: desc })).toEqual([
      ["ignored"],
      [2],
    ]);
  });

  test("large autotyped parses do not crash when scratch buffers must grow", () => {
    const expectedRow = [1, 2, 3, 4, 5];
    const rowCount = 500_000;
    const csv = "1,2,3,4,5\n".repeat(rowCount);
    const rows = parse(csv, { type: true }) as number[][];

    expect(rows.length).toBe(rowCount);
    expect(rows[0]).toEqual(expectedRow);
    expect(rows.at(-1)).toEqual(expectedRow);
  }, 10000);
});

describe("line endings", () => {
  test("CRLF", () => {
    const rows = parse("a,b\r\n1,2\r\n3,4");
    expect(rows).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  test("trailing CRLF", () => {
    const rows = parse("a,b\r\n1,2\r\n");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("bare CR is not a line ending (RFC 4180)", () => {
    const rows = parse("a,b\r1,2", { type: true });
    expect(rows).toEqual([["a", "b\r1", "2"]]);
  });
});

describe("BOM", () => {
  test("UTF-8 BOM is stripped", () => {
    const rows = parse("\uFEFFa,b\n1,2");
    expect(rows[0]).toEqual(["a", "b"]);
  });
});

describe("ragged rows", () => {
  test("unquoted: row with fewer fields than header does not hang", () => {
    const result = parse("a,b,c\n1,2");
    expect(result.length).toBe(2);
  }, 2000);

  test("unquoted: extra columns fold into last field", () => {
    const result = parse("a,b\n1,2,3");
    expect(result).toEqual([["a", "b"], ["1", "2,3"]]);
  });

  test("quoted: row with fewer fields does not read stale buffer data", () => {
    // First parse fills cmdBuf with a record at byte offset 13 (field "d")
    parse('"a","b"\n"c","d"');
    // Second parse: row 2 has 1 field but width=2 from row 1.
    // Without fix, stale record (offset=13, len=1) reads "d" from "world"
    const result = parse('"hello","world"\n"z"');
    expect(result[0]).toEqual(["hello", "world"]);
    for (const field of result[1]) {
      expect(field === "z" || field === "").toBe(true);
    }
  });

  test("quoted: row with more fields than header preserves extra columns", () => {
    const result = parse('"a","b"\n"1","2","3"');
    expect(result).toEqual([["a", "b"], ["1", "2", "3"]]);
  });
});

describe("large input (scratch buffer growth)", () => {
  test("quoted CSV over 16MB does not crash or truncate", () => {
    const cols = 10;
    const rows = 430000;
    const line = Array(cols).fill('"aaaa"').join(",");
    const csv = Array(rows).fill(line).join("\n") + "\n";
    expect(Buffer.byteLength(csv)).toBeGreaterThan(16 * 1024 * 1024);
    expect(rows * cols).toBeGreaterThan(4 * 1024 * 1024);

    const result = parse(csv) as string[][];
    expect(result.length).toBe(rows);
    expect(result[0]).toEqual(Array(cols).fill("aaaa"));
    expect(result[rows - 1]).toEqual(Array(cols).fill("aaaa"));
  });
});
