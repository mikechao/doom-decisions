// Ordinary-import lifecycle acceptance: local synthetic bytes/receipts and SDK
// transport only. No browser entry, source extraction, VM, WASM or game assets.
import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import { DecisionFailure, verifyAction } from '../src/decision.ts';
import type {
  DecisionProvider,
  DecisionProviderFactory,
  DecisionRequest,
  DecisionResult,
} from '../src/decision-provider.ts';
import { checkpoint, cleanup, deferred, fixture } from './fixtures/session.ts';
import { pixels, sha } from './fixtures/synthetic-doom.ts';

afterEach(cleanup);

function fakeProviderFactory(
  request: DecisionProvider['request'],
): DecisionProviderFactory {
  return {
    probe: () => ({
      status: 'Offline fake available',
      evidence: { provider: 'offline-fake' },
    }),
    create: () => ({ request }),
  };
}

it('prepares without credentials and retains all proofs while refusing manual and continuous inference', async () => {
  const request = vi.fn(() => assert.fail('No provider request without credentials'));
  const providerFactory = fakeProviderFactory(request);
  const create = vi.spyOn(providerFactory, 'create');
  const h = fixture({ key: '', providerFactory });
  try {
    // The shared helper asserts neutral 1/1/1, readiness locked during idle,
    // matching frame/Canvas hashes, and unchanged state after the idle proof.
    const prepared = await h.prepare();
    assert.equal(prepared.hasClient, false);
    assert.equal(prepared.frame.tic, 1);
    assert.equal(h.view.status, 'Ready at tic 1 — neutral 1/1/1; passive checks unchanged.');
    assert.equal(await h.next(), 'not-admitted');
    await h.controller.startContinuous(1);
    assert.equal(h.view.session.continuous.used, 0);
    assert.deepEqual(h.view.session.evidence.decisions, []);
    assert.equal(h.native.calls, 1);
    assert.equal(create.mock.calls.length, 0);
    assert.equal(request.mock.calls.length, 0);
  } finally {
    await h.dispose();
  }
});

it('injects domain-only decisions while the controller freezes N and verifies manual and continuous frames', async () => {
  const inputs: DecisionRequest[] = [];
  const providerFactory = fakeProviderFactory((input, _lifecycle, diagnostics, hooks) => {
    hooks.assertFresh();
    hooks.beforeCreate();
    inputs.push(input);
    assert.deepEqual(Object.keys(input).sort(), [
      'context', 'instructions', 'permittedActions', 'png',
    ]);
    assert.deepEqual(input.permittedActions, [
      'neutral', 'forward', 'turn_right', 'backward', 'turn_left', 'fire', 'use',
    ]);
    assert.equal(input.png, 'data:image/png;base64,synthetic');
    assert.equal(Object.isFrozen(input), true);
    assert.equal(Object.isFrozen(input.permittedActions), true);
    h.browserInputs.tics = 35; // Later admissions only; provider cannot choose duration.
    diagnostics.requestId = 'req_fake';
    diagnostics.latencyMs = 0;
    return Promise.resolve({ kind: 'choice', action: 'neutral', confidence: 0.7 });
  });
  const create = vi.spyOn(providerFactory, 'create');
  const h = fixture({ providerFactory });
  try {
    await h.prepare();
    assert.equal(create.mock.calls.length, 0, 'Preparation does not construct a provider client');
    assert.equal(h.view.sdkStatus, 'Offline fake available');
    assert.deepEqual(h.view.session.evidence.sdk, { provider: 'offline-fake' });
    h.browserInputs.tics = 2;
    const manual = h.next();
    assert.equal(await h.next(), 'not-admitted');
    assert.equal(await manual, 'completed');
    assert.equal(create.mock.calls.length, 1, 'First decision constructs the client');
    await h.controller.startContinuous(1);
    assert.equal(create.mock.calls.length, 1, 'Later decisions retain the client');
    const [first, second] = h.view.session.evidence.decisions;
    assert.match(inputs[0].instructions, /time horizon for this action is 2 gameplay tics/);
    assert.match(inputs[1].instructions, /time horizon for this action is 35 gameplay tics/);
    assert.match(inputs[0].context, /verified tic 1\./);
    assert.match(inputs[1].context, /verified tic 3\./);
    assert.deepEqual(h.actions, [
      { mask: 0, tics: 1 },
      { mask: 0, tics: 2 },
      { mask: 0, tics: 35 },
    ]);
    assert.equal(first.selectedTics, 2);
    assert.equal(second.selectedTics, 35);
    assert.deepEqual(second.observation, first.result);
    for (const entry of [first, second]) {
      assert.equal(entry.execution.complete, true);
      assert.equal(entry.execution.independentlyVerifiedTics, entry.selectedTics);
      assert.equal(entry.result.nativeSha256, entry.result.canvasSha256);
      assert.equal(entry.waitUnchanged, true);
      assert.deepEqual(entry.choice, {
        action: 'neutral',
        confidence: 0.7,
        probabilities: null,
      });
      assert.equal(entry.requestId, 'req_fake');
    }
    assert.equal(h.view.session.verifiedTics, 38);
    assert.equal(h.view.session.continuous.used, 1);
    assert.equal(h.view.session.continuous.limit, 1);
    assert.equal(h.view.session.controls.ready, true);
    h.browserInputs.tics = 0;
    assert.equal(await h.next(), 'not-admitted');
    assert.equal(inputs.length, 2);
    assert.equal(h.sdkCalls, 0);
    assert.equal(h.transportCalls, 0);
    assert.equal(h.creations, 1);
  } finally {
    await h.dispose();
  }
});

it('rejects invalid fake actions, refusals and failures without dispatch, retry or raw-error disclosure', async () => {
  const outcomes: (DecisionResult | Error)[] = [
    { kind: 'choice', action: 'forward+fire' },
    { kind: 'refusal' },
    new DecisionFailure('API connection failure (network/CORS/access)'),
    new Error('private provider response'),
  ];
  for (const outcome of outcomes) {
    let calls = 0;
    const providerFactory = fakeProviderFactory((_input, _lifecycle, _diagnostics, hooks) => {
      hooks.assertFresh();
      hooks.beforeCreate();
      ++calls;
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    });
    const h = fixture({ providerFactory });
    try {
      await h.prepare();
      await h.start();
      assert.equal(calls, 1);
      assert.equal(h.view.session.continuous.used, 1);
      assert.equal(h.view.session.continuous.active, false);
      assert.equal(h.gameCalls, 0);
      assert.equal(h.gameOps.includes('action'), false);
      assert.equal(h.sdkCalls, 0);
      assert.equal(h.transportCalls, 0);
      const recoverable =
        !(outcome instanceof Error) || outcome instanceof DecisionFailure;
      assert.equal(h.view.session.phase, recoverable ? 'ready' : 'error');
      assert.equal(h.view.session.controls.ready, recoverable);
      assert.doesNotMatch(
        JSON.stringify(h.view), /private provider response|forward\+fire/,
      );
      if (recoverable)
        assert.equal(h.view.session.evidence.decisions[0].waitUnchanged, true);
    } finally {
      await h.dispose();
    }
  }
});

it('fences late fake results after Stop or close and retains independent cleanup ownership', async () => {
  for (const command of ['stop', 'close']) {
    const result = deferred(),
      reader = deferred(),
      invoked = deferred();
    let signal: AbortSignal | undefined;
    const providerFactory = fakeProviderFactory((_input, lifecycle, _diagnostics, hooks) => {
      const controller = new AbortController();
      signal = controller.signal;
      lifecycle.apiController = controller;
      hooks.assertFresh();
      hooks.beforeCreate();
      const cleanup = reader.promise.then(
        () => {},
        () => {},
      ).then(() => {
        if (lifecycle.sdkRead === cleanup) lifecycle.sdkRead = undefined;
        hooks.onReadStateChange();
      });
      lifecycle.sdkRead = cleanup;
      hooks.onReadStateChange();
      invoked.resolve();
      // Intentionally ignore Abort: the controller must fence a valid late result.
      return (result.promise as Promise<DecisionResult>).finally(() => {
        if (lifecycle.apiController === controller)
          lifecycle.apiController = undefined;
      });
    });
    const h = fixture({ providerFactory });
    let work;
    try {
      await h.prepare();
      work = h.start();
      await invoked.promise;
      h.controller[command]();
      assert.ok(signal);
      assert.equal(signal.aborted, true);
      assert.equal(h.view.session.waitingForSdk, true);
      assert.equal(h.view.session.controls.ready, false);
      result.resolve({ kind: 'choice', action: 'forward' });
      if (command === 'stop') {
        await checkpoint(
          () => h.view.session.evidence.decisions[0].stage === 'cleanup',
        );
        assert.equal(h.view.session.continuous.active, true);
        assert.equal(await h.next(), 'not-admitted');
        await h.start();
        assert.equal(h.view.session.continuous.used, 1);
        const proof = h.hold('snapshot');
        reader.reject(Error('private late reader error'));
        await proof.waiting;
        assert.equal(h.view.session.waitingForSdk, false);
        assert.equal(h.view.session.controls.ready, false);
        proof.release();
      } else {
        await work;
        assert.equal(h.view.session.waitingForSdk, true);
        reader.resolve();
      }
      await work;
      await checkpoint(() => !h.view.session.waitingForSdk);
      assert.equal(h.gameCalls, 0);
      assert.equal(h.gameOps.includes('action'), false);
      assert.equal(h.view.session.controls.ready, command === 'stop');
      assert.equal(
        h.worker.terminate.mock.calls.length, command === 'close' ? 1 : 0,
      );
      assert.equal(h.sdkCalls, 0);
      assert.equal(h.transportCalls, 0);
      assert.doesNotMatch(JSON.stringify(h.view), /private late reader error/);
    } finally {
      result.resolve({ kind: 'choice', action: 'neutral' });
      reader.resolve();
      h.controller.close();
      await work;
      await h.dispose();
    }
  }
});

it('initializes, prepares, and completes one verified decision through ordinary imports', async () => {
  const h = fixture();
  const { controller, native, worker, ops } = h;
  try {
    const prepared = await h.prepare();
    assert.equal(
      h.view.status,
      'Ready at tic 1 — neutral 1/1/1; passive checks unchanged.',
    );
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
    assert.equal(entry.stage, 'completed');
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
    controller.close();
    controller.restore(true);
    assert.equal(h.view.session.evidence.decisions[0].stage, 'completed');
  } finally {
    controller.close();
  }
});

it('preserves the last verified preview when a passive snapshot changes health', async () => {
  const h = fixture({ faults: { corruptSnapshot: 1 } });
  try {
    await h.prepare();
    const preview = h.view.verifiedObservation;
    assert.equal(preview.health, 100);
    assert.equal(await h.next(), 'retired');
    assert.equal(h.view.verifiedObservation, preview);
    assert.equal(h.view.verifiedObservation.health, 100);
    assert.deepEqual(h.view.session.inspectorRequests, {});
    assert.equal(h.sdkCalls, 0);
    assert.equal(h.gameCalls, 0);
  } finally {
    await h.dispose();
  }
});

it('presents player telemetry from preparation snapshots through action and render evidence', async () => {
  const telemetry = {
    health: 87,
    armorpoints: 35,
    readyWeapon: { id: 4, name: 'rocket_launcher', ammoType: 'rockets' },
    ammo: {
      bullets: { current: 11, max: 111 },
      shells: { current: 22, max: 222 },
      cells: { current: 33, max: 333 },
      rockets: { current: 44, max: 444 },
    },
  };
  const h = fixture({ at: 1, signals: telemetry });
  try {
    h.browserInputs.tics = 1;
    const prepared = await h.prepare();
    const initial = prepared.evidence.operations.find(({ op }) => op === 'init');
    assert.equal(initial.result.native.armorpoints, null);
    assert.equal(initial.result.native.readyWeapon, null);
    assert.equal(initial.result.native.ammo, null);
    const before = h.native.observe();
    const previewBefore = h.view.verifiedObservation;
    assert.deepEqual(previewBefore, {
      tic: 1, readyWeapon: before.native.readyWeapon, ammo: before.native.ammo, health: 100, facingProbe: { tic: 1, kind: 0, door: 0, distance: -1 },
    });
    assert.notEqual(previewBefore.ammo, prepared.evidence.operations.at(-1).result.native.ammo);
    for (const { op, result } of prepared.evidence.operations) {
      if (op === 'snapshot' || op === 'render' || op === 'prepare') {
        assert.equal(result.native.health, 100);
        assert.equal(result.native.armorpoints, 0);
        assert.deepEqual(result.native.readyWeapon, {
          id: 1,
          name: 'pistol',
          ammoType: 'bullets',
        });
        assert.deepEqual(result.native.ammo, before.native.ammo);
      }
    }
    assert.equal(await h.next(), 'completed');
    const presented = h.view.session;
    const action = presented.evidence.operations.findLast(
      ({ op }) => op === 'action',
    ).result;
    const rendered = presented.evidence.operations.at(-1);
    assert.equal(rendered.op, 'render');
    assert.equal(rendered.result.counters.gametic, 2);
    assert.deepEqual(h.view.verifiedObservation, {
      tic: 2, readyWeapon: telemetry.readyWeapon, ammo: telemetry.ammo, health: 87, facingProbe: { tic: 2, kind: 0, door: 0, distance: -1 },
    });
    assert.notEqual(h.view.verifiedObservation.ammo, rendered.result.native.ammo);
    assert.equal(previewBefore.tic, 1);
    assert.equal(previewBefore.health, 100);
    assert.equal(previewBefore.ammo.rockets.current, 0, 'Prior preview stays detached');
    for (const native of [
      action.native,
      action.steps[0].native,
      rendered.result.native,
    ]) {
      for (const [field, expected] of Object.entries(telemetry))
        assert.deepEqual(native[field], expected);
    }
    assert.equal(presented.evidence.decisions[0].waitUnchanged, true);
    assert.equal(presented.frame.nativeSha256, presented.frame.canvasSha256);
    assert.equal(
      before.native.ammo.rockets.current,
      0,
      'Prior evidence stays detached',
    );

    // The final receipt must agree with its verified step, including inventory.
    const mismatched = structuredClone(action);
    mismatched.native = structuredClone(mismatched.native);
    mismatched.native.ammo.rockets.current--;
    const verified = verifyAction(before, 0, 1, mismatched);
    assert.equal(verified.independentlyVerifiedTics, 1);
    assert.equal(verified.complete, false);
    assert.equal(verified.completionUncertain, true);
  } finally {
    await h.dispose();
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
