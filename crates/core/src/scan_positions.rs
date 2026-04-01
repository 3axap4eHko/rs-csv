#[cfg(target_arch = "x86_64")]
use crate::shared::{classify_chunk_x86, prefix_xor_x86};
use crate::shared::{skip_bom, write_u32};

const POS_HEADER: usize = 16;
const POS_NON_ASCII: u32 = 1;

pub fn scan_positions(input: &[u8], out: &mut [u8]) -> usize {
    let len = input.len();
    if len == 0 || out.len() < POS_HEADER + 4 {
        if out.len() >= 4 {
            out[0..4].copy_from_slice(&0u32.to_le_bytes());
        }
        return 0;
    }

    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("ssse3") && is_x86_feature_detected!("sse4.1") {
            return unsafe { scan_positions_simd_x86(input, out) };
        }
    }

    scan_positions_scalar(input, out)
}

fn scan_positions_scalar(input: &[u8], out: &mut [u8]) -> usize {
    let len = input.len();
    let pos = skip_bom(input);
    let first_start = pos as u32;

    let mut wp = POS_HEADER;
    let max_wp = out.len() - 4;
    let mut rows: u32 = 0;
    let mut width: u32 = 0;
    let mut fields_in_row: u32 = 0;
    let mut field_start = pos;
    let mut non_ascii: u32 = 0;
    let mut pos = pos;

    while pos < len {
        let b = input[pos];
        non_ascii |= (b >> 7) as u32;

        match b {
            b',' => {
                if wp > max_wp {
                    break;
                }
                write_u32(out, wp, pos as u32);
                wp += 4;
                fields_in_row += 1;
                pos += 1;
                field_start = pos;
            }
            b'\n' => {
                let end = if pos > 0 && input[pos - 1] == b'\r' {
                    pos - 1
                } else {
                    pos
                };
                if wp > max_wp {
                    break;
                }
                write_u32(out, wp, end as u32);
                wp += 4;
                fields_in_row += 1;
                rows += 1;
                if rows == 1 {
                    width = fields_in_row;
                }
                fields_in_row = 0;
                pos += 1;
                field_start = pos;
            }
            _ => {
                pos += 1;
            }
        }
    }

    if field_start < len && wp <= max_wp {
        let end = if len > 0 && input[len - 1] == b'\r' {
            len - 1
        } else {
            len
        };
        write_u32(out, wp, end as u32);
        fields_in_row += 1;
        rows += 1;
        if rows == 1 {
            width = fields_in_row;
        }
    }

    let mut flags: u32 = 0;
    if non_ascii != 0 {
        flags |= POS_NON_ASCII;
    }

    write_u32(out, 0, rows);
    write_u32(out, 4, width);
    write_u32(out, 8, flags);
    write_u32(out, 12, first_start);
    len
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "ssse3,sse4.1")]
unsafe fn scan_positions_simd_x86(input: &[u8], out: &mut [u8]) -> usize {
    use std::arch::x86_64::*;

    let len = input.len();
    let pos = skip_bom(input);
    let first_start = pos as u32;

    let mut wp = POS_HEADER;
    let max_wp = out.len() - 4;
    let mut rows: u32 = 0;
    let mut width: u32 = 0;
    let mut fields_in_row: u32 = 0;
    let mut non_ascii: u64 = 0;

    let comma_vec = _mm_set1_epi8(b',' as i8);
    let nl_vec = _mm_set1_epi8(b'\n' as i8);
    let hi_bit = _mm_set1_epi8(0x80u8 as i8);

    let chunk_count = (len - pos) / 64;
    let simd_start = pos;

    for chunk_idx in 0..chunk_count {
        let base = simd_start + chunk_idx * 64;
        let mut comma_mask: u64 = 0;
        let mut nl_mask: u64 = 0;
        let mut hi_mask: u64 = 0;

        for sub in 0..4u32 {
            let offset = base + sub as usize * 16;
            let v = _mm_loadu_si128(input.as_ptr().add(offset) as *const __m128i);
            let shift = sub * 16;
            comma_mask |= (_mm_movemask_epi8(_mm_cmpeq_epi8(v, comma_vec)) as u16 as u64) << shift;
            nl_mask |= (_mm_movemask_epi8(_mm_cmpeq_epi8(v, nl_vec)) as u16 as u64) << shift;
            hi_mask |= (_mm_movemask_epi8(_mm_and_si128(v, hi_bit)) as u16 as u64) << shift;
        }

        non_ascii |= hi_mask;
        let mut delims = comma_mask | nl_mask;

        while delims != 0 {
            if wp > max_wp {
                break;
            }
            let bit = delims.trailing_zeros() as usize;
            let abs = base + bit;
            let is_nl = (nl_mask >> bit) & 1 != 0;

            if is_nl {
                let end = if abs > 0 && input[abs - 1] == b'\r' {
                    abs - 1
                } else {
                    abs
                };
                write_u32(out, wp, end as u32);
                wp += 4;
                fields_in_row += 1;
                rows += 1;
                if rows == 1 {
                    width = fields_in_row;
                }
                fields_in_row = 0;
            } else {
                write_u32(out, wp, abs as u32);
                wp += 4;
                fields_in_row += 1;
            }

            delims &= delims - 1;
        }
    }

    let mut pos = simd_start + chunk_count * 64;
    let mut field_start = pos;

    while pos < len {
        let b = input[pos];
        if b >= 0x80 {
            non_ascii |= 1;
        }
        match b {
            b',' => {
                if wp > max_wp {
                    break;
                }
                write_u32(out, wp, pos as u32);
                wp += 4;
                fields_in_row += 1;
                pos += 1;
                field_start = pos;
            }
            b'\n' => {
                let end = if pos > 0 && input[pos - 1] == b'\r' {
                    pos - 1
                } else {
                    pos
                };
                if wp > max_wp {
                    break;
                }
                write_u32(out, wp, end as u32);
                wp += 4;
                fields_in_row += 1;
                rows += 1;
                if rows == 1 {
                    width = fields_in_row;
                }
                fields_in_row = 0;
                pos += 1;
                field_start = pos;
            }
            _ => {
                pos += 1;
            }
        }
    }

    if field_start < len && wp <= max_wp {
        let end = if len > 0 && input[len - 1] == b'\r' {
            len - 1
        } else {
            len
        };
        write_u32(out, wp, end as u32);
        fields_in_row += 1;
        rows += 1;
        if rows == 1 {
            width = fields_in_row;
        }
    }

    let mut flags: u32 = 0;
    if non_ascii != 0 {
        flags |= POS_NON_ASCII;
    }

    write_u32(out, 0, rows);
    write_u32(out, 4, width);
    write_u32(out, 8, flags);
    write_u32(out, 12, first_start);
    len
}

pub const FIELD_EOL: u32 = 0x8000_0000;
pub const FIELD_QUOTED: u32 = 0x4000_0000;
pub const FIELD_ESCAPED: u32 = 0x2000_0000;
pub const FIELD_CRLF: u32 = 0x1000_0000;
pub const FIELD_POS_MASK: u32 = 0x0FFF_FFFF;

struct FieldState {
    wp: usize,
    rows: u32,
    width: u32,
    fields_in_row: u32,
    in_quoted: bool,
    field_quoted: bool,
    field_escaped: bool,
    field_start: usize,
}

impl FieldState {
    fn emit(&mut self, out: &mut [u8], end: u32, is_eol: bool, is_crlf: bool) {
        let mut entry = end;
        if is_eol {
            entry |= FIELD_EOL;
        }
        if is_crlf {
            entry |= FIELD_CRLF;
        }
        if self.field_quoted {
            entry |= FIELD_QUOTED;
        }
        if self.field_escaped {
            entry |= FIELD_ESCAPED;
        }
        write_u32(out, self.wp, entry);
        self.wp += 4;
        self.fields_in_row += 1;
        if is_eol {
            self.rows += 1;
            if self.rows == 1 {
                self.width = self.fields_in_row;
            }
            self.fields_in_row = 0;
        }
        self.field_quoted = false;
        self.field_escaped = false;
    }

    fn begin_field(&mut self, input: &[u8], pos: usize) {
        self.field_start = pos;
        if pos < input.len() && input[pos] == b'"' {
            self.in_quoted = true;
            self.field_quoted = true;
            self.field_start = pos + 1;
        }
    }
}

pub fn scan_fields(input: &[u8], out: &mut [u8]) -> usize {
    let len = input.len();
    if len == 0 || out.len() < POS_HEADER + 4 {
        if out.len() >= 4 {
            write_u32(out, 0, 0);
        }
        return 0;
    }

    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("ssse3")
            && is_x86_feature_detected!("sse4.1")
            && is_x86_feature_detected!("pclmulqdq")
        {
            return unsafe { scan_fields_simd_x86(input, out) };
        }
    }

    scan_fields_scalar(input, out)
}

fn scan_fields_scalar(input: &[u8], out: &mut [u8]) -> usize {
    let bom = skip_bom(input);
    let max_wp = out.len() - 4;
    let mut s = FieldState {
        wp: POS_HEADER,
        rows: 0,
        width: 0,
        fields_in_row: 0,
        in_quoted: false,
        field_quoted: false,
        field_escaped: false,
        field_start: bom,
    };
    s.begin_field(input, bom);
    let start = s.field_start;
    scan_fields_tail(input, out, &mut s, start, max_wp);
    input.len()
}

fn scan_fields_tail(
    input: &[u8],
    out: &mut [u8],
    s: &mut FieldState,
    mut pos: usize,
    max_wp: usize,
) {
    let len = input.len();
    while pos < len {
        if s.in_quoted {
            match memchr::memchr(b'"', &input[pos..]) {
                None => break,
                Some(off) => {
                    let abs = pos + off;
                    if abs + 1 < len && input[abs + 1] == b'"' {
                        s.field_escaped = true;
                        pos = abs + 2;
                    } else {
                        s.in_quoted = false;
                        pos = abs + 1;
                    }
                }
            }
        } else {
            match memchr::memchr3(b'"', b',', b'\n', &input[pos..]) {
                None => break,
                Some(off) => {
                    let abs = pos + off;
                    match input[abs] {
                        b'"' => {
                            s.in_quoted = true;
                            s.field_quoted = true;
                            pos = abs + 1;
                        }
                        b',' => {
                            if s.wp > max_wp {
                                break;
                            }
                            s.emit(out, abs as u32, false, false);
                            pos = abs + 1;
                            s.begin_field(input, pos);
                            pos = s.field_start;
                        }
                        b'\n' => {
                            if s.wp > max_wp {
                                break;
                            }
                            let end = if abs > 0 && input[abs - 1] == b'\r' {
                                abs - 1
                            } else {
                                abs
                            };
                            let crlf = end != abs;
                            s.emit(out, end as u32, true, crlf);
                            pos = abs + 1;
                            s.begin_field(input, pos);
                            pos = s.field_start;
                        }
                        _ => unreachable!(),
                    }
                }
            }
        }
    }
    scan_fields_finish(input, out, s);
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "ssse3,sse4.1,pclmulqdq")]
unsafe fn scan_fields_simd_x86(input: &[u8], out: &mut [u8]) -> usize {
    let len = input.len();
    let bom = skip_bom(input);
    let max_wp = out.len() - 4;

    let mut s = FieldState {
        wp: POS_HEADER,
        rows: 0,
        width: 0,
        fields_in_row: 0,
        in_quoted: false,
        field_quoted: false,
        field_escaped: false,
        field_start: bom,
    };

    if bom < len && input[bom] == b'"' {
        s.in_quoted = true;
        s.field_quoted = true;
        s.field_start = bom + 1;
    }

    let chunk_count = (len - bom) / 64;
    let simd_start = bom;
    let mut quote_carry: u64 = if s.in_quoted { 1 } else { 0 };

    for chunk_idx in 0..chunk_count {
        let base = simd_start + chunk_idx * 64;
        let (cm, qm, nm) = classify_chunk_x86(input.as_ptr().add(base));

        let quote_parity = prefix_xor_x86(qm) ^ quote_carry.wrapping_neg();
        quote_carry = (qm.count_ones() as u64 + quote_carry) & 1;

        let outside = !quote_parity;
        let real_commas = cm & outside;
        let real_newlines = nm & outside;
        let mut delimiters = real_commas | real_newlines;

        while delimiters != 0 {
            if s.wp > max_wp {
                break;
            }
            let bit = delimiters.trailing_zeros() as usize;
            let abs = base + bit;
            let is_nl = (real_newlines >> bit) & 1 != 0;

            if s.in_quoted {
                let esc = s.field_start < abs - 1
                    && memchr::memchr(b'"', &input[s.field_start..abs - 1]).is_some();
                if esc {
                    s.field_escaped = true;
                }
            }

            if is_nl {
                let end = if abs > 0 && input[abs - 1] == b'\r' {
                    abs - 1
                } else {
                    abs
                };
                let crlf = end != abs;
                s.emit(out, end as u32, true, crlf);
            } else {
                s.emit(out, abs as u32, false, false);
            }

            s.in_quoted = false;
            let next = abs + 1;
            s.begin_field(input, next);

            delimiters &= delimiters - 1;
        }
    }

    let mut pos = simd_start + chunk_count * 64;
    if pos <= s.field_start {
        pos = s.field_start;
    }
    s.in_quoted = quote_carry != 0;

    scan_fields_tail(input, out, &mut s, pos, max_wp);
    len
}

fn scan_fields_finish(input: &[u8], out: &mut [u8], s: &mut FieldState) {
    let len = input.len();
    let has_trailing = len > 0 && input[len - 1] != b'\n';
    if (has_trailing || s.in_quoted || s.fields_in_row > 0) && s.wp <= out.len() - 4 {
        let end = if len > 0 && input[len - 1] == b'\r' {
            len - 1
        } else {
            len
        };
        s.emit(out, end as u32, true, false);
    }
    let field_count = ((s.wp - POS_HEADER) / 4) as u32;
    let bom = skip_bom(input) as u32;
    write_u32(out, 0, field_count);
    write_u32(out, 4, s.rows);
    write_u32(out, 8, s.width);
    write_u32(out, 12, bom);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scan(input: &str) -> (u32, u32, u32, u32, Vec<u32>) {
        let mut out = vec![0u8; POS_HEADER + input.len() * 4 + 64];
        scan_positions(input.as_bytes(), &mut out);
        let rows = u32::from_le_bytes(out[0..4].try_into().unwrap());
        let width = u32::from_le_bytes(out[4..8].try_into().unwrap());
        let flags = u32::from_le_bytes(out[8..12].try_into().unwrap());
        let first_start = u32::from_le_bytes(out[12..16].try_into().unwrap());
        let field_count = rows * width;
        let mut positions = Vec::new();
        for i in 0..field_count as usize {
            let off = POS_HEADER + i * 4;
            positions.push(u32::from_le_bytes(out[off..off + 4].try_into().unwrap()));
        }
        (rows, width, flags, first_start, positions)
    }

    #[test]
    fn simple() {
        let (rows, width, flags, first_start, positions) = scan("a,b,c\n1,2,3\n4,5,6");
        assert_eq!(rows, 3);
        assert_eq!(width, 3);
        assert_eq!(flags, 0);
        assert_eq!(first_start, 0);
        assert_eq!(positions, vec![1, 3, 5, 7, 9, 11, 13, 15, 17]);
    }

    #[test]
    fn single_column() {
        let (rows, width, _, first_start, positions) = scan("a\nb\nc");
        assert_eq!(rows, 3);
        assert_eq!(width, 1);
        assert_eq!(first_start, 0);
        assert_eq!(positions, vec![1, 3, 5]);
    }

    #[test]
    fn single_row() {
        let (rows, width, _, first_start, positions) = scan("a,b,c");
        assert_eq!(rows, 1);
        assert_eq!(width, 3);
        assert_eq!(first_start, 0);
        assert_eq!(positions, vec![1, 3, 5]);
    }

    #[test]
    fn trailing_newline() {
        let (rows, width, _, _, positions) = scan("a,b\n1,2\n");
        assert_eq!(rows, 2);
        assert_eq!(width, 2);
        assert_eq!(positions, vec![1, 3, 5, 7]);
    }

    #[test]
    fn crlf() {
        let (rows, width, _, _, positions) = scan("a,b\r\n1,2\r\n");
        assert_eq!(rows, 2);
        assert_eq!(width, 2);
        assert_eq!(positions, vec![1, 3, 6, 8]);
    }

    #[test]
    fn bom() {
        let input = "\u{FEFF}a,b\n1,2";
        let (rows, width, _, first_start, _) = scan(input);
        assert_eq!(rows, 2);
        assert_eq!(width, 2);
        assert_eq!(first_start, 3);
    }

    #[test]
    fn empty() {
        let mut out = vec![0u8; POS_HEADER + 64];
        let consumed = scan_positions(b"", &mut out);
        assert_eq!(consumed, 0);
        let rows = u32::from_le_bytes(out[0..4].try_into().unwrap());
        assert_eq!(rows, 0);
    }
}
