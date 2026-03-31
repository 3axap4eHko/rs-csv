export type FieldValue = string | number | bigint | boolean | null | undefined;
export type Row = FieldValue[];
export type Converter = (value: string) => unknown;
