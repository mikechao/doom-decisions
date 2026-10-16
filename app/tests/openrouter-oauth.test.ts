// Synthetic browser ports only; no redirects, credentials, network or native game.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { afterEach, it, vi } from 'vitest';
import { createOpenRouterOAuth, createS256Challenge } from '../src/openrouter-oauth.ts';

const pendingKey = 'doom-decisions.openrouter-oauth.pending.v1';
const nonce = 's'.repeat(43);
const verifier = 'v'.repeat(43);
const minted = 'offline-oauth-dummy-only';
const callback = 'http://127.0.0.1:5173/doom/';
const successQuery = `?code=offline-code&state=${nonce}`;

function fakeBrowser(href = callback) {
  const values = new Map<string, string>();
  const location = { href, assign: vi.fn() };
  const history = {
    state: { unrelated: 'preserve' },
    replaceState: vi.fn((_state, _title, path) => {
      location.href = new URL(path, location.href).href;
    }),
  };
  const storage = {
    getItem: vi.fn((name: string) => values.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => { values.set(name, value); }),
    removeItem: vi.fn((name: string) => { values.delete(name); }),
  };
  const fetch = vi.fn(async () => new Response(JSON.stringify({ key: minted })));
  const context = {
    location, history, sessionStorage: storage,
    crypto: webcrypto, fetch,
  } as unknown as Parameters<typeof createOpenRouterOAuth>[0];
  return { context, location, history, storage, values, fetch };
}

function pending(h: ReturnType<typeof fakeBrowser>, changes = {}) {
  h.values.set(pendingKey, JSON.stringify({
    verifier, state: nonce, callback, search: '?view=wide&tag=a&tag=b',
    hash: '#prompt', ...changes,
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('matches the RFC 7636 S256 vector without Buffer or a dependency', async () => {
  assert.equal(await createS256Challenge(
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    webcrypto as unknown as Crypto,
  ), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

it('generates independent random values, encodes the exact callback and prevents duplicate initiation', async () => {
  const h = fakeBrowser('http://localhost:51234/doom%20demo/?view=wide#prompt');
  const digest = deferred<ArrayBuffer>();
  let randomCall = 0;
  const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(++randomCall));
  h.context.crypto = {
    getRandomValues, subtle: { digest: () => digest.promise },
  } as unknown as Crypto;
  const oauth = createOpenRouterOAuth(h.context);
  const first = oauth.begin();
  await oauth.begin();
  assert.equal(oauth.busy, true);
  assert.equal(getRandomValues.mock.calls.length, 2);
  assert.equal(h.location.assign.mock.calls.length, 0);
  digest.resolve(new Uint8Array(32).fill(3).buffer);
  await first;
  const flow = JSON.parse(h.values.get(pendingKey)!);
  assert.equal(flow.verifier, 'AQEB'.repeat(10) + 'AQE');
  assert.equal(flow.state, 'AgIC'.repeat(10) + 'AgI');
  assert.notEqual(flow.verifier, flow.state);
  assert.equal(flow.verifier.length, 43);
  assert.equal(flow.state.length, 43);
  assert.equal(flow.callback, 'http://localhost:51234/doom%20demo/');
  assert.equal(flow.search, '?view=wide');
  assert.equal(flow.hash, '#prompt');
  const authorize = new URL(h.location.assign.mock.calls[0][0]);
  assert.equal(authorize.origin + authorize.pathname, 'https://openrouter.ai/auth');
  assert.equal(authorize.searchParams.get('callback_url'), flow.callback);
  assert.equal(authorize.searchParams.get('state'), flow.state);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('code_challenge'),
    'AwMD'.repeat(10) + 'AwM');
  assert.equal(h.storage.setItem.mock.calls.length, 1);
  assert.equal(h.fetch.mock.calls.length, 0);
  oauth.close();
  assert.equal(h.values.has(pendingKey), true, 'Outgoing redirect retains verifier');
});

it('claims and scrubs before fetch, preserves unrelated URL/history data, and exchanges only once', async () => {
  const h = fakeBrowser(callback + successQuery + '&extra=keep');
  pending(h);
  h.fetch.mockImplementation(async (_url, options) => {
    assert.equal(h.values.has(pendingKey), false);
    assert.equal(h.history.replaceState.mock.calls.length, 1);
    assert.equal(new URL(h.location.href).searchParams.has('code'), false);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.mode, 'cors');
    assert.deepEqual(JSON.parse(options.body), {
      code: 'offline-code', code_verifier: verifier, code_challenge_method: 'S256',
    });
    return new Response(JSON.stringify({ key: minted, user_id: 'ignored-offline-identity' }));
  });
  const oauth = createOpenRouterOAuth(h.context);
  assert.equal(h.location.href, callback + '?view=wide&tag=a&tag=b&extra=keep#prompt');
  assert.equal(h.history.replaceState.mock.calls[0][0], h.history.state);
  assert.equal(h.fetch.mock.calls.length, 0);
  await Promise.all([oauth.exchange(), oauth.exchange()]);
  await oauth.exchange();
  assert.equal(h.fetch.mock.calls.length, 1);
  assert.equal(h.fetch.mock.calls[0][0], 'https://openrouter.ai/api/v1/auth/keys');
  assert.equal(h.fetch.mock.calls[0][1].method, 'POST');
  assert.equal(oauth.hasKey, true);
  assert.match(oauth.message, /key received/);
  assert.doesNotMatch(oauth.message, /offline|identity/);
  assert.equal(h.values.size, 0, 'Minted key is never stored');
  assert.equal(oauth.takeKey(), minted);
  assert.equal(oauth.takeKey(), '');
  assert.equal(createOpenRouterOAuth(h.context).hasKey, false, 'Fresh page loses key');
});

it('does not replay if the page reloads after claim but before exchange', async () => {
  const h = fakeBrowser(callback + successQuery);
  pending(h);
  createOpenRouterOAuth(h.context);
  const reloaded = createOpenRouterOAuth(h.context);
  await reloaded.exchange();
  assert.equal(h.fetch.mock.calls.length, 0);
});

it('ignores unsolicited params and rejects uncorrelated, duplicate or malformed callbacks', async () => {
  for (const query of [
    '?code=unrelated', successQuery, '?code=offline-code',
    '?code=offline-code&state=wrong', '?code=offline-code&state=',
    `${successQuery}&state=${nonce}`,
    `${successQuery}&code=second`, `?code=&state=${nonce}`,
    `?code=%20&state=${nonce}`, `?code=%0A&state=${nonce}`,
    `${successQuery}&error=denied`, `${successQuery}&error=x&error=y`,
    `${successQuery}&error_description=private-body`,
  ]) {
    for (const hasPending of [false, true]) {
      if (hasPending && query === successQuery) continue;
      const h = fakeBrowser(callback + query);
      if (hasPending) pending(h);
      const oauth = createOpenRouterOAuth(h.context);
      await oauth.exchange();
      assert.equal(h.fetch.mock.calls.length, 0);
      assert.equal(oauth.hasKey, false);
      assert.equal(h.values.size, 0);
      assert.doesNotMatch(oauth.message, /offline-code|private-body|second/);
      if (!hasPending) {
        assert.equal(h.location.href, callback + query);
        assert.equal(h.history.replaceState.mock.calls.length, 0);
      }
    }
  }
  for (const url of [
    'http://localhost:5173/doom/', 'http://127.0.0.1:5174/doom/',
    'http://127.0.0.1:5173/other/',
  ]) {
    const h = fakeBrowser(url + successQuery);
    pending(h);
    const oauth = createOpenRouterOAuth(h.context);
    await oauth.exchange();
    assert.equal(h.fetch.mock.calls.length, 0);
    assert.equal(h.history.replaceState.mock.calls.length, 0);
  }
  for (const raw of ['{', '{}', JSON.stringify({ state: nonce })]) {
    const h = fakeBrowser(callback + successQuery);
    h.values.set(pendingKey, raw);
    const oauth = createOpenRouterOAuth(h.context);
    await oauth.exchange();
    assert.equal(h.fetch.mock.calls.length, 0);
    assert.equal(h.values.size, 0);
  }
});

it('clears no-code/denied returns, allows fresh sign-in, and never persists returned auth fields', async () => {
  for (const query of ['', '?error=access_denied', `?state=${nonce}&error=access_denied`]) {
    const h = fakeBrowser(callback + query);
    pending(h);
    const oauth = createOpenRouterOAuth(h.context);
    await oauth.exchange();
    assert.match(oauth.message, /not completed/);
    assert.equal(h.values.size, 0);
    assert.equal(h.fetch.mock.calls.length, 0);
    await oauth.begin();
    assert.equal(h.location.assign.mock.calls.length, 1);
    const flow = JSON.parse(h.values.get(pendingKey)!);
    assert.doesNotMatch(flow.search, /error|state|code/);
  }
});

it('fails safely for blocked storage, unavailable crypto and failed history cleanup', async () => {
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    const h = fakeBrowser(callback + successQuery);
    if (method !== 'setItem') pending(h);
    h.storage[method].mockImplementation(() => { throw Error('private storage details'); });
    const oauth = createOpenRouterOAuth(h.context);
    await oauth.exchange();
    await oauth.begin();
    assert.equal(h.fetch.mock.calls.length, 0);
    assert.equal(h.location.assign.mock.calls.length, 0);
    assert.doesNotMatch(oauth.message, /private storage/);
  }
  const h = fakeBrowser(callback + successQuery);
  pending(h);
  h.history.replaceState.mockImplementation(() => { throw Error('private URL'); });
  const oauth = createOpenRouterOAuth(h.context);
  await oauth.exchange();
  assert.equal(h.fetch.mock.calls.length, 0);
  assert.doesNotMatch(oauth.message, /private URL/);
  const missingCrypto = fakeBrowser();
  missingCrypto.context.crypto = undefined as unknown as Crypto;
  const unavailable = createOpenRouterOAuth(missingCrypto.context);
  await unavailable.begin();
  assert.equal(missingCrypto.location.assign.mock.calls.length, 0);
  assert.equal(unavailable.busy, false);
  const disabled = fakeBrowser();
  disabled.storage.setItem.mockImplementation(() => {});
  const noStorage = createOpenRouterOAuth(disabled.context);
  await noStorage.begin();
  assert.equal(disabled.location.assign.mock.calls.length, 0, 'Read-back must prove verifier was saved');
});

it('sanitizes HTTP, network, JSON and invalid-key failures without retries', async () => {
  const badResponses = [
    () => Promise.resolve(new Response('private response body', { status: 403 })),
    () => Promise.reject(Error('private network details')),
    () => Promise.resolve(new Response('private invalid JSON')),
    ...[null, {}, { key: '' }, { key: 3 }, { key: 'bad key' }, { key: 'bad\nkey' }]
      .map(body => () => Promise.resolve(new Response(JSON.stringify(body)))),
  ];
  for (const response of badResponses) {
    const h = fakeBrowser(callback + successQuery);
    pending(h);
    h.fetch.mockImplementation(response);
    const oauth = createOpenRouterOAuth(h.context);
    await oauth.exchange();
    await oauth.exchange();
    assert.equal(h.fetch.mock.calls.length, 1);
    assert.equal(oauth.hasKey, false);
    assert.equal(oauth.busy, false);
    assert.equal(oauth.message, 'OpenRouter key exchange failed. Try again or use an API key.');
  }
});

it('bounds both fetch and body reading even if transport ignores abort; late success cannot restore a key', async () => {
  vi.useFakeTimers();
  for (const stage of ['fetch', 'body']) {
    const h = fakeBrowser(callback + successQuery);
    pending(h);
    const gate = deferred<any>();
    h.fetch.mockImplementation(() => stage === 'fetch' ? gate.promise : Promise.resolve({
      ok: true, json: () => gate.promise,
    } as Response));
    const oauth = createOpenRouterOAuth(h.context);
    const exchanging = oauth.exchange();
    await vi.advanceTimersByTimeAsync(10000);
    await exchanging;
    assert.match(oauth.message, /timed out/);
    assert.equal(h.fetch.mock.calls[0][1].signal.aborted, true);
    gate.resolve(stage === 'fetch' ? new Response(JSON.stringify({ key: minted })) : { key: minted });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(oauth.hasKey, false);
    assert.equal(oauth.busy, false);
    assert.equal(h.fetch.mock.calls.length, 1);
  }
});

it('clear/close abort unresolved exchange and fence late reads; manual input discards an unused key', async () => {
  for (const command of ['clear', 'close'] as const) {
    const h = fakeBrowser(callback + successQuery);
    pending(h);
    const gate = deferred<Response>();
    h.fetch.mockImplementation(() => gate.promise);
    const oauth = createOpenRouterOAuth(h.context);
    const exchanging = oauth.exchange();
    oauth[command]();
    await exchanging;
    gate.resolve(new Response(JSON.stringify({ key: minted })));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(oauth.hasKey, false);
    assert.equal(oauth.busy, false);
    assert.equal(h.fetch.mock.calls[0][1].signal.aborted, true);
    assert.doesNotMatch(oauth.message, /received/);
  }
  const h = fakeBrowser(callback + successQuery);
  pending(h);
  const oauth = createOpenRouterOAuth(h.context);
  await oauth.exchange();
  assert.equal(oauth.takeKey('  invalid manual key  '), 'invalid manual key');
  assert.equal(oauth.takeKey(), '', 'No fallback after invalid manual replacement');
  oauth.close();
  await oauth.begin();
  assert.equal(oauth.takeKey('offline-manual'), '');
  assert.equal(h.location.assign.mock.calls.length, 0);
});
