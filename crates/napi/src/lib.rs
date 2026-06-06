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
pub fn fused_typed_parse_js(
    env: Env,
    input: JsString,
    mut input_buf: Buffer,
    mut pos_buf: Buffer,
    mut output: Buffer,
    mut side_buf: Buffer,
    descriptor: Buffer,
    has_headers: bool,
    max_samples: u32,
) -> Result<u32> {
    let len = read_js_string_utf8(env, input, &mut input_buf)?;
    let bytes = &input_buf[..len];
    let desc = if descriptor.is_empty() {
        None
    } else {
        Some(descriptor.as_ref())
    };
    let result = rs_csv_core::fused_typed_parse(
        bytes,
        pos_buf.as_mut(),
        output.as_mut(),
        side_buf.as_mut(),
        desc,
        has_headers,
        max_samples as usize,
    );
    Ok(result.output_len as u32)
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

