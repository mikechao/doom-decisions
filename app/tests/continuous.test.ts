// Continuous orchestration with synthetic receipts and controlled responses only. No real Worker,
// WASM, DOM, WAD, network, or game execution. Real SDK cases use local fake fetch only.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { OpenAI } from 'openai/client';
import { VERSION } from 'openai/version';
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

import {
  death,
  execute,
  exit,
  i11Action,
  nativeFixture,
  observation,
  pixels,
  sha,
  workerResult,
} from './fixtures/synthetic-doom.ts';

// Use the moved controller and browser presentation through bounded VM seams. All decision,
// SDK ownership, Stop, and loop logic below comes from production source.
const main = readFileSync(
  new URL('../src/session-controller.ts', import.meta.url),
  'utf8',
);
const browser = readFileSync(
  new URL('../src/main.ts', import.meta.url),
  'utf8',
);
function browserSection(start, end) {
  const first = browser.indexOf(start),
    last = browser.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Browser source markers: ${start}`);
  return browser.slice(first, last);
}
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
// Evaluate the production checks in this VM's Error realm; keep helpers private.
const observationChecksSource = stripTypeScriptTypes(
  readFileSync(
    new URL('../src/native-observation-checks.ts', import.meta.url),
    'utf8',
  ),
).replace(/^export /gm, '');
// Keep Worker callbacks and failures in the same VM Error/timer realm.
const workerRequestSource = stripTypeScriptTypes(
  readFileSync(new URL('../src/worker-request.ts', import.meta.url), 'utf8'),
)
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');
const controllerSource = stripTypeScriptTypes(
  [
    'let current = initialRun; let pageExited = false;',
    section('function check(', 'type EngineMetadata ='),
    `const { passiveCheck, healthy, checkPrepared } = (() => {
      ${observationChecksSource}
      return { passiveCheck, healthy, checkPrepared };
    })();`,
    `const presentBrowser = (() => {
      ${browserSection('function displaySetupStatus(', 'const displayHistory =')}
      ${browserSection('function display(view:', 'const controller =')}
      return display;
    })();`,
    `const ports = {
      readTics: () => $('#tics').valueAsNumber,
      takeKey: () => { const key = $('#key').value.trim(); if (key) $('#key').value = ''; return key; },
      clearKey: () => { $('#key').value = ''; },
      focusBudget: () => $('#budget').focus(),
      capture: () => ({ png: canvas.toDataURL('image/png'), rgba: context.getImageData(0,0,640,400).data }),
      paintAndReadback: (rgba) => { context.putImageData(new ImageData(rgba,640,400),0,0); return context.getImageData(0,0,640,400).data; },
      present: presentBrowser,
    };`,
    section('function assertCurrent(', 'async function request<'),
    executorSource,
    `const { requestWorker } = (() => {
      ${workerRequestSource}
      return { requestWorker };
    })();`,
    section('async function request<', 'function fence('),
    section('function fence(', 'async function prepare('),
    `$('#next').addEventListener('click', () => runOneDecision(current));`,
    `$('#start').addEventListener('click', () => startContinuous($('#budget').valueAsNumber));
     $('#stop').addEventListener('click', stopContinuous);`,
    '({ retire, request, decide, runOneDecision, startContinuous, stopContinuous })',
  ].join('\n'),
);
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function until(predicate) {
  for (let n = 0; n < 50; ++n) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('Expected deterministic mock checkpoint');
}
function fixture(options = {}) {
  const native = nativeFixture(options),
    nodes = new Map(),
    ops = [],
    inputs = [];
  const bodyGate = deferred(),
    headerGate = deferred(),
    waiting = deferred();
  const digestGate = deferred(),
    digestWaiting = deferred();
  const choice = options.choice ?? {
    answers: [{ type: 'choice', name: 'next_action', choice: 'neutral' }],
  };
  let readerPending = false,
    parserSettled = false,
    parserError;
  const realSdk = options.realSdk
    ? new OpenAI({
        apiKey: 'offline-not-a-credential',
        maxRetries: 0,
        timeout: 10000,
        logLevel: 'off',
        dangerouslyAllowBrowser: true,
        fetch: async () => {
          const response = new Response(null, {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'req_fixture',
            },
          });
          // The SDK calls this public body reader. It deliberately ignores Abort,
          // while the real SDK parser's own race can settle before this promise.
          response.text = async () => {
            readerPending = true;
            waiting.resolve();
            try {
              if (options.delayedBody) await bodyGate.promise;
              return JSON.stringify(choice);
            } finally {
              readerPending = false;
              --sdkActive;
            }
          };
          return response;
        },
      })
    : undefined;
  let painted = pixels(1),
    paints = 0,
    sdkCalls = 0,
    sdkActive = 0,
    sdkMax = 0;
  let workerActive = 0,
    workerMax = 0,
    deadline,
    releaseYield;
  let digests = 0;
  const yieldWaiting = deferred();
  const holds = new Map(),
    seen = new Map();
  const $ = (selector) => {
    if (!nodes.has(selector))
      nodes.set(selector, {
        value: '',
        valueAsNumber: selector === '#budget' ? 2 : 6,
        dataset: {},
        handlers: {},
        setAttribute(name, value) {
          this[name] = value;
        },
        focus() {
          this.focused = true;
        },
        addEventListener(type, handler) {
          this.handlers[type] = handler;
        },
      });
    return nodes.get(selector);
  };
  class MockAPIError extends Error {}
  const sdk = {
    decisions: {
      create(input, requestOptions) {
        assert.equal(requestOptions.maxRetries, 0);
        assert.equal(requestOptions.signal.aborted, false);
        ++sdkCalls;
        ++sdkActive;
        sdkMax = Math.max(sdkMax, sdkActive);
        inputs.push(input);
        options.onCreate?.(sdkCalls, nodes);
        if (options.throwOnCreate) {
          --sdkActive;
          throw new MockAPIError();
        }
        if (realSdk) {
          const pending = realSdk.decisions.create(input, {
            ...requestOptions,
            timeout: options.sdkDeadlineMs ?? requestOptions.timeout,
          });
          const withResponse = pending.withResponse.bind(pending);
          pending.withResponse = () => {
            const parsing = withResponse();
            void parsing.then(
              () => {
                parserSettled = true;
              },
              (error) => {
                parserError = error;
                parserSettled = true;
              },
            );
            return parsing;
          };
          return pending;
        }
        // These transports deliberately ignore AbortSignal.
        const headers = (async () => {
          if (options.delayedHeaders) await headerGate.promise;
          return { status: 200, headers: { get: () => 'req_fixture' } };
        })();
        const body = (async () => {
          waiting.resolve();
          if (options.delayedBody) await bodyGate.promise;
          if (options.apiError)
            throw Object.assign(new MockAPIError(), { status: 401 });
          return { data: choice, request_id: 'req_fixture' };
        })();
        void Promise.allSettled([headers, body]).then(() => {
          --sdkActive;
        });
        return { asResponse: () => headers, withResponse: () => body };
      },
    },
  };
  const worker = {
    terminated: false,
    terminate() {
      this.terminated = true;
    },
    postMessage(data) {
      assert.equal(this.terminated, false);
      ++workerActive;
      workerMax = Math.max(workerMax, workerActive);
      ops.push(data.op);
      const occurrence = (seen.get(data.op) ?? 0) + 1;
      seen.set(data.op, occurrence);
      const complete = () => {
        const output = workerResult(native, data, {
          corruptSnapshot: occurrence === options.corruptSnapshot,
          badReceipt: options.badReceipt,
          badFrame: options.badFrame,
        });
        if (!output) assert.fail(`Unexpected operation ${data.op}`);
        const { result, frame } = output;
        queueMicrotask(() => {
          --workerActive;
          worker.onmessage?.({
            data: {
              ok: true,
              op: data.op,
              elapsedMs: 0,
              result: structuredClone(result),
              pixels: frame?.buffer,
            },
          });
        });
      };
      const hold = holds.get(`${data.op}:${occurrence}`);
      if (hold) {
        hold.complete = complete;
        hold.waiting.resolve();
      } else complete();
    },
  };
  const initialRun = {
    valid: true,
    phase: 'ready',
    worker,
    client: sdk,
    verifiedTics: 1,
    last: native.observe(),
    frame: { tic: 1, nativeSha256: sha(painted), canvasSha256: sha(painted) },
    evidence: { operations: [], frames: [], decisions: [] },
  };
  // The fixture begins at the preparation checkpoint, not an AI neutral decision.
  $('#tics');
  $('#budget');
  const api = runInNewContext(controllerSource, {
    initialRun,
    structuredClone,
    $,
    admitDecision,
    assertDecision,
    masks,
    validateChoice,
    verifyAction,
    buildDefaultDecisionRequest(...args) {
      options.onBuild?.(initialRun, ...args);
      if (options.buildError)
        throw Error('Synthetic request construction failure');
      return buildDefaultDecisionRequest(...args);
    },
    crypto: {
      subtle: {
        digest(...args) {
          ++digests;
          if (digests === options.holdDigest) {
            digestWaiting.resolve();
            return digestGate.promise.then(() =>
              webcrypto.subtle.digest(...args),
            );
          }
          return webcrypto.subtle.digest(...args);
        },
      },
    },
    AbortController,
    performance: { now: () => 0 },
    setTimeout(callback, ms) {
      if (ms === 10000) {
        deadline = { callback, fake: true };
        return deadline;
      }
      if (ms === 0 && options.holdYield) {
        releaseYield = callback;
        yieldWaiting.resolve();
        return { fake: true };
      }
      return setTimeout(callback, ms);
    },
    clearTimeout(timer) {
      if (!timer?.fake) clearTimeout(timer);
    },
    canvas: {
      toDataURL: () =>
        options.badPng ? 'bad' : 'data:image/png;base64,fixture',
    },
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
    OpenAI: realSdk
      ? OpenAI
      : {
          APIError: MockAPIError,
          APIConnectionError: MockAPIError,
          APIConnectionTimeoutError: MockAPIError,
        },
  });
  return {
    run: initialRun,
    native,
    worker,
    nodes,
    api,
    ops,
    inputs,
    waiting,
    start: () => $('#start').handlers.click(),
    stop: () => $('#stop').handlers.click(),
    next: () => $('#next').handlers.click(),
    releaseBody: () => bodyGate.resolve(),
    releaseHeaders: () => headerGate.resolve(),
    rejectBody: () => bodyGate.reject(Error('Late transport rejection')),
    timeout: () => deadline.callback(),
    yieldWaiting: yieldWaiting.promise,
    releaseYield: () => releaseYield(),
    digestWaiting: digestWaiting.promise,
    releaseDigest: () => digestGate.resolve(),
    hold(op, occurrence = 1) {
      const hold = { waiting: deferred() };
      holds.set(`${op}:${occurrence}`, hold);
      return { waiting: hold.waiting.promise, release: () => hold.complete() };
    },
    get sdkCalls() {
      return sdkCalls;
    },
    get sdkMax() {
      return sdkMax;
    },
    get sdkActive() {
      return sdkActive;
    },
    get workerMax() {
      return workerMax;
    },
    get paints() {
      return paints;
    },
    get readerPending() {
      return readerPending;
    },
    get parserSettled() {
      return parserSettled;
    },
    get parserError() {
      return parserError;
    },
  };
}

describe('continuous', () => {
  it('validates Worker duration boundaries without large tic batches', async () => {
    // Worker duration validation uses a passive refusal, never a large tic batch.
    for (const n of [21, 35, 1000, Number.MAX_SAFE_INTEGER]) {
      let calls = 0;
      const result = i11Action(
        0,
        n,
        () => {
          ++calls;
          return -1;
        },
        () => observation(1),
      );
      assert.equal(calls, 1);
      assert.equal(result.completedTics, 0);
      assert.equal(result.outcome, 'REFUSED');
      assert.equal(result.reason, undefined);
    }
    for (const n of [
      0,
      -1,
      1.5,
      20.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      '',
      '20.5',
    ]) {
      const result = i11Action(
        0,
        n,
        () => assert.fail('Invalid duration dispatched'),
        () => observation(1),
      );
      assert.equal(result.completedTics, 0);
      assert.equal(result.outcome, 'REFUSED');
      assert.match(result.reason, /Invalid mask\/duration/);
    }
  });

  it('builds synchronously before charging and charges nothing for construction failure', async () => {
    // The prepared boundary remains synchronous: construction sees the uncharged
    // budget and frozen inputs, then the invocation sees exactly one charge.
    const boundaryEvents = [];
    const boundary = fixture({
      onBuild(run, tic, n, png) {
        boundaryEvents.push('build');
        assert.equal(run.continuous.used, 0);
        assert.equal(tic, 1);
        assert.equal(n, 2);
        assert.equal(png, 'data:image/png;base64,fixture');
        queueMicrotask(() => boundaryEvents.push('microtask'));
      },
      onCreate() {
        boundaryEvents.push('create');
        assert.equal(boundary.run.continuous.used, 1);
      },
    });
    boundary.nodes.get('#tics').valueAsNumber = 2;
    boundary.nodes.get('#budget').valueAsNumber = 1;
    await boundary.start();
    assert.deepEqual(boundaryEvents, ['build', 'create', 'microtask']);
    const buildFailure = fixture({ buildError: true });
    await buildFailure.start();
    assert.equal(buildFailure.sdkCalls, 0);
    assert.equal(buildFailure.run.continuous.used, 0);
    assert.equal(buildFailure.native.calls, 0);
  });

  it('retains real SDK reader ownership across all cancellation modes and late outcomes', async () => {
    // P1: actual pinned SDK helper rejection is NOT actual body-reader settlement.
    assert.equal(VERSION, '7.32.0');
    for (const cancellation of [
      'stop',
      'app-deadline',
      'sdk-deadline',
      'manual-sdk-deadline',
    ]) {
      for (const lateReject of [false, true]) {
        const h = fixture({
          realSdk: true,
          delayedBody: true,
          sdkDeadlineMs: cancellation.includes('sdk-deadline') ? 25 : undefined,
        });
        const manual = cancellation === 'manual-sdk-deadline';
        const work = manual ? h.next() : h.start();
        await h.waiting.promise; // Headers received; actual response.text() is pending.
        assert.equal(h.readerPending, true);
        if (cancellation === 'stop') h.stop();
        if (cancellation === 'app-deadline') h.timeout();
        await until(() => h.parserSettled);
        assert.ok(
          h.parserError instanceof
            (cancellation.includes('sdk-deadline')
              ? OpenAI.APIConnectionTimeoutError
              : OpenAI.APIUserAbortError),
        );
        assert.equal(
          h.readerPending,
          true,
          'Real parser race rejected before reader settled',
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.ok(
          h.run.sdkRead,
          'Ownership must survive raced SDK helper settlement',
        );
        assert.equal(h.run.phase, 'busy');
        assert.match(
          h.nodes.get('#continuous-state').textContent,
          /waiting for API response cleanup/,
        );
        await h.start();
        await h.next();
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.native.calls, 0);
        if (!manual) assert.equal(h.run.continuous.used, 1);
        if (lateReject) h.rejectBody();
        else h.releaseBody();
        await work;
        assert.equal(h.readerPending, false);
        assert.equal(h.sdkActive, 0);
        assert.equal(h.run.sdkRead, undefined);
        assert.equal(h.run.phase, 'ready');
        assert.equal(h.run.evidence.decisions[0].waitUnchanged, true);
        assert.equal(
          h.native.calls,
          0,
          'Late reader success/rejection must not apply input',
        );
        assert.equal(h.run.worker, h.worker);
        assert.equal(h.worker.terminated, false);
        // A fresh SDK invocation is now safe. Rejected transport gates remain rejected.
        if (cancellation === 'stop') {
          h.nodes.get('#budget').valueAsNumber = 1;
          await h.start();
          assert.equal(h.run.continuous.used, 1);
        } else await h.next();
        assert.equal(h.sdkCalls, 2);
        assert.equal(h.sdkMax, 1);
        assert.equal(h.native.calls, lateReject ? 0 : 6);
      }
    }
  });

  it('admits large controller durations without dispatching invalid choices', async () => {
    // Controller validation admits large N but an invalid choice prevents dispatch.
    for (const n of [1000, Number.MAX_SAFE_INTEGER]) {
      const h = fixture({ choice: { answers: [] } });
      h.nodes.get('#tics').valueAsNumber = n;
      await h.next();
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.native.calls, 0);
      assert.equal(h.run.evidence.decisions[0].selectedTics, n);
      assert.equal(h.run.phase, 'ready');
    }
  });

  it('rejects invalid durations in manual and continuous admission without SDK work', async () => {
    // An empty number input has valueAsNumber=NaN; no partial-string parsing occurs.
    for (const n of [
      0,
      -1,
      1.5,
      20.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      for (const mode of ['next', 'start']) {
        const h = fixture();
        h.nodes.get('#tics').valueAsNumber = n;
        await h[mode]();
        assert.equal(h.sdkCalls, 0);
        assert.equal(h.native.calls, 0);
        assert.equal(h.run.evidence.decisions.length, 0);
        assert.match(
          h.nodes.get('#status').textContent,
          /must be a positive JavaScript safe integer/,
        );
        if (mode === 'start') assert.equal(h.run.continuous.used, 0);
      }
    }
  });

  it('admits uncapped positive safe integer budgets and rejects invalid budgets', async () => {
    // Budget is any positive safe integer; invalid inputs admit no SDK work.
    for (const limit of [1, 20, 100, 500, 1000, Number.MAX_SAFE_INTEGER]) {
      const h = fixture({ choice: { answers: [] } });
      h.nodes.get('#budget').valueAsNumber = limit;
      await h.start();
      assert.equal(h.run.continuous.limit, limit);
      assert.equal(h.run.continuous.used, 1);
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.run.phase, 'ready');
    }
    for (const limit of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const h = fixture();
      h.nodes.get('#budget').valueAsNumber = limit;
      await h.start();
      assert.equal(h.sdkCalls, 0);
      assert.equal(h.run.continuous, undefined);
      assert.equal(h.nodes.get('#budget').focused, true);
    }
  });

  it('charges nothing for bad observations invalid N or missing client', async () => {
    for (const options of [{ badPng: true }, {}]) {
      const h = fixture(options);
      if (!options.badPng) h.nodes.get('#tics').valueAsNumber = 0;
      await h.start();
      assert.equal(h.sdkCalls, 0);
      assert.equal(h.run.continuous.used, 0);
    }
    const noKey = fixture();
    noKey.run.client = undefined;
    await noKey.start();
    assert.equal(noKey.sdkCalls, 0);
    assert.equal(noKey.run.continuous.used, 0);
  });

  it('locks overlapping admissions through Stop and late Abort-ignoring success', async () => {
    // Double Start / Next overlap and Stop with a late Abort-ignoring body success.
    const delayed = fixture({ delayedBody: true });
    const running = delayed.start();
    await delayed.waiting.promise;
    await delayed.start();
    await delayed.next();
    assert.equal(delayed.sdkCalls, 1);
    delayed.stop();
    delayed.stop();
    await until(() =>
      delayed.run.evidence.decisions[0].status.includes(
        'Waiting for API response cleanup',
      ),
    );
    assert.equal(delayed.run.phase, 'busy');
    assert.equal(delayed.run.continuous.active, true);
    assert.equal(delayed.run.continuous.used, 1);
    assert.equal(delayed.native.calls, 0);
    assert.ok(delayed.run.sdkRead);
    assert.equal(delayed.nodes.get('#next').disabled, true);
    await delayed.start();
    await delayed.next();
    assert.equal(delayed.sdkCalls, 1);
    delayed.releaseBody();
    await running;
    assert.equal(delayed.native.calls, 0);
    assert.equal(delayed.ops.includes('action'), false);
    assert.equal(delayed.run.sdkRead, undefined);
    assert.equal(delayed.sdkActive, 0);
    assert.equal(delayed.run.phase, 'ready');
    assert.equal(delayed.run.valid, true);
    assert.equal(delayed.run.worker, delayed.worker);
    assert.equal(delayed.worker.terminated, false);
    assert.equal(delayed.run.evidence.decisions[0].waitUnchanged, true);
    assert.equal(delayed.run.evidence.decisions[0].result, null);
    await delayed.next();
    assert.equal(delayed.sdkCalls, 2);
    assert.equal(delayed.sdkMax, 1);
  });

  it('drains late headers success rejection and application deadline cleanup before readiness', async () => {
    // Headers may settle before/after body; late rejection is drained too.
    for (const lateReject of [false, true]) {
      const h = fixture({ delayedHeaders: true, delayedBody: true });
      const work = h.start();
      await h.waiting.promise;
      h.stop();
      await until(() => h.run.evidence.decisions[0].status.includes('Waiting'));
      if (lateReject) h.rejectBody();
      else h.releaseBody();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.ok(h.run.sdkRead);
      await h.next();
      await h.start();
      assert.equal(h.sdkCalls, 1);
      h.releaseHeaders();
      await work;
      assert.equal(h.native.calls, 0);
      assert.equal(h.run.phase, 'ready');
    }
    const timeout = fixture({ delayedBody: true });
    const timeoutRun = timeout.start();
    await timeout.waiting.promise;
    timeout.timeout();
    await until(() =>
      timeout.run.evidence.decisions[0].status.includes('Waiting'),
    );
    await timeout.next();
    await timeout.start();
    assert.equal(timeout.sdkCalls, 1);
    timeout.releaseBody();
    await timeoutRun;
    assert.match(timeout.run.continuous.reason, /deadline/);
    assert.equal(timeout.native.calls, 0);
    assert.equal(timeout.run.continuous.used, 1);
  });

  it('owns manual admission synchronously through delayed bodies and timeout cleanup', async () => {
    // Manual ownership is synchronous too.
    const manual = fixture({ delayedBody: true });
    const manualRun = manual.next();
    await manual.waiting.promise;
    await manual.start();
    await manual.next();
    assert.equal(manual.sdkCalls, 1);
    assert.equal(manual.run.continuous, undefined);
    manual.releaseBody();
    assert.equal(await manualRun, 'completed');
    const manualTimeout = fixture({ delayedBody: true });
    const manualTimeoutRun = manualTimeout.next();
    await manualTimeout.waiting.promise;
    manualTimeout.timeout();
    await until(() =>
      manualTimeout.run.evidence.decisions[0].status.includes('Waiting'),
    );
    await manualTimeout.start();
    await manualTimeout.next();
    assert.equal(manualTimeout.sdkCalls, 1);
    manualTimeout.releaseBody();
    assert.equal(await manualTimeoutRun, 'api-failure');
    assert.equal(manualTimeout.run.phase, 'ready');
  });

  it('stops before dispatch with unchanged native state and exact attempt charging', async () => {
    // Stop before dispatch: initial capture (no API charge) and post-response snapshot.
    for (const occurrence of [1, 2]) {
      const h = fixture(),
        hold = h.hold('snapshot', occurrence);
      const work = h.start();
      await hold.waiting;
      const before = h.native.observe();
      h.stop();
      await h.next();
      await h.start();
      hold.release();
      await work;
      assert.deepEqual(h.native.observe(), before);
      assert.equal(h.sdkCalls, occurrence - 1);
      assert.equal(h.run.continuous.used, occurrence - 1);
      assert.equal(h.native.calls, 0);
      assert.equal(h.run.phase, 'ready');
      assert.equal(h.run.evidence.decisions[0].waitUnchanged, true);
    }
  });

  it('finishes dispatched actions and resulting frames before Stop restores readiness', async () => {
    // Stop after action dispatch or while resulting render is pending drains completion.
    for (const op of ['action', 'render']) {
      const h = fixture(),
        hold = h.hold(op);
      const work = h.start();
      await hold.waiting;
      h.stop();
      assert.match(
        h.nodes.get('#continuous-state').textContent,
        /Stopping after current decision/,
      );
      assert.equal(h.run.phase, 'busy');
      await h.next();
      await h.start();
      hold.release();
      await work;
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.native.calls, 6);
      assert.equal(h.run.phase, 'ready');
      assert.equal(h.run.worker, h.worker);
      assert.equal(h.run.evidence.decisions[0].execution.complete, true);
      assert.equal(h.run.evidence.decisions[0].result.tic, 7);
      assert.match(h.run.continuous.reason, /Stopped by user/);
    }
  });

  it('fences observation hashing and drains resulting native and Canvas hashing', async () => {
    // Observation hashing cancels before SDK; resulting payload/Canvas hashing drains.
    for (const holdDigest of [1, 2, 3]) {
      const h = fixture({ holdDigest });
      const work = h.start();
      await h.digestWaiting;
      h.stop();
      assert.equal(h.run.phase, 'busy');
      await h.next();
      await h.start();
      h.releaseDigest();
      await work;
      assert.equal(h.sdkCalls, holdDigest === 1 ? 0 : 1);
      assert.equal(h.native.calls, holdDigest === 1 ? 0 : 6);
      assert.equal(h.run.phase, 'ready');
      assert.equal(h.run.worker, h.worker);
    }
  });

  it('retires when stopped passive native-state verification fails', async () => {
    const failedPassive = fixture({ delayedBody: true, corruptSnapshot: 2 });
    const failedPassiveRun = failedPassive.start();
    await failedPassive.waiting.promise;
    failedPassive.stop();
    failedPassive.releaseBody();
    await failedPassiveRun;
    assert.equal(failedPassive.run.phase, 'error');
    assert.equal(failedPassive.run.valid, false);
    assert.equal(failedPassive.native.calls, 0);
    assert.equal(failedPassive.worker.terminated, true);
  });

  it('stops between iterations without a second SDK invocation', async () => {
    // Stop between iterations uses the browser-task yield, with no second call.
    const between = fixture({ holdYield: true });
    const betweenRun = between.start();
    await between.yieldWaiting;
    assert.equal(between.run.phase, 'ready');
    await between.next();
    await between.start();
    assert.equal(between.sdkCalls, 1);
    between.stop();
    between.releaseYield();
    await betweenRun;
    assert.equal(between.sdkCalls, 1);
    assert.equal(between.native.calls, 6);
  });

  it('stops API failures invalid answers and refusals without retry or restart', async () => {
    // Recoverable API failures and invalid/refused choices do not auto-retry.
    for (const options of [
      { apiError: true },
      { throwOnCreate: true },
      { choice: { answers: [] } },
      { choice: { answers: [{ type: 'refusal', name: 'next_action' }] } },
    ]) {
      const h = fixture(options);
      await h.start();
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.run.continuous.used, 1);
      assert.equal(h.native.calls, 0);
      assert.equal(h.run.phase, 'ready');
      assert.equal(h.run.continuous.active, false);
      assert.equal(h.run.worker, h.worker);
      assert.doesNotMatch(h.run.continuous.reason, /Budget exhausted/);
    }
  });

  it('retains terminal prefixes and frames then retires for death exit and combined signals', async () => {
    // Existing #16 terminal prefix, unsupported and uncertain accounting compose.
    for (const signals of [death, exit, { ...death, ...exit }]) {
      const h = fixture({ at: 2, signals });
      await h.start();
      const entry = h.run.evidence.decisions[0];
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.native.calls, 2);
      assert.equal(entry.execution.requestedTics, 6);
      assert.equal(entry.execution.reportedCompletedTics, 2);
      assert.equal(entry.execution.independentlyVerifiedTics, 2);
      assert.equal(entry.execution.terminal, true);
      assert.equal(entry.result.tic, 3);
      assert.equal(h.run.phase, 'terminal');
      assert.equal(h.worker.terminated, true);
      await h.start();
      await h.next();
      assert.equal(h.sdkCalls, 1);
    }
  });

  it('retires unsupported uncertain or unverifiable native outcomes and retains the previous frame', async () => {
    for (const options of [
      { at: 2, signals: { ready: 0 } },
      { trapAt: 2 },
      { badReceipt: true },
      { at: 2, signals: death, badFrame: true },
    ]) {
      const h = fixture(options);
      await h.start();
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.run.phase, 'error');
      assert.equal(h.run.valid, false);
      assert.equal(h.worker.terminated, true);
      assert.equal(h.run.evidence.decisions[0].result, null);
      assert.equal(h.run.frame.tic, 1);
      await h.start();
      await h.next();
      assert.equal(h.sdkCalls, 1);
    }
  });

  it('preserves terminal exit outcome when Stop arrives during rendering', async () => {
    const stoppingTerminal = fixture({ at: 2, signals: exit });
    const terminalRender = stoppingTerminal.hold('render');
    const terminalRun = stoppingTerminal.start();
    await terminalRender.waiting;
    stoppingTerminal.stop();
    terminalRender.release();
    await terminalRun;
    assert.equal(stoppingTerminal.run.phase, 'terminal');
    assert.match(stoppingTerminal.run.continuous.reason, /exit pending/);
    assert.equal(stoppingTerminal.native.calls, 2);
  });

  it('keeps the neutral preparation tic outside AI admission budget and history', async () => {
    // Neutral preparation stays outside admission, SDK work and history.
    const preparation = nativeFixture({ base: 0 });
    assert.equal(
      verifyAction(preparation.observe(), 0, 1, execute(preparation, 1))
        .complete,
      true,
    );
    assert.equal(preparation.calls, 1);
    assert.equal(preparation.observe().counters.gametic, 1);
    assert.match(
      section('async function prepare(', 'async function initialize()'),
      /action\(run, 0, 1, before/,
    );
    assert.doesNotMatch(
      section('async function prepare(', 'async function initialize()'),
      /decide\(|runOneDecision\(/,
    );
    assert.equal(assessE1M1(observation(1)).kind, 'alive');
  });
});
