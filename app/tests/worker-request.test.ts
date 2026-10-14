// Direct bridge tests only: no Worker startup, native WASM, SDK or game assets.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestWorker } from '../src/worker-request.ts';
import type { Success } from '../src/worker-shared.ts';

function fixture() {
  const worker = {
    postMessage: vi.fn(),
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as (() => void) | null,
    onmessageerror: null as (() => void) | null,
  };
  const lifecycle: Parameters<typeof requestWorker>[1] = {
    cancel: null,
    evidence: { activeOperation: 'action', operations: [] },
  };
  const hooks = { assertCurrent: vi.fn(), retire: vi.fn() };
  return {
    worker,
    lifecycle,
    hooks,
    request: () =>
      requestWorker(
        // The bridge uses only the four members supplied by this fake.
        worker as unknown as Worker,
        lifecycle,
        'action',
        hooks,
        { mask: 0, tics: 6 },
      ),
  };
}

function expectCleanup(h: ReturnType<typeof fixture>) {
  expect(h.lifecycle.cancel).toBeNull();
  expect(h.worker.onmessage).toBeNull();
  expect(h.worker.onerror).toBeNull();
  expect(h.worker.onmessageerror).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
}

function expectFailureCleanup(h: ReturnType<typeof fixture>) {
  expectCleanup(h);
  expect(h.hooks.retire).toHaveBeenCalledTimes(1);
  expect(h.lifecycle.evidence.operations).toEqual([]);
  // Failure activeOperation bookkeeping and Worker termination belong to the caller.
}

describe('Worker request settlement', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('remains pending until the 2000 ms watchdog, then retires and releases ownership', async () => {
    const h = fixture();
    const pending = h.request();
    const settled = vi.fn();
    void pending.then(settled, settled);
    const rejection = expect(pending).rejects.toThrow(
      'action watchdog expired (2000 ms); completion unknown.',
    );

    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).not.toHaveBeenCalled();
    expect(h.hooks.retire).not.toHaveBeenCalled();
    expect(h.lifecycle.cancel).toEqual(expect.any(Function));
    expect(h.worker.onmessage).toEqual(expect.any(Function));
    expect(h.worker.onerror).toEqual(expect.any(Function));
    expect(h.worker.onmessageerror).toEqual(expect.any(Function));
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(h.hooks.assertCurrent).not.toHaveBeenCalled();
    expectFailureCleanup(h);
    await vi.advanceTimersByTimeAsync(2000);
    expectFailureCleanup(h);
  });

  it('retires on a Worker error and cancels its watchdog', async () => {
    const h = fixture();
    const pending = h.request();
    const rejection = expect(pending).rejects.toThrow(
      'action Worker fault; completion unknown.',
    );

    h.worker.onerror!();
    await rejection;
    expect(h.hooks.assertCurrent).not.toHaveBeenCalled();
    expectFailureCleanup(h);
    await vi.advanceTimersByTimeAsync(2000);
    expectFailureCleanup(h);
  });

  it('retires on an unreadable Worker reply and cancels its watchdog', async () => {
    const h = fixture();
    const pending = h.request();
    const rejection = expect(pending).rejects.toThrow(
      'action Worker reply unreadable; completion unknown.',
    );

    h.worker.onmessageerror!();
    await rejection;
    expect(h.hooks.assertCurrent).not.toHaveBeenCalled();
    expectFailureCleanup(h);
    await vi.advanceTimersByTimeAsync(2000);
    expectFailureCleanup(h);
  });

  it('retires on a synchronous dispatch throw without accepting a receipt', async () => {
    const h = fixture();
    h.worker.postMessage.mockImplementationOnce(() => {
      throw Error('Synthetic dispatch exception');
    });

    await expect(h.request()).rejects.toThrow(
      'action dispatch failed; completion unknown.',
    );
    expect(h.worker.postMessage).toHaveBeenCalledTimes(1);
    expect(h.hooks.assertCurrent).not.toHaveBeenCalled();
    expectFailureCleanup(h);
  });

  it.each([
    ['mismatched operation', { op: 'snapshot', ok: true }],
    ['non-object payload', 'unreadable payload'],
    ['null payload', null],
  ])('rejects a %s at the reply envelope check', async (_label, data) => {
    const h = fixture();
    const pending = h.request();
    const rejection = expect(pending).rejects.toThrow(
      'Unexpected Worker reply; completion unknown.',
    );

    h.worker.onmessage!({ data });
    await rejection;
    expect(h.hooks.assertCurrent).toHaveBeenCalledTimes(1);
    expectFailureCleanup(h);
  });

  it('cancels once despite late competing failure callbacks or watchdog time', async () => {
    const h = fixture();
    const pending = h.request();
    const error = Error('Synthetic cancellation');
    const rejection = expect(pending).rejects.toBe(error);
    const cancel = h.lifecycle.cancel!;
    const onerror = h.worker.onerror!;
    const onmessageerror = h.worker.onmessageerror!;
    // Retirement can reenter cancellation while the caller tears down its session.
    h.hooks.retire.mockImplementation(() => {
      expectCleanup(h);
      cancel(Error('Synthetic retirement cancellation'));
    });

    cancel(error);
    await rejection;
    expectFailureCleanup(h);
    cancel(Error('Late cancellation'));
    onerror();
    onmessageerror();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).rejects.toBe(error);
    expect(h.hooks.assertCurrent).not.toHaveBeenCalled();
    expectFailureCleanup(h);
  });

  it.each([
    ['long string', 'x'.repeat(600), 'x'.repeat(500)],
    ['non-string diagnostic', { detail: 'synthetic' }, 'Worker operation failed.'],
  ])('bounds a Worker-declared failure with a %s', async (_label, error, diagnostic) => {
    const h = fixture();
    const pending = h.request();
    const rejection = expect(pending).rejects.toThrow(diagnostic);

    h.worker.onmessage!({ data: { op: 'action', ok: false, error } });
    await rejection;
    expect(h.lifecycle.evidence.workerError).toBe(diagnostic);
    expect(h.hooks.assertCurrent).toHaveBeenCalledTimes(1);
    expectFailureCleanup(h);
  });

  it('resolves an action receipt and releases ownership without retiring', async () => {
    const h = fixture();
    const pending = h.request();
    // Native-step verification of this action result remains the caller's job.
    const reply: Success<'action'> = {
      ok: true,
      op: 'action',
      elapsedMs: 12,
      result: {
        status: -1,
        mask: 0,
        requestedTics: 6,
        completedTics: 0,
        outcome: 'REFUSED',
        steps: [],
      },
    };
    const onerror = h.worker.onerror!;
    const onmessageerror = h.worker.onmessageerror!;
    const cancel = h.lifecycle.cancel!;

    h.worker.onmessage!({ data: reply });
    await expect(pending).resolves.toBe(reply);
    expect(h.worker.postMessage).toHaveBeenCalledExactlyOnceWith(
      { op: 'action', mask: 0, tics: 6 },
      [],
    );
    expect(h.hooks.assertCurrent).toHaveBeenCalledTimes(1);
    expect(h.lifecycle.evidence.operations).toEqual([
      { op: 'action', elapsedMs: 12, result: reply.result },
    ]);
    expect(h.lifecycle.evidence.activeOperation).toBeUndefined();
    expectCleanup(h);
    onerror();
    onmessageerror();
    cancel(Error('Late cancellation'));
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe(reply);
    expect(h.lifecycle.evidence.operations).toHaveLength(1);
    expect(h.hooks.retire).not.toHaveBeenCalled();
    expectCleanup(h);
  });
});
