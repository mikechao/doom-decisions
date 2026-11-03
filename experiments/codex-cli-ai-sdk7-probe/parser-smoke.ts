import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hermesToolMiddleware } from '@ai-sdk-tool/parser';
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart, LanguageModelV4StreamResult } from '@ai-sdk/provider';
import { ToolLoopAgent, tool, wrapLanguageModel, isStepCount, asSchema, type LanguageModelMiddleware, type ModelMessage } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';
import { z } from 'zod';

const inputSchema = z.strictObject({ request: z.literal('marker') });
// ToolLoopAgentSettings.include is forwarded to streamText; agent.stream has no include option.
const sdkRawInclude = { rawChunks: true };
const initialProbeInstructions = 'This is a synthetic host-tool test. Emit exactly one getProbeMarker call using the supplied Hermes text protocol with request="marker". Then, after the tool result, give a plain final answer quoting its exact marker and noteId. Never invent either value. Do not use shell, files, web, native tools, MCP, skills, or other agents. The text protocol tool is executed by the host SDK; do not seek a native tool with this name.';
function prepareProbeStep<Message extends ModelMessage>({ stepNumber, messages }: { stepNumber: number; messages: Message[] }) {
  assert.ok(stepNumber < 2, 'SDK step fence');
  return stepNumber === 1 ? {
    toolChoice: 'none',
    instructions: 'This is the completion step of a synthetic host-tool test. getProbeMarker has already executed. Do not request it again or emit a <tool_call> block. Read its tool-result message in the conversation and return only a JSON object with the exact marker and noteId. If either value is not visible, say which value is missing rather than inventing it. Do not use shell, files, web, native tools, MCP, skills, or other agents.',
    messages: [...messages, {
      role: 'user',
      content: [{ type: 'text', text: 'getProbeMarker has already executed. Do not request it again. Read the immediately preceding tool-result message and extract marker and noteId. Return a final JSON object with their exact values, not a <tool_call> block. If either value is not visible, say which value is missing rather than inventing it.' }],
    }],
  } satisfies { toolChoice: 'none'; instructions: string; messages: ModelMessage[] } : {};
}
function markerLatch() {
  let count = 0;
  let output: { marker: string; noteId: string } | undefined;
  let input: z.output<typeof inputSchema> | undefined;
  return {
    execute(value: unknown) {
      const parsed = inputSchema.parse(value);
      if (++count !== 1) throw new Error('One-shot callback invoked more than once');
      input = parsed;
      // Neither value exists before the host callback executes.
      output = { marker: `probe-${randomUUID()}`, noteId: randomUUID() };
      return output;
    },
    snapshot: () => ({ count, input, output }),
  };
}
function record(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).safeParse(value).data ?? {};
}
function safeError(value: unknown) {
  return (value instanceof Error ? `${value.name}: ${value.message}` : String(value))
    .replace(/Bearer\s+\S+|sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+/gi, '[redacted]')
    .replace(/\/(?:Users|private|tmp)\/[^\s"']+/g, '[local-path]').slice(0, 1500);
}
function rawSummary(value: unknown) {
  const raw = record(value);
  const params = record(raw.params);
  const name = (value: unknown) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_/-]{0,119}$/.test(value) ? value : 'unrecognized';
  const method = name(raw.method);
  const lifecycle = method === 'turn/started' || method === 'turn/completed';
  const itemEvent = method === 'item/started' || method === 'item/completed';
  const turn = record(params.turn);
  const items = lifecycle && Array.isArray(turn.items) ? turn.items : itemEvent ? [params.item] : [];
  const rawTypes = [...new Set(items.map(item => name(record(item).type)))];
  // Exact installed ThreadItem types. Unknown types are visibility gaps, not asserted executions.
  const nativeTypes = ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'webSearch', 'imageView', 'imageGeneration', 'subAgentActivity', 'sleep'];
  const passiveTypes = ['userMessage', 'agentMessage', 'reasoning', 'plan', 'contextCompaction'];
  const types = rawTypes.map(type => nativeTypes.includes(type) || passiveTypes.includes(type) ? type : 'unrecognized-item');
  const nativeMethod = ['item/commandExecution/outputDelta', 'item/fileChange/outputDelta', 'item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/call', 'item/tool/requestUserInput'].includes(method)
    || (method === 'mcpServer/elicitation/request' && record(params._meta).codex_approval_kind === 'mcp_tool_call');
  const passiveMethod = ['item/agentMessage/delta', 'item/reasoning/textDelta', 'item/reasoning/summaryTextDelta', 'reasoningTextDelta', 'reasoningSummaryTextDelta', 'thread/tokenUsage/updated', 'error'].includes(method);
  const knownItems = types.every(type => nativeTypes.includes(type) || passiveTypes.includes(type));
  const envelope = typeof params.threadId === 'string';
  const recognized = envelope && (
    (lifecycle && typeof turn.id === 'string' && Array.isArray(turn.items) && knownItems)
    || (itemEvent && typeof params.turnId === 'string' && types.length > 0 && knownItems)
    || nativeMethod || passiveMethod);
  // Only known protocol identifiers reach normal reports; unknown payload strings are excluded.
  const reportedMethod = lifecycle || itemEvent || nativeMethod || passiveMethod ? method : 'unsupported-method';
  return { method: reportedMethod, types, recognized,
    turnEvent: envelope && lifecycle && typeof turn.id === 'string' && Array.isArray(turn.items) ? method : null,
    native: envelope && (nativeMethod || ((lifecycle ? typeof turn.id === 'string' : typeof params.turnId === 'string') && types.some(type => nativeTypes.includes(type)))),
    stage: lifecycle ? 'turn-item-history' : itemEvent ? method : nativeMethod ? 'output-or-request (not proof of completed execution)' : 'notification',
    retry: method === 'error' && params.willRetry === true };
}

function rawEvidence(invocation: number) {
  return { invocation, rawChunks: 0, recognizedChunks: 0, unclassifiedChunks: 0, turnStarts: 0, turnCompletions: 0, nativeSignals: 0, retrySignals: 0,
    metadataToolCalls: null as number | null };
}
type RawEvidence = ReturnType<typeof rawEvidence>;
function countRaw(evidence: RawEvidence, value: unknown, counts: Map<string, number>) {
  const summary = rawSummary(value);
  evidence.rawChunks++;
  if (summary.recognized) evidence.recognizedChunks++; else evidence.unclassifiedChunks++;
  if (summary.turnEvent === 'turn/started') evidence.turnStarts++;
  if (summary.turnEvent === 'turn/completed') evidence.turnCompletions++;
  if (summary.native) evidence.nativeSignals++;
  if (summary.retry) evidence.retrySignals++;
  const key = `${evidence.invocation}:${summary.method}:${summary.types.join(',')}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  return summary;
}
function rawEvidenceIssue(evidence: RawEvidence) {
  if (evidence.nativeSignals || (evidence.metadataToolCalls ?? 0) > 0) return `Native activity observed for invocation ${evidence.invocation}`;
  if (evidence.retrySignals) return `Provider retry observed for invocation ${evidence.invocation}`;
  if (!evidence.rawChunks) return `No raw observation evidence for invocation ${evidence.invocation}`;
  if (!evidence.recognizedChunks) return `Raw chunks received but no recognizable App Server evidence for invocation ${evidence.invocation}`;
  if (evidence.unclassifiedChunks) return `Unclassified raw events leave native-tool visibility incomplete for invocation ${evidence.invocation}`;
  return `Filtered raw events observed for invocation ${evidence.invocation}; exhaustive native-tool visibility is not established (provider schema/thread filtering)`;
}

function boundaryTrace(invocation: number, params: LanguageModelV4CallOptions) {
  const systemMessages = params.prompt.filter(message => message.role === 'system').map(({ role, content }) => ({ role, content }));
  return {
    invocation: `step-${invocation}`,
    outbound: {
      boundary: 'AppServerLanguageModel.doStream().request.body (provider-returned metadata, not RPC interception)',
      providerReturnedRequestBody: null as string | null,
      sdkSystemMessages: systemMessages,
      reconstructedThreadStartDeveloperInstructions: systemMessages.map(message => message.content.trim()).filter(Boolean).join('\n\n'),
      instructionsProvenance: 'Reconstructed collectSystemInstruction -> thread/start.developerInstructions; probe sets no override. Not observed on transport; server defaults/base instructions unknown.',
    },
    chunkCount: 0,
    chunkOrder: [] as string[],
    providerTextParts: [] as Array<{ chunk: number; type: string; id: string; delta?: string }>,
    providerFinishes: [] as Array<{ chunk: number; finishReason: unknown; usage: unknown; providerMetadata: unknown }>,
    sdkTextAfterHermes: '',
    truncated: false,
    captureError: false,
  };
}
type BoundaryTrace = ReturnType<typeof boundaryTrace>;

// Inside Hermes: observe once, enqueue the same chunk once. No tee or extra read.
function traceProviderResult(result: LanguageModelV4StreamResult, trace?: BoundaryTrace): LanguageModelV4StreamResult {
  if (!trace) return result;
  const body = result.request?.body;
  trace.outbound.providerReturnedRequestBody = typeof body === 'string' ? body : null;
  let textSize = 0;
  return { ...result, stream: result.stream.pipeThrough(new TransformStream({
    transform(part, controller) {
      try {
        const chunk = trace.chunkCount++;
        if (chunk >= 4096 || textSize > 1_048_576) trace.truncated = true;
        else {
          trace.chunkOrder.push(part.type);
          if (part.type === 'text-start' || part.type === 'text-end' || part.type === 'text-delta') {
            const delta = part.type === 'text-delta' ? part.delta : undefined;
            textSize += delta?.length ?? 0;
            trace.providerTextParts.push({ chunk, type: part.type, id: part.id, ...(delta !== undefined ? { delta } : {}) });
          }
        }
        if (part.type === 'finish' && trace.providerFinishes.length < 4) trace.providerFinishes.push(structuredClone({ chunk, finishReason: part.finishReason, usage: part.usage, providerMetadata: part.providerMetadata }));
      } catch { trace.captureError = true; }
      controller.enqueue(part);
    },
  })) };
}

function privateTraceJson(value: unknown) {
  let redactions = 0;
  const serialized = JSON.stringify(value, (key, item: unknown) => {
    if (/^(authorization|headers|env|api[_-]?key|access[_-]?token|refresh[_-]?token|password)$/i.test(key)) {
      redactions++;
      return '[excluded]';
    }
    if (typeof item !== 'string') return item;
    const clean = item.replace(/Bearer\s+\S+|sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+/gi, '[redacted credential]')
      .replace(/\/(?:Users|home)\/[^/\\\s"'<>]+/g, '[home]')
      .replace(/((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*["']?)[^\s"'<>]+/gi, '$1[redacted credential]');
    if (clean !== item) redactions++;
    return clean;
  });
  return JSON.stringify({ redactions, evidence: JSON.parse(serialized) }, null, 2) + '\n';
}

async function saveBoundaryTraces(local: URL, traces: BoundaryTrace[], finalAgentText: string) {
  const directory = await mkdtemp(fileURLToPath(new URL('trace-', local))); // Unique directory, mode 0700.
  await writeFile(join(directory, 'boundary.json'), privateTraceJson({
    boundaryNotes: [
      'Observed request.body is the installed provider\'s actual flattened text, used by buildUserInput -> turn/start.input. It is not a captured JSON-RPC payload or proof of server receipt.',
      'Developer instructions are reconstructed separately; they go on thread/start, not turn/start. No provider transport hooks are patched.',
      'Provider text lifecycle/deltas and finishes are observed before Hermes. This is provider-normalized text, not raw server/network output. Nontext chunk contents are excluded.',
      'No headers, environment or configuration dump is captured. Targeted credential/home redaction may alter text; exact synthetic values are retained. Check redactions, truncated and captureError before treating evidence as exact.',
      'Buffered until finally; crashes before closeout may lose evidence. SDK raw inclusion is enabled independently of this trace flag; provider schema/thread filtering still limits native-tool visibility.',
    ],
    traces: traces.map(trace => ({ ...trace,
      comparison: {
        providerTextConcatenated: trace.providerTextParts.map(part => part.delta ?? '').join(''),
        equalsSdkText: trace.providerTextParts.map(part => part.delta ?? '').join('') === trace.sdkTextAfterHermes,
      },
    })),
    finalAgentText,
  }), { flag: 'wx', mode: 0o600 });
  return `.smoke-local/${basename(directory)}/boundary.json`;
}

async function traceDryRun(converter: LanguageModelV4) {
  assert.ok('preparePrompt' in converter && typeof converter.preparePrompt === 'function');
  assert.ok('buildUserInput' in converter && typeof converter.buildUserInput === 'function');
  const preparePrompt = converter.preparePrompt.bind(converter);
  const buildUserInput = converter.buildUserInput.bind(converter);
  const output = { marker: 'synthetic-trace-marker', noteId: 'synthetic-trace-note' };
  const history = [
    { role: 'system', content: '  Original synthetic instructions.  ' },
    { role: 'user', content: [{ type: 'text', text: 'Obtain a marker.' }] },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'fixture-call', toolName: 'getProbeMarker', input: { request: 'marker' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'fixture-call', toolName: 'getProbeMarker', output: { type: 'json', value: output } }] },
  ] satisfies ModelMessage[];
  const second = prepareProbeStep({ stepNumber: 1, messages: history });
  assert.ok(second.messages && second.toolChoice);
  const toolText = '<tool_call>{"name":"getProbeMarker","arguments":{"request":"marker"}}</tool_call>';
  const variants: Array<{ requests: LanguageModelV4CallOptions[]; received: LanguageModelV4StreamPart[][]; traces: BoundaryTrace[]; finalText: string }> = [];
  for (const enabled of [false, true]) {
    let calls = 0;
    const requests: LanguageModelV4CallOptions[] = [];
    const convertedInstructions: string[] = [];
    const sources: LanguageModelV4StreamPart[][] = [];
    const received: LanguageModelV4StreamPart[][] = [];
    const traces: BoundaryTrace[] = [];
    const fake: LanguageModelV4 = {
      specificationVersion: 'v4', provider: 'offline-fixture', modelId: 'offline-fixture', supportedUrls: {},
      doGenerate: async () => { throw new Error('Unexpected fixture generate'); },
      doStream: async params => {
        calls++;
        requests.push(structuredClone(params));
        // Reuse installed pure conversion, not an App Server simulator.
        const converted = z.object({ promptText: z.string(), systemInstruction: z.string() })
          .parse(preparePrompt(params.prompt, false));
        convertedInstructions.push(converted.systemInstruction);
        const built = z.object({ input: z.array(z.object({ type: z.literal('text'), text: z.string() })) })
          .parse(await buildUserInput(converted.promptText, []));
        assert.equal(built.input[0].text, converted.promptText);
        const parts: LanguageModelV4StreamPart[] = [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'block-a' },
          { type: 'text-delta', id: 'block-a', delta: 'Prefix.\n' },
          { type: 'text-end', id: 'block-a' },
          { type: 'raw', rawValue: { synthetic: true } },
          { type: 'text-start', id: 'block-b' },
          { type: 'text-delta', id: 'block-b', delta: toolText.slice(0, 25) },
          { type: 'text-delta', id: 'block-b', delta: toolText.slice(25) },
          { type: 'text-end', id: 'block-b' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'completed' },
            usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            providerMetadata: { 'codex-app-server': { toolExecutionStats: { totalCalls: 0 } } } },
        ];
        sources.push(parts);
        return { request: { body: converted.promptText }, stream: new ReadableStream({ start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        } }) };
      },
    };
    const wrapped = wrapLanguageModel({ model: fake, middleware: [hermesToolMiddleware, {
      specificationVersion: 'v4',
      wrapStream: async ({ params, doStream }) => {
        const trace = enabled ? boundaryTrace(calls + 1, params) : undefined;
        if (trace) traces.push(trace);
        const source = await doStream();
        const tapped = traceProviderResult(source, trace);
        if (!enabled) assert.strictEqual(tapped, source);
        assert.strictEqual(tapped.request, source.request);
        assert.strictEqual(tapped.response, source.response);
        const chunks: LanguageModelV4StreamPart[] = [];
        received.push(chunks);
        // Exact caller-side identity/order below Hermes, not a second read.
        return { ...tapped, stream: tapped.stream.pipeThrough(new TransformStream({ transform(part, controller) {
          chunks.push(part); controller.enqueue(part);
        } })) };
      },
    }] });
    let finalText = '';
    for (const [index, prompt] of [history.slice(0, 2), second.messages].entries()) {
      const response = await wrapped.doStream({ prompt,
        tools: [{ type: 'function', name: 'getProbeMarker', inputSchema: await asSchema(inputSchema).jsonSchema }],
        toolChoice: { type: index === 0 ? 'auto' : 'none' },
      });
      const parsed: LanguageModelV4StreamPart[] = [];
      const reader = response.stream.getReader();
      try { while (true) { const item = await reader.read(); if (item.done) break; parsed.push(item.value); } }
      finally { reader.releaseLock(); }
      if (index === 0) assert.ok(parsed.some(part => part.type === 'tool-call' && part.toolName === 'getProbeMarker' && !part.providerExecuted));
      else finalText = parsed.map(part => part.type === 'text-delta' ? part.delta : '').join('');
      if (enabled) {
        traces[index].sdkTextAfterHermes = parsed.map(part => part.type === 'text-delta' ? part.delta : '').join('');
      }
      assert.deepEqual(received[index], sources[index]);
      received[index].forEach((part, chunk) => assert.strictEqual(part, sources[index][chunk]));
    }
    assert.equal(calls, 2); // No agent/execute callback is available to the tracing code.
    if (enabled) {
      assert.deepEqual(traces.map(trace => trace.invocation), ['step-1', 'step-2']);
      for (const [index, trace] of traces.entries()) {
        assert.equal(trace.providerTextParts.map(part => part.delta ?? '').join(''), `Prefix.\n${toolText}`);
        assert.deepEqual(trace.providerTextParts.map(part => part.chunk), [1, 2, 3, 5, 6, 7, 8]);
        assert.equal(trace.chunkCount, 10);
        assert.deepEqual(trace.chunkOrder, sources[0].map(part => part.type));
        assert.equal(trace.providerFinishes.length, 1);
        assert.deepEqual(trace.providerFinishes[0].finishReason, { unified: 'stop', raw: 'completed' });
        assert.ok(trace.outbound.reconstructedThreadStartDeveloperInstructions === convertedInstructions[index], 'Instruction reconstruction differs from installed conversion');
        assert.ok(!trace.truncated && !trace.captureError);
      }
      const body = traces[1].outbound.providerReturnedRequestBody;
      assert.ok(body && body.includes(output.marker) && body.includes(output.noteId));
      assert.ok(body.indexOf('getProbeMarker has already executed.') > body.indexOf('</tool_response>'));
      assert.equal(traces[1].sdkTextAfterHermes, `Prefix.\n${toolText}`);
    }
    variants.push({ requests, received, traces, finalText });
  }
  assert.deepEqual(variants[0].requests, variants[1].requests);
  assert.deepEqual(variants[0].received, variants[1].received);
  assert.equal(variants[0].finalText, variants[1].finalText);
  // Explicit opt-in storage test; only this freshly created fixture tree is removed.
  const root = await mkdtemp(fileURLToPath(new URL('./.smoke-local/trace-fixture-', import.meta.url)));
  try {
    const local = pathToFileURL(`${root}/`);
    const traces = variants[1].traces;
    traces[0].sdkTextAfterHermes += ' Bearer synthetic-credential /Users/synthetic/private';
    const first = await saveBoundaryTraces(local, traces, variants[1].finalText);
    const location = new URL(first.replace(/^\.smoke-local\//, ''), local);
    const saved = await readFile(location, 'utf8');
    const next = await saveBoundaryTraces(local, traces, variants[1].finalText);
    assert.notEqual(first, next);
    assert.equal(await readFile(location, 'utf8'), saved);
    assert.ok(saved.includes(output.marker) && saved.includes(output.noteId));
    assert.ok(!saved.includes('Bearer synthetic-credential') && !saved.includes('/Users/synthetic'));
    assert.ok(z.object({ redactions: z.number().positive() }).parse(JSON.parse(saved)));
  } finally { await rm(root, { recursive: true, force: true }); }
  console.log('PASS opt-in trace fixture: two fake calls per variant; exact requests/chunks on/off; pre-Hermes text blocks; stateless result history; private unique-file storage; no App Server/inference');
}

async function rawDryRun(converter: LanguageModelV4) {
  assert.ok('preparePrompt' in converter && typeof converter.preparePrompt === 'function');
  const preparePrompt = converter.preparePrompt.bind(converter);
  const notification = (method: string, extra: object = {}) => ({ method, params: { threadId: 'offline-thread', turnId: 'offline-turn', ...extra } });
  const started = notification('turn/started', { turn: { id: 'offline-turn', items: [], status: 'inProgress', error: null } });
  const completed = notification('turn/completed', { turn: { id: 'offline-turn', items: [{ type: 'agentMessage', id: 'message', text: 'offline text' }], status: 'completed', error: null } });
  const counts = new Map<string, number>();
  const first = rawEvidence(1), second = rawEvidence(2);
  countRaw(first, started, counts);
  countRaw(second, started, counts);
  countRaw(first, notification('item/started', { item: { type: 'plan', id: 'plan', plan: [] } }), counts);
  countRaw(second, notification('item/completed', { item: { type: 'reasoning', id: 'reason', summary: [], content: [] } }), counts);
  countRaw(first, completed, counts);
  countRaw(second, completed, counts);
  assert.equal(first.nativeSignals + second.nativeSignals, 0);
  assert.equal(first.turnStarts, 1);
  assert.equal(second.turnCompletions, 1);
  assert.ok(counts.has('1:item/started:plan') && counts.has('2:item/completed:reasoning'));
  for (const type of ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'webSearch', 'imageView', 'imageGeneration', 'subAgentActivity', 'sleep']) {
    assert.ok(rawSummary(notification('item/started', { item: { type } })).native);
    assert.ok(rawSummary(notification('turn/completed', { turn: { id: 'offline-turn', items: [{ type }], status: 'completed' } })).native);
  }
  assert.ok(rawSummary(notification('item/commandExecution/outputDelta', { delta: 'not recorded' })).native);
  assert.ok(rawSummary(notification('item/tool/call', { tool: 'offline-tool' })).native);
  assert.ok(!rawSummary(notification('item/agentMessage/delta', { delta: 'text mentioning commandExecution and mcpToolCall' })).native);
  assert.ok(!rawSummary({ method: 'item/tool/call' }).native); // Malformed envelope is unknown, not an execution.
  const empty = rawEvidence(1);
  empty.metadataToolCalls = 0;
  assert.match(rawEvidenceIssue(empty), /No raw observation/);
  const metadataOnly = rawEvidence(1);
  metadataOnly.metadataToolCalls = 1;
  assert.match(rawEvidenceIssue(metadataOnly), /Native activity observed/);
  countRaw(empty, { unsupported: true }, counts);
  assert.match(rawEvidenceIssue(empty), /no recognizable/);
  countRaw(first, notification('item/completed', { item: { type: 'futureItemType' } }), counts);
  assert.match(rawEvidenceIssue(first), /Unclassified/);
  assert.match(rawEvidenceIssue(second), /exhaustive native-tool visibility is not established/);
  const native = rawEvidence(1);
  countRaw(native, notification('item/completed', { item: { type: 'mcpToolCall' } }), counts);
  assert.match(rawEvidenceIssue(native), /Native activity observed/);
  assert.ok(!JSON.stringify(rawSummary(notification('item/started', { item: { type: 'commandExecution', command: 'PRIVATE FIXTURE PAYLOAD' } }))).includes('PRIVATE FIXTURE PAYLOAD'));

  // Real SDK agent, tiny in-memory v4 source. No App Server, transport or inference.
  const variants: Array<{ requests: LanguageModelV4CallOptions[]; types: string[]; text: string }> = [];
  for (const enabled of [false, true]) {
    let calls = 0, callbacks = 0, sdkStep = 0;
    const requests: LanguageModelV4CallOptions[] = [];
    const observed = [rawEvidence(1), rawEvidence(2)];
    const fake: LanguageModelV4 = {
      specificationVersion: 'v4', provider: 'offline-raw-fixture', modelId: 'offline-raw-fixture', supportedUrls: {},
      doGenerate: async () => { throw new Error('Unexpected offline generate'); },
      doStream: async params => {
        calls++;
        requests.push(structuredClone({ ...params, abortSignal: undefined }));
        assert.equal(params.includeRawChunks, enabled);
        // Actual SDK prepareStep -> Hermes -> installed provider's pure conversion.
        const prepared = z.object({ promptText: z.string(), systemInstruction: z.string() }).parse(preparePrompt(params.prompt, false));
        if (calls === 1) {
          assert.ok(prepared.systemInstruction.startsWith(initialProbeInstructions));
          assert.ok(prepared.systemInstruction.includes('Emit exactly one getProbeMarker call'));
          assert.ok(prepared.systemInstruction.includes('<tools>'));
        } else {
          const completion = prepareProbeStep({ stepNumber: 1, messages: [] }).instructions;
          assert.ok(completion && prepared.systemInstruction === completion, 'Step-two high-priority instructions were not replaced');
          assert.ok(!prepared.systemInstruction.includes('Emit exactly one') && !prepared.systemInstruction.includes('<tools>'));
          assert.equal(record(record(params.providerOptions?.toolCallMiddleware).toolChoice).type, 'none');
          assert.ok(!completion.includes('offline-marker') && !completion.includes('offline-note'));
          assert.ok(prepared.promptText.includes('offline-marker') && prepared.promptText.includes('offline-note'));
          assert.ok(prepared.promptText.includes('Assistant: <tool_call>') && prepared.promptText.includes('User: Offline raw inclusion fixture.'));
          const resultEnd = prepared.promptText.indexOf('</tool_response>');
          assert.ok(resultEnd >= 0 && prepared.promptText.indexOf('getProbeMarker has already executed.') > resultEnd);
        }
        const parts: LanguageModelV4StreamPart[] = [
          { type: 'stream-start', warnings: [] },
          { type: 'response-metadata', id: `offline-${calls}`, modelId: 'offline-raw-fixture', timestamp: new Date(0) },
          ...(params.includeRawChunks ? [{ type: 'raw', rawValue: started } satisfies LanguageModelV4StreamPart] : []),
          ...(calls === 1 ? [{ type: 'text-start', id: 'offline-call-text' }, { type: 'text-delta', id: 'offline-call-text', delta: '<tool_call>{"name":"getProbeMarker","arguments":{"request":"marker"}}</tool_call>' }, { type: 'text-end', id: 'offline-call-text' }] satisfies LanguageModelV4StreamPart[]
            : [{ type: 'text-start', id: 'offline-text' }, { type: 'text-delta', id: 'offline-text', delta: 'offline final' }, { type: 'text-end', id: 'offline-text' }] satisfies LanguageModelV4StreamPart[]),
          ...(params.includeRawChunks ? [{ type: 'raw', rawValue: completed } satisfies LanguageModelV4StreamPart] : []),
          { type: 'finish', finishReason: { unified: calls === 1 ? 'tool-calls' : 'stop', raw: 'completed' },
            usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
        ];
        return { stream: new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); } }) };
      },
    };
    const agent = new ToolLoopAgent({ model: wrapLanguageModel({ model: fake, middleware: hermesToolMiddleware }), instructions: initialProbeInstructions,
      include: enabled ? sdkRawInclude : { rawChunks: false },
      maxRetries: 0, stopWhen: isStepCount(2), prepareStep: prepareProbeStep,
      tools: { getProbeMarker: tool({ inputSchema, execute: () => { callbacks++; return { marker: 'offline-marker', noteId: 'offline-note' }; } }) },
    });
    const result = await agent.stream({ prompt: 'Offline raw inclusion fixture.' });
    const types: string[] = [];
    let text = '';
    for await (const part of result.fullStream) {
      if (part.type === 'start-step') sdkStep++;
      if (part.type === 'raw') countRaw(observed[sdkStep - 1], part.rawValue, new Map());
      else types.push(part.type);
      if (part.type === 'text-delta') text += part.text;
    }
    assert.equal(calls, 2);
    assert.equal(callbacks, 1);
    assert.equal((await result.steps).length, 2);
    observed.forEach(evidence => {
      assert.equal(evidence.rawChunks, enabled ? 2 : 0); // Exact fixture sequence only, not a live-count requirement.
      assert.equal(evidence.nativeSignals, 0);
    });
    variants.push({ requests, types, text });
  }
  const withoutRawOption = (requests: LanguageModelV4CallOptions[]) => requests.map(({ includeRawChunks: _raw, ...request }) => request);
  assert.deepEqual(withoutRawOption(variants[0].requests), withoutRawOption(variants[1].requests));
  assert.deepEqual(variants[0].types, variants[1].types);
  assert.equal(variants[0].text, variants[1].text);
  console.log('PASS offline SDK/Hermes/provider instruction override and result history; raw opt-in and negative controls; identical requests except raw inclusion; two fake calls and one callback per variant');
}

async function dryRun() {
  const latch = markerLatch();
  assert.throws(() => latch.execute({ request: 'marker', extra: true }));
  assert.equal(latch.snapshot().count, 0);
  const output = latch.execute({ request: 'marker' });
  assert.throws(() => latch.execute({ request: 'marker' }), /One-shot/);
  assert.equal(rawSummary({ method: 'item/started', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', item: { type: 'commandExecution' } } }).native, true);
  assert.equal(rawSummary({ method: 'item/completed', params: { item: { type: 'agentMessage' } } }).native, false);
  const provider = createCodexAppServer({ defaultSettings: { logger: false } });
  try {
    const model = provider('gpt-6.1-sol');
    await rawDryRun(model);
    const history = [
      { role: 'system', content: 'Original synthetic probe instructions.' },
      { role: 'user', content: [{ type: 'text', text: 'Obtain one marker.' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'dry-only', toolName: 'getProbeMarker', input: { request: 'marker' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'dry-only', toolName: 'getProbeMarker', output: { type: 'json', value: output } }] },
    ] satisfies ModelMessage[];
    const originalHistory = structuredClone(history);
    assert.deepEqual(prepareProbeStep({ stepNumber: 0, messages: history }), {});
    const second = prepareProbeStep({ stepNumber: 1, messages: history });
    assert.equal(second.toolChoice, 'none');
    assert.ok(second.instructions && !second.instructions.includes(output.marker) && !second.instructions.includes(output.noteId));
    assert.ok(second.messages);
    assert.equal(second.messages.length, history.length + 1);
    assert.deepEqual(second.messages.slice(0, -1), originalHistory);
    const followUp = second.messages.at(-1);
    assert.equal(followUp?.role, 'user');
    assert.ok(!JSON.stringify(followUp).includes(output.marker) && !JSON.stringify(followUp).includes(output.noteId));
    assert.throws(() => prepareProbeStep({ stepNumber: 2, messages: history }), /SDK step fence/);
    assert.ok(hermesToolMiddleware.transformParams);
    const transformed = await hermesToolMiddleware.transformParams({
      type: 'stream', model,
      params: {
        prompt: history,
        tools: [{ type: 'function', name: 'getProbeMarker', inputSchema: await asSchema(inputSchema).jsonSchema }],
        toolChoice: { type: 'auto' },
      },
    });
    assert.deepEqual(transformed.tools, []);
    const userHistory = JSON.stringify(transformed.prompt.filter(message => message.role === 'user'));
    assert.ok(userHistory.includes('<tool_response>') && userHistory.includes(output.marker) && userHistory.includes(output.noteId));
    const secondTransformed = await hermesToolMiddleware.transformParams({
      type: 'stream', model,
      params: { prompt: second.messages, toolChoice: { type: second.toolChoice } },
    });
    assert.deepEqual(secondTransformed.tools, []);
    // Installed internal conversion only: no doStream, thread, RPC, or inference.
    assert.ok('preparePrompt' in model && typeof model.preparePrompt === 'function');
    const flattened = z.object({ promptText: z.string(), systemInstruction: z.string() })
      .parse(model.preparePrompt(secondTransformed.prompt, false));
    assert.equal(flattened.systemInstruction, originalHistory[0].content);
    assert.ok(flattened.promptText.includes(output.marker) && flattened.promptText.includes(output.noteId));
    assert.ok(flattened.promptText.includes('Assistant: <tool_call>'));
    assert.ok(flattened.promptText.includes('User: Obtain one marker.'));
    const resultEnd = flattened.promptText.indexOf('</tool_response>');
    assert.ok(resultEnd >= 0 && flattened.promptText.indexOf('getProbeMarker has already executed.') > resultEnd);
    assert.deepEqual(history, originalHistory);
    if (process.env.CODEX_PROBE_TRACE === '1') await traceDryRun(model);
  } finally {
    await provider.close(); // Lazy construction above starts no process or inference.
  }
  console.log('PASS offline latch, strict input, native-event detector, Hermes history, and step-2 stateless prompt preservation; no inference');
}

async function live() {
  const local = new URL('./.smoke-local/', import.meta.url);
  await mkdir(local, { recursive: true });
  // An accidental second invocation cannot issue another live run.
  await writeFile(new URL('live-once.lock', local), new Date().toISOString(), { flag: 'wx' });
  const cwd = await mkdtemp(join(tmpdir(), 'codex-parser-smoke-'));
  const abort = new AbortController();
  const latch = markerLatch();
  const events: object[] = [];
  const requests: object[] = [];
  const rawCounts = new Map<string, number>();
  const rawObservations: RawEvidence[] = [];
  const ordinaryToolInputIds = new Set<string>();
  const nativeEvents: object[] = [];
  const failures: string[] = [];
  const exitEvents: string[] = [];
  let resolveExit: () => void = () => {};
  const exited = new Promise<void>(resolve => { resolveExit = resolve; });
  let modelCalls = 0;
  let agentRuns = 0;
  let completedSteps = 0;
  let sdkStarts = 0;
  let streamComplete = false;
  let turnStarts = 0;
  let finalText = '';
  let verdict = 'BLOCKED';
  let phase = 'model-discovery';
  let closeResolved = false;
  let tempRemoved = false;
  let markerMatches = false;
  const traceEnabled = process.env.CODEX_PROBE_TRACE === '1';
  const traces: BoundaryTrace[] = [];
  let sdkTraceStep = 0;
  const config = {
    model: 'gpt-6.1-sol', // Existing ~/.codex/config.toml selection; verified by model/list below.
    codexPath: '/Users/mike/.nvm/versions/node/v22.20.0/bin/codex',
    threadMode: 'stateless', sandboxPolicy: 'read-only', approvalPolicy: 'on-request',
    maxRetries: 0, maxModelCalls: 2, deadlineMs: 120_000,
  };
  function fail(message: string) {
    failures.push(message);
    abort.abort(new Error(message));
  }
  function addEvent(event: object) {
    if (events.length >= 200) throw new Error('SDK evidence event bound exceeded');
    events.push(event);
  }
  const provider = createCodexAppServer({ defaultSettings: {
    codexPath: config.codexPath, cwd, threadMode: 'stateless',
    sandboxPolicy: 'read-only', approvalPolicy: 'on-request', autoApprove: false,
    includeRawChunks: true, connectionTimeoutMs: 15_000, requestTimeoutMs: 15_000,
    logger: {
      debug() {}, warn(message) { addEvent({ warning: safeError(message) }); },
      error(message) { addEvent({ providerError: safeError(message) }); },
      info(message) {
        if (/codex app-server exited \(code=/.test(message)) {
          exitEvents.push(safeError(message)); resolveExit();
        }
      },
    },
    serverRequests: {
      onCommandExecutionApproval: async () => { fail('Native command approval requested'); return { decision: 'decline' }; },
      onFileChangeApproval: async () => { fail('Native file approval requested'); return { decision: 'decline' }; },
      onSkillApproval: async () => { fail('Native skill approval requested'); return { decision: 'decline' }; },
      onMcpElicitation: async () => { fail('MCP elicitation requested'); return { action: 'decline' }; },
      onDynamicToolCall: async () => { fail('Native dynamic tool requested'); return { contentItems: [], success: false }; },
      onAuthRefresh: async () => { fail('Auth refresh requested; no auth repair'); throw new Error('Auth refresh forbidden'); },
      onUnhandled: async request => { fail(`Unexpected server request: ${request.method}`); throw new Error('Unexpected server request'); },
    },
  } });
  const deadline = setTimeout(() => fail('Bounded deadline expired'), config.deadlineMs);
  try {
    const catalog = await provider.listModels();
    if (!catalog.models.some(model => model.model === config.model || model.id === config.model)) {
      throw new Error('Configured model not present in first model/list page; no fallback');
    }
    addEvent({ modelDiscovery: 'configured model present', model: config.model });
    const observer: LanguageModelMiddleware = {
      specificationVersion: 'v4',
      wrapGenerate: async () => { throw new Error('Unexpected generate path; streaming only'); },
      wrapStream: async ({ doStream, params }) => {
        if (modelCalls >= 2 || abort.signal.aborted) throw new Error('Model invocation fence');
        modelCalls++;
        const invocation = modelCalls; // Bind attribution before any asynchronous provider work.
        const rawObservation = rawEvidence(invocation);
        rawObservations.push(rawObservation);
        phase = 'provider-invocation';
        const output = latch.snapshot().output;
        const userHistory = JSON.stringify(params.prompt.filter(message => message.role === 'user'));
        const historyContainsResult = !!output && userHistory.includes('<tool_response>')
          && userHistory.includes(output.marker) && userHistory.includes(output.noteId);
        requests.push({ invocation: modelCalls, toolsForwarded: params.tools?.length ?? 0, historyContainsResult });
        assert.equal(params.tools?.length ?? 0, 0);
        if (modelCalls === 2) assert.ok(historyContainsResult, 'Second provider prompt lacks exact callback result');
        const trace = traceEnabled ? boundaryTrace(modelCalls, params) : undefined;
        if (trace) traces.push(trace);
        const result = traceProviderResult(await doStream(), trace);
        return { ...result, stream: result.stream.pipeThrough(new TransformStream({
          transform(part, controller) {
            if (part.type === 'raw') {
              const summary = countRaw(rawObservation, part.rawValue, rawCounts);
              if (summary.turnEvent === 'turn/started') turnStarts++;
              if (rawCounts.size > 200) throw new Error('Raw evidence bound exceeded');
              if (summary.native) {
                nativeEvents.push({ invocation, source: 'sdk-raw', ...summary }); fail('Native activity observed');
              }
              if (summary.retry) fail('Provider retry observed');
              if (summary.method === 'error') {
                const params = record(record(part.rawValue).params);
                fail(safeError(record(params.error).message ?? 'Raw provider error'));
              }
            }
            if (part.type === 'tool-call' || part.type === 'tool-result' || part.type === 'tool-approval-request') {
              nativeEvents.push({ invocation, source: 'provider-stream (pre-Hermes)', type: part.type }); fail('Tool event below parser: native/provider tool activity');
            }
            if (part.type === 'finish') {
              const total = record(record(part.providerMetadata?.['codex-app-server']).toolExecutionStats).totalCalls;
              if (typeof total === 'number' && Number.isSafeInteger(total) && total >= 0) rawObservation.metadataToolCalls = total;
              if ((rawObservation.metadataToolCalls ?? 0) > 0) {
                nativeEvents.push({ invocation, source: 'provider-metadata completed mapped tools', totalCalls: rawObservation.metadataToolCalls });
                fail('Provider metadata reports completed native tools');
              }
              addEvent({ providerFinish: part.finishReason, providerMetadata: part.providerMetadata });
            }
            if (part.type === 'error') fail(safeError(part.error));
            controller.enqueue(part);
          },
        })) };
      },
    };
    const model = wrapLanguageModel({ model: provider(config.model), middleware: [hermesToolMiddleware, observer] });
    const agent = new ToolLoopAgent({
      model, maxRetries: 0, stopWhen: isStepCount(2), toolChoice: 'auto',
      include: sdkRawInclude,
      instructions: initialProbeInstructions,
      tools: { getProbeMarker: tool({
        description: 'Return a fresh synthetic marker and noteId from the in-process host callback. Call exactly once.',
        inputSchema,
        execute: input => {
          if (abort.signal.aborted || nativeEvents.length) throw new Error('Callback safety fence');
          return latch.execute(input);
        },
      }) },
      prepareStep: prepareProbeStep,
      onStepStart: () => { if (++sdkStarts > 2) throw new Error('SDK model-call fence'); },
    });
    agentRuns++;
    phase = 'agent-stream';
    const result = await agent.stream({ prompt: 'Obtain one marker through getProbeMarker, then quote the returned marker and noteId.', abortSignal: abort.signal });
    for await (const part of result.fullStream) {
      if (traceEnabled && part.type === 'start-step') sdkTraceStep++;
      if (traceEnabled && part.type === 'text-delta') {
        const trace = traces[sdkTraceStep - 1];
        if (trace) trace.sdkTextAfterHermes += part.text;
      }
      if (part.type === 'tool-call' || part.type === 'tool-result') {
        if (part.providerExecuted || part.toolName !== 'getProbeMarker') {
          addEvent({ type: part.type, source: 'unexpected SDK tool; payload omitted', providerExecuted: part.providerExecuted ?? false });
          fail('Unexpected SDK tool identity/ownership');
          continue;
        }
        const event = { type: part.type, toolName: part.toolName, toolCallId: part.toolCallId,
          input: part.input, providerExecuted: part.providerExecuted ?? false,
          providerExecutedEmitted: part.providerExecuted !== undefined,
          ...part.type === 'tool-result' ? { output: part.output } : {} };
        addEvent(event);
      } else if (part.type.startsWith('tool-input-')) {
        if (part.type === 'tool-input-start' && part.toolName === 'getProbeMarker' && !part.providerExecuted) ordinaryToolInputIds.add(part.id);
        const id = record(part).id;
        if (typeof id === 'string' && ordinaryToolInputIds.has(id)) addEvent(part);
        else addEvent({ type: part.type, source: 'unrecognized/native SDK tool input; payload omitted' });
      } else if (part.type === 'finish-step') {
        completedSteps++;
        addEvent({ step: completedSteps, finishReason: part.finishReason, rawFinishReason: part.rawFinishReason, modelId: part.response.modelId });
      } else if (part.type === 'finish') {
        addEvent({ finishReason: part.finishReason, rawFinishReason: part.rawFinishReason });
        assert.equal(part.finishReason, 'stop');
      } else if (part.type === 'text-delta') {
        finalText += part.text;
        assert.ok(finalText.length <= 12_000, 'Text evidence bound exceeded');
      } else if (['error', 'abort', 'tool-error', 'tool-output-denied', 'tool-approval-request'].includes(part.type)) {
        fail(part.type === 'error' ? safeError(part.error) : `SDK stream ${part.type}`);
      }
    }
    streamComplete = true;
    const steps = await result.steps;
    assert.equal(agentRuns, 1);
    assert.equal(modelCalls, 2);
    assert.equal(sdkStarts, 2);
    assert.equal(completedSteps, 2);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].finishReason, 'tool-calls');
    assert.equal(steps[1].finishReason, 'stop');
    assert.equal(steps[0].toolCalls.length, 1);
    assert.equal(steps[0].toolResults.length, 1);
    assert.equal(steps[1].toolCalls.length, 0);
    assert.equal(events.filter(event => record(event).type === 'tool-call').length, 1);
    assert.equal(events.filter(event => record(event).type === 'tool-result').length, 1);
    const call = steps[0].toolCalls[0];
    const returned = steps[0].toolResults[0];
    assert.equal(call.toolCallId, returned.toolCallId);
    assert.equal(call.toolName, 'getProbeMarker');
    assert.equal(returned.toolName, call.toolName);
    assert.ok(!call.providerExecuted && !returned.providerExecuted);
    assert.deepEqual(call.input, { request: 'marker' });
    assert.deepEqual(returned.input, call.input);
    const state = latch.snapshot();
    assert.equal(state.count, 1);
    assert.ok(state.output);
    assert.deepEqual(returned.output, state.output);
    markerMatches = steps[1].text.includes(state.output.marker) && steps[1].text.includes(state.output.noteId);
    assert.ok(markerMatches, 'Second model text loses callback marker or noteId');
    assert.equal(nativeEvents.length, 0);
    assert.equal(failures.length, 0);
    // These filtered observations cannot discharge the original exhaustive-visibility criterion.
    assert.ok(!abort.signal.aborted);
    const visibilityIssues = rawObservations.map(rawEvidenceIssue);
    assert.ok(visibilityIssues.length === 0, visibilityIssues.join('; '));
    verdict = 'PASS';
  } catch (error) {
    const message = safeError(error);
    failures.push(message);
    verdict = modelCalls === 0 || (turnStarts === 0 && /account\/read|authorization|authentication|not logged|thread\/start|model.*not.*support/i.test(message)) ? 'BLOCKED' : 'FAIL';
  } finally {
    clearTimeout(deadline);
    try { await provider.close(); closeResolved = true; } catch (error) { failures.push(`close: ${safeError(error)}`); }
    // close() does not await exit. The logger is driven by the child's exit event.
    await Promise.race([exited, delay(1500)]);
    try { await rm(cwd, { recursive: true, force: true }); tempRemoved = true; } catch (error) { failures.push(`temp removal: ${safeError(error)}`); }
    if (verdict === 'PASS' && (!closeResolved || !tempRemoved)) verdict = 'FAIL';
    let traceEvidence: { path?: string; status: string } | undefined;
    if (traceEnabled) {
      try { traceEvidence = { path: await saveBoundaryTraces(local, traces, finalText), status: 'written; private prompts omitted from normal report' }; }
      catch { traceEvidence = { status: 'write-failed; smoke verdict unchanged' }; }
    }
    const report = { verdict, phase, config: { ...config, codexPath: '[existing local Codex binary]' },
      agentRuns, modelCalls, sdkStarts, completedSteps, turnStarts, streamComplete, callback: latch.snapshot(),
      requests, events, rawCounts: Object.fromEntries(rawCounts), nativeEvents, finalText, markerMatches, failures,
      rawObservability: {
        source: 'SDK raw parts before Hermes; provider-emitted {method, params, id} after schema/thread filtering',
        invocations: rawObservations.map(observation => ({ ...observation, assessment: rawEvidenceIssue(observation) })),
        completeNativeVisibility: false,
        absenceOfNativeToolsProven: false,
        limitations: 'Other threads and malformed notifications may be excluded. Unknown shapes are gaps, not asserted executions. metadataToolCalls counts only completed mapTool-supported types, separately from raw observations.',
      },
      ...(traceEvidence ? { traceEvidence } : {}),
      cleanup: { closeResolved, tempRemoved, childExit: exitEvents.length ? exitEvents : 'child-exit-unverified',
        closeContract: 'Clears pending RPC/timers/reader, sends SIGTERM, drops child reference; does not await exit.' },
      limitations: ['Native tools are observable, not architecturally disabled.', 'Raw summaries omit content; protocol completeness is not guaranteed.', 'Counts bound SDK/provider invocations; internal server/network attempts are not independently observable.', 'Existing user Codex configuration/auth is inherited; no MCP servers configured by this probe.'],
    };
    await writeFile(new URL('live-report.json', local), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (verdict !== 'PASS') process.exitCode = 1;
  }
}

if (process.argv[2] === '--dry-run' && process.argv.length === 3) await dryRun();
else if (process.argv[2] === '--live' && process.argv.length === 3) await live();
else throw new Error('Choose exactly --dry-run or --live; live is one-shot and requires explicit owner authorization');
