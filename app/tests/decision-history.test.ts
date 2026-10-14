// Pure presentation only: no DOM, SDK, Worker, native game or network.
import assert from 'node:assert/strict';
import { it } from 'vitest';
import { projectDecisionHistorySummary } from '../src/decision-history.ts';

const entry = {
  number: 1,
  selectedTics: 6,
  stage: 'capturing',
  status: 'Capturing current frame',
  action: null,
  observation: null,
  result: null,
  execution: null,
  cumulativeVerifiedTics: 1,
  requestId: null,
  latencyMs: null,
};
const copyVariants = [
  'Revised copy',
  'Complete',
  'Capturing current frame',
  'Requesting one action',
];
const project = (changes = {}) =>
  projectDecisionHistorySummary(Object.freeze({ ...entry, ...changes }));

it('uses stages for pending action and latency regardless of status copy', () => {
  for (const status of copyVariants) {
    for (const stage of [
      'capturing',
      'requesting',
      'stepping',
      'rendering',
      'cleanup',
      'ended',
    ]) {
      const pending = stage === 'capturing' || stage === 'requesting';
      assert.deepEqual(project({ stage, status }), {
        action: pending ? 'Action pending' : 'Action unavailable',
        latency: pending ? 'API latency pending' : 'API latency unavailable',
        status,
      });
    }
  }
});

it('shows a received choice during requesting and retains actual latency', () => {
  for (const status of copyVariants) {
    assert.deepEqual(
      project({ stage: 'requesting', action: 'use', latencyMs: 12, status }),
      {
        action: 'use',
        latency: 'API 12 ms',
        status: 'Choice received; checking unchanged game state',
      },
    );
    assert.equal(
      project({ stage: 'ended', action: 'use', status }).status,
      status,
    );
  }
});

it('requires completed stage and existing execution/result gates regardless of copy', () => {
  for (const status of copyVariants) {
    const evidence = { execution: { complete: true }, result: { tic: 7 } };
    assert.equal(
      project({ ...evidence, stage: 'completed', status }).status,
      'Completed · verified and rendered',
    );
    for (const change of [
      { execution: null },
      { execution: { complete: false } },
      { result: null },
    ]) {
      assert.equal(
        project({ ...evidence, stage: 'completed', status, ...change }).status,
        'Completion evidence unavailable',
      );
    }
    for (const stage of ['stepping', 'rendering', 'ended']) {
      assert.equal(project({ ...evidence, stage, status }).status, status);
    }
  }
});
