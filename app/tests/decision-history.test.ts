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
        tokens: 'Total tokens unavailable',
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
        tokens: 'Total tokens unavailable',
        status: 'Choice received; checking unchanged game state',
      },
    );
    assert.equal(
      project({ stage: 'ended', action: 'use', status }).status,
      status,
    );
  }
});

it('shows only provider-reported totals, preserving zero and honest missing states', () => {
  const responseMetadata = (usage) => ({ reportedModel: null, usage });
  assert.equal(project({ responseMetadata: responseMetadata({ input: 0, output: 0, total: 0 }) }).tokens, '0 tokens');
  assert.equal(project({ responseMetadata: responseMetadata({ input: 900, output: 20, total: 1234 }) }).tokens, '1,234 tokens');
  assert.equal(project({ responseMetadata: responseMetadata({ input: 900, output: 20, total: null }) }).tokens, 'Total tokens unavailable');
  const requesting = { stage: 'requesting', sdkInvoked: true };
  assert.equal(project(requesting).tokens, 'Tokens pending');
  for (const change of [
    { sdkInvoked: false }, { stage: 'capturing' }, { stage: 'ended' },
    { stage: 'cleanup' }, { action: 'use' }, { latencyMs: 0 }, { http: 429 },
    { responseMetadata: responseMetadata({ input: null, output: null, total: null }) },
  ]) {
    assert.equal(project({ ...requesting, ...change }).tokens, 'Total tokens unavailable');
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
