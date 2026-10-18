// Pure presentation fixtures only: no DOM, Worker/WASM, SDK or network execution.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { projectLatestOutcome, projectSessionMetrics } from '../src/latest-outcome.ts';

const frame = (tic) => ({
  tic,
  nativeSha256: 'a'.repeat(64),
  canvasSha256: 'a'.repeat(64),
});
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function project(entry, visibleFrame) {
  // Any mutation of controller evidence fails in this strict ES module.
  return projectLatestOutcome(freeze(entry), freeze(visibleFrame));
}
const pending = {
  number: 27,
  selectedTics: 21,
  action: null,
  stage: 'capturing',
  status: 'Capturing current frame',
  observation: frame(1),
  result: null,
  execution: null,
  cumulativeVerifiedTics: 1,
};
const completed = {
  ...pending,
  action: 'turn_left',
  stage: 'completed',
  status: 'Complete',
  result: frame(22),
  cumulativeVerifiedTics: 22,
  execution: {
    mask: 8,
    requestedTics: 21,
    reportedCompletedTics: 21,
    independentlyVerifiedTics: 21,
    cumulativeVerifiedTics: 22,
    complete: true,
    completionUncertain: false,
    terminal: false,
    assessment: { kind: 'alive', tic: 22, dead: false, exitPending: false },
  },
};
const execution = (changes) => ({ ...completed.execution, ...changes });
const noVerifiedOutcome = (outcome) => {
  assert.doesNotMatch(outcome.evidence, /tics? completed|frame verified/i);
};

describe('session metrics', () => {
  const report = (input) => ({
    reportedModel: null,
    usage: { input, output: 8, total: 9999 },
  });
  const measured = (input, latencyMs) => ({
    ...completed,
    sdkInvoked: true,
    responseMetadata: report(input),
    latencyMs,
  });
  const metrics = (entries) => projectSessionMetrics(freeze(entries));
  const unknown = { inputTokens: '—', inputPartial: false, averageLatency: '—' };

  it('has no measurements before decisions, preparation, or API invocation', () => {
    assert.deepEqual(metrics([]), unknown);
    for (const stage of ['capturing', 'requesting', 'ended']) {
      assert.deepEqual(metrics([{ ...pending, stage, sdkInvoked: false, latencyMs: null }]), unknown);
    }
  });

  it('formats one report and recomputes totals and rounded means across all entries', () => {
    assert.deepEqual(metrics([measured(1000, 200)]), {
      inputTokens: '1,000', inputPartial: false, averageLatency: '200 ms',
    });
    assert.deepEqual(metrics([measured(1000, 200), measured(166, 566)]), {
      inputTokens: '1,166', inputPartial: false, averageLatency: '383 ms',
    });
    assert.equal(metrics([measured(1, 1000), measured(2, 1001)]).averageLatency, '1,001 ms');
    assert.equal(metrics([measured(1, 1.25), measured(2, 2)]).averageLatency, '2 ms');
  });

  it('recomputes repeated lifecycle updates to the same decision without double counting', () => {
    const first = measured(1000, 200);
    const second = { ...pending, number: 2, sdkInvoked: true, stage: 'requesting' };
    assert.deepEqual(metrics([first, second]), {
      inputTokens: '1,000', inputPartial: true, averageLatency: '200 ms',
    });
    const reported = { ...second, responseMetadata: report(166), latencyMs: 566 };
    for (const stage of ['requesting', 'stepping', 'rendering', 'completed']) {
      for (let update = 0; update < 2; update++) {
        assert.deepEqual(metrics([first, { ...reported, stage }]), {
          inputTokens: '1,166', inputPartial: false, averageLatency: '383 ms',
        });
      }
    }
    assert.deepEqual(metrics([]), unknown, 'A fresh session retains no projection state');
  });

  it('excludes missing latency and keeps measured failures and cancellations', () => {
    const failed = { ...measured(null, 100), stage: 'ended', status: 'HTTP failure (401)' };
    const canceled = { ...pending, sdkInvoked: true, stage: 'cleanup', status: 'Stopped by user', latencyMs: 300 };
    assert.deepEqual(metrics([
      measured(12, null), failed, canceled,
      { ...pending, sdkInvoked: true, latencyMs: undefined },
    ]), {
      inputTokens: '12', inputPartial: true, averageLatency: '200 ms',
    });
    assert.equal(metrics([{ ...canceled, stage: 'ended' }]).averageLatency, '300 ms');
    assert.equal(metrics([measured(null, null)]).averageLatency, '—');
  });

  it('never derives input counts from other usage or probabilities', () => {
    for (const responseMetadata of [undefined, report(null), report(undefined)]) {
      assert.deepEqual(metrics([{
        ...pending, sdkInvoked: true, responseMetadata,
        choice: { confidence: 1, probabilities: [{ value: 'neutral', probability: 1 }] },
      }]), unknown);
      assert.deepEqual(metrics([measured(5, 0), { sdkInvoked: true, responseMetadata }]), {
        inputTokens: '5', inputPartial: true, averageLatency: '0 ms',
      });
    }
  });

  it('marks partial reports only for invoked attempts, including pending ones', () => {
    for (const sdkInvoked of [false, undefined, true]) {
      for (const stage of ['capturing', 'requesting', 'cleanup', 'ended']) {
        assert.deepEqual(metrics([measured(5, 20), { ...pending, stage, sdkInvoked }]), {
          inputTokens: '5', inputPartial: sdkInvoked === true, averageLatency: '20 ms',
        });
      }
    }
  });

  it('retains real measured zero independently for each metric and at any stage', () => {
    assert.deepEqual(metrics([measured(0, null)]), {
      inputTokens: '0', inputPartial: false, averageLatency: '—',
    });
    assert.deepEqual(metrics([measured(null, 0)]), {
      inputTokens: '—', inputPartial: false, averageLatency: '0 ms',
    });
    for (const stage of ['requesting', 'cleanup', 'ended', 'completed']) {
      assert.deepEqual(metrics([{ ...measured(0, 0), stage }]), {
        inputTokens: '0', inputPartial: false, averageLatency: '0 ms',
      });
    }
    assert.deepEqual(metrics([measured(0, 0), measured(10, 100)]), {
      inputTokens: '10', inputPartial: false, averageLatency: '50 ms',
    });
  });

  it('excludes invalid input counts and non-finite or negative latency', () => {
    for (const input of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '12']) {
      assert.deepEqual(metrics([measured(input, null)]), unknown);
      assert.equal(metrics([measured(1, null), measured(input, null)]).inputPartial, true);
    }
    for (const latency of [-1, NaN, Infinity, -Infinity, '12']) {
      assert.equal(metrics([measured(null, latency)]).averageLatency, '—');
      assert.equal(metrics([measured(null, 12), measured(null, latency)]).averageLatency, '12 ms');
    }
  });
});

const terminal = {
  ...completed,
  stage: 'ended',
  status: 'Player dead at tic 3; frame retained.',
  result: frame(3),
  cumulativeVerifiedTics: 3,
  execution: execution({
    complete: false,
    terminal: true,
    reportedCompletedTics: 2,
    independentlyVerifiedTics: 2,
    cumulativeVerifiedTics: 3,
    assessment: { kind: 'terminal', tic: 3, dead: true, exitPending: false },
  }),
};

describe('latest-outcome', () => {
  it('projects loading pending and completed states without premature verification', async () => {
    // Loading, preparation and the neutral preparation tic all have no AI entry.
    for (const visible of [undefined, frame(0), frame(1)]) {
      assert.deepEqual(project(undefined, visible), {
        number: '',
        action: 'No AI decisions yet.',
        evidence: '',
      });
    }
    assert.deepEqual(project(pending, frame(1)), {
      number: '#27',
      action: 'Pending',
      evidence: 'Capturing current frame',
    });
    assert.equal(
      project({
        ...pending,
        stage: 'requesting',
        status: 'Requesting one action',
      }).action,
      'Pending',
    );
    assert.equal(
      project({
        ...pending,
        stage: 'requesting',
        status: 'Requesting one action',
        action: 'use',
      }).evidence,
      'Choice received; checking unchanged game state',
    );

    for (const [stage, status] of [
      ['stepping', 'Stepping and verifying'],
      ['rendering', 'Action verified; rendering'],
      [
        'cleanup',
        'Waiting for API response cleanup; no native action dispatched',
      ],
      ['cleanup', 'Checking unchanged native state'],
      ['ended', 'Stopped by user; no native action dispatched'],
      ['ended', 'authentication (401); no native action dispatched'],
      [
        'ended',
        'Game/observation verification failed; no native action dispatched. Reload to restart.',
      ],
    ]) {
      const outcome = project({ ...pending, stage, status });
      assert.equal(outcome.number, '#27');
      assert.equal(outcome.evidence, status);
      if (stage === 'ended') assert.equal(outcome.action, 'No action');
      noVerifiedOutcome(outcome);
    }
    // Even a fully verified action and a painted/matching frame cannot shortcut stage.
    for (const [stage, status] of [
      ['stepping', 'Stepping and verifying'],
      ['rendering', 'Action verified; rendering'],
    ]) {
      noVerifiedOutcome(
        project({ ...completed, stage, status }, completed.result),
      );
    }
    assert.deepEqual(project(completed, completed.result), {
      number: '#27',
      action: 'Turn left',
      evidence: '21 tics completed · Current frame verified',
    });
  });

  it('requires every independent completion accounting and frame gate', async () => {
    // Each independent completion/accounting/frame gate must hold.
    for (const change of [
      { action: null },
      { selectedTics: 20 },
      { selectedTics: 0 },
      { execution: null },
      { execution: execution({ complete: false }) },
      { execution: execution({ completionUncertain: true }) },
      { execution: execution({ terminal: true }) },
      { execution: execution({ requestedTics: 20 }) },
      { execution: execution({ reportedCompletedTics: null }) },
      { execution: execution({ reportedCompletedTics: 20 }) },
      { execution: execution({ independentlyVerifiedTics: 20 }) },
      { execution: execution({ cumulativeVerifiedTics: 23 }) },
      { execution: execution({ assessment: null }) },
      {
        execution: execution({ assessment: { kind: 'unsupported', tic: 22 } }),
      },
      { execution: execution({ assessment: { kind: 'alive', tic: 23 } }) },
      { observation: null },
      { observation: frame(2) },
      { cumulativeVerifiedTics: 23 },
      { result: null },
      { result: frame(23) },
      { result: { ...frame(22), nativeSha256: '' } },
      { result: { ...frame(22), canvasSha256: 'b'.repeat(64) } },
    ])
      noVerifiedOutcome(project({ ...completed, ...change }, completed.result));
  });

  it('labels historical results unless all visible frame fields match', async () => {
    // A once-verified result stays historical unless all three visible fields match.
    for (const visible of [
      undefined,
      frame(23),
      { ...frame(22), nativeSha256: 'b'.repeat(64) },
      { ...frame(22), canvasSha256: 'b'.repeat(64) },
    ]) {
      const outcome = project(completed, visible);
      assert.match(
        outcome.evidence,
        /21 tics completed · Resulting frame verified/,
      );
      assert.doesNotMatch(outcome.evidence, /Current frame verified/);
      assert.match(
        outcome.evidence,
        visible ? /Not the displayed frame/ : /Displayed frame unavailable/,
      );
    }
  });

  it('projects death exit and combined terminal prefixes without claiming completion', async () => {
    for (const signals of [
      { dead: true, exitPending: false },
      { dead: false, exitPending: true },
      { dead: true, exitPending: true },
    ]) {
      const entry = {
        ...terminal,
        execution: {
          ...terminal.execution,
          assessment: { kind: 'terminal', tic: 3, ...signals },
        },
      };
      const outcome = project(entry, entry.result);
      assert.match(
        outcome.evidence,
        /2 of 21 tics verified · Current frame verified/,
      );
      assert.equal(
        outcome.evidence.includes('Player death verified'),
        signals.dead,
      );
      assert.equal(
        outcome.evidence.includes('E1M1 exit pending'),
        signals.exitPending,
      );
      assert.doesNotMatch(outcome.evidence, /completed|E1M2|intermission/i);
      assert.match(
        project(entry, frame(1)).evidence,
        /Not the displayed frame/,
      );
    }
  });

  it('withholds frame verification during terminal rendering or frame failure', async () => {
    for (const [stage, status] of [
      ['rendering', 'Terminal tic verified; rendering'],
      [
        'ended',
        'Player dead at tic 3; terminal frame unavailable. Reload to restart.',
      ],
    ]) {
      const outcome = project(
        { ...terminal, stage, status, result: null },
        frame(1),
      );
      assert.match(outcome.evidence, /2 of 21 tics verified/);
      assert.match(
        outcome.evidence,
        stage === 'rendering'
          ? /Verifying resulting frame/
          : /Resulting frame unavailable/,
      );
      noVerifiedOutcome(outcome);
    }
  });

  it('preserves uncertain lower bounds and reload guidance', async () => {
    const uncertain = project(
      {
        ...terminal,
        result: null,
        status:
          'Native completion uncertain; verified prefix retained. Reload to restart.',
        execution: {
          ...terminal.execution,
          terminal: false,
          completionUncertain: true,
        },
      },
      frame(1),
    );
    assert.match(
      uncertain.evidence,
      /At least 2 tics verified \(lower bound; native completion uncertain\)/,
    );
    assert.match(uncertain.evidence, /Reload/);
    noVerifiedOutcome(uncertain);
  });

  it('uses stages and evidence even when status copy is rewritten or names another stage', () => {
    for (const status of [
      'Copy revised for clarity',
      'Complete',
      'Capturing current frame',
      'Requesting one action',
      'Stepping and verifying',
      'Terminal tic verified; rendering',
    ]) {
      for (const stage of ['capturing', 'requesting']) {
        const outcome = project({ ...pending, stage, status });
        assert.equal(outcome.action, 'Pending');
        assert.equal(outcome.evidence, status);
        noVerifiedOutcome(outcome);
      }
      assert.equal(
        project({ ...pending, stage: 'requesting', action: 'use', status })
          .evidence,
        'Choice received; checking unchanged game state',
      );
      assert.deepEqual(
        project({ ...completed, status }, completed.result),
        project(completed, completed.result),
      );
      assert.equal(
        project({ ...completed, result: null, status }).evidence,
        'Completion evidence unavailable',
      );
      for (const stage of ['stepping', 'rendering', 'cleanup', 'ended']) {
        assert.equal(
          project({ ...pending, stage, status }).action,
          'No action',
        );
        noVerifiedOutcome(
          project({ ...completed, stage, status }, completed.result),
        );
      }
      for (const stage of ['rendering', 'ended']) {
        const outcome = project({ ...terminal, stage, result: null, status });
        assert.match(outcome.evidence, /2 of 21 tics verified/);
        assert.match(
          outcome.evidence,
          stage === 'rendering'
            ? /Verifying resulting frame/
            : /Resulting frame unavailable/,
        );
        noVerifiedOutcome(outcome);
      }
      for (const stage of ['stepping', 'ended']) {
        const outcome = project({
          ...terminal,
          stage,
          status,
          result: null,
          execution: {
            ...terminal.execution,
            terminal: false,
            completionUncertain: true,
          },
        });
        assert.equal(
          outcome.evidence,
          status +
            (stage === 'stepping'
              ? ''
              : ' · At least 2 tics verified (lower bound; native completion uncertain)'),
        );
        noVerifiedOutcome(outcome);
      }
    }
  });
});
