import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

export type Marker = { color: string; shape: string; horizontal: string; vertical: string };
export const expected: Marker[][] = [
  [
    { color: 'red', shape: 'circle', horizontal: 'left', vertical: 'top' },
    { color: 'blue', shape: 'square', horizontal: 'right', vertical: 'top' },
    { color: 'green', shape: 'triangle', horizontal: 'left', vertical: 'bottom' },
  ],
  [
    { color: 'red', shape: 'circle', horizontal: 'right', vertical: 'bottom' },
    { color: 'blue', shape: 'square', horizontal: 'left', vertical: 'bottom' },
    { color: 'green', shape: 'triangle', horizontal: 'right', vertical: 'top' },
  ],
];
// Tiny deterministic RGB PNG encoder: three flat shapes, no fonts/dependencies.
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, body, checksum]);
}
export function fixture(index: number): Buffer {
  const markers = expected[index];
  if (!markers) throw new Error('Unknown fixture');
  const rows = Buffer.alloc(400 * (640 * 3 + 1));
  const colors: Record<string, number[]> = { red: [230, 30, 40], blue: [30, 80, 240], green: [20, 180, 60] };
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 640; x++) {
      let rgb = [245, 245, 245];
      for (const marker of markers) {
        const dx = x - (marker.horizontal === 'left' ? 150 : 490);
        const dy = y - (marker.vertical === 'top' ? 100 : 300);
        const inside = marker.shape === 'circle' ? dx * dx + dy * dy <= 55 * 55
          : marker.shape === 'square' ? Math.abs(dx) <= 52 && Math.abs(dy) <= 52
          : dy >= -55 && dy <= 50 && Math.abs(dx) <= (dy + 55) * 0.6;
        if (inside) rgb = colors[marker.color];
      }
      const offset = y * 1921 + 1 + x * 3;
      rows.set(rgb, offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(640, 0);
  header.writeUInt32BE(400, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  for (const index of [0, 1]) {
    const bytes = fixture(index);
    const name = `fixture-${index === 0 ? 'a' : 'b'}.png`;
    writeFileSync(new URL(name, import.meta.url), bytes);
    console.log(`${name} ${bytes.length} bytes SHA-256 ${sha256(bytes)}`);
  }
}
