// Existing-position feedback only: synthetic receipts, no native physics or API.
import assert from 'node:assert/strict';
import { afterEach, it } from 'vitest';
import { masks, verifyAction, DecisionFailure } from '../src/decision.ts';
import { buildDefaultDecisionRequest, defaultDecisionConfiguration } from '../src/decision-request.ts';
import { createPreviousActionOutcome, previousActionAt } from '../src/previous-action.ts';
import { cleanup, deferred, fixture } from './fixtures/session.ts';
import { execute, nativeFixture } from './fixtures/synthetic-doom.ts';

const enabled = { ...defaultDecisionConfiguration, includePreviousAction: true };
afterEach(cleanup);

function sample(action = 'forward', positions = [[0, 0]]) {
  let index = 0;
  const native = nativeFixture({ onStep(next) {
    const [x, y] = positions[index++];
    Object.assign(next.native, { x, y });
  } });
  const before = native.observe();
  const receipt = execute(native, positions.length, masks[action]);
  const execution = verifyAction(before, masks[action], positions.length, receipt);
  assert.equal(execution.complete, true);
  const outcome = createPreviousActionOutcome(action, before, receipt, execution);
  return { before, receipt, execution, outcome };
}

it('distinguishes stationary samples, return to origin, and signed exact displacement', () => {
  const stationary = sample('forward', [[0, 0], [0, 0]]).outcome;
  assert.equal(stationary.text, 'Previous verified action: forward (2 tics).\nPlayer XY displacement: dx=0, dy=0 Doom units; unchanged at each recorded tic boundary.\nNo net displacement observed; cause unknown.');
  assert.equal(Object.isFrozen(stationary), true);
  const returned = sample('backward', [[-65536, 1], [0, 0]]).outcome;
  assert.match(returned.text, /dx=0, dy=0.*endpoints equal; intermediate recorded positions changed/);
  assert.doesNotMatch(returned.text, /unchanged at each/);
  const translated = sample('backward', [[-65536, 1]]).outcome;
  assert.match(translated.text, /dx=-1, dy=0.0000152587890625 Doom units; net translation observed/);
  assert.doesNotMatch(translated.text, /No net displacement/);
  assert.match(sample('forward', [[2147483647, -2147483648]]).outcome.text, /dx=32767.99998474121, dy=-32768/);
  const negativeStart = sample('backward', [[-1, 0]]);
  negativeStart.before.native.x = -65536;
  negativeStart.receipt.steps[0].native.x = -65537;
  negativeStart.receipt.native.x = -65537;
  assert.match(createPreviousActionOutcome('backward', negativeStart.before, negativeStart.receipt, negativeStart.execution).text, /dx=-0.0000152587890625, dy=0/);
  for (const outcome of [stationary, returned, translated])
    assert.doesNotMatch(outcome.text, /wall|collision|blocked|exit|failure/i);
});

it.each(['turn_left', 'turn_right'])('reports measured translation during %s without assigning a cause', action => {
  const { outcome } = sample(action, [[-256, 655360], [-548, 1362586]]);
  assert.equal(outcome.text, `Previous verified action: ${action} (2 tics).\nPlayer XY displacement: dx=-0.00836181640625, dy=20.791412353515625 Doom units; net translation observed.`);
  assert.doesNotMatch(outcome.text, /No net displacement|momentum|caused|blocked|collision/i);
});

it.each(['turn_left', 'turn_right'])('distinguishes stationary %s from movement returning to its starting position', action => {
  const stationary = sample(action, [[0, 0], [0, 0]]).outcome;
  assert.equal(stationary.text, `Previous verified action: ${action} (2 tics).\nPlayer XY displacement: dx=0, dy=0 Doom units; unchanged at each recorded tic boundary.\nNo net displacement observed; cause unknown.`);
  const returned = sample(action, [[-65536, 1], [0, 0]]).outcome;
  assert.match(returned.text, /dx=0, dy=0.*endpoints equal; intermediate recorded positions changed/);
  assert.doesNotMatch(returned.text, /unchanged at each/);
});

it('preserves action-only feedback for fire, use and neutral regardless of translation', () => {
  for (const action of ['fire', 'use', 'neutral']) {
    for (const positions of [[[0, 0], [0, 0]], [[65536, -65536], [131072, 0]]])
      assert.equal(sample(action, positions).outcome.text, `Previous verified action: ${action} (2 tics).`);
  }
});

it.each(['forward', 'turn_left', 'turn_right'])('rejects unavailable coordinates, actor identity, unsupported states and unhealthy executions for %s', action => {
  const invalid = [
    { x: undefined }, { y: null }, { x: NaN }, { y: Infinity }, { x: 0.5 },
    { x: -2147483649 }, { y: 2147483648 }, { actorEqual: 0 }, { liveActor: 0 },
    { ready: 0 }, { loadComplete: 0 }, { health: 0 }, { episode: 2 }, { map: 2 },
    { gameaction: 6 }, { playerstate: 1 },
  ];
  for (const mutation of invalid) {
    for (const boundary of ['before', 'middle', 'last']) {
      const { before, receipt, execution } = sample(action, [[0, 0], [0, 0]]);
      const native = boundary === 'before' ? before.native : receipt.steps[boundary === 'middle' ? 0 : 1].native;
      Object.assign(native, mutation);
      assert.equal(createPreviousActionOutcome(action, before, receipt, execution), undefined, `${boundary}: ${Object.keys(mutation)}`);
    }
  }
  for (const mutation of [{ complete: false }, { terminal: true }, { completionUncertain: true }, { independentlyVerifiedTics: 0 }]) {
    const { before, receipt, execution } = sample(action);
    assert.equal(createPreviousActionOutcome(action, before, receipt, { ...execution, ...mutation }), undefined);
  }
});

it('omits disabled, first-decision and stale feedback without changing instructions or domain fields', () => {
  const { outcome, receipt } = sample();
  assert.equal(defaultDecisionConfiguration.includePreviousAction, false);
  assert.equal(previousActionAt(outcome, receipt), outcome);
  assert.equal(previousActionAt(outcome, { ...receipt, counters: { ...receipt.counters, gametic: 99 } }), undefined);
  assert.equal(previousActionAt(outcome, { ...receipt, native: { ...receipt.native, x: 1 } }), undefined);
  assert.equal(previousActionAt(outcome, { ...receipt, native: { ...receipt.native, liveActor: 0 } }), undefined);
  const baseline = buildDefaultDecisionRequest(2, 6, 'png');
  assert.deepEqual(buildDefaultDecisionRequest(2, 6, 'png', undefined, defaultDecisionConfiguration, undefined, outcome), baseline);
  assert.deepEqual(buildDefaultDecisionRequest(2, 6, 'png', undefined, enabled), baseline);
  assert.deepEqual(buildDefaultDecisionRequest(3, 6, 'png', undefined, enabled, undefined, outcome), buildDefaultDecisionRequest(3, 6, 'png'));
  const custom = { ...enabled, instructionTemplate: '  Choose {{tics}}. {{ammo}}  ' };
  const request = buildDefaultDecisionRequest(2, 35, 'png', undefined, custom, undefined, outcome);
  assert.equal(request.instructions, '  Choose 35. {{ammo}}  ');
  assert.equal(request.context, `Current rendered Doom frame at verified tic 2.\n${outcome.text}`);
  assert.equal(Object.isFrozen(request), true);
});

function provider(choose) {
  return { probe: () => ({ status: 'offline', evidence: {} }), create: () => ({ request(input, lifecycle, diagnostics, hooks) {
    hooks.assertFresh(); hooks.beforeCreate();
    return choose(input, lifecycle, diagnostics);
  } }) };
}

it('omits an action with an invalid intermediate coordinate even when its endpoint and frame verify', async () => {
  const inputs = [];
  const h = fixture({ onStep(next, previous, mask) {
    if (mask === 1) next.native.x = next.counters.gametic === 2 ? NaN : -65536;
  }, providerFactory: provider(input => {
    inputs.push(input);
    return Promise.resolve({ kind: 'choice', action: 'forward' });
  }) });
  try {
    await h.prepare(); h.ports.readDecisionConfiguration = () => enabled;
    h.browserInputs.tics = 2;
    assert.equal(await h.next(), 'completed');
    assert.equal(h.view.session.evidence.decisions[0].execution.complete, true);
    assert.ok(h.view.session.evidence.decisions[0].result);
    assert.equal(await h.next(), 'completed');
    assert.doesNotMatch(inputs[1].context, /Previous verified action/);
  } finally { await h.dispose(); }
});

it('freezes each admission setting and preserves exact requests across manual/continuous actions', async () => {
  const inputs = [];
  const choices = ['forward', 'backward', 'neutral', 'forward'];
  const h = fixture({ onStep(next) {
    if (next.counters.gametic > 1)
      next.native.x = next.counters.gametic === 2 ? -65536 : next.counters.gametic === 3 ? 0 : 1;
  }, providerFactory: provider(input => {
    inputs.push(input);
    return Promise.resolve({ kind: 'choice', action: choices[inputs.length - 1] });
  }) });
  let barrier, work;
  try {
    await h.prepare();
    const configuration = { ...enabled };
    h.ports.readDecisionConfiguration = () => configuration;
    h.browserInputs.tics = 2;
    assert.equal(await h.next(), 'completed');
    assert.doesNotMatch(inputs[0].context, /Previous/);
    barrier = h.hold('snapshot');
    work = h.controller.startContinuous(1);
    await barrier.waiting;
    configuration.includePreviousAction = false; // Later admissions only.
    barrier.release(); barrier = undefined; await work;
    assert.match(inputs[1].context, /Previous verified action: forward \(2 tics\)/);
    assert.match(inputs[1].context, /endpoints equal; intermediate recorded positions changed/);
    const frozen = inputs[1].context;
    assert.equal(h.view.session.inspectorRequests[2], inputs[1]);
    assert.equal(await h.next(), 'completed');
    assert.doesNotMatch(inputs[2].context, /Previous/);
    configuration.includePreviousAction = true;
    h.browserInputs.tics = 1;
    assert.equal(await h.next(), 'completed');
    assert.match(inputs[3].context, /Previous verified action: neutral \(2 tics\)\.$/);
    assert.equal(inputs[1].context, frozen);
    assert.equal(h.view.session.inspectorRequests[2], inputs[1]);
  } finally { barrier?.release(); await work; await h.dispose(); }
});

it('retains the prior completed action after API failure or pre-dispatch Stop, but never a late choice', async () => {
  const inputs = [];
  const waiting = deferred(), response = deferred();
  const h = fixture({ providerFactory: provider(input => {
    inputs.push(input);
    if (inputs.length === 2) throw new DecisionFailure('offline failure');
    if (inputs.length === 3) { waiting.resolve(); return response.promise; }
    return Promise.resolve({ kind: 'choice', action: 'forward' });
  }) });
  let work;
  try {
    await h.prepare(); h.ports.readDecisionConfiguration = () => enabled;
    h.browserInputs.tics = 1;
    assert.equal(await h.next(), 'completed');
    assert.equal(await h.next(), 'api-failure');
    work = h.controller.startContinuous(1);
    await waiting.promise; h.stop();
    response.resolve({ kind: 'choice', action: 'backward' }); await work;
    assert.equal(await h.next(), 'completed');
    for (const request of inputs.slice(1))
      assert.match(request.context, /Previous verified action: forward \(1 tics\)/);
    assert.equal(h.gameCalls, 2);
  } finally { response.resolve({ kind: 'choice', action: 'neutral' }); await work; await h.dispose(); }
});

it('requires verified resulting frames and retains a completed action after post-dispatch Stop', async () => {
  const inputs = [];
  const h = fixture({ providerFactory: provider(input => { inputs.push(input); return Promise.resolve({ kind: 'choice', action: 'forward' }); }) });
  let barrier, work;
  try {
    await h.prepare(); h.ports.readDecisionConfiguration = () => enabled;
    h.browserInputs.tics = 1;
    barrier = h.hold('render'); work = h.controller.startContinuous(2);
    await barrier.waiting;
    assert.equal(h.view.session.evidence.decisions[0].stage, 'rendering');
    assert.equal(await h.next(), 'not-admitted');
    assert.equal(inputs.length, 1);
    h.stop(); barrier.release(); barrier = undefined; await work;
    assert.equal(await h.next(), 'completed');
    assert.match(inputs[1].context, /Previous verified action: forward \(1 tics\)/);
  } finally { barrier?.release(); await work; await h.dispose(); }
});

for (const fault of ['badCanvas', 'badReceipt', 'terminal', 'unsupported']) {
  it(`does not reuse outcomes after ${fault} and starts another session without history`, async () => {
    const inputs = [];
    const h = fixture({
      at: fault === 'terminal' || fault === 'unsupported' ? 2 : undefined,
      signals: fault === 'terminal' ? { playerstate: 1, health: 0, liveActor: 0, ready: 0, gameEligible: 0 } : { map: 2 },
      providerFactory: provider(input => { inputs.push(input); return Promise.resolve({ kind: 'choice', action: 'forward' }); }),
    });
    try {
      await h.prepare(); h.ports.readDecisionConfiguration = () => enabled;
      h.browserInputs.tics = 1;
      assert.equal(await h.next(), 'completed');
      if (fault === 'badCanvas' || fault === 'badReceipt') h.faults[fault] = true;
      assert.ok(['retired', 'terminal'].includes(await h.next()));
      assert.equal(await h.next(), 'not-admitted');
      assert.equal(inputs.length, 2);
    } finally { await h.dispose(); }
    const fresh = fixture({ providerFactory: provider(input => { assert.doesNotMatch(input.context, /Previous/); return Promise.resolve({ kind: 'choice', action: 'neutral' }); }) });
    try { await fresh.prepare(); fresh.ports.readDecisionConfiguration = () => enabled; assert.equal(await fresh.next(), 'completed'); }
    finally { await fresh.dispose(); }
  });
}
