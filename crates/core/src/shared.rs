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

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "ssse3,sse4.1")]
pub(crate) unsafe fn classify_chunk_x86(ptr: *const u8) -> (u64, u64, u64) {
    use std::arch::x86_64::*;
    let lo_lut = _mm_setr_epi8(0, 0, 0b010, 0, 0, 0, 0, 0, 0, 0, 0b100, 0, 0b001, 0, 0, 0);
    let hi_lut = _mm_setr_epi8(0b100, 0, 0b011, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    let mask_0f = _mm_set1_epi8(0x0F);
    let comma_bit = _mm_set1_epi8(0b001);
    let quote_bit = _mm_set1_epi8(0b010);
    let newline_bit = _mm_set1_epi8(0b100);
    let mut cm: u64 = 0;
    let mut qm: u64 = 0;
    let mut nm: u64 = 0;
    for sub in 0..4u32 {
        let v = _mm_loadu_si128(ptr.add(sub as usize * 16) as *const __m128i);
        let lo = _mm_and_si128(v, mask_0f);
        let hi = _mm_and_si128(_mm_srli_epi16(v, 4), mask_0f);
        let classified = _mm_and_si128(_mm_shuffle_epi8(lo_lut, lo), _mm_shuffle_epi8(hi_lut, hi));
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
    }
    (cm, qm, nm)
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "pclmulqdq")]
pub(crate) unsafe fn prefix_xor_x86(x: u64) -> u64 {
    use std::arch::x86_64::*;
    let x_vec = _mm_set_epi64x(0, x as i64);
    let ones = _mm_set_epi64x(0, -1i64);
    _mm_extract_epi64(_mm_clmulepi64_si128(x_vec, ones, 0), 0) as u64
}
