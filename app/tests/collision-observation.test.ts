// Observation contracts only: no C execution, Doom physics, WASM or game assets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'vitest';
import { verifyAction } from '../src/decision.ts';
import { checkPrepared, passiveCheck } from '../src/native-observation-checks.ts';
import {
  collisionObservationValid,
  i11VerifyStep,
  movementFlags,
  rejectionReasons,
} from '../src/worker-shared.ts';
import { cleanup, withSession } from './fixtures/session.ts';
import {
  death,
  execute,
  exit,
  nativeFixture,
  observation,
  preparationResult,
} from './fixtures/synthetic-doom.ts';

afterEach(cleanup);
describe('per-tic collision observation contract', () => {
  it('keeps the C and TS bit values aligned', () => {
    const header = readFileSync(new URL('../../engine/doom/doomgeneric/include/g_game.h', import.meta.url), 'utf8');
    const flags = { A21_MOVE_TRIAL: movementFlags.trial, A21_MOVE_SUCCESS: movementFlags.success,
      A21_MOVE_REJECTED: movementFlags.rejected, A21_MOVE_SLIDE: movementFlags.slide,
      A21_REJECT_SOLID_LINE: rejectionReasons.solidLine, A21_REJECT_SOLID_THING: rejectionReasons.solidThing,
      A21_REJECT_CLEARANCE: rejectionReasons.clearance, A21_REJECT_UNKNOWN: rejectionReasons.unknown };
    for (const [name, value] of Object.entries(flags))
      assert.match(header, new RegExp(`\\b${name} = ${value}\\b`));
    assert.deepEqual(Object.values(movementFlags), [1, 2, 4, 8]);
    assert.deepEqual(Object.values(rejectionReasons), [1, 2, 4, 8]);
    const game = readFileSync(new URL('../../engine/doom/doomgeneric/src/g_game.c', import.meta.url), 'utf8');
    for (const [index, owner] of [[87, 'a21_collision_sample_tic'], [88, 'a21_movement_flags'], [89, 'a21_rejection_mask']])
      assert.match(game, new RegExp(`case ${index}:\\s+return ${owner};`));
  });

  it('requires unavailable samples through preparation and a new sample on the first tic', () => {
    for (const op of ['init', 'prepare']) {
      const prepared = preparationResult(op);
      checkPrepared(op, prepared);
      assert.equal(collisionObservationValid(prepared), true);
      for (const field of ['collisionSampleTic', 'movementFlags', 'rejectionMask']) {
        const corrupt = structuredClone(prepared);
        corrupt.native[field] = 0;
        assert.throws(() => checkPrepared(op, corrupt), /collision sample/);
      }
    }
    const native = nativeFixture({ base: 0 });
    const before = native.observe();
    const result = execute(native, 1);
    assert.equal(result.native.collisionSampleTic, 1);
    assert.equal(verifyAction(before, 0, 1, result).complete, true);
    result.steps[0].native.collisionSampleTic = -1;
    assert.equal(verifyAction(before, 0, 1, result).independentlyVerifiedTics, 0);
  });

  it('validates mask combinations without inferring movement from input', () => {
    const allowed = [0, 3, 5, 7, 13, 15];
    for (let flags = 0; flags < 16; flags++) {
      for (let reasons = 0; reasons < 16; reasons++) {
        const sample = observation(2);
        Object.assign(sample.native, { movementFlags: flags, rejectionMask: reasons });
        const expected = allowed.includes(flags) && Boolean(flags & 4) === (reasons !== 0);
        assert.equal(collisionObservationValid(sample), expected, `${flags}/${reasons}`);
        const check = () => i11VerifyStep(0, observation(1), { ...sample, status: 0 });
        if (expected) check();
        else assert.throws(check, /collision sample/);
      }
    }
    for (const field of ['movementFlags', 'rejectionMask']) {
      for (const invalid of [-1, 16, 0x100000000, 1.5, NaN, Infinity, null, undefined]) {
        const sample = observation(2);
        sample.native[field] = invalid;
        assert.equal(collisionObservationValid(sample), false);
      }
    }
    // A forward command does not require a trial: reaction delay/momentum are native.
    const native = nativeFixture();
    const before = native.observe();
    assert.equal(verifyAction(before, 1, 1, execute(native, 1, 1)).complete, true);
  });

  it('rejects stale, unavailable, out-of-range and inapplicable completed samples', () => {
    for (const patch of [
      { collisionSampleTic: 1 }, { collisionSampleTic: -1 }, { collisionSampleTic: 3 },
      { collisionSampleTic: 2.5 }, { collisionSampleTic: undefined }, { actorEqual: 0 },
      { collisionSampleTic: 0x80000000 },
    ]) {
      const sample = observation(2);
      Object.assign(sample.native, patch);
      assert.equal(collisionObservationValid(sample), false);
    }
  });

  it('preserves refusal and passive identity for every field', () => {
    const before = observation(1);
    Object.assign(before.native, { movementFlags: 15, rejectionMask: 3 });
    i11VerifyStep(0, before, { ...structuredClone(before), status: -1 });
    passiveCheck(before, structuredClone(before));
    for (const field of ['collisionSampleTic', 'movementFlags', 'rejectionMask']) {
      const after = structuredClone(before);
      after.native[field]++;
      assert.throws(() => i11VerifyStep(0, before, { ...after, status: -1 }));
      assert.throws(() => passiveCheck(before, after), /Passive operation changed/);
    }
  });

  it('preserves per-step ownership, terminal prefixes and outer receipt equality', () => {
    for (const signals of [{}, death, exit]) {
      const native = nativeFixture({ at: 2, signals, onStep(next) {
        Object.assign(next.native, { movementFlags: 15, rejectionMask: next.counters.gametic === 2 ? 3 : 4 });
      } });
      const before = native.observe();
      const result = execute(native, 2);
      assert.equal(verifyAction(before, 0, 2, result).completionUncertain, false);
      assert.deepEqual(result.steps.map(step => [step.native.collisionSampleTic, step.native.rejectionMask]), [[2, 3], [3, 4]]);
      const wrongOuter = structuredClone(result);
      // The real receipt shares its final step object; corrupt only the envelope.
      wrongOuter.native = { ...wrongOuter.native, rejectionMask: 8 };
      const outer = verifyAction(before, 0, 2, wrongOuter);
      assert.equal(outer.independentlyVerifiedTics, 2);
      assert.equal(outer.completionUncertain, true);
      result.steps[1].native.collisionSampleTic = 2;
      const broken = verifyAction(before, 0, 2, result);
      assert.equal(broken.independentlyVerifiedTics, 1);
      assert.equal(broken.completionUncertain, true);
    }
  });

  it('retains collision values in controller diagnostic receipts and resulting frames', async () => {
    await withSession({ onStep(next) {
      Object.assign(next.native, { movementFlags: 15, rejectionMask: next.counters.gametic % 2 ? 1 : 2 });
    } }, async h => {
      h.browserInputs.tics = 2;
      assert.equal(await h.next(), 'completed');
      const operations = h.view.session.evidence.operations;
      const action = operations.findLast(entry => entry.op === 'action').result;
      assert.deepEqual(action.steps.map(step => [step.native.collisionSampleTic, step.native.rejectionMask]), [[2, 2], [3, 1]]);
      const render = operations.findLast(entry => entry.op === 'render').result;
      for (const sample of [action.native, render.native]) {
        assert.equal(sample.collisionSampleTic, 3);
        assert.equal(sample.movementFlags, 15);
        assert.equal(sample.rejectionMask, 1);
      }
      render.native.rejectionMask = 8;
      assert.equal(h.native.observe().native.rejectionMask, 1, 'Evidence is detached');
    });
  });
});
