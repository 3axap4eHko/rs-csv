use crate::classify;
use crate::shared::{TYPE_STRING, detect_type, skip_bom, write_u32};

const UNSET: u8 = 0xFF;
const DESC_HEADER: usize = 8;

pub fn infer(input: &[u8], out: &mut [u8], has_headers: bool, max_samples: usize) -> usize {
    let len = input.len();
    if len == 0 || out.len() < DESC_HEADER {
        if out.len() >= 4 {
            write_u32(out, 0, 0);
        }
        return 0;
    }

    let cls = classify::classify_input(input);
    let flags = cls.flags;
    let width = cls.cols as usize;

    if width == 0 || out.len() < DESC_HEADER + width + 4 {
        write_u32(out, 0, flags);
        write_u32(out, 4, 0);
        return DESC_HEADER;
    }

    let bom = skip_bom(input);
    let mut pos = bom;

    let header_start = pos;
    if has_headers {
        pos = skip_row(input, pos);
    }

    let mut col_types = vec![UNSET; width];
    let mut sampled = 0;

    while pos < len && sampled < max_samples {
        for (col, col_type) in col_types.iter_mut().enumerate().take(width) {
            if pos >= len {
                break;
            }
            let (field_start, field_end, quoted, next) = next_field(input, pos, col == width - 1);
            pos = next;

            if field_start == field_end {
                continue;
            }
            if quoted {
                merge_type(col_type, TYPE_STRING);
                continue;
            }

            let t = detect_type(&input[field_start..field_end]);
            merge_type(col_type, t);
        }
        sampled += 1;
    }

    write_u32(out, 0, flags);
    write_u32(out, 4, width as u32);

    for i in 0..width {
        out[DESC_HEADER + i] = if col_types[i] == UNSET {
            TYPE_STRING
        } else {
            col_types[i]
        };
    }

    let mut wp = DESC_HEADER + width;

    if has_headers {
        let mut hpos = header_start;
        write_u32(out, wp, width as u32);
        wp += 4;

        for col in 0..width {
            let (fs, fe, quoted, next) = next_field(input, hpos, col == width - 1);
            hpos = next;

            let (hs, he) = if quoted { (fs + 1, fe - 1) } else { (fs, fe) };
            let hlen = he.saturating_sub(hs);

            if wp + 2 + hlen > out.len() {
                break;
            }
            out[wp] = (hlen & 0xFF) as u8;
            out[wp + 1] = ((hlen >> 8) & 0xFF) as u8;
            wp += 2;
            if hlen > 0 {
                out[wp..wp + hlen].copy_from_slice(&input[hs..he]);
                wp += hlen;
            }
        }
    } else {
        if wp + 4 <= out.len() {
            write_u32(out, wp, 0);
            wp += 4;
        }
    }

    wp
}

fn skip_row(input: &[u8], mut pos: usize) -> usize {
    let len = input.len();
    let mut in_quoted = false;

    while pos < len {
        if in_quoted {
            match memchr::memchr(b'"', &input[pos..]) {
                None => return len,
                Some(off) => {
                    let abs = pos + off;
                    if abs + 1 < len && input[abs + 1] == b'"' {
                        pos = abs + 2;
                    } else {
                        in_quoted = false;
                        pos = abs + 1;
                    }
                }
            }
        } else {
            match memchr::memchr2(b'"', b'\n', &input[pos..]) {
                None => return len,
                Some(off) => {
                    let abs = pos + off;
                    if input[abs] == b'\n' {
                        return abs + 1;
                    }
                    in_quoted = true;
                    pos = abs + 1;
                }
            }
        }
    }
    len
}

fn next_field(input: &[u8], pos: usize, is_last: bool) -> (usize, usize, bool, usize) {
    let len = input.len();
    if pos >= len {
        return (pos, pos, false, len);
    }

    let quoted = input[pos] == b'"';
    if quoted {
        let mut p = pos + 1;
        loop {
            match memchr::memchr(b'"', &input[p..]) {
                None => return (pos, len, true, len),
                Some(off) => {
                    let abs = p + off;
                    if abs + 1 < len && input[abs + 1] == b'"' {
                        p = abs + 2;
                        continue;
                    }
                    let field_end = abs + 1;
                    let next = if field_end >= len {
                        len
                    } else if input[field_end] == b'\n' {
                        field_end + 1
                    } else if input[field_end] == b'\r'
                        && field_end + 1 < len
                        && input[field_end + 1] == b'\n'
                    {
                        field_end + 2
                    } else {
                        field_end + 1
                    };
                    return (pos + 1, abs, true, next);
                }
            }
        }
    }

    let delim = if is_last { b'\n' } else { b',' };
    match memchr::memchr(delim, &input[pos..]) {
        None => (pos, len, false, len),
        Some(off) => {
            let abs = pos + off;
            let end = if delim == b'\n' && abs > 0 && input[abs - 1] == b'\r' {
                abs - 1
            } else {
                abs
            };
            (pos, end, false, abs + 1)
        }
    }
}

fn merge_type(current: &mut u8, detected: u8) {
    if *current == UNSET {
        *current = detected;
    } else if *current != detected {
        *current = TYPE_STRING;
    }
}
