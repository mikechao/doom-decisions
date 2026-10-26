import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import { agentPngBytes, parseAgentObservation } from '../src/agent-observation.ts';
import { randomUUID } from 'node:crypto';
import { parseAgentObserveResult } from '../src/agent-control.ts';
import { cleanup, fixture } from './fixtures/session.ts';
import { agentObservation, pngFor } from './fixtures/agent.ts';
import { death, observation } from './fixtures/synthetic-doom.ts';
import { defaultDecisionConfiguration } from '../src/decision-request.ts';
import { facingObservationValid } from '../src/worker-shared.ts';

afterEach(cleanup);
function session(settings = {}) {
  const providerFactory = {
    probe: () => ({ status: 'Offline observation', evidence: { provider: 'offline' } }),
    create: vi.fn(() => assert.fail('Observation must never construct a provider')),
  };
  const h = fixture({ key: '', providerFactory, ...settings });
  const epoch = randomUUID();
  h.controller.attachAgent(epoch);
  const capture = h.ports.capture;
  h.ports.capture = () => {
    const { rgba } = capture();
    return { rgba, png: pngFor(rgba) };
  };
  return { h, epoch, providerFactory };
}
it('exports a fresh detached verified PNG/state with no key, provider or gameplay', async () => {
  const { h, providerFactory } = session();
  try {
    await assert.rejects(h.controller.observe(() => {}), /not ready/);
    await h.prepare();
    const before = h.native.observe();
    const result = await h.controller.observe(() => {});
    assert.equal(parseAgentObserveResult(result), result);
    assert.equal(result.run, null);
    assert.equal(result.revision, 0);
    assert.equal(result.configuration.tics, 6);
    assert.ok(agentPngBytes(result.png).length > 33);
    assert.equal(result.tic, 1);
    assert.equal(result.frame.nativeSha256, result.frame.canvasSha256);
    assert.deepEqual(h.native.observe().native, before.native);
    assert.equal(h.native.observe().counters.gametic, 1);
    assert.equal(result.counters.render, before.counters.render + 1);
    assert.equal(h.gameCalls, 0);
    assert.equal(h.sdkCalls, 0);
    assert.deepEqual(h.gameOps, ['snapshot', 'render', 'snapshot', 'snapshot']);
    assert.equal(providerFactory.create.mock.calls.length, 0);
    assert.deepEqual(Object.keys(result).sort(), ['configuration', 'counters', 'facingProbe', 'frame', 'observationId', 'phase', 'png', 'pngSha256', 'previousAction', 'revision', 'run', 'sessionId', 'telemetry', 'tic']);
    assert.deepEqual(result.telemetry.readyWeapon, before.native.readyWeapon);
    assert.deepEqual(result.telemetry.ammo, before.native.ammo);
    assert.equal(result.previousAction, null);
    assert.equal(result.facingProbe, null);
    const sessionId = result.sessionId;
    result.frame.tic = 99; result.telemetry.health = 0;
    result.telemetry.readyWeapon.name = 'unknown';
    result.telemetry.ammo.bullets.current = 999;
    result.telemetry.ammo.shells.max = 999;
    result.configuration.tics = 35;
    const again = await h.controller.observe(() => {});
    assert.deepEqual(again.telemetry.readyWeapon, before.native.readyWeapon);
    assert.deepEqual(again.telemetry.ammo, before.native.ammo);
    assert.deepEqual(h.native.observe().native, before.native);
    assert.equal(again.sessionId, sessionId);
    assert.equal(again.frame.tic, 1);
    assert.equal(again.configuration.tics, 6);
    assert.equal(again.counters.render, result.counters.render + 1);
    assert.equal(h.view.session.controls.ready, true);
  } finally { await h.dispose(); }
});

it.each(['stop', 'configuration', 'page'])('rejects a combined capture changed by %s while hashing', async change => {
  const { h, epoch } = session();
  try {
    await h.prepare();
    const first = await h.controller.observe(() => {});
    assert.equal(h.controller.allowAgentRun(epoch), true);
    const hold = h.holdDigest(3);
    const work = h.controller.observe(() => {});
    const rejected = assert.rejects(work, /agent state changed|verification failed/);
    await hold.waiting;
    if (change === 'stop') h.controller.stopAgent();
    if (change === 'configuration') h.controller.configure(() => { h.browserInputs.tics = 12; });
    if (change === 'page') h.controller.close();
    hold.release();
    await rejected;
    assert.equal(h.gameCalls, 0); assert.equal(h.sdkCalls, 0);
    if (change === 'configuration') {
      const next = await h.controller.observe(() => {});
      assert.equal(next.revision, first.revision + 1);
      assert.equal(next.run.active, false);
      assert.equal(next.run.remaining, 0);
      assert.ok(next.run.reserved < next.run.limit, 'Inactive is not exhausted');
    }
  } finally { await h.dispose(); }
});

it.each(['stop', 'configuration', 'invalidate'])('rejects %s at the busy-to-ready publication boundary', async change => {
  const { h } = session();
  try {
    await h.prepare();
    const present = h.ports.present;
    let busy = false, injected = false;
    h.ports.present = update => {
      present(update);
      if (update.session?.phase === 'busy') busy = true;
      if (!busy || injected || update.session?.phase !== 'ready') return;
      injected = true;
      if (change === 'stop') h.controller.stopAgent();
      else h.controller.configure(() => { if (change === 'configuration') h.browserInputs.tics = 12; });
    };
    await assert.rejects(h.controller.observe(() => {}), /agent state changed/);
    assert.equal(injected, true);
    assert.equal(h.gameCalls, 0); assert.equal(h.sdkCalls, 0);
  } finally { await h.dispose(); }
});

it('rechecks continuity after the authoritative synchronous config read', async () => {
  const { h } = session();
  try {
    await h.prepare();
    let busy = false, readyChecks = 0;
    await assert.rejects(h.controller.observe(() => {
      if (h.view.session.phase === 'busy') busy = true;
      // First ready check is finalization entry; second is agentConfig's gate.
      if (busy && h.view.session.phase === 'ready' && ++readyChecks === 2)
        h.controller.configure(() => { h.browserInputs.tics = 12; });
    }), /agent state changed/);
    assert.ok(readyChecks >= 3);
    assert.equal(h.gameCalls, 0); assert.equal(h.sdkCalls, 0);
  } finally { await h.dispose(); }
});

it('exports qualified facing and normalized inventory even when all inclusion flags are off', async () => {
  const { h } = session({ decisionConfiguration: { ...defaultDecisionConfiguration,
    includeReadyWeapon: false, includeAmmo: false, includeHealth: false,
    includeFacingProbe: false, includePreviousAction: false },
    onStep(next) { Object.assign(next.native, { facingKind: 4, facingDoor: 2, facingDistance: 24 }); },
  });
  try {
    await h.prepare();
    const result = parseAgentObserveResult(await h.controller.observe(() => {}));
    assert.equal(result.telemetry.health, 100);
    assert.deepEqual(result.telemetry.readyWeapon, { id: 1, name: 'pistol', ammoType: 'bullets' });
    assert.deepEqual(result.telemetry.ammo, agentObservation().telemetry.ammo);
    assert.deepEqual(result.facingProbe, { tic: 1, kind: 4, door: 2, distance: 24 });
    assert.equal(Object.isFrozen(result.facingProbe), false, 'Protocol clone is independent of frozen helper output');
    result.facingProbe.distance = 0;
    assert.equal((await h.controller.observe(() => {})).facingProbe.distance, 24);
    assert.equal(h.gameCalls, 0); assert.equal(h.sdkCalls, 0);
  } finally { await h.dispose(); }
});

it('preserves nullable inventory and distinguishes unavailable from a valid no-line sample', async () => {
  for (const kind of [0, 1]) {
    const { h } = session({ onStep(next) {
      Object.assign(next.native, { readyWeapon: null, ammo: null, facingKind: kind });
    } });
    try {
      await h.prepare();
      const result = parseAgentObserveResult(await h.controller.observe(() => {}));
      for (const key of ['readyWeapon', 'ammo', 'weaponId', 'bullets', 'shells', 'cells', 'rockets'])
        assert.equal(result.telemetry[key], null);
      assert.deepEqual(result.facingProbe, kind === 0 ? null : { tic: 1, kind: 1, door: 0, distance: -1 });
    } finally { await h.dispose(); }
  }
});

it('retires stale or contradictory native probes before exporting an observation', async () => {
  for (const patch of [{ collisionSampleTic: 0 }, { facingKind: 4, facingDoor: 0, facingDistance: 24 }]) {
    const { h } = session({ mutateResult(data, result, _frame, ready) {
      if (ready && data.op === 'snapshot') Object.assign(result.native, patch);
    } });
    try {
      await h.prepare();
      await assert.rejects(h.controller.observe(() => {}), /verification failed/);
      assert.equal(h.view.session.phase, 'error');
      assert.equal(h.gameCalls, 0); assert.equal(h.sdkCalls, 0);
    } finally { await h.dispose(); }
  }
});

it('strictly validates nested inventory, facing and previous-action protocol values', () => {
  const original = agentObservation();
  original.tic = original.frame.tic = original.counters.gametic = 7;
  original.facingProbe = { tic: 7, kind: 4, door: 2, distance: 24 };
  original.previousAction = { action: 'forward', tics: 6, endTic: 7, text: 'Existing verified outcome text.' };
  parseAgentObservation(original);
  for (const mutate of [
    d => { delete d.telemetry.ammo; },
    d => { d.telemetry.readyWeapon.extra = 1; },
    d => { d.telemetry.readyWeapon.name = 'laser'; },
    d => { d.telemetry.readyWeapon.ammoType = 'laser'; },
    d => { d.telemetry.readyWeapon.id = 2; },
    d => { d.telemetry.readyWeapon = null; },
    d => { d.telemetry.ammo = null; },
    d => { delete d.telemetry.ammo.rockets; },
    d => { d.telemetry.ammo.shells.extra = 1; },
    d => { d.telemetry.ammo.cells.max = 1.5; },
    d => { d.telemetry.ammo.bullets.current = 51; },
    d => { d.facingProbe.tic = 6; },
    d => { d.facingProbe.extra = 1; },
    d => { d.facingProbe.kind = 0; },
    d => { d.facingProbe.kind = 6; },
    d => { d.facingProbe.door = 3; },
    d => { d.facingProbe.distance = 65; },
    d => { d.facingProbe.distance = 1.5; },
    d => { d.previousAction.endTic = 6; },
    d => { d.previousAction.tics = 7; },
    d => { delete d.previousAction.text; },
    d => { d.previousAction.text = ''; },
    d => { d.previousAction.text = 1; },
    d => { d.previousAction.extra = 1; },
    d => { d.phase = 'terminal'; d.facingProbe = null; },
    d => { d.phase = 'terminal'; d.previousAction = null; },
  ]) {
    const data = structuredClone(original); mutate(data);
    assert.throws(() => parseAgentObservation(data), /Invalid agent observation/);
  }
  const terminal = structuredClone(original);
  terminal.phase = 'terminal'; terminal.telemetry.health = 0;
  terminal.previousAction = terminal.facingProbe = null;
  parseAgentObservation(terminal);
});

it('matches the native facing enum combinations, distance boundaries and no-line representation', () => {
  for (let kind = 0; kind <= 5; kind++) for (let door = 0; door <= 2; door++) {
    for (const distance of [-1, 0, 24, 64, 65]) {
      const native = observation(1);
      Object.assign(native.native, { facingKind: kind, facingDoor: door, facingDistance: distance });
      const data = agentObservation();
      data.facingProbe = { tic: 1, kind, door, distance };
      if (kind > 0 && facingObservationValid(native)) parseAgentObservation(data);
      else assert.throws(() => parseAgentObservation(data));
    }
  }
});
it('owns admission only while observing and safely drains a locally revoked snapshot', async () => {
  const { h } = session();
  try {
    await h.prepare();
    let live = true;
    const hold = h.hold('snapshot');
    const work = h.controller.observe(() => { if (!live) throw Error('revoked'); });
    const rejected = assert.rejects(work, /lease revoked/);
    await hold.waiting;
    assert.equal(h.view.session.phase, 'busy');
    assert.equal(await h.next(), 'not-admitted');
    await h.start();
    assert.equal(h.view.session.continuous, undefined);
    await assert.rejects(h.controller.observe(() => {}), /not ready/);
    live = false;
    hold.release();
    await rejected;
    assert.equal(h.view.session.phase, 'ready');
    assert.equal(h.view.session.controls.ready, true);
    assert.equal(h.worker.terminate.mock.calls.length, 0);
    assert.equal(h.gameCalls, 0);
    const ops = h.ops.length;
    await assert.rejects(h.controller.observe(() => { throw Error('old lease'); }), /lease revoked/);
    assert.equal(h.ops.length, ops);
  } finally { await h.dispose(); }
});
it('rejects a capture revoked during asynchronous hashing without publishing a result', async () => {
  const { h } = session();
  try {
    await h.prepare();
    let live = true;
    const hold = h.holdDigest(3); // Render pixels + Canvas, then observation capture.
    const work = h.controller.observe(() => { if (!live) throw Error('revoked'); });
    const rejected = assert.rejects(work, /lease revoked/);
    await hold.waiting;
    live = false;
    hold.release();
    await rejected;
    assert.equal(h.view.session.controls.ready, true);
    assert.equal(h.gameCalls, 0);
  } finally { await h.dispose(); }
});
it('retires mismatched Canvas/native or changed passive state and rejects retired observations', async () => {
  for (const fault of ['badCanvas', 'corruptSnapshot', 'badCapture']) {
    const { h } = session();
    try {
      await h.prepare();
      if (fault === 'badCapture') {
        const capture = h.ports.capture;
        h.ports.capture = () => { const data = capture(); data.rgba[0]++; return data; };
      } else h.faults[fault] = fault === 'corruptSnapshot' ? 1 : true;
      await assert.rejects(h.controller.observe(() => {}), /verification failed/);
      assert.equal(h.view.session.phase, 'error');
      await assert.rejects(h.controller.observe(() => {}), /not ready/);
      assert.equal(h.gameCalls, 0);
    } finally { await h.dispose(); }
  }
});
it('cannot label a delayed capture current after page retirement', async () => {
  const { h } = session();
  try {
    await h.prepare();
    const hold = h.holdDigest(3);
    const work = h.controller.observe(() => {});
    const rejected = assert.rejects(work, /verification failed/);
    await hold.waiting;
    h.controller.close();
    hold.release();
    await rejected;
    assert.equal(h.view.session.controls.ready, false);
  } finally { await h.dispose(); }
});
it('rejects a verified terminal preparation instead of exporting it as current/ready', async () => {
  const h = fixture({ key: '', at: 0, signals: death });
  try {
    await h.controller.initialize();
    await h.select();
    assert.equal(h.view.session.phase, 'terminal');
    await assert.rejects(h.controller.observe(() => {}), /not ready/);
    assert.equal(h.sdkCalls, 0);
  } finally { await h.dispose(); }
});
