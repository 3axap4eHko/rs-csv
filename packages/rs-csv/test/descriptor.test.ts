import { describe, test, expect } from "bun:test";
import { infer, Descriptor, Type, Flag } from "../src/descriptor.ts";

describe("infer", () => {
  test("returns Descriptor instance", () => {
    const desc = infer("a,b\n1,2");
    expect(desc).toBeInstanceOf(Uint8Array);
    expect(desc).toBeInstanceOf(Descriptor);
  });

  test("detects width", () => {
    const desc = infer("a,b,c\n1,2,3");
    expect(desc.width).toBe(3);
  });

  test("detects flags: no quotes", () => {
    const desc = infer("a,b\n1,2");
    expect(desc.flags & Flag.HAS_QUOTES).toBe(0);
  });

  test("detects flags: has quotes", () => {
    const desc = infer('"a","b"\n"1","2"');
    expect(desc.flags & Flag.HAS_QUOTES).not.toBe(0);
  });

  test("detects flags: has escapes", () => {
    const desc = infer('a\n"he said ""hi"""');
    expect(desc.flags & Flag.HAS_ESCAPES).not.toBe(0);
  });

  test("detects flags: CRLF", () => {
    const desc = infer("a,b\r\n1,2");
    expect(desc.flags & Flag.HAS_CRLF).not.toBe(0);
  });

  test("detects flags: BOM", () => {
    const desc = infer("\uFEFFa,b\n1,2");
    expect(desc.flags & Flag.HAS_BOM).not.toBe(0);
  });

  test("detects flags: non-ascii", () => {
    const desc = infer("name\nAndr\u00e9");
    expect(desc.flags & Flag.HAS_NON_ASCII).not.toBe(0);
  });

  test("infers number type", () => {
    const desc = infer("val\n42\n3.14\n-1", { headers: true });
    expect(desc.types[0]).toBe(Type.Number);
  });

  test("infers boolean type", () => {
    const desc = infer("val\ntrue\nfalse\nTRUE", { headers: true });
    expect(desc.types[0]).toBe(Type.Boolean);
  });

  test("infers bigint type", () => {
    const desc = infer("val\n9007199254740993\n1234567890123456789", { headers: true });
    expect(desc.types[0]).toBe(Type.BigInt);
  });

  test("mixed types fall back to string", () => {
    const desc = infer("val\n42\nhello\n3.14", { headers: true });
    expect(desc.types[0]).toBe(Type.String);
  });

  test("quoted fields infer as string", () => {
    const desc = infer('val\n"42"\n"99"', { headers: true });
    expect(desc.types[0]).toBe(Type.String);
  });

  test("detects headers with headers: true", () => {
    const desc = infer("name,age\nAlice,30", { headers: true });
    expect(desc.headers).toEqual(["name", "age"]);
    expect(desc.headerCount).toBe(2);
  });

  test("uses provided header names", () => {
    const desc = infer("Alice,30\nBob,25", { headers: ["name", "age"] });
    expect(desc.headers).toEqual(["name", "age"]);
  });

  test("no headers by default", () => {
    const desc = infer("a,b\n1,2");
    expect(desc.headerCount).toBe(0);
    expect(desc.headers).toEqual([]);
  });

  test("user types override inferred", () => {
    const desc = infer("val\n42\n99", { headers: true, types: [Type.String] });
    expect(desc.types[0]).toBe(Type.String);
  });

  test("partial user types, rest inferred", () => {
    const desc = infer("name,age\nAlice,30\nBob,25", {
      headers: true,
      types: [Type.String],
    });
    expect(desc.types[0]).toBe(Type.String);
    expect(desc.types[1]).toBe(Type.Number);
  });

  test("headers longer than width extends width", () => {
    const desc = infer("a,b\n1,2", {
      headers: ["a", "b", "c"],
    });
    expect(desc.width).toBe(3);
    expect(desc.types.length).toBe(3);
    expect(desc.types[2]).toBe(Type.String);
  });

  test("types longer than headers throws", () => {
    expect(() => {
      infer("a,b\n1,2", {
        headers: ["a"],
        types: [Type.String, Type.Number],
      });
    }).toThrow();
  });

  test("multiple CSVs merge flags", () => {
    const desc = infer(["a,b\n1,2", '"a","b"\n"1","2"']);
    expect(desc.flags & Flag.HAS_QUOTES).not.toBe(0);
  });

  test("multiple CSVs merge types", () => {
    const desc = infer(["val\n42\n99", "val\nhello\nworld"], { headers: true });
    expect(desc.types[0]).toBe(Type.String);
  });

  test("multiple CSVs use widest", () => {
    const desc = infer(["a,b\n1,2", "a,b,c\n1,2,3"]);
    expect(desc.width).toBe(3);
  });

  test("wider second CSV with headers does not corrupt descriptor", () => {
    const desc = infer(["a\n1", "a,b\n1,2"], { headers: true });
    expect(desc.width).toBe(2);
    expect(desc.headers).toEqual(["a"]);
    expect(desc.byteLength).toBeLessThan(1024);
  });

  test("empty fields don't affect type inference", () => {
    const desc = infer("val\n42\n\n99", { headers: true });
    expect(desc.types[0]).toBe(Type.Number);
  });
});
