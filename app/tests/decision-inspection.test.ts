// Controller contract with synthetic native/Canvas ports. No real Doom or network.
import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import { DecisionFailure } from '../src/decision.ts';
import type { DecisionProviderFactory, DecisionRequest } from '../src/decision-provider.ts';
import { checkpoint, cleanup, fixture } from './fixtures/session.ts';

afterEach(cleanup);

it('retains two exact immutable requests and call identities outside cloned evidence across manual/continuous play', async () => {
  let configuredModel = 'first-model';
  const inputs: DecisionRequest[] = [];
  const factory: DecisionProviderFactory = {
    probe: () => ({ status: 'offline', evidence: {} }),
    create: () => ({
      request(input, _lifecycle, diagnostics, hooks) {
        diagnostics.requestIdentity = { provider: 'OpenAI', requestedModel: configuredModel };
        hooks.assertFresh(); hooks.beforeCreate();
        inputs.push(input);
        diagnostics.responseMetadata = { reportedModel: `${configuredModel}-reported`, usage: { input: inputs.length, output: 0, total: null } };
        diagnostics.latencyMs = 0;
        return Promise.resolve({ kind: 'choice', action: 'neutral' });
      },
    }),
  };
  const h = fixture({ providerFactory: factory });
  try {
    await h.prepare();
    const clone = vi.spyOn(globalThis, 'structuredClone');
    const capture = h.ports.capture;
    let captures = 0;
    h.ports.capture = () => ({ ...capture(), png: `data:image/png;base64,historical-${++captures}` });
    h.browserInputs.tics = 2;
    assert.equal(await h.next(), 'completed');
    const first = h.view.session;
    const snapshot = first.inspectorRequests[1];
    assert.equal(snapshot, inputs[0], 'Same exact frozen input object, not a reconstruction or clone');
    assert.equal(Object.isFrozen(first.inspectorRequests), true);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.permittedActions), true);
    assert.throws(() => { (snapshot as { png: string }).png = 'changed'; });
    configuredModel = 'second-model';
    h.browserInputs.tics = 5;
    await h.controller.startContinuous(1);
    configuredModel = 'new-ui-selection';
    const second = h.view.session;
    assert.equal(second.inspectorRequests[1], snapshot);
    assert.equal(second.inspectorRequests[2], inputs[1]);
    assert.equal(first.inspectorRequests[2], undefined, 'Prior presentation containers stay immutable');
    assert.equal(snapshot.png, 'data:image/png;base64,historical-1');
    assert.equal(inputs[1].png, 'data:image/png;base64,historical-2');
    assert.match(snapshot.instructions, /exactly 2 gameplay tics/);
    assert.match(inputs[1].instructions, /exactly 5 gameplay tics/);
    assert.match(snapshot.context, /verified tic 1\./);
    assert.match(inputs[1].context, /verified tic 3\./);
    assert.deepEqual(snapshot.permittedActions, ['neutral', 'forward', 'turn_right', 'backward', 'turn_left', 'fire', 'use']);
    assert.deepEqual(second.evidence.decisions.map(entry => entry.requestIdentity), [
      { provider: 'OpenAI', requestedModel: 'first-model' }, { provider: 'OpenAI', requestedModel: 'second-model' },
    ]);
    assert.deepEqual(second.evidence.decisions.map(entry => entry.responseMetadata?.reportedModel), ['first-model-reported', 'second-model-reported']);
    assert.ok(second.evidence.decisions.every(entry => entry.sdkInvoked));
    assert.equal(second.verifiedTics, 8);
    assert.equal(h.creations, 1);
    assert.deepEqual(h.actions, [{ mask: 0, tics: 1 }, { mask: 0, tics: 2 }, { mask: 0, tics: 5 }]);
    assert.deepEqual(Object.keys(snapshot).sort(), ['context', 'instructions', 'permittedActions', 'png']);
    for (const [value] of clone.mock.calls)
      assert.doesNotMatch(JSON.stringify(value), /data:image\/png|historical-/);
    assert.doesNotMatch(JSON.stringify(second.evidence), /data:image\/png|historical-|offline-not-a-credential/);
    h.controller.close();
    h.controller.restore(true);
    assert.equal(h.view.session.inspectorRequests[1], snapshot, 'Retired games remain inspectable');
  } finally { await h.dispose(); }
});

for (const invoked of [false, true]) {
  it(`keeps a prepared request after provider failure with sdkInvoked=${invoked}`, async () => {
    const h = fixture({ providerFactory: {
      probe: () => ({ status: 'offline', evidence: {} }),
      create: () => ({ request(_input, _lifecycle, diagnostics, hooks) {
        diagnostics.requestIdentity = { provider: 'OpenAI', requestedModel: 'encoded-model' };
        if (invoked) hooks.beforeCreate();
        throw new DecisionFailure('API connection failure (network/CORS/access)');
      } }),
    } });
    try {
      await h.prepare(); await h.controller.startContinuous(1);
      const view = h.view.session;
      const entry = view.evidence.decisions[0];
      assert.ok(view.inspectorRequests[1]);
      assert.equal(entry.stage, 'ended');
      assert.equal(entry.sdkInvoked, invoked);
      assert.equal(entry.responseMetadata, undefined);
      assert.equal(entry.action, null);
      assert.equal(view.continuous.used, invoked ? 1 : 0);
      assert.equal(h.gameCalls, 0);
      assert.equal(view.controls.ready, true);
    } finally { await h.dispose(); }
  });
}

it('does not invent a request or identity when screenshot preparation fails', async () => {
  const h = fixture();
  try {
    await h.prepare(); h.faults.badPng = true;
    assert.equal(await h.next(), 'retired');
    assert.deepEqual(h.view.session.inspectorRequests, {});
    const entry = h.view.session.evidence.decisions[0];
    assert.equal(entry.sdkInvoked, false);
    assert.equal(entry.requestIdentity, undefined);
    assert.equal(entry.responseMetadata, undefined);
    assert.equal(entry.stage, 'ended');
    assert.equal(h.sdkCalls, 0);
  } finally { await h.dispose(); }
});

it('preserves pending/canceled input and fences late SDK metadata from a later decision', async () => {
  const h = fixture({ delayedBody: true });
  let work;
  try {
    await h.prepare(); work = h.controller.startContinuous(1);
    await h.waiting;
    const pending = h.view.session;
    const snapshot = pending.inspectorRequests[1];
    assert.ok(snapshot);
    assert.equal(pending.evidence.decisions[0].stage, 'requesting');
    assert.equal(pending.evidence.decisions[0].sdkInvoked, true);
    assert.equal(pending.evidence.decisions[0].responseMetadata, undefined);
    h.stop();
    await checkpoint(() => h.view.session.evidence.decisions[0].stage === 'cleanup');
    assert.equal(h.view.session.controls.ready, false);
    assert.equal(await h.next(), 'not-admitted');
    h.choice.model = 'late-model';
    h.choice.usage = { input_tokens: 7, output_tokens: 0, total_tokens: 7 };
    h.releaseBody(); await work;
    assert.equal(h.gameCalls, 0);
    assert.equal(h.view.session.inspectorRequests[1], snapshot);
    assert.equal(h.view.session.evidence.decisions[0].responseMetadata, undefined);
    assert.match(h.view.session.evidence.decisions[0].status, /Stopped by user/);
    assert.equal(await h.next(), 'completed');
    const [first, second] = h.view.session.evidence.decisions;
    assert.equal(first.responseMetadata, undefined);
    assert.equal(second.responseMetadata?.reportedModel, 'late-model');
    assert.deepEqual(second.responseMetadata?.usage, { input: 7, output: 0, total: 7 });
    assert.equal(pending.evidence.decisions[0].responseMetadata, undefined, 'Older presentation remains detached');
  } finally { h.releaseBody(); await work; await h.dispose(); }
});
