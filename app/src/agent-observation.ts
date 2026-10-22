import { masks, type ActionName } from './decision.ts';
import type { FacingProbe } from './facing-probe.ts';
import type { NativeObservation } from './worker-shared.ts';

// Deliberately small allowlist: no prompts, provider objects, errors or credentials.
export type AgentObservation = {
  observationId: string;
  sessionId: string;
  tic: number;
  phase: 'ready' | 'terminal';
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
    readyWeapon: NativeObservation['readyWeapon'];
    ammo: NativeObservation['ammo'];
    x: number;
    y: number;
    angle: number;
  };
  facingProbe: FacingProbe | null;
  previousAction: {
    action: ActionName;
    tics: number;
    endTic: number;
    text: string;
  } | null;
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
    'observationId',
    'sessionId',
    'tic',
    'phase',
    'frame',
    'counters',
    'telemetry',
    'facingProbe',
    'previousAction',
    'png',
    'pngSha256',
  ]);
  requireValue(
    isAgentId(data.observationId) &&
      isAgentId(data.sessionId) &&
      integer(data.tic) &&
      Number(data.tic) >= 1,
  );
  requireValue(
    (data.phase === 'ready' || data.phase === 'terminal') &&
      hash(data.pngSha256),
  );
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
    'readyWeapon',
    'ammo',
    'x',
    'y',
    'angle',
  ]);
  requireValue(
    ['weaponId', 'bullets', 'shells', 'cells', 'rockets'].every(
      (key) => telemetry[key] === null || integer(telemetry[key]),
    ),
  );
  requireValue(
    ['health', 'x', 'y', 'angle'].every((key) => integer(telemetry[key])),
  );
  requireValue(data.phase === 'terminal' || Number(telemetry.health) > 0);
  if (telemetry.readyWeapon === null) requireValue(telemetry.weaponId === null);
  else {
    const weapon = object(telemetry.readyWeapon, ['id', 'name', 'ammoType']);
    requireValue(integer(weapon.id) && weapon.id === telemetry.weaponId);
    requireValue(
      typeof weapon.name === 'string' &&
        typeof weapon.ammoType === 'string' &&
        [
          'fist',
          'pistol',
          'shotgun',
          'chaingun',
          'rocket_launcher',
          'plasma_rifle',
          'bfg9000',
          'chainsaw',
          'super_shotgun',
          'unknown',
        ].includes(String(weapon.name)) &&
        ['bullets', 'shells', 'cells', 'rockets', 'none', 'unknown'].includes(
          String(weapon.ammoType),
        ),
    );
  }
  const ammoTypes = ['bullets', 'shells', 'cells', 'rockets'];
  if (telemetry.ammo === null)
    requireValue(ammoTypes.every((key) => telemetry[key] === null));
  else {
    const ammo = object(telemetry.ammo, ammoTypes);
    for (const key of ammoTypes) {
      const quantity = object(ammo[key], ['current', 'max']);
      requireValue(
        integer(quantity.current) &&
          integer(quantity.max) &&
          quantity.current === telemetry[key],
      );
    }
  }
  if (data.facingProbe !== null) {
    const probe = object(data.facingProbe, ['tic', 'kind', 'door', 'distance']);
    requireValue(data.phase === 'ready' && probe.tic === data.tic);
    requireValue(
      integer(probe.kind) &&
        Number(probe.kind) >= 1 &&
        Number(probe.kind) <= 5 &&
        integer(probe.door) &&
        Number(probe.door) >= 0 &&
        Number(probe.door) <= 2,
    );
    if (probe.kind === 1)
      requireValue(probe.door === 0 && probe.distance === -1);
    else {
      requireValue(
        integer(probe.distance) &&
          Number(probe.distance) >= 0 &&
          Number(probe.distance) <= 64,
      );
      if (probe.kind === 2) requireValue(probe.door !== 2);
      if (probe.kind === 4) requireValue(probe.door !== 0);
      if (probe.kind === 5) requireValue(probe.door === 0);
    }
  }
  if (data.previousAction !== null) {
    const previous = object(data.previousAction, [
      'action',
      'tics',
      'endTic',
      'text',
    ]);
    requireValue(
      data.phase === 'ready' &&
        typeof previous.action === 'string' &&
        Object.hasOwn(masks, previous.action) &&
        integer(previous.tics) &&
        Number(previous.tics) > 0 &&
        previous.endTic === data.tic &&
        Number(previous.tics) < Number(data.tic) &&
        typeof previous.text === 'string' &&
        previous.text.length > 0,
    );
  }
  requireValue(typeof data.png === 'string');
  agentPngBytes(data.png);
  return value as AgentObservation;
}

export type AgentDecisionResult = {
  outcome:
    | 'completed'
    | 'not-admitted'
    | 'api-failure'
    | 'stopped'
    | 'terminal'
    | 'retired';
  reason:
    | 'no-grant'
    | 'lease-revoked'
    | 'not-ready'
    | 'stale-observation'
    | null;
  beforeObservationId: string;
  sdkInvoked: boolean;
  action: ActionName | null;
  requestedTics: number | null;
  reportedTics: number | null;
  verifiedTics: number | null;
  cumulativeTics: number | null;
  completionUncertain: boolean;
  requestIdentity: {
    provider: 'OpenRouter' | 'OpenAI' | 'TypeSafe / Jev';
    requestedModel: string;
  } | null;
  responseMetadata: {
    reportedModel: string | null;
    usage: {
      input: number | null;
      output: number | null;
      total: number | null;
    };
  } | null;
  observation: AgentObservation | null;
};
const count = (n: unknown) => integer(n) && Number(n) >= 0;
const model = (s: unknown) =>
  typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(s);
export function parseAgentDecisionResult(value: unknown): AgentDecisionResult {
  const data = object(value, [
    'outcome',
    'reason',
    'beforeObservationId',
    'sdkInvoked',
    'action',
    'requestedTics',
    'reportedTics',
    'verifiedTics',
    'cumulativeTics',
    'completionUncertain',
    'requestIdentity',
    'responseMetadata',
    'observation',
  ]);
  requireValue(
    [
      'completed',
      'not-admitted',
      'api-failure',
      'stopped',
      'terminal',
      'retired',
    ].includes(String(data.outcome)),
  );
  requireValue(
    data.reason === null ||
      ['no-grant', 'lease-revoked', 'not-ready', 'stale-observation'].includes(
        String(data.reason),
      ),
  );
  requireValue(
    isAgentId(data.beforeObservationId) &&
      typeof data.sdkInvoked === 'boolean' &&
      typeof data.completionUncertain === 'boolean',
  );
  requireValue(
    data.action === null ||
      (typeof data.action === 'string' && Object.hasOwn(masks, data.action)),
  );
  for (const key of [
    'requestedTics',
    'reportedTics',
    'verifiedTics',
    'cumulativeTics',
  ])
    requireValue(data[key] === null || count(data[key]));
  if (data.requestIdentity !== null) {
    const identity = object(data.requestIdentity, [
      'provider',
      'requestedModel',
    ]);
    requireValue(
      ['OpenRouter', 'OpenAI', 'TypeSafe / Jev'].includes(
        String(identity.provider),
      ) && model(identity.requestedModel),
    );
  }
  if (data.responseMetadata !== null) {
    const metadata = object(data.responseMetadata, ['reportedModel', 'usage']);
    requireValue(
      metadata.reportedModel === null || model(metadata.reportedModel),
    );
    const usage = object(metadata.usage, ['input', 'output', 'total']);
    requireValue(Object.values(usage).every((n) => n === null || count(n)));
  }
  if (data.observation !== null) parseAgentObservation(data.observation);
  if (data.outcome === 'completed' || data.outcome === 'terminal') {
    requireValue(
      data.sdkInvoked &&
        data.action !== null &&
        !data.completionUncertain &&
        data.observation !== null,
    );
    const observation = data.observation as AgentObservation;
    requireValue(
      data.cumulativeTics === observation.tic &&
        count(data.verifiedTics) &&
        Number(data.requestedTics) > 0,
    );
    requireValue(
      data.outcome === 'terminal'
        ? observation.phase === 'terminal'
        : observation.phase === 'ready' &&
            data.reportedTics === data.requestedTics &&
            data.verifiedTics === data.requestedTics,
    );
  } else requireValue(data.observation === null);
  return value as AgentDecisionResult;
}
