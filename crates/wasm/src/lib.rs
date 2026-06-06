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
pub unsafe fn fused_typed_parse(
    input_ptr: *const u8,
    input_len: usize,
    pos_ptr: *mut u8,
    pos_len: usize,
    output_ptr: *mut u8,
    output_len: usize,
    side_ptr: *mut u8,
    side_len: usize,
    desc_ptr: *const u8,
    desc_len: usize,
    has_headers: bool,
    max_samples: usize,
) -> usize {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let pos_buf = std::slice::from_raw_parts_mut(pos_ptr, pos_len);
    let output = std::slice::from_raw_parts_mut(output_ptr, output_len);
    let side_buf = std::slice::from_raw_parts_mut(side_ptr, side_len);
    let descriptor = if desc_len == 0 {
        None
    } else {
        Some(std::slice::from_raw_parts(desc_ptr, desc_len))
    };
    let result = rs_csv_core::fused_typed_parse(input, pos_buf, output, side_buf, descriptor, has_headers, max_samples);
    result.output_len
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

