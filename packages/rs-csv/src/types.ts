export type FieldValue = string | number | bigint | boolean | null | undefined;
export type Row = FieldValue[];
export type Converter = (value: string) => unknown;

export function readU32LE(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

export function writeU32LE(buf: Uint8Array, off: number, val: number): void {
  buf[off] = val & 0xFF;
  buf[off + 1] = (val >> 8) & 0xFF;
  buf[off + 2] = (val >> 16) & 0xFF;
  buf[off + 3] = (val >> 24) & 0xFF;
}
