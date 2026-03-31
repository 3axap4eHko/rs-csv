#![allow(clippy::missing_safety_doc)]

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
