import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { pixels } from './synthetic-doom.ts';
import type { AgentObservation } from '../../src/agent-observation.ts';

// Actual PNG bytes, generated only from synthetic RGBA. No game assets/runtime.
export function pngFor(rgba = pixels(1)) {
  function chunk(name, bytes) {
    const data = Buffer.concat([Buffer.from(name), bytes]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const out = Buffer.alloc(data.length + 8);
    out.writeUInt32BE(bytes.length);
    data.copy(out, 4);
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
    return out;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(640, 0); header.writeUInt32BE(400, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(400 * (640 * 4 + 1));
  for (let row = 0; row < 400; row++) Buffer.from(rgba.subarray(row * 2560, (row + 1) * 2560)).copy(rows, row * 2561 + 1);
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
export function agentObservation(): AgentObservation {
  const hash = createHash('sha256').update(pixels(1)).digest('hex');
  const png = pngFor();
  return {
    observationId: randomUUID(), sessionId: randomUUID(), tic: 1, phase: 'ready',
    frame: { tic: 1, nativeSha256: hash, canvasSha256: hash },
    counters: { gametic: 1, leveltime: 1, render: 3, frame: 3 },
    telemetry: { health: 100, weaponId: 1, bullets: 50, shells: 0, cells: 0, rockets: 0,
      readyWeapon: { id: 1, name: 'pistol', ammoType: 'bullets' },
      ammo: { bullets: { current: 50, max: 200 }, shells: { current: 0, max: 50 }, cells: { current: 0, max: 300 }, rockets: { current: 0, max: 50 } },
      x: 0, y: 0, angle: 0 },
    facingProbe: null,
    previousAction: null, png,
    pngSha256: createHash('sha256').update(Buffer.from(png.slice(22), 'base64')).digest('hex'),
  };
}
