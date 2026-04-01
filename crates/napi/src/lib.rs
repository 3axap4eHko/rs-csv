use napi::bindgen_prelude::*;
use napi::{JsString, NapiRaw};
use napi_derive::napi;

#[napi]
pub fn parse_csv(
    input: Buffer,
    mut cmd_buf: Buffer,
    offset: u32,
    typed: bool,
    str_row: bool,
) -> u32 {
    rs_csv_core::parse(&input, cmd_buf.as_mut(), offset as usize, typed, str_row) as u32
}

#[napi]
pub fn parse_csv_str(
    input: String,
    mut cmd_buf: Buffer,
    offset: u32,
    typed: bool,
    str_row: bool,
) -> u32 {
    rs_csv_core::parse(
        input.as_bytes(),
        cmd_buf.as_mut(),
        offset as usize,
        typed,
        str_row,
    ) as u32
}

#[napi]
pub fn scan_positions(input: String, mut out: Buffer) -> u32 {
    rs_csv_core::scan_positions(input.as_bytes(), out.as_mut()) as u32
}

#[napi]
pub fn scan_fields_str(input: String, mut out: Buffer) -> u32 {
    rs_csv_core::scan_fields(input.as_bytes(), out.as_mut()) as u32
}

#[napi]
pub fn scan_fields_buf(input: Buffer, mut out: Buffer) -> u32 {
    rs_csv_core::scan_fields(&input, out.as_mut()) as u32
}

#[napi]
pub fn classify_csv(
    env: Env,
    input: JsString,
    mut cls: Buffer,
    mut input_buf: Buffer,
) -> Result<u32> {
    let mut len: usize = 0;
    let status = unsafe {
        napi::sys::napi_get_value_string_utf8(
            env.raw(),
            input.raw(),
            input_buf.as_mut_ptr() as *mut std::os::raw::c_char,
            input_buf.len(),
            &mut len,
        )
    };
    if status != napi::sys::Status::napi_ok {
        return Err(napi::Error::from_reason("Failed to read string"));
    }
    rs_csv_core::classify(&input_buf[..len], cls.as_mut());
    Ok(len as u32)
}

#[napi]
pub fn classify_csv_buf(input: Buffer, mut cls: Buffer) -> u32 {
    rs_csv_core::classify(&input, cls.as_mut());
    input.len() as u32
}

// --- FFI cost benchmarking helpers ---
// All return u32 to keep return marshaling constant.
// Each derives a value from the input so the compiler can't optimize it away.

#[napi]
pub fn napi_noop() -> u32 {
    0
}

#[napi]
pub fn napi_accept_u32(n: u32) -> u32 {
    n ^ 1
}

#[napi]
pub fn napi_accept_f64(n: f64) -> u32 {
    (n.to_bits() & 0xFFFFFFFF) as u32
}

#[napi]
pub fn napi_accept_bool(b: bool) -> u32 {
    b as u32
}

#[napi]
pub fn napi_accept_bigint(n: BigInt) -> u32 {
    let (val, _) = n.get_i64();
    val as u32
}

#[napi]
pub fn napi_accept_string(s: String) -> u32 {
    s.len() as u32
}

#[napi]
pub fn napi_accept_buffer(buf: Buffer) -> u32 {
    buf.len() as u32
}

#[napi]
pub fn napi_accept_buffer_mut(mut buf: Buffer) -> u32 {
    if !buf.is_empty() {
        buf[0] ^= 1;
    }
    buf.len() as u32
}

#[napi]
pub fn napi_accept_two_buffers(a: Buffer, b: Buffer) -> u32 {
    (a.len() + b.len()) as u32
}

#[napi]
pub fn napi_sum_bytes(buf: Buffer) -> u32 {
    let mut s: u32 = 0;
    for &b in buf.as_ref() {
        s = s.wrapping_add(b as u32);
    }
    s
}
