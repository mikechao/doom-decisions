// Ordinary-import lifecycle acceptance: local synthetic bytes/receipts and SDK
// transport only. No browser entry, source extraction, VM, WASM or game assets.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { it, vi } from 'vitest';
import {
  createSessionController,
  type SessionBrowserPorts,
  type SessionPresentation,
} from '../src/session-controller.ts';
import { nativeFixture, sha, workerResult } from './fixtures/synthetic-doom.ts';

it('initializes, prepares, and completes one verified decision through ordinary imports', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('crypto', webcrypto);
  const wasm = new Uint8Array([1, 2, 3]).buffer;
  const wad = new ArrayBuffer(12);
  const native = nativeFixture({ base: 0 });
  const ops = [];
  const transfers = [];
  let active = 0,
    maxActive = 0,
    sdkCalls = 0,
    creations = 0,
    paints = 0;
  let key = 'offline-not-a-credential';
  let painted = new Uint8ClampedArray(1024000);
  let view: SessionPresentation = {};
  let idleReached: () => void;
  const idle = new Promise<void>((resolve) => {
    idleReached = resolve;
  });
  const worker = {
    onmessage: null,
    terminate: vi.fn(),
    postMessage(data, transfer) {
      assert.equal(active, 0, 'No overlapping Worker/SDK work');
      maxActive = Math.max(maxActive, ++active);
      ops.push(data.op);
      transfers.push(transfer);
      const { result, frame } = workerResult(native, data);
      queueMicrotask(() => {
        --active;
        this.onmessage?.({
          data: {
            ok: true,
            op: data.op,
            elapsedMs: 0,
            result: structuredClone(result),
            pixels: frame?.buffer,
          },
        });
      });
    },
  };
  vi.stubGlobal('fetch', async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/decisions');
    assert.equal(active, 0, 'SDK begins after Worker settlement');
    maxActive = Math.max(maxActive, ++active);
    ++sdkCalls;
    const request = JSON.parse(options.body);
    assert.ok(
      JSON.stringify(request).includes('data:image/png;base64,synthetic'),
    );
    const response = new Response(
      JSON.stringify({
        answers: [{ type: 'choice', name: 'next_action', choice: 'neutral' }],
      }),
      {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_local',
        },
      },
    );
    const read = response.text.bind(response);
    response.text = async () => {
      try {
        return await read();
      } finally {
        --active;
      }
    };
    return response;
  });
  const ports: SessionBrowserPorts = {
    async localFetch(name, json?) {
      assert.equal(name, json ? 'doom-build.json' : 'doom.wasm');
      return json
        ? {
            profile: 'controlled-title',
            a1Fixtures: true,
            embeddedIwad: false,
            bytes: wasm.byteLength,
            sha256: sha(new Uint8Array(wasm)),
          }
        : wasm;
    },
    createWorker() {
      ++creations;
      return worker as unknown as Worker;
    },
    readTics: () => 6,
    takeKey() {
      const captured = key;
      key = '';
      return captured;
    },
    clearKey() {
      key = '';
    },
    focusBudget() {
      assert.fail('Valid inputs');
    },
    capture() {
      return {
        png: 'data:image/png;base64,synthetic',
        rgba: new Uint8ClampedArray(painted),
      };
    },
    paintAndReadback(rgba) {
      painted = new Uint8ClampedArray(rgba);
      ++paints;
      return new Uint8ClampedArray(painted);
    },
    clearCanvas() {
      painted.fill(0);
    },
    present(update) {
      view = { ...view, ...update };
      if (update.status?.includes('Checking five seconds of idle'))
        idleReached();
    },
  };
  const controller = createSessionController(ports);
  try {
    assert.deepEqual(ops, []);
    assert.equal(creations, 0);
    assert.deepEqual(view, {}, 'Construction is inert');
    await controller.initialize();
    assert.equal(view.iwadEnabled, true);
    assert.match(view.sdkStatus, /7.32.0.*decisions.create available/);
    assert.equal(creations, 0);
    const preparing = controller.prepare({
      size: wad.byteLength,
      arrayBuffer: async () => wad,
    });
    await idle;
    assert.equal(sdkCalls, 0, 'Preparation makes no API request');
    assert.equal(native.calls, 1, 'Exactly one mandatory neutral tic');
    assert.equal(view.session.controls.ready, false);
    assert.equal(await controller.next(), 'not-admitted');
    await vi.advanceTimersByTimeAsync(5000);
    await preparing;
    const prepared = view.session;
    assert.equal(prepared.controls.ready, true);
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.verifiedTics, 1);
    assert.equal(prepared.evidence.neutralFirst.requestedTics, 1);
    assert.equal(prepared.evidence.neutralFirst.reportedCompletedTics, 1);
    assert.equal(prepared.evidence.neutralFirst.independentlyVerifiedTics, 1);
    assert.equal(prepared.evidence.idle.observedMs, 5000);
    assert.equal(prepared.evidence.idle.unchanged, true);
    assert.deepEqual(
      prepared.evidence.idle.before,
      prepared.evidence.idle.after,
    );
    assert.equal(
      prepared.evidence.assets.iwad.sha256,
      sha(new Uint8Array(wad)),
    );
    assert.deepEqual(
      transfers[0],
      [wasm, wad],
      'Both local buffers transferred',
    );
    assert.equal(await controller.next(), 'completed');
    const completed = view.session;
    const entry = completed.evidence.decisions[0];
    assert.equal(sdkCalls, 1);
    assert.equal(key, '');
    assert.equal(creations, 1, 'Persistent prepared Worker');
    assert.equal(worker.terminate.mock.calls.length, 0);
    assert.equal(maxActive, 1);
    assert.equal(active, 0);
    assert.equal(paints, 3);
    assert.equal(native.calls, 7);
    assert.equal(completed.verifiedTics, 7);
    assert.equal(completed.phase, 'ready');
    assert.equal(completed.controls.ready, true);
    assert.equal(completed.waitingForSdk, false);
    assert.equal(entry.status, 'Complete');
    assert.equal(entry.waitUnchanged, true);
    assert.equal(entry.execution.complete, true);
    assert.equal(entry.execution.independentlyVerifiedTics, 6);
    assert.equal(entry.observation.tic, 1);
    assert.equal(entry.result.tic, 7);
    assert.equal(entry.result.nativeSha256, sha(painted));
    assert.equal(entry.result.canvasSha256, entry.result.nativeSha256);
    assert.deepEqual(completed.frame, entry.result);
    assert.deepEqual(ops, [
      'load-i11',
      'init',
      'prepare',
      'snapshot',
      'action',
      'render',
      'snapshot',
      'snapshot',
      'render',
      'snapshot',
      'snapshot',
      'snapshot',
      'snapshot',
      'action',
      'render',
    ]);
    assert.deepEqual(
      completed.evidence.operations.map(({ op }) => op),
      ops,
    );
    assert.equal(
      prepared.evidence.decisions.length,
      0,
      'Presentation data is detached',
    );
  } finally {
    controller.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
