use crate::shared::{skip_bom, write_u32};

pub const CLS_HAS_QUOTES: u32 = 1 << 0;
pub const CLS_HAS_ESCAPES: u32 = 1 << 1;
pub const CLS_HAS_QUOTED_NL: u32 = 1 << 2;
pub const CLS_HAS_CRLF: u32 = 1 << 3;
pub const CLS_HAS_BOM: u32 = 1 << 4;

pub const CLS_BUF_SIZE: usize = 16;

pub fn classify(input: &[u8], out: &mut [u8]) {
    if out.len() < CLS_BUF_SIZE {
        return;
    }

    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("ssse3")
            && is_x86_feature_detected!("sse4.1")
            && is_x86_feature_detected!("pclmulqdq")
        {
            return unsafe { classify_simd_x86(input, out) };
        }
    }

    classify_scalar(input, out);
}

fn classify_scalar(input: &[u8], out: &mut [u8]) {
    let len = input.len();
    let mut pos = skip_bom(input);
    let mut flags: u32 = if pos > 0 { CLS_HAS_BOM } else { 0 };
    let mut rows: u32 = 0;
    let mut fields: u32 = 0;
    let mut first_row_fields: u32 = 0;
    let mut in_quoted = false;

    while pos < len {
        if in_quoted {
            match memchr::memchr2(b'"', b'\n', &input[pos..]) {
                None => break,
                Some(off) => {
                    let abs = pos + off;
                    let b = input[abs];
                    if b == b'"' {
                        if abs + 1 < len && input[abs + 1] == b'"' {
                            flags |= CLS_HAS_ESCAPES;
                            pos = abs + 2;
                        } else {
                            in_quoted = false;
                            pos = abs + 1;
                        }
                    } else {
                        flags |= CLS_HAS_QUOTED_NL;
                        if b == b'\r' {
                            flags |= CLS_HAS_CRLF;
                        }
                        pos = abs + 1;
                    }
                }
            }
            continue;
        }

        match memchr::memchr3(b',', b'\n', b'"', &input[pos..]) {
            None => break,
            Some(off) => {
                let abs = pos + off;
                match input[abs] {
                    b',' => {
                        fields += 1;
                        pos = abs + 1;
                    }
                    b'\n' => {
                        if abs > 0 && input[abs - 1] == b'\r' {
                            flags |= CLS_HAS_CRLF;
                        }
                        fields += 1;
                        rows += 1;
                        if rows == 1 {
                            first_row_fields = fields;
                        }
                        pos = abs + 1;
                    }
                    b'"' => {
                        flags |= CLS_HAS_QUOTES;
                        in_quoted = true;
                        pos = abs + 1;
                    }
                    _ => unreachable!(),
                }
            }
        }
    }

    if pos < len || (rows == 0 && len > 0) || fields > rows * first_row_fields.max(1) {
        fields += 1;
        rows += 1;
        if rows == 1 {
            first_row_fields = fields;
        }
    }

    let cols = first_row_fields;
    write_u32(out, 0, rows);
    write_u32(out, 4, cols);
    write_u32(out, 8, fields);
    write_u32(out, 12, flags);
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "ssse3,sse4.1,pclmulqdq")]
unsafe fn classify_simd_x86(input: &[u8], out: &mut [u8]) {
    use std::arch::x86_64::*;

    let len = input.len();
    let mut pos: usize = skip_bom(input);
    let mut flags: u32 = if pos > 0 { CLS_HAS_BOM } else { 0 };
    let mut rows: u32 = 0;
    let mut fields: u32 = 0;
    let mut first_row_fields: u32 = 0;
    let mut quote_carry: u64 = 0;

    let lo_lut = _mm_setr_epi8(0, 0, 0b010, 0, 0, 0, 0, 0, 0, 0, 0b100, 0, 0b001, 0, 0, 0);
    let hi_lut = _mm_setr_epi8(0b100, 0, 0b011, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    let mask_0f = _mm_set1_epi8(0x0F);
    let comma_bit = _mm_set1_epi8(0b001);
    let quote_bit = _mm_set1_epi8(0b010);
    let newline_bit = _mm_set1_epi8(0b100);
    let cr_vec = _mm_set1_epi8(b'\r' as i8);

    let chunk_count = (len - pos) / 64;
    let simd_start = pos;

    for chunk_idx in 0..chunk_count {
        let base = simd_start + chunk_idx * 64;
        let mut cm: u64 = 0;
        let mut qm: u64 = 0;
        let mut nm: u64 = 0;
        let mut crm: u64 = 0;

        for sub in 0..4u32 {
            let offset = base + sub as usize * 16;
            let input_vec = _mm_loadu_si128(input.as_ptr().add(offset) as *const __m128i);
            let lo_nibbles = _mm_and_si128(input_vec, mask_0f);
            let hi_nibbles = _mm_and_si128(_mm_srli_epi16(input_vec, 4), mask_0f);
            let lo_result = _mm_shuffle_epi8(lo_lut, lo_nibbles);
            let hi_result = _mm_shuffle_epi8(hi_lut, hi_nibbles);
            let classified = _mm_and_si128(lo_result, hi_result);
            let shift = sub * 16;
            cm |= (_mm_movemask_epi8(_mm_cmpeq_epi8(
                _mm_and_si128(classified, comma_bit),
                comma_bit,
            )) as u16 as u64)
                << shift;
            qm |= (_mm_movemask_epi8(_mm_cmpeq_epi8(
                _mm_and_si128(classified, quote_bit),
                quote_bit,
            )) as u16 as u64)
                << shift;
            nm |= (_mm_movemask_epi8(_mm_cmpeq_epi8(
                _mm_and_si128(classified, newline_bit),
                newline_bit,
            )) as u16 as u64)
                << shift;
            crm |= (_mm_movemask_epi8(_mm_cmpeq_epi8(input_vec, cr_vec)) as u16 as u64) << shift;
        }

        if qm != 0 {
            flags |= CLS_HAS_QUOTES;
        }
        if crm != 0 {
            flags |= CLS_HAS_CRLF;
        }

        let x_vec = _mm_set_epi64x(0, qm as i64);
        let ones = _mm_set_epi64x(0, -1i64);
        let quote_parity = _mm_extract_epi64(_mm_clmulepi64_si128(x_vec, ones, 0), 0) as u64
            ^ quote_carry.wrapping_neg();
        quote_carry = (qm.count_ones() as u64 + quote_carry) & 1;

        let outside = !quote_parity;
        let real_commas = cm & outside;
        let real_newlines = nm & outside;
        let quoted_newlines = nm & quote_parity;

        if quoted_newlines != 0 {
            flags |= CLS_HAS_QUOTED_NL;
        }

        let escaped = qm & (qm >> 1) & outside;
        if escaped != 0 {
            flags |= CLS_HAS_ESCAPES;
        }

        fields += real_commas.count_ones() + real_newlines.count_ones();
        let new_rows = real_newlines.count_ones();
        if rows == 0 && new_rows > 0 {
            let first_nl_bit = real_newlines & real_newlines.wrapping_neg();
            let before_first_nl = first_nl_bit - 1;
            first_row_fields = fields
                - (real_commas & !before_first_nl).count_ones()
                - (real_newlines & !before_first_nl).count_ones()
                + (real_newlines & before_first_nl).count_ones();
        }
        rows += new_rows;
    }

    pos = simd_start + chunk_count * 64;
    let mut in_quoted = quote_carry != 0;

    let mut last_was_nl = false;
    while pos < len {
        let b = input[pos];
        if in_quoted {
            if b == b'"' {
                if pos + 1 < len && input[pos + 1] == b'"' {
                    flags |= CLS_HAS_ESCAPES;
                    pos += 2;
                    continue;
                }
                in_quoted = false;
                pos += 1;
                continue;
            }
            if b == b'\n' || b == b'\r' {
                flags |= CLS_HAS_QUOTED_NL;
            }
            pos += 1;
            last_was_nl = false;
            continue;
        }
        match b {
            b'"' => {
                flags |= CLS_HAS_QUOTES;
                in_quoted = true;
                pos += 1;
                last_was_nl = false;
            }
            b',' => {
                fields += 1;
                pos += 1;
                last_was_nl = false;
            }
            b'\n' => {
                fields += 1;
                rows += 1;
                if rows == 1 {
                    first_row_fields = fields;
                }
                pos += 1;
                last_was_nl = true;
            }
            b'\r' => {
                if pos + 1 < len && input[pos + 1] == b'\n' {
                    flags |= CLS_HAS_CRLF;
                    fields += 1;
                    rows += 1;
                    if rows == 1 {
                        first_row_fields = fields;
                    }
                    pos += 2;
                    last_was_nl = true;
                } else {
                    pos += 1;
                    last_was_nl = false;
                }
            }
            _ => {
                pos += 1;
                last_was_nl = false;
            }
        }
    }

    if !last_was_nl && len > 0 {
        fields += 1;
        rows += 1;
        if rows == 1 {
            first_row_fields = fields;
        }
    }

    let cols = first_row_fields;
    write_u32(out, 0, rows);
    write_u32(out, 4, cols);
    write_u32(out, 8, fields);
    write_u32(out, 12, flags);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cls(input: &str) -> (u32, u32, u32, u32) {
        let mut out = [0u8; CLS_BUF_SIZE];
        classify(input.as_bytes(), &mut out);
        let rows = u32::from_le_bytes(out[0..4].try_into().unwrap());
        let cols = u32::from_le_bytes(out[4..8].try_into().unwrap());
        let fields = u32::from_le_bytes(out[8..12].try_into().unwrap());
        let flags = u32::from_le_bytes(out[12..16].try_into().unwrap());
        (rows, cols, fields, flags)
    }

    #[test]
    fn classify_simple() {
        assert_eq!(cls("a,b,c\n1,2,3\n4,5,6"), (3, 3, 9, 0));
    }

    #[test]
    fn classify_single_row_no_newline() {
        assert_eq!(cls("a,b,c"), (1, 3, 3, 0));
    }

    #[test]
    fn classify_single_column() {
        assert_eq!(cls("a\n1\n2"), (3, 1, 3, 0));
    }

    #[test]
    fn classify_trailing_newline() {
        assert_eq!(cls("a,b\n1,2\n"), (2, 2, 4, 0));
    }

    #[test]
    fn classify_empty() {
        assert_eq!(cls(""), (0, 0, 0, 0));
    }

    #[test]
    fn classify_quotes() {
        let (rows, cols, fields, flags) = cls("a,b\n\"hello\",world");
        assert_eq!((rows, cols, fields), (2, 2, 4));
        assert_ne!(flags & CLS_HAS_QUOTES, 0);
        assert_eq!(flags & CLS_HAS_ESCAPES, 0);
    }

    #[test]
    fn classify_escaped_quotes() {
        let (rows, cols, fields, flags) = cls("a,b\n\"he said \"\"hi\"\"\",world");
        assert_eq!((rows, cols, fields), (2, 2, 4));
        assert_ne!(flags & CLS_HAS_QUOTES, 0);
        assert_ne!(flags & CLS_HAS_ESCAPES, 0);
    }

    #[test]
    fn classify_quoted_newlines() {
        let (rows, cols, fields, flags) = cls("a,b\n\"line1\nline2\",world");
        assert_eq!((rows, cols, fields), (2, 2, 4));
        assert_ne!(flags & CLS_HAS_QUOTED_NL, 0);
    }

    #[test]
    fn classify_crlf() {
        let (rows, cols, fields, flags) = cls("a,b\r\n1,2\r\n3,4");
        assert_eq!((rows, cols, fields), (3, 2, 6));
        assert_ne!(flags & CLS_HAS_CRLF, 0);
    }

    #[test]
    fn classify_all_flags() {
        let input = "\u{FEFF}a,b\r\n\"he \"\"said\"\"\nhi\",world\r\n";
        let (rows, cols, _fields, flags) = cls(input);
        assert_eq!((rows, cols), (2, 2));
        assert_ne!(flags & CLS_HAS_QUOTES, 0);
        assert_ne!(flags & CLS_HAS_ESCAPES, 0);
        assert_ne!(flags & CLS_HAS_QUOTED_NL, 0);
        assert_ne!(flags & CLS_HAS_CRLF, 0);
    }

    #[test]
    fn classify_single_field() {
        assert_eq!(cls("hello"), (1, 1, 1, 0));
    }

    #[test]
    fn classify_two_rows_no_trailing() {
        assert_eq!(cls("a,b\n1,2"), (2, 2, 4, 0));
    }
}
