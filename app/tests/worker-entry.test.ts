// Entry/module smoke only: no browser, native WASM, API, or simulated tic engine.
import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';

describe('Worker entry', () => {
  it('keeps helper imports passive and retires unknown operations without starting gameplay', async () => {
    const replies = [];
    let closed = false;
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
    try {
      globalThis.self = {
        postMessage: (reply) => replies.push(reply),
        close: () => {
          closed = true;
        },
      };
      // Re-execute module startup so the test cannot pass against cached imports.
      vi.resetModules();
      await import('../src/worker-shared.ts');
      await import('../src/player-state.ts');
      await import('../src/decision.ts');
      expect(self.onmessage).toBeUndefined();
      await import('../src/worker.ts');
      expect(typeof self.onmessage).toBe('function');
      expect(replies).toStrictEqual([]);
      expect(closed).toBe(false);
      await self.onmessage({ data: { op: 'step' } });
      assert.deepEqual(replies, [
        {
          ok: false,
          op: 'step',
          error: 'Error: Unknown operation',
          logs: [],
          logsTruncated: false,
          outcome: 'ERROR',
          retired: true,
          isWasmRuntimeError: false,
        },
      ]);
      expect(closed).toBe(true);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'self', previous);
      else delete globalThis.self;
    }
  });
});
