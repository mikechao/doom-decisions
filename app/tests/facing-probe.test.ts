// Protocol/source tests only. No native geometry, WASM, game assets or API calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, it } from 'vitest';
import { buildDefaultDecisionRequest, defaultDecisionConfiguration } from '../src/decision-request.ts';
import { facingProbeAt, formatFacingProbe } from '../src/facing-probe.ts';
import { checkPrepared, passiveCheck } from '../src/native-observation-checks.ts';
import { facingObservationValid, i11VerifyStep } from '../src/worker-shared.ts';
import { verifyAction } from '../src/decision.ts';
import { cleanup, fixture } from './fixtures/session.ts';
import { death, execute, exit, nativeFixture, observation, preparationResult } from './fixtures/synthetic-doom.ts';

afterEach(cleanup);
const enabled = { ...defaultDecisionConfiguration, includeFacingProbe: true };
const sample = (kind = 2, door = 0, distance = 24, tic = 2) => {
  const result = observation(tic);
  Object.assign(result.native, { facingKind: kind, facingDoor: door, facingDistance: distance });
  return result;
};

it('keeps native sampling at successful closeout and getters cached, with no active query helper', () => {
  const source = readFileSync(new URL('../../engine/doom/doomgeneric/src/g_game.c', import.meta.url), 'utf8');
  const probe = source.slice(source.indexOf('static boolean A21ManualDoor('), source.indexOf('int G_A21Step('));
  assert.ok(probe.length > 0);
  // Restrict function calls, ignoring comments: no mutable Doom helper is allowed.
  const code = probe.replace(/\/\*[\s\S]*?\*\//g, '');
  const calls = [...code.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(match => match[1]);
  assert.deepEqual([...new Set(calls)].sort(), [
    'A21GameEligible', 'A21ManualDoor', 'A21SampleFacing', 'fabs', 'fmax', 'fmin', 'for', 'if', 'sqrt', 'switch',
  ].sort());
  assert.match(probe, /numlines > 65536/);
  assert.match(probe, /USERANGE >> FRACBITS/);
  assert.doesNotMatch(code, /->\w+\s*(?:=(?!=)|\+=|\+\+)/);
  assert.doesNotMatch(code, /a21_facing_\w+\s*=/);
  assert.doesNotMatch(code, /specialdata|validcount\s*[+]?=|P_Use|P_PathTraverse|P_CheckPosition|P_LineOpening|P_Random/);
  const manual = probe.slice(0, probe.indexOf('static a21_facing_t A21SampleFacing'));
  assert.deepEqual([...manual.matchAll(/case (\d+):/g)].map(match => +match[1]), [1, 26, 27, 28, 31, 32, 33, 34, 117, 118]);
  assert.match(source, /G_A21CheckPassive\(\);\s*#ifndef DOOM_A1_NO_FIXTURES\s*const a21_facing_t facing = A21SampleFacing\(\);\s*a21_collision_sample_tic = gametic;/);
  assert.equal((source.match(/A21SampleFacing\(\);/g) ?? []).length, 1);
  for (const [index, field] of [[90, 'kind'], [91, 'door'], [92, 'distance']])
    assert.match(source, new RegExp(`case ${index}:\\s*return a21_facing_${field};`));
  assert.doesNotMatch(source.slice(source.indexOf('int G_A21Observe(')), /A21SampleFacing\(/);
});

it('requires unavailable preparation, matching completed tic and honest terminal/unavailable state', () => {
  for (const op of ['init', 'prepare'] as const) {
    const result = preparationResult(op);
    checkPrepared(op, result);
    assert.equal(facingObservationValid(result), true);
    for (const field of ['facingKind', 'facingDoor', 'facingDistance']) {
      const corrupt = structuredClone(result);
      corrupt.native[field] = 0;
      assert.throws(() => checkPrepared(op, corrupt), /facing probe/);
    }
  }
  for (const signals of [death, exit, { ready: 0, gameEligible: 0, gamestate: 1 }]) {
    const result = sample(0, 0, -1);
    Object.assign(result.native, signals);
    assert.equal(facingObservationValid(result), true);
    result.native.facingKind = 1;
    assert.equal(facingObservationValid(result), false);
  }
  for (const patch of [{ collisionSampleTic: 1 }, { collisionSampleTic: -1 }, { actorEqual: 0 }]) {
    const result = sample();
    Object.assign(result.native, patch);
    assert.equal(facingObservationValid(result), false);
    assert.equal(facingProbeAt(result), undefined);
  }
});

it('validates every category/door combination and rejects bad distances and indices', () => {
  for (let kind = 0; kind <= 5; kind++) {
    for (let door = 0; door <= 2; door++) {
      const result = sample(kind, door, kind < 2 ? -1 : 24);
      const expected = kind < 2 ? door === 0 : kind === 2 ? door !== 2 : kind === 4 ? door !== 0 : kind === 5 ? door === 0 : true;
      assert.equal(facingObservationValid(result), expected, `${kind}/${door}`);
      if (expected) i11VerifyStep(0, observation(1), { ...result, status: 0 });
      else assert.throws(() => i11VerifyStep(0, observation(1), { ...result, status: 0 }), /facing probe/);
    }
  }
  for (const [field, values] of [
    ['facingKind', [-1, 6, 0x100000000, 1.5, NaN, undefined]],
    ['facingDoor', [-1, 3, 0x100000000, 1.5, NaN, undefined]],
    ['facingDistance', [-1, 65, 0x100000000, 1.5, NaN, undefined]],
  ] as const) {
    for (const value of values) {
      const result = sample();
      result.native[field] = value;
      assert.equal(facingObservationValid(result), false, `${field}/${value}`);
    }
  }
  for (const distance of [0, 64]) assert.equal(facingObservationValid(sample(2, 0, distance)), true);
});

it('preserves whole-object passive/refusal equality and rejects an altered outer receipt', () => {
  const before = sample();
  passiveCheck(before, structuredClone(before));
  i11VerifyStep(0, before, { ...structuredClone(before), status: -1 });
  for (const field of ['facingKind', 'facingDoor', 'facingDistance']) {
    const after = structuredClone(before);
    after.native[field]++;
    assert.throws(() => passiveCheck(before, after));
    assert.throws(() => i11VerifyStep(0, before, { ...after, status: -1 }));
  }
  const native = nativeFixture({ onStep(next) { Object.assign(next.native, { facingKind: 2, facingDoor: 0, facingDistance: 24 }); } });
  const start = native.observe();
  const receipt = execute(native, 1);
  assert.equal(verifyAction(start, 0, 1, receipt).complete, true);
  receipt.native = { ...receipt.native, facingDistance: 25 };
  assert.equal(verifyAction(start, 0, 1, receipt).completionUncertain, true);
  assert.equal(verifyAction(start, 0, 1, receipt).independentlyVerifiedTics, 1);
});

it('gates synthetic text in state, preserves instructions/actions and refuses stale frame association', () => {
  assert.equal(defaultDecisionConfiguration.includeFacingProbe, false);
  for (const [kind, door, distance, expected] of [
    [0, 0, -1, /unavailable/], [1, 0, -1, /no relevant line detected.*full player clearance unknown/],
    [2, 0, 24, /solid line about 24 units ahead/],
    [3, 0, 24, /opening\/clearance restriction/],
    [3, 2, 24, /clearance restriction.*Front-side manual-door use candidate/],
    [4, 1, 24, /manual-door boundary.*Usability unknown/],
    [4, 2, 24, /manual-door boundary.*use may be possible/],
    [5, 0, 24, /other special line; physical meaning unknown/],
  ] as const) {
    const probe = facingProbeAt(sample(kind, door, distance));
    const off = buildDefaultDecisionRequest(2, 6, 'png', undefined, defaultDecisionConfiguration, undefined, undefined, probe);
    const on = buildDefaultDecisionRequest(2, 6, 'png', undefined, enabled, undefined, undefined, probe);
    assert.equal(off.context, 'Current rendered Doom frame at verified tic 2.');
    assert.equal(on.instructions, off.instructions);
    assert.deepEqual(on.permittedActions, off.permittedActions);
    assert.match(on.context, expected);
    assert.doesNotMatch(on.context, /path is clear|wall is blocking|door will open|you should use/);
    assert.equal(formatFacingProbe(3, probe), 'Facing probe: unavailable at this verified frame.');
  }
});

it('uses the frozen admission and current verified render, preserving history across later samples', async () => {
  const inputs = [];
  const h = fixture({ onStep(next) {
    Object.assign(next.native, { facingKind: 2, facingDoor: 0, facingDistance: next.counters.gametic });
  }, providerFactory: { probe: () => ({ status: 'offline', evidence: {} }), create: () => ({ request(input, _lifecycle, _diagnostics, hooks) {
    hooks.assertFresh(); hooks.beforeCreate(); inputs.push(input);
    return Promise.resolve({ kind: 'choice', action: 'turn_left' });
  } }) } });
  let hold;
  try {
    await h.prepare();
    assert.deepEqual(h.view.verifiedObservation.facingProbe, { tic: 1, kind: 2, door: 0, distance: 1 });
    const config = { ...enabled };
    h.ports.readDecisionConfiguration = () => config;
    h.browserInputs.tics = 1;
    hold = h.hold('snapshot');
    const running = h.controller.startContinuous(1);
    await hold.waiting;
    config.includeFacingProbe = false;
    hold.release(); hold = undefined;
    await running;
    assert.match(inputs[0].context, /verified tic 1.*\nFacing probe.*1 units ahead/);
    assert.equal(h.view.session.inspectorRequests[1], inputs[0]);
    const frozen = inputs[0].context;
    assert.equal(Object.isFrozen(inputs[0]), true);
    assert.equal(await h.next(), 'completed');
    assert.doesNotMatch(inputs[1].context, /Facing probe/);
    config.includeFacingProbe = true;
    assert.equal(await h.next(), 'completed');
    assert.match(inputs[2].context, /verified tic 3.*\nFacing probe.*3 units ahead/);
    assert.equal(inputs[0].context, frozen);
    assert.equal(h.view.verifiedObservation.facingProbe.tic, 4);
  } finally { hold?.release(); await h.dispose(); }
});

it('rejects stale or unverified frame samples before any request', async () => {
  for (const bad of ['stale', 'frame']) {
    const h = fixture({ onStep(next) { Object.assign(next.native, { facingKind: 2, facingDoor: 0, facingDistance: 24 }); },
      mutateResult(data, result, _frame, ready) {
        if (ready && data.op === (bad === 'stale' ? 'snapshot' : 'render')) result.native.facingDistance = 25;
      } });
    try {
      await h.prepare(); h.ports.readDecisionConfiguration = () => enabled;
      if (bad === 'frame') assert.equal(await h.next(), 'retired');
      else { assert.equal(await h.next(), 'retired'); assert.equal(h.sdkCalls, 0); }
      assert.equal(h.view.verifiedObservation.facingProbe.tic, 1);
    } finally { await h.dispose(); }
  }
});

it('retains terminal-prefix identity with unavailable facing geometry and rejects stale final steps', () => {
  for (const signals of [death, exit]) {
    const native = nativeFixture({ at: 1, signals });
    const before = native.observe();
    const receipt = execute(native, 3);
    const verified = verifyAction(before, 0, 3, receipt);
    assert.equal(verified.terminal, true);
    assert.equal(verified.independentlyVerifiedTics, 1);
    assert.equal(receipt.native.collisionSampleTic, 2);
    assert.equal(receipt.native.facingKind, 0);
    assert.equal(formatFacingProbe(2, facingProbeAt(receipt)), 'Facing probe: unavailable at this verified frame.');
    receipt.steps[0].native.facingKind = 1;
    assert.equal(verifyAction(before, 0, 3, receipt).independentlyVerifiedTics, 0);
  }
});

it('never carries geometry from an earlier controller session into a fresh game', async () => {
  const contexts = [];
  const providerFactory = { probe: () => ({ status: 'offline', evidence: {} }), create: () => ({ request(input, _lifecycle, _diagnostics, hooks) {
    hooks.assertFresh(); hooks.beforeCreate(); contexts.push(input.context);
    return Promise.resolve({ kind: 'choice', action: 'neutral' });
  } }) };
  for (const first of [true, false]) {
    const h = fixture({ providerFactory, onStep(next) {
      if (first) Object.assign(next.native, { facingKind: 2, facingDoor: 0, facingDistance: 24 });
    } });
    try {
      await h.prepare(); h.ports.readDecisionConfiguration = () => enabled;
      h.browserInputs.tics = 1;
      assert.equal(await h.next(), 'completed');
      assert.equal(Object.keys(h.view.session.inspectorRequests).length, 1);
    } finally { await h.dispose(); }
  }
  assert.match(contexts[0], /solid line about 24 units ahead/);
  assert.equal(contexts[1], 'Current rendered Doom frame at verified tic 1.\nFacing probe: unavailable at this verified frame.');
});
