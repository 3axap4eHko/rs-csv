#[cfg(target_arch = "x86_64")]
use crate::shared::{classify_chunk_x86, prefix_xor_x86};
use crate::shared::{skip_bom, write_u32};

const POS_HEADER: usize = 16;

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
    // The leading quote (if any) is already counted in the chunk quote mask, so
    // chunk parity must start outside; seeding from `s.in_quoted` double-counts it.
    let mut quote_carry: u64 = 0;

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
    // With no SIMD chunks, `s.in_quoted` already reflects the leading-quote check;
    // only the chunk-parity carry should override it.
    if chunk_count > 0 {
        s.in_quoted = quote_carry != 0;
    }

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

pub fn compact_fields(input: &mut [u8], pos_buf: &mut [u8]) -> usize {
    let field_count = u32::from_le_bytes(pos_buf[0..4].try_into().unwrap()) as usize;
    if field_count == 0 {
        return 0;
    }

    let mut rp = u32::from_le_bytes(pos_buf[12..16].try_into().unwrap()) as usize;
    let mut wp: usize = 0;
    let mut pos_idx = POS_HEADER;

    for _ in 0..field_count {
        let entry = u32::from_le_bytes(pos_buf[pos_idx..pos_idx + 4].try_into().unwrap());
        let end = (entry & FIELD_POS_MASK) as usize;
        let is_quoted = entry & FIELD_QUOTED != 0;
        let is_escaped = entry & FIELD_ESCAPED != 0;
        let is_crlf = entry & FIELD_CRLF != 0;
        let is_eol = entry & FIELD_EOL != 0;

        if is_quoted {
            let content_start = rp + 1;
            let content_end = end - 1;
            if is_escaped {
                let mut src = content_start;
                while src < content_end {
                    if src + 1 < content_end && input[src] == b'"' && input[src + 1] == b'"' {
                        input[wp] = b'"';
                        wp += 1;
                        src += 2;
                    } else {
                        input[wp] = input[src];
                        wp += 1;
                        src += 1;
                    }
                }
            } else {
                let len = content_end - content_start;
                input.copy_within(content_start..content_end, wp);
                wp += len;
            }
        } else {
            let len = end - rp;
            input.copy_within(rp..end, wp);
            wp += len;
        }

        let new_entry = wp as u32 | if is_eol { FIELD_EOL } else { 0 };
        write_u32(pos_buf, pos_idx, new_entry);
        pos_idx += 4;

        rp = end + if is_crlf { 2 } else { 1 };
    }

    wp
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(input: &str) -> (u32, u32, u32) {
        let bytes = input.as_bytes();
        let mut out = vec![0u8; 16 + bytes.len() * 4 + 64];
        scan_fields(bytes, &mut out);
        (
            u32::from_le_bytes(out[0..4].try_into().unwrap()),
            u32::from_le_bytes(out[4..8].try_into().unwrap()),
            u32::from_le_bytes(out[8..12].try_into().unwrap()),
        )
    }

    #[test]
    fn leading_quote_wide_rows_simd() {
        // >64 bytes with a quoted first field exercises the SIMD quote-parity
        // carry; seeding it from the leading quote double-counts and collapses
        // the whole input into one field.
        let line = vec!["\"aaaa\""; 10].join(",");
        let csv = format!("{line}\n{line}\n");
        assert!(csv.len() > 64);
        assert_eq!(header(&csv), (20, 2, 10));
    }

    #[test]
    fn leading_quote_single_wide_row_no_newline() {
        let csv = vec!["\"aaaa\""; 20].join(",");
        assert!(csv.len() > 64);
        assert_eq!(header(&csv), (20, 1, 20));
    }

    #[test]
    fn unquoted_first_field_wide_row() {
        let line = (0..10).map(|i| format!("col{i:03}")).collect::<Vec<_>>().join(",");
        let csv = format!("{line}\n{line}\n");
        assert!(csv.len() > 64);
        assert_eq!(header(&csv), (20, 2, 10));
    }
}
