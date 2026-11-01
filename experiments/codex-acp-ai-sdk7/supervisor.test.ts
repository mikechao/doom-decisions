import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { executeAgentOperation, type AgentClientOptions } from '../../scripts/doom-agent-client.ts';
import { validAgentCommand, type AgentConfiguration, type AgentRunState } from '../../app/src/agent-control.ts';
import type { AgentDecisionResult, AgentObservation } from '../../app/src/agent-observation.ts';
import { buildDefaultDecisionRequest } from '../../app/src/decision-request.ts';
import type { DecisionDiagnostics, DecisionLifecycle } from '../../app/src/decision-provider.ts';
import { createCLIPorts } from './supervisor-cli.ts';
import { liveDecision, liveObserve, parseLease } from './live-observation.ts';
import {
  composeGuidance,
  supervise,
  type SupervisorACP,
  type SupervisorMode,
  type SupervisorPorts,
} from './supervisor-workflow.ts';
import { supervisorMain } from './supervisor.ts';

function must<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value;
}

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const proposal = {
  target: 'Inspect the visible opening',
  visualEvidence: ['A dark opening is visible.'],
  telemetryEvidence: ['Health is 100.'],
  uncertainty: 'Traversability is unknown.',
  nextExperiment: 'Does the new perspective reveal continuity?',
};
const reassessment = {
  status: 'uncertain',
  visualEvidence: ['The new perspective still shows the opening.'],
  telemetryEvidence: ['Health remains 100.'],
  uncertainty: 'One action does not establish connectivity.',
  nextGuidance: null,
};
const firstGuidance = { ...proposal, target: 'GUIDANCE_ONE_ALPHA: inspect the opening' };
const nextReassessment = {
  ...reassessment,
  status: 'revise',
  nextGuidance: {
    target: 'GUIDANCE_TWO_BETA: inspect the newly visible wall edge',
    nextExperiment: 'Is the wall edge continuous in the new perspective?',
  },
};
type Wire = {
  model: string;
  provider: { allow_fallbacks: boolean };
  state: unknown[];
  questions: { next_action: { type: string; instructions: string; criteria: Record<string, null> } };
};

// Actual PNG bytes from synthetic flat RGBA only. No WAD, private screenshot,
// Worker or native runtime is imported or executed by this suite.
function syntheticPng(color: number) {
  const rgba = Buffer.alloc(640 * 400 * 4, color);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(640, 0);
  header.writeUInt32BE(400, 4);
  header[8] = 8;
  header[9] = 6;
  function chunk(name: string, bytes: Buffer) {
    const data = Buffer.concat([Buffer.from(name), bytes]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 8);
    result.writeUInt32BE(bytes.length);
    data.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  }
  const rows = Buffer.alloc(400 * 2561);
  for (let row = 0; row < 400; row++) rgba.copy(rows, row * 2561 + 1, row * 2560, (row + 1) * 2560);
  return {
    rgba,
    image: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  };
}
const firstPng = syntheticPng(1);
const lastPng = syntheticPng(2);

type Json = Record<string, unknown>;
type Fault = (op: string, data: Json, reply: Json, index: number) => void;
async function fixture(fault?: Fault, mode: SupervisorMode = 'one') {
  const root = await mkdtemp(join(tmpdir(), 'doom-supervisor-test-'));
  const pageId = randomUUID(),
    epoch = randomUUID(),
    sessionId = randomUUID();
  const mapHash = 'a'.repeat(64);
  const events: string[] = [],
    commands: { op: string; data: Json }[] = [];
  const generationInputs: Parameters<SupervisorACP['generate']>[0][] = [];
  const wires: Wire[] = [];
  const observations: AgentObservation[] = [];
  const originalFetch = globalThis.fetch;
  // Only the two-action fixture invokes the real provider/SDK. No fallback transport.
  if (mode === 'two') {
    globalThis.fetch = async (input) => {
      assert.ok(input instanceof Request);
      assert.equal(input.url, 'https://openrouter.ai/api/alpha/decisions');
      assert.equal(input.method, 'POST');
      assert.equal(input.headers.get('authorization'), 'Bearer offline-supervisor-dummy');
      wires.push(JSON.parse(await input.text()) as Wire);
      return Response.json({
        model: 'openai/gpt-6-luna-decisions',
        answers: { next_action: { type: 'choice', choice: 'turn_right' } },
        usage: { input_tokens: 123, output_tokens: 0 },
      });
    };
  }
  const provider =
    mode === 'two'
      ? (await import('../../app/src/openrouter-decision-provider.ts')).openRouterDecisionProviderFactory.create(
          'offline-supervisor-dummy',
        )
      : null;
  let ownerId: unknown,
    run: AgentRunState | null = null,
    revision = 0,
    tic = 1;
  let lastObservation: AgentObservation | undefined;
  let preWriteObservation: AgentObservation | undefined;
  let acpSession: string | null = null;
  let creates = 0,
    sdkCalls = 0,
    actionSelections = 0,
    captures = 0;
  let effectiveInstructions = '';
  const baseInstructions =
    'Human PRIVATE_BASE_DO_NOT_SEND instructions. Horizon {{tics}} tics; choose only the action.';
  const configuration: { -readonly [K in keyof AgentConfiguration]: AgentConfiguration[K] } = {
    instructionTemplate: baseInstructions,
    tics: 6,
    includeReadyWeapon: true,
    includeAmmo: false,
    includeHealth: true,
    includeFacingProbe: true,
    includePreviousAction: true,
  };
  function observation(): AgentObservation {
    const png = tic === 1 ? firstPng : lastPng;
    const digest = hash(png.rgba);
    return {
      observationId: randomUUID(),
      sessionId,
      tic,
      phase: 'ready',
      mapIdentity: {
        iwadSha256: mapHash,
        episode: 1,
        map: 1,
        mapSlot: 'E1M1',
        mapKey: `doom-map:v1:iwad-sha256:${mapHash}:E1M1`,
      },
      frame: { tic, nativeSha256: digest, canvasSha256: digest },
      counters: { gametic: tic, leveltime: tic, render: ++captures, frame: captures },
      telemetry: {
        health: 100,
        weaponId: 1,
        bullets: 50,
        shells: 0,
        cells: 0,
        rockets: 0,
        readyWeapon: { id: 1, name: 'pistol', ammoType: 'bullets' },
        ammo: {
          bullets: { current: 50, max: 200 },
          shells: { current: 0, max: 50 },
          cells: { current: 0, max: 300 },
          rockets: { current: 0, max: 50 },
        },
        x: 0,
        y: 0,
        angle: tic === 1 ? 0 : 123,
      },
      previousAction:
        tic === 1 ? null : { action: 'turn_right', tics: 6, endTic: tic, text: 'Mock controller verified a turn.' },
      facingProbe: null,
      png: `data:image/png;base64,${png.image.toString('base64')}`,
      pngSha256: hash(png.image),
    };
  }
  const snapshotConfig = () => ({ sessionId, revision, configuration: { ...configuration }, run: run && { ...run } });
  const transport: typeof fetch = async (url, init) => {
    const op = must(String(url).split('/').at(-1));
    const data = JSON.parse(String(init?.body)) as Json;
    events.push(op);
    commands.push({ op, data });
    let reply: Json;
    if (op === 'attach') {
      ownerId = data.ownerId;
      reply = { pageId, ownerId, epoch };
    } else {
      assert.equal(validAgentCommand(op, data), true);
      assert.deepEqual([data.pageId, data.ownerId, data.epoch], [pageId, ownerId, epoch]);
      const correlation = { pageId, epoch, commandId: data.commandId };
      if (op === 'observe') {
        lastObservation = observation();
        observations.push(lastObservation);
        reply = { ...correlation, observation: { ...lastObservation, ...snapshotConfig() } };
      } else if (op === 'start-run') {
        assert.equal(run, null);
        assert.equal(data.observationId, must(lastObservation).observationId);
        assert.equal(data.revision, revision);
        const limit = mode === 'two' ? 2 : 1;
        run = { runId: randomUUID(), active: true, limit, reserved: 0, sdkInvoked: 0, remaining: limit };
        reply = { ...correlation, config: snapshotConfig() };
      } else if (op === 'set-prompt') {
        assert.equal(data.runId, must(run).runId);
        assert.equal(data.revision, revision);
        preWriteObservation = lastObservation;
        configuration.instructionTemplate = String(data.instructions);
        revision++;
        lastObservation = undefined;
        reply = {
          ...correlation,
          prompt: { sessionId, revision, instructions: configuration.instructionTemplate, run: { ...run } },
        };
      } else if (op === 'decide') {
        // Minimal fake controller freshness/admission: old checkpoint cannot run.
        const reason =
          !run?.active || run.remaining === 0 || data.revision !== revision || data.runId !== run.runId
            ? 'no-grant'
            : data.observationId !== lastObservation?.observationId
              ? 'stale-observation'
              : null;
        if (reason) {
          const denied: AgentDecisionResult = {
            outcome: 'not-admitted',
            reason,
            beforeObservationId: String(data.observationId),
            sdkInvoked: false,
            action: null,
            requestedTics: null,
            reportedTics: null,
            verifiedTics: null,
            cumulativeTics: null,
            completionUncertain: false,
            requestIdentity: null,
            responseMetadata: null,
            observation: null,
          };
          return Response.json({ ...correlation, decision: denied });
        }
        assert.equal(data.sessionId, sessionId);
        const observed = must(lastObservation);
        const request = buildDefaultDecisionRequest(
          tic,
          6,
          observed.png,
          undefined,
          configuration,
          observed.telemetry,
          observed.previousAction ? { ...observed.previousAction, x: 0, y: 0 } : undefined,
        );
        effectiveInstructions = request.instructions;
        // Only this fake provider/controller chooses the action; host command
        // schema contains no action override and request permits the stock set.
        assert.ok(request.permittedActions.includes('turn_right'));
        const bounded = must(run);
        bounded.reserved++;
        bounded.remaining = bounded.limit - bounded.reserved;
        lastObservation = undefined;
        if (provider) {
          const lifecycle: DecisionLifecycle = {};
          const diagnostics: DecisionDiagnostics = { requestId: null, http: null, latencyMs: null };
          const result = await provider.request(
            request,
            lifecycle,
            diagnostics,
            {
              assertFresh() {},
              beforeCreate() {
                sdkCalls++;
                bounded.sdkInvoked++;
              },
              onReadStateChange() {},
            },
            performance.now(),
          );
          await lifecycle.sdkRead;
          assert.ok(result.kind === 'choice');
          assert.equal(result.action, 'turn_right');
        } else {
          // Legacy one-action fake: this count is not SDK serialization evidence.
          sdkCalls++;
          bounded.sdkInvoked++;
        }
        actionSelections++;
        bounded.active = bounded.remaining > 0;
        tic += 6;
        const decision: AgentDecisionResult = {
          outcome: 'completed',
          reason: null,
          beforeObservationId: String(data.observationId),
          sdkInvoked: true,
          action: 'turn_right',
          requestedTics: 6,
          reportedTics: 6,
          verifiedTics: 6,
          cumulativeTics: tic,
          completionUncertain: false,
          requestIdentity: { provider: 'OpenRouter', requestedModel: 'mock-model' },
          responseMetadata: null,
          observation: observation(),
        };
        reply = { ...correlation, decision };
      } else if (op === 'get-config') reply = { ...correlation, config: snapshotConfig() };
      else assert.fail(`Unexpected operation ${op}`);
    }
    fault?.(op, data, must(reply), commands.filter((call) => call.op === op).length);
    return Response.json(must(reply));
  };
  let generation: SupervisorACP['generate'] = async (input) => {
    input.onCallStart();
    return modelResult(
      JSON.stringify(
        generationInputs.length === 1
          ? mode === 'two'
            ? firstGuidance
            : proposal
          : mode === 'two'
            ? nextReassessment
            : reassessment,
      ),
    );
  };
  function clientOptions(signal: AbortSignal): AgentClientOptions {
    return {
      temporaryRoot: root,
      transport: (url, init) => {
        assert.equal(signal.aborted, false);
        return transport(url, init);
      },
    };
  }
  const ports: SupervisorPorts = {
    attach: (signal) => executeAgentOperation({ op: 'attach' }, clientOptions(signal)),
    observe: (input, signal) => executeAgentOperation({ op: 'observe', ...input }, clientOptions(signal)),
    setPrompt: (input, signal) => executeAgentOperation({ op: 'set-prompt', ...input }, clientOptions(signal)),
    startRun: (input, signal) => executeAgentOperation({ op: 'start-run', ...input }, clientOptions(signal)),
    decide: (input, signal) => executeAgentOperation({ op: 'decide', ...input }, clientOptions(signal)),
    getConfig: (input, signal) => executeAgentOperation({ op: 'get-config', ...input }, clientOptions(signal)),
    readPng: (path, signal) => readFile(path, { signal }),
    async writeInstructions(text) {
      const path = join(root, `instructions-${commands.filter((call) => call.op === 'set-prompt').length + 1}.txt`);
      await writeFile(path, text, { flag: 'wx', mode: 0o600 });
      return path;
    },
    async createACP() {
      creates++;
      events.push('create');
      return {
        async connect() {
          events.push('connect');
        },
        async initSession() {
          events.push('init');
          acpSession = 'private-acp-session';
          return { sessionId: acpSession };
        },
        getSessionId: () => acpSession,
        async generate(input) {
          events.push(`ACP${generationInputs.length + 1}`);
          generationInputs.push(input);
          return generation(input);
        },
        cleanup() {
          events.push('cleanup');
          acpSession = null;
        },
      };
    },
  };
  return {
    root,
    ports,
    events,
    commands,
    generationInputs,
    wires,
    observations,
    transport,
    configuration,
    baseInstructions,
    setGeneration(fn: typeof generation) {
      generation = fn;
    },
    changeACPSession() {
      acpSession = 'changed-session';
    },
    get creates() {
      return creates;
    },
    get sdkCalls() {
      return sdkCalls;
    },
    get actionSelections() {
      return actionSelections;
    },
    get effectiveInstructions() {
      return effectiveInstructions;
    },
    get preWriteObservation() {
      return must(preWriteObservation);
    },
    async dispose() {
      if (mode === 'two') globalThis.fetch = originalFetch;
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function using<T>(
  work: (h: Awaited<ReturnType<typeof fixture>>) => Promise<T>,
  fault?: Fault,
  mode: SupervisorMode = 'one',
) {
  const h = await fixture(fault, mode);
  try {
    return await work(h);
  } finally {
    await h.dispose();
  }
}

type Generation = Awaited<ReturnType<SupervisorACP['generate']>>;
const unexpectedToolCall: Generation['dynamicToolCalls'][number] = {
  type: 'tool-call',
  toolCallId: 'fake-tool-call',
  toolName: 'unexpected-tool',
  input: {},
  dynamic: true,
};

// A complete synthetic one-step SDK result. Missing usage stays unavailable;
// placeholder IDs, timestamp and performance values are not live evidence.
function modelResult(
  text: string,
  finishReason: Generation['finishReason'] = 'stop',
  toolCalls: Generation['dynamicToolCalls'] = [],
  rawFinishReason: Generation['rawFinishReason'] = 'end_turn',
): Generation {
  const usage: Generation['usage'] = {
    inputTokens: undefined,
    inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
    outputTokens: undefined,
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    totalTokens: undefined,
  };
  const step: Generation['steps'][number] = {
    callId: 'fake-call',
    stepNumber: 0,
    model: { provider: 'acp', modelId: 'fake-model' },
    toolsContext: {},
    runtimeContext: {},
    content: [{ type: 'text', text }, ...toolCalls],
    text,
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    toolCalls,
    staticToolCalls: [],
    dynamicToolCalls: toolCalls,
    toolResults: [],
    staticToolResults: [],
    dynamicToolResults: [],
    finishReason,
    rawFinishReason,
    usage,
    performance: {
      effectiveOutputTokensPerSecond: 0,
      outputTokensPerSecond: undefined,
      inputTokensPerSecond: undefined,
      effectiveTotalTokensPerSecond: 0,
      stepTimeMs: 0,
      responseTimeMs: 0,
      toolExecutionMs: {},
      timeToFirstOutputMs: undefined,
    },
    warnings: undefined,
    request: {},
    response: { id: 'fake-response', timestamp: new Date(0), modelId: 'fake-model', messages: [] },
    providerMetadata: undefined,
  };
  return {
    ...step,
    // Aggregate reasoning uses SDK output types rather than step content-part types.
    reasoning: [],
    totalUsage: usage,
    responseMessages: step.response.messages,
    steps: [step],
    finalStep: step,
    output: text,
  };
}

function setReassessmentText(h: Awaited<ReturnType<typeof fixture>>, text: unknown) {
  h.setGeneration(async (input) => {
    input.onCallStart();
    if (h.generationInputs.length === 1) return modelResult(JSON.stringify(proposal));
    const result = modelResult(typeof text === 'string' ? text : '');
    // Deliberately violate only the external text contract for malformed-output tests.
    if (typeof text !== 'string') Object.defineProperty(result, 'text', { value: text });
    return result;
  });
}

function assertNoReplay(h: Awaited<ReturnType<typeof fixture>>, report: Awaited<ReturnType<typeof supervise>>) {
  assert.equal(report.outcome, 'failed');
  assert.equal(report.reassessment, null);
  assert.equal(report.startRunCalls, 1);
  assert.equal(report.decideCalls, 1);
  assert.ok(report.supervisorCalls <= 2);
  assert.equal(h.sdkCalls, 1);
  assert.equal(h.actionSelections, 1);
  assert.deepEqual(
    h.commands.map((call) => call.op),
    ['attach', 'observe', 'start-run', 'set-prompt', 'observe', 'decide', 'get-config'],
  );
  assert.deepEqual(report.accounting, { active: false, limit: 1, reserved: 1, sdkInvoked: 1, remaining: 0 });
  assert.equal(report.noFurtherGameplayScheduled, true);
  assert.equal(report.humanStopRequired, true);
  assert.equal(h.events.at(-1), 'cleanup');
  assert.match(report.cleanup, /returned-session-cleared/);
}

const canaries = [
  'CANARY_UNEXPECTED_KEY',
  'CANARY_PRIVATE_VALUE',
  'CANARY_SCREENSHOT.png',
  'https://canary.invalid/private',
  'sk-CANARY_SECRET_TOKEN',
  '/private/CANARY_PATH',
];
const privateText = canaries.join(' ');

function assertRedacted(report: Awaited<ReturnType<typeof supervise>>) {
  const serialized = JSON.stringify(report);
  for (const canary of canaries) assert.ok(!serialized.includes(canary));
  const diagnostic = must(report.reassessmentDiagnostic);
  assert.deepEqual(
    Object.keys(diagnostic).sort(),
    [
      'inputIsString',
      'utf8BytesUpTo8193',
      'byteLimitExceeded',
      'hasFenceMarker',
      'jsonParsed',
      'rootType',
      'keysPresent',
      'unexpectedKeyCount',
      'statusValid',
      'delegatedByteLimitExceeded',
      'fieldTextOverLimit',
      'evidenceCountOverLimit',
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(diagnostic.keysPresent).sort(),
    ['status', 'visualEvidence', 'telemetryEvidence', 'uncertainty', 'nextGuidance'].sort(),
  );
  assert.ok(JSON.stringify(diagnostic).length < 600);
  assert.ok(diagnostic.utf8BytesUpTo8193 === null || diagnostic.utf8BytesUpTo8193 <= 8193);
  return diagnostic;
}

test('happy path uses typed executor with fake HTTP/controller and exactly one provider action', async () =>
  using(async (h) => {
    const report = await supervise(h.ports);
    assert.equal(report.outcome, 'completed');
    assert.deepEqual(h.events, [
      'attach',
      'observe',
      'create',
      'connect',
      'init',
      'ACP1',
      'start-run',
      'set-prompt',
      'observe',
      'decide',
      'get-config',
      'ACP2',
      'cleanup',
    ]);
    assert.equal(h.creates, 1);
    assert.equal(report.acpSessions, 1);
    assert.equal(report.sameACPSession, true);
    assert.deepEqual(report.reassessment, reassessment);
    assert.equal(report.reassessmentDiagnostic, null);
    assert.equal(report.errorCategory, null);
    assert.equal(report.startRunCalls, 1);
    assert.equal(report.decideCalls, 1);
    assert.equal(report.supervisorCalls, 2);
    assert.equal(h.sdkCalls, 1);
    assert.equal(h.actionSelections, 1);
    assert.equal(report.decisions[0].action, 'turn_right');
    assert.equal(report.verifiedActions, 1);
    assert.equal(report.decisions[0].verifiedTics, 6);
    assert.equal(report.decisions[0].cumulativeTics, 7);
    assert.deepEqual(report.accounting, { active: false, limit: 1, reserved: 1, sdkInvoked: 1, remaining: 0 });
    assert.deepEqual(report.supervisorUsage, ['unavailable', 'unavailable']);
    assert.equal(report.decisions[0].usage, 'unavailable');
    assert.equal(report.totalCost, 'unavailable');
    assert.equal(report.achievement, 'advisory-only; never engine-verified');
    assert.match(must(report.guidance.at(-1)), /lease-local-retained/);
    assert.match(report.cleanup, /exit-unverified/);
    assert.ok(h.configuration.instructionTemplate.startsWith(h.baseInstructions));
    assert.ok(h.configuration.instructionTemplate.includes('{{tics}}'));
    assert.ok(h.effectiveInstructions.includes('Horizon 6 tics'));
    assert.ok(h.effectiveInstructions.includes(proposal.target));
    assert.ok(!h.effectiveInstructions.includes('{{tics}}'));
    const decide = must(h.commands.find((call) => call.op === 'decide')).data;
    assert.equal(decide.revision, 1);
    assert.notEqual(decide.observationId, h.preWriteObservation.observationId);
    assert.equal(Object.hasOwn(decide, 'action'), false);
    assert.ok(h.generationInputs[1].image instanceof Uint8Array);
    assert.deepEqual(h.generationInputs[1].image, lastPng.image);
    assert.match(h.generationInputs[1].text, /ORIGINAL_OBJECTIVE=/);
    assert.ok(h.generationInputs[1].text.includes(proposal.target));
    for (const input of h.generationInputs) {
      for (const secret of [
        'PRIVATE_BASE_DO_NOT_SEND',
        h.root,
        'private-acp-session',
        'leaseFile',
        'pngPath',
        'sessionId',
        'epoch',
        'instructionTemplate',
      ])
        assert.ok(!input.text.includes(secret));
    }
  }));

test('old observation after set-prompt is rejected without another provider invocation', async () =>
  using(async (h) => {
    const original = h.ports.decide;
    h.ports.decide = async (input, signal) => {
      // Separate fake-only stale admission probe before the healthy action.
      // It reaches the in-memory controller while the allowance is active.
      const denied = await original({ ...input, observationId: h.preWriteObservation.observationId }, signal);
      assert.equal(denied.reason, 'stale-observation');
      assert.equal(denied.sdkInvoked, false);
      assert.equal(h.sdkCalls, 0);
      return original(input, signal);
    };
    const report = await supervise(h.ports);
    assert.equal(report.outcome, 'completed');
    assert.equal(report.decideCalls, 1);
    assert.equal(h.sdkCalls, 1);
  }));

test('wrong lease/epoch, run, revision, limit or post-write freshness blocks decide', async () => {
  const faults: Fault[] = [
    (op, _data, reply) => {
      if (op === 'observe') reply.epoch = randomUUID();
    },
    (op, _data, reply) => {
      if (op === 'set-prompt')
        (reply.prompt as Json).run = { ...(reply.prompt as { run: AgentRunState }).run, runId: randomUUID() };
    },
    (op, _data, reply) => {
      if (op === 'start-run') (reply.config as Json).revision = 9;
    },
    (op, _data, reply) => {
      if (op === 'start-run') Object.assign((reply.config as { run: AgentRunState }).run, { limit: 2, remaining: 2 });
    },
    (op, _data, reply, index) => {
      if (op === 'observe' && index === 2) (reply.observation as Json).revision = 0;
    },
    (op, _data, reply) => {
      if (op === 'observe')
        (reply.observation as Json).run = {
          runId: randomUUID(),
          active: false,
          limit: 1,
          reserved: 1,
          sdkInvoked: 1,
          remaining: 0,
        };
    },
  ];
  for (const fault of faults)
    await using(async (h) => {
      const report = await supervise(h.ports);
      assert.notEqual(report.outcome, 'completed');
      assert.equal(report.decideCalls, 0);
      assert.equal(h.sdkCalls, 0);
      assert.ok(report.supervisorCalls <= 1);
    }, fault);
});

test('lost start-run or decide response is unknown and never retried', async () => {
  for (const lost of ['start-run', 'decide'])
    await using(
      async (h) => {
        const report = await supervise(h.ports);
        assert.equal(report.outcome, 'uncertain');
        assert.equal(report.humanStopRequired, true);
        assert.equal(h.commands.filter((call) => call.op === lost).length, 1);
        assert.equal(report.supervisorCalls, 1);
        assert.equal(report.accounting, null);
        assert.ok(!h.events.includes('get-config'));
        assert.ok(!h.events.includes('ACP2'));
        if (lost === 'start-run') {
          assert.equal(report.claim, 'unknown');
          assert.equal(report.decideCalls, 0);
        } else {
          assert.equal(report.decisions[0].delivery, 'unknown');
          assert.equal(h.sdkCalls, 1);
          assert.equal(report.verifiedActions, 0);
        }
      },
      (op) => {
        if (op === lost) throw new Error('private lost response payload');
      },
    );
});

test('typed mutations record attempts before dispatch failure or timeout and never replay', async () => {
  const operations = { startRun: 'start-run', setPrompt: 'set-prompt', decide: 'decide' } as const;
  for (const op of ['startRun', 'setPrompt', 'decide'] as const)
    for (const failure of ['throw', 'timeout'])
      await using(async (h) => {
        let calls = 0;
        h.ports[op] = () => {
          calls++;
          if (failure === 'throw') throw Error('private typed dispatch failure');
          return new Promise<never>(() => {});
        };
        const report = await supervise(h.ports, { stageMs: 100 });
        assert.equal(calls, 1);
        assert.equal(h.commands.filter((command) => command.op === operations[op]).length, 0);
        assert.equal(report.startRunCalls, 1);
        assert.equal(report.claim, op === 'startRun' ? 'unknown' : 'acknowledged');
        assert.equal(report.decideCalls, op === 'decide' ? 1 : 0);
        if (op === 'setPrompt') assert.deepEqual(report.guidance, ['application-unknown']);
        if (op === 'decide') assert.equal(report.decisions[0].delivery, 'unknown');
        assert.equal(report.outcome, 'uncertain');
        assert.equal(report.humanStopRequired, true);
        assert.equal(report.accounting, null);
        assert.equal(report.verifiedActions, 0);
        assert.equal(report.errorCategory, failure === 'throw' ? 'CLI_FAILED' : 'HOST_DEADLINE');
        assert.ok(!JSON.stringify(report).includes('private typed dispatch failure'));
        assert.ok(!h.events.includes('get-config'));
        assert.ok(!h.events.includes('ACP2'));
      });
});

test('early Stop, model failure, malformed proposal, or changed ACP session prevents claim', async () => {
  for (const kind of ['stop', 'failure', 'invalid', 'session', 'tool', 'duplicate-call'])
    await using(async (h) => {
      if (kind === 'stop')
        h.ports.observe = async () => {
          throw new Error('agent-stopped');
        };
      else
        h.setGeneration(async (input) => {
          input.onCallStart();
          if (kind === 'failure') throw new Error('private provider failure');
          if (kind === 'session') h.changeACPSession();
          if (kind === 'duplicate-call') input.onCallStart();
          return modelResult(
            kind === 'invalid' ? '{}' : JSON.stringify(proposal),
            'stop',
            kind === 'tool' ? [unexpectedToolCall] : [],
          );
        });
      const report = await supervise(h.ports);
      assert.notEqual(report.outcome, 'completed');
      assert.equal(report.startRunCalls, 0);
      assert.equal(report.decideCalls, 0);
      assert.ok(!JSON.stringify(report).includes('private provider failure'));
    });
});

test('never-settling ACP turn, startup, and external cancellation finish without scheduling gameplay', async () => {
  for (const kind of ['turn', 'startup', 'cancel', 'overall'])
    await using(async (h) => {
      const abort = new AbortController();
      if (kind === 'startup') h.ports.createACP = async () => new Promise(() => {});
      else
        h.setGeneration(async (input) => {
          input.onCallStart();
          if (kind === 'cancel') abort.abort();
          return new Promise(() => {});
        });
      const report = await supervise(h.ports, {
        signal: abort.signal,
        stageMs: kind === 'overall' ? 1000 : 30,
        overallMs: kind === 'overall' ? 40 : 1000,
      });
      assert.notEqual(report.outcome, 'completed');
      assert.equal(report.startRunCalls, 0);
      assert.equal(report.decideCalls, 0);
      assert.ok(['HOST_CANCELLED', 'HOST_DEADLINE'].includes(must(report.errorCategory)));
      assert.equal(report.humanStopRequired, true);
    });
});

test('late ACP completion after deadline cannot continue the workflow', async () =>
  using(async (h) => {
    let release: ((value: Awaited<ReturnType<SupervisorACP['generate']>>) => void) | undefined;
    h.setGeneration((input) => {
      input.onCallStart();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const report = await supervise(h.ports, { stageMs: 50 });
    assert.equal(report.errorCategory, 'HOST_DEADLINE');
    must(release)(modelResult(JSON.stringify(proposal)));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.commands.filter((call) => call.op === 'start-run').length, 0);
    assert.equal(report.decideCalls, 0);
  }));

test('cancellation after claim and an unresolved decide leave no continuation or retry', async () => {
  for (const kind of ['after-claim', 'during-decide'])
    await using(async (h) => {
      const abort = new AbortController();
      const setPrompt = h.ports.setPrompt;
      h.ports.setPrompt = async (input, signal) => {
        const result = await setPrompt(input, signal);
        if (kind === 'after-claim') abort.abort();
        return result;
      };
      const original = h.ports.decide;
      h.ports.decide = async (input, signal) => {
        const result = await original(input, signal);
        if (kind === 'during-decide') return new Promise(() => {});
        return result;
      };
      const report = await supervise(h.ports, { signal: abort.signal, stageMs: 50 });
      assert.equal(report.outcome, 'uncertain');
      assert.equal(report.humanStopRequired, true);
      assert.equal(report.startRunCalls, 1);
      assert.equal(report.supervisorCalls, 1);
      assert.equal(report.decideCalls, kind === 'after-claim' ? 0 : 1);
      assert.equal(report.accounting, null);
      assert.ok(!h.events.includes('get-config'));
      assert.ok(!h.events.includes('ACP2'));
      assert.equal(report.verifiedActions, 0);
    });
});

test('corrupt initial/fresh files fail before their dependent ACP/admission call', async () => {
  for (const where of ['initial', 'fresh'])
    await using(async (h) => {
      const read = h.ports.readPng;
      let reads = 0;
      h.ports.readPng = async (path, signal) => {
        reads++;
        return reads === (where === 'initial' ? 1 : 2) ? Buffer.from('corrupt') : read(path, signal);
      };
      const report = await supervise(h.ports);
      assert.notEqual(report.outcome, 'completed');
      assert.equal(report.decideCalls, 0);
      assert.equal(report.supervisorCalls, where === 'initial' ? 0 : 1);
      assert.equal(h.creates, where === 'initial' ? 0 : 1);
    });
});

test('cleanup failure cannot claim successful session cleanup or cause a second decision', async () =>
  using(async (h) => {
    const create = h.ports.createACP;
    h.ports.createACP = async (signal) => ({
      ...(await create(signal)),
      cleanup() {
        throw new Error('private cleanup failure');
      },
    });
    const report = await supervise(h.ports);
    assert.equal(report.outcome, 'uncertain');
    assert.match(report.cleanup, /cleanup-failed/);
    assert.equal(report.decideCalls, 1);
    assert.equal(report.supervisorCalls, 2);
    assert.equal(h.sdkCalls, 1);
    assert.ok(!JSON.stringify(report).includes('private cleanup failure'));
  }));

test('bad decision, terminal outcome or accounting forbids reassessment and any second action', async () => {
  for (const kind of ['map', 'session', 'hash', 'accounting', 'terminal', 'stop'])
    await using(
      async (h) => {
        const report = await supervise(h.ports);
        assert.notEqual(report.outcome, 'completed');
        assert.equal(report.decideCalls, 1);
        assert.equal(report.supervisorCalls, 1);
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.events.filter((event) => event === 'decide').length, 1);
        if (kind === 'terminal' || kind === 'stop') assert.ok(!h.events.includes('get-config'));
      },
      (op, _data, reply) => {
        if (op === 'decide') {
          const receipt = reply.decision as AgentDecisionResult;
          if (kind === 'map') {
            must(receipt.observation).mapIdentity.iwadSha256 = 'b'.repeat(64);
            must(receipt.observation).mapIdentity.mapKey = `doom-map:v1:iwad-sha256:${'b'.repeat(64)}:E1M1`;
          }
          if (kind === 'session') must(receipt.observation).sessionId = randomUUID();
          if (kind === 'hash') must(receipt.observation).pngSha256 = '0'.repeat(64);
          if (kind === 'terminal') {
            receipt.outcome = 'terminal';
            must(receipt.observation).phase = 'terminal';
            must(receipt.observation).previousAction = null;
            must(receipt.observation).telemetry.health = 0;
          }
          if (kind === 'stop') throw new Error('agent-stopped');
        }
        if (op === 'get-config' && kind === 'accounting') (reply.config as { run: AgentRunState }).run.sdkInvoked = 0;
      },
    );
});

test('reassessment remains advisory; invalid status/evidence cannot become verified achievement', async () => {
  for (const patch of [
    { status: 'achieved' },
    { status: 'continue', nextGuidance: nextReassessment.nextGuidance },
    { status: 'revise', nextGuidance: nextReassessment.nextGuidance },
    { status: 'verified' },
    { status: ['achieved'] },
    { status: null },
    { visualEvidence: [] },
    { telemetryEvidence: [''] },
    { extra: true },
  ])
    await using(async (h) => {
      h.setGeneration(async (input) => {
        input.onCallStart();
        return modelResult(JSON.stringify(h.generationInputs.length === 1 ? proposal : { ...reassessment, ...patch }));
      });
      const report = await supervise(h.ports);
      const accepted = typeof patch.status === 'string' && ['achieved', 'continue', 'revise'].includes(patch.status);
      assert.equal(report.outcome, accepted ? 'completed' : 'failed');
      assert.equal(report.achievement, 'advisory-only; never engine-verified');
      assert.equal(report.decideCalls, 1);
      assert.equal(report.supervisorCalls, 2);
      assert.equal(h.sdkCalls, 1);
      assert.deepEqual(report.supervisorUsage, ['unavailable', 'unavailable']);
      assert.equal(report.reassessment?.status ?? null, accepted ? patch.status : null);
    });
});

test('fenced and malformed second responses have JSON-only rejection metadata', async () => {
  for (const text of [
    `\`\`\`json\n${JSON.stringify({ ...reassessment, uncertainty: privateText })}\n\`\`\``,
    `~~~json\n${privateText}\n~~~`,
    `{ ${JSON.stringify(privateText)}: }`,
    `${privateText}${'x'.repeat(9000)}`,
  ])
    await using(async (h) => {
      setReassessmentText(h, text);
      const report = await supervise(h.ports);
      assertNoReplay(h, report);
      assert.equal(report.errorCategory, 'INVALID_REASSESSMENT_JSON');
      assert.equal(report.sameACPSession, true);
      assert.equal(report.supervisorCalls, 2);
      assert.equal(report.supervisorUsage.length, 2);
      const diagnostic = assertRedacted(report);
      assert.equal(diagnostic.inputIsString, true);
      assert.equal(diagnostic.jsonParsed, false);
      assert.equal(diagnostic.rootType, null);
      assert.equal(diagnostic.utf8BytesUpTo8193, Math.min(Buffer.byteLength(text), 8193));
      assert.equal(diagnostic.byteLimitExceeded, Buffer.byteLength(text) > 8192);
      assert.equal(diagnostic.hasFenceMarker, text.includes('```') || text.includes('~~~'));
      assert.equal(diagnostic.unexpectedKeyCount, null);
    });
});

test('existing strict reassessment and delegated proposal rules keep shape rejections distinct', async () => {
  const privateReassessment = { ...reassessment, uncertainty: privateText };
  const cases: {
    value: unknown;
    missing?: string;
    extra?: number;
    textOver?: boolean;
    countOver?: boolean;
    byteOver?: boolean;
  }[] = [
    ...Object.keys(reassessment).map((missing) => ({
      value: Object.fromEntries(Object.entries(privateReassessment).filter(([key]) => key !== missing)),
      missing,
    })),
    { value: { ...privateReassessment, [canaries[0]]: privateText }, extra: 1 },
    { value: { ...privateReassessment, [canaries[0]]: privateText, [canaries[2]]: privateText }, extra: 2 },
    ...['verified', privateText, null, ['achieved'], 1].map((status) => ({
      value: { ...privateReassessment, status },
    })),
    ...[[], [''], ['   '], ['\u0000'], ['\u007f'], ['line\nbreak'], [12], privateText, null].flatMap((evidence) => [
      { value: { ...privateReassessment, visualEvidence: evidence } },
      { value: { ...privateReassessment, telemetryEvidence: evidence } },
    ]),
    ...['', '   ', '\t', '\u007f', 1, [], null].map((uncertainty) => ({ value: { ...reassessment, uncertainty } })),
    { value: { ...privateReassessment, visualEvidence: [privateText + 'x'.repeat(401)] }, textOver: true },
    { value: { ...privateReassessment, telemetryEvidence: [privateText + 'x'.repeat(401)] }, textOver: true },
    { value: { ...reassessment, uncertainty: privateText + 'x'.repeat(801) }, textOver: true },
    { value: { ...privateReassessment, visualEvidence: Array(6).fill(privateText) }, countOver: true },
    { value: { ...privateReassessment, telemetryEvidence: Array(6).fill(privateText) }, countOver: true },
    {
      value: {
        ...privateReassessment,
        visualEvidence: Array(5).fill('界'.repeat(400)),
        telemetryEvidence: Array(5).fill('界'.repeat(400)),
      },
      byteOver: true,
    },
    ...[null, [], privateText, true, 17].map((value) => ({ value })),
  ];
  for (const { value, missing, extra, textOver, countOver, byteOver } of cases)
    await using(async (h) => {
      setReassessmentText(h, JSON.stringify(value));
      const report = await supervise(h.ports);
      assertNoReplay(h, report);
      assert.equal(report.errorCategory, 'INVALID_REASSESSMENT_SHAPE');
      assert.equal(report.sameACPSession, true);
      assert.equal(report.supervisorCalls, 2);
      const diagnostic = assertRedacted(report);
      assert.equal(diagnostic.jsonParsed, true);
      assert.equal(diagnostic.rootType, value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
      assert.equal(diagnostic.byteLimitExceeded, byteOver ?? false);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        assert.deepEqual(diagnostic.keysPresent, {
          status: missing !== 'status',
          visualEvidence: missing !== 'visualEvidence',
          telemetryEvidence: missing !== 'telemetryEvidence',
          uncertainty: missing !== 'uncertainty',
          nextGuidance: missing !== 'nextGuidance',
        });
        assert.equal(diagnostic.unexpectedKeyCount, extra ?? 0);
        assert.equal(diagnostic.fieldTextOverLimit, textOver ?? false);
        assert.equal(diagnostic.evidenceCountOverLimit, countOver ?? false);
        assert.equal(diagnostic.statusValid, (value as Json).status === 'uncertain');
      }
    });
});

test('byte cap measures UTF-8; padding and delegated serialized-size rejection remain strict', async () => {
  const nearLimit = {
    ...reassessment,
    visualEvidence: Array(5).fill('é'.repeat(400)),
    telemetryEvidence: Array(5).fill('é'.repeat(400)),
    uncertainty: 'é'.repeat(20),
  };
  const delegated = {
    target: 'Reassess original objective',
    visualEvidence: nearLimit.visualEvidence,
    telemetryEvidence: nearLimit.telemetryEvidence,
    uncertainty: nearLimit.uncertainty,
    nextExperiment: 'No further gameplay authorized',
  };
  assert.ok(Buffer.byteLength(JSON.stringify(nearLimit)) <= 8192);
  assert.ok(Buffer.byteLength(JSON.stringify(delegated)) > 8192);
  for (const text of [JSON.stringify(nearLimit), ' '.repeat(8193) + JSON.stringify(reassessment)])
    await using(async (h) => {
      setReassessmentText(h, text);
      const report = await supervise(h.ports);
      assertNoReplay(h, report);
      assert.equal(report.errorCategory, 'INVALID_REASSESSMENT_SHAPE');
      const diagnostic = assertRedacted(report);
      assert.equal(diagnostic.jsonParsed, true);
      assert.equal(diagnostic.fieldTextOverLimit, false);
      assert.equal(diagnostic.byteLimitExceeded, Buffer.byteLength(text) > 8192);
      assert.equal(diagnostic.delegatedByteLimitExceeded, text === JSON.stringify(nearLimit));
      assert.equal(diagnostic.utf8BytesUpTo8193, Math.min(Buffer.byteLength(text), 8193));
    });
});

test('unsafe second-turn advisory text retains its separate category without retaining content', async () =>
  using(async (h) => {
    setReassessmentText(h, JSON.stringify({ ...reassessment, uncertainty: privateText }));
    const report = await supervise(h.ports);
    assertNoReplay(h, report);
    assert.equal(report.errorCategory, 'UNSAFE_ADVISORY_TEXT');
    assert.equal(report.sameACPSession, true);
    const diagnostic = assertRedacted(report);
    assert.equal(diagnostic.jsonParsed, true);
    assert.equal(diagnostic.rootType, 'object');
    assert.equal(diagnostic.unexpectedKeyCount, 0);
    assert.equal(diagnostic.statusValid, true);
  }));

test('non-string second-turn output is rejected without coercion or inspecting arbitrary objects', async () => {
  for (const value of [
    undefined,
    null,
    12,
    [privateText],
    {
      [canaries[0]]: privateText,
      toString() {
        throw new Error(privateText);
      },
    },
  ])
    await using(async (h) => {
      setReassessmentText(h, value);
      const report = await supervise(h.ports);
      assertNoReplay(h, report);
      assert.equal(report.errorCategory, 'INVALID_REASSESSMENT_SHAPE');
      assert.equal(report.sameACPSession, true);
      const diagnostic = assertRedacted(report);
      assert.equal(diagnostic.inputIsString, false);
      assert.equal(diagnostic.utf8BytesUpTo8193, null);
      assert.equal(diagnostic.jsonParsed, false);
      assert.equal(diagnostic.rootType, null);
    });
});

test('second checkpoint failures are never caught as reassessment JSON or shape failures', async () => {
  for (const kind of [
    'provider-json',
    'provider-shape',
    'session-before',
    'session-after',
    'tool',
    'finish',
    'raw-finish',
    'duplicate-call',
    'cancel',
    'deadline',
  ])
    await using(async (h) => {
      const abort = new AbortController();
      if (kind === 'session-before') {
        const original = h.ports.getConfig;
        h.ports.getConfig = async (input, signal) => {
          const result = await original(input, signal);
          h.changeACPSession();
          return result;
        };
      }
      h.setGeneration(async (input) => {
        input.onCallStart();
        if (h.generationInputs.length === 1) return modelResult(JSON.stringify(proposal));
        if (kind === 'provider-json') throw new SyntaxError(privateText);
        if (kind === 'provider-shape') throw new Error('INVALID_REASSESSMENT');
        if (kind === 'session-after') h.changeACPSession();
        if (kind === 'duplicate-call') input.onCallStart();
        if (kind === 'cancel') abort.abort();
        if (kind === 'deadline' || kind === 'cancel') return new Promise(() => {});
        // Vary each finish reason independently so neither guard can mask the other.
        return modelResult(
          `\`\`\`${privateText}`,
          kind === 'finish' ? 'length' : 'stop',
          kind === 'tool' ? [unexpectedToolCall] : [],
          kind === 'raw-finish' ? 'max_tokens' : 'end_turn',
        );
      });
      const report = await supervise(h.ports, { signal: abort.signal, stageMs: kind === 'deadline' ? 50 : 1000 });
      assertNoReplay(h, report);
      assert.equal(
        report.errorCategory,
        kind === 'cancel'
          ? 'HOST_CANCELLED'
          : kind === 'deadline'
            ? 'HOST_DEADLINE'
            : 'INVALID_EVIDENCE_OR_MODEL_RESULT',
      );
      assert.equal(report.sameACPSession, false);
      assert.equal(report.reassessmentDiagnostic, null);
      assert.equal(report.supervisorCalls, kind === 'session-before' ? 1 : 2);
      assert.equal(report.supervisorUsage.length, 1);
      for (const canary of canaries) assert.ok(!JSON.stringify(report).includes(canary));
    });
});

test('unexpected validator programming exceptions retain the generic category', async () => {
  for (const error of [new Error(privateText), new TypeError('INVALID_REASSESSMENT')])
    await using(async (h) => {
      const text = JSON.stringify(reassessment);
      setReassessmentText(h, text);
      const parse = JSON.parse;
      let reads = 0;
      JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
        if (args[0] === text && ++reads === 2) throw error;
        return parse(...args);
      };
      let report: Awaited<ReturnType<typeof supervise>>;
      try {
        report = await supervise(h.ports);
      } finally {
        JSON.parse = parse;
      }
      assertNoReplay(h, report);
      assert.equal(report.errorCategory, 'INVALID_EVIDENCE_OR_MODEL_RESULT');
      assert.equal(report.sameACPSession, true);
      assert.equal(report.reassessmentDiagnostic, null);
      for (const canary of canaries) assert.ok(!JSON.stringify(report).includes(canary));
    });
});

test('the final session guard is preserved independently of passed checkpoint boundary checks', async () =>
  using(async (h) => {
    const create = h.ports.createACP;
    h.ports.createACP = async (signal) => {
      const acp = await create(signal);
      let reads = 0;
      return {
        ...acp,
        getSessionId() {
          // Initial ID, two before/after checkpoint pairs, then final guard.
          if (++reads === 6) h.changeACPSession();
          return acp.getSessionId();
        },
      };
    };
    const report = await supervise(h.ports);
    assert.equal(report.outcome, 'failed');
    assert.equal(report.errorCategory, 'INVALID_EVIDENCE_OR_MODEL_RESULT');
    assert.equal(report.sameACPSession, true);
    assert.deepEqual(report.reassessment, reassessment);
    assert.equal(report.reassessmentDiagnostic, null);
    assert.equal(report.decideCalls, 1);
    assert.equal(report.supervisorCalls, 2);
    assert.equal(h.sdkCalls, 1);
    assert.equal(report.noFurtherGameplayScheduled, true);
    assert.equal(h.events.at(-1), 'cleanup');
  }));

test('a retired decision preserves its verified native prefix without claiming completed action or recovery', async () =>
  using(
    async (h) => {
      const report = await supervise(h.ports);
      assert.equal(report.outcome, 'uncertain');
      assert.equal(report.decisions[0].outcome, 'retired');
      assert.equal(report.decisions[0].delivery, 'validated-receipt');
      assert.equal(report.verifiedActions, 0);
      assert.equal(report.decisions[0].verifiedTics, 2);
      assert.equal(report.decisions[0].cumulativeTics, 3);
      assert.equal(report.decisions[0].completionUncertain, true);
      assert.equal(report.accounting, null);
      assert.equal(report.supervisorCalls, 1);
      assert.equal(report.decideCalls, 1);
      assert.ok(!h.events.includes('get-config'));
    },
    (op, _data, reply) => {
      if (op === 'decide')
        Object.assign(reply.decision as AgentDecisionResult, {
          outcome: 'retired',
          reportedTics: 3,
          verifiedTics: 2,
          cumulativeTics: 3,
          completionUncertain: true,
          observation: null,
        });
    },
  ));

test('adapter rejects bad PNG/materialization/DTO before ACP', async () =>
  using(async (h) => {
    const lease = parseLease(await h.ports.attach(new AbortController().signal));
    const raw = await h.ports.observe({ leaseFile: lease.leaseFile }, new AbortController().signal);
    const signal = new AbortController().signal;
    const base = await liveObserve(raw, lease, h.ports.readPng, signal);
    for (const patch of [
      { epoch: randomUUID() },
      { observationId: 'invalid' },
      { pngSha256: '0'.repeat(64) },
      { png: 'forbidden-inline-png' },
      { extra: 'private' },
      { telemetry: { ...base.observation.telemetry, extra: 'secret' } },
      { mapIdentity: { ...base.observation.mapIdentity, mapKey: 'wrong' } },
      { pngPath: '/private/some-other-file.png' },
      { frame: { ...base.observation.frame, canvasSha256: '0'.repeat(64) } },
    ])
      await assert.rejects(liveObserve({ ...raw, ...patch }, lease, h.ports.readPng, signal));
    await assert.rejects(
      liveObserve(
        raw,
        lease,
        async () => {
          throw new Error('missing PNG');
        },
        signal,
      ),
    );
    await assert.rejects(liveObserve(raw, lease, async () => Buffer.from('corrupt PNG'), signal));
    assert.equal(h.creates, 0);
    assert.ok(!JSON.stringify(base.payload).includes('PRIVATE_BASE_DO_NOT_SEND'));
    assert.notEqual(base.observation.pngSha256, base.observation.frame.nativeSha256);
  }));

test('adapter validates a post-decision DTO using its returned PNG without a new observe', async () =>
  using(async (h) => {
    let captured: Awaited<ReturnType<SupervisorPorts['decide']>> | undefined;
    const original = h.ports.decide;
    let lease: ReturnType<typeof parseLease> | undefined;
    let before: Awaited<ReturnType<typeof liveObserve>> | undefined;
    const attach = h.ports.attach;
    h.ports.attach = async (signal) => {
      const value = await attach(signal);
      lease = parseLease(value);
      return value;
    };
    const observe = h.ports.observe;
    h.ports.observe = async (input, signal) => {
      const value = await observe(input, signal);
      before = await liveObserve(value, must(lease), h.ports.readPng, signal);
      return value;
    };
    h.ports.decide = async (input, signal) => {
      const value = await original(input, signal);
      captured = value;
      return value;
    };
    assert.equal((await supervise(h.ports)).outcome, 'completed');
    const parsed = await liveDecision(
      must(captured),
      must(lease),
      must(before).observation,
      h.ports.readPng,
      new AbortController().signal,
    );
    assert.equal(must(parsed.receipt.observation).tic, 7);
    assert.deepEqual(parsed.image, lastPng.image);
    assert.equal(h.events.filter((event) => event === 'observe').length, 2);
  }));

test('no-live default/help/import reject network and ACP/process imports; malformed opt-in never launches', async () => {
  const launched: string[] = [],
    output: string[] = [];
  for (const args of [
    [],
    ['--help'],
    ['--live'],
    ['--live', '--authorize-one-decision'],
    ['--live', '--authorize-one-decision', '--trial', '../bad'],
  ]) {
    const code = await supervisorMain(
      args,
      async (id) => {
        launched.push(id);
        return 0;
      },
      (text) => {
        output.push(text);
      },
    );
    assert.equal(code, args.length === 0 || args[0] === '--help' ? 0 : 2);
  }
  assert.deepEqual([...launched], []);
  assert.equal(output.length, 5);
  await supervisorMain(['--live', '--authorize-one-decision', '--trial', 'fake-only'], async (id) => {
    launched.push(id);
    return 0;
  });
  assert.deepEqual(launched, ['fake-only']);
  const moduleUrl = new URL('./supervisor.ts', import.meta.url).href;
  const workflowUrl = new URL('./supervisor-workflow.ts', import.meta.url).href;
  const cliUrl = new URL('./supervisor-cli.ts', import.meta.url).href;
  const acpUrl = new URL('./supervisor-acp.ts', import.meta.url).href;
  const guard = `
    import fs from 'node:fs/promises';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    let attempted = false;
    function forbidden() { attempted = true; throw Error('Forbidden offline operation'); }
    process.on('exit', () => { if (attempted) process.exitCode = 99; });
    registerHooks({ resolve(s, c, next) {
      if (/^(ai$|@mcpc-tech\\/|@agentclientprotocol\\/|node:(child_process|http|https|net|tls|dns)$)/.test(s)) forbidden();
      return next(s,c);
    }});
    for (const name of ['mkdir', 'mkdtemp', 'rm', 'writeFile']) fs[name] = forbidden;
    syncBuiltinESMExports();
    globalThis.fetch = forbidden;
  `;
  const source = `${guard}
    const cli = await import(${JSON.stringify(cliUrl)});
    const acp = await import(${JSON.stringify(acpUrl)});
    const cliPorts = cli.createCLIPorts('/unused-offline-trial');
    const createACP = acp.createACPPort('/unused-offline-cwd');
    for (const method of ['attach', 'observe', 'startRun', 'setPrompt', 'decide', 'getConfig'])
      if (typeof cliPorts[method] !== 'function') throw Error('Typed adapter factories failed');
    if ('cli' in cliPorts || typeof createACP !== 'function')
      throw Error('Adapter factories failed');
    await cliPorts.cleanup();
    const workflow = await import(${JSON.stringify(workflowUrl)});
    const legacy = await import(${JSON.stringify(moduleUrl)});
    if (legacy.supervise !== workflow.supervise || legacy.composeGuidance !== workflow.composeGuidance)
      throw Error('Workflow compatibility exports changed');
    if (await legacy.supervisorMain([]) !== 0) throw Error('Help failed');
  `;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', source], {
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /Offline by default/);
  const entryCases = [
    { args: [], code: 0 },
    { args: ['--help'], code: 0 },
    { args: ['--live'], code: 2 },
    { args: ['--live', '--authorize-one-decision', '--trial', '../bad'], code: 2 },
    { args: ['--live', '--authorize-one-decision', '--trial', 'fake-only', '--extra'], code: 2 },
  ];
  for (const { args, code } of entryCases) {
    const entry = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--import',
        `data:text/javascript,${encodeURIComponent(guard)}`,
        fileURLToPath(moduleUrl),
        ...args,
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(entry.status, code, entry.stderr);
    assert.match(entry.stdout, /Offline by default/);
  }
});

// New-boundary cases retain the real CLI, request builder, OpenRouter provider
// and installed SDK. Only broker/controller/native and ACP are synthetic.
test('two-action feedback reaches two SDK-serialized HTTP bodies with replacement guidance', async () =>
  using(
    async (h) => {
      const report = await supervise(h.ports, { mode: 'two' });
      assert.equal(
        report.outcome,
        'completed',
        JSON.stringify({
          stage: report.stage,
          error: report.errorCategory,
          transport: report.transportError,
          events: h.events,
          wires: h.wires.length,
        }),
      );
      assert.deepEqual(h.events, [
        'attach',
        'observe',
        'create',
        'connect',
        'init',
        'ACP1',
        'start-run',
        'set-prompt',
        'observe',
        'decide',
        'observe',
        'ACP2',
        'set-prompt',
        'observe',
        'decide',
        'get-config',
        'cleanup',
      ]);
      assert.equal(report.startRunCalls, 1);
      assert.equal(report.decideCalls, 2);
      assert.equal(report.supervisorCalls, 2);
      assert.equal(report.providerCallStarts, 2);
      assert.equal(report.acpSessionStarts, 1);
      assert.equal(report.sameACPSession, true);
      assert.equal(h.creates, 1);
      assert.equal(h.sdkCalls, 2);
      assert.equal(report.verifiedActions, 2);
      assert.deepEqual(report.interimAccounting, { active: true, limit: 2, reserved: 1, sdkInvoked: 1, remaining: 1 });
      assert.deepEqual(report.accounting, { active: false, limit: 2, reserved: 2, sdkInvoked: 2, remaining: 0 });
      assert.deepEqual(
        report.decisions.map((d) => [
          d.delivery,
          d.outcome,
          d.sdkInvoked,
          d.requestedTics,
          d.reportedTics,
          d.verifiedTics,
          d.cumulativeTics,
        ]),
        [
          ['validated-receipt', 'completed', true, 6, 6, 6, 7],
          ['validated-receipt', 'completed', true, 6, 6, 6, 13],
        ],
      );
      const writes = h.commands.filter((c) => c.op === 'set-prompt');
      const decisions = h.commands.filter((c) => c.op === 'decide');
      assert.deepEqual(
        writes.map((c) => c.data.revision),
        [0, 1],
      );
      assert.deepEqual(
        decisions.map((c) => c.data.revision),
        [1, 2],
      );
      assert.equal(new Set(writes.concat(decisions).map((c) => c.data.runId)).size, 1);
      assert.equal(new Set(h.observations.map((o) => o.observationId)).size, 4);
      assert.deepEqual(
        decisions.map((c) => c.data.observationId),
        [h.observations[1].observationId, h.observations[3].observationId],
      );
      assert.ok(decisions.every((c) => !Object.hasOwn(c.data, 'action') && !Object.hasOwn(c.data, 'tics')));
      assert.match(h.generationInputs[1].text, /ORIGINAL_OBJECTIVE=.*GUIDANCE_ONE_ALPHA/);
      assert.match(h.generationInputs[1].text, /BEFORE=.*"tic":1/);
      assert.match(h.generationInputs[1].text, /AFTER=.*"tic":7/);
      assert.deepEqual(h.generationInputs[1].image, lastPng.image);
      assert.equal(h.wires.length, 2, 'Two actual Request bodies emitted by the pinned SDK');
      const expectedFirst = composeGuidance(h.baseInstructions, firstGuidance).replaceAll('{{tics}}', '6');
      const expectedSecond = composeGuidance(h.baseInstructions, {
        ...nextReassessment.nextGuidance,
        uncertainty: nextReassessment.uncertainty,
      }).replaceAll('{{tics}}', '6');
      assert.equal(h.wires[0].questions.next_action.instructions, expectedFirst);
      assert.equal(h.wires[1].questions.next_action.instructions, expectedSecond);
      const firstBlock = expectedFirst.slice(h.baseInstructions.replaceAll('{{tics}}', '6').length);
      assert.ok(!h.wires[1].questions.next_action.instructions.includes(firstBlock));
      assert.ok(!h.wires[1].questions.next_action.instructions.includes('GUIDANCE_ONE_ALPHA'));
      for (const [index, wire] of h.wires.entries()) {
        assert.equal(wire.model, 'openai/gpt-6-luna-decisions');
        assert.deepEqual(wire.provider, { allow_fallbacks: false }, 'SDK snake-case serialization');
        assert.equal(wire.questions.next_action.type, 'choice');
        assert.deepEqual(wire.questions.next_action.criteria, {
          neutral: null,
          forward: null,
          turn_right: null,
          backward: null,
          turn_left: null,
          fire: null,
          use: null,
        });
        assert.ok(wire.questions.next_action.instructions.startsWith(h.baseInstructions.replaceAll('{{tics}}', '6')));
        assert.ok(!wire.questions.next_action.instructions.includes('{{tics}}'));
        const state = String(wire.state[0]);
        assert.ok(state.startsWith(`Current rendered Doom frame at verified tic ${index === 0 ? 1 : 7}.`));
        assert.match(state, /Ready weapon: pistol/);
        assert.match(state, /Health: 100/);
        assert.ok(!state.includes('Ammo:'));
        assert.equal(state.includes('Mock controller verified a turn.'), index === 1);
        assert.deepEqual(wire.state[1], {
          type: 'image_url',
          image_url: { url: h.observations[index === 0 ? 1 : 3].png },
        });
      }
      const published = JSON.stringify(report);
      for (const secret of [
        h.root,
        h.baseInstructions,
        expectedFirst,
        expectedSecond,
        'offline-supervisor-dummy',
        'private-acp-session',
      ])
        assert.ok(!published.includes(secret));
      assert.equal(report.humanStopRequired, false);
    },
    undefined,
    'two',
  ));

test('two-action mode rejects incorrect allowance and interim/native/post-CAS evidence before second SDK call', async () => {
  const faults: Fault[] = [
    (op, _data, reply) => {
      if (op === 'start-run') Object.assign((reply.config as { run: AgentRunState }).run, { limit: 1, remaining: 1 });
    },
    (op, _data, reply, index) => {
      if (op === 'observe' && index === 3)
        Object.assign((reply.observation as { run: AgentRunState }).run, { sdkInvoked: 0 });
    },
    (op, _data, reply, index) => {
      if (op === 'observe' && index === 3) (reply.observation as AgentObservation).telemetry.x++;
    },
    (op, _data, reply, index) => {
      if (op === 'observe' && index === 3) (reply.observation as Json).revision = 0;
    },
    (op, _data, reply, index) => {
      if (op === 'observe' && index === 3)
        (reply.observation as { configuration: AgentConfiguration }).configuration = {
          ...(reply.observation as { configuration: AgentConfiguration }).configuration,
          includeAmmo: true,
        };
    },
    (op, _data, reply, index) => {
      if (op === 'set-prompt' && index === 2) (reply.prompt as Json).revision = 1;
    },
    (op, _data, reply, index) => {
      if (op === 'observe' && index === 4) (reply.observation as Json).revision = 1;
    },
    (op, _data, reply, index) => {
      if (op === 'observe' && index === 4) (reply.observation as AgentObservation).telemetry.angle++;
    },
  ];
  for (const [index, fault] of faults.entries())
    await using(
      async (h) => {
        const report = await supervise(h.ports, { mode: 'two' });
        assert.notEqual(report.outcome, 'completed');
        assert.equal(report.startRunCalls, 1);
        assert.equal(report.decideCalls, index === 0 ? 0 : 1);
        assert.equal(h.wires.length, index === 0 ? 0 : 1);
        assert.equal(report.verifiedActions, index === 0 ? 0 : 1);
        assert.equal(report.humanStopRequired, true);
      },
      fault,
      'two',
    );
});

test('second CAS invalidates its prior observation; stale CAS never reaches the SDK', async () => {
  for (const kind of ['cas', 'observation', 'reused-interim', 'reused-fresh'])
    await using(
      async (h) => {
        const setPrompt = h.ports.setPrompt;
        h.ports.setPrompt = (input, signal) =>
          setPrompt(
            kind === 'cas' && h.commands.filter((c) => c.op === 'set-prompt').length === 1
              ? { ...input, revision: 0 }
              : input,
            signal,
          );
        const decide = h.ports.decide;
        h.ports.decide = async (input, signal) => {
          if (kind === 'observation' && h.wires.length === 1) {
            const denied = await decide({ ...input, observationId: h.observations[2].observationId }, signal);
            assert.equal(denied.outcome, 'not-admitted');
            assert.equal(denied.sdkInvoked, false);
            return denied;
          }
          return decide(input, signal);
        };
        const observe = h.ports.observe;
        h.ports.observe = async (input, signal) => {
          const result = await observe(input, signal);
          if (
            (kind === 'reused-interim' && h.observations.length === 3) ||
            (kind === 'reused-fresh' && h.observations.length === 4)
          ) {
            result.observationId = h.observations[1].observationId;
          }
          return result;
        };
        const report = await supervise(h.ports, { mode: 'two' });
        assert.notEqual(report.outcome, 'completed');
        assert.equal(h.wires.length, 1);
        assert.equal(report.verifiedActions, 1);
        assert.equal(report.startRunCalls, 1);
        assert.equal(report.humanStopRequired, true);
        if (kind === 'observation') {
          // The supervisor also rejects the response's substituted observation correlation.
          assert.equal(report.decisions[1].delivery, 'unknown');
          assert.equal(report.decisions[1].sdkInvoked, null);
        }
      },
      undefined,
      'two',
    );
});

test('interim guidance must be strict, safe, different and from the same tool-free ACP session', async () => {
  for (const kind of [
    'continue',
    'missing',
    'null',
    'extra',
    'empty',
    'null-target',
    'oversize',
    'unsafe',
    'action',
    'use',
    'duration',
    'unknown',
    'unchanged',
    'session',
    'tool',
  ]) {
    await using(
      async (h) => {
        h.setGeneration(async (input) => {
          input.onCallStart();
          if (h.generationInputs.length === 1) return modelResult(JSON.stringify(firstGuidance));
          if (kind === 'session') h.changeACPSession();
          const value: Json = structuredClone(nextReassessment);
          if (kind === 'continue') value.status = 'continue';
          if (kind === 'missing') delete value.nextGuidance;
          if (kind === 'null') value.nextGuidance = null;
          if (kind === 'extra') value.nextGuidance = { ...nextReassessment.nextGuidance, action: 'turn_right' };
          if (kind === 'empty') value.nextGuidance = { ...nextReassessment.nextGuidance, target: ' ' };
          if (kind === 'null-target') value.nextGuidance = { ...nextReassessment.nextGuidance, target: null };
          if (kind === 'oversize') value.nextGuidance = { ...nextReassessment.nextGuidance, target: 'x'.repeat(801) };
          if (kind === 'unsafe')
            value.nextGuidance = { ...nextReassessment.nextGuidance, target: 'https://canary.invalid/private' };
          if (kind === 'action') value.nextGuidance = { ...nextReassessment.nextGuidance, target: 'turn_right' };
          if (kind === 'use') value.nextGuidance = { ...nextReassessment.nextGuidance, target: 'use' };
          if (kind === 'duration') value.uncertainty = 'Inspect for 6 tics';
          if (kind === 'unknown') value.status = 'unknown';
          if (kind === 'unchanged') {
            value.nextGuidance = { target: firstGuidance.target, nextExperiment: firstGuidance.nextExperiment };
            value.uncertainty = firstGuidance.uncertainty;
          }
          return modelResult(JSON.stringify(value), 'stop', kind === 'tool' ? [unexpectedToolCall] : []);
        });
        const report = await supervise(h.ports, { mode: 'two' });
        assert.equal(report.supervisorCalls, 2);
        assert.equal(report.acpSessionStarts, 1);
        assert.equal(report.startRunCalls, 1);
        assert.equal(h.wires.length, kind === 'continue' ? 2 : 1);
        if (kind === 'continue') assert.equal(report.outcome, 'completed');
        else {
          assert.notEqual(report.outcome, 'completed');
          assert.equal(report.humanStopRequired, true);
          assert.equal(report.accounting, null);
          assert.equal(report.interimAccounting?.remaining, 1);
          assert.equal(h.commands.filter((c) => c.op === 'set-prompt').length, 1);
          assert.equal(report.verifiedActions, 1);
        }
        if (kind === 'unchanged') assert.equal(report.errorCategory, 'UNCHANGED_GUIDANCE');
        if (kind === 'unsafe') assert.ok(!JSON.stringify(report).includes('https://canary.invalid'));
      },
      undefined,
      'two',
    );
  }
});

test('achieved/uncertain early exits retain active unused authority and require browser Stop Agent', async () => {
  for (const status of ['achieved', 'uncertain'])
    await using(
      async (h) => {
        h.setGeneration(async (input) => {
          input.onCallStart();
          return modelResult(
            JSON.stringify(h.generationInputs.length === 1 ? firstGuidance : { ...reassessment, status }),
          );
        });
        const report = await supervise(h.ports, { mode: 'two' });
        assert.equal(report.outcome, 'partial');
        assert.equal(report.stage, 'early-advisory-end');
        assert.equal(report.humanStopRequired, true);
        assert.deepEqual(report.interimAccounting, {
          active: true,
          limit: 2,
          reserved: 1,
          sdkInvoked: 1,
          remaining: 1,
        });
        assert.equal(report.accounting, null);
        assert.equal(report.verifiedActions, 1);
        assert.equal(report.decideCalls, 1);
        assert.equal(report.supervisorCalls, 2);
        assert.equal(h.wires.length, 1);
        assert.equal(h.commands.filter((c) => c.op === 'set-prompt').length, 1);
      },
      undefined,
      'two',
    );
});

test('Stop, terminal, partial or lost first mutation never schedules interim ACP or a second action', async () => {
  for (const kind of ['stop', 'terminal', 'partial', 'lost-start', 'lost-prompt', 'lost-decide'])
    await using(
      async (h) => {
        const report = await supervise(h.ports, { mode: 'two' });
        assert.notEqual(report.outcome, 'completed');
        const beforeDecision = kind === 'lost-start' || kind === 'lost-prompt';
        assert.equal(report.decideCalls, beforeDecision ? 0 : 1);
        assert.equal(h.wires.length, beforeDecision ? 0 : 1);
        for (const operation of ['start-run', 'set-prompt', 'decide'])
          assert.ok(h.commands.filter((command) => command.op === operation).length <= 1);
        assert.equal(report.supervisorCalls, 1);
        assert.equal(report.accounting, null);
        assert.equal(report.interimAccounting, null);
        if (kind === 'partial') {
          assert.equal(report.outcome, 'uncertain');
          assert.equal(report.decisions[0].verifiedTics, 2);
          assert.equal(report.decisions[0].reportedTics, 3);
          assert.equal(report.decisions[0].cumulativeTics, 3);
          assert.equal(report.verifiedActions, 0);
        }
        if (kind.startsWith('lost')) {
          assert.equal(report.outcome, 'uncertain');
          assert.equal(report.humanStopRequired, true);
        }
        if (kind === 'terminal') {
          assert.equal(report.outcome, 'terminal');
          assert.equal(report.decisions[0].requestedTics, 6);
          assert.equal(report.decisions[0].reportedTics, 2);
          assert.equal(report.decisions[0].verifiedTics, 2);
          assert.equal(report.verifiedActions, 0);
        }
        if (kind === 'stop') assert.equal(report.outcome, 'stopped');
      },
      (op, _data, reply) => {
        if (op === kind.replace('lost-', '')) throw Error('lost reply');
        if (kind === 'lost-start' && op === 'start-run') throw Error('lost reply');
        if (kind === 'lost-prompt' && op === 'set-prompt') throw Error('lost reply');
        if (op !== 'decide') return;
        if (kind === 'stop') throw Error('agent-stopped');
        const result = reply.decision as AgentDecisionResult;
        if (kind === 'terminal') {
          result.outcome = 'terminal';
          result.reportedTics = result.verifiedTics = 2;
          result.cumulativeTics = 3;
          must(result.observation).phase = 'terminal';
          must(result.observation).tic = 3;
          must(result.observation).frame.tic = 3;
          must(result.observation).counters.gametic = 3;
          must(result.observation).counters.leveltime = 3;
          must(result.observation).previousAction = null;
          must(result.observation).telemetry.health = 0;
        }
        if (kind === 'partial')
          Object.assign(result, {
            outcome: 'retired',
            reportedTics: 3,
            verifiedTics: 2,
            cumulativeTics: 3,
            completionUncertain: true,
            observation: null,
          });
      },
      'two',
    );
});

test('lost second CAS/decision responses remain uncertain despite valid interim accounting; never replay', async () => {
  for (const lost of ['set-prompt', 'decide'])
    await using(
      async (h) => {
        const report = await supervise(h.ports, { mode: 'two' });
        assert.equal(report.outcome, 'uncertain');
        assert.equal(report.humanStopRequired, true);
        assert.equal(report.interimAccounting?.remaining, 1);
        assert.equal(report.accounting, null);
        assert.equal(report.verifiedActions, 1);
        assert.equal(report.startRunCalls, 1);
        assert.equal(report.supervisorCalls, 2);
        assert.equal(h.commands.filter((c) => c.op === lost).length, 2);
        assert.equal(h.wires.length, lost === 'decide' ? 2 : 1);
        assert.equal(report.decideCalls, lost === 'decide' ? 2 : 1);
        if (lost === 'decide') {
          assert.equal(report.decisions[1].delivery, 'unknown');
          assert.equal(report.decisions[1].sdkInvoked, null);
          assert.equal(report.decisions[1].verifiedTics, null);
        } else assert.equal(report.guidance[1], 'application-unknown');
      },
      (op, _data, _reply, index) => {
        if (op === lost && index === 2) throw Error('lost reply');
      },
      'two',
    );
});

test('instruction files are distinct, exclusive 0600 and cleaned only after owned creation', async () => {
  for (const failure of ['none', 'exists', 'partial']) {
    const root = await mkdtemp(join(tmpdir(), 'doom-instructions-test-'));
    const originalFetch = globalThis.fetch;
    const files = createCLIPorts(root);
    try {
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        return Response.json({ pageId: randomUUID(), epoch: randomUUID(), ownerId: body.ownerId });
      };
      const signal = new AbortController().signal;
      const lease = parseLease(await files.attach(signal));
      const first = await files.writeInstructions('private synthetic first', signal);
      const secondPath = join(dirname(lease.leaseFile), 'supervisor-instructions-2.txt');
      assert.equal((await stat(first)).mode & 0o777, 0o600);
      if (failure === 'exists') {
        await writeFile(secondPath, 'preexisting owner evidence', { flag: 'wx' });
        await assert.rejects(files.writeInstructions('must not replace', signal), { code: 'EEXIST' });
      } else if (failure === 'partial') {
        // Inject a write failure after exclusive creation and actual prefix bytes.
        const { FileHandle } = await import('node:fs/promises').then(async (fs) => {
          const probe = await fs.open(join(root, 'probe'), 'wx');
          const prototype = Object.getPrototypeOf(probe);
          await probe.close();
          return { FileHandle: prototype };
        });
        const write = FileHandle.writeFile;
        FileHandle.writeFile = async function (this: Awaited<ReturnType<typeof import('node:fs/promises').open>>) {
          await write.call(this, 'partial private prefix');
          throw Error('synthetic disk write failure');
        };
        try {
          await assert.rejects(
            files.writeInstructions('private synthetic second', signal),
            /synthetic disk write failure/,
          );
        } finally {
          FileHandle.writeFile = write;
        }
        assert.equal(await readFile(secondPath, 'utf8'), 'partial private prefix');
      } else {
        const second = await files.writeInstructions('private synthetic second', signal);
        assert.notEqual(second, first);
        assert.equal((await stat(second)).mode & 0o777, 0o600);
        await assert.rejects(files.writeInstructions('third forbidden', signal));
      }
      await files.cleanup();
      await assert.rejects(readFile(first), { code: 'ENOENT' });
      if (failure === 'exists') assert.equal(await readFile(secondPath, 'utf8'), 'preexisting owner evidence');
      else await assert.rejects(readFile(secondPath), { code: 'ENOENT' });
      assert.equal(JSON.parse(await readFile(join(dirname(lease.leaseFile), 'lease.json'), 'utf8')).epoch, lease.epoch);
      assert.ok(await readFile(join(root, 'receipt-1.json')));
    } finally {
      globalThis.fetch = originalFetch;
      await files.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('live gates bind one/two independently and reject mixed or arbitrary authorization without launch', async () => {
  const launched: { id: string; mode: SupervisorMode }[] = [];
  const launch = async (id: string, mode: SupervisorMode) => {
    launched.push({ id, mode });
    return 0 as const;
  };
  for (const [flag, mode] of [
    ['--authorize-one-decision', 'one'],
    ['--authorize-two-decisions', 'two'],
  ] as const) {
    assert.equal(await supervisorMain(['--live', flag, '--trial', 'fake-only'], launch), 0);
    assert.deepEqual(launched.at(-1), { id: 'fake-only', mode });
  }
  for (const args of [
    ['--live', '--authorize-two-decisions'],
    ['--live', '--authorize-two-decisions', '--trial', '../bad'],
    ['--live', '--authorize-one-decision', '--authorize-two-decisions', '--trial', 'fake-only'],
    ['--live', '--authorize-three-decisions', '--trial', 'fake-only'],
  ])
    assert.equal(await supervisorMain(args, launch, () => {}), 2);
  assert.equal(launched.length, 2);
});
