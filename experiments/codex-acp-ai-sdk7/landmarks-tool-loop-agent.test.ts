import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { acpTools, getExecuteByName } from '@mcpc-tech/acp-ai-provider';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { findMemory, recordMemory } from '../../app/doom-memory.mjs';
import { createAgentMapIdentity } from '../../app/src/agent-observation.ts';
import { rebuildSmokeTools } from './find-landmarks-acp-smoke.ts';
import { LandmarksToolLoopAgent, landmarksMain } from './landmarks-tool-loop-agent.ts';
import {
  createLandmarksTool, loadSavedContext, lookupLandmarks, savedObservationPath, snapshotPath,
  summarizeLandmarkEvent, validateSelection, verifySnapshot,
  type LandmarkReceipt, type LandmarkResult, type SavedContext,
} from './landmarks-tool.ts';

// Synthetic fixed fixture only: production identity/pose come from saved receipts.
const identity = createAgentMapIdentity('a'.repeat(64), 1, 1);
const foreignIdentity = createAgentMapIdentity('b'.repeat(64), 1, 1);
const context: SavedContext = {
  observationId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222', tic: 1,
  mapIdentity: identity,
  query: { mode: 'nearby', mapNamespace: identity.mapKey, x: 10, y: 20, headingDeg: 359, radius: 64, limit: 3 },
};

async function withFixture(work: (path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'doom-landmark-fixture-'));
  const path = join(root, 'memory.sqlite');
  const previous = process.env.DOOM_MEMORY_DB;
  process.env.DOOM_MEMORY_DB = path;
  try {
    // Reuse the repository schema initializer; only this throwaway file is writable.
    const seed = { operation: 'create', source: 'Synthetic fixture source, not runtime evidence',
      ...context.query, hypothesis: 'A possible corridor; traversability remains unverified.',
      isLandmark: true, isActiveExploration: true };
    const { mode, radius, limit, ...record } = seed;
    const first = await recordMemory({ ...record, requestId: 'fixture-one' });
    await recordMemory({ ...record, requestId: 'fixture-two', x: 12, headingDeg: 1 });
    await recordMemory({ ...record, requestId: 'foreign', mapNamespace: foreignIdentity.mapKey });
    await recordMemory({ ...record, requestId: 'ordinary-note', x: 11, isLandmark: false, isActiveExploration: false });
    await recordMemory({ operation: 'append', noteId: first.noteId, expectedRevision: 1, requestId: 'assessment',
      source: 'Synthetic assessment source', assessment: 'This is still an unverified visual interpretation.' });
    await work(path);
  } finally {
    if (previous === undefined) delete process.env.DOOM_MEMORY_DB;
    else process.env.DOOM_MEMORY_DB = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function selection(result: LandmarkResult, index = 0) {
  const candidate = result.candidates[index];
  assert.ok(candidate);
  return { status: 'selected', noteId: candidate.noteId, mapNamespace: candidate.mapNamespace,
    advisoryStatus: candidate.status, evidenceNoteIds: [candidate.noteId], source: candidate.source,
    summary: candidate.summary, explanation: 'Advisory lead: this nearby note may help orient a later visit; it remains unverified.' };
}

function decode(envelope: unknown) {
  const normalized = CallToolResultSchema.parse(JSON.parse(JSON.stringify(envelope)));
  assert.equal(normalized.content.length, 1);
  const block = normalized.content[0];
  assert.equal(block.type, 'text');
  if (block.type !== 'text') throw new Error('Expected text');
  return JSON.parse(block.text);
}

test('fixed fixture: existing findMemory ranking, namespace isolation and read-only retrieval', async () => {
  await withFixture(async path => {
    const before = readFileSync(path);
    assert.deepEqual(verifySnapshot(path), { integrity: 'ok', readOnly: true, schemaVersion: 2 });
    const direct = await findMemory(context.query);
    const result = await lookupLandmarks(context, path);
    assert.equal(result.status, 'found');
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(result.candidates.map(n => n.noteId), direct.candidates.filter((n: { isLandmark: boolean }) => n.isLandmark).map((n: { noteId: string }) => n.noteId));
    assert.ok(result.candidates.every(n => n.mapNamespace === identity.mapKey && n.status === 'unverified'));
    assert.equal(result.candidates[0].distance, 0);
    assert.equal(result.candidates[1].headingDifferenceDeg, 2);
    assert.equal(result.candidates[0].latestAssessment?.revision, 2);
    const foreign = await lookupLandmarks({ ...context, mapIdentity: foreignIdentity,
      query: { ...context.query, mapNamespace: foreignIdentity.mapKey } }, path);
    assert.equal(foreign.candidates.length, 1);
    assert.ok(foreign.candidates.every(n => !result.candidates.some(ours => ours.noteId === n.noteId)));
    await assert.rejects(lookupLandmarks({ ...context, query: { ...context.query, mapNamespace: foreignIdentity.mapKey } }, path), /MAP_NAMESPACE_MISMATCH/);
    const ro = new DatabaseSync(path, { readOnly: true });
    try { assert.throws(() => ro.exec('CREATE TABLE forbidden (x INTEGER)'), /readonly/); }
    finally { ro.close(); }
    assert.deepEqual(readFileSync(path), before);
  });
});

test('fixed fixture: MCP callback retains evidence and validates selection of either returned note', async () => {
  await withFixture(async path => {
    const receipts: LandmarkReceipt[] = [];
    const registered = acpTools({ findLandmarks: createLandmarksTool(context, receipts, new AbortController(), path) });
    const tools = rebuildSmokeTools(registered);
    assert.equal(getExecuteByName('findLandmarks'), tools.findLandmarks.execute);
    assert.equal(Object.keys(tools).length, 2);
    const envelope = await registered.findLandmarks.execute({});
    assert.deepEqual(decode(envelope), receipts[0].result);
    const result = receipts[0].result;
    assert.ok(result);
    assert.equal(result.candidates[0].status, 'unverified');
    assert.ok(result.caution.includes('Advisory'));
    for (const index of [0, 1]) assert.equal(validateSelection(JSON.stringify(selection(result, index)), receipts).ok, true);
    assert.equal(summarizeLandmarkEvent({ result: envelope, error: null }, receipts).envelopeMatches, true);
    assert.equal(summarizeLandmarkEvent({ result: envelope, error: 'hidden' }, receipts).envelopeMatches, false);
    assert.equal(summarizeLandmarkEvent({ content: [] }, receipts).envelopeMatches, false);
    assert.equal(summarizeLandmarkEvent({ ...envelope, isError: true }, receipts).envelopeMatches, false);
    assert.deepEqual(validateSelection('prefix {}', receipts), { ok: false, error: 'INVALID_JSON' });
    assert.deepEqual(validateSelection('{}', receipts), { ok: false, error: 'INVALID_SELECTION' });
    for (const change of [
      { noteId: '33333333-3333-4333-8333-333333333333' }, { evidenceNoteIds: ['33333333-3333-4333-8333-333333333333'] },
      { mapNamespace: foreignIdentity.mapKey }, { source: 'fabricated' }, { summary: 'fabricated' },
    ]) assert.deepEqual(validateSelection(JSON.stringify({ ...selection(result), ...change }), receipts), { ok: false, error: 'EVIDENCE_MISMATCH' });
    assert.equal(validateSelection(JSON.stringify({ ...selection(result), advisoryStatus: 'verified' }), receipts).ok, false);
    assert.equal(validateSelection(JSON.stringify({ ...selection(result), x: 42 }), receipts).ok, false);
    const tampered = structuredClone(receipts);
    tampered[0].returnedEnvelope = { content: [] };
    assert.deepEqual(validateSelection(JSON.stringify(selection(result)), tampered), { ok: false, error: 'EVIDENCE_MISMATCH' });
  });
});

test('fixed fixture: explicit empty result, repeated/invalid callback and path failures', async () => {
  await withFixture(async path => {
    const receipts: LandmarkReceipt[] = [];
    const abort = new AbortController();
    const tool = createLandmarksTool({ ...context, query: { ...context.query, x: -30000, y: -30000 } }, receipts, abort, path);
    const result = decode(await tool.execute({}));
    assert.equal(result.status, 'empty');
    assert.deepEqual(result.candidates, []);
    const output = JSON.stringify({ status: 'empty', mapNamespace: identity.mapKey, advisoryStatus: 'unverified',
      evidenceNoteIds: [], explanation: 'No nearby landmark candidates returned.' });
    assert.equal(validateSelection(output, receipts).ok, true);
    await assert.rejects(tool.execute({}), /REPEATED_CALLBACK/);
    assert.equal(abort.signal.aborted, true);
    assert.deepEqual(validateSelection(output, receipts), { ok: false, error: 'CALLBACK_FAILURE' });
    const bad: LandmarkReceipt[] = [];
    await assert.rejects(createLandmarksTool(context, bad, new AbortController(), path).execute({ sql: 'anything' }), /INVALID_TOOL_DATA_OR_ARGUMENTS/);
    assert.equal(bad[0].result, null);
    await assert.rejects(lookupLandmarks(context), /SNAPSHOT_PATH_MISMATCH/);
    const missing = join(dirname(path), 'missing.sqlite');
    process.env.DOOM_MEMORY_DB = missing;
    await assert.rejects(lookupLandmarks(context, missing), /SNAPSHOT_MISSING/);
    assert.equal(existsSync(missing), false);
  });
});

test('entry is inert without exact opt-in; no ACP is launched by imports or tests', async () => {
  assert.equal(typeof LandmarksToolLoopAgent, 'function');
  let launches = 0;
  const launch = async () => { launches++; return 7; };
  for (const args of [[], ['--help'], ['--authorize-acp', 'extra'], ['--live'], ['--authorize-acp=true']])
    assert.equal(await landmarksMain(args, launch, () => {}), args.length === 0 || args[0] === '--help' ? 0 : 2);
  assert.equal(launches, 0);
  assert.equal(await landmarksMain(['--authorize-acp'], launch, () => {}), 7);
  assert.equal(launches, 1, 'Only the injected fake launch was invoked');
});

test('local snapshot integration: real saved observation → findMemory → MCP envelope → validated selection', async t => {
  const png = new URL('.local/real-doom/observation.png', import.meta.url);
  if (!existsSync(snapshotPath) || !existsSync(savedObservationPath) || !existsSync(png)) {
    t.skip('Local snapshot integration requires ignored .local/doom-memory.sqlite and experiment .local/real-doom/observation.{json,png}; fixed-fixture tests still run.');
    return;
  }
  const digest = () => createHash('sha256').update(readFileSync(snapshotPath)).digest('hex');
  const before = digest();
  const metadata = statSync(snapshotPath);
  const directory = readdirSync(dirname(snapshotPath));
  const previous = process.env.DOOM_MEMORY_DB;
  // Default path is worktree-relative to module URL, never the source worktree.
  delete process.env.DOOM_MEMORY_DB;
  try {
    const saved = loadSavedContext();
    assert.equal(saved.mapIdentity.mapKey, 'doom-map:v1:iwad-sha256:1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771:E1M1');
    assert.equal(saved.observationId, 'd4ba38e3-6e53-474e-b77d-0053a43e0dd8');
    assert.deepEqual([saved.query.x, saved.query.y, saved.query.headingDeg], [1056, -3616, 90]);
    const direct = await findMemory(saved.query);
    const receipts: LandmarkReceipt[] = [];
    const envelope = await createLandmarksTool(saved, receipts, new AbortController()).execute({});
    const result = receipts[0].result;
    assert.ok(result);
    assert.deepEqual(decode(envelope), result);
    assert.deepEqual(result.candidates.map(n => n.noteId), direct.candidates.filter((n: { isLandmark: boolean }) => n.isLandmark).map((n: { noteId: string }) => n.noteId));
    assert.deepEqual(result.candidates.map(n => n.noteId), ['9b171d6b-092f-4089-9a0a-996b4a559ffb', '1d3cf84f-8e29-4e40-8c00-87e274aaeefd']);
    assert.ok(result.candidates.every(n => n.status === 'unverified' && n.mapNamespace === saved.mapIdentity.mapKey));
    assert.equal(validateSelection(JSON.stringify(selection(result)), receipts).ok, true);
  } finally {
    if (previous === undefined) delete process.env.DOOM_MEMORY_DB;
    else process.env.DOOM_MEMORY_DB = previous;
    assert.equal(digest(), before, 'Snapshot bytes unchanged');
    assert.equal(statSync(snapshotPath).mtimeMs, metadata.mtimeMs, 'Snapshot mtime unchanged');
    assert.deepEqual(readdirSync(dirname(snapshotPath)), directory, 'No journal or other files created');
  }
});
