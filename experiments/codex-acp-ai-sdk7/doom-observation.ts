import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseAgentObserveResult } from '../../app/src/agent-control.ts';
import { agentPngBytes, isAgentId } from '../../app/src/agent-observation.ts';

export const fixtureRoot = new URL('.local/real-doom/', import.meta.url);
export const expectedPngSha256 = 'eee1533d7ef43bc0f65f33fd682f46340ef32b25c9cd68ad4d96298994678e79';
export const expectedMapKey = 'doom-map:v1:iwad-sha256:1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771:E1M1';
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function requireValue(ok: unknown, code: string): asserts ok {
  if (!ok) throw new Error(code);
}
function object(value: unknown): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_FIXTURE_OBJECT');
  return value as Record<string, unknown>;
}

export function loadFixture() {
  try {
    return {
      metadata: readFileSync(new URL('observation.json', fixtureRoot)),
      png: readFileSync(new URL('observation.png', fixtureRoot)),
      provenance: readFileSync(new URL('provenance.json', fixtureRoot)),
    };
  } catch {
    throw new Error('LOCAL_FIXTURE_MISSING_OR_UNREADABLE');
  }
}

// Pure replay preparation shared by --validate and --infer. No historical path
// is opened, no fixture is changed, and no capture-time fences can be repeated.
export function prepareReplay(files: ReturnType<typeof loadFixture>) {
  const metadata = object(JSON.parse(files.metadata.toString('utf8')));
  const { pngPath, pageId, epoch, commandId, ...inline } = metadata;
  requireValue(
    typeof pngPath === 'string' && pngPath.length > 0 &&
    [pageId, epoch, commandId].every(isAgentId) && !Object.hasOwn(metadata, 'png'),
    'INVALID_MATERIALIZATION',
  );
  const pngSha256 = sha256(files.png);
  requireValue(pngSha256 === expectedPngSha256 && inline.pngSha256 === pngSha256, 'PNG_HASH_MISMATCH');
  const observation = parseAgentObserveResult({
    ...inline, png: `data:image/png;base64,${files.png.toString('base64')}`,
  });
  requireValue(Buffer.from(agentPngBytes(observation.png)).equals(files.png), 'PNG_RECONSTRUCTION_MISMATCH');
  requireValue(
    observation.phase === 'ready' && observation.tic === 1 &&
    observation.mapIdentity.mapKey === expectedMapKey &&
    observation.previousAction === null && observation.run === null,
    'UNSUPPORTED_SNAPSHOT',
  );

  // Check extraction attestations and cross-file identities; do not send them
  // to the model or mistake them for newly collected native/Canvas evidence.
  const provenance = object(JSON.parse(files.provenance.toString('utf8')));
  const source = object(provenance.source);
  const recorded = object(provenance.observation);
  const verification = object(provenance.verification);
  const postWrite = object(verification.postWrite);
  requireValue(
    provenance.schemaVersion === 1 &&
    // Preserve the exact historical identity check without publishing private
    // session/call/observation identifiers in tracked source.
    sha256(Buffer.from(JSON.stringify([source.sessionId, source.callId, source.observationId]))) ===
      'b9ba27aa43a4be4579720dc3554b0d9b3ae10a2fdd22aadf87d931f71eb373bb' &&
    source.observationId === observation.observationId &&
    source.gameSessionId === observation.sessionId &&
    source.historicalCommit === '0c9dc65beef86cb7d71e6aa3d9536f346813594a' &&
    source.tool === 'doom_observe' && source.server === 'doom_decisions' &&
    recorded.tic === observation.tic && recorded.phase === observation.phase &&
    recorded.mapSlot === observation.mapIdentity.mapSlot && recorded.mapKey === expectedMapKey &&
    verification.metadataFileSha256 === sha256(files.metadata) &&
    verification.expectedPngSha256 === pngSha256 && verification.computedPngSha256 === pngSha256 &&
    verification.pngByteCount === files.png.length &&
    verification.width === 640 && verification.height === 400 &&
    verification.bitDepth === 8 && verification.colorType === 6 &&
    verification.rgbaSha256 === observation.frame.nativeSha256 &&
    verification.rgbaSha256 === observation.frame.canvasSha256 &&
    verification.reportedToolErrors === false &&
    verification.reconstructedExistingParser === 'parseAgentObserveResult: passed' &&
    ['callCompletionResponseCorrelated', 'metadataMatchesCompletion', 'allChunkCrcsValid',
      'pngFullyDecoded', 'matchesRecordedNativeAndCanvasHashes', 'requiredMetadataComplete',
      'materializedDirectParserRejected'].every(key => verification[key] === true) &&
    ['pngReopenedAndRehashed', 'metadataReopenedAndReparsed', 'metadataEqualsRecordedResult']
      .every(key => postWrite[key] === true),
    'PROVENANCE_MISMATCH',
  );

  const { mapIdentity: map, counters, telemetry: t, facingProbe: probe } = observation;
  // Explicit field-by-field allowlist, including nested objects. No rest/spread
  // from the observation into the model payload; config and IDs stay local.
  const payload = {
    source: 'Historically captured, replay hash-matched Doom snapshot; not live state.',
    mapIdentity: {
      iwadSha256: map.iwadSha256, episode: map.episode, map: map.map,
      mapSlot: map.mapSlot, mapKey: map.mapKey,
    },
    tic: observation.tic, phase: observation.phase,
    counters: { gametic: counters.gametic, leveltime: counters.leveltime, render: counters.render, frame: counters.frame },
    telemetry: {
      health: t.health, weaponId: t.weaponId, bullets: t.bullets, shells: t.shells,
      cells: t.cells, rockets: t.rockets, x: t.x, y: t.y, angle: t.angle,
      readyWeapon: t.readyWeapon === null ? null : {
        id: t.readyWeapon.id, name: t.readyWeapon.name, ammoType: t.readyWeapon.ammoType,
      },
      ammo: t.ammo === null ? null : {
        bullets: { current: t.ammo.bullets.current, max: t.ammo.bullets.max },
        shells: { current: t.ammo.shells.current, max: t.ammo.shells.max },
        cells: { current: t.ammo.cells.current, max: t.ammo.cells.max },
        rockets: { current: t.ammo.rockets.current, max: t.ammo.rockets.max },
      },
    },
    facingProbe: probe === null ? null : { tic: probe.tic, kind: probe.kind, door: probe.door, distance: probe.distance },
    previousAction: observation.previousAction,
  };
  return {
    image: files.png, payload,
    summary: {
      mapSlot: map.mapSlot, tic: observation.tic, phase: observation.phase,
      pngBytes: files.png.length, pngSha256, pngHashMatched: true,
      dimensions: '640x400', parsedDTO: 'PASS', provenanceConsistency: 'PASS',
      captureProofs: 'HISTORICAL_ONLY',
    },
  };
}
