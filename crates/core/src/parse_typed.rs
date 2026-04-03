use crate::parse_common::{
    EOL_BIT, OP_APPEND, OP_BIGINT, OP_BOOL, OP_EOF, OP_NULL, OP_NUM, OP_STR,
};
use crate::scan_positions::{FIELD_CRLF, FIELD_EOL, FIELD_ESCAPED, FIELD_POS_MASK, FIELD_QUOTED};
use crate::shared::{TYPE_BIGINT, TYPE_BOOLEAN, TYPE_NUMBER, TYPE_STRING};

pub fn parse_with_types(
    input: &[u8],
    pos_buf: &[u8],
    output: &mut [u8],
    col_types: &[u8],
) -> usize {
    parse_with_types_inner::<ByteOffsets>(input, pos_buf, output, col_types)
}

pub fn parse_with_types_utf16(
    input: &[u8],
    pos_buf: &[u8],
    output: &mut [u8],
    col_types: &[u8],
) -> usize {
    parse_with_types_inner::<Utf16Offsets>(input, pos_buf, output, col_types)
}

trait OffsetMode {
    fn new(input: &[u8], first_start: usize) -> Self;
    fn field_offset(&self, quoted: bool) -> usize;
    fn slice_len(&self, bytes: &[u8]) -> usize;
    fn advance(&mut self, input: &[u8], byte_start: usize, next_start: usize);
}

struct ByteOffsets {
    unit_start: usize,
}

impl OffsetMode for ByteOffsets {
    fn new(_input: &[u8], first_start: usize) -> Self {
        Self {
            unit_start: first_start,
        }
    }

    fn field_offset(&self, quoted: bool) -> usize {
        self.unit_start + quoted as usize
    }

    fn slice_len(&self, bytes: &[u8]) -> usize {
        bytes.len()
    }

    fn advance(&mut self, _input: &[u8], _byte_start: usize, next_start: usize) {
        self.unit_start = next_start;
    }
}

struct Utf16Offsets {
    unit_start: usize,
}

impl OffsetMode for Utf16Offsets {
    fn new(input: &[u8], first_start: usize) -> Self {
        Self {
            unit_start: utf16_len(&input[..first_start]),
        }
    }

    fn field_offset(&self, quoted: bool) -> usize {
        self.unit_start + quoted as usize
    }

    fn slice_len(&self, bytes: &[u8]) -> usize {
        utf16_len(bytes)
    }

    fn advance(&mut self, input: &[u8], byte_start: usize, next_start: usize) {
        self.unit_start += utf16_len(&input[byte_start..next_start]);
    }
}

fn parse_with_types_inner<M: OffsetMode>(
    input: &[u8],
    pos_buf: &[u8],
    output: &mut [u8],
    col_types: &[u8],
) -> usize {
    let field_count = u32::from_le_bytes(pos_buf[0..4].try_into().unwrap()) as usize;
    if field_count == 0 {
        output[0] = OP_EOF;
        output[1..9].copy_from_slice(&0u64.to_le_bytes());
        return 9;
    }

    let width = u32::from_le_bytes(pos_buf[8..12].try_into().unwrap()) as usize;
    let first_start = u32::from_le_bytes(pos_buf[12..16].try_into().unwrap()) as usize;
    let buf_len = output.len().saturating_sub(9);
    let mut wp: usize = 0;
    let mut byte_start = first_start;
    let mut offsets = M::new(input, first_start);
    let mut pos_idx: usize = 16;

    for i in 0..field_count {
        if wp + 9 > buf_len {
            break;
        }

        let entry = u32::from_le_bytes(pos_buf[pos_idx..pos_idx + 4].try_into().unwrap());
        pos_idx += 4;

        let end = (entry & FIELD_POS_MASK) as usize;
        let is_quoted = entry & FIELD_QUOTED != 0;
        let is_escaped = entry & FIELD_ESCAPED != 0;
        let is_last = entry & FIELD_EOL != 0;
        let is_crlf = entry & FIELD_CRLF != 0;

        let (field_start, field_end) = if is_quoted {
            (byte_start + 1, end.saturating_sub(1))
        } else {
            (byte_start, end)
        };
        let field_slice = slice_or_empty(input, field_start, field_end);
        let col = i % width;
        let col_type = if col < col_types.len() {
            col_types[col]
        } else {
            TYPE_STRING
        };

        if is_quoted || col_type == TYPE_STRING {
            let field_offset = offsets.field_offset(is_quoted);
            write_string_field::<M>(
                field_slice,
                output,
                &mut wp,
                &offsets,
                field_offset,
                is_last,
                is_escaped,
            );
        } else if field_slice.is_empty() {
            write_null(output, &mut wp, is_last);
        } else {
            match col_type {
                TYPE_NUMBER => {
                    if let Ok(n) = fast_float2::parse::<f64, _>(field_slice) {
                        output[wp] = OP_NUM | if is_last { EOL_BIT } else { 0 };
                        output[wp + 1..wp + 9].copy_from_slice(&n.to_le_bytes());
                        wp += 9;
                    } else {
                        let field_offset = offsets.field_offset(false);
                        write_string_field::<M>(
                            field_slice,
                            output,
                            &mut wp,
                            &offsets,
                            field_offset,
                            is_last,
                            false,
                        );
                    }
                }
                TYPE_BOOLEAN => {
                    let val = field_slice.eq_ignore_ascii_case(b"true");
                    output[wp] = OP_BOOL | if is_last { EOL_BIT } else { 0 };
                    output[wp + 1..wp + 9].copy_from_slice(&(val as u64).to_le_bytes());
                    wp += 9;
                }
                TYPE_BIGINT => {
                    output[wp] = OP_BIGINT | if is_last { EOL_BIT } else { 0 };
                    let field_offset = offsets.field_offset(false);
                    let field_len = offsets.slice_len(field_slice);
                    output[wp + 1..wp + 5].copy_from_slice(&(field_offset as u32).to_le_bytes());
                    output[wp + 5..wp + 9].copy_from_slice(&(field_len as u32).to_le_bytes());
                    wp += 9;
                }
                _ => {
                    let field_offset = offsets.field_offset(false);
                    write_string_field::<M>(
                        field_slice,
                        output,
                        &mut wp,
                        &offsets,
                        field_offset,
                        is_last,
                        false,
                    );
                }
            }
        }

        let next_byte = next_field_start(end, is_crlf, input.len());
        offsets.advance(input, byte_start, next_byte);
        byte_start = next_byte;
    }

    output[wp] = OP_EOF;
    output[wp + 1..wp + 9].copy_from_slice(&0u64.to_le_bytes());
    wp += 9;
    wp
}

#[inline(always)]
fn write_op(buf: &mut [u8], wp: &mut usize, op: u8, offset: usize, length: usize, is_last: bool) {
    buf[*wp] = op | if is_last { EOL_BIT } else { 0 };
    buf[*wp + 1..*wp + 5].copy_from_slice(&(offset as u32).to_le_bytes());
    buf[*wp + 5..*wp + 9].copy_from_slice(&(length as u32).to_le_bytes());
    *wp += 9;
}

#[inline(always)]
fn write_null(buf: &mut [u8], wp: &mut usize, is_last: bool) {
    buf[*wp] = OP_NULL | if is_last { EOL_BIT } else { 0 };
    buf[*wp + 1..*wp + 9].copy_from_slice(&0u64.to_le_bytes());
    *wp += 9;
}

fn write_string_field<M: OffsetMode>(
    field_slice: &[u8],
    output: &mut [u8],
    wp: &mut usize,
    offsets: &M,
    field_offset: usize,
    is_last: bool,
    is_escaped: bool,
) {
    if !is_escaped {
        write_op(
            output,
            wp,
            OP_STR,
            field_offset,
            offsets.slice_len(field_slice),
            is_last,
        );
        return;
    }

    let mut seg_offset = field_offset;
    let mut search_from = 0usize;
    let mut first = true;

    while let Some(qi) = memchr::memchr(b'"', &field_slice[search_from..]) {
        let i = search_from + qi;
        if i + 1 < field_slice.len() && field_slice[i + 1] == b'"' {
            let segment = &field_slice[search_from..i + 1];
            let seg_len = offsets.slice_len(segment);
            write_op(
                output,
                wp,
                if first { OP_STR } else { OP_APPEND },
                seg_offset,
                seg_len,
                false,
            );
            first = false;
            search_from = i + 2;
            seg_offset += seg_len + 1;
            continue;
        }
        break;
    }

    let remaining = &field_slice[search_from..];
    if !remaining.is_empty() || first {
        write_op(
            output,
            wp,
            if first { OP_STR } else { OP_APPEND },
            seg_offset,
            offsets.slice_len(remaining),
            is_last,
        );
    } else if is_last && *wp >= 9 {
        output[*wp - 9] |= EOL_BIT;
    }
}

#[inline(always)]
fn slice_or_empty(input: &[u8], start: usize, end: usize) -> &[u8] {
    if start <= end && end <= input.len() {
        &input[start..end]
    } else {
        &[]
    }
}

#[inline(always)]
fn next_field_start(end: usize, is_crlf: bool, input_len: usize) -> usize {
    if end >= input_len {
        return end;
    }
    end + if is_crlf { 2 } else { 1 }
}

#[inline(always)]
fn utf16_len(bytes: &[u8]) -> usize {
    let mut units = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b < 0x80 {
            units += 1;
            i += 1;
        } else if b < 0xE0 {
            units += 1;
            i += 2;
        } else if b < 0xF0 {
            units += 1;
            i += 3;
        } else {
            units += 2;
            i += 4;
        }
    }
    units
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan_positions::scan_fields;
    use crate::shared::TYPE_STRING;

    #[derive(Debug, PartialEq)]
    enum Cmd {
        Str { offset: u32, len: u32, eol: bool },
        Append { offset: u32, len: u32, eol: bool },
        Eof,
    }

    fn scan(input: &str) -> Vec<u8> {
        let mut pos_buf = vec![0u8; 16 + input.len() * 4 + 64];
        scan_fields(input.as_bytes(), &mut pos_buf);
        pos_buf
    }

    fn parse_cmds(input: &str, parse_fn: fn(&[u8], &[u8], &mut [u8], &[u8]) -> usize) -> Vec<Cmd> {
        let pos_buf = scan(input);
        let mut output = vec![0u8; 256];
        let used = parse_fn(input.as_bytes(), &pos_buf, &mut output, &[TYPE_STRING]);
        let mut pos = 0usize;
        let mut out = Vec::new();

        while pos < used {
            let op = output[pos];
            let ty = op & 0x7F;
            let eol = op & EOL_BIT != 0;
            match ty {
                OP_STR => out.push(Cmd::Str {
                    offset: u32::from_le_bytes(output[pos + 1..pos + 5].try_into().unwrap()),
                    len: u32::from_le_bytes(output[pos + 5..pos + 9].try_into().unwrap()),
                    eol,
                }),
                OP_APPEND => out.push(Cmd::Append {
                    offset: u32::from_le_bytes(output[pos + 1..pos + 5].try_into().unwrap()),
                    len: u32::from_le_bytes(output[pos + 5..pos + 9].try_into().unwrap()),
                    eol,
                }),
                OP_EOF => {
                    out.push(Cmd::Eof);
                    break;
                }
                _ => {}
            }
            pos += 9;
        }

        out
    }

    #[test]
    fn byte_offsets_stay_byte_based() {
        let cmds = parse_cmds("😀", parse_with_types);
        assert_eq!(
            cmds,
            vec![
                Cmd::Str {
                    offset: 0,
                    len: 4,
                    eol: true
                },
                Cmd::Eof,
            ]
        );
    }

    #[test]
    fn utf16_offsets_handle_bmp_without_trailing_newline() {
        let cmds = parse_cmds("é", parse_with_types_utf16);
        assert_eq!(
            cmds,
            vec![
                Cmd::Str {
                    offset: 0,
                    len: 1,
                    eol: true
                },
                Cmd::Eof,
            ]
        );
    }

    #[test]
    fn utf16_offsets_handle_astral_without_trailing_newline() {
        let cmds = parse_cmds("😀", parse_with_types_utf16);
        assert_eq!(
            cmds,
            vec![
                Cmd::Str {
                    offset: 0,
                    len: 2,
                    eol: true
                },
                Cmd::Eof,
            ]
        );
    }

    #[test]
    fn quoted_empty_string_stays_string() {
        let cmds = parse_cmds("\"\"", parse_with_types_utf16);
        assert_eq!(
            cmds,
            vec![
                Cmd::Str {
                    offset: 1,
                    len: 0,
                    eol: true
                },
                Cmd::Eof,
            ]
        );
    }

    #[test]
    fn escaped_quotes_emit_append_segments() {
        let cmds = parse_cmds("\"a\"\"b\"", parse_with_types_utf16);
        assert_eq!(
            cmds,
            vec![
                Cmd::Str {
                    offset: 1,
                    len: 2,
                    eol: false
                },
                Cmd::Append {
                    offset: 4,
                    len: 1,
                    eol: true
                },
                Cmd::Eof,
            ]
        );
    }
}
