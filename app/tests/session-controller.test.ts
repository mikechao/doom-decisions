// Ordinary-import lifecycle acceptance: local synthetic bytes/receipts and SDK
// transport only. No browser entry, source extraction, VM, WASM or game assets.
import assert from 'node:assert/strict';
import { afterEach, it } from 'vitest';
import { cleanup, fixture } from './fixtures/session.ts';
import { pixels, sha } from './fixtures/synthetic-doom.ts';

afterEach(cleanup);

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
