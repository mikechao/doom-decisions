import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { hermesToolMiddleware } from '@ai-sdk-tool/parser';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';
import { ToolTrace } from '../src/tool-trace.ts';
import { cliSafetyMiddleware } from '../src/cli-provider.ts';
import { createDoomPlayAgent } from '../src/doom-play-agent.ts';
import { consumeDoomStream, DoomStreamError } from '../src/agent-stream.ts';
import { nativeTool, type HostCall } from '../src/native-tools.ts';
import { decisionGuidance } from '../src/guarded-decision.ts';
import { fixtureStream, textParts, cliSettingsWarnings } from './native-fixture.ts';

const secret = 'CONSPICUOUS_PRIVATE sk-test-secret /private/test-path';
const guidance = { objective: secret, uncertainty: secret };
const markup = `<tool_call>${JSON.stringify({ name: 'executeGuardedDecision', arguments: guidance })}</tool_call>`;

// Bounded extraction of installed pure conversion only; no transport, App Server,
// private-method override, dependency patch or copied production converter.
const source = readFileSync(new URL('../node_modules/ai-sdk-provider-codex-cli/dist/index.js', import.meta.url), 'utf8');
const slice = (start: string, end: string) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a > 0 && b > a && b - a < 14000);
  return source.slice(a, b);
};
const conversion = runInNewContext(slice('function normalizeItemType(', 'function mapTool(') +
  slice('function createNotificationHandlers(', 'function createServerRequestHandlers(') +
  slice('var AppServerStreamEmitter = class', '// src/app-server/stream/turn-stream-controller.ts') +
  ';({createNotificationHandlers,AppServerStreamEmitter})');
function notifications(mode: string): LanguageModelV4StreamPart[] {
  const parts: LanguageModelV4StreamPart[] = [];
  const emitter = new conversion.AppServerStreamEmitter({ enqueue: (part: LanguageModelV4StreamPart) => parts.push(part) }, { includeRawChunks: true });
  const handlers = conversion.createNotificationHandlers({ isSameTurn: () => true, textItemIdsWithDelta: new Set(), emitter });
  const send = (method: string, params: object) => { emitter.emitRaw(method, params); handlers[method](params); };
  const delta = () => send('item/agentMessage/delta', { itemId: secret, delta: mode === 'double-notifications' ? markup.repeat(2) : markup, private: secret });
  const completed = () => send('item/completed', { item: { type: 'agentMessage', id: secret, text: markup }, private: secret });
  if (mode === 'repeat-completion') { completed(); completed(); }
  else if (mode === 'repeat-delta') { delta(); delta(); completed(); }
  else { delta(); completed(); }
  parts.push({ type: 'text-end', id: secret });
  return parts;
}

test('bounded parent trace at installed SDK → Hermes → pure CLI conversion seam', async t => {
  for (const mode of ['one', 'sequential', 'double', 'double-chunked', 'double-notifications', 'normal-notifications', 'repeat-completion', 'repeat-delta']) await t.test(mode, async () => {
    const trace = new ToolTrace(), abort = new AbortController(), calls: HostCall[] = [];
    abort.signal.addEventListener('abort', () => trace.abort(), { once: true });
    let requests = 0, begun = 0, forwarded = false;
    const double = mode.startsWith('double') || mode.startsWith('repeat');
    const tools = { executeGuardedDecision: nativeTool('executeGuardedDecision', {
      description: secret, inputSchema: decisionGuidance,
      secondReady: () => mode === 'sequential' && begun === 1,
      project: output => ({ type: 'content', value: [{ type: 'text', text: JSON.stringify(output) }] }),
      execute: async () => {
        begun++;
        if (double) await new Promise<void>(resolve => abort.signal.addEventListener('abort', () => resolve(), { once: true }));
        return { content: [{ type: 'text', text: JSON.stringify({ synthetic: secret }) }] };
      },
    }, calls, abort.signal, trace) };
    const provider = createCodexAppServer();
    const cli = provider('synthetic-no-inference');
    const endpoint = new MockLanguageModelV4({ doStream: async params => {
      const step = requests++;
      assert.equal(params.includeRawChunks, true); assert.equal(params.tools, undefined);
      assert.deepEqual(cliSettingsWarnings(params), []);
      const mapped = (cli as any).preparePrompt(params.prompt, false);
      assert.equal(mapped.warnings.length, 0);
      const built = await (cli as any).buildUserInput(mapped.promptText, mapped.images);
      assert.equal(built.tempImagePaths.length, 0);
      if (mode === 'sequential' && step === 1) {
        assert.equal(begun, 1); assert.ok(mapped.promptText.includes('<tool_response>')); forwarded = true;
      }
      if (step > 0) return fixtureStream(textParts(mode === 'sequential' && step === 1 ? markup : secret));
      if (mode.includes('notifications') || mode.startsWith('repeat')) return fixtureStream(notifications(mode));
      return fixtureStream(textParts(markup.repeat(double ? 2 : 1), mode === 'double-chunked' ? 1 : 10000));
    } });
    const model = wrapLanguageModel({ model: endpoint, middleware: [trace.parsedMiddleware(), hermesToolMiddleware,
      cliSafetyMiddleware(abort, () => false, async () => {}, trace)] });
    const parent = createDoomPlayAgent(model, tools, () => {}, 'live', 2, calls, () => mode === 'sequential' && begun === 1, trace);
    try {
      const stream = await parent.stream({ prompt: secret, abortSignal: abort.signal });
      let receipt;
      try { receipt = await consumeDoomStream(stream, abort.signal, () => true, ['executeGuardedDecision'], 8192, 2000, 4, trace); }
      catch (error) {
        assert.ok(double && error instanceof DoomStreamError);
        assert.equal(error.code, 'STREAM_TOOL_ERROR_EVENT'); receipt = error.receipt;
        abort.abort(new Error(secret));
      }
      await new Promise(resolve => setImmediate(resolve));
      const report = trace.finish(), events = report.events;
      assert.equal(begun, mode === 'sequential' ? 2 : 1);
      assert.equal(receipt!.toolCalls, double || mode === 'sequential' ? 2 : 1);
      assert.equal(receipt!.toolResults, double ? 0 : begun);
      assert.equal(receipt!.steps, double ? 0 : mode === 'sequential' ? 3 : 2);
      assert.equal(report.firstError, double ? 'tool-error' : null);
      assert.equal(report.truncated, false);
      assert.ok(events.every((event, i) => event.seq === i + 1));
      const parsed = events.filter(event => event.kind === 'parsed-call');
      assert.equal(parsed.length, double || mode === 'sequential' ? 2 : 1);
      assert.notEqual(parsed[0].call, parsed[1]?.call);
      assert.deepEqual(parsed.map(event => event.ordinal), double ? [1, 2] : mode === 'sequential' ? [1, 1] : [1]);
      assert.equal(events.filter(event => event.kind === 'callback-begin').length, begun);
      if (double) {
        assert.equal(receipt!.events, 11);
        const ordered = ['callback-begin', 'native-rejected', 'tool-error', 'host-abort', 'callback-cancelled'].map(kind => events.findIndex(e => e.kind === kind));
        assert.ok(ordered.every((index, i) => index >= 0 && (i === 0 || index > ordered[i - 1])));
        const failure = events.find(event => event.kind === 'tool-error')!;
        assert.equal(failure.call, parsed[1].call); assert.equal(failure.code, 'OVERLAP_OR_DUPLICATE'); assert.equal(failure.outstanding, 2);
      } else assert.ok(!events.some(event => event.kind === 'native-rejected'));
      if (mode === 'sequential') {
        assert.equal(forwarded, true);
        assert.deepEqual(parsed.map(event => event.step), [1, 2]);
        const admitted = events.filter(event => event.kind === 'native-admitted');
        assert.equal(admitted[1].prior, admitted[0].call);
        assert.ok(events.some(event => event.kind === 'forwarded-result' && event.call === admitted[0].call && event.step === 2));
      }
      if (mode === 'repeat-completion') assert.deepEqual(events.filter(event => event.kind === 'provider-completed').map(event => [event.item, event.seen]), [[1, false], [1, true]]);
      if (mode === 'repeat-delta') assert.deepEqual(events.filter(event => event.kind === 'provider-delta').map(event => [event.item, event.seen]), [[1, false], [1, true]]);
      if (mode === 'normal-notifications' || mode === 'double-notifications') assert.ok(events.filter(event => event.kind.startsWith('provider-')).every(event => event.seen === false));
      assert.ok(!JSON.stringify(report).includes(secret));
      assert.ok(!JSON.stringify(report).includes('tool_call'));
    } finally { abort.abort(); await provider.close(); }
  });
});

test('trace privacy, bounded aliases/events, first-error precedence and frozen late events', () => {
  const trace = new ToolTrace();
  for (let i = 0; i < 500; i++) {
    trace.providerRaw({ method: secret, params: { private: secret } });
    trace.providerRaw({ method: 'item/agentMessage/delta', params: { itemId: `${secret}${i}`, delta: secret } });
    trace.native('native-attempt', `${secret}${i}`, secret);
  }
  trace.stream('tool-error', secret, secret, new Error(secret));
  trace.abort(); trace.stream('error', secret, secret, new Error(secret));
  const snapshot = trace.finish();
  assert.equal(snapshot.events.length, 128); assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.firstError, 'tool-error');
  assert.ok(snapshot.events.every((event, i, all) => !i || event.seq > all[i - 1].seq));
  assert.ok(!JSON.stringify(snapshot).includes(secret));
  const saved = JSON.stringify(snapshot);
  trace.native('callback-returned', secret, secret); trace.providerRaw({ method: secret });
  assert.equal(JSON.stringify(snapshot), saved);
});
