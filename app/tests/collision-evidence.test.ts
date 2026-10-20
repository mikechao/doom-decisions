// Synthetic receipts/presentation only; no native physics, browser or API calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, it } from 'vitest';
import { formatCollisionEvidence } from '../src/collision-evidence.ts';
import { DecisionFailure, masks, verifyAction } from '../src/decision.ts';
import { cleanup, deferred, fixture, withSession } from './fixtures/session.ts';
import { death, execute, nativeFixture } from './fixtures/synthetic-doom.ts';

afterEach(cleanup);
const provider = (request = () => Promise.resolve({ kind: 'choice', action: 'forward' })) => ({
  probe: () => ({ status: 'Offline provider', evidence: {} }),
  create: () => ({ request(input, _lifecycle, _diagnostics, hooks) {
    hooks.assertFresh(); hooks.beforeCreate();
    return request(input);
  } }),
});
function sample(records = [[0, 0]], signals = {}) {
  let i = 0;
  const native = nativeFixture({ at: records.length, signals, onStep(next) {
    const [movementFlags, rejectionMask] = records[i++];
    Object.assign(next.native, { movementFlags, rejectionMask });
  } });
  const before = native.observe();
  const receipt = execute(native, records.length, masks.forward);
  const execution = verifyAction(before, masks.forward, records.length, receipt);
  return { receipt, execution, text: () => formatCollisionEvidence('forward', 1, receipt, execution) };
}

it('keeps the diagnostic inside Advanced evidence with documented noncausal semantics', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const disclosure = html.match(/<details class="advanced">([\s\S]*?)<\/details>/)[1];
  assert.match(disclosure, /Native collision telemetry \(Experiment 1\)/);
  assert.match(disclosure, /<pre id="collision-evidence" aria-labelledby="collision-evidence-label">No verified action yet\.<\/pre>/);
  assert.equal((html.match(/id="collision-evidence"/g) ?? []).length, 1);
  assert.match(disclosure, /counts overlap/);
  assert.match(disclosure, /zero does not establish a clear path/);
  assert.match(disclosure, /Native classifications await gameplay validation/);
});

it('distinguishes no trial from accepted trials with no observed rejection', () => {
  assert.match(sample().text(), /trial 0 · success 0 · rejection 0 · slide 0/);
  const text = sample([[3, 0], [3, 0]]).text();
  assert.equal(text, [
    'Last verified action: forward, 2 tics (1 → 3)',
    'Collision (per-tic counts; overlap): trial 2 · success 2 · rejection 0 · slide 0',
    'Rejection reasons (union): none observed',
    'Last sample: collisionSampleTic (87)=3 · movementFlags (88)=3 · rejectionMask (89)=0',
  ].join('\n'));
});

it('counts overlapping trial outcomes per tic and unions only documented reasons', () => {
  const { text } = sample([[15, 1], [13, 2], [3, 0], [7, 12]]);
  assert.match(text(), /forward, 4 tics \(1 → 5\)/);
  assert.match(text(), /trial 4 · success 3 · rejection 3 · slide 2/);
  assert.match(text(), /union\): solid line, solid thing, clearance, unknown/);
  assert.match(text(), /collisionSampleTic \(87\)=5 · movementFlags \(88\)=7 · rejectionMask \(89\)=12/);
});

it('renders unavailable for stale/unavailable samples, invalid masks or unverified completion', () => {
  for (const patch of [
    { collisionSampleTic: 1 }, { collisionSampleTic: -1 },
    { movementFlags: -1 }, { movementFlags: 16 }, { rejectionMask: 16 },
    { movementFlags: 1 }, { movementFlags: 5, rejectionMask: 0 },
  ]) {
    const h = sample();
    Object.assign(h.receipt.steps[0].native, patch);
    assert.equal(h.text(), 'Native collision telemetry unavailable.');
  }
  const h = sample();
  h.execution.completionUncertain = true;
  assert.equal(h.text(), 'Native collision telemetry unavailable.');
});

it('publishes only after resulting-frame verification, including post-dispatch Stop', async () => {
  const h = fixture({ providerFactory: provider(), onStep(next) {
    Object.assign(next.native, { movementFlags: 15, rejectionMask: 1 });
  } });
  let hold, work;
  try {
    await h.prepare();
    assert.equal(h.view.session.collisionEvidence, 'No verified action yet.');
    h.browserInputs.tics = 2;
    hold = h.hold('render'); work = h.controller.startContinuous(1);
    await hold.waiting;
    assert.match(h.view.session.collisionEvidence, /verification pending/);
    assert.doesNotMatch(h.view.session.collisionEvidence, /Last verified/);
    h.stop(); hold.release(); hold = undefined; await work;
    const text = h.view.session.collisionEvidence;
    assert.match(text, /forward, 2 tics \(1 → 3\)/);
    assert.match(text, /trial 2 · success 2 · rejection 2 · slide 2/);
    assert.equal(h.view.session.frame.tic, 3);
    assert.equal(h.gameCalls, 2);
    assert.equal(h.maxActive, 1);
  } finally { hold?.release(); await work; await h.dispose(); }
});

it('keeps the last verified frame summary after API failure or pre-dispatch Stop without changing requests', async () => {
  const inputs = [], waiting = deferred(), response = deferred();
  const h = fixture({ providerFactory: provider(input => {
    inputs.push(input);
    if (inputs.length === 2) throw new DecisionFailure('offline failure');
    if (inputs.length === 3) { waiting.resolve(); return response.promise; }
    return Promise.resolve({ kind: 'choice', action: 'forward' });
  }) });
  let work;
  try {
    await h.prepare(); h.browserInputs.tics = 1;
    await h.next(); const text = h.view.session.collisionEvidence;
    assert.equal(await h.next(), 'api-failure');
    assert.equal(h.view.session.collisionEvidence, text);
    work = h.controller.startContinuous(1); await waiting.promise;
    h.stop(); response.resolve({ kind: 'choice', action: 'backward' }); await work;
    assert.equal(h.view.session.collisionEvidence, text);
    for (const input of inputs) {
      assert.doesNotMatch(input.context, /collision|movementFlags|rejectionMask|trial/i);
      assert.doesNotMatch(input.instructions, /collisionSampleTic|movementFlags|rejectionMask/);
      assert.deepEqual(input.permittedActions, Object.keys(masks));
    }
    assert.equal(h.gameCalls, 1);
  } finally { response.resolve({ kind: 'choice', action: 'neutral' }); await work; await h.dispose(); }
});

for (const fault of ['badCanvas', 'badReceipt', 'stale', 'invalid', 'unsupported']) {
  it(`clears prior diagnostic evidence on ${fault} retirement`, async () => {
    await withSession({ providerFactory: provider(), mutateResult(data, result) {
      if (data.op === 'action' && result.native?.collisionSampleTic === 3) {
        if (fault === 'stale') result.steps[0].native.collisionSampleTic--;
        if (fault === 'invalid') result.steps[0].native.movementFlags = 16;
        if (fault === 'unsupported') result.steps[0].native.map = 2;
      }
    } }, async h => {
      h.browserInputs.tics = 1;
      assert.equal(await h.next(), 'completed');
      assert.match(h.view.session.collisionEvidence, /Last verified action/);
      if (fault === 'badCanvas' || fault === 'badReceipt') h.faults[fault] = true;
      assert.equal(await h.next(), 'retired');
      assert.match(h.view.session.collisionEvidence, /unavailable: session retired/);
      assert.doesNotMatch(h.view.session.collisionEvidence, /Last verified/);
    });
  });
}

it('retains only a rendered terminal prefix and resets for a fresh session', async () => {
  await withSession({ providerFactory: provider(), at: 2, signals: death }, async h => {
    h.browserInputs.tics = 6;
    assert.equal(await h.next(), 'terminal');
    assert.match(h.view.session.collisionEvidence, /Last verified terminal prefix: forward, 2 tics \(1 → 3\)/);
    assert.equal(h.view.session.frame.tic, 3);
    assert.equal(h.worker.terminate.mock.calls.length, 1);
    assert.equal(h.gameCalls, 2);
  });
  await withSession({ providerFactory: provider() }, async h => {
    assert.equal(h.view.session.collisionEvidence, 'No verified action yet.');
    h.controller.close(); h.controller.restore(true);
    assert.match(h.view.session.collisionEvidence, /session retired/);
  });
});

it('does not publish a terminal prefix when its resulting frame fails verification', async () => {
  await withSession({ providerFactory: provider(), at: 1, signals: death }, async h => {
    h.faults.badCanvas = true;
    assert.equal(await h.next(), 'retired');
    assert.match(h.view.session.collisionEvidence, /unavailable: session retired/);
    assert.doesNotMatch(h.view.session.collisionEvidence, /Last verified/);
  });
});
