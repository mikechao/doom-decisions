// Imported controller/Worker entry, synthetic buffers and mocked compilation only.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, it, vi } from 'vitest';
import { IWAD_MIN_BYTES, IWAD_MAX_BYTES } from '../src/worker-shared.ts';
import { cleanup, fixture } from './fixtures/session.ts';
import { sha } from './fixtures/synthetic-doom.ts';

afterEach(cleanup);
const wasm = new Uint8Array([1, 2, 3]).buffer;
const smallWad = new ArrayBuffer(IWAD_MIN_BYTES);
const largeWad = new ArrayBuffer(IWAD_MAX_BYTES);
const hash = (bytes) => sha(new Uint8Array(bytes));

async function selection(options, test) {
  const h = fixture(options);
  try {
    await h.controller.initialize();
    await test(h);
  } finally {
    await h.dispose();
  }
}

// Ordinary module startup with a fresh module instance, as in worker-entry.test.
// Both compile and instantiate are local fakes: no native WASM is executed.
async function withWorker(options, test) {
  let closed = false,
    compiles = 0,
    digests = 0;
  const replies = [];
  const scope = {
    postMessage: (reply) => replies.push(reply),
    close: () => {
      closed = true;
    },
  };
  const functions = [
    'initControlled',
    'renderControlled',
    'prepareE1M1Controlled',
    'stepNeutralControlled',
    'a21ReadObservation',
    'a1ReadCounter',
    'a1WasiInitCount',
  ];
  const runtimeError = WebAssembly.RuntimeError;
  try {
    vi.stubGlobal('self', scope);
    vi.stubGlobal('crypto', {
      subtle: {
        digest: (...args) => {
          ++digests;
          return webcrypto.subtle.digest(...args);
        },
      },
    });
    vi.stubGlobal('WebAssembly', {
      RuntimeError: runtimeError,
      compile: async () => {
        ++compiles;
        if (options.compileError) throw Error('Synthetic compile failure');
        return {};
      },
      Module: {
        exports: () => functions.map((name) => ({ name, kind: 'function' })),
        imports: () =>
          Array.from({ length: 9 }, () => ({
            module: 'loading',
            kind: 'function',
          })),
      },
      instantiate: async () => ({
        exports: {
          memory: { buffer: new ArrayBuffer(65536) },
          a1WasiInitCount: () => 0,
          a1ReadCounter: () => 0,
          a21ReadObservation: () => 0,
          initControlled: () => -2,
        },
      }),
    });
    vi.resetModules();
    await import('../src/worker.ts');
    await test({
      scope,
      replies,
      async load(wad, expectedWasmHash = hash(wasm)) {
        await scope.onmessage({
          data: { op: 'load-i11', wasm, wad, expectedWasmHash },
        });
        return replies.at(-1);
      },
      get closed() {
        return closed;
      },
      get compiles() {
        return compiles;
      },
      get digests() {
        return digests;
      },
    });
  } finally {
    cleanup();
  }
}

describe('iwad', () => {
  it('keeps the inclusive IWAD byte bounds', () => {
    assert.equal(IWAD_MIN_BYTES, 12);
    assert.equal(IWAD_MAX_BYTES, 33554432);
  });

  it('admits arbitrary local digests without an asset allowlist', async () => {
    // Behavioral replacement for scanning production text for obsolete hashes.
    for (const fill of [0, 17, 255]) {
      const wad = new Uint8Array(12).fill(fill).buffer;
      await selection({ wad }, async (h) => {
        await h.select();
        assert.equal(h.view.session.prepared, true);
        assert.equal(h.view.session.evidence.assets.iwad.sha256, hash(wad));
        assert.equal(h.view.session.verifiedTics, 1);
        assert.equal(h.sdkCalls, 0);
      });
    }
  });

  it('rejects out of range selection before reads fetches or Worker construction and permits retry', async () => {
    for (const size of [IWAD_MIN_BYTES - 1, IWAD_MAX_BYTES + 1]) {
      await selection({}, async (h) => {
        await h.select({
          size,
          arrayBuffer: () => assert.fail('Invalid selection was read'),
        });
        assert.equal(h.assetReads, 0);
        assert.equal(h.wasmFetches, 0);
        assert.equal(h.creations, 0);
        assert.deepEqual(h.ops, []);
        assert.equal(h.view.session.phase, 'unprepared');
        assert.equal(h.view.session.controls.iwad, true);
        assert.match(h.view.session.evidence.error, /12–33,554,432 bytes/);
        await h.select();
        assert.equal(h.view.session.prepared, true);
        assert.equal(
          h.view.session.evidence.neutralFirst.independentlyVerifiedTics,
          1,
        );
      });
    }
  });

  it('admits every synthetic size and digest then retires on native initialization refusal', async () => {
    for (const wad of [
      smallWad,
      new ArrayBuffer(4196020),
      new ArrayBuffer(28795076),
      largeWad,
    ]) {
      await selection(
        {
          wad,
          mutateResult(data, result) {
            if (data.op === 'init') result.status = -2;
          },
        },
        async (h) => {
          await h.select();
          assert.deepEqual(h.ops, ['load-i11', 'init']);
          assert.equal(h.view.session.evidence.assets.iwad.sha256, hash(wad));
          assert.match(
            h.view.session.evidence.error,
            /Native init failed \(status -2\)/,
          );
          assert.equal(h.view.session.phase, 'error');
          assert.equal(h.worker.terminate.mock.calls.length, 1);
          const count = h.ops.length;
          await h.select();
          assert.equal(h.ops.length, count, 'Native refusal requires reload');
        },
      );
    }
  });

  it('requires asset digest agreement and clean pre-init counters', async () => {
    for (const corrupt of [
      (result) => {
        result.wadSha256 = '0'.repeat(64);
      },
      (result) => {
        result.wasmSha256 = '0'.repeat(64);
      },
      (result) => {
        result.counters.wasiInit = 1;
      },
    ]) {
      await selection(
        {
          mutateResult(data, result) {
            if (data.op === 'load-i11') corrupt(result);
          },
        },
        async (h) => {
          await h.select();
          assert.deepEqual(h.ops, ['load-i11']);
          assert.match(
            h.view.session.evidence.error,
            /Asset identity\/pre-init counters mismatch/,
          );
          assert.equal(h.view.session.controls.ready, false);
          assert.equal(h.worker.terminate.mock.calls.length, 1);
        },
      );
    }
  });

  it('rejects bundled WASM hash or length mismatch before Worker construction', async () => {
    for (const options of [
      { engineHash: '0'.repeat(64) },
      { engineBytes: 4 },
    ]) {
      await selection(options, async (h) => {
        await h.select();
        assert.equal(h.creations, 0);
        assert.match(
          h.view.session.evidence.error,
          /Bundled WASM length\/hash mismatch/,
        );
        assert.equal(h.view.session.phase, 'error');
      });
    }
  });

  it('rejects hidden initialization tics through the production preparation verifier', async () => {
    await selection(
      {
        mutateResult(data, result) {
          if (data.op === 'init') result.native.build = 1;
        },
      },
      async (h) => {
        await h.select();
        assert.match(
          h.view.session.evidence.error,
          /Hidden init\/preparation tic/,
        );
        assert.equal(h.view.session.phase, 'error');
        assert.equal(h.worker.terminate.mock.calls.length, 1);
      },
    );
  });

  it('rejects invalid Worker payload sizes before digest or mocked compilation', async () => {
    for (const size of [IWAD_MIN_BYTES - 1, IWAD_MAX_BYTES + 1]) {
      await withWorker({}, async (h) => {
        const reply = await h.load(new ArrayBuffer(size));
        assert.equal(reply.ok, false);
        assert.match(reply.error, /12–33,554,432 bytes/);
        assert.equal(h.digests, 0);
        assert.equal(h.compiles, 0);
        assert.equal(h.closed, true);
      });
    }
  });

  it('accepts both size boundaries with matching digests and reports native refusal', async () => {
    for (const wad of [smallWad, largeWad]) {
      await withWorker({}, async (h) => {
        const reply = await h.load(wad);
        assert.equal(reply.ok, true);
        assert.equal(reply.result.wadSha256, hash(wad));
        assert.equal(h.compiles, 1);
        assert.equal(h.closed, false);
        await h.scope.onmessage({ data: { op: 'init' } });
        assert.equal(h.replies.at(-1).result.status, -2);
      });
    }
  });

  it('retires on integrity mismatch or mocked compilation failure', async () => {
    await withWorker({}, async (h) => {
      assert.equal((await h.load(smallWad, '0'.repeat(64))).ok, false);
      assert.equal(h.compiles, 0);
      assert.equal(h.closed, true);
    });
    await withWorker({ compileError: true }, async (h) => {
      assert.match((await h.load(smallWad)).error, /Synthetic compile failure/);
      assert.equal(h.closed, true);
    });
  });

  it('retires on preparation refusal diagnostics and one-shot counter mismatches', async () => {
    for (const corrupt of [
      (result) => {
        result.status = -1;
      },
      (result) => {
        result.logs = [{ kind: 'error', text: 'synthetic' }];
      },
      (result) => {
        result.logsTruncated = true;
      },
      (result) => {
        result.counters.engineCreate = 2;
      },
      (result) => {
        result.native.map = 2;
      },
    ])
      await selection(
        {
          mutateResult(data, result) {
            if (data.op === 'prepare') corrupt(result);
          },
        },
        async (h) => {
          await h.select();
          assert.equal(h.view.session.phase, 'error');
          assert.equal(h.worker.terminate.mock.calls.length, 1);
          assert.equal(h.native.calls, 0);
          assert.equal(h.sdkCalls, 0);
        },
      );
  });

  it('retires on passive snapshot frame hash Canvas or idle mismatch', async () => {
    for (const fault of ['snapshot', 'frame', 'canvas', 'idle']) {
      let snapshots = 0;
      await selection(
        {
          mutateResult(data, result) {
            if (data.op === 'snapshot') {
              ++snapshots;
              if (
                (fault === 'snapshot' && snapshots === 2) ||
                (fault === 'idle' && snapshots === 5)
              )
                result.native.health--;
            }
            if (fault === 'frame' && data.op === 'render')
              result.frameSha256 = '0'.repeat(64);
          },
        },
        async (h) => {
          if (fault === 'canvas')
            h.ports.paintAndReadback = (rgba) => {
              const copy = new Uint8ClampedArray(rgba);
              copy[0]++;
              return copy;
            };
          await h.select();
          assert.equal(h.view.session.phase, 'error');
          assert.equal(h.worker.terminate.mock.calls.length, 1);
          assert.equal(
            h.native.calls,
            1,
            'No extra tic on passive proof failure',
          );
          assert.equal(h.sdkCalls, 0);
          assert.equal(h.view.session.controls.ready, false);
        },
      );
    }
  });
});
