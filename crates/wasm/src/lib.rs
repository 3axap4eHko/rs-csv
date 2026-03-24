use wasm_bindgen::prelude::*;
use std::alloc::{alloc, dealloc, Layout};

#[wasm_bindgen]
pub fn wasm_alloc(size: usize) -> *mut u8 {
    let layout = Layout::from_size_align(size, 1).unwrap();
    unsafe { alloc(layout) }
}

#[wasm_bindgen]
pub fn wasm_free(ptr: *mut u8, size: usize) {
    let layout = Layout::from_size_align(size, 1).unwrap();
    unsafe { dealloc(ptr, layout) }
}

#[wasm_bindgen]
pub fn parse_csv(input_ptr: *const u8, input_len: usize, cmd_ptr: *mut u8, cmd_len: usize, offset: usize) -> usize {
    let input = unsafe { std::slice::from_raw_parts(input_ptr, input_len) };
    let cmd_buf = unsafe { std::slice::from_raw_parts_mut(cmd_ptr, cmd_len) };
    rs_csv_core::parse(input, cmd_buf, offset)
}
