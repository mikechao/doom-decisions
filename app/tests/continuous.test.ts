// Imported controller, SDK and finite native verifiers with offline browser ports.
import assert from 'node:assert/strict';
import { OpenAI } from 'openai/client';
import { VERSION } from 'openai/version';
import { afterEach, describe, it, vi } from 'vitest';
import * as requests from '../src/decision-request.ts';
import { assessE1M1 } from '../src/worker-shared.ts';
import { checkpoint, cleanup, withSession } from './fixtures/session.ts';
import {
  death,
  exit,
  i11Action,
  observation,
} from './fixtures/synthetic-doom.ts';

afterEach(cleanup);
describe('continuous', () => {
  it('validates Worker duration boundaries without large tic batches', async () => {
    // Worker duration validation uses a passive refusal, never a large tic batch.
    for (const n of [21, 35, 1000, Number.MAX_SAFE_INTEGER]) {
      let calls = 0;
      const result = i11Action(
        0,
        n,
        () => {
          ++calls;
          return -1;
        },
        () => observation(1),
      );
      assert.equal(calls, 1);
      assert.equal(result.completedTics, 0);
      assert.equal(result.outcome, 'REFUSED');
      assert.equal(result.reason, undefined);
    }
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
      const result = i11Action(
        0,
        n,
        () => assert.fail('Invalid duration dispatched'),
        () => observation(1),
      );
      assert.equal(result.completedTics, 0);
      assert.equal(result.outcome, 'REFUSED');
      assert.match(result.reason, /Invalid mask\/duration/);
    }
  });

  it('builds synchronously before charging and charges nothing for construction failure', async () => {
    const events = [];
    await withSession(
      {
        onCreate() {
          events.push('create');
        },
      },
      async (h) => {
        const build = requests.buildDefaultDecisionRequest;
        vi.spyOn(requests, 'buildDefaultDecisionRequest').mockImplementation(
          (tic, n, png) => {
            events.push('build');
            assert.equal(h.view.session.continuous.used, 0);
            assert.equal(tic, 1);
            assert.equal(n, 2);
            assert.equal(png, 'data:image/png;base64,synthetic');
            queueMicrotask(() => events.push('microtask'));
            return build(tic, n, png);
          },
        );
        h.browserInputs.tics = 2;
        h.browserInputs.budget = 1;
        await h.start();
        assert.deepEqual(events, ['build', 'create', 'microtask']);
        assert.equal(h.sdkViews[0].continuous.used, 1);
        assert.equal(h.view.session.continuous.used, 1);
        assert.equal(h.gameCalls, 2);
      },
    );
    await withSession({}, async (h) => {
      vi.spyOn(requests, 'buildDefaultDecisionRequest').mockImplementation(
        () => {
          throw Error('Synthetic request construction failure');
        },
      );
      await h.start();
      assert.equal(h.sdkCalls, 0);
      assert.equal(h.view.session.continuous.used, 0);
      assert.equal(h.gameCalls, 0);
    });
  });

  it('retains real SDK reader ownership across all cancellation modes and late outcomes', async () => {
    assert.equal(VERSION, '7.32.0');
    for (const cancellation of [
      'stop',
      'app-deadline',
      'sdk-deadline',
      'manual-sdk-deadline',
    ]) {
      for (const lateReject of [false, true]) {
        await withSession(
          {
            delayedBody: true,
            sdkDeadlineMs: cancellation.includes('sdk-deadline')
              ? 25
              : undefined,
          },
          async (h) => {
            h.clock();
            const manual = cancellation === 'manual-sdk-deadline';
            const work = manual ? h.next() : h.start();
            await h.waiting;
            assert.equal(h.readerPending, true);
            if (cancellation === 'stop') h.stop();
            else if (cancellation === 'app-deadline') await h.timeout();
            else await vi.advanceTimersByTimeAsync(25);
            await h.parserWaiting;
            assert.equal(h.parserSettled, true);
            assert.ok(
              h.parserError instanceof
                (cancellation.includes('sdk-deadline')
                  ? OpenAI.APIConnectionTimeoutError
                  : OpenAI.APIUserAbortError),
            );
            assert.equal(
              h.readerPending,
              true,
              'Real helper rejected before underlying reader settled',
            );
            await checkpoint(() =>
              h.view.session.evidence.decisions[0].stage === 'cleanup',
            );
            assert.equal(h.view.session.waitingForSdk, true);
            assert.equal(h.view.session.phase, 'busy');
            assert.equal(h.view.session.controls.ready, false);
            await h.start();
            assert.equal(await h.next(), 'not-admitted');
            assert.equal(h.sdkCalls, 1);
            assert.equal(h.gameCalls, 0);
            if (!manual) assert.equal(h.view.session.continuous.used, 1);
            const cleanupProof = h.hold('snapshot');
            if (lateReject) h.rejectBody();
            else h.releaseBody();
            await cleanupProof.waiting;
            assert.equal(h.view.session.waitingForSdk, false);
            assert.equal(h.view.session.evidence.decisions[0].stage, 'cleanup');
            assert.equal(h.view.session.controls.ready, false);
            cleanupProof.release();
            await work;
            assert.equal(h.view.session.evidence.decisions[0].stage, 'ended');
            assert.equal(h.readerPending, false);
            assert.equal(h.transportActive, 0);
            assert.equal(h.view.session.waitingForSdk, false);
            assert.equal(h.view.session.phase, 'ready');
            assert.equal(h.view.session.controls.ready, true);
            assert.equal(
              h.view.session.evidence.decisions[0].waitUnchanged,
              true,
            );
            assert.equal(
              h.gameCalls,
              0,
              'Late reader success/rejection never applies input',
            );
            assert.equal(h.creations, 1);
            assert.equal(h.worker.terminate.mock.calls.length, 0);
            if (cancellation === 'stop') {
              h.browserInputs.budget = 1;
              await h.start();
              assert.equal(h.view.session.continuous.used, 1);
            } else await h.next();
            assert.equal(h.sdkCalls, 2);
            assert.equal(h.maxActive, 1);
            assert.equal(h.gameCalls, lateReject ? 0 : 6);
          },
        );
      }
    }
  });

  it('admits large controller durations without dispatching invalid choices', async () => {
    for (const n of [1000, Number.MAX_SAFE_INTEGER])
      await withSession({ choice: { answers: [] } }, async (h) => {
        h.browserInputs.tics = n;
        assert.equal(await h.next(), 'api-failure');
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.gameCalls, 0);
        assert.equal(h.view.session.evidence.decisions[0].selectedTics, n);
        assert.equal(h.view.session.phase, 'ready');
      });
  });

  it('rejects invalid durations in manual and continuous admission without SDK work', async () => {
    for (const n of [
      0,
      -1,
      1.5,
      20.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      for (const mode of ['next', 'start'])
        await withSession({}, async (h) => {
          h.browserInputs.tics = n;
          await h[mode]();
          assert.equal(h.sdkCalls, 0);
          assert.equal(h.gameCalls, 0);
          assert.equal(h.view.session.evidence.decisions.length, 0);
          assert.match(
            h.view.status,
            /must be a positive JavaScript safe integer/,
          );
          if (mode === 'start') assert.equal(h.view.session.continuous.used, 0);
        });
    }
  });

  it('admits uncapped positive safe integer budgets and rejects invalid budgets', async () => {
    for (const limit of [1, 20, 100, 500, 1000, Number.MAX_SAFE_INTEGER]) {
      await withSession({ choice: { answers: [] } }, async (h) => {
        h.browserInputs.budget = limit;
        await h.start();
        assert.equal(h.view.session.continuous.limit, limit);
        assert.equal(h.view.session.continuous.used, 1);
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.view.session.phase, 'ready');
      });
    }
    for (const limit of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await withSession({}, async (h) => {
        h.browserInputs.budget = limit;
        await h.start();
        assert.equal(h.sdkCalls, 0);
        assert.equal(h.view.session.continuous, undefined);
        assert.equal(h.budgetFocus, 1);
      });
    }
  });

  it('charges nothing for bad observations invalid N or missing client', async () => {
    for (const fault of ['badPng', 'badCanvas', 'invalidN', 'noKey']) {
      await withSession(
        { key: fault === 'noKey' ? '' : undefined },
        async (h) => {
          if (fault === 'invalidN') h.browserInputs.tics = 0;
          if (fault === 'badPng') h.faults.badPng = true;
          if (fault === 'badCanvas')
            h.ports.capture = () => ({
              png: 'data:image/png;base64,synthetic',
              rgba: new Uint8ClampedArray(1024000),
            });
          await h.start();
          assert.equal(h.sdkCalls, 0);
          assert.equal(h.view.session.continuous.used, 0);
          assert.equal(h.gameCalls, 0);
        },
      );
    }
  });

  it('locks overlapping admissions through Stop and late Abort-ignoring success', async () => {
    await withSession({ delayedBody: true }, async (h) => {
      const running = h.start();
      await h.waiting;
      await h.start();
      assert.equal(await h.next(), 'not-admitted');
      assert.equal(h.sdkCalls, 1);
      h.stop();
      h.stop();
      await checkpoint(() =>
        h.view.session.evidence.decisions[0].status.includes('Waiting'),
      );
      assert.equal(h.view.session.phase, 'busy');
      assert.equal(h.view.session.continuous.active, true);
      assert.equal(h.view.session.continuous.used, 1);
      assert.equal(h.gameCalls, 0);
      assert.equal(h.view.session.waitingForSdk, true);
      assert.equal(h.view.session.controls.ready, false);
      await h.start();
      await h.next();
      assert.equal(h.sdkCalls, 1);
      h.releaseBody();
      await running;
      assert.equal(h.gameCalls, 0);
      assert.equal(h.gameOps.includes('action'), false);
      assert.equal(h.view.session.waitingForSdk, false);
      assert.equal(h.transportActive, 0);
      assert.equal(h.view.session.phase, 'ready');
      assert.equal(h.worker.terminate.mock.calls.length, 0);
      assert.equal(h.view.session.evidence.decisions[0].waitUnchanged, true);
      assert.equal(h.view.session.evidence.decisions[0].result, null);
      assert.equal(await h.next(), 'completed');
      assert.equal(h.sdkCalls, 2);
      assert.equal(h.maxActive, 1);
      assert.equal(h.creations, 1);
    });
  });

  it('drains late headers success rejection and application deadline cleanup before readiness', async () => {
    for (const lateOutcome of [
      'body-success',
      'body-rejection',
      'header-rejection',
    ]) {
      await withSession(
        { delayedHeaders: true, delayedBody: true },
        async (h) => {
          const work = h.start();
          await h.headersWaiting;
          h.stop();
          await checkpoint(() =>
            h.view.session.evidence.decisions[0].status.includes('Waiting'),
          );
          if (lateOutcome === 'body-rejection') h.rejectBody();
          else h.releaseBody();
          assert.equal(h.view.session.waitingForSdk, true);
          assert.equal(h.view.session.controls.ready, false);
          await h.next();
          await h.start();
          assert.equal(h.sdkCalls, 1);
          if (lateOutcome === 'header-rejection') h.rejectHeaders();
          else h.releaseHeaders();
          await work;
          assert.equal(h.gameCalls, 0);
          assert.equal(h.view.session.phase, 'ready');
          assert.equal(h.view.session.waitingForSdk, false);
          assert.equal(h.transportActive, 0);
          assert.equal(
            h.view.session.evidence.decisions[0].waitUnchanged,
            true,
          );
        },
      );
    }
    await withSession({ delayedBody: true }, async (h) => {
      h.clock();
      const work = h.start();
      await h.waiting;
      await h.timeout();
      await checkpoint(() =>
        h.view.session.evidence.decisions[0].status.includes('Waiting'),
      );
      await h.next();
      await h.start();
      assert.equal(h.sdkCalls, 1);
      h.releaseBody();
      await work;
      assert.match(h.view.session.continuous.reason, /deadline/);
      assert.equal(h.gameCalls, 0);
      assert.equal(h.view.session.continuous.used, 1);
    });
  });

  it('owns manual admission synchronously through delayed bodies and timeout cleanup', async () => {
    for (const timeout of [false, true])
      await withSession({ delayedBody: true }, async (h) => {
        h.clock();
        const work = h.next();
        assert.equal(h.view.session.phase, 'busy');
        assert.equal(h.view.session.controls.ready, false);
        await h.waiting;
        if (timeout) {
          await h.timeout();
          await checkpoint(() =>
            h.view.session.evidence.decisions[0].status.includes('Waiting'),
          );
        }
        await h.start();
        await h.next();
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.view.session.continuous, undefined);
        h.releaseBody();
        assert.equal(await work, timeout ? 'api-failure' : 'completed');
        assert.equal(h.view.session.phase, 'ready');
        assert.equal(h.gameCalls, timeout ? 0 : 6);
      });
  });

  it('stops before dispatch with unchanged native state and exact attempt charging', async () => {
    for (const occurrence of [1, 2])
      await withSession({}, async (h) => {
        const hold = h.hold('snapshot', occurrence);
        const work = h.start();
        await hold.waiting;
        assert.equal(
          h.view.session.evidence.decisions[0].stage,
          occurrence === 1 ? 'capturing' : 'requesting',
        );
        assert.equal(
          h.view.session.evidence.decisions[0].action,
          occurrence === 1 ? null : 'neutral',
        );
        const before = h.native.observe();
        h.stop();
        await h.next();
        await h.start();
        hold.release();
        await work;
        assert.deepEqual(h.native.observe(), before);
        assert.equal(h.sdkCalls, occurrence - 1);
        assert.equal(h.view.session.continuous.used, occurrence - 1);
        assert.equal(h.gameCalls, 0);
        assert.equal(h.view.session.phase, 'ready');
        assert.equal(h.view.session.evidence.decisions[0].waitUnchanged, true);
        assert.equal(h.view.session.evidence.decisions[0].stage, 'ended');
      });
  });

  it('finishes dispatched actions and resulting frames before Stop restores readiness', async () => {
    for (const op of ['action', 'render'])
      await withSession({}, async (h) => {
        const hold = h.hold(op);
        const work = h.start();
        await hold.waiting;
        assert.equal(h.workerActive, 1);
        assert.equal(
          h.view.session.evidence.decisions[0].stage,
          op === 'action' ? 'stepping' : 'rendering',
        );
        h.stop();
        assert.match(h.view.status, /Stopping after current decision/);
        assert.equal(h.view.session.phase, 'busy');
        assert.equal(h.view.session.controls.ready, false);
        await h.next();
        await h.start();
        hold.release();
        await work;
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.gameCalls, 6);
        assert.equal(h.view.session.phase, 'ready');
        assert.equal(h.view.session.controls.ready, true);
        assert.equal(h.creations, 1);
        assert.equal(h.worker.terminate.mock.calls.length, 0);
        const entry = h.view.session.evidence.decisions[0];
        assert.equal(entry.stage, 'completed');
        assert.equal(entry.execution.complete, true);
        assert.equal(entry.result.tic, 7);
        assert.equal(entry.result.nativeSha256, entry.result.canvasSha256);
        assert.match(h.view.session.continuous.reason, /Stopped by user/);
      });
  });

  it('fences observation hashing and drains resulting native and Canvas hashing', async () => {
    for (const n of [1, 2, 3])
      await withSession({}, async (h) => {
        const hold = h.holdDigest(n);
        const work = h.start();
        await hold.waiting;
        h.stop();
        assert.equal(h.view.session.phase, 'busy');
        assert.equal(h.view.session.controls.ready, false);
        await h.next();
        await h.start();
        hold.release();
        await work;
        assert.equal(h.sdkCalls, n === 1 ? 0 : 1);
        assert.equal(h.gameCalls, n === 1 ? 0 : 6);
        assert.equal(h.view.session.phase, 'ready');
        assert.equal(h.creations, 1);
        assert.equal(h.worker.terminate.mock.calls.length, 0);
      });
  });

  it('retires when stopped passive native-state verification fails', async () => {
    await withSession(
      { delayedBody: true, faults: { corruptSnapshot: 2 } },
      async (h) => {
        const work = h.start();
        await h.waiting;
        h.stop();
        h.releaseBody();
        await work;
        assert.equal(h.view.session.phase, 'error');
        assert.equal(h.view.session.controls.ready, false);
        assert.equal(h.gameCalls, 0);
        assert.equal(h.worker.terminate.mock.calls.length, 1);
      },
    );
  });

  it('stops between iterations without a second SDK invocation', async () => {
    await withSession({}, async (h) => {
      h.clock();
      const work = h.start();
      await checkpoint(
        () => h.view.session.evidence.decisions[0]?.stage === 'completed',
      );
      assert.equal(h.view.session.phase, 'ready');
      assert.equal(
        h.view.session.controls.ready,
        false,
        'Continuous ownership survives iteration yield',
      );
      await h.next();
      await h.start();
      assert.equal(h.sdkCalls, 1);
      h.stop();
      await vi.advanceTimersByTimeAsync(0);
      await work;
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.gameCalls, 6);
      assert.equal(h.view.session.controls.ready, true);
    });
  });

  it('stops API failures invalid answers and refusals without retry or restart', async () => {
    for (const options of [
      { apiError: true },
      { throwOnCreate: true },
      { choice: { answers: [] } },
      { choice: { answers: [{ type: 'refusal', name: 'next_action' }] } },
    ]) {
      await withSession(options, async (h) => {
        await h.start();
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.transportCalls, options.throwOnCreate ? 0 : 1);
        assert.equal(h.view.session.continuous.used, 1);
        assert.equal(h.gameCalls, 0);
        assert.equal(h.view.session.phase, 'ready');
        assert.equal(h.view.session.continuous.active, false);
        assert.equal(h.creations, 1);
        assert.equal(h.worker.terminate.mock.calls.length, 0);
        assert.doesNotMatch(
          h.view.session.continuous.reason,
          /Budget exhausted/,
        );
        if (options.apiError) {
          assert.match(
            h.view.session.continuous.reason,
            /authentication \(401\)/,
          );
          assert.equal(h.view.session.evidence.decisions[0].http, 401);
        }
      });
    }
  });

  it('retains terminal prefixes and frames then retires for death exit and combined signals', async () => {
    for (const signals of [death, exit, { ...death, ...exit }])
      await withSession({ at: 2, signals }, async (h) => {
        await h.start();
        const entry = h.view.session.evidence.decisions[0];
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.gameCalls, 2);
        assert.equal(entry.execution.requestedTics, 6);
        assert.equal(entry.execution.reportedCompletedTics, 2);
        assert.equal(entry.execution.independentlyVerifiedTics, 2);
        assert.equal(entry.execution.terminal, true);
        assert.equal(entry.result.tic, 3);
        assert.equal(entry.result.nativeSha256, entry.result.canvasSha256);
        assert.equal(h.view.session.phase, 'terminal');
        assert.equal(h.worker.terminate.mock.calls.length, 1);
        await h.start();
        await h.next();
        assert.equal(h.sdkCalls, 1);
      });
  });

  it('retires unsupported uncertain or unverifiable native outcomes and retains the previous frame', async () => {
    for (const options of [
      { at: 2, signals: { ready: 0 } },
      { trapAt: 2 },
      { faults: { badReceipt: true } },
      { at: 2, signals: death, faults: { badFrame: true } },
    ]) {
      await withSession(options, async (h) => {
        await h.start();
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.view.session.phase, 'error');
        assert.equal(h.view.session.controls.ready, false);
        assert.equal(h.worker.terminate.mock.calls.length, 1);
        assert.equal(h.view.session.evidence.decisions[0].result, null);
        assert.equal(h.view.session.frame.tic, 1);
        if (options.trapAt) {
          assert.equal(
            h.view.session.evidence.decisions[0].execution
              .independentlyVerifiedTics,
            1,
          );
          assert.equal(
            h.view.session.evidence.decisions[0].execution.completionUncertain,
            true,
          );
        }
        const calls = h.gameCalls;
        await h.start();
        await h.next();
        assert.equal(h.sdkCalls, 1);
        assert.equal(h.gameCalls, calls);
      });
    }
  });

  it('preserves terminal exit outcome when Stop arrives during rendering', async () => {
    await withSession({ at: 2, signals: exit }, async (h) => {
      const render = h.hold('render');
      const work = h.start();
      await render.waiting;
      h.stop();
      render.release();
      await work;
      assert.equal(h.view.session.phase, 'terminal');
      assert.match(h.view.session.continuous.reason, /exit pending/);
      assert.equal(h.gameCalls, 2);
    });
  });

  it('keeps the neutral preparation tic outside AI admission budget and history', async () => {
    await withSession({}, async (h) => {
      assert.equal(h.native.calls, 1);
      assert.equal(h.native.observe().counters.gametic, 1);
      assert.equal(h.sdkCalls, 0);
      assert.equal(h.view.session.continuous, undefined);
      assert.deepEqual(h.view.session.evidence.decisions, []);
      assert.deepEqual(h.actions, [{ mask: 0, tics: 1 }]);
      assert.equal(assessE1M1(h.native.observe()).kind, 'alive');
      h.browserInputs.budget = 1;
      await h.start();
      assert.equal(h.sdkCalls, 1);
      assert.equal(h.view.session.continuous.used, 1);
      assert.equal(h.view.session.evidence.decisions.length, 1);
    });
  });

  it('validates and consumes keys synchronously while retaining the client and session', async () => {
    for (const key of ['', 'bad key', '\u0000invalid'])
      await withSession({ key }, async (h) => {
        await h.start();
        assert.equal(h.sdkCalls, 0);
        assert.equal(h.view.session.continuous.used, 0);
        assert.equal(h.view.session.controls.ready, true);
        assert.equal(h.view.session.hasClient, false);
      });
    await withSession({}, async (h) => {
      const work = h.next();
      assert.equal(h.key, '', 'Key is consumed before the first await');
      assert.equal(h.view.session.phase, 'busy');
      h.key = 'replacement-offline-key';
      assert.equal(await h.next(), 'not-admitted');
      assert.equal(
        h.key,
        'replacement-offline-key',
        'Rejected overlap never consumes the replacement key',
      );
      assert.equal(await work, 'completed');
      assert.equal(await h.next(), 'completed');
      assert.equal(h.key, '');
      assert.equal(h.view.session.hasClient, true);
      h.key = 'bad key';
      assert.equal(await h.next(), 'not-admitted');
      assert.equal(
        h.view.session.hasClient,
        true,
        'Bad replacement leaves the prior client available',
      );
      assert.equal(
        await h.next(),
        'completed',
        'Blank key retains the existing client',
      );
      assert.equal(h.sdkCalls, 3);
      assert.equal(h.creations, 1);
      assert.equal(h.worker.terminate.mock.calls.length, 0);
    });
  });
});
