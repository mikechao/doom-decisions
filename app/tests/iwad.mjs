// Synthetic admission/receipt tests only; no real Worker, WASM, WAD asset or API.
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import {
  assessE1M1, i11MaskValid, i11VerifyStep,
  IWAD_MIN_BYTES, IWAD_MAX_BYTES, IWAD_SIZE_ERROR,
} from '../src/worker-shared.ts';

assert.equal(IWAD_MIN_BYTES, 12);
assert.equal(IWAD_MAX_BYTES, 33554432);
const sha = bytes => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
for (const source of [main, worker]) {
  assert.doesNotMatch(source, /TEMPORARY SHAREWARE|28795076|7323bcc168c5a45f|const wadHash/);
}
function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Source markers: ${start}`);
  return source.slice(first, last);
}
const controllerSource = stripTypeScriptTypes([
  'let current; const pageExited = false;',
  section(main, 'function check(', 'const passive = ['),
  section(main, 'const work = [', 'type EngineMetadata ='),
  section(main, 'function retire(', 'function terminalStatus('),
  section(main, 'function healthy(', 'async function request<'),
  section(main, 'async function prepare()', "$('#iwad').addEventListener"),
  '({ prepare, get run() { return current; } })',
].join('\n').replaceAll('import.meta.url', "'http://fixture.invalid/'"));
const wasmBytes = new Uint8Array([1, 2, 3]).buffer;
const smallWad = new ArrayBuffer(IWAD_MIN_BYTES);
const largeWad = new ArrayBuffer(IWAD_MAX_BYTES);
function browserFixture(size, wad = smallWad, options = {}) {
  let reads = 0, fetches = 0, constructions = 0, terminated = false;
  const ops = [], statuses = [];
  const nodes = new Map([
    ['#iwad', { files: [{ size, arrayBuffer: async () => { ++reads; return wad; } }] }],
    ['#frame', { textContent: '' }], ['#key', { value: '' }],
  ]);
  const api = runInNewContext(controllerSource, {
    IWAD_MIN_BYTES, IWAD_MAX_BYTES, IWAD_SIZE_ERROR,
    engine: { bytes: options.engineBytes ?? wasmBytes.byteLength,
      sha256: options.engineHash ?? sha(wasmBytes) },
    sdk: {}, crypto: webcrypto,
    $: selector => nodes.get(selector),
    context: { clearRect() {} },
    display: (_run, status) => statuses.push(status),
    localFetch: async () => { ++fetches; return wasmBytes; },
    Worker: class { constructor() { ++constructions; } terminate() { terminated = true; } },
    URL, // The VM uses an inert URL base in place of import.meta.url.
    request: async (_run, op) => {
      ops.push(op);
      if (op === 'load-i11') return { result: {
        wadSha256: options.receiptHash ?? sha(wad),
        wasmSha256: options.receiptWasmHash ?? sha(wasmBytes),
        counters: { wasiInit: options.preInitCount ?? 0 },
      } };
      assert.equal(op, 'init');
      // No synthetic file is claimed compatible: native init deliberately refuses.
      return { result: options.initResult ?? { status: -2 } };
    },
  });
  return { api, ops, statuses,
    get reads() { return reads; }, get fetches() { return fetches; },
    get constructions() { return constructions; }, get terminated() { return terminated; } };
}

for (const size of [IWAD_MIN_BYTES - 1, IWAD_MAX_BYTES + 1]) {
  const h = browserFixture(size);
  await h.api.prepare();
  assert.equal(h.reads, 0); assert.equal(h.fetches, 0);
  assert.equal(h.constructions, 0); assert.deepEqual(h.ops, []);
  assert.equal(h.api.run.phase, 'unprepared'); assert.equal(h.api.run.valid, false);
  assert.match(h.api.run.evidence.error, /12–33,554,432 bytes/);
}
// Different sizes/digests advance past admission; native refusal still retires.
for (const wad of [smallWad, new Uint8Array(4196020).buffer,
  new Uint8Array(28795076).buffer, largeWad]) {
  const h = browserFixture(wad.byteLength, wad);
  await h.api.prepare();
  assert.deepEqual(h.ops, ['load-i11', 'init']);
  assert.equal(h.api.run.evidence.assets.iwad.sha256, sha(wad));
  assert.match(h.api.run.evidence.error, /Native init failed \(status -2\)/);
  assert.equal(h.api.run.phase, 'error'); assert.equal(h.terminated, true);
}
for (const options of [
  { receiptHash: '0'.repeat(64) }, { receiptWasmHash: '0'.repeat(64) },
  { preInitCount: 1 },
]) {
  const h = browserFixture(smallWad.byteLength, smallWad, options);
  await h.api.prepare();
  assert.deepEqual(h.ops, ['load-i11']);
  assert.match(h.api.run.evidence.error, /Asset identity\/pre-init counters mismatch/);
  assert.equal(h.api.run.valid, false); assert.equal(h.terminated, true);
}
const badWasm = browserFixture(smallWad.byteLength, smallWad, { engineHash: '0'.repeat(64) });
await badWasm.api.prepare();
assert.equal(badWasm.constructions, 0);
assert.match(badWasm.api.run.evidence.error, /Bundled WASM length\/hash mismatch/);
const badWasmLength = browserFixture(smallWad.byteLength, smallWad, { engineBytes: 4 });
await badWasmLength.api.prepare();
assert.equal(badWasmLength.constructions, 0);
assert.match(badWasmLength.api.run.evidence.error, /Bundled WASM length\/hash mismatch/);
// Exercise the unchanged native proof checker directly through prepare().
const hiddenTic = browserFixture(smallWad.byteLength, smallWad, {
  initResult: { status: 0, native: { build: 1 }, counters: {} },
});
await hiddenTic.api.prepare();
assert.match(hiddenTic.api.run.evidence.error, /Hidden init\/preparation tic/);
assert.equal(hiddenTic.api.run.valid, false);

const workerSource = stripTypeScriptTypes(worker)
  .replace(/^import[\s\S]*?from '\.\/worker-shared\.ts';\n/gm, '')
  .replace(/^export /gm, '');
function workerFixture(options = {}) {
  let closed = false, compiles = 0, digests = 0;
  const replies = [];
  const self = { postMessage: reply => replies.push(reply), close: () => { closed = true; } };
  const functions = ['initControlled', 'renderControlled', 'prepareE1M1Controlled',
    'stepNeutralControlled', 'a21ReadObservation', 'a1ReadCounter', 'a1WasiInitCount'];
  runInNewContext(workerSource, {
    self, assessE1M1, i11MaskValid, i11VerifyStep,
    IWAD_MIN_BYTES, IWAD_MAX_BYTES, IWAD_SIZE_ERROR, TextDecoder, performance,
    crypto: { subtle: { digest: (...args) => { ++digests; return webcrypto.subtle.digest(...args); } } },
    WebAssembly: {
      RuntimeError: WebAssembly.RuntimeError,
      compile: async () => {
        ++compiles;
        if (options.compileError) throw Error('Synthetic compile failure');
        return {};
      },
      Module: {
        exports: () => functions.map(name => ({ name, kind: 'function' })),
        imports: () => Array.from({ length: 9 }, () => ({ module: 'loading', kind: 'function' })),
      },
      instantiate: async () => ({ exports: {
        memory: { buffer: new ArrayBuffer(65536) },
        a1WasiInitCount: () => 0, a1ReadCounter: () => 0, a21ReadObservation: () => 0,
        initControlled: () => -2,
      } }),
    },
  });
  return { self, replies, get closed() { return closed; },
    get compiles() { return compiles; }, get digests() { return digests; } };
}
async function load(h, wad, expectedWasmHash = sha(wasmBytes)) {
  await h.self.onmessage({ data: { op: 'load-i11', wasm: wasmBytes, wad, expectedWasmHash } });
  return h.replies.at(-1);
}
for (const size of [IWAD_MIN_BYTES - 1, IWAD_MAX_BYTES + 1]) {
  const h = workerFixture(), reply = await load(h, new ArrayBuffer(size));
  assert.equal(reply.ok, false); assert.match(reply.error, /12–33,554,432 bytes/);
  assert.equal(h.digests, 0); assert.equal(h.compiles, 0); assert.equal(h.closed, true);
}
for (const wad of [smallWad, largeWad]) {
  const h = workerFixture(), reply = await load(h, wad);
  assert.equal(reply.ok, true); assert.equal(reply.result.wadSha256, sha(wad));
  assert.equal(h.compiles, 1); assert.equal(h.closed, false);
  await h.self.onmessage({ data: { op: 'init' } });
  assert.equal(h.replies.at(-1).result.status, -2);
}
const workerIntegrity = workerFixture();
assert.equal((await load(workerIntegrity, smallWad, '0'.repeat(64))).ok, false);
assert.equal(workerIntegrity.compiles, 0); assert.equal(workerIntegrity.closed, true);
const compilation = workerFixture({ compileError: true });
assert.match((await load(compilation, smallWad)).error, /Synthetic compile failure/);
assert.equal(compilation.closed, true);
console.log('Synthetic IWAD size admission, digest agreement and fail-closed preparation passed.');
