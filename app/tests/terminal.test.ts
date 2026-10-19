// Pure imported verifiers and honest synthetic controller preparation; no VM/WASM.
import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';
import { OpenAI } from 'openai/client';
import { admitDecision, verifyAction } from '../src/decision.ts';
import { assessE1M1 } from '../src/worker-shared.ts';
import { cleanup, checkpoint, withSession } from './fixtures/session.ts';
import {
  death,
  exit,
  execute,
  i11Action,
  nativeFixture,
  observation,
} from './fixtures/synthetic-doom.ts';

afterEach(cleanup);
describe('terminal', () => {
  it('verifies death exit and combined signals at N and early prefixes without a next tic', async () => {
    for (const signals of [death, exit, { ...death, ...exit }]) {
      for (const n of [2, 6]) {
        const native = nativeFixture({ at: 2, signals });
        const before = native.observe(),
          result = execute(native, n);
        const evidence = verifyAction(before, 0, n, result);
        assert.equal(
          native.calls,
          2,
          'No k+1 native step, including terminal at N',
        );
        assert.equal(result.outcome, 'TERMINAL');
        assert.equal(evidence.requestedTics, n);
        assert.equal(evidence.reportedCompletedTics, 2);
        assert.equal(evidence.independentlyVerifiedTics, 2);
        assert.equal(evidence.cumulativeVerifiedTics, 3);
        assert.equal(evidence.complete, false);
        assert.equal(evidence.terminal, true);
        assert.equal(evidence.completionUncertain, false);
        assert.equal(evidence.assessment.tic, 3);
        assert.equal(evidence.assessment.dead, signals.playerstate === 1);
        assert.equal(evidence.assessment.exitPending, signals.gameaction === 6);
        assert.deepEqual(result.native, result.steps.at(-1).native);
        const passive = native.observe();
        native.observe();
        native.observe();
        assert.deepEqual(native.observe(), passive);
        assert.equal(execute(native, 1).completedTics, 0);
        assert.equal(
          native.calls,
          2,
          'Already terminal input makes no native call',
        );
        const forged = structuredClone(result);
        forged.steps.push({ status: 0, ...observation(4) });
        forged.completedTics++;
        const rejected = verifyAction(before, 0, n, forged);
        assert.equal(rejected.terminal, false);
        assert.equal(rejected.independentlyVerifiedTics, 2);
        assert.equal(rejected.completionUncertain, true);
      }
    }
  });

  it('keeps unsupported state separate from verified death or exit', async () => {
    for (const signals of [
      { ready: 0 },
      { ...death, health: 50 },
      { ...exit, ready: 1 },
      { ...exit, gamestate: 1 },
      { ...death, ...exit, map: 2 },
      { ...death, resources: 0 },
      { playerstate: 2, ready: 0 },
    ]) {
      const native = nativeFixture({ at: 2, signals });
      const before = native.observe(),
        result = execute(native, 6);
      const evidence = verifyAction(before, 0, 6, result);
      assert.equal(native.calls, 2);
      assert.equal(result.outcome, 'INELIGIBLE');
      assert.equal(evidence.independentlyVerifiedTics, 2);
      assert.equal(evidence.assessment.kind, 'unsupported');
      assert.equal(evidence.assessment.dead, signals.playerstate === 1);
      assert.equal(evidence.assessment.exitPending, signals.gameaction === 6);
      assert.equal(evidence.complete, false);
      assert.equal(evidence.terminal, false);
      assert.equal(evidence.completionUncertain, false); // State unknown; exact work prefix known.
    }
  });

  it('retains trap prefixes and rejects ambiguous terminal counters', async () => {
    const trapped = nativeFixture({ trapAt: 2 });
    const trappedBefore = trapped.observe(),
      trappedResult = execute(trapped, 6);
    const trappedEvidence = verifyAction(trappedBefore, 0, 6, trappedResult);
    assert.equal(trappedEvidence.reportedCompletedTics, 1);
    assert.equal(trappedEvidence.independentlyVerifiedTics, 1);
    assert.equal(trappedEvidence.completionUncertain, true);
    assert.equal(trappedEvidence.terminal, false);
    const ambiguous = nativeFixture({ at: 1, signals: death });
    const ambiguousBefore = ambiguous.observe(),
      ambiguousResult = execute(ambiguous, 6);
    ambiguousResult.steps[0].counters.worldComplete = 0;
    assert.equal(
      verifyAction(ambiguousBefore, 0, 6, ambiguousResult)
        .independentlyVerifiedTics,
      0,
    );
    assert.equal(
      verifyAction(ambiguousBefore, 0, 6, ambiguousResult).terminal,
      false,
    );
  });

  it('admits exactly one neutral preparation tic and refuses invalid input', async () => {
    const neutral = nativeFixture({ base: 0 });
    assert.equal(
      i11Action(
        1,
        1,
        () => {
          throw Error('Must not dispatch');
        },
        neutral.observe,
      ).completedTics,
      0,
    );
    assert.equal(
      verifyAction(neutral.observe(), 0, 1, execute(neutral, 1)).complete,
      true,
    );
    assert.equal(neutral.calls, 1);
  });

  it('retains one session through verified manual decisions and frame checkpoints', async () => {
    await withSession({}, async (h) => {
      h.browserInputs.tics = 2;
      assert.equal(await h.next(), 'completed');
      h.browserInputs.tics = 5;
      assert.equal(await h.next(), 'completed');
      assert.equal(h.sdkCalls, 2);
      assert.equal(h.view.session.phase, 'ready');
      assert.equal(h.creations, 1);
      assert.equal(h.worker.terminate.mock.calls.length, 0);
      assert.equal(h.view.session.verifiedTics, 8);
      assert.equal(h.gamePaints, 2);
      const [first, second] = h.view.session.evidence.decisions;
      assert.deepEqual(first.result, second.observation);
      for (const entry of [first, second]) {
        assert.equal(entry.execution.requestedTics, entry.selectedTics);
        assert.equal(entry.execution.reportedCompletedTics, entry.selectedTics);
        assert.equal(
          entry.execution.independentlyVerifiedTics,
          entry.selectedTics,
        );
        assert.equal(entry.execution.complete, true);
        assert.equal(entry.execution.terminal, false);
        assert.equal(entry.result.nativeSha256, entry.result.canvasSha256);
      }
    });
  });

  it('recovers manual readiness from an invalid model choice without dispatch', async () => {
    await withSession({ choice: { answers: [] } }, async (h) => {
      assert.equal(await h.next(), 'api-failure');
      assert.equal(h.view.session.evidence.decisions[0].stage, 'ended');
      assert.equal(h.gameCalls, 0);
      assert.equal(h.view.session.controls.ready, true);
      assert.equal(h.creations, 1);
      h.choice.answers = [
        { type: 'choice', name: 'next_action', choice: 'neutral' },
      ];
      assert.equal(await h.next(), 'completed');
      assert.equal(h.gameCalls, 6);
      assert.equal(h.view.session.phase, 'ready');
      assert.equal(h.creations, 1);
      assert.equal(h.worker.terminate.mock.calls.length, 0);
    });
  });

  it('verifies terminal frames and permanently fences admission for every terminal permutation', async () => {
    for (const signals of [death, exit, { ...death, ...exit }]) {
      for (const n of [2, 6])
        await withSession({ at: 2, signals }, async (h) => {
          h.browserInputs.tics = n;
          assert.equal(await h.next(), 'terminal');
          const session = h.view.session;
          const entry = session.evidence.decisions[0];
          assert.equal(entry.stage, 'ended');
          assert.equal(session.phase, 'terminal');
          assert.equal(session.controls.ready, false);
          assert.equal(h.worker.terminate.mock.calls.length, 1);
          const rendered = session.evidence.operations.at(-1).result;
          assert.equal(rendered.native.ready, 0);
          assert.equal(rendered.counters.gametic, 3);
          assert.equal(entry.result.tic, 3);
          assert.equal(entry.result.nativeSha256, h.paintedHash);
          assert.equal(entry.result.canvasSha256, h.paintedHash);
          assert.equal(h.gamePaints, 1);
          assert.equal(entry.execution.terminal, true);
          assert.equal(entry.execution.reportedCompletedTics, 2);
          assert.equal(entry.execution.independentlyVerifiedTics, 2);
          assert.match(entry.status, /frame retained/);
          if (signals.gameaction === 6)
            assert.match(entry.status, /exit pending/);
          const count = h.ops.length;
          assert.equal(await h.next(), 'not-admitted');
          await h.start();
          assert.equal(h.sdkCalls, 1);
          assert.equal(h.ops.length, count);
          assert.equal(h.gameCalls, 2);
          // Focused pure admission check preserves the hypothetical erroneous ready reset.
          assert.equal(
            admitDecision(
              {
                valid: true,
                phase: 'ready',
                worker: {},
                terminal: entry.execution.assessment,
              },
              1,
            ),
            undefined,
          );
        });
    }
  });

  it('closes admission while terminal rendering is still pending', async () => {
    await withSession({ at: 2, signals: exit }, async (h) => {
      const render = h.hold('render');
      const finishing = h.next();
      await render.waiting;
      assert.equal(h.view.session.evidence.decisions[0].stage, 'rendering');
      assert.equal(h.worker.terminate.mock.calls.length, 0);
      assert.equal(h.view.session.phase, 'busy');
      assert.equal(h.view.session.controls.ready, false);
      assert.equal(
        h.view.session.evidence.decisions[0].execution.assessment.kind,
        'terminal',
      );
      const count = h.ops.length;
      assert.equal(await h.next(), 'not-admitted');
      await h.start();
      assert.equal(
        h.ops.length,
        count,
        'No unverified continuation while terminal frame is pending',
      );
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.gameCalls, 2);
      render.release();
      assert.equal(await finishing, 'terminal');
      assert.equal(h.view.session.evidence.decisions[0].stage, 'ended');
      assert.equal(h.view.session.phase, 'terminal');
    });
  });

  it('retires unsupported uncertain or unverified results without replacing the Canvas', async () => {
    for (const options of [
      { at: 2, signals: { ready: 0 } },
      { at: 2, signals: death, faults: { badFrame: true } },
      { trapAt: 2 },
    ])
      await withSession(options, async (h) => {
        const preview = h.view.verifiedObservation;
        assert.equal(await h.next(), 'retired');
        assert.equal(h.view.verifiedObservation, preview, 'Unverified results never replace the preview');
        const session = h.view.session;
        assert.equal(session.evidence.decisions[0].stage, 'ended');
        assert.equal(session.controls.ready, false);
        assert.equal(session.phase, 'error');
        assert.equal(
          h.gamePaints,
          0,
          'Unverified/unsupported frame must not replace the Canvas',
        );
        assert.equal(session.frame.tic, 1);
        assert.equal(session.evidence.decisions[0].result, null);
        assert.equal(h.worker.terminate.mock.calls.length, 1);
        if (options.faults?.badFrame)
          assert.match(
            session.evidence.decisions[0].status,
            /terminal frame unavailable/,
          );
        const calls = h.gameCalls,
          count = h.ops.length;
        assert.equal(await h.next(), 'not-admitted');
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.gameCalls, calls);
        assert.equal(h.ops.length, count);
      });
  });

  it('fences valid late responses after close even when Abort is ineffective', async () => {
    for (const abortEffective of [true, false]) {
      await withSession({ delayedBody: true }, async (h) => {
        const pending = h.next();
        await h.waiting;
        const signal = h.sdkCreate.mock.calls[0][1].signal;
        // The legacy case deleted a private apiController field. Instead make
        // platform Abort ineffective: the real SDK can deliver a valid late
        // success, so only session/attempt identity can prevent native dispatch.
        if (!abortEffective)
          vi.spyOn(AbortController.prototype, 'abort').mockImplementation(
            () => {},
          );
        h.controller.close();
        h.controller.restore(true);
        assert.equal(h.view.session.evidence.decisions[0].stage, 'ended');
        assert.equal(h.view.session.waitingForSdk, true);
        assert.equal(signal.aborted, abortEffective);
        h.releaseBody();
        assert.equal(await pending, 'retired');
        await h.parserWaiting;
        if (abortEffective)
          assert.ok(h.parserError instanceof OpenAI.APIUserAbortError);
        else
          assert.equal(
            h.parserError,
            undefined,
            'Valid SDK success is fenced without Abort',
          );
        await checkpoint(() => h.transportActive === 0);
        assert.equal(await h.next(), 'not-admitted');
        h.controller.restore(true);
        assert.equal(h.view.session.phase, 'error');
        assert.equal(h.view.session.controls.ready, false);
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.gameCalls, 0);
        assert.equal(h.gameOps.includes('action'), false);
        assert.equal(h.worker.terminate.mock.calls.length, 1);
      });
    }
  });

  it('classifies the initial E1M1 checkpoint as alive', () => {
    assert.equal(assessE1M1(observation(1)).kind, 'alive');
  });
});
