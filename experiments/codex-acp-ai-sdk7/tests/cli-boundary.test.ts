import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';
import { MockLanguageModelV4 } from 'ai/test';
import { wrapLanguageModel } from 'ai';
import { createCliProvider, cliSafetyMiddleware, cliFailureCode, rejectCliWarning, type CliProvider } from '../src/cli-provider.ts';
import { closeCliProviders, fenceCliInitialization } from '../src/agent-lifecycle.ts';
import { fixtureStream, cliSettingsWarnings } from './native-fixture.ts';

test('CLI owners construct/close inertly, remain separate, and do not claim an unobserved exit', async () => {
  const abort = new AbortController();
  const a = createCliProvider('/tmp', abort), b = createCliProvider('/tmp', abort);
  assert.notEqual(a, b); assert.notEqual(a.languageModel(), b.languageModel());
  assert.equal(a.languageModel().specificationVersion, 'v4');
  assert.deepEqual(await closeCliProviders([a, b]), [
    'close-returned; child-exit-unverified', 'close-returned; child-exit-unverified',
  ]);
  assert.throws(() => a.assertHealthy(), /CLI_PROVIDER_CLOSED/);
});

test('installed pure image conversion preserves bytes; failed temp writes abort through the warning fence', async t => {
  // Published lazy model, pure conversion only: no initialize/listModels/doStream.
  const abort = new AbortController();
  const provider = createCodexAppServer({ defaultSettings: { logger: {
    debug() {}, info() {}, error() {}, warn: message => rejectCliWarning(abort, message),
  } } });
  const model = provider('synthetic-no-inference');
  assert.ok('preparePrompt' in model && typeof model.preparePrompt === 'function');
  assert.ok('buildUserInput' in model && typeof model.buildUserInput === 'function');
  const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const mapped = model.preparePrompt([{ role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: { type: 'data', data: image } }] }], false);
  assert.equal(mapped.images.length, 1);
  const built = await model.buildUserInput(mapped.promptText, mapped.images);
  try {
    assert.equal(built.tempImagePaths.length, 1);
    assert.deepEqual(new Uint8Array(await readFile(built.tempImagePaths[0])), image);
    assert.ok(built.input.some((part: { type: string }) => part.type === 'localImage'));
  } finally {
    for (const path of built.tempImagePaths) await rm(dirname(path), { recursive: true, force: true });
  }
  // Fail before mkdtemp creates anything; scoped replacement, no persistent files.
  t.mock.method(fs, 'mkdtempSync', () => { throw new Error('PRIVATE_WRITE_ERROR'); });
  syncBuiltinESMExports();
  try {
    await assert.rejects(model.buildUserInput(mapped.promptText, mapped.images), /CLI_IMAGE_WRITE_FAILED/);
    assert.equal(abort.signal.aborted, true);
    assert.equal(cliFailureCode(abort.signal.reason), 'CLI_IMAGE_WRITE_FAILED');
    assert.equal(String(abort.signal.reason).includes('PRIVATE_WRITE_ERROR'), false);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await provider.close(); }
});

test('native startup late resolution/rejection gets a second close and never late inference', async () => {
  for (const rejects of [false, true]) {
    const abort = new AbortController();
    let release!: () => void, entered!: () => void, closes = 0;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const owner: CliProvider = {
      languageModel: () => new MockLanguageModelV4(), assertHealthy() {}, childExitObserved: () => false,
      async initialize() { entered(); await pending; if (rejects) throw new Error('STARTUP_FAILURE'); },
      async close() { closes++; },
    };
    const startup = fenceCliInitialization(owner, abort.signal);
    const rejected = assert.rejects(startup.settled);
    await ready; abort.abort();
    assert.deepEqual(await closeCliProviders([owner], [startup]), ['initialization-pending; cleanup-unverified; child-exit-unverified']);
    release(); await rejected;
    assert.equal(closes, 2);
  }
  const good: CliProvider = { languageModel: () => new MockLanguageModelV4(), initialize: async () => {},
    assertHealthy() {}, close: async () => {}, childExitObserved: () => true };
  const bad = { ...good, close: async () => { throw new Error('PRIVATE_CLOSE_FAILURE'); } };
  assert.deepEqual(await closeCliProviders([bad, good]), [
    'cleanup-failed; child-exit-unverified', 'close-returned; child-exit-observed',
  ]);
});

test('provider-native tool events and warnings fail below Hermes; no SDK host callback is synthesized', async () => {
  for (const part of [
    { type: 'tool-input-end' as const, id: 'native-input' },
    { type: 'tool-call' as const, toolCallId: 'native', toolName: 'executeGuardedDecision', input: '{}' },
    { type: 'tool-result' as const, toolCallId: 'orphan', toolName: 'executeGuardedDecision', result: {} },
    { type: 'stream-start' as const, warnings: [{ type: 'other' as const, message: 'omitted-image' }] },
  ]) {
    const abort = new AbortController();
    const model = wrapLanguageModel({ model: new MockLanguageModelV4({ doStream: async () => fixtureStream([part]) }),
      middleware: cliSafetyMiddleware(abort, () => false, async () => {}) });
    const result = await model.doStream({ prompt: [] });
    const expected = part.type === 'stream-start' ? 'CLI_STREAM_WARNING' : 'CLI_NATIVE_TOOL_EVENT';
    await assert.rejects(result.stream.pipeTo(new WritableStream()), new RegExp(expected));
    assert.equal(abort.signal.aborted, true);
    assert.equal(cliFailureCode(abort.signal.reason), expected);
  }
});

test('omit Hermes empty tools before the actual provider warning mapper; retain fail-closed native declarations', async () => {
  assert.deepEqual(cliSettingsWarnings({ tools: [] }).map(warning => warning.feature), ['tools'],
    'Negative control reproduces the prior unconditional stream-warning cancellation');
  const abort = new AbortController();
  let calls = 0;
  const raw = new MockLanguageModelV4({ doStream: async params => {
    calls++;
    assert.equal(params.tools, undefined);
    assert.deepEqual(cliSettingsWarnings(params), []);
    return fixtureStream([]);
  } });
  const model = wrapLanguageModel({ model: raw, middleware: cliSafetyMiddleware(abort, () => false, async () => {}) });
  const result = await model.doStream({ prompt: [], tools: [] });
  await result.stream.pipeTo(new WritableStream());
  assert.equal(abort.signal.aborted, false);
  await assert.rejects(Promise.resolve(model.doStream({ prompt: [], tools: [
    { type: 'function', name: 'unexpectedNativeTool', inputSchema: { type: 'object' } },
  ] })), /CLI_NATIVE_TOOL_DECLARATION/);
  assert.equal(calls, 1, 'Nonempty native declarations fail before provider invocation');
});

test('warning diagnostics never retain text and preserve prior cancellation precedence', () => {
  const secret = 'PRIVATE_WARNING sk-private /tmp/private';
  const abort = new AbortController();
  assert.throws(() => rejectCliWarning(abort, secret), /CLI_PROVIDER_WARNING/);
  assert.equal(cliFailureCode(abort.signal.reason), 'CLI_PROVIDER_WARNING');
  assert.equal(String(abort.signal.reason).includes(secret), false);
  const stopped = new AbortController();
  const original = new Error(secret);
  stopped.abort(original);
  assert.throws(() => rejectCliWarning(stopped, secret), /CLI_PROVIDER_WARNING/);
  assert.equal(stopped.signal.reason, original);
  assert.equal(cliFailureCode(stopped.signal.reason), null);
});

test('late doStream initialization closes again after both resolution and rejection', async () => {
  for (const rejects of [false, true]) {
    const abort = new AbortController();
    let closed = false, closes = 0, release!: () => void, entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const model = wrapLanguageModel({ model: new MockLanguageModelV4({ doStream: async () => {
      entered(); await pending; if (rejects) throw new Error('STREAM_STARTUP_FAILURE'); return fixtureStream([]);
    } }), middleware: cliSafetyMiddleware(abort, () => closed, async () => { closes++; }) });
    const work = model.doStream({ prompt: [] });
    const rejected = assert.rejects(Promise.resolve(work));
    await ready; closed = true; closes++; abort.abort(); release(); await rejected;
    assert.equal(closes, 2);
  }
});
