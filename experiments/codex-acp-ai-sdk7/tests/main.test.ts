import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmdirSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { getExecuteByName, ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME as dynamicName } from '@mcpc-tech/acp-ai-provider';
import { MockLanguageModelV3 } from 'ai/test';
import { executeAgentOperation } from '../../../scripts/doom-agent-client.ts';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createAgentMapIdentity } from '../../../app/src/agent-observation.ts';
import { main, runMain, type MainPorts } from '../src/main.ts';
import { createLandmarksTool, type LandmarkResult, type SavedContext } from '../src/landmarks-tool.ts';

const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
// Real, synthetic 640x400 RGBA PNG. No game assets, archives or database files.
function syntheticPng() {
  function chunk(name: string, bytes: Buffer) {
    const data = Buffer.concat([Buffer.from(name), bytes]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 8);
    result.writeUInt32BE(bytes.length); data.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(640); header.writeUInt32BE(400, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(400 * 2561))), chunk('IEND', Buffer.alloc(0))]);
}
const image = syntheticPng();
const identity = createAgentMapIdentity('b'.repeat(64), 1, 1);
const empty = (context: SavedContext): LandmarkResult => ({ status: 'empty', advisoryStatus: 'unverified',
  caution: 'Synthetic historical data only.', context, candidates: [],
  scope: 'Nearby top 3 before landmark filtering; not an exhaustive map search.' });
const noteId = '33333333-3333-4333-8333-333333333333';

function fakeModel(name: 'findLandmarks' | 'consultLandmarks', options: {
  input?: (prompt: unknown) => void; after?: () => Promise<void>; attributed?: boolean;
} = {}) {
  return new MockLanguageModelV3({ doStream: async input => {
    options.input?.(input.prompt);
    const execute = getExecuteByName(name);
    assert.ok(execute);
    const envelope = CallToolResultSchema.parse(JSON.parse(JSON.stringify(await execute({}))));
    const block = envelope.content[0];
    assert.ok(block.type === 'text');
    const result = JSON.parse(block.text);
    const text = JSON.stringify(name === 'findLandmarks' ? result.candidates.length ? {
      status: 'selected', noteId, mapNamespace: result.context.mapIdentity.mapKey, advisoryStatus: 'unverified',
      evidenceNoteIds: [noteId], source: result.candidates[0].source, summary: result.candidates[0].summary,
      explanation: 'Advisory lead: a historical question may be useful; passability remains unverified.',
    } : {
      status: 'empty', mapNamespace: result.context.mapIdentity.mapKey, advisoryStatus: 'unverified',
      evidenceNoteIds: [], explanation: 'No nearby landmark candidates returned.',
    } : {
      objective: 'Does another perspective clarify the visible boundary?',
      recordedEvidence: 'A synthetic image and host-verified telemetry were supplied.',
      uncertainty: 'Visibility does not establish passability; memory is historical.',
      memoryInfluence: { noteId: options.attributed ? noteId : null,
        explanation: options.attributed ? 'The historical question influenced this objective.' : 'No applicable historical memory influenced the objective.' },
    });
    await options.after?.();
    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'tool-call', toolCallId: name, toolName: dynamicName,
        input: JSON.stringify({ toolCallId: name, toolName: `mcp.acp-ai-sdk-tools.${name}`, args: {} }), providerExecuted: true });
      controller.enqueue({ type: 'tool-result', toolCallId: name, toolName: dynamicName, result: JSON.parse(JSON.stringify(envelope)) });
      controller.enqueue({ type: 'text-start', id: name });
      controller.enqueue({ type: 'text-delta', id: name, delta: text });
      controller.enqueue({ type: 'text-end', id: name });
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      } });
      controller.close();
    } }) };
  } });
}

function fixture(attributed = false) {
  const root = mkdtempSync(join(tmpdir(), 'doom-main-test-'));
  const ids = { pageId: randomUUID(), epoch: randomUUID(), sessionId: randomUUID(), observationId: randomUUID() };
  const operations: string[] = [], contexts: SavedContext[] = [], directories: string[] = [], removed: string[] = [];
  let staleCommand = false;
  const abort = new AbortController();
  const observation = {
    observationId: ids.observationId, sessionId: ids.sessionId, tic: 43, phase: 'ready', mapIdentity: identity,
    frame: { tic: 43, nativeSha256: 'c'.repeat(64), canvasSha256: 'c'.repeat(64) },
    counters: { gametic: 43, leveltime: 43, render: 44, frame: 44 },
    telemetry: { health: 100, x: -123 * 65536, y: 456 * 65536, angle: 1073741824,
      weaponId: null, bullets: null, shells: null, cells: null, rockets: null, readyWeapon: null, ammo: null },
    facingProbe: null, previousAction: null,
    png: `data:image/png;base64,${image.toString('base64')}`, pngSha256: hash(image),
    revision: 0, run: null,
    configuration: { instructionTemplate: 'Human settings {{tics}}.', tics: 6, includeReadyWeapon: true,
      includeAmmo: true, includeHealth: true, includeFacingProbe: true, includePreviousAction: true },
  };
  const transport: typeof fetch = async (url, init) => {
    const op = String(url).split('/').at(-1)!;
    operations.push(op);
    const command = JSON.parse(String(init?.body));
    if (op === 'attach') return Response.json({ pageId: ids.pageId, epoch: ids.epoch, ownerId: command.ownerId });
    assert.equal(op, 'observe', 'No gameplay, settings, revoke, detach or Stop operation is allowed');
    assert.equal(command.pageId, ids.pageId); assert.equal(command.epoch, ids.epoch);
    assert.notEqual(command.commandId, ids.observationId, 'Transport and observation identities are independent');
    return Response.json({ pageId: ids.pageId, epoch: ids.epoch,
      commandId: staleCommand ? randomUUID() : command.commandId, observation });
  };
  const models = [fakeModel('consultLandmarks', { attributed }), fakeModel('findLandmarks')];
  const owners: { id: string | null; cleanups: number; inits: number }[] = [];
  const ports: MainPorts = {
    attach: () => executeAgentOperation({ op: 'attach' }, { transport, temporaryRoot: root }),
    observe: leaseFile => executeAgentOperation({ op: 'observe', leaseFile }, { transport }),
    readPng: (path, signal) => readFile(path, { signal }),
    makeDirectory() { const path = mkdtempSync(join(root, 'acp-')); directories.push(path); return path; },
    removeDirectory(path) { rmdirSync(path); removed.push(path); },
    createProvider() {
      const model = models[owners.length];
      const owner = { id: null as string | null, cleanups: 0, inits: 0 }; owners.push(owner);
      return { languageModel: () => model, getSessionId: () => owner.id,
        initSession: async () => { owner.inits++; owner.id = `fake-session-${owners.indexOf(owner)}`; },
        cleanup: () => { owner.cleanups++; owner.id = null; } };
    },
    lookup: async context => {
      contexts.push(structuredClone(context));
      const result = empty(context);
      if (attributed) {
        result.status = 'found';
        result.candidates.push({ noteId, revision: 2, mapNamespace: context.mapIdentity.mapKey,
          anchor: { x: -123, y: 456, headingDeg: 90 }, source: 'Host historical attribution', summary: 'A historical question.',
          summaryTruncated: false, nextQuestion: null, latestAssessment: null, status: 'unverified', createdAt: '2026-01-01',
          isLandmark: true, isActiveExploration: true, distance: 0, headingDifferenceDeg: 0 });
      }
      return result;
    },
  };
  return { ports, abort, observation, operations, contexts, owners, models, directories, removed,
    staleCommand: () => { staleCommand = true; }, destroy: () => rm(root, { recursive: true, force: true }) };
}

test('live main: typed attach → one verified PNG → real SDK nested agents → validated advisory; retained lease', async () => {
  for (const attributed of [false, true]) {
    const f = fixture(attributed);
    try {
      const report = await runMain(f.ports, f.abort.signal);
      assert.equal(report.outcome, attributed ? 'completed' : 'empty');
      assert.deepEqual(f.operations, ['attach', 'observe']);
      assert.equal(report.lease.state, 'held');
      assert.ok(report.lease.leaseFile);
      await readFile(report.lease.leaseFile); // Process cleanup deliberately retains the lease receipt.
      assert.match(report.operatorInstruction, /Press Stop Agent.*before another attach/);
      assert.deepEqual(report.sdkRequests, { parent: 1, child: 1 });
      assert.deepEqual(report.callbacks, { consult: 1, find: 1 });
      assert.equal(report.parentStream?.drained, true); assert.equal(report.childStream?.drained, true);
      assert.ok(report.result?.interpretation.objective);
      assert.ok(report.result?.interpretation.uncertainty);
      assert.equal(report.result?.historicalMemory?.source ?? null, attributed ? 'Host historical attribution' : null);
      assert.deepEqual(f.contexts[0], { observationId: f.observation.observationId, sessionId: f.observation.sessionId,
        tic: 43, mapIdentity: identity,
        query: { mode: 'nearby', mapNamespace: identity.mapKey, x: -123, y: 456, headingDeg: 90, radius: 128, limit: 3 } });
      assert.equal(report.source?.pngSha256, hash(image));
      assert.deepEqual(f.owners.map(owner => owner.cleanups), [1, 1]);
      assert.deepEqual(f.removed, f.directories);
      const prompt = f.models[0].doStreamCalls[0].prompt;
      const user = prompt.find(message => message.role === 'user');
      assert.ok(user && user.role === 'user');
      const file = user.content.find(part => part.type === 'file');
      assert.ok(file && file.type === 'file');
      assert.equal(file.mediaType, 'image/png'); assert.ok(file.data instanceof Uint8Array); assert.equal(hash(file.data), hash(image));
      assert.ok(JSON.stringify(prompt).includes('fresh browser-verified'));
      // The installed provider's pure conversion emits the exact inline bytes as
      // an ACP image block. No private process/client code is executed.
      const source = readFileSync(new URL('../node_modules/@mcpc-tech/acp-ai-provider/index.mjs', import.meta.url), 'utf8');
      const start = source.indexOf('var ROLE_PREFIXES ='), end = source.indexOf('function extractACPTools(', start);
      assert.ok(start > 0 && end > start && end - start < 6000);
      const convert = runInNewContext(`${source.slice(start, end)}\nconvertAiSdkMessagesToAcp`, {
        Uint8Array, extractBase64Data: (value: string) => value.includes(',') ? value.split(',')[1] : value,
        convertUint8ArrayToBase64: (value: Uint8Array) => Buffer.from(value).toString('base64'),
      });
      for (const fresh of [true, false]) {
        const blocks = structuredClone(convert({ prompt }, fresh));
        assert.deepEqual(blocks.find((block: { type: string }) => block.type === 'image'),
          { type: 'image', mimeType: 'image/png', data: image.toString('base64') });
      }
    } finally { await f.destroy(); }
  }
});

test('invalid/missing image, stale receipt and foreign ownership fail before ACP startup; lease retained', async () => {
  for (const fault of ['hash', 'missing', 'frame', 'epoch', 'stale-command', 'active-run', 'map'] as const) {
    const f = fixture();
    try {
      if (fault === 'hash') f.observation.pngSha256 = 'd'.repeat(64);
      if (fault === 'missing') f.ports.readPng = async () => { throw new Error('missing'); };
      if (fault === 'frame') f.observation.frame.tic--;
      if (fault === 'stale-command') f.staleCommand();
      if (fault === 'map') f.observation.mapIdentity = { ...identity, mapKey: 'unverified:shareware-doom1-e1m1' };
      if (fault === 'epoch' || fault === 'active-run') {
        const observe = f.ports.observe;
        f.ports.observe = async (...args) => {
          const result = await observe(...args);
          return fault === 'epoch' ? { ...result, epoch: randomUUID() } : {
            ...result, run: { runId: randomUUID(), active: true, limit: 1, reserved: 0, sdkInvoked: 0, remaining: 1 },
          };
        };
      }
      const report = await runMain(f.ports, f.abort.signal);
      assert.equal(report.outcome, 'failed'); assert.equal(report.result, null);
      assert.equal(report.lease.state, 'held');
      assert.deepEqual(report.sdkRequests, { parent: 0, child: 0 });
      assert.ok(f.owners.every(owner => owner.inits === 0 && owner.cleanups === 1));
      assert.deepEqual(f.removed, f.directories); assert.deepEqual(f.operations, ['attach', 'observe']);
    } finally { await f.destroy(); }
  }
});

test('lost or late attach is possibly held; cancellation never accepts late completion', async () => {
  for (const late of [false, true]) {
    const f = fixture();
    try {
      const attach = f.ports.attach;
      let release!: () => void, entered!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      f.ports.attach = async signal => {
        const lease = await attach(signal); entered();
        if (!late) throw new Error('lost acknowledgment');
        await waiting; return lease;
      };
      const work = runMain(f.ports, f.abort.signal);
      await started;
      if (late) f.abort.abort();
      const report = await work, before = JSON.stringify(report);
      assert.equal(report.lease.state, 'possibly-held'); assert.equal(report.result, null);
      assert.deepEqual(f.operations, ['attach']);
      assert.deepEqual(f.owners.map(owner => owner.cleanups), [1, 1]);
      release(); await new Promise(resolve => setImmediate(resolve));
      assert.equal(JSON.stringify(report), before);
      assert.deepEqual(f.operations, ['attach']); assert.deepEqual(f.removed, f.directories);
    } finally { await f.destroy(); }
  }
});

test('pending initialization gets immediate and post-settlement cleanup with no late parent inference', async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const create = f.ports.createProvider;
  f.ports.createProvider = cwd => {
    const provider = create(cwd);
    if (f.owners.length === 2) {
      const initialize = provider.initSession;
      provider.initSession = async (...args) => { entered(); await waiting; return initialize(...args); };
    }
    return provider;
  };
  try {
    const work = runMain(f.ports, f.abort.signal);
    await started; f.abort.abort();
    const report = await work, before = JSON.stringify(report);
    assert.equal(report.lease.state, 'held'); assert.equal(report.result, null);
    assert.match(report.cleanup[1], /initialization-pending; cleanup-unverified/);
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.owners.map(owner => owner.cleanups), [1, 2]);
    assert.ok(f.owners.every(owner => owner.id === null));
    assert.deepEqual(report.sdkRequests, { parent: 0, child: 0 });
    assert.equal(JSON.stringify(report), before);
  } finally { release(); await f.destroy(); }
});

test('late parent output cannot become accepted advice after cancellation', async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.models[0] = fakeModel('consultLandmarks', { after: async () => { entered(); await waiting; } });
  try {
    const work = runMain(f.ports, f.abort.signal);
    await started; f.abort.abort();
    const report = await work, before = JSON.stringify(report);
    assert.equal(report.result, null); assert.equal(report.outcome, 'failed');
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(JSON.stringify(report), before);
    assert.deepEqual(f.operations, ['attach', 'observe']);
    assert.deepEqual(f.owners.map(owner => owner.cleanups), [1, 1]);
  } finally { release(); await f.destroy(); }
});

test('host landmark callback rejects cross-IWAD candidates even with a matching context', async () => {
  const context: SavedContext = { observationId: randomUUID(), sessionId: randomUUID(), tic: 43, mapIdentity: identity,
    query: { mode: 'nearby', mapNamespace: identity.mapKey, x: 0, y: 0, headingDeg: 0, radius: 128, limit: 3 } };
  const f = fixture(true);
  try {
    const result = await f.ports.lookup(context);
    result.candidates[0].mapNamespace = createAgentMapIdentity('a'.repeat(64), 1, 1).mapKey;
    const tool = createLandmarksTool(context, [], new AbortController(), undefined, async () => result);
    await assert.rejects(tool.execute({}), /LOOKUP_FAILURE/);
  } finally { await f.destroy(); }
});

test('main CLI default/help/malformed flags are inert; exact opt-in uses injected fake launch only', async () => {
  let calls = 0;
  const launch = async () => { calls++; return 7; };
  for (const args of [[], ['--help'], ['--live'], ['--authorize-live-observation-acp', 'extra']])
    assert.equal(await main(args, launch, () => {}), args.length === 0 || args[0] === '--help' ? 0 : 2);
  assert.equal(calls, 0);
  assert.equal(await main(['--authorize-live-observation-acp'], launch, () => {}), 7);
  const guard = `import childProcess from 'node:child_process';
import sqlite from 'node:sqlite';
import { syncBuiltinESMExports } from 'node:module';
const forbidden = () => { throw new Error('FORBIDDEN_SIDE_EFFECT'); };
globalThis.fetch = forbidden;
for (const key of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) childProcess[key] = forbidden;
sqlite.DatabaseSync = class { constructor() { forbidden(); } };
syncBuiltinESMExports();`;
  for (const args of [[], ['--help']]) {
    const process = spawnSync(globalThis.process.execPath, ['--experimental-strip-types', '--import',
      `data:text/javascript,${encodeURIComponent(guard)}`,
      new URL('../src/main.ts', import.meta.url).pathname, ...args], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(process.status, 0); assert.match(process.stdout, /Inert: no attach, SQLite open or ACP startup/);
    assert.match(process.stdout, /Press Stop Agent/);
  }
});
