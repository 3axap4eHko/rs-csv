use napi::bindgen_prelude::*;
use napi::JsString;
use napi_derive::napi;

fn read_js_string_utf8(env: Env, input: JsString, buf: &mut Buffer) -> Result<usize> {
    let mut len: usize = 0;
    let status = unsafe {
        napi::sys::napi_get_value_string_utf8(
            env.raw(),
            input.raw(),
            buf.as_mut_ptr() as *mut std::os::raw::c_char,
            buf.len(),
            &mut len,
        )
    };
    if status != napi::sys::Status::napi_ok {
        return Err(napi::Error::from_reason("Failed to read string"));
    }
    Ok(len)
}

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
pub fn parse_csv_js(
    env: Env,
    input: JsString,
    mut input_buf: Buffer,
    mut cmd_buf: Buffer,
    offset: u32,
    typed: bool,
    str_row: bool,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    Ok(rs_csv_core::parse(
        &input_buf[..len],
        cmd_buf.as_mut(),
        offset as usize,
        typed,
        str_row,
    ) as u32)
}

#[napi]
pub fn scan_positions_js(
    env: Env,
    input: JsString,
    mut input_buf: Buffer,
    mut out: Buffer,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    Ok(rs_csv_core::scan_positions(&input_buf[..len], out.as_mut()) as u32)
}

#[napi]
pub fn infer_csv(input: Buffer, mut out: Buffer, has_headers: bool, max_samples: u32) -> u32 {
    rs_csv_core::infer(&input, out.as_mut(), has_headers, max_samples as usize) as u32
}

#[napi]
pub fn infer_csv_js(
    env: Env,
    input: JsString,
    mut input_buf: Buffer,
    mut out: Buffer,
    has_headers: bool,
    max_samples: u32,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    Ok(rs_csv_core::infer(
        &input_buf[..len],
        out.as_mut(),
        has_headers,
        max_samples as usize,
    ) as u32)
}

#[napi]
pub fn parse_with_types(
    input: Buffer,
    pos_buf: Buffer,
    mut output: Buffer,
    col_types: Buffer,
) -> u32 {
    rs_csv_core::parse_with_types(&input, &pos_buf, output.as_mut(), &col_types) as u32
}

#[napi]
pub fn parse_with_types_js(
    env: Env,
    input: JsString,
    mut input_buf: Buffer,
    pos_buf: Buffer,
    mut output: Buffer,
    col_types: Buffer,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    Ok(
        rs_csv_core::parse_with_types(&input_buf[..len], &pos_buf, output.as_mut(), &col_types)
            as u32,
    )
}

#[napi]
pub fn parse_with_types_js_utf16(
    env: Env,
    input: JsString,
    mut input_buf: Buffer,
    pos_buf: Buffer,
    mut output: Buffer,
    col_types: Buffer,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    Ok(
        rs_csv_core::parse_with_types_utf16(
            &input_buf[..len],
            &pos_buf,
            output.as_mut(),
            &col_types,
        ) as u32,
    )
}

#[napi]
pub fn scan_fields_js(
    env: Env,
    input: JsString,
    mut input_buf: Buffer,
    mut out: Buffer,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    Ok(rs_csv_core::scan_fields(&input_buf[..len], out.as_mut()) as u32)
}

#[napi]
pub fn scan_parse_with_types_js(
    env: Env,
    input: JsString,
    mut input_buf: Buffer,
    mut pos_buf: Buffer,
    mut output: Buffer,
    col_types: Buffer,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    let bytes = &input_buf[..len];
    rs_csv_core::scan_fields(bytes, pos_buf.as_mut());
    Ok(rs_csv_core::parse_with_types(bytes, &pos_buf, output.as_mut(), &col_types) as u32)
}

#[napi]
pub fn scan_parse_with_types_js_utf16(
    env: Env,
    input: JsString,
    mut input_buf: Buffer,
    mut pos_buf: Buffer,
    mut output: Buffer,
    col_types: Buffer,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    let bytes = &input_buf[..len];
    rs_csv_core::scan_fields(bytes, pos_buf.as_mut());
    Ok(rs_csv_core::parse_with_types_utf16(bytes, &pos_buf, output.as_mut(), &col_types) as u32)
}

#[napi]
pub fn scan_fields_buf(input: Buffer, mut out: Buffer) -> u32 {
    rs_csv_core::scan_fields(&input, out.as_mut()) as u32
}

#[napi]
pub fn scan_fields_compact(mut input: Buffer, mut out: Buffer) -> u32 {
    rs_csv_core::scan_fields(&input, out.as_mut());
    rs_csv_core::compact_fields(input.as_mut(), out.as_mut()) as u32
}

#[napi]
pub fn scan_fields_compact_js(
    env: Env,
    input: JsString,
    mut input_buf: Buffer,
    mut out: Buffer,
    mut content: Buffer,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    let bytes = &mut input_buf[..len];
    rs_csv_core::scan_fields(bytes, out.as_mut());
    let compact_len = rs_csv_core::compact_fields(bytes, out.as_mut());
    content[..compact_len].copy_from_slice(&bytes[..compact_len]);
    Ok(compact_len as u32)
}

#[napi]
pub fn classify_csv(
    env: Env,
    input: JsString,
    mut cls: Buffer,
    mut input_buf: Buffer,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    rs_csv_core::classify(&input_buf[..len], cls.as_mut());
    Ok(len as u32)
}

#[napi]
pub fn classify_csv_buf(input: Buffer, mut cls: Buffer) -> u32 {
    rs_csv_core::classify(&input, cls.as_mut());
    input.len() as u32
}

#[napi]
pub fn memchr_index(input: Buffer, needle: u8) -> i64 {
    match memchr::memchr(needle, &input) {
        Some(i) => i as i64,
        None => -1,
    }
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
