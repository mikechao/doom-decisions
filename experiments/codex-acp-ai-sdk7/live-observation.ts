import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import {
  parseAgentConfigResult,
  parseAgentObserveResult,
  parseAgentPromptResult,
} from '../../app/src/agent-control.ts';
import { isAgentId, parseAgentDecisionResult, type AgentObservation } from '../../app/src/agent-observation.ts';

export function requireLive(ok: unknown): asserts ok {
  if (!ok) throw new Error('INVALID_LIVE_EVIDENCE');
}

export function record(value: unknown): Record<string, unknown> {
  requireLive(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export type Lease = { pageId: string; ownerId: string; epoch: string; leaseFile: string };
export function parseLease(value: unknown): Lease {
  const data = record(value);
  requireLive(Object.keys(data).sort().join(',') === 'epoch,leaseFile,ownerId,pageId');
  requireLive([data.pageId, data.ownerId, data.epoch].every(isAgentId));
  requireLive(typeof data.leaseFile === 'string' && isAbsolute(data.leaseFile));
  return data as Lease;
}

// runAgentCli already checks the HTTP command ID against its own request. These
// checks preserve that envelope when adapting its materialized return value.
function envelope(value: unknown, lease: Lease) {
  const { pageId, epoch, commandId, ...domain } = record(value);
  requireLive(pageId === lease.pageId && epoch === lease.epoch && isAgentId(commandId));
  return { commandId, domain };
}

export function configResult(value: unknown, lease: Lease) {
  return parseAgentConfigResult(envelope(value, lease).domain);
}

export function promptResult(value: unknown, lease: Lease) {
  return parseAgentPromptResult(envelope(value, lease).domain);
}

export type ReadPng = (path: string, signal: AbortSignal) => Promise<Uint8Array>;
async function imageFor(
  path: unknown,
  commandId: string,
  lease: Lease,
  metadata: unknown,
  read: ReadPng,
  signal: AbortSignal,
) {
  requireLive(path === join(dirname(lease.leaseFile), `${commandId}.png`));
  const data = record(metadata);
  requireLive(!Object.hasOwn(data, 'png'));
  signal.throwIfAborted();
  // Copy and hash the exact file bytes used below. PNG and decoded RGBA hashes
  // are distinct; native/Canvas verification remains owned by the browser.
  const image = Buffer.from(await read(path as string, signal));
  signal.throwIfAborted();
  requireLive(image.length < 1_500_000);
  requireLive(createHash('sha256').update(image).digest('hex') === data.pngSha256);
  return { image, inline: { ...data, png: `data:image/png;base64,${image.toString('base64')}` } };
}

// Deliberately exclude IDs, paths, configuration, frame hashes and arbitrary
// previousAction.text. Only typed scalar/enum evidence enters the model prompt.
export function modelState(observation: AgentObservation) {
  const { telemetry: t, mapIdentity: map, facingProbe: probe, previousAction: previous } = observation;
  return {
    source: 'Fresh browser-verified Doom observation; navigation interpretations remain advisory.',
    map: { episode: map.episode, map: map.map, mapSlot: map.mapSlot },
    tic: observation.tic,
    phase: observation.phase,
    telemetry: {
      health: t.health,
      x: t.x,
      y: t.y,
      angle: t.angle,
      readyWeapon:
        t.readyWeapon === null
          ? null
          : {
              id: t.readyWeapon.id,
              name: t.readyWeapon.name,
              ammoType: t.readyWeapon.ammoType,
            },
      ammo:
        t.ammo === null
          ? null
          : {
              bullets: { current: t.ammo.bullets.current, max: t.ammo.bullets.max },
              shells: { current: t.ammo.shells.current, max: t.ammo.shells.max },
              cells: { current: t.ammo.cells.current, max: t.ammo.cells.max },
              rockets: { current: t.ammo.rockets.current, max: t.ammo.rockets.max },
            },
    },
    facingProbe:
      probe === null ? null : { tic: probe.tic, kind: probe.kind, door: probe.door, distance: probe.distance },
    previousAction:
      previous === null ? null : { action: previous.action, tics: previous.tics, endTic: previous.endTic },
  };
}

export async function liveObserve(value: unknown, lease: Lease, read: ReadPng, signal: AbortSignal) {
  const { commandId, domain } = envelope(value, lease);
  const { pngPath, ...metadata } = domain;
  const { image, inline } = await imageFor(pngPath, commandId, lease, metadata, read, signal);
  const observation = parseAgentObserveResult(inline);
  return { observation, image, payload: modelState(observation) };
}

export function sameGame(next: AgentObservation, before: AgentObservation) {
  requireLive(next.sessionId === before.sessionId && next.mapIdentity.mapKey === before.mapIdentity.mapKey);
}

export async function liveDecision(
  value: unknown,
  lease: Lease,
  before: AgentObservation,
  read: ReadPng,
  signal: AbortSignal,
) {
  const { commandId, domain } = envelope(value, lease);
  const { pngPath, ...metadata } = domain;
  requireLive(commandId === before.observationId && metadata.beforeObservationId === before.observationId);
  let image: Buffer | null = null;
  if (metadata.observation !== null) {
    const prepared = await imageFor(pngPath, commandId, lease, metadata.observation, read, signal);
    metadata.observation = prepared.inline;
    image = prepared.image;
  } else requireLive(pngPath === null);
  const receipt = parseAgentDecisionResult(metadata);
  if (receipt.observation) {
    sameGame(receipt.observation, before);
    requireLive(receipt.observation.observationId !== before.observationId);
    requireLive(receipt.observation.tic === before.tic + Number(receipt.verifiedTics));
  }
  return { receipt, image, payload: receipt.observation ? modelState(receipt.observation) : null };
}
