import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import type { MemoryGeometry, MemoryRecognition } from '../../doom-memory.mjs';

function fixtureRgba(pixel: number) {
  return Buffer.alloc(640 * 400 * 4, Buffer.from([pixel, pixel, pixel, 255]));
}

export function memoryFixtureFrameSha256(pixel = 0) {
  return createHash('sha256').update(fixtureRgba(pixel)).digest('hex');
}

export function memoryFixturePng(pixel = 0, marker?: number, idat?: Buffer): Buffer {
  function chunk(type: string, data: Buffer) {
    const bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length);
    bytes.write(type, 4, 'ascii');
    data.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
    return bytes;
  }
  const rgba = fixtureRgba(pixel);
  const stride = 640 * 4;
  const rows = Buffer.alloc((stride + 1) * 400);
  for (let row = 0; row < 400; row++) {
    rgba.copy(rows, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', Buffer.from('00000280000001900806000000', 'hex')),
    ...(marker === undefined ? [] : [chunk('tEXt', Buffer.from('fixture\0' + marker))]),
    chunk('IDAT', idat ?? deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const memoryFixtureGeometry = {
  kind: 'two-sided-linedefs',
  provenance: { method: 'wad-lump-audit-v1', artifactSha256: 'a'.repeat(64) },
  segments: [
    { linedefOrdinal: 7, endpoints: [[-10, 0], [20, 0]], front: { sector: 1, floor: 0 }, back: { sector: 2, floor: 16 } },
    { linedefOrdinal: 2, endpoints: [[-10, 32], [20, 32]], front: { sector: 2, floor: 16 }, back: { sector: 3, floor: 32 } },
  ],
} as const satisfies MemoryGeometry;

export function memoryFixtureRecognition(png: Buffer, frameSha256 = memoryFixtureFrameSha256()): MemoryRecognition {
  return {
    reference: {
      runId: '00000000-0000-4000-8000-000000000001',
      ordinal: 1,
      observationId: '00000000-0000-4000-8000-000000000002',
      tic: 1,
      runResultSha256: 'b'.repeat(64),
      pngSha256: createHash('sha256').update(png).digest('hex'),
      frameSha256,
    },
    geometry: memoryFixtureGeometry,
  };
}
