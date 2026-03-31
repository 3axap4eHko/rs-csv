use crate::parse_common;

pub(crate) fn parse(bytes: &[u8], output: &mut [u8], offset: usize, str_row: bool) -> usize {
    parse_common::parse_dispatch::<false>(bytes, output, offset, str_row)
}
