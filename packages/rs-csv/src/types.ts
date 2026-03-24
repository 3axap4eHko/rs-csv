export const OP_STR = 0;
export const OP_APPEND = 1;
export const OP_NUM = 2;
export const OP_BOOL = 3;
export const OP_NULL = 4;
export const OP_BIGINT = 5;
export const OP_EOF = 0x7f;
export const EOL_BIT = 0x80;
export const TYPE_MASK = 0x7f;

export type FieldValue = string | number | bigint | boolean | null | undefined;
export type Row = FieldValue[];

export interface ParseResult {
  headers: string[];
  rows: Row[];
}
