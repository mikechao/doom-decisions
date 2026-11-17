import assert from 'node:assert/strict';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { hash } from '../../scripts/build_engine.mjs';

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

// The archived Canvas sidecars and this experiment's captures use this one PNG
// format. Compare decoded pixels because the two encoders use different filters.
export function frameRgbaSha256(png) {
  assert.ok(png.subarray(0, 8).equals(signature), 'Invalid PNG signature');
  assert.ok(png.readUInt32BE(8) === 13 && png.toString('ascii', 12, 16) === 'IHDR' &&
    png.subarray(16, 29).equals(header), 'Expected 640×400 non-interlaced RGBA PNG');
  const idat = [];
  let ended = false;
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    const end = offset + size + 8;
    assert.ok(end + 4 <= png.length, 'Truncated PNG chunk');
    const type = png.toString('ascii', offset + 4, offset + 8);
    assert.equal(crc32(png.subarray(offset + 4, end)), png.readUInt32BE(end), 'Invalid PNG CRC');
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, end));
    if (type === 'IEND') {
      ended = size === 0 && end + 4 === png.length;
      break;
    }
    offset = end + 4;
  }
  assert.ok(ended && idat.length, 'Incomplete PNG');
  const length = (stride + 1) * height;
  const rows = inflateSync(Buffer.concat(idat), { maxOutputLength: length });
  assert.equal(rows.length, length, 'Unexpected PNG scanline length');
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const source = y * (stride + 1);
    const filter = rows[source];
    assert.ok(filter <= 4, 'Unsupported PNG filter');
    if (filter === 0) {
      rows.copy(rgba, y * stride, source + 1, source + stride + 1);
      continue;
    }
    for (let x = 0; x < stride; x++) {
      const target = y * stride + x;
      const left = x >= 4 ? rgba[target - 4] : 0;
      const above = y ? rgba[target - stride] : 0;
      const upperLeft = y && x >= 4 ? rgba[target - stride - 4] : 0;
      const predictors = [0, left, above, (left + above) >> 1, paeth(left, above, upperLeft)];
      rgba[target] = rows[source + x + 1] + predictors[filter];
    }
  }
  return hash(rgba);
}

function paeth(left, above, upperLeft) {
  const l = Math.abs(above - upperLeft);
  const a = Math.abs(left - upperLeft);
  const u = Math.abs(left + above - 2 * upperLeft);
  if (l <= a && l <= u) return left;
  return a <= u ? above : upperLeft;
}
