#[cfg(target_arch = "x86_64")]
use crate::shared::{classify_chunk_x86, prefix_xor_x86};
use crate::shared::{skip_blank_lines, skip_bom, trim_cr, write_u32};

pub const OP_STR: u8 = 0;
pub const OP_APPEND: u8 = 1;
pub const OP_NUM: u8 = 2;
pub const OP_BOOL: u8 = 3;
pub const OP_NULL: u8 = 4;
pub const OP_BIGINT: u8 = 5;
pub const OP_EOF: u8 = 0x7F;
pub const EOL_BIT: u8 = 0x80;

pub(crate) const STR_HEADER_SIZE: usize = 16;
pub(crate) const STR_RECORD_SIZE: usize = 8;
pub(crate) const STR_ESCAPED_BIT: u32 = 0x4000_0000;
pub(crate) const STR_EOL_BIT: u32 = 0x8000_0000;

pub(crate) fn parse_dispatch(
    bytes: &[u8],
    output: &mut [u8],
    offset: usize,
    str_row: bool,
    typed: bool,
) -> usize {
    if typed {
        parse_dispatch_inner::<true>(bytes, output, offset, str_row)
    } else {
        parse_dispatch_inner::<false>(bytes, output, offset, str_row)
    }
}

fn parse_dispatch_inner<const TYPED: bool>(
    bytes: &[u8],
    output: &mut [u8],
    offset: usize,
    str_row: bool,
) -> usize {
    if !TYPED && output.len() < STR_HEADER_SIZE {
        return 0;
    }

    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("ssse3")
            && is_x86_feature_detected!("sse4.1")
            && is_x86_feature_detected!("pclmulqdq")
        {
            return unsafe { parse_simd_x86::<TYPED>(bytes, output, offset, str_row) };
        }
    }

    #[cfg(target_arch = "wasm32")]
    {
        return parse_simd_wasm::<TYPED>(bytes, output, offset, str_row);
    }

    #[cfg(not(target_arch = "wasm32"))]
    parse_scalar::<TYPED>(bytes, output, offset, str_row)
}

pub(crate) struct ParseState {
    pub(crate) wp: usize,
    pub(crate) sp: usize,
    pub(crate) field_start: usize,
    pub(crate) in_quoted: bool,
    pub(crate) has_escapes: bool,
    pub(crate) fields_in_row: usize,
    pub(crate) after_comma: bool,
    pub(crate) full: bool,
    pub(crate) row_start_wp: usize,
    pub(crate) row_start_sp: usize,
    pub(crate) record_count: u32,
    pub(crate) row_start_record_count: u32,
    pub(crate) last_row_end: usize,
    pub(crate) input_offset: usize,
    pub(crate) str_row: bool,
    pub(crate) row_count: u32,
    pub(crate) width: u32,
}

impl ParseState {
    fn new<const TYPED: bool>(input_offset: usize, str_row: bool, buf_len: usize) -> Self {
        let (wp, row_start_wp) = if TYPED {
            (0, 0)
        } else {
            (STR_HEADER_SIZE, STR_HEADER_SIZE)
        };
        Self {
            wp,
            sp: buf_len,
            field_start: 0,
            in_quoted: false,
            has_escapes: false,
            fields_in_row: 0,
            after_comma: false,
            full: false,
            row_start_wp,
            row_start_sp: buf_len,
            record_count: 0,
            row_start_record_count: 0,
            last_row_end: 0,
            input_offset,
            str_row,
            row_count: 0,
            width: 0,
        }
    }

    fn finish_row(&mut self) {
        self.row_count += 1;
        if self.row_count == 1 {
            self.width = self.record_count;
        }
        self.last_row_end = self.field_start;
        self.row_start_wp = self.wp;
        self.row_start_sp = self.sp;
        self.row_start_record_count = self.record_count;
        self.str_row = false;
    }

    fn rollback_row(&mut self) {
        self.wp = self.row_start_wp;
        self.sp = self.row_start_sp;
        self.record_count = self.row_start_record_count;
        self.full = true;
    }
}

fn process_simd_chunks<const TYPED: bool>(
    bytes: &[u8],
    buf: &mut [u8],
    input_offset: usize,
    str_row: bool,
    classify: impl Fn(usize) -> (u64, u64, u64),
    prefix_xor: impl Fn(u64) -> u64,
) -> usize {
    let len = bytes.len();
    let buf_len = if TYPED {
        buf.len().saturating_sub(9)
    } else {
        buf.len()
    };
    let mut s = ParseState::new::<TYPED>(input_offset, str_row, buf.len());
    let mut quote_carry: u64 = 0;

    let bom_skip = if input_offset == 0 {
        skip_bom(bytes)
    } else {
        0
    };
    s.field_start = bom_skip;

    if s.field_start < len && bytes[s.field_start] == b'"' {
        s.in_quoted = true;
        s.field_start += 1;
    }

    let chunk_count = len / 64;

    for chunk_idx in 0..chunk_count {
        if s.full {
            break;
        }

        let (comma_mask, quote_mask, newline_mask) = classify(chunk_idx);

        let quote_parity = prefix_xor(quote_mask) ^ quote_carry.wrapping_neg();
        quote_carry = (quote_mask.count_ones() as u64 + quote_carry) & 1;

        let outside = !quote_parity;
        let real_commas = comma_mask & outside;
        let real_newlines = newline_mask & outside;
        let mut delimiters = real_commas | real_newlines;
        let base = chunk_idx * 64;

        while delimiters != 0 {
            let bit = delimiters.trailing_zeros() as usize;
            let abs_pos = base + bit;
            let is_newline = (real_newlines >> bit) & 1 != 0;

            if is_newline {
                let blank_line = s.fields_in_row == 0
                    && !s.in_quoted
                    && (s.field_start == abs_pos
                        || (s.field_start + 1 == abs_pos
                            && s.field_start < len
                            && bytes[s.field_start] == b'\r'));

                if blank_line {
                    s.field_start = abs_pos + 1;
                    s.after_comma = false;
                    if s.field_start < len && bytes[s.field_start] == b'"' {
                        s.in_quoted = true;
                        s.field_start += 1;
                    }
                    delimiters &= delimiters - 1;
                    continue;
                }

                let cr = abs_pos > 0 && bytes[abs_pos - 1] == b'\r';
                let (field_end, quoted, has_esc) = if s.in_quoted {
                    let end = abs_pos - 1 - cr as usize;
                    let esc = s.field_start < end
                        && memchr::memchr(b'"', &bytes[s.field_start..end]).is_some();
                    (end, true, esc)
                } else {
                    (abs_pos - cr as usize, false, false)
                };

                emit_field::<TYPED>(
                    bytes, buf, buf_len, &mut s, field_end, quoted, has_esc, true,
                );
                if s.full {
                    break;
                }
                s.fields_in_row = 0;
                s.after_comma = false;
                s.field_start = abs_pos + 1;
                s.finish_row();
            } else {
                let (field_end, quoted, has_esc) = if s.in_quoted {
                    let end = abs_pos - 1;
                    let esc = memchr::memchr(b'"', &bytes[s.field_start..end]).is_some();
                    (end, true, esc)
                } else {
                    (abs_pos, false, false)
                };

                emit_field::<TYPED>(
                    bytes, buf, buf_len, &mut s, field_end, quoted, has_esc, false,
                );
                if s.full {
                    break;
                }
                s.fields_in_row += 1;
                s.after_comma = true;
                s.field_start = abs_pos + 1;
            }

            s.in_quoted = false;
            s.has_escapes = false;

            if s.field_start < len && bytes[s.field_start] == b'"' {
                s.in_quoted = true;
                s.field_start += 1;
            }

            delimiters &= delimiters - 1;
        }
    }

    if !s.full {
        let pos = s.field_start;
        finish_scalar::<TYPED>(bytes, buf, &mut s, pos);
    }

    write_done::<TYPED>(buf, &mut s);

    if s.full { s.last_row_end } else { len }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn prefix_xor_shift(mut x: u64) -> u64 {
    x ^= x << 1;
    x ^= x << 2;
    x ^= x << 4;
    x ^= x << 8;
    x ^= x << 16;
    x ^= x << 32;
    x
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "ssse3,sse4.1,pclmulqdq")]
unsafe fn parse_simd_x86<const TYPED: bool>(
    bytes: &[u8],
    buf: &mut [u8],
    input_offset: usize,
    str_row: bool,
) -> usize {
    process_simd_chunks::<TYPED>(
        bytes,
        buf,
        input_offset,
        str_row,
        |chunk_idx| classify_chunk_x86(bytes.as_ptr().add(chunk_idx * 64)),
        |x| prefix_xor_x86(x),
    )
}

#[cfg(target_arch = "wasm32")]
fn parse_simd_wasm<const TYPED: bool>(
    bytes: &[u8],
    buf: &mut [u8],
    input_offset: usize,
    str_row: bool,
) -> usize {
    use std::arch::wasm32::*;

    let lo_lut = u8x16(0, 0, 0b010, 0, 0, 0, 0, 0, 0, 0, 0b100, 0, 0b001, 0, 0, 0);
    let hi_lut = u8x16(0b100, 0, 0b011, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    let mask_0f = u8x16_splat(0x0F);
    let comma_val = u8x16_splat(0b001);
    let quote_val = u8x16_splat(0b010);
    let newline_val = u8x16_splat(0b100);

    process_simd_chunks::<TYPED>(
        bytes,
        buf,
        input_offset,
        str_row,
        |chunk_idx| {
            let base = chunk_idx * 64;
            let mut cm: u64 = 0;
            let mut qm: u64 = 0;
            let mut nm: u64 = 0;

            for sub in 0..4u32 {
                let offset = base + sub as usize * 16;
                let input_vec = unsafe { v128_load(bytes[offset..].as_ptr() as *const v128) };
                let lo_nibbles = v128_and(input_vec, mask_0f);
                let hi_nibbles = v128_and(u8x16_shr(input_vec, 4), mask_0f);
                let lo_result = i8x16_swizzle(lo_lut, lo_nibbles);
                let hi_result = i8x16_swizzle(hi_lut, hi_nibbles);
                let classified = v128_and(lo_result, hi_result);

                let shift = sub * 16;
                cm |= (u8x16_bitmask(u8x16_eq(v128_and(classified, comma_val), comma_val)) as u64)
                    << shift;
                qm |= (u8x16_bitmask(u8x16_eq(v128_and(classified, quote_val), quote_val)) as u64)
                    << shift;
                nm |= (u8x16_bitmask(u8x16_eq(v128_and(classified, newline_val), newline_val))
                    as u64)
                    << shift;
            }

            (cm, qm, nm)
        },
        prefix_xor_shift,
    )
}

#[cfg(not(target_arch = "wasm32"))]
fn parse_scalar<const TYPED: bool>(
    bytes: &[u8],
    buf: &mut [u8],
    input_offset: usize,
    str_row: bool,
) -> usize {
    let mut s = ParseState::new::<TYPED>(input_offset, str_row, buf.len());
    let bom_skip = if input_offset == 0 {
        skip_bom(bytes)
    } else {
        0
    };
    s.field_start = bom_skip;
    let pos = s.field_start;
    finish_scalar::<TYPED>(bytes, buf, &mut s, pos);
    write_done::<TYPED>(buf, &mut s);
    if s.full { s.last_row_end } else { bytes.len() }
}

fn finish_scalar<const TYPED: bool>(
    bytes: &[u8],
    buf: &mut [u8],
    s: &mut ParseState,
    mut pos: usize,
) {
    let len = bytes.len();
    let buf_len = if TYPED {
        buf.len().saturating_sub(9)
    } else {
        buf.len()
    };

    if !s.in_quoted && pos < len && pos == s.field_start && bytes[pos] == b'"' {
        s.in_quoted = true;
        s.field_start += 1;
        pos = s.field_start;
    }

    while pos < len {
        if s.full {
            return;
        }

        if s.in_quoted {
            let b = bytes[pos];
            if b == b'"' {
                if pos + 1 < len && bytes[pos + 1] == b'"' {
                    s.has_escapes = true;
                    pos += 2;
                    continue;
                }
                let field_end = pos;
                pos += 1;
                if pos < len && bytes[pos] == b'\r' {
                    pos += 1;
                }
                let is_end = pos >= len || bytes[pos] == b',' || bytes[pos] == b'\n';
                if is_end {
                    let is_newline = pos >= len || bytes[pos] == b'\n';
                    emit_field::<TYPED>(
                        bytes,
                        buf,
                        buf_len,
                        s,
                        field_end,
                        true,
                        s.has_escapes,
                        is_newline,
                    );
                    if s.full {
                        return;
                    }
                    if is_newline {
                        s.fields_in_row = 0;
                        s.after_comma = false;
                        if pos < len {
                            pos += 1;
                        }
                        skip_blank_lines(bytes, &mut pos);
                        s.field_start = pos;
                        s.finish_row();
                    } else {
                        s.fields_in_row += 1;
                        s.after_comma = true;
                        pos += 1;
                        s.field_start = pos;
                    }
                    s.in_quoted = false;
                    s.has_escapes = false;
                    if pos < len && bytes[pos] == b'"' {
                        s.in_quoted = true;
                        s.field_start += 1;
                        pos = s.field_start;
                    }
                    continue;
                }
                pos += 1;
                continue;
            }
            pos += 1;
            continue;
        }

        match memchr::memchr2(b',', b'\n', &bytes[pos..]) {
            Some(off) => {
                let delim_pos = pos + off;
                let delim = bytes[delim_pos];
                if delim == b',' {
                    let field_end = trim_cr(bytes, delim_pos);
                    emit_field::<TYPED>(bytes, buf, buf_len, s, field_end, false, false, false);
                    if s.full {
                        return;
                    }
                    s.fields_in_row += 1;
                    s.after_comma = true;
                    pos = delim_pos + 1;
                    s.field_start = pos;
                } else {
                    let field_end = trim_cr(bytes, delim_pos);
                    emit_field::<TYPED>(bytes, buf, buf_len, s, field_end, false, false, true);
                    if s.full {
                        return;
                    }
                    s.fields_in_row = 0;
                    s.after_comma = false;
                    pos = delim_pos + 1;
                    skip_blank_lines(bytes, &mut pos);
                    s.field_start = pos;
                    s.finish_row();
                }
                if pos < len && bytes[pos] == b'"' {
                    s.in_quoted = true;
                    s.field_start += 1;
                    pos = s.field_start;
                }
            }
            None => {
                pos = len;
            }
        }
    }

    if !s.full {
        if s.field_start < len {
            let end = trim_cr(bytes, pos);
            emit_field::<TYPED>(
                bytes,
                buf,
                buf_len,
                s,
                end,
                s.in_quoted,
                s.has_escapes,
                true,
            );
        } else if s.after_comma {
            emit_field::<TYPED>(bytes, buf, buf_len, s, s.field_start, false, false, true);
        }
    }
}

#[allow(clippy::too_many_arguments)]
#[inline(always)]
fn emit_field<const TYPED: bool>(
    bytes: &[u8],
    buf: &mut [u8],
    buf_len: usize,
    s: &mut ParseState,
    end: usize,
    quoted: bool,
    has_escapes: bool,
    is_last: bool,
) {
    let start = s.field_start;
    let flen = end.saturating_sub(start);

    let abs_start = start + s.input_offset;

    if !TYPED {
        write_string_record(buf, s, abs_start, flen, is_last, has_escapes);
        s.field_start = end;
        return;
    }

    if s.str_row {
        if s.wp + 9 > buf_len {
            s.rollback_row();
            return;
        }
        if has_escapes {
            write_str_escaped(bytes, buf, buf_len, s, abs_start, start, flen, is_last);
        } else {
            write_slice(buf, s, OP_STR, abs_start, flen, is_last);
        }
        s.field_start = end;
        return;
    }

    if s.wp + 9 > buf_len {
        s.rollback_row();
        return;
    }

    let slice = if flen > 0 && start + flen <= bytes.len() {
        &bytes[start..start + flen]
    } else {
        &[] as &[u8]
    };

    if flen == 0 && !quoted {
        write_null(buf, s, is_last);
        s.field_start = end;
        return;
    }

    if !quoted && !has_escapes {
        if flen == 4 && slice.eq_ignore_ascii_case(b"true") {
            write_bool(buf, s, true, is_last);
            s.field_start = end;
            return;
        }
        if flen == 5 && slice.eq_ignore_ascii_case(b"false") {
            write_bool(buf, s, false, is_last);
            s.field_start = end;
            return;
        }
        if flen == 4 && slice.eq_ignore_ascii_case(b"null") {
            write_null(buf, s, is_last);
            s.field_start = end;
            return;
        }
        if flen > 0
            && (slice[0].is_ascii_digit()
                || slice[0] == b'-'
                || slice[0] == b'+'
                || slice[0] == b'.')
        {
            if is_pure_integer(slice) && flen > 15 {
                write_slice(buf, s, OP_BIGINT, abs_start, flen, is_last);
                s.field_start = end;
                return;
            }
            if let Ok(n) = fast_float2::parse::<f64, _>(slice) {
                write_num(buf, s, n, is_last);
                s.field_start = end;
                return;
            }
        }
    }

    if has_escapes {
        write_str_escaped(bytes, buf, buf_len, s, abs_start, start, flen, is_last);
        s.field_start = end;
        return;
    }

    write_slice(buf, s, OP_STR, abs_start, flen, is_last);
    s.field_start = end;
}

#[inline(always)]
fn is_pure_integer(slice: &[u8]) -> bool {
    let start = if !slice.is_empty() && (slice[0] == b'-' || slice[0] == b'+') {
        1
    } else {
        0
    };
    start < slice.len() && slice[start..].iter().all(|b| b.is_ascii_digit())
}

#[inline(always)]
fn write_slice(
    buf: &mut [u8],
    s: &mut ParseState,
    op: u8,
    offset: usize,
    length: usize,
    is_last: bool,
) {
    buf[s.wp] = op | if is_last { EOL_BIT } else { 0 };
    buf[s.wp + 1..s.wp + 5].copy_from_slice(&(offset as u32).to_le_bytes());
    buf[s.wp + 5..s.wp + 9].copy_from_slice(&(length as u32).to_le_bytes());
    s.wp += 9;
}

#[inline(always)]
fn write_string_record(
    buf: &mut [u8],
    s: &mut ParseState,
    offset: usize,
    length: usize,
    is_last: bool,
    has_escapes: bool,
) {
    if s.wp + STR_RECORD_SIZE > s.sp {
        s.rollback_row();
        return;
    }

    write_u32(buf, s.wp, offset as u32);
    let mut meta = length as u32;
    if is_last {
        meta |= STR_EOL_BIT;
    }
    if has_escapes {
        meta |= STR_ESCAPED_BIT;
    }
    write_u32(buf, s.wp + 4, meta);
    s.wp += STR_RECORD_SIZE;
    s.record_count += 1;
}

#[allow(clippy::too_many_arguments)]
fn write_str_escaped(
    bytes: &[u8],
    buf: &mut [u8],
    buf_len: usize,
    s: &mut ParseState,
    abs_start: usize,
    rel_start: usize,
    flen: usize,
    is_last: bool,
) {
    let slice = &bytes[rel_start..rel_start + flen];
    let mut seg_abs = abs_start;
    let mut search_from = 0;
    let mut first = true;

    while let Some(qi) = memchr::memchr(b'"', &slice[search_from..]) {
        let i = search_from + qi;
        if i + 1 < slice.len() && slice[i + 1] == b'"' {
            let seg_len = i + 1 - search_from;
            if s.wp + 9 > buf_len {
                s.rollback_row();
                return;
            }
            buf[s.wp] = if first { OP_STR } else { OP_APPEND };
            buf[s.wp + 1..s.wp + 5].copy_from_slice(&(seg_abs as u32).to_le_bytes());
            buf[s.wp + 5..s.wp + 9].copy_from_slice(&(seg_len as u32).to_le_bytes());
            s.wp += 9;
            first = false;
            search_from = i + 2;
            seg_abs = abs_start + search_from;
            continue;
        }
        break;
    }

    let remaining = flen - search_from;
    if remaining > 0 {
        if s.wp + 9 > buf_len {
            s.rollback_row();
            return;
        }
        let op = (if first { OP_STR } else { OP_APPEND }) | if is_last { EOL_BIT } else { 0 };
        buf[s.wp] = op;
        buf[s.wp + 1..s.wp + 5].copy_from_slice(&(seg_abs as u32).to_le_bytes());
        buf[s.wp + 5..s.wp + 9].copy_from_slice(&(remaining as u32).to_le_bytes());
        s.wp += 9;
    } else if !first && is_last && s.wp >= 9 {
        buf[s.wp - 9] |= EOL_BIT;
    }
}

#[inline(always)]
fn write_num(buf: &mut [u8], s: &mut ParseState, val: f64, is_last: bool) {
    buf[s.wp] = OP_NUM | if is_last { EOL_BIT } else { 0 };
    buf[s.wp + 1..s.wp + 9].copy_from_slice(&val.to_le_bytes());
    s.wp += 9;
}

#[inline(always)]
fn write_bool(buf: &mut [u8], s: &mut ParseState, val: bool, is_last: bool) {
    buf[s.wp] = OP_BOOL | if is_last { EOL_BIT } else { 0 };
    buf[s.wp + 1..s.wp + 9].copy_from_slice(&(val as u64).to_le_bytes());
    s.wp += 9;
}

#[inline(always)]
fn write_null(buf: &mut [u8], s: &mut ParseState, is_last: bool) {
    buf[s.wp] = OP_NULL | if is_last { EOL_BIT } else { 0 };
    buf[s.wp + 1..s.wp + 9].copy_from_slice(&1u64.to_le_bytes());
    s.wp += 9;
}

#[inline(always)]
fn write_done<const TYPED: bool>(buf: &mut [u8], s: &mut ParseState) {
    if TYPED {
        buf[s.wp] = OP_EOF;
        buf[s.wp + 1..s.wp + 9].copy_from_slice(&0u64.to_le_bytes());
        s.wp += 9;
        return;
    }

    let has_trailing = s.record_count > s.row_start_record_count;
    let final_row_count = s.row_count + has_trailing as u32;
    if s.width == 0 && s.record_count > 0 {
        s.width = s.record_count;
    }
    write_u32(buf, 0, s.record_count);
    write_u32(buf, 4, s.sp as u32);
    write_u32(buf, 8, final_row_count);
    write_u32(buf, 12, s.width);
}
