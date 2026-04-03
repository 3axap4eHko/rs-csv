#![allow(unsafe_op_in_unsafe_fn)]

mod classify;
mod infer;
mod parse_common;
mod parse_typed;
mod scan_positions;
mod shared;

pub use classify::{
    CLS_BUF_SIZE, CLS_HAS_BOM, CLS_HAS_CRLF, CLS_HAS_ESCAPES, CLS_HAS_NON_ASCII, CLS_HAS_QUOTED_NL,
    CLS_HAS_QUOTES, ClassifyResult, classify, classify_input,
};

pub use infer::infer;
pub use parse_typed::{parse_with_types, parse_with_types_utf16};
pub use scan_positions::{compact_fields, scan_fields, scan_positions};
pub use shared::{TYPE_BIGINT, TYPE_BOOLEAN, TYPE_NUMBER, TYPE_STRING};

pub use parse_common::{EOL_BIT, OP_APPEND, OP_BIGINT, OP_BOOL, OP_EOF, OP_NULL, OP_NUM, OP_STR};

pub fn parse(input: &[u8], output: &mut [u8], offset: usize, typed: bool, str_row: bool) -> usize {
    if offset >= input.len() {
        return 0;
    }
    let bytes = &input[offset..];
    parse_common::parse_dispatch(bytes, output, offset, str_row, typed)
}
