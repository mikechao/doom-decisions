import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeTool, hostResultMatches, domainResultMatches, type HostCall } from '../src/native-tools.ts';
import { fixtureStream, textParts, lastToolResult } from './native-fixture.ts';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { createAgentMapIdentity } from '../../app/src/agent-observation.ts';
import {
  consumeDoomStream, createConsultLandmarks, createDoomPlayAgent, DoomStreamError,
  validateParentOutput, type ConsultReceipt,
} from '../src/doom-play-agent.ts';
import { doomPlayMain } from '../src/doom-play-agent-smoke.ts';
import { closeCliProviders } from '../src/agent-lifecycle.ts';
import type { CliProvider } from '../src/cli-provider.ts';
import { createLandmarksAgent } from '../src/landmarks-tool-loop-agent.ts';
import type { LandmarkReceipt, LandmarkResult, SavedContext } from '../src/landmarks-tool.ts';

const mapIdentity = createAgentMapIdentity('a'.repeat(64), 1, 1);
const context: SavedContext = {
  observationId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222',
  tic: 1, mapIdentity,
  query: { mode: 'nearby', mapNamespace: mapIdentity.mapKey, x: 10, y: 20, headingDeg: 90, radius: 64, limit: 3 },
};
const noteId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const found: LandmarkResult = {
  status: 'found', advisoryStatus: 'unverified', caution: 'Synthetic advisory only.', context,
  scope: 'Nearby top 3 before landmark filtering; not an exhaustive map search.',
  candidates: [{ noteId, revision: 1, mapNamespace: mapIdentity.mapKey, anchor: { x: 10, y: 20, headingDeg: 90 },
    source: 'Synthetic historical source', summary: 'An earlier observer asked about orientation.', summaryTruncated: false,
    status: 'unverified', createdAt: '2026-01-01', isLandmark: true, isActiveExploration: false,
    distance: 0, headingDifferenceDeg: 0, nextQuestion: null, latestAssessment: null }],
};

function decode(value: unknown) {
  const wire = z.strictObject({ content: z.tuple([z.strictObject({ type: z.literal('text'), text: z.string() })]) })
    .parse(JSON.parse(JSON.stringify(value)));
  return JSON.parse(wire.content[0].text);
}

// Only the model emits requests; the real SDK owns callback execution/results.
function fakeToolModel(name: string, render: (value: any) => string,
  afterCallback: () => Promise<void> = async () => {}) {
  return new MockLanguageModelV4({ doStream: async options => {
    if (!options.prompt.some(message => message.role === 'tool')) {
      assert.ok(options.tools?.some(tool => tool.type === 'function' && tool.name === name));
      return fixtureStream([{ type: 'tool-call', toolCallId: name, toolName: name, input: '{}' }]);
    }
    const output = lastToolResult(options.prompt, name);
    await afterCallback();
    return fixtureStream(textParts(render(output)));
  } });
}

function childText(value: LandmarkResult) {
  const candidate = value.candidates[0];
  return JSON.stringify(candidate ? {
    status: 'selected', noteId: candidate.noteId, mapNamespace: candidate.mapNamespace, advisoryStatus: 'unverified',
    evidenceNoteIds: [candidate.noteId], source: candidate.source, summary: candidate.summary,
    explanation: 'Advisory lead: this historical question may help orient a later observation; it is unverified.',
  } : { status: 'empty', mapNamespace: value.context.mapIdentity.mapKey, advisoryStatus: 'unverified',
    evidenceNoteIds: [], explanation: 'No nearby landmark candidates returned.' });
}

function parentText(value: { selection: { status: string; noteId?: string } }, reject = false) {
  return JSON.stringify({ objective: 'What observation could test the historical orientation question?',
    recordedEvidence: 'The supplied archived pose is x=10, y=20 at tic 1; no image was supplied.',
    uncertainty: 'Historical observer locations do not establish destinations or current passability.',
    memoryInfluence: { noteId: value.selection.status === 'selected' && !reject ? value.selection.noteId : null,
      explanation: reject ? 'The lead was unhelpful; no historical note influenced this question.' :
        value.selection.status === 'selected' ? 'The historical orientation question motivated this question.' : 'No historical candidates were returned.' } });
}

function fixture(options: { empty?: boolean; renderChild?: (value: LandmarkResult) => string;
  renderParent?: (value: any) => string; afterChild?: () => Promise<void> } = {}) {
  const abort = new AbortController();
  const landmarks: LandmarkReceipt[] = [];
  const consults: ConsultReceipt[] = [];
  const requests = { parent: 0, child: 0 };
  const result = structuredClone(options.empty ? { ...found, status: 'empty', candidates: [] } : found);
  const find = {
    description: 'In-memory fixture only', inputSchema: z.strictObject({}),
    execute: async (input: unknown) => {
      abort.signal.throwIfAborted();
      assert.deepEqual(input, {});
      assert.equal(landmarks.length, 0);
      const envelope = { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      landmarks.push({ ordinal: 1, arguments: {}, result: structuredClone(result),
        returnedEnvelope: structuredClone(envelope), error: null });
      return envelope;
    },
  };
  const childCalls: HostCall[] = [], parentCalls: HostCall[] = [];
  const childTools = { findLandmarks: nativeTool('findLandmarks', find, childCalls, abort.signal) };
  const childModel = fakeToolModel('findLandmarks', options.renderChild ?? childText, options.afterChild);
  const child = createLandmarksAgent(childModel, childTools, () => { if (++requests.child > 2) throw new Error('REPEATED'); }, childCalls);
  const consult = createConsultLandmarks(context, child, landmarks, consults, abort);
  const parentTools = { consultLandmarks: nativeTool('consultLandmarks', consult, parentCalls, abort.signal) };
  const parentModel = fakeToolModel('consultLandmarks', options.renderParent ?? parentText);
  const parent = createDoomPlayAgent(parentModel, parentTools, () => { if (++requests.parent > 2) throw new Error('REPEATED'); }, 'archived', false, parentCalls);
  const cleanupCalls = [0, 0];
  const closed = [false, false];
  const owners: CliProvider[] = [parentModel, childModel].map((model, index) => ({
    languageModel: () => model, initialize: async () => {}, assertHealthy() {}, childExitObserved: () => false,
    async close() { cleanupCalls[index]++; closed[index] = true; },
  }));
  async function run() {
    try {
      const stream = await parent.stream({ prompt: `ARCHIVED context=${JSON.stringify(context)}`, abortSignal: abort.signal });
      const consumed = await consumeDoomStream(stream, abort.signal,
        (output, name, ordinal, evidence) => hostResultMatches(parentCalls, output, name, ordinal, evidence) && domainResultMatches(output, consults[0]?.envelope ?? null), 'consultLandmarks');
      assert.equal(await stream.finishReason, 'stop');
      assert.equal(await stream.rawFinishReason, 'completed');
      return { consumed, output: validateParentOutput(await stream.text, consults, landmarks, abort.signal) };
    } finally { await closeCliProviders(owners); }
  }
  return { run, abort, consult, child, parent, childTools, parentTools, childModel, parentModel,
    consults, landmarks, requests, cleanupCalls, owners, closed };
}

test('real SDK parent → consult → unchanged child → in-memory find receipt, both streams drained', async () => {
  const f = fixture();
  assert.notEqual(f.parentModel, f.childModel);
  assert.notEqual(f.owners[0], f.owners[1], 'Simulated independent CLI owners');
  assert.deepEqual(Object.keys(f.parentTools).sort(), ['consultLandmarks']);
  assert.deepEqual(Object.keys(f.childTools).sort(), ['findLandmarks']);
  assert.equal(f.childModel.doStreamCalls.length + f.parentModel.doStreamCalls.length, 0, 'Construction is inert');
  const { consumed, output } = await f.run();
  assert.equal(consumed.drained, true);
  assert.equal(f.consults[0].childStream?.drained, true);
  assert.equal(consumed.finishes, 1);
  assert.equal(f.consults[0].childStream?.finishes, 1);
  assert.equal(consumed.toolResults, 1);
  assert.equal(consumed.toolCalls, 1);
  assert.equal(f.consults[0].childStream?.toolResults, 1);
  assert.equal(f.consults[0].childStream?.toolCalls, 1);
  assert.deepEqual(f.requests, { parent: 2, child: 2 });
  assert.equal(f.consults.length, 1);
  assert.equal(f.landmarks.length, 1);
  assert.deepEqual(decode(f.consults[0].envelope), f.consults[0].result);
  assert.deepEqual(output.historicalMemory, { noteId, mapNamespace: mapIdentity.mapKey,
    source: found.candidates[0].source, summary: found.candidates[0].summary, advisoryStatus: 'unverified' });
  assert.equal(output.interpretation.memoryInfluence.noteId, noteId);
  assert.deepEqual(f.cleanupCalls, [1, 1]);
  assert.deepEqual(f.closed, [true, true]);
});

test('duplicate SDK results fail closed against the completed host callback', async () => {
  const f = fixture();
  await f.run();
  for (const name of ['consultLandmarks', 'findLandmarks'] as const) {
    const output = name === 'consultLandmarks' ? f.consults[0].result : f.landmarks[0].result;
    const result = { type: 'tool-result', toolCallId: name, toolName: name, output };
    const stream = { fullStream: (async function* () {
      yield { type: 'tool-call', toolCallId: name, toolName: name, input: {} };
      yield result; yield result;
      yield { type: 'finish-step' }; yield { type: 'finish' };
    })() };
    await assert.rejects(consumeDoomStream(stream, f.abort.signal, value => value === output, name),
      error => error instanceof DoomStreamError && error.message === 'DUPLICATE_TOOL_RESULT');
  }
  assert.equal(f.consults.length, 1);
  assert.equal(f.landmarks.length, 1);
});

test('tool-event correlation rejects orphan, mismatched, missing and duplicate calls', async () => {
  const call = { type: 'tool-call', toolCallId: 'expected-id', toolName: 'consultLandmarks', input: {} };
  const result = { type: 'tool-result', toolCallId: 'expected-id', toolName: 'consultLandmarks', output: {} };
  const tail = [{ type: 'finish-step' }, { type: 'finish' }];
  for (const [events, code] of [
    [[result], 'TOOL_RESULT_MISMATCH'],
    [[call, { ...result, toolCallId: 'other' }], 'TOOL_RESULT_MISMATCH'],
    [[call, { ...result, toolName: 'other' }], 'TOOL_RESULT_MISMATCH'],
    [[{ ...call, toolName: 'findLandmarks' }], 'TOOL_CALL_MISMATCH'],
    [[{ ...call, providerExecuted: true }], 'TOOL_CALL_MISMATCH'],
    [[call, call], 'DUPLICATE_TOOL_CALL'],
    [[call], 'INCOMPLETE_STREAM'],
    [[], 'INCOMPLETE_STREAM'],
  ] as const) {
    const stream = { fullStream: (async function* () { yield* events; yield* tail; })() };
    await assert.rejects(consumeDoomStream(stream, new AbortController().signal, () => true, 'consultLandmarks'),
      error => error instanceof DoomStreamError && error.message === code);
  }
});

test('empty and declined landmarks produce no historical attribution', async () => {
  for (const options of [{ empty: true }, { renderParent: (value: any) => parentText(value, true) }]) {
    const f = fixture(options);
    const { output } = await f.run();
    assert.equal(output.historicalMemory, null);
    assert.equal(output.interpretation.memoryInfluence.noteId, null);
    assert.deepEqual(f.requests, { parent: 2, child: 2 });
    assert.equal(f.consults[0].childStream?.drained, true);
  }
});

test('invalid child JSON or fabricated provenance fails closed, never becomes empty', async () => {
  const variants = [() => '{', ...['noteId', 'mapNamespace', 'source', 'summary'].map(field => (value: LandmarkResult) => {
    const selected = JSON.parse(childText(value));
    selected[field] = field === 'noteId' ? otherId : 'fabricated';
    return JSON.stringify(selected);
  })];
  for (const renderChild of variants) {
    const f = fixture({ renderChild });
    await assert.rejects(f.run());
    assert.equal(f.consults[0].result, null);
    assert.equal(f.consults[0].envelope, null);
    assert.equal(f.consults[0].error, 'CONSULT_FAILED');
    assert.deepEqual(f.cleanupCalls, [1, 1]);
  }
});

test('parent cannot invent attribution or parent-restate provenance; receipt tampering is rejected', async () => {
  for (const empty of [false, true]) {
    const f = fixture({ empty, renderParent: value => {
      const output = JSON.parse(parentText(value));
      output.memoryInfluence.noteId = otherId;
      return JSON.stringify(output);
    } });
    await assert.rejects(f.run(), /ATTRIBUTION_MISMATCH/);
  }
  for (const renderParent of [() => '{', (value: any) => {
    const output = JSON.parse(parentText(value));
    output.memoryInfluence.source = 'parent-rewritten provenance';
    return JSON.stringify(output);
  }]) await assert.rejects(fixture({ renderParent }).run(), /INVALID_PARENT_OUTPUT/);
  const f = fixture();
  const { output } = await f.run();
  f.consults[0].result!.selection.mapNamespace = 'changed';
  assert.throws(() => validateParentOutput(JSON.stringify(output.interpretation), f.consults, f.landmarks, f.abort.signal), /INVALID_CONSULT_RECEIPT/);
});

test('closure-owned abort rejects late child output with no callback options, cleans both simulated owners once', async () => {
  let notifyEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { notifyEntered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ afterChild: async () => { notifyEntered(); await pending; } });
  // The domain callback owns cancellation even without SDK callback options.
  const work = f.consult.execute({}).finally(() => closeCliProviders(f.owners));
  await entered;
  assert.equal(f.landmarks.length, 1);
  f.abort.abort();
  release();
  await assert.rejects(work, /CANCELLED/);
  assert.equal(f.consults[0].result, null);
  assert.equal(f.consults[0].envelope, null);
  assert.deepEqual(f.cleanupCalls, [1, 1]);
  assert.equal(f.requests.child, 2);
  assert.equal(f.childModel.doStreamCalls[0].abortSignal?.aborted, true);
});

test('native parent schemas reject extra inputs and callback repetition fails closed', async () => {
  const f = fixture();
  assert.ok(f.parentTools.consultLandmarks.inputSchema);
  await assert.rejects(f.consult.execute({ sql: 'forbidden' }), /CONSULT_FAILED/);
  assert.equal(f.requests.child, 0);
  const repeated = fixture();
  await repeated.consult.execute({});
  await assert.rejects(repeated.consult.execute({}), /CONSULT_FAILED/);
  assert.equal(repeated.requests.child, 2);
});

test('CLI is inert without exact opt-in; fake launch only', async () => {
  let launches = 0;
  const launch = async () => { launches++; return 7; };
  for (const args of [[], ['--help'], ['--authorize-cli', 'extra'], ['--live'], ['--authorize-cli=true']])
    assert.equal(await doomPlayMain(args, launch, () => {}), args.length === 0 || args[0] === '--help' ? 0 : 2);
  assert.equal(launches, 0);
  assert.equal(await doomPlayMain(['--authorize-cli'], launch, () => {}), 7);
  assert.equal(launches, 1, 'Only an in-memory injected launch ran');
});


test('multi-tool stream correlates each accepted call and rejects duplicates/orphans/name swaps', async () => {
  const signal = new AbortController().signal;
  const call = (id: string, name: string) => ({ type: 'tool-call', toolCallId: id, toolName: name, input: {} });
  const result = (id: string, output: string) => ({ type: 'tool-result', toolCallId: id, toolName: output, output });
  const first = call('c1', 'consultLandmarks'), second = call('c2', 'executeGuardedDecision');
  const a = result('c1', 'consultLandmarks'), b = result('c2', 'executeGuardedDecision');
  const consume = (events: ReturnType<typeof call | typeof result>[]) => consumeDoomStream({ fullStream: (async function* () {
    yield* events; yield { type: 'finish-step' }; yield { type: 'finish' };
  })() }, signal, (output, name, ordinal) => output === name && ordinal === 0, ['consultLandmarks', 'executeGuardedDecision']);
  assert.equal((await consume([first, a, second, b])).drained, true);
  for (const events of [[first, a, second, b, b], [first, a, second, result('orphan', 'executeGuardedDecision')],
    [first, a, second, result('c2', 'consultLandmarks')], [first, a, first], [first, a, call('c2', 'doom_decide')]])
    await assert.rejects(consume(events), error => error instanceof DoomStreamError);
});

test('native host correlation binds SDK ID, name, input and output to the actual callback', async () => {
  const signal = new AbortController().signal;
  const calls: HostCall[] = [{ toolCallId: 'sdk-owned', toolName: 'consultLandmarks', input: {}, output: { selection: 'synthetic' }, settled: true }];
  const call = { type: 'tool-call', toolCallId: 'sdk-owned', toolName: 'consultLandmarks', input: {} };
  const result = { type: 'tool-result', toolCallId: 'sdk-owned', toolName: 'consultLandmarks', output: calls[0].output };
  const consume = (first: typeof call, last: typeof result) => consumeDoomStream({ fullStream: (async function* () {
    yield first; yield last; yield { type: 'finish-step' }; yield { type: 'finish' };
  })() }, signal, (output, name, ordinal, evidence) => hostResultMatches(calls, output, name, ordinal, evidence), 'consultLandmarks');
  assert.equal((await consume(call, result)).drained, true);
  await assert.rejects(consume({ ...call, input: { extra: true } }, result), /TOOL_ENVELOPE_MISMATCH/);
  await assert.rejects(consume({ ...call, toolCallId: 'forged' }, { ...result, toolCallId: 'forged' }), /TOOL_ENVELOPE_MISMATCH/);
  await assert.rejects(consume(call, { ...result, output: { selection: 'invented' } }), /TOOL_ENVELOPE_MISMATCH/);
});

test('one parent inference step cannot dispatch both consultation and gameplay, even after synchronous consultation settles', async () => {
  const calls: HostCall[] = [], abort = new AbortController();
  let mutations = 0;
  const callback = { description: 'Synthetic presentation only', inputSchema: z.strictObject({}),
    execute: async () => ({ content: [{ type: 'text' as const, text: '{"ok":true}' }] }) };
  const consult = nativeTool('consultLandmarks', callback, calls, abort.signal);
  const action = nativeTool('executeGuardedDecision', { ...callback, execute: async () => { mutations++; return callback.execute(); } }, calls, abort.signal);
  assert.ok(consult.execute && action.execute);
  const options = { toolCallId: 'first', messages: [], abortSignal: abort.signal, context: {} };
  await consult.execute({}, options);
  await assert.rejects(Promise.resolve(action.execute({}, { ...options, toolCallId: 'second' })), /REPEATED_OR_OVERLAPPING_HOST_CALL/);
  assert.equal(mutations, 0);
});
