// Real Vite middleware + pinned SDK, loopback HTTP only, synthetic PNG/answers.
// No browser, native game, real credentials or external network requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { createLogger, createServer } from 'vite';
import { afterEach, beforeEach, it, vi } from 'vitest';
import config from '../vite.config.js';
import { buildDefaultDecisionRequest } from '../src/decision-request.ts';
import { jevDecisionProviderFactory } from '../src/jev-decision-provider.ts';

const serverKey = 'offline-server-dummy-only';
const placeholder = 'jev-vite-proxy-not-a-credential';
const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const input = buildDefaultDecisionRequest(73, 6, `data:image/png;base64,${base64}`);
const cleanups = [];
beforeEach(() => {
  vi.stubEnv('TYPESAFE_API_KEY', serverKey);
  vi.stubEnv('DEV', true);
  vi.stubEnv('MODE', 'jev');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  while (cleanups.length) await cleanups.pop()();
  vi.unstubAllEnvs();
});

const devConfig = () => config({ command: 'serve', mode: 'jev', isPreview: false });
async function listen(server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function harness(onRequest) {
  const upstream = httpServer(onRequest);
  const upstreamOrigin = await listen(upstream);
  const raw = devConfig();
  const proxy = raw.server.proxy['/__jev'];
  assert.equal(proxy.target, 'https://api.typesafe.ai');
  assert.equal(proxy.secure, true);
  assert.equal(proxy.followRedirects, false);
  assert.equal(raw.server.host, '127.0.0.1');
  // Test-only replacement; runtime config has no configurable upstream.
  proxy.target = upstreamOrigin;
  const logs = [];
  const logger = createLogger('silent');
  for (const level of ['info', 'warn', 'warnOnce', 'error'])
    logger[level] = (...args) => logs.push(inspect(args));
  const vite = await createServer({
    ...raw,
    configFile: false,
    envDir: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    mode: 'jev',
    customLogger: logger,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { ...raw.server, middlewareMode: true, watch: null, ws: false, preTransformRequests: false },
  });
  cleanups.push(() => vite.close());
  const local = httpServer(vite.middlewares);
  const origin = await listen(local);
  return { vite, origin, upstreamOrigin, logs };
}

function send(origin, path = '/__jev/v1/systemone', method = 'POST', headers = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
    const req = httpRequest(new URL(path, origin), {
      method,
      headers: { origin, 'content-type': 'multipart/form-data; boundary=dummy', ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

it('fails closed without a header-safe key and never stores it in inspectable configuration', () => {
  const message = 'Jev development requires a header-safe TYPESAFE_API_KEY on the Vite server.';
  for (const key of [undefined, '', ' ', 'dummy with spaces', 'dummy\r\ninjected', 'dummy\u007f', 'dummyé']) {
    vi.stubEnv('TYPESAFE_API_KEY', key);
    assert.throws(devConfig, (error: Error) => error.message === message);
  }
  vi.stubEnv('TYPESAFE_API_KEY', serverKey);
  assert.equal(inspect(devConfig(), { depth: 20 }).includes(serverKey), false);
});

it('has no proxy or secret requirement in default dev, Impeccable, build, production or preview', () => {
  vi.stubEnv('TYPESAFE_API_KEY', undefined);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const env of [
    { command: 'serve', mode: 'development' },
    { command: 'serve', mode: 'impeccable' },
    { command: 'build', mode: 'production' },
    { command: 'build', mode: 'jev' },
    { command: 'serve', mode: 'jev', isPreview: true },
    { command: 'serve', mode: 'production', isPreview: true },
  ]) {
    const raw = config(env);
    assert.equal(raw.server?.proxy, undefined);
    assert.deepEqual(raw.preview.proxy, {});
    assert.deepEqual(raw.worker, { format: 'es' });
    const plugin = raw.plugins[0];
    const transformed = plugin ? plugin.transformIndexHtml(html) : html;
    assert.match(transformed, /connect-src 'self'[^;]* https:\/\/api.openai.com/);
    assert.equal(transformed.includes('https://api.typesafe.ai'), false);
    if (env.isPreview || env.command === 'build') assert.equal(transformed, html);
    if (env.mode === 'impeccable') assert.match(transformed, /http:\/\/localhost:8400/);
  }
});

it('forwards one SDK PNG multipart unchanged, replaces auth, strips browser headers/cookies and keeps secrets off client surfaces', async () => {
  const received = [];
  const h = await harness(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'upstream=dummy', 'x-typesafe-request-id': 'offline_proxy_1' });
    res.end(JSON.stringify({ answers: { next_action: { type: 'choice', choice: 'forward' } } }));
  });
  const fetchLocal = globalThis.fetch;
  let browserBody, browserHeaders, cookie;
  const browserFetch = vi.fn(async (path, init) => {
    assert.equal(path, '/__jev/v1/systemone');
    browserHeaders = new Headers(init.headers);
    assert.equal(browserHeaders.get('authorization'), `Bearer ${placeholder}`);
    assert.equal(inspect(init).includes(serverKey), false);
    browserBody = Buffer.from(await init.body.arrayBuffer());
    const headers = new Headers(browserHeaders);
    headers.set('origin', h.origin);
    // Deliberately hostile headers prove stripping, despite credentials: omit.
    headers.set('cookie', 'browser=dummy');
    headers.set('proxy-authorization', 'Basic dummy');
    headers.set('referer', `${h.origin}/private-dummy`);
    const response = await fetchLocal(new URL(path, h.origin), { ...init, headers });
    cookie = response.headers.get('set-cookie');
    return response;
  });
  vi.stubGlobal('fetch', browserFetch);
  const lifecycle = {};
  const diagnostics = { requestId: null, http: null, latencyMs: null };
  const hooks = { assertFresh() {}, beforeCreate: vi.fn(), onReadStateChange() {} };
  const result = await jevDecisionProviderFactory.create(placeholder).request(input, lifecycle, diagnostics, hooks, performance.now());
  await lifecycle.sdkRead;
  assert.equal(result.action, 'forward');
  assert.equal(hooks.beforeCreate.mock.calls.length, 1);
  assert.equal(browserFetch.mock.calls.length, 1);
  assert.equal(received.length, 1);
  const request = received[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/v1/systemone');
  assert.equal(request.headers.authorization, `Bearer ${serverKey}`);
  assert.equal(request.headers.authorization.includes(placeholder), false);
  assert.equal(request.headers.host, new URL(h.upstreamOrigin).host);
  for (const name of ['cookie', 'proxy-authorization', 'origin', 'referer']) assert.equal(request.headers[name], undefined);
  for (const name of ['content-type', 'typesafe-danger-zone-images', 'x-typesafe-sdk', 'x-typesafe-runtime'])
    assert.equal(request.headers[name], browserHeaders.get(name));
  assert.equal(request.headers['typesafe-danger-zone-images'], 'true');
  assert.deepEqual(request.body, browserBody);
  const form = await new Response(request.body, { headers: { 'content-type': request.headers['content-type'] } }).formData();
  const payload = JSON.parse(form.get('request'));
  assert.equal(payload.model, 'jev-1.14.0');
  assert.equal(payload.state.context, input.context);
  assert.equal(payload.questions.next_action.instructions, input.instructions);
  assert.deepEqual(Object.keys(payload.questions.next_action.criteria), input.permittedActions);
  assert.deepEqual(Object.values(payload.questions.next_action.criteria), Array(7).fill(null));
  const png = form.get(payload.assets[payload.state.screenshot].part);
  assert.equal(png.type, 'image/png');
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), Buffer.from(base64, 'base64'));
  assert.equal([...form.keys()].length, 2);
  assert.equal(cookie, null);
  assert.equal(diagnostics.requestId, 'offline_proxy_1');
  assert.equal(JSON.stringify(diagnostics).includes(serverKey), false);
  // These GETs only transform/serve source. No page, Worker or WASM is executed.
  for (const path of ['/', '/src/main.ts', '/src/jev-decision-provider.ts']) {
    const response = await fetchLocal(new URL(path, h.origin));
    assert.equal(response.status, 200);
    const source = await response.text();
    assert.equal(source.includes(serverKey), false);
    if (path === '/') {
      assert.match(source, /connect-src 'self';/);
      assert.equal(source.includes('https://api.typesafe.ai'), false);
    }
  }
  assert.equal(inspect(h.vite.config, { depth: 20 }).includes(serverKey), false);
  assert.equal(h.logs.join('').includes(serverKey), false);
});

it('rejects other paths/methods, absent/foreign origins, bad hosts, Expect and non-multipart requests before forwarding', async () => {
  let forwarded = 0;
  const h = await harness((_req, res) => { forwarded++; res.end(); });
  for (const [path, method, headers] of [
    ['/__jev/v1/models', 'POST', {}],
    ['/__jev/v1/systemone?target=elsewhere', 'POST', {}],
    ['/__jev/v1/systemone/extra', 'POST', {}],
    ['/__jev/v1/systemone', 'GET', {}],
    ['/__jev/v1/systemone', 'OPTIONS', {}],
    ['/__jev/v1/systemone', 'POST', { origin: 'http://foreign.invalid' }],
    ['/__jev/v1/systemone', 'POST', { origin: 'null' }],
    ['/__jev/v1/systemone', 'POST', { origin: '' }],
    ['/__jev/v1/systemone', 'POST', { host: 'foreign.invalid' }],
    ['/__jev/v1/systemone', 'POST', { expect: '100-continue' }],
    ['/__jev/v1/systemone', 'POST', { 'content-type': 'application/json' }],
  ]) {
    const response = await send(h.origin, path, method, headers);
    assert.ok(response.status >= 400, `${method} ${path}: ${response.status}`);
    assert.equal(response.body.includes(serverKey), false);
  }
  assert.equal(forwarded, 0);
});

it('downstream cancellation closes the local upstream socket without claiming remote processing stopped', async () => {
  let resolveStarted, resolveClosed;
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const h = await harness((req, res) => {
    req.resume();
    res.on('close', resolveClosed);
    resolveStarted();
    // Deliberately never answer; a client abort must close this local transport.
  });
  const controller = new AbortController();
  const pending = fetch(`${h.origin}/__jev/v1/systemone`, {
    method: 'POST', headers: { origin: h.origin, 'content-type': 'multipart/form-data; boundary=dummy' }, signal: controller.signal,
  });
  const rejected = assert.rejects(pending, /abort/i);
  await started;
  controller.abort();
  await rejected;
  await closed;
});
