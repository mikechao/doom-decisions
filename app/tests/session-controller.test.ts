// Ordinary-import lifecycle acceptance: local synthetic bytes/receipts and SDK
// transport only. No browser entry, source extraction, VM, WASM or game assets.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { Decisions } from 'openai/resources/decisions';
import { afterEach, it, vi } from 'vitest';
import {
  createSessionController,
  type SessionBrowserPorts,
  type SessionPresentation,
} from '../src/session-controller.ts';
import {
  nativeFixture,
  pixels,
  sha,
  workerResult,
} from './fixtures/synthetic-doom.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Shared only by these ordinary-import acceptance cases. Preparation still
// runs through the public controller and every native/Canvas/idle proof.
function fixture(onCreate?: (call: number) => void) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('crypto', webcrypto);
  const create = Decisions.prototype.create;
  const sdkCreate = vi
    .spyOn(Decisions.prototype, 'create')
    .mockImplementation(function (input, options) {
      assert.equal(options.maxRetries, 0);
      assert.equal(options.signal.aborted, false);
      onCreate?.(sdkCreate.mock.calls.length); // Synchronous; admission already sampled N.
      return create.call(this, input, options); // Preserve the actual pinned SDK.
    });
  const browserInputs = { tics: 6, budget: 2 };
  const wasm = new Uint8Array([1, 2, 3]).buffer;
  const wad = new ArrayBuffer(12);
  const native = nativeFixture({ base: 0 });
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
  let key = 'offline-not-a-credential';
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
      assert.equal(active, 0, 'No overlapping Worker/SDK work');
      maxActive = Math.max(maxActive, ++active);
      ops.push(data.op);
      if (data.op === 'action')
        actions.push({ mask: data.mask, tics: data.tics });
      transfers.push(transfer);
      const { result, frame } = workerResult(native, data);
      queueMicrotask(() => {
        --active;
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
    },
  };
  vi.stubGlobal('fetch', async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/decisions');
    assert.equal(active, 0, 'SDK begins after Worker settlement');
    maxActive = Math.max(maxActive, ++active);
    ++sdkCalls;
    const request = JSON.parse(options.body);
    inputs.push(request);
    sdkViews.push(view.session);
    assert.ok(
      JSON.stringify(request).includes('data:image/png;base64,synthetic'),
    );
    const response = new Response(
      JSON.stringify({
        answers: [{ type: 'choice', name: 'next_action', choice: 'neutral' }],
      }),
      {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_local',
        },
      },
    );
    const read = response.text.bind(response);
    response.text = async () => {
      try {
        return await read();
      } finally {
        --active;
      }
    };
    return response;
  });
  const ports: SessionBrowserPorts = {
    async localFetch(name, json?) {
      assert.equal(name, json ? 'doom-build.json' : 'doom.wasm');
      return json
        ? {
            profile: 'controlled-title',
            a1Fixtures: true,
            embeddedIwad: false,
            bytes: wasm.byteLength,
            sha256: sha(new Uint8Array(wasm)),
          }
        : wasm;
    },
    createWorker() {
      ++creations;
      return worker as unknown as Worker;
    },
    readTics: () => browserInputs.tics,
    takeKey() {
      const captured = key;
      key = '';
      return captured;
    },
    clearKey() {
      key = '';
    },
    focusBudget() {
      assert.fail('Valid inputs');
    },
    capture() {
      return {
        png: 'data:image/png;base64,synthetic',
        rgba: new Uint8ClampedArray(painted),
      };
    },
    paintAndReadback(rgba) {
      painted = new Uint8ClampedArray(rgba);
      ++paints;
      return new Uint8ClampedArray(painted);
    },
    clearCanvas() {
      painted.fill(0);
    },
    present(update) {
      view = { ...view, ...update };
      if (update.status?.includes('Checking five seconds of idle'))
        idleReached();
    },
  };
  const controller = createSessionController(ports);
  async function prepare() {
    assert.deepEqual(ops, []);
    assert.equal(creations, 0);
    assert.deepEqual(view, {}, 'Construction is inert');
    await controller.initialize();
    assert.equal(view.iwadEnabled, true);
    assert.match(view.sdkStatus, /7.32.0.*decisions.create available/);
    assert.equal(creations, 0);
    const preparing = controller.prepare({
      size: wad.byteLength,
      arrayBuffer: async () => wad,
    });
    await idle;
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

it('initializes, prepares, and completes one verified decision through ordinary imports', async () => {
  const h = fixture();
  const { controller, native, worker, ops } = h;
  try {
    const prepared = await h.prepare();
    assert.equal(await controller.next(), 'completed');
    const completed = h.view.session;
    const entry = completed.evidence.decisions[0];
    assert.equal(h.sdkCalls, 1);
    assert.equal(h.key, '');
    assert.equal(h.creations, 1, 'Persistent prepared Worker');
    assert.equal(worker.terminate.mock.calls.length, 0);
    assert.equal(h.maxActive, 1);
    assert.equal(h.active, 0);
    assert.equal(h.paints, 3);
    assert.equal(native.calls, 7);
    assert.equal(completed.verifiedTics, 7);
    assert.equal(completed.phase, 'ready');
    assert.equal(completed.controls.ready, true);
    assert.equal(completed.waitingForSdk, false);
    assert.equal(entry.status, 'Complete');
    assert.equal(entry.waitUnchanged, true);
    assert.equal(entry.execution.complete, true);
    assert.equal(entry.execution.independentlyVerifiedTics, 6);
    assert.equal(entry.observation.tic, 1);
    assert.equal(entry.result.tic, 7);
    assert.equal(entry.result.nativeSha256, sha(h.painted));
    assert.equal(entry.result.canvasSha256, entry.result.nativeSha256);
    assert.deepEqual(completed.frame, entry.result);
    assert.deepEqual(ops, [
      'load-i11',
      'init',
      'prepare',
      'snapshot',
      'action',
      'render',
      'snapshot',
      'snapshot',
      'render',
      'snapshot',
      'snapshot',
      'snapshot',
      'snapshot',
      'action',
      'render',
    ]);
    assert.deepEqual(
      completed.evidence.operations.map(({ op }) => op),
      ops,
    );
    assert.equal(
      prepared.evidence.decisions.length,
      0,
      'Presentation data is detached',
    );
  } finally {
    controller.close();
  }
});

// Ordinary-import replacement of the former VM budget-exhaustion case. Starts
// from actual preparation, never an injected ready Run or browser entry point.
it('runs sequential pinned SDK successes and restores manual admission at budget exhaustion through ordinary imports', async () => {
  const h = fixture();
  const { controller } = h;
  try {
    const prepared = await h.prepare();
    const preparationOps = [...h.ops];
    const running = controller.startContinuous(2);
    assert.equal(h.view.session.controls.ready, false);
    assert.equal(h.view.session.controls.stop, true);
    assert.equal(h.view.session.continuous.active, true);
    assert.equal(
      h.view.session.continuous.used,
      0,
      'Admission alone spends no attempt',
    );
    assert.equal(await controller.next(), 'not-admitted');
    await running;

    const exhausted = h.view.session;
    assert.equal(h.sdkCalls, 2);
    assert.equal(h.sdkCreate.mock.calls.length, 2);
    assert.equal(exhausted.evidence.decisions.length, 2);
    assert.equal(exhausted.continuous.limit, 2);
    assert.equal(exhausted.continuous.used, 2);
    assert.equal(exhausted.continuous.active, false);
    assert.match(exhausted.continuous.reason, /Budget exhausted/);
    assert.equal(exhausted.phase, 'ready');
    assert.equal(exhausted.controls.ready, true);
    assert.equal(exhausted.controls.stop, false);
    assert.equal(exhausted.waitingForSdk, false);
    assert.equal(exhausted.hasClient, true);
    assert.equal(exhausted.verifiedTics, 13);
    assert.equal(h.native.calls, 13);
    assert.equal(h.creations, 1);
    assert.equal(h.worker.terminate.mock.calls.length, 0);
    assert.equal(h.active, 0);
    assert.equal(
      h.maxActive,
      1,
      'SDK readers and Worker requests never overlap',
    );
    assert.equal(h.paints, 4);

    assert.equal(await controller.next(), 'completed');
    const completed = h.view.session;
    assert.equal(h.sdkCalls, 3);
    assert.equal(h.sdkCreate.mock.calls.length, 3);
    assert.deepEqual(
      completed.continuous,
      exhausted.continuous,
      'Manual admission neither spends nor revives the exhausted budget',
    );
    assert.equal(completed.verifiedTics, 19);
    assert.equal(h.native.calls, 19);
    assert.equal(completed.phase, 'ready');
    assert.equal(completed.controls.ready, true);
    assert.equal(completed.waitingForSdk, false);
    assert.equal(h.key, '');
    assert.equal(
      h.creations,
      1,
      'All three decisions retain the prepared Worker',
    );
    assert.equal(h.worker.terminate.mock.calls.length, 0);
    assert.equal(h.maxActive, 1);
    assert.equal(h.active, 0);
    assert.equal(h.paints, 5);
    assert.match(h.view.status, /Ready at tic 19/);
    assert.match(h.view.frameStatus, /E1M1 · tic 19/);

    const entries = completed.evidence.decisions;
    assert.equal(entries.length, 3);
    let previousFrame = prepared.frame;
    for (const [index, entry] of entries.entries()) {
      const tic = 1 + 6 * index;
      assert.equal(entry.number, index + 1);
      assert.equal(entry.selectedTics, 6);
      assert.equal(entry.action, 'neutral');
      assert.equal(entry.status, 'Complete');
      assert.equal(entry.requestId, 'req_local');
      assert.equal(entry.http, 200);
      assert.equal(entry.waitUnchanged, true);
      assert.equal(entry.execution.complete, true);
      assert.equal(entry.execution.requestedTics, 6);
      assert.equal(entry.execution.reportedCompletedTics, 6);
      assert.equal(entry.execution.independentlyVerifiedTics, 6);
      assert.equal(entry.cumulativeVerifiedTics, tic + 6);
      assert.deepEqual(entry.observation, previousFrame);
      assert.equal(entry.observation.tic, tic);
      assert.equal(entry.result.tic, tic + 6);
      assert.equal(entry.result.nativeSha256, sha(pixels(tic + 6)));
      assert.equal(entry.result.canvasSha256, entry.result.nativeSha256);
      previousFrame = entry.result;
      assert.match(
        h.inputs[index].input[0].content[0].text,
        new RegExp(`verified tic ${tic}\\b`),
      );
      const atRequest = h.sdkViews[index];
      assert.equal(atRequest.phase, 'busy');
      assert.equal(atRequest.controls.ready, false);
      assert.equal(atRequest.waitingForSdk, true);
      assert.equal(atRequest.continuous.used, Math.min(index + 1, 2));
      assert.equal(atRequest.continuous.active, index < 2);
      assert.equal(atRequest.evidence.decisions.length, index + 1);
      if (index > 0) {
        const previous = atRequest.evidence.decisions[index - 1];
        assert.equal(
          previous.status,
          'Complete',
          'Next SDK call follows frame verification',
        );
        assert.deepEqual(previous.result, entry.observation);
      }
    }
    assert.deepEqual(completed.frame, previousFrame);
    assert.equal(completed.frame.nativeSha256, sha(h.painted));
    assert.deepEqual(completed.evidence.frames, [
      ...prepared.evidence.frames,
      ...entries.map((entry) => entry.result),
    ]);
    assert.deepEqual(h.actions, [
      { mask: 0, tics: 1 },
      ...entries.map(() => ({ mask: 0, tics: 6 })),
    ]);
    assert.deepEqual(h.ops, [
      ...preparationOps,
      ...entries.flatMap(() => ['snapshot', 'snapshot', 'action', 'render']),
    ]);
    assert.deepEqual(
      completed.evidence.operations.map(({ op }) => op),
      h.ops,
    );
    assert.equal(
      prepared.evidence.decisions.length,
      0,
      'Preparation snapshot remains detached',
    );
    assert.equal(
      exhausted.evidence.decisions.length,
      2,
      'Exhaustion snapshot remains detached',
    );
  } finally {
    controller.close();
  }
  assert.equal(
    h.worker.terminate.mock.calls.length,
    1,
    'Close retires the one persistent Worker',
  );
  assert.equal(h.worker.onmessage, null);
  assert.equal(h.worker.onerror, null);
  assert.equal(h.worker.onmessageerror, null);
  assert.equal(h.active, 0);
  assert.equal(h.key, '');
  assert.equal(await controller.next(), 'not-admitted');
  await controller.startContinuous(2);
  assert.equal(h.sdkCalls, 3, 'Closed controller cannot restart');
  assert.equal(h.sdkCreate.mock.calls.length, 3);
  assert.equal(h.creations, 1);
});

// Changing browser inputs at the first real SDK invocation must affect only
// later admissions; startContinuous samples the browser budget once at entry.
it('freezes each admission N and the run budget while chaining verified frames in one session through ordinary imports', async () => {
  const h = fixture((call) => {
    if (call !== 1) return;
    assert.equal(
      h.view.session.controls.tics,
      true,
      'N stays editable during continuous play',
    );
    assert.equal(
      h.view.session.controls.ready,
      false,
      'Budget/start/manual admission stay locked',
    );
    assert.equal(h.view.session.continuous.active, true);
    assert.equal(h.view.session.evidence.decisions[0].selectedTics, 21);
    h.browserInputs.tics = 35;
    h.browserInputs.budget = 1000;
  });
  const { controller } = h;
  try {
    const prepared = await h.prepare();
    const preparationOps = [...h.ops];
    const preparationPaints = h.paints;
    h.browserInputs.tics = 21;
    const running = controller.startContinuous(h.browserInputs.budget);
    assert.equal(
      h.view.session.evidence.decisions[0].selectedTics,
      21,
      'First admission samples N synchronously',
    );
    assert.equal(h.view.session.continuous.limit, 2);
    assert.equal(h.view.session.controls.ready, false);
    assert.equal(await controller.next(), 'not-admitted');
    await running;

    const exhausted = h.view.session;
    const [first, second] = exhausted.evidence.decisions;
    assert.equal(h.browserInputs.tics, 35);
    assert.equal(
      h.browserInputs.budget,
      1000,
      'Browser input changed, not the admitted run',
    );
    assert.equal(first.selectedTics, 21);
    assert.equal(second.selectedTics, 35);
    assert.equal(first.result.tic, 22);
    assert.equal(second.result.tic, 57);
    assert.deepEqual(first.observation, prepared.frame);
    assert.deepEqual(second.observation, first.result);
    assert.deepEqual(exhausted.frame, second.result);
    assert.equal(exhausted.verifiedTics, 57);
    assert.equal(h.native.calls, 57);
    assert.equal(h.sdkCreate.mock.calls.length, 2);
    assert.equal(h.sdkCalls, 2);
    assert.equal(
      h.maxActive,
      1,
      'Neither SDK readers nor Worker requests overlap',
    );
    assert.equal(h.active, 0);
    assert.equal(h.creations, 1);
    assert.equal(h.worker.terminate.mock.calls.length, 0);
    assert.equal(exhausted.continuous.limit, 2);
    assert.equal(exhausted.continuous.used, 2);
    assert.equal(exhausted.continuous.active, false);
    assert.match(exhausted.continuous.reason, /Budget exhausted/);
    assert.equal(exhausted.phase, 'ready');
    assert.equal(exhausted.controls.ready, true);
    assert.equal(exhausted.controls.tics, true);
    assert.equal(exhausted.controls.stop, false);
    assert.equal(exhausted.waitingForSdk, false);
    assert.equal(
      h.paints - preparationPaints,
      2,
      'One resulting frame per decision',
    );
    assert.match(h.view.frameStatus, /E1M1 · tic 57/);
    assert.match(h.inputs[1].input[0].content[0].text, /verified tic 22\b/);

    assert.equal(await controller.next(), 'completed');
    const completed = h.view.session;
    assert.equal(h.sdkCreate.mock.calls.length, 3);
    assert.equal(h.sdkCalls, 3);
    assert.deepEqual(
      completed.continuous,
      exhausted.continuous,
      'Manual admission preserves the exhausted budget and never restarts it',
    );
    assert.equal(completed.verifiedTics, 92);
    assert.equal(h.native.calls, 92);
    assert.equal(h.creations, 1, 'Manual work retains the prepared Worker');
    assert.equal(h.worker.terminate.mock.calls.length, 0);
    assert.equal(h.active, 0);
    assert.equal(h.maxActive, 1);
    assert.equal(completed.phase, 'ready');
    assert.equal(completed.controls.ready, true);
    assert.equal(completed.waitingForSdk, false);
    assert.equal(h.paints - preparationPaints, 3);
    assert.match(h.view.status, /Ready at tic 92/);

    const entries = completed.evidence.decisions;
    assert.equal(entries.length, 3);
    const durations = [21, 35, 35];
    const observations = [1, 22, 57];
    let previousFrame = prepared.frame;
    for (const [index, entry] of entries.entries()) {
      const n = durations[index];
      const tic = observations[index];
      assert.equal(entry.selectedTics, n);
      assert.equal(entry.status, 'Complete');
      assert.equal(entry.action, 'neutral');
      assert.equal(entry.requestId, 'req_local');
      assert.equal(entry.http, 200);
      assert.equal(entry.execution.complete, true);
      assert.equal(entry.execution.requestedTics, n);
      assert.equal(entry.execution.reportedCompletedTics, n);
      assert.equal(entry.execution.independentlyVerifiedTics, n);
      assert.equal(entry.waitUnchanged, true);
      assert.equal(entry.cumulativeVerifiedTics, tic + n);
      assert.deepEqual(entry.observation, previousFrame);
      assert.equal(entry.result.tic, tic + n);
      assert.equal(entry.result.nativeSha256, sha(pixels(tic + n)));
      assert.equal(entry.result.canvasSha256, entry.result.nativeSha256);
      previousFrame = entry.result;
      const atRequest = h.sdkViews[index];
      assert.equal(atRequest.verifiedTics, tic);
      assert.deepEqual(atRequest.frame, entry.observation);
      assert.equal(atRequest.controls.ready, false);
      assert.equal(atRequest.waitingForSdk, true);
      assert.equal(atRequest.continuous.limit, 2);
      assert.equal(atRequest.continuous.used, Math.min(index + 1, 2));
      assert.equal(atRequest.continuous.active, index < 2);
      assert.equal(atRequest.controls.tics, index < 2);
      if (index > 0) {
        const previous = atRequest.evidence.decisions[index - 1];
        assert.equal(
          previous.status,
          'Complete',
          'Prior resulting frame is verified before requesting again',
        );
        assert.deepEqual(previous.result, entry.observation);
      }
    }
    assert.deepEqual(completed.frame, previousFrame);
    assert.equal(completed.frame.nativeSha256, sha(h.painted));
    assert.deepEqual(completed.evidence.frames, [
      ...prepared.evidence.frames,
      ...entries.map((entry) => entry.result),
    ]);
    assert.deepEqual(h.actions, [
      { mask: 0, tics: 1 },
      ...durations.map((tics) => ({ mask: 0, tics })),
    ]);
    assert.deepEqual(h.ops, [
      ...preparationOps,
      ...entries.flatMap(() => ['snapshot', 'snapshot', 'action', 'render']),
    ]);
    assert.deepEqual(
      completed.evidence.operations.map(({ op }) => op),
      h.ops,
    );
    assert.equal(
      exhausted.evidence.decisions.length,
      2,
      'Public snapshots remain detached',
    );
  } finally {
    controller.close();
  }
  assert.equal(h.worker.terminate.mock.calls.length, 1);
  assert.equal(h.worker.onmessage, null);
  assert.equal(h.worker.onerror, null);
  assert.equal(h.worker.onmessageerror, null);
  assert.equal(h.active, 0);
  assert.equal(h.key, '');
});
