pub(crate) trait OffsetMode {
    fn new(input: &[u8], first_start: usize) -> Self;
    fn field_offset(&self, quoted: bool) -> usize;
    fn slice_len(&self, bytes: &[u8]) -> usize;
    fn advance(&mut self, input: &[u8], byte_start: usize, next_start: usize);
}

pub(crate) struct ByteOffsets {
    pub unit_start: usize,
}

impl OffsetMode for ByteOffsets {
    fn new(_input: &[u8], first_start: usize) -> Self {
        Self {
            unit_start: first_start,
        }
    }

    fn field_offset(&self, quoted: bool) -> usize {
        self.unit_start + quoted as usize
    }

    fn slice_len(&self, bytes: &[u8]) -> usize {
        bytes.len()
    }

    fn advance(&mut self, _input: &[u8], _byte_start: usize, next_start: usize) {
        self.unit_start = next_start;
    }
}

pub(crate) struct Utf16Offsets {
    pub unit_start: usize,
}

impl OffsetMode for Utf16Offsets {
    fn new(input: &[u8], first_start: usize) -> Self {
        Self {
            unit_start: utf16_len(&input[..first_start]),
        }
    }

    fn field_offset(&self, quoted: bool) -> usize {
        self.unit_start + quoted as usize
    }

    fn slice_len(&self, bytes: &[u8]) -> usize {
        utf16_len(bytes)
    }

    fn advance(&mut self, input: &[u8], byte_start: usize, next_start: usize) {
        self.unit_start += utf16_len(&input[byte_start..next_start]);
    }
}

#[inline(always)]
pub(crate) fn utf16_len(bytes: &[u8]) -> usize {
    let mut units = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b < 0x80 {
            units += 1;
            i += 1;
        } else if b < 0xE0 {
            units += 1;
            i += 2;
        } else if b < 0xF0 {
            units += 1;
            i += 3;
        } else {
            units += 2;
            i += 4;
        }
    }
    units
}

#[inline(always)]
pub(crate) fn slice_or_empty(input: &[u8], start: usize, end: usize) -> &[u8] {
    if start <= end && end <= input.len() {
        &input[start..end]
    } else {
        &[]
    }
}

#[inline(always)]
pub(crate) fn next_field_start(end: usize, is_crlf: bool, input_len: usize) -> usize {
    if end >= input_len {
        return end;
    }
    end + if is_crlf { 2 } else { 1 }
}
