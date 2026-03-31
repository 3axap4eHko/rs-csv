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
