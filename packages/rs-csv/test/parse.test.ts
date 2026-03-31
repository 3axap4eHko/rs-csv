import { describe, test, expect } from "bun:test";
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
    expect(rows[1]).toEqual([1, 2, null]);
  });

  test("trailing comma at EOF", () => {
    const rows = parse("a,b,c\n1,2,", { type: true });
    expect(rows[1]).toEqual([1, 2, null]);
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
    expect(rows.slice(1).map((r: any) => r[0])).toEqual([null, null]);
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
    const rows = parse("name,city,age\nAndr\u00e9,S\u00e3o Paulo,30\nZo\u00eb,M\u00fcnchen,25", { type: true });
    expect(rows).toEqual([
      ["name", "city", "age"],
      ["Andr\u00e9", "S\u00e3o Paulo", 30],
      ["Zo\u00eb", "M\u00fcnchen", 25],
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
    expect(rows).toEqual([["a", "b\r1", 2]]);
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
});
