// Synthetic receipts and controlled controller responses only. No real Worker,
// WASM, DOM, WAD, network, or game execution. Run offline after approval.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import {
  admitDecision,
  assertDecision,
  masks,
  validateChoice,
  verifyAction,
} from '../src/decision.ts';
import { buildDefaultDecisionRequest } from '../src/decision-request.ts';
import { projectLatestOutcome } from '../src/latest-outcome.ts';
import { assessE1M1 } from '../src/worker-shared.ts';

// Import the actual finite action helper without instantiating its native module.
const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
let i11Action;
try {
  globalThis.self = {};
  ({ i11Action } = await import('../src/worker.ts'));
} finally {
  if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
  else delete globalThis.self;
}

const work = [
  'build',
  'install',
  'liveEntry',
  'world',
  'status',
  'automap',
  'hud',
  'menu',
  'outer',
];
const ticks = [
  'nativeBuild',
  'playerEntry',
  'worldComplete',
  'outerComplete',
  'gametic',
  'leveltime',
  'virtualTicks',
];
function observation(n) {
  const command = Object.fromEntries(
    [
      'forwardmove',
      'sidemove',
      'angleturn',
      'chatchar',
      'buttons',
      'consistancy',
      'buttons2',
      'inventory',
      'lookfly',
      'arti',
    ].map((key) => [key, 0]),
  );
  return {
    counters: {
      ...Object.fromEntries(ticks.map((key) => [key, n])),
      wasiInit: 1,
      cInit: 1,
      engineCreate: 1,
      titlePrepare: 1,
      titleReady: 0,
      render: 2,
      frame: 2,
      netIntercept: 10,
      schedulerEntry: 0,
      netBody: 0,
      wipeEntry: 0,
      demoLoad: 0,
    },
    native: {
      ...Object.fromEntries(work.map((key) => [key, n])),
      ready: 1,
      loadComplete: 1,
      resources: 1,
      liveActor: 1,
      gameEligible: 1,
      gamestate: 0,
      gameaction: 0,
      episode: 1,
      map: 1,
      skill: 2,
      playerstate: 0,
      health: 100,
      virtualMs: Math.floor((n * 1000) / 35),
      buildTick: n - 1,
      turnheld: 0,
      keyUp: 0,
      keyRight: 0,
      keyDown: 0,
      keyLeft: 0,
      keyFire: 0,
      keyUse: 0,
      installEqual: 1,
      entryEqual: 1,
      actorEqual: 1,
      contributorsValid: 1,
      usedown: 0,
      dclicktime: n,
      dclicktime2: n,
      dclickstate: 0,
      dclicks: 0,
      dclickstate2: 0,
      dclicks2: 0,
      built: command,
      entered: { ...command },
    },
  };
}
const death = {
  ready: 0,
  gameEligible: 0,
  playerstate: 1,
  health: 0,
  liveActor: 0,
};
const exit = { ready: 0, gameEligible: 0, gameaction: 6 };
function nativeFixture({
  base = 1,
  at = Infinity,
  signals = {},
  trapAt = Infinity,
} = {}) {
  let current = observation(base),
    calls = 0;
  return {
    get calls() {
      return calls;
    },
    observe: () => structuredClone(current),
    step(mask) {
      assert.equal(
        mask,
        0,
        'This synthetic fixture implements only neutral input',
      );
      ++calls;
      if (calls === trapAt) throw Error('Synthetic trap; current tic unknown');
      const prior = current;
      current = observation(prior.counters.gametic + 1);
      for (const key of ['render', 'frame', 'netIntercept'])
        current.counters[key] = prior.counters[key];
      if (calls === at) Object.assign(current.native, signals);
      return 0;
    },
    render() {
      ++current.counters.render;
      ++current.counters.frame;
      current.counters.netIntercept += 5;
      return this.observe();
    },
  };
}
const execute = (native, n) =>
  i11Action(0, n, (mask) => native.step(mask), native.observe);

// Exercise the actual controller functions and click orchestration in a VM.
// Source sections avoid loading main's asset/SDK startup. No production extraction
// or alternate orchestration is introduced; presentation and platform objects are mocks.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
function section(start, end) {
  const first = main.indexOf(start),
    last = main.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Controller source markers: ${start}`);
  return main.slice(first, last);
}
// Keep the production executor in this VM's clock/error realm so the existing
// deterministic deadline controls and SDK classifications remain exercised.
const executorSource = readFileSync(
  new URL('../src/decisions-api.ts', import.meta.url),
  'utf8',
)
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');
const controllerSource = stripTypeScriptTypes(
  [
    'let current = initialRun; let pageExited = false;',
    section('function check(', 'const passive = ['),
    section('const passive = [', 'const work = ['),
    section('function assertCurrent(', 'const displayHistory ='),
    section('function display(run:', 'function checkPrepared('),
    executorSource,
    section('async function request<', 'function fence('),
    section('function fence(', "$('#start').addEventListener"),
    '({ retire, request, decide })',
  ].join('\n'),
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function pixels(tic) {
  const rgba = new Uint8ClampedArray(1024000);
  rgba[0] = tic;
  rgba[4] = tic + 1;
  return rgba;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function sdkFixture(delayed = false) {
  const gate = deferred(),
    waiting = deferred();
  let calls = 0;
  const choice = {
    answers: [{ type: 'choice', name: 'next_action', choice: 'neutral' }],
  };
  return {
    get calls() {
      return calls;
    },
    gate,
    waiting,
    choice,
    decisions: {
      create(_input, _options) {
        ++calls;
        // Intentionally ignore AbortSignal, so identity fencing is necessary too.
        return {
          asResponse: async () => ({
            status: 200,
            headers: { get: () => 'req_fixture' },
          }),
          withResponse: async () => {
            waiting.resolve();
            if (delayed) await gate.promise;
            return { data: choice, request_id: 'req_fixture' };
          },
        };
      },
    },
  };
}
function controllerFixture(native, { delayed = false, badFrame = false } = {}) {
  const sdk = sdkFixture(delayed),
    ops = [],
    nodes = new Map();
  let click,
    painted = pixels(native.observe().counters.gametic),
    paints = 0;
  const worker = {
    terminated: false,
    terminate() {
      this.terminated = true;
    },
    postMessage(data) {
      assert.equal(this.terminated, false);
      ops.push(data.op);
      let result, frame;
      if (data.op === 'snapshot') result = native.observe();
      else if (data.op === 'action') result = execute(native, data.tics);
      else if (data.op === 'render') {
        result = native.render();
        frame = pixels(result.counters.gametic);
        result = {
          ...result,
          status: 0,
          dimensions: { width: 640, height: 400 },
          frameSha256: badFrame ? '0'.repeat(64) : sha(frame),
        };
      } else assert.fail(`Unexpected mock operation ${data.op}`);
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            ok: true,
            op: data.op,
            elapsedMs: 0,
            result: structuredClone(result),
            pixels: frame?.buffer,
          },
        }),
      );
    },
  };
  const initialRun = {
    valid: true,
    phase: 'ready',
    worker,
    client: sdk,
    verifiedTics: native.observe().counters.gametic,
    last: native.observe(),
    frame: {
      tic: native.observe().counters.gametic,
      nativeSha256: sha(painted),
      canvasSha256: sha(painted),
    },
    evidence: { operations: [], frames: [], decisions: [] },
  };
  const $ = (selector) => {
    if (!nodes.has(selector))
      nodes.set(selector, {
        value: '',
        valueAsNumber: 6,
        dataset: {},
        setAttribute() {},
        addEventListener(type, handler) {
          assert.equal(type, 'click');
          click = handler;
        },
      });
    return nodes.get(selector);
  };
  $('#tics');
  class MockAPIError extends Error {}
  const api = runInNewContext(controllerSource, {
    initialRun,
    $,
    buildDefaultDecisionRequest,
    admitDecision,
    assertDecision,
    masks,
    validateChoice,
    verifyAction,
    crypto: webcrypto,
    AbortController,
    setTimeout,
    clearTimeout,
    performance: { now: () => 0 },
    canvas: { toDataURL: () => 'data:image/png;base64,fixture' },
    context: {
      putImageData(image) {
        painted = new Uint8ClampedArray(image.data);
        ++paints;
      },
      getImageData: () => ({ data: new Uint8ClampedArray(painted) }),
    },
    ImageData: class {
      constructor(data) {
        this.data = data;
      }
    },
    displayHistory() {},
    projectLatestOutcome,
    OpenAI: {
      APIError: MockAPIError,
      APIConnectionError: MockAPIError,
      APIConnectionTimeoutError: MockAPIError,
    },
  });
  return {
    run: initialRun,
    worker,
    sdk,
    ops,
    nodes,
    api,
    click,
    get paints() {
      return paints;
    },
    get paintedHash() {
      return sha(painted);
    },
  };
}

describe('terminal', () => {
  it('verifies death exit and combined signals at N and early prefixes without a next tic', async () => {
    for (const signals of [death, exit, { ...death, ...exit }]) {
      for (const n of [2, 6]) {
        const native = nativeFixture({ at: 2, signals });
        const before = native.observe(),
          result = execute(native, n);
        const evidence = verifyAction(before, 0, n, result);
        assert.equal(
          native.calls,
          2,
          'No k+1 native step, including terminal at N',
        );
        assert.equal(result.outcome, 'TERMINAL');
        assert.equal(evidence.requestedTics, n);
        assert.equal(evidence.reportedCompletedTics, 2);
        assert.equal(evidence.independentlyVerifiedTics, 2);
        assert.equal(evidence.cumulativeVerifiedTics, 3);
        assert.equal(evidence.complete, false);
        assert.equal(evidence.terminal, true);
        assert.equal(evidence.completionUncertain, false);
        assert.equal(evidence.assessment.tic, 3);
        assert.equal(evidence.assessment.dead, signals.playerstate === 1);
        assert.equal(evidence.assessment.exitPending, signals.gameaction === 6);
        assert.deepEqual(result.native, result.steps.at(-1).native);
        const passive = native.observe();
        native.observe();
        native.observe();
        assert.deepEqual(native.observe(), passive);
        assert.equal(execute(native, 1).completedTics, 0);
        assert.equal(
          native.calls,
          2,
          'Already terminal input makes no native call',
        );
        const forged = structuredClone(result);
        forged.steps.push({ status: 0, ...observation(4) });
        forged.completedTics++;
        const rejected = verifyAction(before, 0, n, forged);
        assert.equal(rejected.terminal, false);
        assert.equal(rejected.independentlyVerifiedTics, 2);
        assert.equal(rejected.completionUncertain, true);
      }
    }
  });

  it('keeps unsupported state separate from verified death or exit', async () => {
    for (const signals of [
      { ready: 0 },
      { ...death, health: 50 },
      { ...exit, ready: 1 },
      { ...exit, gamestate: 1 },
      { ...death, ...exit, map: 2 },
      { ...death, resources: 0 },
      { playerstate: 2, ready: 0 },
    ]) {
      const native = nativeFixture({ at: 2, signals });
      const before = native.observe(),
        result = execute(native, 6);
      const evidence = verifyAction(before, 0, 6, result);
      assert.equal(native.calls, 2);
      assert.equal(result.outcome, 'INELIGIBLE');
      assert.equal(evidence.independentlyVerifiedTics, 2);
      assert.equal(evidence.assessment.kind, 'unsupported');
      assert.equal(evidence.assessment.dead, signals.playerstate === 1);
      assert.equal(evidence.assessment.exitPending, signals.gameaction === 6);
      assert.equal(evidence.complete, false);
      assert.equal(evidence.terminal, false);
      assert.equal(evidence.completionUncertain, false); // State unknown; exact work prefix known.
    }
  });

  it('retains trap prefixes and rejects ambiguous terminal counters', async () => {
    const trapped = nativeFixture({ trapAt: 2 });
    const trappedBefore = trapped.observe(),
      trappedResult = execute(trapped, 6);
    const trappedEvidence = verifyAction(trappedBefore, 0, 6, trappedResult);
    assert.equal(trappedEvidence.reportedCompletedTics, 1);
    assert.equal(trappedEvidence.independentlyVerifiedTics, 1);
    assert.equal(trappedEvidence.completionUncertain, true);
    assert.equal(trappedEvidence.terminal, false);
    const ambiguous = nativeFixture({ at: 1, signals: death });
    const ambiguousBefore = ambiguous.observe(),
      ambiguousResult = execute(ambiguous, 6);
    ambiguousResult.steps[0].counters.worldComplete = 0;
    assert.equal(
      verifyAction(ambiguousBefore, 0, 6, ambiguousResult)
        .independentlyVerifiedTics,
      0,
    );
    assert.equal(
      verifyAction(ambiguousBefore, 0, 6, ambiguousResult).terminal,
      false,
    );
  });

  it('admits exactly one neutral preparation tic and refuses invalid input', async () => {
    const neutral = nativeFixture({ base: 0 });
    assert.equal(
      i11Action(
        1,
        1,
        () => {
          throw Error('Must not dispatch');
        },
        neutral.observe,
      ).completedTics,
      0,
    );
    assert.equal(
      verifyAction(neutral.observe(), 0, 1, execute(neutral, 1)).complete,
      true,
    );
    assert.equal(neutral.calls, 1);
  });

  it('retains one session through verified manual decisions and frame checkpoints', async () => {
    const live = controllerFixture(nativeFixture());
    live.nodes.get('#tics').valueAsNumber = 2;
    await live.click();
    live.nodes.get('#tics').valueAsNumber = 5;
    await live.click();
    assert.equal(live.sdk.calls, 2);
    assert.equal(live.run.phase, 'ready');
    assert.equal(live.run.worker, live.worker);
    assert.equal(live.worker.terminated, false);
    assert.equal(live.run.verifiedTics, 8);
    assert.equal(live.paints, 2);
    for (const entry of live.run.evidence.decisions) {
      assert.equal(entry.execution.requestedTics, entry.selectedTics);
      assert.equal(entry.execution.reportedCompletedTics, entry.selectedTics);
      assert.equal(
        entry.execution.independentlyVerifiedTics,
        entry.selectedTics,
      );
      assert.equal(entry.execution.complete, true);
      assert.equal(entry.execution.terminal, false);
    }
  });

  it('recovers manual readiness from an invalid model choice without dispatch', async () => {
    const recoveryNative = nativeFixture(),
      recovery = controllerFixture(recoveryNative);
    recovery.sdk.choice.answers = [];
    await recovery.click();
    assert.equal(recoveryNative.calls, 0);
    assert.equal(recovery.run.phase, 'ready');
    assert.equal(recovery.run.worker, recovery.worker);
    recovery.sdk.choice.answers = [
      { type: 'choice', name: 'next_action', choice: 'neutral' },
    ];
    await recovery.click();
    assert.equal(recoveryNative.calls, 6);
    assert.equal(recovery.run.phase, 'ready');
  });

  it('verifies terminal frames and permanently fences admission for every terminal permutation', async () => {
    for (const signals of [death, exit, { ...death, ...exit }]) {
      for (const n of [2, 6]) {
        const native = nativeFixture({ at: 2, signals }),
          h = controllerFixture(native);
        h.nodes.get('#tics').valueAsNumber = n;
        await h.click();
        const entry = h.run.evidence.decisions[0];
        assert.equal(h.run.phase, 'terminal');
        assert.equal(h.run.valid, false);
        assert.equal(h.worker.terminated, true);
        assert.equal(h.run.last.native.ready, 0);
        assert.equal(h.run.last.counters.gametic, 3);
        assert.equal(entry.result.tic, 3);
        assert.equal(entry.result.nativeSha256, h.paintedHash);
        assert.equal(entry.result.canvasSha256, h.paintedHash);
        assert.equal(h.paints, 1);
        assert.equal(entry.execution.terminal, true);
        assert.equal(entry.execution.reportedCompletedTics, 2);
        assert.equal(entry.execution.independentlyVerifiedTics, 2);
        assert.equal(h.nodes.get('#next').disabled, true);
        assert.match(entry.status, /frame retained/);
        if (signals.gameaction === 6)
          assert.match(entry.status, /exit pending/);
        const opCount = h.ops.length;
        await h.click();
        await assert.rejects(
          h.api.request(h.run, 'action', { mask: 0, tics: 1 }),
        );
        assert.equal(h.sdk.calls, 1);
        assert.equal(h.ops.length, opCount);
        assert.equal(native.calls, 2);
        // The stored terminal marker also blocks a hypothetical erroneous ready reset.
        assert.equal(
          admitDecision(
            {
              valid: true,
              phase: 'ready',
              worker: {},
              terminal: h.run.terminal,
            },
            1,
          ),
          undefined,
        );
      }
    }
  });

  it('closes admission while terminal rendering is still pending', async () => {
    // Admission is closed as soon as terminal evidence is verified, while its
    // passive render is still pending and the Worker remains available for that render.
    const renderingNative = nativeFixture({ at: 2, signals: exit });
    const rendering = controllerFixture(renderingNative),
      renderWaiting = deferred();
    const post = rendering.worker.postMessage.bind(rendering.worker);
    let releaseRender;
    rendering.worker.postMessage = (data) => {
      if (data.op === 'render') {
        releaseRender = () => post(data);
        renderWaiting.resolve();
      } else post(data);
    };
    const finishing = rendering.click();
    await renderWaiting.promise;
    assert.equal(rendering.run.valid, true);
    assert.equal(rendering.run.phase, 'busy');
    assert.equal(rendering.run.terminal.kind, 'terminal');
    await rendering.click();
    await assert.rejects(
      rendering.api.request(rendering.run, 'action', { mask: 0, tics: 1 }),
    );
    assert.equal(rendering.sdk.calls, 1);
    assert.equal(renderingNative.calls, 2);
    releaseRender();
    await finishing;
    assert.equal(rendering.run.phase, 'terminal');
  });

  it('retires unsupported uncertain or unverified results without replacing the Canvas', async () => {
    for (const options of [
      { signals: { ready: 0 } },
      { signals: death, badFrame: true },
      { trapAt: 2 },
    ]) {
      const native = nativeFixture({ at: 2, ...options });
      const h = controllerFixture(native, options);
      await h.click();
      assert.equal(h.run.valid, false);
      assert.equal(h.run.phase, 'error');
      assert.equal(
        h.paints,
        0,
        'Unverified/unsupported frame must not replace the Canvas',
      );
      assert.equal(h.run.frame.tic, 1);
      assert.equal(h.run.evidence.decisions[0].result, null);
      if (options.badFrame)
        assert.match(
          h.run.evidence.decisions[0].status,
          /terminal frame unavailable/,
        );
      const calls = native.calls,
        opCount = h.ops.length;
      await h.click();
      assert.equal(h.sdk.calls, 1);
      assert.equal(native.calls, calls);
      assert.equal(h.ops.length, opCount);
    }
  });

  it('fences late Abort-ignoring responses with or without an Abort controller', async () => {
    for (const abortAvailable of [true, false]) {
      const native = nativeFixture(),
        h = controllerFixture(native, { delayed: true });
      const pendingClick = h.click();
      await h.sdk.waiting.promise; // Response headers read; valid body still deferred.
      if (!abortAvailable) h.run.apiController = undefined; // Force identity fences alone.
      h.api.retire(h.run);
      h.sdk.gate.resolve(); // Valid late success; mock transport ignores abort.
      await pendingClick;
      await h.click();
      assert.equal(h.sdk.calls, 1);
      assert.equal(native.calls, 0);
      assert.equal(h.ops.filter((op) => op === 'action').length, 0);
      assert.equal(h.run.phase, 'error');
      assert.equal(h.run.valid, false);
    }
  });

  it('classifies the initial E1M1 checkpoint as alive', async () => {
    assert.equal(assessE1M1(observation(1)).kind, 'alive');
  });
});
