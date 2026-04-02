use crate::parse_common::{EOL_BIT, OP_BIGINT, OP_BOOL, OP_EOF, OP_NULL, OP_NUM, OP_STR};
use crate::scan_positions::{FIELD_CRLF, FIELD_EOL, FIELD_ESCAPED, FIELD_POS_MASK, FIELD_QUOTED};
use crate::shared::{TYPE_BIGINT, TYPE_BOOLEAN, TYPE_NUMBER, TYPE_STRING};

pub fn parse_with_types(
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
    let mut start = first_start;
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
        let is_eol = entry & FIELD_EOL != 0;
        let is_crlf = entry & FIELD_CRLF != 0;

        let (fs, fe) = if is_quoted {
            (start + 1, end - 1)
        } else {
            (start, end)
        };
        let flen = fe.saturating_sub(fs);
        let col = i % width;
        let is_last = is_eol;
        let col_type = if col < col_types.len() {
            col_types[col]
        } else {
            TYPE_STRING
        };

        if flen == 0 {
            output[wp] = OP_NULL | if is_last { EOL_BIT } else { 0 };
            output[wp + 1..wp + 9].copy_from_slice(&0u64.to_le_bytes());
            wp += 9;
        } else if is_quoted || col_type == TYPE_STRING {
            write_str(output, &mut wp, fs, flen, is_last, is_escaped);
        } else {
            let slice = &input[fs..fe];
            match col_type {
                TYPE_NUMBER => {
                    if let Ok(n) = fast_float2::parse::<f64, _>(slice) {
                        output[wp] = OP_NUM | if is_last { EOL_BIT } else { 0 };
                        output[wp + 1..wp + 9].copy_from_slice(&n.to_le_bytes());
                        wp += 9;
                    } else {
                        write_str(output, &mut wp, fs, flen, is_last, false);
                    }
                }
                TYPE_BOOLEAN => {
                    let val = slice.eq_ignore_ascii_case(b"true");
                    output[wp] = OP_BOOL | if is_last { EOL_BIT } else { 0 };
                    output[wp + 1..wp + 9].copy_from_slice(&(val as u64).to_le_bytes());
                    wp += 9;
                }
                TYPE_BIGINT => {
                    output[wp] = OP_BIGINT | if is_last { EOL_BIT } else { 0 };
                    output[wp + 1..wp + 5].copy_from_slice(&(fs as u32).to_le_bytes());
                    output[wp + 5..wp + 9].copy_from_slice(&(flen as u32).to_le_bytes());
                    wp += 9;
                }
                _ => {
                    write_str(output, &mut wp, fs, flen, is_last, false);
                }
            }
        }

        start = end + if is_crlf { 2 } else { 1 };
    }

    output[wp] = OP_EOF;
    output[wp + 1..wp + 9].copy_from_slice(&0u64.to_le_bytes());
    wp += 9;
    wp
}

#[inline(always)]
fn write_str(
    buf: &mut [u8],
    wp: &mut usize,
    offset: usize,
    length: usize,
    is_last: bool,
    _is_escaped: bool,
) {
    buf[*wp] = OP_STR | if is_last { EOL_BIT } else { 0 };
    buf[*wp + 1..*wp + 5].copy_from_slice(&(offset as u32).to_le_bytes());
    buf[*wp + 5..*wp + 9].copy_from_slice(&(length as u32).to_le_bytes());
    *wp += 9;
}
