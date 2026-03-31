#[inline(always)]
pub(crate) fn write_u32(buf: &mut [u8], pos: usize, val: u32) {
    buf[pos..pos + 4].copy_from_slice(&val.to_le_bytes());
}

#[inline(always)]
pub(crate) fn skip_bom(bytes: &[u8]) -> usize {
    if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        3
    } else {
        0
    }
}

pub(crate) fn skip_blank_lines(bytes: &[u8], pos: &mut usize) {
    let len = bytes.len();
    while *pos < len {
        if bytes[*pos] == b'\n' {
            *pos += 1;
            continue;
        }
        if *pos + 1 < len && bytes[*pos] == b'\r' && bytes[*pos + 1] == b'\n' {
            *pos += 2;
            continue;
        }
        break;
    }
}

pub(crate) fn trim_cr(bytes: &[u8], end: usize) -> usize {
    if end > 0 && bytes[end - 1] == b'\r' {
        end - 1
    } else {
        end
    }
}
