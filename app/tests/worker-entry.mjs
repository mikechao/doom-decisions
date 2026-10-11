// Entry/module smoke only: no browser, native WASM, API, or simulated tic engine.
import assert from 'node:assert/strict';

const replies = [];
let closed = false;
const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
globalThis.self = {
  postMessage: reply => replies.push(reply),
  close: () => { closed = true; },
};
try {
  await import('../src/worker-shared.ts');
  await import('../src/decision.ts');
  assert.equal(self.onmessage, undefined, 'Shared/controller imports must not install a Worker handler');
  await import('../src/worker.ts');
  assert.equal(typeof self.onmessage, 'function');
  assert.deepEqual(replies, []);
  assert.equal(closed, false);
  // A removed historical operation must fail and retire, never start gameplay.
  await self.onmessage({data: {op: 'step'}});
  assert.deepEqual(replies, [{
    ok: false, op: 'step', error: 'Error: Unknown operation', logs: [],
    logsTruncated: false, outcome: 'ERROR', retired: true, isWasmRuntimeError: false,
  }]);
  assert.equal(closed, true);
} finally {
  if (previous) Object.defineProperty(globalThis, 'self', previous);
  else delete globalThis.self;
}
console.log('Offline Worker entry/import boundary and unknown-operation retirement passed.');
