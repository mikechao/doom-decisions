// Offline controller contracts only; no Worker execution, browser or API access.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  admitDecision,
  assertDecision,
  masks,
  validateChoice,
  verifyAction,
} from '../src/decision.ts';

const session = () => ({ valid: true, phase: 'ready', worker: {} });
const answer = (choice) => ({
  kind: 'choice',
  action: choice,
});

// Synthetic native command/counter chains exercise the preserved real verifier.
// These fixtures assert accounting, not that WASM executed the represented work.
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
function state(n) {
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
    status: 0,
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
      virtualMs: Math.floor((n * 1000) / 35),
      buildTick: n - 1,
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
      collisionSampleTic: n === 0 ? -1 : n,
      movementFlags: n === 0 ? -1 : 0,
      rejectionMask: n === 0 ? -1 : 0,
    },
  };
}
function receipt(base, requested, completed, outcome = 'APPLIED') {
  return {
    ...state(base + completed),
    mask: 0,
    requestedTics: requested,
    completedTics: completed,
    outcome,
    status: outcome === 'APPLIED' ? 0 : -1,
    steps: Array.from({ length: completed }, (_, i) => state(base + i + 1)),
  };
}

describe('decision', () => {
  it('freezes admitted N and fences duplicate or stale dispatch', async () => {
    let selectedN = 2;
    const run = session();
    const attempt = admitDecision(run, selectedN);
    assert.ok(attempt);
    assert.equal(admitDecision(run, selectedN), undefined); // double click
    selectedN = 5;
    await Promise.resolve(); // a pending request resumes after a control change
    assert.equal(attempt.tics, 2);
    assertDecision(run, attempt);
    for (const invalidate of [
      (state) => {
        state.valid = false;
      },
      (state) => {
        state.worker = {};
      },
      (state) => {
        state.attempt = undefined;
      },
    ]) {
      const state = session();
      const token = admitDecision(state, 6);
      invalidate(state);
      await Promise.resolve();
      assert.throws(() => assertDecision(state, token)); // stale dispatch fence
    }
  });

  it('admits only positive safe integer durations including uncapped boundaries', async () => {
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
      assert.equal(admitDecision(session(), n), undefined);
    }
    for (const n of [1, 6, 20, 21, 35, 1000, Number.MAX_SAFE_INTEGER]) {
      assert.equal(admitDecision(session(), n).tics, n);
    }
  });

  it('accepts all seven actions and rejects malformed or ambiguous answers', async () => {
    for (const choice of Object.keys(masks)) {
      assert.equal(validateChoice(answer(choice)).action, choice);
    }
    for (const data of [
      answer(true),
      answer('1'),
      answer('forward+fire'),
      answer('__proto__'),
      null,
      { kind: 'refusal' },
      { kind: 'other', action: 'neutral' },
      { answers: [{ type: 'choice', name: 'next_action', choice: 'neutral' }] },
    ]) {
      assert.throws(() => validateChoice(data));
    }
    assert.equal(validateChoice(answer('neutral')).confidence, null);
    assert.throws(() => validateChoice(answer('fire'), ['neutral']));
    const probabilities = Object.keys(masks).map((value) => ({
      value, probability: 0.1,
    }));
    assert.deepEqual(
      validateChoice({ ...answer('fire'), confidence: 0.7, probabilities }),
      { action: 'fire', confidence: 0.7, probabilities },
    );
    for (const confidence of [-1, 2, NaN, Infinity, 'private'])
      assert.equal(
        validateChoice({ ...answer('fire'), confidence }).confidence, null,
      );
    for (const invalid of [
      [],
      probabilities.slice(1),
      [...probabilities.slice(1), probabilities[1]],
      probabilities.map((p) => ({ ...p, probability: -1 })),
    ])
      assert.equal(
        validateChoice({ ...answer('fire'), probabilities: invalid }).probabilities,
        null,
      );
  });

  it('verifies complete chains and large refused durations', async () => {
    const first = verifyAction(state(1), 0, 2, receipt(1, 2, 2));
    assert.equal(first.complete, true);
    assert.equal(first.cumulativeVerifiedTics, 3);
    const second = verifyAction(state(3), 0, 5, receipt(3, 5, 5));
    assert.equal(second.complete, true);
    assert.equal(second.cumulativeVerifiedTics, 8);
    for (const n of [21, 35]) {
      const verified = verifyAction(state(1), 0, n, receipt(1, n, n));
      assert.equal(verified.complete, true);
      assert.equal(verified.independentlyVerifiedTics, n);
      assert.equal(verified.cumulativeVerifiedTics, 1 + n);
    }
    // Large durations validate using an empty refused receipt, without a large chain.
    for (const n of [1000, Number.MAX_SAFE_INTEGER]) {
      const verified = verifyAction(
        state(1),
        0,
        n,
        receipt(1, n, 0, 'REFUSED'),
      );
      assert.equal(verified.completionUncertain, false);
      assert.equal(verified.independentlyVerifiedTics, 0);
    }
  });

  it('marks invalid requested durations uncertain without verified work', async () => {
    for (const n of [
      0,
      -1,
      20.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      '',
      '20.5',
    ]) {
      const verified = verifyAction(state(1), 0, n, receipt(1, n, 1));
      assert.equal(verified.independentlyVerifiedTics, 0);
      assert.equal(verified.completionUncertain, true);
    }
  });

  it('retains verified prefixes through refusal faults missing and mismatched receipts', async () => {
    const partial = verifyAction(state(3), 0, 5, receipt(3, 5, 2, 'REFUSED'));
    assert.equal(partial.reportedCompletedTics, 2);
    assert.equal(partial.independentlyVerifiedTics, 2);
    assert.equal(partial.complete, false);
    assert.equal(partial.completionUncertain, false);
    const fault = receipt(3, 5, 2, 'FAULT');
    fault.status = null;
    fault.logs = [{ kind: 'error', text: 'synthetic outer fault' }];
    const failed = verifyAction(state(3), 0, 5, fault);
    assert.equal(failed.independentlyVerifiedTics, 2); // outer error loses no prefix
    assert.equal(failed.completionUncertain, true);
    const missing = verifyAction(state(3), 0, 5);
    assert.equal(missing.reportedCompletedTics, null);
    assert.equal(missing.independentlyVerifiedTics, 0);
    assert.equal(missing.completionUncertain, true); // zero proof is not zero execution
    const wrong = receipt(3, 5, 2);
    wrong.completedTics = 4;
    const mismatch = verifyAction(state(3), 0, 5, wrong);
    assert.equal(mismatch.reportedCompletedTics, 4);
    assert.equal(mismatch.independentlyVerifiedTics, 2);
    assert.equal(mismatch.completionUncertain, true);
  });

  it('rejects bad envelopes broken chains unsupported state and refused steps', async () => {
    const badEnvelope = receipt(3, 2, 2);
    badEnvelope.mask = 1;
    const preserved = verifyAction(state(3), 0, 2, badEnvelope);
    assert.equal(preserved.independentlyVerifiedTics, 2);
    assert.equal(preserved.complete, false);
    const brokenChain = receipt(3, 2, 2);
    brokenChain.steps[1].native.built.forwardmove = 25;
    const prefix = verifyAction(state(3), 0, 2, brokenChain);
    assert.equal(prefix.reportedCompletedTics, 2);
    assert.equal(prefix.independentlyVerifiedTics, 1);
    assert.equal(prefix.completionUncertain, true);
    const endedGame = receipt(3, 1, 1);
    endedGame.native.ready = 0;
    endedGame.steps[0].native.ready = 0;
    const ended = verifyAction(state(3), 0, 1, endedGame);
    assert.equal(ended.independentlyVerifiedTics, 1);
    assert.equal(ended.complete, false);
    assert.equal(ended.completionUncertain, false); // consumed tics, unusable game
    assert.equal(ended.terminal, false); // ready=0 does not prove death/exit
    assert.equal(ended.assessment.kind, 'unsupported');
    const refusedStep = receipt(3, 1, 1);
    refusedStep.steps[0] = { ...state(3), status: -1 };
    assert.equal(
      verifyAction(state(3), 0, 1, refusedStep).independentlyVerifiedTics,
      0,
    );
  });
});
