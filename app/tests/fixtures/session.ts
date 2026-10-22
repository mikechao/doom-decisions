// Ordinary-import lifecycle acceptance: local synthetic bytes/receipts and SDK
// transport only. No browser entry, source extraction, VM, WASM or game assets.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { OpenAI } from 'openai/client';
import { Decisions } from 'openai/resources/decisions';
import { vi } from 'vitest';
import { defaultDecisionConfiguration } from '../../src/decision-request.ts';
import { openAiDecisionProviderFactory } from '../../src/openai-decision-provider.ts';
import {
  createSessionController,
  type SessionBrowserPorts,
  type SessionPresentation,
} from '../../src/session-controller.ts';
import { nativeFixture, pixels, sha, workerResult } from './synthetic-doom.ts';

// Offline browser ports shared by controller cases. Preparation still
// runs through the public controller and every native/Canvas/idle proof.
export function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  // Some gates deliberately reject before their consumer begins reading.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
export async function checkpoint(predicate) {
  for (let n = 0; n < 2000; ++n) {
    if (predicate()) return;
    await setImmediate(); // Drain tasks/crypto completions, without a timed sleep.
  }
  assert.fail('Expected synthetic lifecycle checkpoint');
}
const restorers = [];
export function cleanup() {
  while (restorers.length) restorers.pop()();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}
export async function withSession(options, test) {
  const h = fixture(options);
  try {
    await h.prepare();
    await test(h);
  } finally {
    await h.dispose();
  }
}
export function fixture(configuration = {}) {
  const settings =
    typeof configuration === 'function'
      ? { onCreate: configuration }
      : configuration;
  const { onCreate } = settings;
  const headerGate = deferred(),
    bodyGate = deferred();
  const headersWaiting = deferred(),
    waiting = deferred(),
    parserWaiting = deferred();
  const holds = new Map(),
    seen = new Map();
  const helperSettlements = [];
  let ready = false,
    preparationOps = 0,
    preparationPaints = 0;
  let readerPending = false,
    parserSettled = false,
    parserError;
  let transportActive = 0,
    workerActive = 0,
    transportCalls = 0;
  let digestCount = 0,
    digestHold;
  const faults = { ...settings.faults };
  const choice = settings.choice ?? {
    answers: [{ type: 'choice', name: 'next_action', choice: 'neutral' }],
  };
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'],
  });
  vi.stubGlobal('crypto', webcrypto);
  const realDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  vi.spyOn(webcrypto.subtle, 'digest').mockImplementation(async (...args) => {
    ++digestCount;
    if (digestHold?.at === digestCount) {
      digestHold.waiting.resolve();
      await digestHold.gate.promise;
    }
    return realDigest(...args);
  });
  const create = Decisions.prototype.create;
  // A Vitest spy observes returned thenables and would start APIPromise parsing
  // before requestDecision installs its reader observer. Use a plain call-through
  // wrapper, retaining the real SDK object/classes and lazy APIPromise semantics.
  const sdkCreate = { mock: { calls: [] } };
  const observeCreate = function (input, options) {
    sdkCreate.mock.calls.push([input, options]);
    assert.equal(options.maxRetries, 0);
    assert.equal(options.signal.aborted, false);
    ++sdkCalls;
    assert.equal(
      active,
      0,
      'SDK invocation starts without pending Worker/transport work',
    );
    onCreate?.(sdkCreate.mock.calls.length); // Synchronous; admission already sampled N.
    if (settings.throwOnCreate) throw new OpenAI.APIConnectionError({});
    const pending = create.call(
      this,
      input,
      settings.sdkDeadlineMs === undefined
        ? options
        : { ...options, timeout: settings.sdkDeadlineMs },
    );
    const asResponse = pending.asResponse.bind(pending);
    pending.asResponse = () => {
      const headers = asResponse();
      helperSettlements.push(
        headers.then(
          () => {},
          () => {},
        ),
      );
      return headers;
    };
    const withResponse = pending.withResponse.bind(pending);
    pending.withResponse = () => {
      const parsing = withResponse();
      helperSettlements.push(
        parsing.then(
          () => {
            parserSettled = true;
            parserWaiting.resolve();
          },
          (error) => {
            parserSettled = true;
            parserError = error;
            parserWaiting.resolve();
          },
        ),
      );
      return parsing;
    };
    return pending; // Actual SDK parser, identities, reader and Abort/deadline races.
  };
  if (!settings.providerFactory) {
    Decisions.prototype.create = observeCreate;
    restorers.push(() => {
      Decisions.prototype.create = create;
    });
  }
  const browserInputs = { tics: 6, budget: 2, promptEditorOpen: false };
  const savedConfiguration = settings.decisionConfiguration ?? defaultDecisionConfiguration;
  const wasm = new Uint8Array([1, 2, 3]).buffer;
  const wad = settings.wad ?? new ArrayBuffer(12);
  const native = nativeFixture({
    base: 0,
    at: settings.at === undefined ? Infinity : settings.at + 1,
    trapAt: settings.trapAt === undefined ? Infinity : settings.trapAt + 1,
    signals: settings.signals ?? {},
    onStep: settings.onStep,
  });
  const ops = [];
  const transfers = [];
  const actions = [];
  const inputs = [];
  const sdkViews = [];
  let active = 0,
    maxActive = 0,
    sdkCalls = 0,
    creations = 0,
    paints = 0;
  let key = settings.key ?? 'offline-not-a-credential';
  let assetReads = 0,
    wasmFetches = 0,
    budgetFocus = 0;
  let painted = new Uint8ClampedArray(1024000);
  let view: SessionPresentation = {};
  let idleReached: () => void;
  const idle = new Promise<void>((resolve) => {
    idleReached = resolve;
  });
  const worker = {
    onmessage: null,
    terminate: vi.fn(),
    postMessage(data, transfer) {
      assert.equal(
        this.terminate.mock.calls.length,
        0,
        'No request after Worker retirement',
      );
      assert.equal(active, 0, 'No overlapping Worker/SDK work');
      maxActive = Math.max(maxActive, ++active);
      ++workerActive;
      const occurrence = (seen.get(data.op) ?? 0) + 1;
      seen.set(data.op, occurrence);
      ops.push(data.op);
      if (data.op === 'action')
        actions.push({ mask: data.mask, tics: data.tics });
      transfers.push(transfer);
      const complete = () => {
        const { result, frame } = workerResult(
          native,
          data,
          ready
            ? {
                ...faults,
                corruptSnapshot:
                  data.op === 'snapshot' &&
                  faults.corruptSnapshot ===
                    occurrence - (preparationSnapshots ?? 0),
              }
            : {},
        );
        settings.mutateResult?.(data, result, frame, ready);
        queueMicrotask(() => {
          --active;
          --workerActive;
          this.onmessage?.({
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
  vi.stubGlobal('fetch', async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/decisions');
    assert.equal(active, 0, 'SDK begins after Worker settlement');
    maxActive = Math.max(maxActive, ++active);
    ++transportCalls;
    ++transportActive;
    const request = JSON.parse(options.body);
    inputs.push(request);
    sdkViews.push(view.session);
    assert.ok(
      JSON.stringify(request).includes('data:image/png;base64,'),
    );
    headersWaiting.resolve();
    try {
      if (settings.delayedHeaders) await headerGate.promise;
    } catch (error) {
      --active;
      --transportActive;
      throw error;
    }
    const response = new Response(null, {
      status: settings.apiError ? 401 : 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_local',
      },
    });
    --active;
    --transportActive; // Headers settled; SDK may refuse a canceled body without reading it.
    response.text = async () => {
      assert.equal(
        active,
        0,
        'Reader starts without other native/transport work',
      );
      maxActive = Math.max(maxActive, ++active);
      ++transportActive;
      readerPending = true;
      waiting.resolve();
      try {
        if (settings.delayedBody) await bodyGate.promise;
        return JSON.stringify(
          settings.apiError
            ? { error: { message: 'private fixture error' } }
            : choice,
        );
      } finally {
        readerPending = false;
        --active;
        --transportActive;
      }
    };
    return response;
  });
  const ports: SessionBrowserPorts = {
    async localFetch(name, json?) {
      assert.equal(name, json ? 'doom-build.json' : 'doom.wasm');
      if (!json) ++wasmFetches;
      return json
        ? {
            profile: 'controlled-title',
            a1Fixtures: true,
            embeddedIwad: false,
            bytes: settings.engineBytes ?? wasm.byteLength,
            sha256: settings.engineHash ?? sha(new Uint8Array(wasm)),
          }
        : wasm;
    },
    createWorker() {
      ++creations;
      return worker as unknown as Worker;
    },
    readTics: () => browserInputs.tics,
    readDecisionConfiguration: () => savedConfiguration,
    promptEditorOpen: () => browserInputs.promptEditorOpen,
    takeKey() {
      const captured = key;
      key = '';
      return captured;
    },
    clearKey() {
      key = '';
    },
    focusBudget() {
      ++budgetFocus;
    },
    capture() {
      return {
        png: faults.badPng ? 'bad' : settings.pngFor?.(painted) ?? 'data:image/png;base64,synthetic',
        rgba: new Uint8ClampedArray(painted),
      };
    },
    paintAndReadback(rgba) {
      painted = new Uint8ClampedArray(rgba);
      if (ready && faults.badCanvas) painted[0]++;
      ++paints;
      return new Uint8ClampedArray(painted);
    },
    clearCanvas() {
      painted.fill(0);
    },
    present(update) {
      view = { ...view, ...update, status: update.status ?? view.status };
      if (update.status?.includes('Checking five seconds of idle'))
        idleReached();
    },
  };
  let preparationSnapshots = 0;
  const controller = createSessionController(
    ports,
    settings.providerFactory ?? openAiDecisionProviderFactory,
  );
  async function prepare() {
    assert.deepEqual(ops, []);
    assert.equal(creations, 0);
    assert.deepEqual(view, {}, 'Construction is inert');
    await controller.initialize();
    assert.equal(view.iwadEnabled, true);
    if (!settings.providerFactory)
      assert.match(view.sdkStatus, /7.32.0.*decisions.create available/);
    assert.equal(creations, 0);
    const preparing = controller.prepare({
      size: wad.byteLength,
      arrayBuffer: async () => {
        ++assetReads;
        return wad;
      },
    });
    const reachedIdle = await Promise.race([
      idle.then(() => true),
      preparing.then(() => false),
    ]);
    assert.equal(
      reachedIdle,
      true,
      `Preparation reached idle proof: ${view.status}`,
    );
    assert.equal(sdkCalls, 0, 'Preparation makes no API request');
    assert.equal(native.calls, 1, 'Exactly one mandatory neutral tic');
    assert.equal(view.session.controls.ready, false);
    assert.equal(await controller.next(), 'not-admitted');
    await vi.advanceTimersByTimeAsync(5000);
    await preparing;
    const prepared = view.session;
    assert.equal(prepared.controls.ready, true);
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.verifiedTics, 1);
    assert.equal(prepared.evidence.neutralFirst.requestedTics, 1);
    assert.equal(prepared.evidence.neutralFirst.reportedCompletedTics, 1);
    assert.equal(prepared.evidence.neutralFirst.independentlyVerifiedTics, 1);
    assert.equal(prepared.evidence.idle.observedMs, 5000);
    assert.equal(prepared.evidence.idle.unchanged, true);
    assert.deepEqual(
      prepared.evidence.idle.before,
      prepared.evidence.idle.after,
    );
    assert.equal(
      prepared.evidence.assets.iwad.sha256,
      sha(new Uint8Array(wad)),
    );
    assert.deepEqual(
      transfers[0],
      [wasm, wad],
      'Both local buffers transferred',
    );
    assert.deepEqual(
      prepared.evidence.frames.map((frame) => frame.tic),
      [1, 1],
    );
    for (const frame of prepared.evidence.frames) {
      assert.equal(frame.nativeSha256, sha(pixels(1)));
      assert.equal(frame.canvasSha256, frame.nativeSha256);
    }
    assert.equal(
      native.calls,
      1,
      'Passive preparation never advances gameplay',
    );
    ready = true;
    preparationOps = ops.length;
    preparationPaints = paints;
    preparationSnapshots = seen.get('snapshot') ?? 0;
    vi.useRealTimers(); // Only the synthetic five-second preparation wait is faked.
    return prepared;
  }
  return {
    controller,
    prepare,
    native,
    worker,
    ops,
    actions,
    inputs,
    sdkViews,
    sdkCreate,
    browserInputs,
    faults,
    choice,
    ports,
    headersWaiting: headersWaiting.promise,
    waiting: waiting.promise,
    parserWaiting: parserWaiting.promise,
    releaseHeaders: () => headerGate.resolve(),
    rejectHeaders: () => headerGate.reject(new OpenAI.APIConnectionError({})),
    releaseBody: () => bodyGate.resolve(),
    rejectBody: () => bodyGate.reject(Error('Late synthetic body rejection')),
    clock: () =>
      vi.useFakeTimers({
        toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'],
      }),
    timeout: () => vi.advanceTimersByTimeAsync(10000),
    start: () => controller.startContinuous(browserInputs.budget),
    next: () => controller.next(),
    stop: () => controller.stop(),
    hold(op, occurrence = 1) {
      const hold = { waiting: deferred(), complete: undefined };
      holds.set(`${op}:${(seen.get(op) ?? 0) + occurrence}`, hold);
      return {
        waiting: hold.waiting.promise,
        release: () => {
          assert.ok(hold.complete, 'Expected held Worker operation');
          const complete = hold.complete;
          hold.complete = undefined;
          complete();
        },
      };
    },
    holdDigest(n) {
      digestHold = {
        at: digestCount + n,
        waiting: deferred(),
        gate: deferred(),
      };
      return {
        waiting: digestHold.waiting.promise,
        release: () => digestHold.gate.resolve(),
      };
    },
    async select(
      file = {
        size: wad.byteLength,
        arrayBuffer: async () => {
          ++assetReads;
          return wad;
        },
      },
    ) {
      const preparing = controller.prepare(file);
      const idling = await Promise.race([
        preparing.then(() => false),
        idle.then(() => true),
      ]);
      if (idling) await vi.advanceTimersByTimeAsync(5000);
      await preparing;
    },
    async dispose() {
      try {
        controller.close();
        bodyGate.resolve();
        headerGate.resolve();
        digestHold?.gate.resolve();
        // A retired synthetic Worker discards any held operation, rather than
        // performing native work just to clean up a failing test.
        for (const hold of holds.values())
          if (hold.complete) {
            hold.complete = undefined;
            --workerActive;
            --active;
          }
        await Promise.allSettled(helperSettlements);
        await checkpoint(() => active === 0 && !readerPending);
        if (vi.isFakeTimers()) {
          await vi.advanceTimersByTimeAsync(0); // Drain only a pending iteration yield.
          assert.equal(
            vi.getTimerCount(),
            0,
            'SDK and Worker deadlines cleared',
          );
        }
      } finally {
        cleanup();
      }
    },
    set key(value) {
      key = value;
    },
    get gameCalls() {
      return native.calls - 1;
    },
    get gameOps() {
      return ops.slice(preparationOps);
    },
    get gamePaints() {
      return paints - preparationPaints;
    },
    get paintedHash() {
      return sha(painted);
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
    get workerActive() {
      return workerActive;
    },
    get transportActive() {
      return transportActive;
    },
    get transportCalls() {
      return transportCalls;
    },
    get assetReads() {
      return assetReads;
    },
    get wasmFetches() {
      return wasmFetches;
    },
    get budgetFocus() {
      return budgetFocus;
    },
    get view() {
      return view;
    },
    get sdkCalls() {
      return sdkCalls;
    },
    get key() {
      return key;
    },
    get creations() {
      return creations;
    },
    get maxActive() {
      return maxActive;
    },
    get active() {
      return active;
    },
    get paints() {
      return paints;
    },
    get painted() {
      return painted;
    },
  };
}
