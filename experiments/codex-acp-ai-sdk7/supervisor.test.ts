import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { runAgentCli } from '../../scripts/doom-agent.mjs';
import { validAgentCommand, type AgentConfiguration, type AgentRunState } from '../../app/src/agent-control.ts';
import type { AgentDecisionResult, AgentObservation } from '../../app/src/agent-observation.ts';
import { buildDefaultDecisionRequest } from '../../app/src/decision-request.ts';
import { liveDecision, liveObserve, parseLease } from './live-observation.ts';
import { supervise, supervisorMain, type SupervisorACP, type SupervisorPorts } from './supervisor.ts';

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
async function fixture(fault?: Fault) {
  const root = await mkdtemp(join(tmpdir(), 'doom-supervisor-test-'));
  const pageId = randomUUID(),
    epoch = randomUUID(),
    sessionId = randomUUID();
  const mapHash = 'a'.repeat(64);
  const events: string[] = [],
    commands: { op: string; data: Json }[] = [];
  const generationInputs: Parameters<SupervisorACP['generate']>[0][] = [];
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
        reply = { ...correlation, observation: { ...lastObservation, ...snapshotConfig() } };
      } else if (op === 'start-run') {
        assert.equal(run, null);
        assert.equal(data.observationId, must(lastObservation).observationId);
        assert.equal(data.revision, revision);
        run = { runId: randomUUID(), active: true, limit: 1, reserved: 0, sdkInvoked: 0, remaining: 1 };
        reply = { ...correlation, config: snapshotConfig() };
      } else if (op === 'set-prompt') {
        assert.equal(data.runId, must(run).runId);
        assert.equal(data.revision, revision);
        preWriteObservation = lastObservation;
        configuration.instructionTemplate = String(data.instructions);
        revision++;
        reply = {
          ...correlation,
          prompt: { sessionId, revision, instructions: configuration.instructionTemplate, run: { ...run } },
        };
      } else if (op === 'decide') {
        // Minimal fake controller freshness/admission: old checkpoint cannot run.
        const reason =
          !run?.active || run.remaining === 0 || data.revision !== revision || data.runId !== run.runId
            ? 'no-grant'
            : data.observationId !== must(lastObservation).observationId
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
        assert.equal(must(run).remaining, 1);
        assert.equal(data.sessionId, sessionId);
        const request = buildDefaultDecisionRequest(tic, 6, must(lastObservation).png, undefined, configuration);
        effectiveInstructions = request.instructions;
        // Only this fake provider/controller chooses the action; host command
        // schema contains no action override and request permits the stock set.
        assert.ok(request.permittedActions.includes('turn_right'));
        actionSelections++;
        sdkCalls++;
        run = { ...must(run), active: false, reserved: 1, sdkInvoked: 1, remaining: 0 };
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
    return {
      text: JSON.stringify(generationInputs.length === 1 ? proposal : reassessment),
      finishReason: 'stop',
      rawFinishReason: 'end_turn',
      steps: [{ toolCalls: [] }],
      totalUsage: {},
    };
  };
  const ports: SupervisorPorts = {
    cli: (args, signal) =>
      runAgentCli(args, {
        temporaryRoot: root,
        transport: (url, init) => {
          assert.equal(signal.aborted, false);
          return transport(url, init);
        },
      }),
    readPng: (path, signal) => readFile(path, { signal }),
    async writeInstructions(text) {
      const path = join(root, 'instructions.txt');
      await writeFile(path, text);
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
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function using<T>(work: (h: Awaited<ReturnType<typeof fixture>>) => Promise<T>, fault?: Fault) {
  const h = await fixture(fault);
  try {
    return await work(h);
  } finally {
    await h.dispose();
  }
}

function modelResult(text: unknown): Awaited<ReturnType<SupervisorACP['generate']>> {
  // Deliberately allow runtime contract violations in the fake provider only.
  return { text: text as string, finishReason: 'stop', rawFinishReason: 'end_turn', steps: [], totalUsage: {} };
}

function setReassessmentText(h: Awaited<ReturnType<typeof fixture>>, text: unknown) {
  h.setGeneration(async (input) => {
    input.onCallStart();
    return modelResult(h.generationInputs.length === 1 ? JSON.stringify(proposal) : text);
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
    ['status', 'visualEvidence', 'telemetryEvidence', 'uncertainty'].sort(),
  );
  assert.ok(JSON.stringify(diagnostic).length < 600);
  assert.ok(diagnostic.utf8BytesUpTo8193 === null || diagnostic.utf8BytesUpTo8193 <= 8193);
  return diagnostic;
}

test('happy path uses real CLI with fake HTTP/controller and exactly one provider action', async () =>
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
    assert.equal(report.action, 'turn_right');
    assert.equal(report.verifiedActions, 1);
    assert.equal(report.verifiedTics, 6);
    assert.equal(report.cumulativeTics, 7);
    assert.deepEqual(report.accounting, { active: false, limit: 1, reserved: 1, sdkInvoked: 1, remaining: 0 });
    assert.deepEqual(report.supervisorUsage, ['unavailable', 'unavailable']);
    assert.equal(report.decisionsUsage, 'unavailable');
    assert.equal(report.totalCost, 'unavailable');
    assert.equal(report.achievement, 'advisory-only; never engine-verified');
    assert.match(report.guidance, /lease-local-retained/);
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
    const original = h.ports.cli;
    h.ports.cli = async (args, signal) => {
      if (args[0] === 'decide') {
        // Separate fake-only stale admission probe before the healthy action.
        // It reaches the in-memory controller while the allowance is active.
        const stale = [...args];
        stale[4] = h.preWriteObservation.observationId;
        const denied = (await original(stale, signal)) as { reason: string; sdkInvoked: boolean };
        assert.equal(denied.reason, 'stale-observation');
        assert.equal(denied.sdkInvoked, false);
        assert.equal(h.sdkCalls, 0);
      }
      return original(args, signal);
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
          assert.equal(report.decisionDelivery, 'unknown');
          assert.equal(h.sdkCalls, 1);
          assert.equal(report.verifiedActions, 0);
        }
      },
      (op) => {
        if (op === lost) throw new Error('private lost response payload');
      },
    );
});

test('early Stop, model failure, malformed proposal, or changed ACP session prevents claim', async () => {
  for (const kind of ['stop', 'failure', 'invalid', 'session', 'tool', 'duplicate-call'])
    await using(async (h) => {
      if (kind === 'stop')
        h.ports.cli = async (args) => {
          if (args[0] === 'observe') throw new Error('agent-stopped');
          return runAgentCli(args, { transport: h.transport, temporaryRoot: h.root });
        };
      else
        h.setGeneration(async (input) => {
          input.onCallStart();
          if (kind === 'failure') throw new Error('private provider failure');
          if (kind === 'session') h.changeACPSession();
          if (kind === 'duplicate-call') input.onCallStart();
          return {
            text: kind === 'invalid' ? '{}' : JSON.stringify(proposal),
            finishReason: 'stop',
            rawFinishReason: 'end_turn',
            steps: [{ toolCalls: kind === 'tool' ? [{}] : [] }],
            totalUsage: {},
          };
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
    must(release)({
      text: JSON.stringify(proposal),
      finishReason: 'stop',
      rawFinishReason: 'end_turn',
      steps: [],
      totalUsage: {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.commands.filter((call) => call.op === 'start-run').length, 0);
    assert.equal(report.decideCalls, 0);
  }));

test('cancellation after claim and an unresolved decide leave no continuation or retry', async () => {
  for (const kind of ['after-claim', 'during-decide'])
    await using(async (h) => {
      const abort = new AbortController();
      const original = h.ports.cli;
      h.ports.cli = async (args, signal) => {
        const result = await original(args, signal);
        if (kind === 'after-claim' && args[0] === 'set-prompt') abort.abort();
        if (kind === 'during-decide' && args[0] === 'decide') return new Promise(() => {});
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
        return {
          text: JSON.stringify(h.generationInputs.length === 1 ? proposal : { ...reassessment, ...patch }),
          finishReason: 'stop',
          rawFinishReason: 'end_turn',
          steps: [],
          totalUsage: {},
        };
      });
      const report = await supervise(h.ports);
      assert.equal(report.outcome, patch.status === 'achieved' ? 'completed' : 'failed');
      assert.equal(report.achievement, 'advisory-only; never engine-verified');
      assert.equal(report.decideCalls, 1);
      assert.equal(report.supervisorCalls, 2);
      assert.equal(h.sdkCalls, 1);
      assert.deepEqual(report.supervisorUsage, ['unavailable', 'unavailable']);
      assert.equal(report.reassessment?.status ?? null, patch.status === 'achieved' ? 'achieved' : null);
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
    'duplicate-call',
    'cancel',
    'deadline',
  ])
    await using(async (h) => {
      const abort = new AbortController();
      if (kind === 'session-before') {
        const original = h.ports.cli;
        h.ports.cli = async (args, signal) => {
          const result = await original(args, signal);
          if (args[0] === 'get-config') h.changeACPSession();
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
        const result = modelResult(`\`\`\`${privateText}`);
        if (kind === 'tool') result.steps = [{ toolCalls: [{}] }];
        if (kind === 'finish') result.finishReason = 'length';
        return result;
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
      assert.equal(report.domainOutcome, 'retired');
      assert.equal(report.decisionDelivery, 'validated-receipt');
      assert.equal(report.verifiedActions, 0);
      assert.equal(report.verifiedTics, 2);
      assert.equal(report.cumulativeTics, 3);
      assert.equal(report.completionUncertain, true);
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
    const lease = parseLease(await h.ports.cli(['attach'], new AbortController().signal));
    const raw = (await h.ports.cli(['observe', '--lease', lease.leaseFile], new AbortController().signal)) as Json;
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
    let captured: unknown;
    const original = h.ports.cli;
    let lease: ReturnType<typeof parseLease> | undefined;
    let before: Awaited<ReturnType<typeof liveObserve>> | undefined;
    h.ports.cli = async (args, signal) => {
      const value = await original(args, signal);
      if (args[0] === 'attach') lease = parseLease(value);
      if (args[0] === 'observe') before = await liveObserve(value, must(lease), h.ports.readPng, signal);
      if (args[0] === 'decide') captured = value;
      return value;
    };
    assert.equal((await supervise(h.ports)).outcome, 'completed');
    const parsed = await liveDecision(
      captured,
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
    await supervisorMain(
      args,
      async (id) => {
        launched.push(id);
        return 0;
      },
      (text) => {
        output.push(text);
      },
    );
  }
  assert.deepEqual([...launched], []);
  assert.equal(output.length, 5);
  await supervisorMain(['--live', '--authorize-one-decision', '--trial', 'fake-only'], async (id) => {
    launched.push(id);
    return 0;
  });
  assert.deepEqual(launched, ['fake-only']);
  const moduleUrl = new URL('./supervisor.ts', import.meta.url).href;
  const source = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(s, c, next) {
      if (/^(ai$|@mcpc-tech\\/|@agentclientprotocol\\/|node:(child_process|http|https|net|tls|dns)$)/.test(s)) throw Error('Forbidden offline import');
      return next(s,c);
    }});
    globalThis.fetch = () => { throw Error('Offline default attempted fetch'); };
    const { supervisorMain } = await import(${JSON.stringify(moduleUrl)});
    if (await supervisorMain([]) !== 0) throw Error('Help failed');
  `;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', source], {
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /Offline by default/);
});
