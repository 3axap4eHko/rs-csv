#![allow(unsafe_op_in_unsafe_fn)]

mod classify;
mod infer;
mod offset_mode;
mod parse_aligned;
mod scan_positions;
mod shared;

pub use classify::{
    CLS_BUF_SIZE, CLS_HAS_BOM, CLS_HAS_CRLF, CLS_HAS_ESCAPES, CLS_HAS_NON_ASCII, CLS_HAS_QUOTED_NL,
    CLS_HAS_QUOTES, ClassifyResult, classify, classify_input,
};

pub use infer::infer;
pub use parse_aligned::{AlignedResult, fused_typed_parse, parse_aligned};
pub use scan_positions::{compact_fields, scan_fields};
pub use shared::{TYPE_BIGINT, TYPE_BOOLEAN, TYPE_NUMBER, TYPE_STRING};
