import { masks, type ActionName } from './decision.ts';

// Deliberately small allowlist: no prompts, provider objects, errors or credentials.
export type AgentObservation = {
  sessionId: string;
  tic: number;
  phase: 'ready';
  frame: { tic: number; nativeSha256: string; canvasSha256: string };
  counters: {
    gametic: number;
    leveltime: number;
    render: number;
    frame: number;
  };
  telemetry: {
    health: number;
    weaponId: number | null;
    bullets: number | null;
    shells: number | null;
    cells: number | null;
    rockets: number | null;
    x: number;
    y: number;
    angle: number;
  };
  previousAction: { action: ActionName; tics: number; endTic: number } | null;
  png: string;
  pngSha256: string;
};

export const agentPath = '/__doom_agent';
export const agentOrigin = 'http://127.0.0.1:5174';
export const isAgentId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

function requireValue(ok: unknown): asserts ok {
  if (!ok) throw Error('Invalid agent observation.');
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  const record = value as Record<string, unknown>;
  requireValue(
    Object.keys(record).length === keys.length &&
      keys.every((key) => Object.hasOwn(record, key)),
  );
  return record;
}
const integer = (value: unknown) => Number.isSafeInteger(value);
const hash = (value: unknown) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function agentPngBytes(png: string): Uint8Array<ArrayBuffer> {
  requireValue(
    typeof png === 'string' &&
      png.length < 2_000_000 &&
      /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(png),
  );
  const bytes = Uint8Array.from(atob(png.slice(22)), (char) =>
    char.charCodeAt(0),
  );
  requireValue(bytes.length >= 33);
  requireValue(
    [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every(
      (byte, i) => bytes[i] === byte,
    ),
  );
  const header = new DataView(bytes.buffer);
  requireValue(header.getUint32(16) === 640 && header.getUint32(20) === 400);
  return bytes;
}

// Validate on both broker ingress and CLI ingress; reject extra fields outright.
export function parseAgentObservation(value: unknown): AgentObservation {
  const data = object(value, [
    'sessionId',
    'tic',
    'phase',
    'frame',
    'counters',
    'telemetry',
    'previousAction',
    'png',
    'pngSha256',
  ]);
  requireValue(
    isAgentId(data.sessionId) && integer(data.tic) && Number(data.tic) >= 1,
  );
  requireValue(data.phase === 'ready' && hash(data.pngSha256));
  const frame = object(data.frame, ['tic', 'nativeSha256', 'canvasSha256']);
  requireValue(
    frame.tic === data.tic &&
      hash(frame.nativeSha256) &&
      frame.nativeSha256 === frame.canvasSha256,
  );
  const counters = object(data.counters, [
    'gametic',
    'leveltime',
    'render',
    'frame',
  ]);
  requireValue(
    counters.gametic === data.tic && Object.values(counters).every(integer),
  );
  const telemetry = object(data.telemetry, [
    'health',
    'weaponId',
    'bullets',
    'shells',
    'cells',
    'rockets',
    'x',
    'y',
    'angle',
  ]);
  requireValue(Object.values(telemetry).every((n) => n === null || integer(n)));
  requireValue(
    ['health', 'x', 'y', 'angle'].every((key) => integer(telemetry[key])),
  );
  requireValue(Number(telemetry.health) > 0);
  if (data.previousAction !== null) {
    const previous = object(data.previousAction, ['action', 'tics', 'endTic']);
    requireValue(
      typeof previous.action === 'string' &&
        Object.hasOwn(masks, previous.action) &&
        integer(previous.tics) &&
        Number(previous.tics) > 0 &&
        previous.endTic === data.tic,
    );
  }
  requireValue(typeof data.png === 'string');
  agentPngBytes(data.png);
  return value as AgentObservation;
}
