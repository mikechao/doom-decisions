import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';

export { frameRgbaSha256 } from '../../app/frame-png.mjs';

const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const header = Buffer.from('00000280000001900806000000', 'hex');
const stride = 640 * 4;
const height = 400;

function chunk(name, data) {
  const payload = Buffer.concat([Buffer.from(name), data]);
  const size = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([size, payload, crc]);
}

export function encodeFrame(rgba) {
  assert.equal(rgba.length, stride * height);
  const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    pixels.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
