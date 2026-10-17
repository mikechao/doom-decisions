// Real pinned gzip and native platform decompression; synthetic controller/native ports.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, it, vi } from 'vitest';
import { createIncludedFreedoom } from '../src/bundled-freedoom.ts';
import identity from '../src/freedoom-identity.json';
import { cleanup, deferred, fixture } from './fixtures/session.ts';

const compressed = readFileSync(new URL('../../third_party/freedoom/0.13.0/freedoom1.wad.gz', import.meta.url));
const response = () => new Response(Uint8Array.from(compressed));
const safeFailure = /Included Freedoom could not be loaded or verified/;
afterEach(cleanup);

it('is lazy, fetches relative to the site base, decompresses and verifies the original WAD', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const fetch = vi.fn(async () => response());
  vi.stubGlobal('fetch', fetch);
  for (const base of ['./', '/doom/']) {
    const before = fetch.mock.calls.length;
    const file = createIncludedFreedoom(base);
    assert.equal(file.size, 28795076);
    assert.equal(fetch.mock.calls.length, before, 'Constructing the choice performs no fetch');
    const wad = await file.arrayBuffer();
    assert.equal(wad.byteLength, identity.wad.bytes);
    assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256', wad)).toString('hex'), identity.wad.sha256);
    const [url, options] = fetch.mock.calls.at(-1);
    assert.equal(url, base + identity.gzip.path);
    assert.equal(new URL(url, 'https://example.test/doom/index.html').origin, 'https://example.test');
    assert.deepEqual(options, { mode: 'same-origin', redirect: 'error', credentials: 'omit', cache: 'no-store' });
  }
});

it('reports unsupported decompression without downloading, and sanitizes network/HTTP failures', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const nativeDecompression = DecompressionStream;
  vi.stubGlobal('DecompressionStream', undefined);
  await assert.rejects(createIncludedFreedoom('./').arrayBuffer(), /This browser cannot decompress/);
  assert.equal(fetch.mock.calls.length, 0);
  vi.stubGlobal('DecompressionStream', nativeDecompression);
  for (const result of [
    () => { throw Error('private transport details'); },
    () => new Response('private server body', { status: 404 }),
    () => new Response(new ReadableStream({ start(controller) { controller.error(Error('private read error')); } })),
  ]) {
    fetch.mockImplementation(result);
    await assert.rejects(createIncludedFreedoom('./').arrayBuffer(), error => {
      assert.match(error.message, safeFailure);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
  }
});

it('rejects missing, corrupt, truncated, wrong, or HTTP-decoded bytes before trying gzip decompression', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const decompression = vi.fn(function () { throw Error('Must reject before decompression'); });
  vi.stubGlobal('DecompressionStream', decompression);
  const corrupt = Buffer.from(compressed);
  corrupt[100] ^= 1;
  for (const body of [new Uint8Array(), compressed.subarray(0, -1), corrupt, Buffer.alloc(compressed.length), Buffer.alloc(identity.wad.bytes)]) {
    const fetch = vi.fn(async () => new Response(Uint8Array.from(body), { headers: { 'Content-Encoding': 'gzip' } }));
    vi.stubGlobal('fetch', fetch);
    await assert.rejects(createIncludedFreedoom('./').arrayBuffer(), safeFailure);
    assert.equal(fetch.mock.calls.length, 1, 'No implicit retry');
  }
  assert.equal(decompression.mock.calls.length, 0, 'No double-decompression of transparently decoded WAD bytes');
});

it('sanitizes decompressor errors and rejects decompressed length/hash mismatches', async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', async () => response());
  for (const output of [null, new Uint8Array(12), new Uint8Array(identity.wad.bytes)]) {
    vi.stubGlobal('DecompressionStream', function () {
      if (output === null) throw Error('private decompressor failure');
      return new TransformStream({ transform() {}, flush(controller) { controller.enqueue(output); } });
    });
    await assert.rejects(createIncludedFreedoom('./').arrayBuffer(), safeFailure);
  }
});

it('uses the existing single-flight preparation, transferring original bytes with neutral 1/1/1 and no provider calls', async () => {
  const h = fixture();
  const gate = deferred();
  const fetch = vi.fn(async () => { await gate.promise; return response(); });
  vi.stubGlobal('fetch', fetch);
  try {
    await h.controller.initialize();
    assert.equal(fetch.mock.calls.length, 0, 'Startup does not fetch the WAD');
    const included = createIncludedFreedoom('./');
    const preparing = h.select(included);
    assert.equal(h.view.session.phase, 'preparing');
    assert.equal(h.view.session.controls.iwad, false);
    await h.controller.prepare(included); // Duplicate click.
    await h.controller.prepare({ size: 12, arrayBuffer: () => assert.fail('No competing local read') });
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(h.creations, 0, 'No Worker until original bytes are verified');
    assert.equal(await h.controller.next(), 'not-admitted');
    gate.resolve();
    await preparing;
    assert.equal(h.creations, 1);
    assert.equal(h.view.session.phase, 'ready');
    assert.equal(h.view.session.evidence.assets.iwad.sha256, identity.wad.sha256);
    assert.equal(h.view.session.evidence.assets.iwad.bytes, identity.wad.bytes);
    const neutral = h.view.session.evidence.neutralFirst;
    assert.deepEqual([neutral.requestedTics, neutral.reportedCompletedTics, neutral.independentlyVerifiedTics], [1, 1, 1]);
    assert.equal(h.native.calls, 1);
    assert.equal(h.view.session.evidence.idle.unchanged, true);
    for (const frame of h.view.session.evidence.frames) assert.equal(frame.nativeSha256, frame.canvasSha256);
    assert.equal(h.sdkCalls, 0);
    assert.equal(h.transportCalls, 0);
    assert.equal(fetch.mock.calls.length, 1);
  } finally {
    gate.resolve();
    await h.dispose();
  }
});

it('leaves invalid included bytes retryable without a Worker, and the local IWAD path still prepares', async () => {
  const h = fixture();
  vi.stubGlobal('fetch', async () => new Response('wrong asset'));
  try {
    await h.controller.initialize();
    await h.select(createIncludedFreedoom('./'));
    assert.equal(h.creations, 0);
    assert.equal(h.native.calls, 0);
    assert.equal(h.view.session.phase, 'unprepared');
    assert.equal(h.view.session.controls.iwad, true);
    assert.match(h.view.status, safeFailure);
    await h.select();
    assert.equal(h.view.session.prepared, true);
    assert.equal(h.sdkCalls, 0);
  } finally {
    await h.dispose();
  }
});

it('fences late included fetch completion after page exit', async () => {
  const h = fixture();
  const gate = deferred();
  vi.stubGlobal('fetch', async () => { await gate.promise; return response(); });
  try {
    await h.controller.initialize();
    const preparing = h.controller.prepare(createIncludedFreedoom('./'));
    h.controller.close();
    gate.resolve();
    await preparing;
    assert.equal(h.creations, 0);
    assert.equal(h.native.calls, 0);
    assert.equal(h.sdkCalls, 0);
  } finally {
    gate.resolve();
    await h.dispose();
  }
});
