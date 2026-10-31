import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { parseAgentObserveResult } from '../../app/src/agent-control.ts';
import { main, reserveAttempt } from './doom-observation-once.ts';
import { expectedMapKey, expectedPngSha256, loadFixture, prepareReplay, sha256 } from './doom-observation.ts';
import { validateDoomProposal } from './doom-proposal.ts';

const files = loadFixture(); // Missing real fixture is an explicit failure, never synthesized.
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
function changeMetadata(patch: Record<string, unknown>) {
  const metadata = json({ ...JSON.parse(files.metadata.toString()), ...patch });
  const provenance = JSON.parse(files.provenance.toString());
  // Keep the test's file-level digest consistent to exercise the actual DTO
  // parser independently. Original files are never written.
  provenance.verification.metadataFileSha256 = sha256(metadata);
  return { ...files, metadata, provenance: json(provenance) };
}

test('real materialized fixture reconstructs through existing strict parser and payload allowlist', () => {
  assert.throws(() => parseAgentObserveResult(JSON.parse(files.metadata.toString())));
  const replay = prepareReplay(files);
  assert.equal(replay.summary.parsedDTO, 'PASS');
  assert.equal(replay.summary.provenanceConsistency, 'PASS');
  assert.equal(replay.summary.pngSha256, expectedPngSha256);
  assert.equal(replay.payload.mapIdentity.mapKey, expectedMapKey);
  assert.equal(replay.payload.tic, 1);
  assert.equal(replay.payload.phase, 'ready');
  assert.equal(replay.payload.previousAction, null);
  assert.equal(replay.image, files.png);
  assert.deepEqual(Object.keys(replay.payload).sort(), ['source', 'mapIdentity', 'tic', 'phase', 'counters', 'telemetry', 'facingProbe', 'previousAction'].sort());
  const payload = JSON.stringify(replay.payload);
  const metadata = JSON.parse(files.metadata.toString());
  for (const key of ['pngPath', 'pageId', 'epoch', 'commandId', 'observationId', 'sessionId', 'configuration', 'revision', 'run', 'png', 'pngSha256']) assert.equal(Object.hasOwn(replay.payload, key), false);
  for (const key of ['pngPath', 'pageId', 'epoch', 'commandId', 'observationId', 'sessionId']) assert.equal(payload.includes(metadata[key]), false);
  assert.equal(payload.includes('data:image'), false);
});

test('wrong PNG bytes or metadata hash fail closed', () => {
  const png = Buffer.from(files.png);
  png[png.length - 1] ^= 1;
  assert.throws(() => prepareReplay({ ...files, png }), /PNG_HASH_MISMATCH/);
  assert.throws(() => prepareReplay(changeMetadata({ pngSha256: '0'.repeat(64) })), /PNG_HASH_MISMATCH/);
});

test('extra, missing, or invalid materialized/DTO metadata fails closed', () => {
  const metadata = JSON.parse(files.metadata.toString());
  for (const patch of [
    { extra: true }, { png: 'data:image/png;base64,AAAA' }, { pageId: 'bad' },
    { pngPath: null }, { epoch: undefined }, { telemetry: { ...metadata.telemetry, secret: true } },
    { telemetry: { ...metadata.telemetry, health: '100' } },
    { configuration: { ...metadata.configuration, extra: true } },
    { phase: 'terminal' }, { tic: 2 },
    { frame: { ...metadata.frame, canvasSha256: '0'.repeat(64) } },
  ]) assert.throws(() => prepareReplay(changeMetadata(patch)));
});

test('cross-file provenance identity, metadata digest and historical attestations must agree', () => {
  type Provenance = { source: Record<string, unknown>; observation: Record<string, unknown>; verification: Record<string, unknown> };
  for (const mutate of [
    (p: Provenance) => { p.source.sessionId = 'wrong'; },
    (p: Provenance) => { p.source.callId = 'wrong'; },
    (p: Provenance) => { p.source.observationId = 'wrong'; },
    (p: Provenance) => { p.source.gameSessionId = 'wrong'; },
    (p: Provenance) => { p.source.historicalCommit = 'wrong'; },
    (p: Provenance) => { p.observation.mapKey = 'wrong'; },
    (p: Provenance) => { p.verification.metadataFileSha256 = '0'.repeat(64); },
    (p: Provenance) => { p.verification.rgbaSha256 = expectedPngSha256; },
    (p: Provenance) => { p.verification.callCompletionResponseCorrelated = false; },
  ]) {
    const provenance = JSON.parse(files.provenance.toString());
    mutate(provenance);
    assert.throws(() => prepareReplay({ ...files, provenance: json(provenance) }), /PROVENANCE_MISMATCH/);
  }
});

test('five-field proposal validation is bounded and structural only', () => {
  const valid = {
    target: 'Inspect an apparent opening', visualEvidence: ['An apparent opening is visible.'],
    telemetryEvidence: ['Health is supplied as 100.'],
    uncertainty: 'A still image cannot establish traversability.', nextExperiment: 'Does another perspective show a continuing passage?',
  };
  assert.deepEqual(validateDoomProposal(JSON.stringify(valid)), valid);
  for (const patch of [
    { target: undefined }, { target: null }, { target: ' ' }, { target: 'x'.repeat(801) },
    { target: 'x\nsecret' }, { extra: true }, { recommendedTics: 6 },
    { visualEvidence: [] }, { visualEvidence: ['x'.repeat(401)] },
    { visualEvidence: Array(6).fill('fact') }, { visualEvidence: [4] },
    { telemetryEvidence: 'fact' }, { telemetryEvidence: [null] },
    { nextExperiment: {} },
  ]) assert.throws(() => validateDoomProposal(JSON.stringify({ ...valid, ...patch })));
  for (const raw of ['{', '[]', 'null', 'x'.repeat(8193), `\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``]) assert.throws(() => validateDoomProposal(raw));
});

test('exclusive inference marker survives and blocks a second reservation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'doom-advisory-test-'));
  const root = pathToFileURL(`${directory}/`);
  try {
    reserveAttempt(root);
    const marker = readFileSync(new URL('started.json', root));
    assert.throws(() => reserveAttempt(root), /ATTEMPT_ALREADY_STARTED_OR_UNWRITABLE/);
    assert.deepEqual(readFileSync(new URL('started.json', root)), marker);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('--validate succeeds with ACP/AI, process spawning and network imports forbidden', () => {
  const runner = new URL('doom-observation-once.ts', import.meta.url).href;
  const source = String.raw`
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (/^(?:ai(?:\/|$)|@mcpc-tech\/|@agentclientprotocol\/|@openai\/|(?:node:)?(?:child_process|http|https|http2|net|tls|dgram|dns)(?:\/|$))/.test(specifier)) throw Error('FORBIDDEN_OFFLINE_DEPENDENCY');
      return next(specifier, context);
    }});
    globalThis.fetch = () => { throw Error('FORBIDDEN_OFFLINE_FETCH'); };
    globalThis.WebSocket = class { constructor() { throw Error('FORBIDDEN_OFFLINE_WEBSOCKET'); } };
    const { main } = await import(${JSON.stringify(runner)});
    await main(['--validate']);
  `;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', source], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 0, 'Offline validation child must succeed without forbidden imports');
  const summary = JSON.parse(child.stdout);
  assert.equal(summary.mode, 'OFFLINE_VALIDATION');
  assert.equal(summary.inference, 'NOT_RUN');
  assert.equal(summary.parsedDTO, 'PASS');
  assert.equal(child.stdout.includes('data:image'), false);
  assert.equal(child.stdout.includes('/Users/'), false);
});

test('no default mode or extra arguments can admit inference', async () => {
  for (const args of [[], ['--unknown'], ['--validate', '--infer'], ['--infer', '--retry']]) await assert.rejects(main(args), /CHOOSE_VALIDATE_OR_INFER/);
});
