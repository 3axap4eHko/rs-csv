use crate::classify::{CLS_HAS_ESCAPES, CLS_HAS_NON_ASCII};
use crate::offset_mode::{
    ByteOffsets, OffsetMode, Utf16Offsets, next_field_start, slice_or_empty,
};
use crate::scan_positions::{FIELD_CRLF, FIELD_ESCAPED, FIELD_POS_MASK, FIELD_QUOTED};
use crate::shared::{TYPE_BOOLEAN, TYPE_NUMBER, TYPE_STRING, write_u32};

const SIDE_BUF_BIT: u32 = 0x8000_0000;
const HEADER_FIXED: usize = 16;
const NULL_SENTINEL: u64 = 0x7FF0_0000_0000_0001;
const EOF_AND_META_SIZE: usize = 16;

pub struct AlignedResult {
    pub output_len: usize,
    pub side_len: usize,
    pub fallback_count: usize,
}

#[inline(always)]
fn empty_result(output: &mut [u8], flags: u32) -> AlignedResult {
    let record_start = (HEADER_FIXED + 7) & !7;
    write_header(output, 0, 0, 0, flags, &[]);
    write_eof(output, record_start);
    AlignedResult { output_len: record_start + 8, side_len: 0, fallback_count: 0 }
}

fn insufficient() -> AlignedResult {
    AlignedResult {
        output_len: 0,
        side_len: 0,
        fallback_count: 0,
    }
}

#[inline(never)]
pub fn parse_aligned(
    input: &[u8],
    pos_buf: &[u8],
    output: &mut [u8],
    col_types: &[u8],
    width: usize,
    flags: u32,
    side_buf: &mut [u8],
    skip_first_row: bool,
) -> AlignedResult {
    let has_escapes = flags & CLS_HAS_ESCAPES != 0;
    let has_non_ascii = flags & CLS_HAS_NON_ASCII != 0;
    match (has_non_ascii, has_escapes) {
        (false, false) => parse_aligned_inner::<ByteOffsets, false>(input, pos_buf, output, col_types, width, flags, side_buf, skip_first_row),
        (false, true)  => parse_aligned_inner::<ByteOffsets, true>(input, pos_buf, output, col_types, width, flags, side_buf, skip_first_row),
        (true, false)  => parse_aligned_inner::<Utf16Offsets, false>(input, pos_buf, output, col_types, width, flags, side_buf, skip_first_row),
        (true, true)   => parse_aligned_inner::<Utf16Offsets, true>(input, pos_buf, output, col_types, width, flags, side_buf, skip_first_row),
    }
}

#[inline(never)]
fn parse_aligned_inner<M: OffsetMode, const HAS_ESCAPES: bool>(
    input: &[u8],
    pos_buf: &[u8],
    output: &mut [u8],
    col_types: &[u8],
    width: usize,
    flags: u32,
    side_buf: &mut [u8],
    skip_first_row: bool,
) -> AlignedResult {
    let field_count = u32::from_le_bytes(pos_buf[0..4].try_into().unwrap()) as usize;
    let scan_width = u32::from_le_bytes(pos_buf[8..12].try_into().unwrap()) as usize;
    let first_start = u32::from_le_bytes(pos_buf[12..16].try_into().unwrap()) as usize;
    let record_start = (HEADER_FIXED + width + 7) & !7;

    if field_count == 0 || width == 0 {
        write_header(output, 0, width, 0, flags, col_types);
        write_eof(output, record_start);
        return AlignedResult { output_len: record_start + 8, side_len: 0, fallback_count: 0 };
    }
    if output.len() < record_start + EOF_AND_META_SIZE {
        return insufficient();
    }

    let mut byte_start = first_start;
    let mut offsets = M::new(input, first_start);
    let mut pos_idx: usize = 16;

    if skip_first_row {
        for _ in 0..scan_width.min(field_count) {
            let entry = u32::from_le_bytes(pos_buf[pos_idx..pos_idx + 4].try_into().unwrap());
            pos_idx += 4;
            let end = (entry & FIELD_POS_MASK) as usize;
            let is_crlf = entry & FIELD_CRLF != 0;
            let next_byte = next_field_start(end, is_crlf, input.len());
            offsets.advance(input, byte_start, next_byte);
            byte_start = next_byte;
        }
    }

    let data_start = if skip_first_row { scan_width.min(field_count) } else { 0 };
    let data_field_count = field_count - data_start;
    let data_rows = if width > 0 { data_field_count / width } else { 0 };

    if !HAS_ESCAPES {
        let buf_end = output.len().saturating_sub(EOF_AND_META_SIZE);
        let mut wp: usize = record_start;
        let mut col: usize = 0;

        for _ in 0..data_field_count {
            if wp + 8 > buf_end {
                break;
            }

            let entry = u32::from_le_bytes(pos_buf[pos_idx..pos_idx + 4].try_into().unwrap());
            pos_idx += 4;
            let end = (entry & FIELD_POS_MASK) as usize;
            let is_quoted = entry & FIELD_QUOTED != 0;
            let is_crlf = entry & FIELD_CRLF != 0;

            let (fs, fe) = if is_quoted {
                (byte_start + 1, end.saturating_sub(1))
            } else {
                (byte_start, end)
            };
            let flen = fe.saturating_sub(fs);
            let col_type = if col < col_types.len() { col_types[col] } else { TYPE_STRING };

            if flen == 0 && !is_quoted {
                output[wp..wp + 8].copy_from_slice(&NULL_SENTINEL.to_le_bytes());
            } else if is_quoted || col_type == TYPE_STRING {
                let field_offset = offsets.field_offset(is_quoted);
                let field_len = offsets.slice_len(slice_or_empty(input, fs, fe));
                output[wp..wp + 4].copy_from_slice(&(field_offset as u32).to_le_bytes());
                output[wp + 4..wp + 8].copy_from_slice(&(field_len as u32).to_le_bytes());
            } else if col_type == TYPE_NUMBER {
                let field_slice = slice_or_empty(input, fs, fe);
                if let Ok(n) = fast_float2::parse::<f64, _>(field_slice) {
                    output[wp..wp + 8].copy_from_slice(&n.to_le_bytes());
                } else {
                    output[wp..wp + 8].copy_from_slice(&f64::NAN.to_le_bytes());
                }
            } else if col_type == TYPE_BOOLEAN {
                let val = slice_or_empty(input, fs, fe).eq_ignore_ascii_case(b"true") as u64;
                output[wp..wp + 8].copy_from_slice(&val.to_le_bytes());
            } else {
                let field_offset = offsets.field_offset(false);
                output[wp..wp + 4].copy_from_slice(&(field_offset as u32).to_le_bytes());
                output[wp + 4..wp + 8].copy_from_slice(&(flen as u32).to_le_bytes());
            }
            wp += 8;
            col += 1;
            if col >= width { col = 0; }

            let next_byte = next_field_start(end, is_crlf, input.len());
            offsets.advance(input, byte_start, next_byte);
            byte_start = next_byte;
        }

        if wp + EOF_AND_META_SIZE > output.len() {
            return insufficient();
        }
        write_eof(output, wp);
        wp += 8;
        write_u32(output, wp, 0);

        let fallback_count = write_fallbacks_if_needed::<M>(input, pos_buf, output, col_types, width, data_start, field_count, wp, first_start);
        wp += 8 + fallback_count * 8;

        write_header(output, data_field_count, width, data_rows, flags, col_types);
        return AlignedResult { output_len: wp, side_len: 0, fallback_count };
    }

    let mut rp = record_start;
    let mut col: usize = 0;
    let mut side_wp: usize = 0;
    let mut fallback_count: usize = 0;

    for _ in 0..data_field_count {
        if rp + 8 > output.len() {
            return insufficient();
        }
        let entry = u32::from_le_bytes(pos_buf[pos_idx..pos_idx + 4].try_into().unwrap());
        pos_idx += 4;
        let end = (entry & FIELD_POS_MASK) as usize;
        let is_quoted = entry & FIELD_QUOTED != 0;
        let is_crlf = entry & FIELD_CRLF != 0;

        let (field_start, field_end) = if is_quoted {
            (byte_start + 1, end.saturating_sub(1))
        } else {
            (byte_start, end)
        };
        let field_slice = slice_or_empty(input, field_start, field_end);
        let col_type = if col < col_types.len() { col_types[col] } else { TYPE_STRING };

        if field_slice.is_empty() && !is_quoted {
            output[rp..rp + 8].copy_from_slice(&NULL_SENTINEL.to_le_bytes());
        } else if is_quoted || col_type == TYPE_STRING {
            if entry & FIELD_ESCAPED != 0 {
                if side_wp + field_slice.len() > side_buf.len() {
                    return insufficient();
                }
                let flat_start = side_wp;
                side_wp = flatten_escaped(field_slice, side_buf, side_wp);
                write_u32(output, rp, (flat_start as u32) | SIDE_BUF_BIT);
                write_u32(output, rp + 4, (side_wp - flat_start) as u32);
            } else {
                let field_offset = offsets.field_offset(is_quoted);
                write_u32(output, rp, field_offset as u32);
                write_u32(output, rp + 4, offsets.slice_len(field_slice) as u32);
            }
        } else {
            match col_type {
                TYPE_NUMBER => {
                    if let Ok(n) = fast_float2::parse::<f64, _>(field_slice) {
                        output[rp..rp + 8].copy_from_slice(&n.to_le_bytes());
                    } else {
                        output[rp..rp + 8].copy_from_slice(&f64::NAN.to_le_bytes());
                        fallback_count += 1;
                    }
                }
                TYPE_BOOLEAN => {
                    let val = field_slice.eq_ignore_ascii_case(b"true") as u64;
                    output[rp..rp + 8].copy_from_slice(&val.to_le_bytes());
                }
                _ => {
                    let field_offset = offsets.field_offset(false);
                    write_u32(output, rp, field_offset as u32);
                    write_u32(output, rp + 4, offsets.slice_len(field_slice) as u32);
                }
            }
        }
        rp += 8;
        col += 1;
        if col >= width { col = 0; }

        let next_byte = next_field_start(end, is_crlf, input.len());
        offsets.advance(input, byte_start, next_byte);
        byte_start = next_byte;
    }

    if rp + EOF_AND_META_SIZE > output.len() {
        return insufficient();
    }
    write_eof(output, rp);
    rp += 8;
    write_u32(output, rp, side_wp as u32);
    write_u32(output, rp + 4, fallback_count as u32);
    rp += 8;

    if fallback_count > 0 {
        match write_fallbacks::<M>(input, pos_buf, output, col_types, width, data_start, field_count, rp, first_start) {
            Some(next_rp) => {
                rp = next_rp;
            }
            None => {
                return insufficient();
            }
        }
    }

    write_header(output, data_field_count, width, data_rows, flags, col_types);
    AlignedResult { output_len: rp, side_len: side_wp, fallback_count }
}

fn write_header(output: &mut [u8], field_count: usize, width: usize, row_count: usize, flags: u32, col_types: &[u8]) {
    write_u32(output, 0, field_count as u32);
    write_u32(output, 4, width as u32);
    write_u32(output, 8, row_count as u32);
    write_u32(output, 12, flags);
    let w = width.min(col_types.len());
    output[HEADER_FIXED..HEADER_FIXED + w].copy_from_slice(&col_types[..w]);
    for i in w..width {
        output[HEADER_FIXED + i] = TYPE_STRING;
    }
}

#[inline(always)]
fn write_eof(output: &mut [u8], pos: usize) {
    output[pos..pos + 8].copy_from_slice(&u64::MAX.to_le_bytes());
}

fn flatten_escaped(field: &[u8], side_buf: &mut [u8], mut wp: usize) -> usize {
    let mut i = 0;
    while i < field.len() {
        if i + 1 < field.len() && field[i] == b'"' && field[i + 1] == b'"' {
            side_buf[wp] = b'"';
            wp += 1;
            i += 2;
        } else {
            side_buf[wp] = field[i];
            wp += 1;
            i += 1;
        }
    }
    wp
}

fn write_fallbacks_if_needed<M: OffsetMode>(
    input: &[u8],
    pos_buf: &[u8],
    output: &mut [u8],
    col_types: &[u8],
    width: usize,
    skip_fields: usize,
    field_count: usize,
    meta_wp: usize,
    first_start: usize,
) -> usize {
    let has_number_col = col_types.iter().take(width).any(|&t| t == TYPE_NUMBER);
    if !has_number_col {
        write_u32(output, meta_wp + 4, 0);
        return 0;
    }
    match write_fallbacks::<M>(input, pos_buf, output, col_types, width, skip_fields, field_count, meta_wp + 8, first_start) {
        Some(next_wp) => {
            let count = (next_wp - meta_wp - 8) / 8;
            write_u32(output, meta_wp + 4, count as u32);
            count
        }
        None => {
            write_u32(output, meta_wp + 4, 0);
            0
        }
    }
}

fn write_fallbacks<M: OffsetMode>(
    input: &[u8],
    pos_buf: &[u8],
    output: &mut [u8],
    col_types: &[u8],
    width: usize,
    skip_fields: usize,
    field_count: usize,
    mut wp: usize,
    first_start: usize,
) -> Option<usize> {
    let mut byte_start = first_start;
    let mut offsets = M::new(input, first_start);
    let mut pos_idx: usize = 16;
    let mut data_field_idx: usize = 0;

    for i in 0..field_count {
        let entry = u32::from_le_bytes(pos_buf[pos_idx..pos_idx + 4].try_into().unwrap());
        pos_idx += 4;

        let end = (entry & FIELD_POS_MASK) as usize;
        let is_quoted = entry & FIELD_QUOTED != 0;
        let is_crlf = entry & FIELD_CRLF != 0;

        let (field_start, field_end) = if is_quoted {
            (byte_start + 1, end.saturating_sub(1))
        } else {
            (byte_start, end)
        };

        if i >= skip_fields {
            let col = data_field_idx % width;
            let col_type = if col < col_types.len() { col_types[col] } else { TYPE_STRING };

            if col_type == TYPE_NUMBER && !is_quoted {
                let field_slice = slice_or_empty(input, field_start, field_end);
                if !field_slice.is_empty() && fast_float2::parse::<f64, _>(field_slice).is_err() {
                    if wp + 8 > output.len() {
                        return None;
                    }
                    write_u32(output, wp, offsets.field_offset(false) as u32);
                    write_u32(output, wp + 4, offsets.slice_len(field_slice) as u32);
                    wp += 8;
                }
            }
            data_field_idx += 1;
        }

        let next_byte = next_field_start(end, is_crlf, input.len());
        offsets.advance(input, byte_start, next_byte);
        byte_start = next_byte;
    }
    Some(wp)
}

pub fn fused_typed_parse(
    input: &[u8],
    pos_buf: &mut [u8],
    output: &mut [u8],
    side_buf: &mut [u8],
    descriptor: Option<&[u8]>,
    has_headers: bool,
    max_samples: usize,
) -> AlignedResult {
    if let Some(desc) = descriptor {
        if desc.len() >= 8 {
            let flags = u32::from_le_bytes(desc[0..4].try_into().unwrap());
            let width = u32::from_le_bytes(desc[4..8].try_into().unwrap()) as usize;
            if width == 0 {
                return empty_result(output, flags);
            }
            crate::scan_fields(input, pos_buf);
            let ct_len = width.min(desc.len().saturating_sub(8));
            return parse_aligned(input, pos_buf, output, &desc[8..8 + ct_len], width, flags, side_buf, has_headers);
        }
    }

    let mut desc_scratch = [0u8; 4096];
    crate::infer::infer(input, &mut desc_scratch, true, max_samples);
    let flags = u32::from_le_bytes(desc_scratch[0..4].try_into().unwrap());
    let width = u32::from_le_bytes(desc_scratch[4..8].try_into().unwrap()) as usize;
    if width == 0 {
        return empty_result(output, flags);
    }
    crate::scan_fields(input, pos_buf);
    let ct_len = width.min(desc_scratch.len().saturating_sub(8));
    parse_aligned(input, pos_buf, output, &desc_scratch[8..8 + ct_len], width, flags, side_buf, has_headers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan_positions::scan_fields;

    fn run_aligned(input: &str, col_types: &[u8], skip_header: bool) -> (Vec<u8>, Vec<u8>, AlignedResult) {
        let bytes = input.as_bytes();
        let mut pos_buf = vec![0u8; 16 + bytes.len() * 4 + 64];
        scan_fields(bytes, &mut pos_buf);
        let mut output = vec![0u8; 16384];
        let mut side_buf = vec![0u8; 4096];
        let result = parse_aligned(bytes, &pos_buf, &mut output, col_types, col_types.len(), 0, &mut side_buf, skip_header);
        (output, side_buf, result)
    }

    fn read_u32(buf: &[u8], off: usize) -> u32 {
        u32::from_le_bytes(buf[off..off + 4].try_into().unwrap())
    }

    fn read_f64(buf: &[u8], off: usize) -> f64 {
        f64::from_le_bytes(buf[off..off + 8].try_into().unwrap())
    }

    #[test]
    fn single_number() {
        let (out, _, res) = run_aligned("42\n", &[TYPE_NUMBER], false);
        assert_eq!(res.fallback_count, 0);
        let width = read_u32(&out, 4) as usize;
        assert_eq!(width, 1);
        let row_count = read_u32(&out, 8);
        assert_eq!(row_count, 1);
        let record_start = (16 + width + 7) & !7;
        assert_eq!(read_f64(&out, record_start), 42.0);
    }

    #[test]
    fn mixed_types() {
        let (out, _, res) = run_aligned("42,hello,true\n", &[TYPE_NUMBER, TYPE_STRING, TYPE_BOOLEAN], false);
        assert_eq!(res.fallback_count, 0);
        let width = read_u32(&out, 4) as usize;
        assert_eq!(width, 3);
        let rs = (16 + width + 7) & !7;
        assert_eq!(read_f64(&out, rs), 42.0);
        let str_off = read_u32(&out, rs + 8) as usize;
        let str_len = read_u32(&out, rs + 12) as usize;
        assert_eq!(&"42,hello,true\n".as_bytes()[str_off..str_off + str_len], b"hello");
        let bool_val = read_u32(&out, rs + 16);
        assert_eq!(bool_val, 1);
    }

    #[test]
    fn skip_header_row() {
        let (out, _, res) = run_aligned("name,val\nhello,42\n", &[TYPE_STRING, TYPE_NUMBER], true);
        assert_eq!(res.fallback_count, 0);
        let row_count = read_u32(&out, 8);
        assert_eq!(row_count, 1);
        let field_count = read_u32(&out, 0);
        assert_eq!(field_count, 2);
        let width = read_u32(&out, 4) as usize;
        let rs = (16 + width + 7) & !7;
        let str_off = read_u32(&out, rs) as usize;
        let str_len = read_u32(&out, rs + 4) as usize;
        assert_eq!(&"name,val\nhello,42\n".as_bytes()[str_off..str_off + str_len], b"hello");
        assert_eq!(read_f64(&out, rs + 8), 42.0);
    }

    #[test]
    fn number_parse_failure() {
        let (out, _, res) = run_aligned("42\nhello\n99\n", &[TYPE_NUMBER], false);
        assert_eq!(res.fallback_count, 1);
        let width = read_u32(&out, 4) as usize;
        let rs = (16 + width + 7) & !7;
        assert_eq!(read_f64(&out, rs), 42.0);
        let nan_val = read_f64(&out, rs + 8);
        assert!(nan_val.is_nan());
        assert_eq!(read_f64(&out, rs + 16), 99.0);
    }

    #[test]
    fn escaped_quotes() {
        let input = "\"a\"\"b\"\n";
        let bytes = input.as_bytes();
        let mut pos_buf = vec![0u8; 16 + bytes.len() * 4 + 64];
        scan_fields(bytes, &mut pos_buf);
        let mut output = vec![0u8; 16384];
        let mut side_buf = vec![0u8; 4096];
        let flags = CLS_HAS_ESCAPES;
        let result = parse_aligned(bytes, &pos_buf, &mut output, &[TYPE_STRING], 1, flags, &mut side_buf, false);
        assert_eq!(result.side_len, 3);
        assert_eq!(&side_buf[..3], b"a\"b");
        let rs = (16 + 1 + 7) & !7;
        let off = read_u32(&output, rs);
        assert_ne!(off & SIDE_BUF_BIT, 0);
        let real_off = (off & !SIDE_BUF_BIT) as usize;
        let len = read_u32(&output, rs + 4) as usize;
        assert_eq!(&side_buf[real_off..real_off + len], b"a\"b");
    }

    #[test]
    fn empty_field_is_null() {
        let (out, _, _) = run_aligned(",\n", &[TYPE_NUMBER, TYPE_STRING], false);
        let width = read_u32(&out, 4) as usize;
        let rs = (16 + width + 7) & !7;
        let val = u64::from_le_bytes(out[rs..rs + 8].try_into().unwrap());
        assert_eq!(val, NULL_SENTINEL);
    }

    #[test]
    fn fused_without_descriptor() {
        let input = "name,val\nhello,42\nworld,99\n";
        let bytes = input.as_bytes();
        let mut pos_buf = vec![0u8; 16 + bytes.len() * 4 + 64];
        let mut output = vec![0u8; 16384];
        let mut side_buf = vec![0u8; 4096];
        fused_typed_parse(bytes, &mut pos_buf, &mut output, &mut side_buf, None, true, 100);
        let row_count = read_u32(&output, 8);
        assert_eq!(row_count, 2);
        let width = read_u32(&output, 4) as usize;
        assert_eq!(width, 2);
        let t0 = output[16];
        let t1 = output[17];
        assert_eq!(t0, TYPE_STRING);
        assert_eq!(t1, TYPE_NUMBER);
    }

    #[test]
    fn fused_with_descriptor() {
        let input = "name,val\nhello,42\n";
        let bytes = input.as_bytes();
        let mut desc = vec![0u8; 64];
        crate::infer::infer(bytes, &mut desc, true, 100);
        let mut pos_buf = vec![0u8; 16 + bytes.len() * 4 + 64];
        let mut output = vec![0u8; 16384];
        let mut side_buf = vec![0u8; 4096];
        fused_typed_parse(bytes, &mut pos_buf, &mut output, &mut side_buf, Some(&desc), true, 100);
        let row_count = read_u32(&output, 8);
        assert_eq!(row_count, 1);
        let width = read_u32(&output, 4) as usize;
        assert_eq!(width, 2);
    }
}
