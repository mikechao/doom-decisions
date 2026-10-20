// Synthetic controller/SDK transport only; no Doom/WASM, real page or network.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, it } from 'vitest';
import { parseAgentDecisionResult } from '../src/agent-observation.ts';
import { defaultDecisionConfiguration } from '../src/decision-request.ts';
import { checkpoint, cleanup, deferred, fixture } from './fixtures/session.ts';
import { pngFor } from './fixtures/agent.ts';
import { death, exit } from './fixtures/synthetic-doom.ts';

afterEach(cleanup);
async function session(options, test) {
  const h = fixture({ pngFor, ...options });
  try {
    await h.prepare();
    const epoch = randomUUID();
    h.controller.attachAgent(epoch);
    const observation = await h.controller.observe(() => {});
    const decide = (id = observation.observationId, lease = epoch) => h.controller.agentNext(lease, id, () => {});
    const allow = () => h.controller.allowAgent(epoch);
    await test({ ...h, epoch, observation, decide, allow, h });
  } finally { await h.dispose(); }
}

it('requires a human grant while passive observations remain free', async () => {
  await session({}, async ({ h, decide, epoch }) => {
    assert.equal((await decide()).reason, 'no-grant');
    assert.equal(h.sdkCalls, 0);
    assert.equal(h.gameCalls, 0);
    const next = await h.controller.observe(() => {});
    assert.equal(next.tic, 1);
    assert.equal((await h.controller.agentNext(epoch, next.observationId, () => {})).reason, 'no-grant');
    assert.equal(h.creations, 1); // Existing Worker only, no provider call.
  });
});
it('uses one provider-selected action and frozen tics with a verified resulting PNG', async () => {
  await session({ choice: { answers: [{ type: 'choice', name: 'next_action', choice: 'turn_right' }] } }, async ({ h, decide, allow, observation }) => {
    assert.equal(allow(), true);
    assert.equal(allow(), false);
    const work = decide();
    assert.equal(h.view.session.agentBusy, true);
    h.browserInputs.tics = 20; // Admission already froze the human's 6.
    const result = parseAgentDecisionResult(await work);
    assert.equal(result.outcome, 'completed');
    assert.equal(result.sdkInvoked, true);
    assert.equal(result.action, 'turn_right');
    assert.equal(result.requestedTics, 6);
    assert.equal(result.reportedTics, 6);
    assert.equal(result.verifiedTics, 6);
    assert.equal(result.cumulativeTics, 7);
    assert.equal(result.beforeObservationId, observation.observationId);
    assert.equal(result.observation.tic, 7);
    assert.equal(result.observation.frame.nativeSha256, result.observation.frame.canvasSha256);
    assert.notEqual(result.observation.pngSha256, observation.pngSha256);
    assert.deepEqual(h.actions.slice(1), [{ mask: 2, tics: 6 }]);
    assert.equal(h.sdkCalls, 1);
    assert.equal((await decide()).reason, 'no-grant');
    assert.equal(h.sdkCalls, 1);
    assert.equal(h.view.session.controls.ready, true);
  });
});
it('rejects stale observations, epochs, changed configuration/model/tics without inference or dispatch', async () => {
  for (const change of ['observe', 'epoch', 'config', 'model', 'tics', 'manual']) {
    await session({}, async ({ h, decide, allow }) => {
      assert.equal(allow(), true);
      if (change === 'observe') await h.controller.observe(() => {});
      if (change === 'config') h.ports.readDecisionConfiguration = () => ({ ...defaultDecisionConfiguration, includeHealth: true });
      if (change === 'model') h.ports.readAgentIdentity = () => 'changed-model';
      if (change === 'tics') h.browserInputs.tics = 3;
      if (change === 'manual') await h.next();
      const sdk = h.sdkCalls, calls = h.gameCalls;
      const result = change === 'epoch' ? await decide(undefined, randomUUID()) : await decide();
      assert.equal(result.outcome, 'not-admitted');
      assert.equal(result.reason, change === 'epoch' ? 'lease-revoked' : ['observe', 'manual'].includes(change) ? 'no-grant' : 'stale-observation');
      assert.equal(h.sdkCalls, sdk);
      assert.equal(h.gameCalls, calls);
    });
  }
});
it('does not rearm reservations on missing credentials or pre-create failures', async () => {
  for (const options of [{ key: '' }, { throwOnCreate: true }, { choice: { answers: [] } }]) {
    await session(options, async ({ h, decide, allow }) => {
      assert.equal(allow(), true);
      const first = await decide();
      assert.equal(first.sdkInvoked, options.key !== '');
      const calls = h.sdkCalls;
      assert.equal((await decide()).reason, 'no-grant');
      assert.equal(h.sdkCalls, calls);
      assert.equal(h.gameCalls, 0);
    });
  }
});
it('Stop before create and immediately before dispatch uses unchanged-state recovery', async () => {
  for (const occurrence of [1, 2]) {
    await session({}, async ({ h, decide, allow }) => {
      allow();
      const held = h.hold('snapshot', occurrence);
      const work = decide();
      await held.waiting;
      h.controller.stopAgent();
      assert.equal(h.view.session.controls.ready, false);
      assert.equal(await h.next(), 'not-admitted');
      await h.start();
      held.release();
      const result = await work;
      assert.equal(result.outcome, 'stopped');
      assert.equal(h.sdkCalls, occurrence - 1);
      assert.equal(h.gameCalls, 0);
      assert.equal(h.view.session.evidence.decisions[0].waitUnchanged, true);
      assert.equal(h.view.session.controls.ready, true);
      assert.equal((await decide()).reason, 'lease-revoked');
      assert.equal(await h.next(), 'completed');
    });
  }
});
it('keeps ownership after helpers abort until the actual reader and unchanged-state proof settle', async () => {
  for (const reject of [false, true]) {
    await session({ delayedBody: true }, async ({ h, decide, allow }) => {
      allow();
      const work = decide();
      await h.waiting;
      h.controller.stopAgent();
      await h.parserWaiting;
      await checkpoint(() => h.view.session.evidence.decisions[0].stage === 'cleanup');
      assert.equal(h.readerPending, true);
      assert.equal(h.view.session.agentBusy, true);
      assert.equal(h.view.session.controls.ready, false);
      assert.equal(await h.next(), 'not-admitted');
      await h.start();
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.gameCalls, 0);
      assert.equal(h.controller.configure(() => assert.fail('No configuration edit while owned')), false);
      const proof = h.hold('snapshot');
      if (reject) h.rejectBody(); else h.releaseBody();
      await proof.waiting;
      assert.equal(h.view.session.controls.ready, false);
      proof.release();
      assert.equal((await work).outcome, 'stopped');
      assert.equal(h.gameCalls, 0);
      assert.equal(h.view.session.controls.ready, true);
      assert.equal(h.controller.configure(() => {}), true);
    });
  }
});
it('locks manual, continuous and second agent admissions through output verification after dispatch', async () => {
  for (const op of ['action', 'render', 'snapshot']) {
    await session({}, async ({ h, decide, allow }) => {
      allow();
      const held = h.hold(op, op === 'snapshot' ? 3 : 1); // Post-action PNG checkpoint.
      const work = decide();
      await held.waiting;
      assert.equal(await h.next(), 'not-admitted');
      await h.start();
      assert.equal((await decide()).outcome, 'not-admitted');
      assert.equal(allow(), false);
      h.controller.stopAgent();
      assert.equal(h.view.session.controls.ready, false);
      held.release();
      const result = parseAgentDecisionResult(await work);
      assert.equal(result.outcome, 'completed');
      assert.equal(result.observation.tic, 7);
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.gameCalls, 6);
      assert.equal(h.view.session.controls.ready, true);
      assert.equal(await h.next(), 'completed');
    });
  }
});
it('rejects agent admission while manual or continuous owns the controller', async () => {
  for (const mode of ['next', 'start']) {
    await session({ delayedBody: true }, async ({ h, decide, allow }) => {
      allow();
      const work = h[mode]();
      await h.waiting;
      assert.equal((await decide()).reason, 'no-grant');
      assert.equal(h.sdkCalls, 1);
      if (mode === 'start') h.stop();
      h.releaseBody();
      await work;
    });
  }
});
it('returns verified terminal prefixes/PNG and retires uncertain or unverifiable results', async () => {
  for (const options of [{ at: 2, signals: death }, { at: 2, signals: exit }, { trapAt: 2 }, { faults: { badFrame: true } }]) {
    // Frame failure is enabled after the initial verified observation.
    await session(options.faults ? {} : options, async ({ h, decide, allow }) => {
      if (options.faults) h.faults.badFrame = true;
      allow();
      const result = parseAgentDecisionResult(await decide());
      const retired = !!(options.trapAt || options.faults);
      assert.equal(result.outcome, retired ? 'retired' : 'terminal');
      assert.equal(result.verifiedTics, options.trapAt ? 1 : options.faults ? 6 : 2);
      assert.equal(result.observation?.tic ?? null, retired ? null : 3);
      assert.equal(result.observation?.previousAction ?? null, null, 'No terminal or unverified candidate is exposed');
      assert.equal(h.view.session.controls.ready, false);
      assert.equal(h.sdkCalls, 1);
      assert.equal(result.completionUncertain, !!options.trapAt);
    });
  }
});

it('retires failed Stop cleanup and page exit without releasing manual readiness', async () => {
  for (const close of [false, true]) {
    await session({ delayedBody: true }, async ({ h, decide, allow }) => {
      allow();
      const work = decide();
      await h.waiting;
      if (close) h.controller.close();
      else {
        h.controller.stopAgent();
        h.faults.corruptSnapshot = 5; // Three observe snapshots + request observation + cleanup.
      }
      h.releaseBody();
      assert.equal((await work).outcome, 'retired');
      assert.equal(h.gameCalls, 0);
      assert.equal(h.view.session.controls.ready, false);
    });
  }
});

it('checks Agent Stop at provider beforeCreate even after asynchronous provider preflight', async () => {
  const entered = deferred(), release = deferred();
  let creates = 0;
  const providerFactory = {
    probe: () => ({ status: 'Offline preflight', evidence: { provider: 'offline' } }),
    create: () => ({
      async request(_input, _lifecycle, _diagnostics, hooks) {
        entered.resolve();
        await release.promise;
        hooks.beforeCreate(); // The public provider billing boundary.
        ++creates;
        return { kind: 'choice', action: 'fire' };
      },
    }),
  };
  await session({ providerFactory }, async ({ h, decide, allow }) => {
    allow();
    const work = decide();
    await entered.promise;
    h.controller.stopAgent();
    release.resolve();
    const result = await work;
    assert.equal(result.outcome, 'stopped');
    assert.equal(result.sdkInvoked, false);
    assert.equal(creates, 0);
    assert.equal(h.gameCalls, 0);
    assert.equal(h.view.session.evidence.decisions[0].waitUnchanged, true);
    assert.equal(h.view.session.controls.ready, true);
  });
});

it('requires a current verified observation before granting an attempt', async () => {
  const h = fixture({ pngFor });
  try {
    await h.prepare();
    const epoch = randomUUID();
    h.controller.attachAgent(epoch);
    assert.equal(h.controller.allowAgent(epoch), false);
    const observation = await h.controller.observe(() => {});
    assert.equal(h.controller.allowAgent(epoch), true);
    h.controller.configure(() => { h.browserInputs.tics = 3; });
    assert.equal(h.controller.allowAgent(epoch), false, 'Changing configuration requires observing again');
    assert.equal((await h.controller.agentNext(epoch, observation.observationId, () => {})).sdkInvoked, false);
    assert.equal(h.sdkCalls, 0);
    assert.equal(h.gameCalls, 0);
  } finally { await h.dispose(); }
});

it.each(['tics', 'instructions', 'options', 'model'])('irrevocably revokes the grant on a %s edit, restoration and replacement observation', async change => {
  await session({}, async ({ h, epoch }) => {
    let configuration = defaultDecisionConfiguration;
    let model = 'model-a';
    h.ports.readDecisionConfiguration = () => configuration;
    h.ports.readAgentIdentity = () => model;
    const original = await h.controller.observe(() => {});
    assert.equal(h.controller.allowAgent(epoch), true);
    let revoked = 0;
    h.ports.agentGrantRevoked = () => { revoked++; };
    const edit = restore => h.controller.configure(() => {
      if (change === 'tics') h.browserInputs.tics = restore ? 6 : 12;
      if (change === 'instructions') configuration = restore ? defaultDecisionConfiguration : { ...configuration, instructionTemplate: 'Use the verified scene.' };
      if (change === 'options') configuration = restore ? defaultDecisionConfiguration : { ...configuration, includeHealth: true, includeAmmo: true };
      if (change === 'model') model = restore ? 'model-a' : 'model-b';
    });
    assert.equal(edit(false), true);
    assert.equal(revoked, 1, 'The browser is notified synchronously');
    const changed = await h.controller.observe(() => {});
    const denied = await h.controller.agentNext(epoch, changed.observationId, () => {});
    assert.equal(denied.reason, 'no-grant');
    assert.equal(denied.sdkInvoked, false);
    edit(true);
    const restored = await h.controller.observe(() => {});
    const again = await h.controller.agentNext(epoch, restored.observationId, () => {});
    assert.equal(again.reason, 'no-grant');
    assert.equal(again.sdkInvoked, false);
    assert.equal((await h.controller.agentNext(epoch, original.observationId, () => {})).sdkInvoked, false);
    assert.equal(h.sdkCalls, 0, 'No invalidated grant reaches SDK create');
    assert.equal(h.gameCalls, 0);
    assert.equal(h.view.session.evidence.decisions.length, 0, 'Rejected before inference admission');
    assert.equal(h.controller.allowAgent(epoch), true, 'Only another deliberate grant enables inference');
    assert.equal((await h.controller.agentNext(epoch, restored.observationId, () => {})).outcome, 'completed');
    assert.equal(h.sdkCalls, 1);
  });
});

it('revokes authorization when the observation is replaced at the same tic/configuration', async () => {
  await session({}, async ({ h, epoch, observation, allow }) => {
    assert.equal(allow(), true);
    let revoked = 0;
    h.ports.agentGrantRevoked = () => { revoked++; };
    const hold = h.hold('snapshot');
    const work = h.controller.observe(() => {});
    assert.equal(revoked, 1, 'Revocation precedes asynchronous capture');
    await hold.waiting;
    hold.release();
    const replacement = await work;
    assert.notEqual(replacement.observationId, observation.observationId);
    assert.equal(replacement.tic, observation.tic);
    const denied = await h.controller.agentNext(epoch, replacement.observationId, () => {});
    assert.equal(denied.reason, 'no-grant');
    assert.equal(denied.sdkInvoked, false);
    const third = await h.controller.observe(() => {});
    assert.equal((await h.controller.agentNext(epoch, third.observationId, () => {})).sdkInvoked, false);
    assert.equal(h.sdkCalls, 0);
    assert.equal(h.gameCalls, 0);
    assert.equal(h.view.session.evidence.decisions.length, 0);
    assert.equal(allow(), true);
    assert.equal((await h.controller.agentNext(epoch, third.observationId, () => {})).outcome, 'completed');
    assert.equal(h.sdkCalls, 1);
  });
});

it('returns the just-verified forward action immediately, consistent with the next passive observation', async () => {
  await session({ choice: { answers: [{ type: 'choice', name: 'next_action', choice: 'forward' }] } }, async ({ h, observation, allow, decide }) => {
    allow();
    const result = parseAgentDecisionResult(await decide());
    assert.equal(result.outcome, 'completed');
    const expected = { action: 'forward', tics: 6, endTic: 7 };
    assert.deepEqual(result.observation.previousAction, expected);
    assert.equal(result.observation.tic, 7);
    assert.equal(result.observation.sessionId, observation.sessionId);
    const passive = await h.controller.observe(() => {});
    assert.deepEqual(passive.previousAction, expected);
    assert.equal(passive.sessionId, result.observation.sessionId);
    assert.equal(passive.tic, result.observation.tic);
    assert.equal(passive.frame.nativeSha256, result.observation.frame.nativeSha256);
    assert.notEqual(passive.observationId, result.observation.observationId, 'Each capture retains its distinct identity');
    assert.equal(h.sdkCalls, 1);
    assert.equal(h.gameCalls, 6);
  });
});

function bounded(h, epoch, observation) {
  assert.equal(h.controller.allowAgentRun(epoch), true);
  const read = () => {
    const value = h.controller.agentPrompt(epoch, observation.sessionId, () => {});
    assert.equal('error' in value, false);
    return value;
  };
  const scope = () => { const p = read(); return { sessionId: p.sessionId, runId: p.run.runId, revision: p.revision }; };
  return { read, scope, decide: id => h.controller.agentNext(epoch, id, () => {}, scope()),
    write: instructions => h.controller.agentPrompt(epoch, observation.sessionId, () => {}, { ...scope(), instructions }) };
}

it('reserves three independent verified actions in one session without allowing replenishment or a fourth create', async () => {
  await session({ choice: { answers: [{ type: 'choice', name: 'next_action', choice: 'forward' }] } }, async ({ h, epoch, observation }) => {
    const b = bounded(h, epoch, observation);
    let current = observation;
    for (let i = 1; i <= 3; i++) {
      const result = parseAgentDecisionResult(await b.decide(current.observationId));
      assert.equal(result.outcome, 'completed');
      assert.equal(result.observation.sessionId, observation.sessionId);
      assert.deepEqual(result.observation.previousAction, { action: 'forward', tics: 6, endTic: 1 + 6 * i });
      assert.deepEqual(b.read().run, { runId: b.scope().runId, active: i < 3, limit: 3, reserved: i, sdkInvoked: i, remaining: 3 - i });
      current = await h.controller.observe(() => {});
      assert.deepEqual(current.previousAction, result.observation.previousAction);
      assert.equal(current.frame.nativeSha256, result.observation.frame.nativeSha256);
    }
    assert.equal((await b.decide(current.observationId)).reason, 'no-grant');
    assert.equal(h.controller.allowAgentRun(epoch), false);
    assert.equal(h.controller.allowAgent(epoch), false);
    assert.equal(h.sdkCalls, 3);
    assert.equal(h.creations, 1);
    assert.equal(h.gameCalls, 18);
    assert.equal(h.view.session.controls.ready, true);
  });
});

it('CAS instructions preserve the run but consume the former observation and use the exact saved replacement', async () => {
  await session({ decisionConfiguration: { ...defaultDecisionConfiguration, includeHealth: true, includeAmmo: true, includePreviousAction: true, includeFacingProbe: true } }, async ({ h, epoch, observation }) => {
    const b = bounded(h, epoch, observation);
    const before = b.read();
    const settings = h.ports.readDecisionConfiguration();
    const instructions = 'Goal: reach the visible opening.\nHypothesis: the earlier route stalled; confidence low. Keep action selection yours.';
    const saved = b.write(instructions);
    assert.equal(saved.revision, before.revision + 1);
    assert.deepEqual(saved.run, before.run);
    assert.deepEqual(h.ports.readDecisionConfiguration(), { ...settings, instructionTemplate: instructions });
    assert.equal(h.browserInputs.tics, 6);
    assert.equal((await b.decide(observation.observationId)).reason, 'stale-observation');
    assert.equal(h.sdkCalls, 0);
    const fresh = await h.controller.observe(() => {});
    assert.equal((await b.decide(fresh.observationId)).outcome, 'completed');
    assert.equal(h.inputs[0].questions[0].instructions, instructions);
    assert.equal(b.read().run.reserved, 1);
    const firstRevision = saved.revision;
    b.write(before.instructions);
    assert.ok(b.read().revision > firstRevision, 'Reverting text never restores a prior revision');
    assert.equal((await b.decide(fresh.observationId)).reason, 'stale-observation');
    assert.equal(h.sdkCalls, 1);
  });
});

it('prompt conflicts, human edits, manual gameplay and wrong scope end or fence bounded authorization', async () => {
  for (const edit of ['revision', 'editor', 'session', 'run', 'human-save', 'tics', 'options', 'model', 'manual']) {
    await session({}, async ({ h, epoch, observation }) => {
      const b = bounded(h, epoch, observation);
      const before = b.read();
      if (['revision', 'editor', 'session', 'run'].includes(edit)) {
        const scope = b.scope();
        if (edit === 'revision') scope.revision++;
        if (edit === 'session') scope.sessionId = randomUUID();
        if (edit === 'run') scope.runId = randomUUID();
        if (edit === 'editor') h.browserInputs.promptEditorOpen = true;
        const result = h.controller.agentPrompt(epoch, scope.sessionId, () => {}, { ...scope, instructions: 'Replacement objective' });
        assert.ok('error' in result);
        assert.equal(h.ports.readDecisionConfiguration().instructionTemplate, before.instructions);
      } else if (edit === 'manual') assert.equal(await h.next(), 'completed');
      else h.controller.configure(() => {
        if (edit === 'human-save') h.ports.saveDecisionInstructions('Human objective');
        if (edit === 'tics') h.browserInputs.tics = 12;
        if (edit === 'options') h.ports.readDecisionConfiguration = () => ({ ...defaultDecisionConfiguration, includeHealth: true });
        if (edit === 'model') h.ports.readAgentIdentity = () => 'other-model';
      });
      assert.equal(b.read().run.active, false, edit);
      assert.equal(b.read().run.remaining, 0);
      assert.equal(h.controller.allowAgentRun(epoch), false);
      assert.equal((await b.decide(observation.observationId)).sdkInvoked, false);
      assert.equal(h.sdkCalls, edit === 'manual' ? 1 : 0);
    });
  }
});

it('failed reservations never refund, restart or allow another bounded SDK attempt', async () => {
  for (const options of [{ key: '' }, { throwOnCreate: true }, { choice: { answers: [] } }, { trapAt: 2 }, { at: 2, signals: death }]) {
    await session(options, async ({ h, epoch, observation }) => {
      const b = bounded(h, epoch, observation);
      const scope = b.scope();
      const first = await b.decide(observation.observationId);
      assert.notEqual(first.outcome, 'completed');
      assert.equal(h.view.session.agentAuthorization.reserved, 1);
      assert.equal(h.view.session.agentAuthorization.sdkInvoked, options.key === '' ? 0 : 1);
      assert.equal(h.view.session.agentAuthorization.active, false);
      assert.equal(h.view.session.agentAuthorization.remaining, 0);
      assert.equal((await h.controller.agentNext(epoch, observation.observationId, () => {}, scope)).sdkInvoked, false);
      assert.equal(h.controller.allowAgentRun(epoch), false);
    });
  }
});

it('bounded Stop preserves reader ownership and dispatched verification without authorizing another cycle', async () => {
  for (const phase of ['capture', 'reader', 'render']) {
    const dispatched = phase === 'render';
    await session(phase === 'reader' ? { delayedBody: true } : {}, async ({ h, epoch, observation }) => {
      const b = bounded(h, epoch, observation);
      const scope = b.scope();
      const hold = phase === 'reader' ? undefined : h.hold(dispatched ? 'render' : 'snapshot');
      const work = b.decide(observation.observationId);
      if (hold) await hold.waiting; else await h.waiting;
      h.controller.stopAgent();
      assert.equal(h.view.session.controls.ready, false);
      assert.equal(await h.next(), 'not-admitted');
      if (hold) hold.release(); else h.releaseBody();
      assert.equal((await work).outcome, dispatched ? 'completed' : 'stopped');
      assert.equal(h.sdkCalls, phase === 'capture' ? 0 : 1);
      assert.equal(h.gameCalls, dispatched ? 6 : 0);
      assert.equal(h.view.session.controls.ready, true);
      assert.equal(h.controller.agentPrompt(epoch, observation.sessionId, () => {}).error, 'lease-revoked');
      assert.equal((await h.controller.agentNext(epoch, observation.observationId, () => {}, scope)).reason, 'lease-revoked');
    });
  }
});
