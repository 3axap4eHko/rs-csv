use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

#[napi]
pub fn parse_csv(input: Buffer, mut cmd_buf: Buffer, offset: u32) -> u32 {
    rs_csv_core::parse(&input, cmd_buf.as_mut(), offset as usize) as u32
}
