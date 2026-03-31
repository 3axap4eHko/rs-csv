#![allow(unsafe_op_in_unsafe_fn)]

mod classify;
mod parse_common;
mod parse_quoted_str;
mod parse_quoted_typed;
mod scan_positions;
mod shared;

pub use classify::{
    CLS_BUF_SIZE, CLS_HAS_BOM, CLS_HAS_CRLF, CLS_HAS_ESCAPES, CLS_HAS_QUOTED_NL, CLS_HAS_QUOTES,
    classify,
};

pub use scan_positions::scan_positions;

pub use parse_common::{EOL_BIT, OP_APPEND, OP_BIGINT, OP_BOOL, OP_EOF, OP_NULL, OP_NUM, OP_STR};

pub fn parse(input: &[u8], output: &mut [u8], offset: usize, typed: bool, str_row: bool) -> usize {
    if offset >= input.len() {
        return 0;
    }
    let bytes = &input[offset..];

    if typed {
        parse_quoted_typed::parse(bytes, output, offset, str_row)
    } else {
        parse_quoted_str::parse(bytes, output, offset, str_row)
    }
}
