#![allow(clippy::missing_safety_doc)]
#![allow(clippy::too_many_arguments)]
#![allow(unsafe_op_in_unsafe_fn)]

use std::alloc::{Layout, alloc, dealloc};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub unsafe fn wasm_alloc(size: usize) -> *mut u8 {
    let layout = Layout::from_size_align(size, 1).unwrap();
    alloc(layout)
}

#[wasm_bindgen]
pub unsafe fn wasm_free(ptr: *mut u8, size: usize) {
    let layout = Layout::from_size_align(size, 1).unwrap();
    dealloc(ptr, layout)
}

#[wasm_bindgen]
pub unsafe fn parse_csv(
    input_ptr: *const u8,
    input_len: usize,
    cmd_ptr: *mut u8,
    cmd_len: usize,
    offset: usize,
    typed: bool,
    str_row: bool,
) -> usize {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let cmd_buf = std::slice::from_raw_parts_mut(cmd_ptr, cmd_len);
    rs_csv_core::parse(input, cmd_buf, offset, typed, str_row)
}

#[wasm_bindgen]
pub unsafe fn scan_positions(
    input_ptr: *const u8,
    input_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let out = std::slice::from_raw_parts_mut(out_ptr, out_len);
    rs_csv_core::scan_positions(input, out)
}

#[wasm_bindgen]
pub unsafe fn infer_csv(
    input_ptr: *const u8,
    input_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
    has_headers: bool,
    max_samples: usize,
) -> usize {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let out = std::slice::from_raw_parts_mut(out_ptr, out_len);
    rs_csv_core::infer(input, out, has_headers, max_samples)
}

#[wasm_bindgen]
pub unsafe fn parse_with_types(
    input_ptr: *const u8,
    input_len: usize,
    pos_ptr: *const u8,
    pos_len: usize,
    output_ptr: *mut u8,
    output_len: usize,
    col_types_ptr: *const u8,
    col_types_len: usize,
) -> usize {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let pos_buf = std::slice::from_raw_parts(pos_ptr, pos_len);
    let output = std::slice::from_raw_parts_mut(output_ptr, output_len);
    let col_types = std::slice::from_raw_parts(col_types_ptr, col_types_len);
    rs_csv_core::parse_with_types(input, pos_buf, output, col_types)
}

#[wasm_bindgen]
pub unsafe fn parse_with_types_utf16(
    input_ptr: *const u8,
    input_len: usize,
    pos_ptr: *const u8,
    pos_len: usize,
    output_ptr: *mut u8,
    output_len: usize,
    col_types_ptr: *const u8,
    col_types_len: usize,
) -> usize {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let pos_buf = std::slice::from_raw_parts(pos_ptr, pos_len);
    let output = std::slice::from_raw_parts_mut(output_ptr, output_len);
    let col_types = std::slice::from_raw_parts(col_types_ptr, col_types_len);
    rs_csv_core::parse_with_types_utf16(input, pos_buf, output, col_types)
}

#[wasm_bindgen]
pub unsafe fn scan_fields(
    input_ptr: *const u8,
    input_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let out = std::slice::from_raw_parts_mut(out_ptr, out_len);
    rs_csv_core::scan_fields(input, out)
}

#[wasm_bindgen]
pub unsafe fn compact_fields(
    input_ptr: *mut u8,
    input_len: usize,
    pos_ptr: *mut u8,
    pos_len: usize,
) -> usize {
    let input = std::slice::from_raw_parts_mut(input_ptr, input_len);
    let pos_buf = std::slice::from_raw_parts_mut(pos_ptr, pos_len);
    rs_csv_core::compact_fields(input, pos_buf)
}

#[wasm_bindgen]
pub unsafe fn classify_csv(
    input_ptr: *const u8,
    input_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let out = std::slice::from_raw_parts_mut(out_ptr, out_len);
    rs_csv_core::classify(input, out);
}

#[wasm_bindgen]
pub unsafe fn memchr_index(input_ptr: *const u8, input_len: usize, needle: u8) -> i64 {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    match memchr::memchr(needle, input) {
        Some(i) => i as i64,
        None => -1,
    }
}
