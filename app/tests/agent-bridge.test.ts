// Entire browser → Vite middleware → CLI exchange uses in-memory HTTP fakes.
// No listener, browser, game asset, WASM or provider request.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, it, vi } from 'vitest';
import config from '../vite.config.js';
import { createAgentBridge } from '../agent-bridge.mjs';
import { startAgentObservationBridge } from '../src/agent-browser.ts';
import { agentOrigin, agentPath, agentPngBytes, parseAgentObservation, parseAgentDecisionResult } from '../src/agent-observation.ts';
import { runAgentCli } from '../../scripts/doom-agent.mjs';
import { agentObservation, pngFor } from './fixtures/agent.ts';
import { deferred, checkpoint, fixture } from './fixtures/session.ts';
import { death, exit } from './fixtures/synthetic-doom.ts';
import { validAgentCommand, parseAgentPromptResult, parseAgentConfigResult } from '../src/agent-control.ts';

const cleanups = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()(); vi.useRealTimers(); vi.restoreAllMocks(); });
class Reply extends EventEmitter {
  status = 0; headers = {}; chunks = []; writableEnded = false; destroyed = false;
  result = deferred(); onChunk; onEnd;
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write(chunk) { this.chunks.push(chunk); this.onChunk?.(chunk); return true; }
  end(chunk = '') {
    if (this.writableEnded) return;
    this.write(chunk); this.writableEnded = true;
    this.result.resolve(new Response(this.chunks.join(''), { status: this.status || 200, headers: this.headers }));
    this.onEnd?.(); this.emit('close');
  }
}
function harness() {
  const broker = createAgentBridge();
  cleanups.push(() => broker.close());
  function request(path, { method = 'POST', headers = {}, body = '{}' } = {}) {
    const req = typeof body === 'string' ? Readable.from([body]) : body;
    Object.assign(req, { url: path, method, headers: {
      host: '127.0.0.1:5174', ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    }, socket: { remoteAddress: '127.0.0.1' }, complete: typeof body === 'string', aborted: false });
    const res = new Reply();
    broker.middleware(req, res, () => { res.writeHead(404, {}); res.end(); });
    return res;
  }
  const transport = (url, options) => request(new URL(url).pathname, options).result.promise;
  const send = (op, data, role = 'cli', headers = {}) => request(`${agentPath}/${op}`, {
    headers: { 'content-type': 'application/json', 'x-doom-agent': role, ...(role === 'page' ? { origin: agentOrigin, 'sec-fetch-site': 'same-origin' } : {}), ...headers },
    body: JSON.stringify(data),
  });
  const post = async (op, data, role = 'cli') => {
    const res = await send(op, data, role).result.promise;
    const value = await res.json();
    if (!res.ok) throw Error(value.error);
    return value;
  };
  const browser = (observe = async () => agentObservation(), network = {}) => {
    const states = [];
    const handle = startAgentObservationBridge({
      pageId: randomUUID(), observe,
      attach: epoch => network.controller?.attachAgent(epoch),
      allow: epoch => network.controller?.allowAgent(epoch) ?? false,
      allowRun: epoch => network.controller?.allowAgentRun(epoch) ?? false,
      prompt: (epoch, sessionId, fresh, update) => network.controller.agentPrompt(epoch, sessionId, fresh, update),
      config: (epoch, sessionId, fresh, update) => network.controller.agentConfig(epoch, sessionId, fresh, update),
      stopAgent: () => network.controller?.stopAgent(),
      decide: (epoch, id, fresh, scope) => network.controller.agentNext(epoch, id, fresh, scope),
      state: (state) => states.push(state),
      post: (path, data, signal) => {
        const send = () => post(path.slice(agentPath.length + 1), data, 'page');
        return network.post ? network.post(path, data, signal, send) : send();
      },
      events(path) {
        let closed = false;
        const source = { onmessage: null, onerror: null, close() {
          closed = true;
          if (network.close) network.close(() => response.end());
          else response.end();
        } };
        const response = request(path, { method: 'GET', headers: { 'sec-fetch-site': 'same-origin' } });
        response.onChunk = (chunk) => {
          if (chunk.startsWith('data: ')) queueMicrotask(() => { if (!closed) source.onmessage?.({ data: chunk.slice(6).trim() }); });
        };
        response.onEnd = () => { if (!closed) source.onerror?.(); };
        return source;
      },
    });
    cleanups.push(() => handle.stop());
    return { ...handle, states };
  };
  return { broker, request, transport, send, post, browser };
}

it('gates routes to agent serve, uses a deterministic strict loopback port and preserves production CSP', () => {
  for (const mode of ['development', 'impeccable', 'production']) {
    for (const command of ['serve', 'build']) {
      const raw = config({ command, mode });
      assert.equal(raw.plugins.some(p => p.name === 'agent-observation-bridge'), false);
    }
  }
  assert.equal(config({ command: 'serve', mode: 'agent' }).plugins.some(p => p.name === 'agent-observation-bridge'), true);
  const raw = config({ command: 'serve', mode: 'agent' });
  assert.equal(raw.server.host, '127.0.0.1'); assert.equal(raw.server.port, 5174); assert.equal(raw.server.strictPort, true);
  const plugin = raw.plugins.find(p => p.name === 'agent-observation-bridge');
  plugin.configResolved({ server: raw.server });
  assert.throws(() => plugin.configResolved({ server: { ...raw.server, port: 5175 } }));
  assert.throws(() => plugin.configResolved({ server: { ...raw.server, strictPort: false } }));
  assert.throws(() => config({ command: 'build', mode: 'agent' }));
  assert.throws(() => config({ command: 'serve', mode: 'agent', isPreview: true }));
});
it('rejects malformed requests and foreign hosts/origins without echoing input', async () => {
  const h = harness();
  for (const headers of [
    { origin: 'https://foreign.invalid' }, { host: 'evil.invalid:5174' },
    { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' },
  ]) {
    const response = await h.send('attach', { ownerId: randomUUID() }, 'cli', headers).result.promise;
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'forbidden' });
  }
  const response = await h.send('register', { pageId: randomUUID(), credential: 'offline-dummy' }, 'page').result.promise;
  assert.equal(response.status, 400); assert.equal((await response.text()).includes('offline-dummy'), false);
  const malformed = h.request(`${agentPath}/attach`, { headers: { 'content-type': 'application/json', 'x-doom-agent': 'cli' }, body: '{' });
  assert.equal((await malformed.result.promise).status, 400);
  await assert.rejects(h.post('attach', { ownerId: randomUUID() }), /no-ready-page/);
});
it('delivers a correlated verified PNG through browser, broker and CLI without printing base64', async () => {
  const h = harness();
  const observation = agentObservation();
  observation.tic = observation.frame.tic = observation.counters.gametic = 7;
  observation.facingProbe = { tic: 7, kind: 4, door: 2, distance: 24 };
  observation.previousAction = { action: 'forward', tics: 6, endTic: 7,
    text: 'Previous verified action: forward (6 tics).\nPlayer XY displacement: dx=6, dy=0 Doom units; net translation observed.' };
  const page = h.browser(async fresh => { fresh(); return structuredClone(observation); });
  await page.ready;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-agent-test-'));
  cleanups.push(() => rm(temporaryRoot, { recursive: true, force: true }));
  const attached = await runAgentCli(['attach'], { transport: h.transport, temporaryRoot });
  assert.ok(isAbsolute(attached.leaseFile));
  assert.equal(page.states.at(-1), 'attached');
  const result = await runAgentCli(['observe', '--lease', attached.leaseFile], { transport: h.transport });
  assert.ok(isAbsolute(result.pngPath));
  assert.equal(result.pageId, attached.pageId); assert.equal(result.epoch, attached.epoch);
  assert.equal(result.sessionId, observation.sessionId); assert.equal(result.tic, 7);
  const { png: _png, ...metadata } = observation;
  for (const [key, value] of Object.entries(metadata)) assert.deepEqual(result[key], value);
  assert.deepEqual(await readFile(result.pngPath), Buffer.from(agentPngBytes(observation.png)));
  assert.equal(JSON.stringify(result).includes('base64'), false);
  assert.deepEqual((await readdir(join(attached.leaseFile, '..'))).sort(), [`${result.commandId}.png`, 'lease.json'].sort());
  await assert.rejects(h.post('attach', { ownerId: randomUUID() }), /owner-already-attached/);
  page.stop();
  await assert.rejects(runAgentCli(['observe', '--lease', attached.leaseFile], { transport: h.transport }), /agent-stopped/);
  await assert.rejects(h.post('attach', { ownerId: randomUUID() }), /no-ready-page/);
});
it('fences delayed observations and duplicates, and never transfers a lease to another owner/page', async () => {
  const h = harness();
  const gate = deferred(); let fresh;
  const page = h.browser(async check => { fresh = check; await gate.promise; check(); return agentObservation(); });
  await page.ready;
  const lease = await h.post('attach', { ownerId: randomUUID() });
  const command = { ...lease, commandId: randomUUID() };
  const pending = h.send('observe', command).result.promise;
  await checkpoint(() => !!fresh);
  await assert.rejects(h.post('observe', command), /duplicate-command/);
  await assert.rejects(h.post('observe', { ...command, ownerId: randomUUID() }), /lease-revoked/);
  await assert.rejects(h.post('observe', { ...command, commandId: randomUUID() }), /observation-busy/);
  const second = await h.send('register', { pageId: randomUUID() }, 'page').result.promise;
  assert.equal(second.status, 409);
  assert.equal((await pending).status, 409);
  await checkpoint(() => page.states.at(-1) === 'stopped');
  assert.throws(fresh, /revoked/);
  gate.resolve();
  await assert.rejects(h.post('observe', command), /lease-revoked/);
});
it('revokes browser-local admission synchronously before server acknowledgement and ignores delayed events', async () => {
  const pageId = randomUUID(), pageToken = randomUUID(), epoch = randomUUID(), ownerId = randomUUID();
  const gate = deferred(), acknowledgement = deferred();
  const events = { onmessage: null, onerror: null, close: vi.fn() };
  let fresh; let captures = 0; let controllerStops = 0;
  const posts = [];
  const handle = startAgentObservationBridge({
    pageId, events: () => events, state: () => {},
    stopAgent() { controllerStops++; },
    async post(path, data) {
      posts.push(path);
      if (path.endsWith('/register')) return { pageId, pageToken };
      if (path.endsWith('/revoke')) {
        assert.equal(controllerStops, 1);
        assert.deepEqual(data, { pageId, pageToken, reason: 'user-requested' });
        return acknowledgement.promise;
      }
      assert.fail('No result after local Stop');
    },
    async observe(check) { captures++; fresh = check; await gate.promise; check(); return agentObservation(); },
  });
  await handle.ready;
  const send = data => events.onmessage({ data: JSON.stringify(data) });
  send({ type: 'attached', pageId, epoch, ownerId });
  send({ type: 'observe', pageId, epoch, ownerId, commandId: randomUUID() });
  handle.stop();
  handle.stop(); // No second revoke or local Stop.
  assert.equal(controllerStops, 1);
  assert.throws(fresh, /revoked/);
  send({ type: 'observe', pageId, epoch, ownerId, commandId: randomUUID() });
  assert.equal(captures, 1); assert.equal(events.close.mock.calls.length, 0);
  gate.resolve(); acknowledgement.resolve({ stopped: true });
  await checkpoint(() => events.close.mock.calls.length === 1);
  assert.equal(posts.filter(path => path.endsWith('/revoke')).length, 1);
  assert.equal(posts.some(path => path.endsWith('/result')), false);
});
it('Stop aborts an in-flight result before notification; aborted/incomplete bodies cannot succeed even with valid JSON', async () => {
  for (const aborted of [true, false]) {
    const h = harness();
    const started = deferred(), revokeDelivery = deferred();
    const input = new PassThrough();
    let signal, upload, finishBody, closeStream;
    const page = h.browser(async () => agentObservation(), {
      close: close => { closeStream = close; }, // Delay the stream-close notification.
      async post(path, data, transferSignal, send) {
        if (path.endsWith('/revoke')) { await revokeDelivery.promise; return send(); }
        if (!path.endsWith('/result')) return send();
        signal = transferSignal;
        const text = JSON.stringify(data), split = Math.floor(text.length / 2);
        upload = h.request(path, {
          headers: { 'content-type': 'application/json', 'x-doom-agent': 'page', origin: agentOrigin }, body: input,
        });
        input.write(text.slice(0, split));
        // Simulate buffered bytes still arriving despite fetch cancellation. The
        // broker must independently inspect HTTP completeness/abort state.
        transferSignal?.addEventListener('abort', () => { input.aborted = aborted; }, { once: true });
        finishBody = () => { input.complete = aborted; input.end(text.slice(split)); };
        started.resolve();
        const response = await upload.result.promise;
        if (!response.ok) throw Error('upload rejected');
        return response.json();
      },
    });
    try {
      await page.ready;
      const lease = await h.post('attach', { ownerId: randomUUID() });
      const cli = h.send('observe', { ...lease, commandId: randomUUID() });
      let cliSettled = false;
      void cli.result.promise.then(() => { cliSettled = true; });
      await started.promise;
      page.stop();
      assert.equal(signal?.aborted, true, 'Stop aborts before network acknowledgement');
      assert.equal(page.states.at(-1), 'stopped');
      finishBody(); // Full valid JSON, but HTTP aborted OR incomplete.
      const rejected = await upload.result.promise;
      assert.equal(rejected.status, 400);
      assert.deepEqual(await rejected.json(), { error: 'invalid-request' });
      assert.equal(cliSettled, false, 'Rejected upload never publishes CLI success');
      revokeDelivery.resolve();
      const stopped = await cli.result.promise;
      assert.equal(stopped.status, 409);
      assert.deepEqual(await stopped.json(), { error: 'agent-stopped' });
      await checkpoint(() => !!closeStream);
      closeStream();
      await assert.rejects(h.post('observe', { ...lease, commandId: randomUUID() }), /agent-stopped/);
    } finally {
      input.destroy(); revokeDelivery.resolve(); closeStream?.(); page.stop();
    }
  }
});
it('rechecks a fully delivered late upload after revocation, but does not cancel an already accepted result', async () => {
  for (const acceptedFirst of [false, true]) {
    const h = harness();
    const started = deferred(), acknowledgement = deferred(), acknowledged = deferred();
    const input = new PassThrough();
    let signal, upload, finishBody;
    const page = h.browser(async () => agentObservation(), {
      async post(path, data, transferSignal, send) {
        if (!path.endsWith('/result')) return send();
        signal = transferSignal;
        const text = JSON.stringify(data), split = Math.floor(text.length / 2);
        upload = h.request(path, {
          headers: { 'content-type': 'application/json', 'x-doom-agent': 'page', origin: agentOrigin }, body: input,
        });
        input.write(text.slice(0, split));
        // Ignore AbortSignal deliberately: abort does not prove non-delivery.
        finishBody = () => { input.complete = true; input.end(text.slice(split)); };
        started.resolve();
        const response = await upload.result.promise;
        if (!response.ok) throw Error('upload rejected');
        const result = await response.json();
        await acknowledgement.promise; acknowledged.resolve();
        return result;
      },
    });
    try {
      await page.ready;
      const lease = await h.post('attach', { ownerId: randomUUID() });
      const command = { ...lease, commandId: randomUUID() };
      const cli = h.send('observe', command).result.promise;
      await started.promise;
      if (acceptedFirst) {
        finishBody();
        assert.equal((await cli).status, 200, 'Accepted before Stop: success remains valid');
        page.stop();
      } else {
        page.stop();
        assert.equal((await cli).status, 409);
        finishBody(); // Broker learns intentional revoke before the body finishes.
      }
      assert.equal(signal?.aborted, true);
      assert.equal((await upload.result.promise).status, acceptedFirst ? 200 : 409);
      acknowledgement.resolve();
      if (acceptedFirst) { await acknowledged.promise; await Promise.resolve(); }
      assert.equal(page.states.at(-1), 'stopped', 'Late acknowledgement cannot rearm');
      await assert.rejects(h.post('observe', { ...command, commandId: randomUUID() }), /agent-stopped/);
    } finally {
      input.destroy(); acknowledgement.resolve(); page.stop();
    }
  }
});
it('invalidates disconnected pages and rejects old commands after a fresh page registers', async () => {
  const h = harness();
  const page = h.browser(); await page.ready;
  const old = await h.post('attach', { ownerId: randomUUID() });
  h.broker.close();
  assert.equal(page.states.at(-1), 'stopped');
  const replacement = h.browser(); await replacement.ready;
  const lease = await h.post('attach', { ownerId: randomUUID() });
  assert.notEqual(lease.pageId, old.pageId);
  await assert.rejects(h.post('observe', { ...old, commandId: randomUUID() }), /lease-revoked/);
});
it('remembers Stop between commands without restoring settings, allowance or access to a replacement page', async () => {
  const game = fixture({ pngFor });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const h = harness();
  const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  await page.ready;
  const old = await h.post('attach', { ownerId: randomUUID() });
  const observation = (await h.post('observe', { ...old, commandId: randomUUID() })).observation;
  assert.equal(page.allowRun(), true);
  const config = game.controller.agentConfig(old.epoch, observation.sessionId, () => {});
  const scope = { sessionId: config.sessionId, runId: config.run.runId, revision: config.revision };
  page.stop();
  assert.equal(page.allowRun(), false);
  assert.equal(page.allow(), false);
  assert.equal(game.controller.agentConfig(old.epoch, scope.sessionId, () => {}).error, 'lease-revoked');
  const command = { ...old, commandId: randomUUID() };
  await assert.rejects(h.post('observe', command), /agent-stopped/);
  await assert.rejects(h.post('attach', { ownerId: randomUUID() }), /no-ready-page/);
  const replacement = h.browser(); await replacement.ready;
  assert.equal(replacement.states.at(-1), 'available');
  const next = await h.post('attach', { ownerId: randomUUID() });
  assert.notEqual(next.epoch, old.epoch);
  for (const [op, fields] of [
    ['observe', {}], ['decide', { ...scope, observationId: randomUUID() }],
    ['get-prompt', { sessionId: scope.sessionId }], ['get-config', { sessionId: scope.sessionId }],
    ['set-prompt', { ...scope, instructions: 'Cannot restore this lease.' }],
    ['set-config', { ...scope, configuration: config.configuration }],
  ]) await assert.rejects(h.post(op, { ...command, ...fields }), /agent-stopped/);
  for (const key of ['ownerId', 'epoch', 'pageId'])
    await assert.rejects(h.post('observe', { ...command, [key]: randomUUID() }), /lease-revoked/);
  assert.equal((await h.post('observe', { ...next, commandId: randomUUID() })).epoch, next.epoch);
  assert.equal(game.sdkCalls, 0); assert.equal(game.gameCalls, 0);
});
it.each(['rejected', 'timeout', 'disconnect-first'])('failed Stop reason delivery (%s) stays generic, including late delivery', async failure => {
  const h = harness();
  const capture = deferred(), delivery = deferred();
  let fresh, signal, lateSend;
  const page = h.browser(async check => { fresh = check; await capture.promise; check(); return agentObservation(); }, {
    post(path, _data, transferSignal, send) {
      if (!path.endsWith('/revoke')) return send();
      signal = transferSignal; lateSend = send;
      if (failure === 'rejected') return Promise.reject(Error('offline transport failure'));
      return delivery.promise.then(send); // Deliberately ignore AbortSignal.
    },
  });
  await page.ready;
  const lease = await h.post('attach', { ownerId: randomUUID() });
  const command = { ...lease, commandId: randomUUID() };
  const pending = h.send('observe', command).result.promise;
  await checkpoint(() => !!fresh);
  if (failure === 'timeout') vi.useFakeTimers();
  page.stop();
  if (failure === 'disconnect-first') { h.broker.close(); delivery.resolve(); }
  if (failure === 'timeout') { await vi.advanceTimersByTimeAsync(1000); vi.useRealTimers(); }
  const result = await pending;
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), { error: 'lease-revoked' });
  await assert.rejects(h.post('observe', { ...command, commandId: randomUUID() }), /lease-revoked/);
  await assert.rejects(lateSend(), /lease-revoked/, 'A late revoke cannot upgrade a generic disconnect');
  assert.equal(signal.aborted, true);
  assert.throws(fresh, /revoked/);
  capture.resolve(); delivery.resolve();
});
it('requires a validated page token and intentional reason before attributing Stop', async () => {
  const h = harness(); let registration;
  const page = h.browser(undefined, { post(path, data, _signal, send) {
    if (path.endsWith('/register')) return send().then(value => { registration = value; return value; });
    return send();
  } });
  await page.ready;
  const lease = await h.post('attach', { ownerId: randomUUID() });
  for (const data of [
    { ...registration, pageToken: randomUUID(), reason: 'user-requested' },
    { ...registration, reason: 'disconnect' },
    { ...registration, reason: 'user-requested', extra: true },
  ]) await assert.rejects(h.post('revoke', data, 'page'), /lease-revoked/);
  assert.ok((await h.post('observe', { ...lease, commandId: randomUUID() })).observation);
  page.disconnect(); // Page exit/internal failure is not a Stop Agent click.
  await assert.rejects(h.post('observe', { ...lease, commandId: randomUUID() }), /lease-revoked/);
});
it('keeps a broker deadline generic for pending and subsequent commands', async () => {
  const h = harness(); const captured = deferred(), release = deferred();
  const page = h.browser(async fresh => { captured.resolve(); await release.promise; fresh(); return agentObservation(); });
  await page.ready;
  const lease = await h.post('attach', { ownerId: randomUUID() });
  vi.useFakeTimers();
  const command = { ...lease, commandId: randomUUID() };
  const pending = h.send('observe', command).result.promise;
  await captured.promise;
  await vi.advanceTimersByTimeAsync(10000);
  vi.useRealTimers();
  const response = await pending;
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'lease-revoked' });
  assert.equal(page.states.at(-1), 'stopped');
  await assert.rejects(h.post('observe', { ...command, commandId: randomUUID() }), /lease-revoked/);
  release.resolve();
});
it.each(['stop', 'disconnect'])('preserves the broker %s error through actual CLI stderr and exit status', async cause => {
  const h = harness(); const page = h.browser(); await page.ready;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-agent-error-'));
  cleanups.push(() => rm(temporaryRoot, { recursive: true, force: true }));
  const attached = await runAgentCli(['attach'], { transport: h.transport, temporaryRoot });
  if (cause === 'stop') page.stop(); else page.disconnect();
  const response = await h.send('observe', { pageId: attached.pageId, epoch: attached.epoch,
    ownerId: attached.ownerId, commandId: randomUUID() }).result.promise;
  const body = await response.text();
  const expected = { error: cause === 'stop' ? 'agent-stopped' : 'lease-revoked' };
  assert.deepEqual(JSON.parse(body), expected);
  await assert.rejects(runAgentCli(['observe', '--lease', attached.leaseFile], { transport: h.transport }),
    new RegExp(expected.error));
  const preload = join(temporaryRoot, 'transport.mjs');
  await writeFile(preload, `globalThis.fetch = async () => new Response(${JSON.stringify(body)}, {status: 409});`);
  const child = spawnSync(process.execPath, ['--import', preload,
    fileURLToPath(new URL('../../scripts/doom-agent.mjs', import.meta.url)), 'observe', '--lease', attached.leaseFile],
    { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1); assert.equal(child.stdout, '');
  assert.deepEqual(JSON.parse(child.stderr), expected);
});
it('rejects non-allowlisted observation fields and PNG/frame corruption', () => {
  const original = agentObservation();
  for (const mutate of [
    d => { d.credential = 'offline-dummy'; },
    d => { d.telemetry.credential = 'offline-dummy'; },
    d => { d.frame.canvasSha256 = '0'.repeat(64); },
    d => { d.png = 'data:image/png;base64,c2VjcmV0'; },
    d => { d.phase = 'busy'; },
    d => { d.telemetry.x = null; },
  ]) {
    const data = structuredClone(original); mutate(data);
    assert.throws(() => parseAgentObservation(data));
  }
});

it('delivers one controller-selected decision through CLI and never replays or mints consent', async () => {
  const game = fixture({ pngFor });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const h = harness();
  const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  await page.ready;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-agent-decision-'));
  cleanups.push(() => rm(temporaryRoot, { recursive: true, force: true }));
  const attached = await runAgentCli(['attach'], { transport: h.transport, temporaryRoot });
  const observe = () => runAgentCli(['observe', '--lease', attached.leaseFile], { transport: h.transport });
  const decide = id => runAgentCli(['decide', '--lease', attached.leaseFile, '--observation', id], { transport: h.transport });
  const before = await observe();
  const denied = await decide(before.observationId);
  assert.equal(denied.outcome, 'not-admitted');
  assert.equal(denied.reason, 'no-grant');
  assert.equal(denied.pngPath, null);
  assert.equal(game.sdkCalls, 0);
  assert.equal(page.allow(), true); // Simulates the browser-only human click.
  await assert.rejects(decide(before.observationId), /duplicate-command/);
  const fresh = await observe();
  assert.equal(page.allow(), true); // Replacement observations require their own deliberate grant.
  const result = await decide(fresh.observationId);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.action, 'neutral');
  assert.equal(result.beforeObservationId, fresh.observationId);
  assert.equal(result.observation.sessionId, fresh.sessionId);
  assert.equal(result.observation.tic, 7);
  assert.deepEqual([result.requestedTics, result.reportedTics, result.verifiedTics], [6, 6, 6]);
  assert.ok(isAbsolute(result.pngPath));
  assert.ok((await readFile(result.pngPath)).length > 33);
  assert.equal(JSON.stringify(result).includes('base64'), false);
  assert.equal(JSON.stringify(result).includes('offline-not-a-credential'), false);
  assert.equal(game.sdkCalls, 1);
  assert.equal(game.gameCalls, 6);
  await assert.rejects(decide(fresh.observationId), /duplicate-command/);
  assert.equal((await decide(result.observation.observationId)).reason, 'no-grant');
  assert.equal(game.sdkCalls, 1);
  page.stop();
  assert.equal(game.view.session.controls.ready, true);
  await assert.rejects(decide(randomUUID()), /agent-stopped/);
  assert.equal(game.sdkCalls, 1);
});
it.each([
  { terminal: 'death', signals: death, reservation: 1 },
  { terminal: 'exit pending', signals: exit, reservation: 1 },
  { terminal: 'death', signals: death, reservation: 3 },
])('preserves verified $terminal through CLI stdout/PNG on reservation $reservation', async ({ signals, reservation }) => {
  const consumed = (reservation - 1) * 6 + 2;
  const game = fixture({ pngFor, at: consumed, signals });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const h = harness();
  const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  await page.ready;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-agent-terminal-'));
  cleanups.push(() => rm(temporaryRoot, { recursive: true, force: true }));
  const cli = args => runAgentCli(args, { transport: h.transport, temporaryRoot });
  const { leaseFile, ...lease } = await cli(['attach']);
  const base = ['--lease', leaseFile];
  let before = await cli(['observe', ...base]);
  assert.equal(page.allowRun(), true); // One synthetic browser grant for all reservations.
  const config = await cli(['get-config', ...base, '--session', before.sessionId]);
  const scope = { sessionId: before.sessionId, runId: config.run.runId, revision: config.revision };
  const args = () => ['decide', ...base, '--observation', before.observationId,
    '--session', scope.sessionId, '--run', scope.runId, '--revision', String(scope.revision)];
  for (let i = 1; i < reservation; i++) {
    assert.equal((await cli(args())).outcome, 'completed');
    before = await cli(['observe', ...base]);
  }
  const command = { ...lease, commandId: before.observationId, observationId: before.observationId, ...scope };
  const response = await h.send('decide', command).result.promise;
  assert.equal(response.status, 200);
  const wire = await response.json();

  // Replay the actual controller/browser/broker response through the CLI process,
  // following the existing stderr test pattern. No listener or live transport.
  const preload = join(temporaryRoot, 'transport.mjs');
  await writeFile(preload, `import assert from 'node:assert/strict';
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(++calls, 1);
  assert.equal(url, ${JSON.stringify(`${agentOrigin}${agentPath}/decide`)});
  assert.deepEqual(JSON.parse(options.body), ${JSON.stringify(command)});
  return new Response(${JSON.stringify(JSON.stringify(wire))}, {status: 200});
};`);
  const child = spawnSync(process.execPath, ['--import', preload,
    fileURLToPath(new URL('../../scripts/doom-agent.mjs', import.meta.url)), ...args()],
    { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  const result = JSON.parse(child.stdout);
  const { png, ...observation } = wire.decision.observation;
  assert.deepEqual(result, { pageId: lease.pageId, epoch: lease.epoch, commandId: command.commandId,
    pngPath: result.pngPath, ...wire.decision, observation });
  assert.equal(result.beforeObservationId, before.observationId);
  assert.equal(result.outcome, 'terminal');
  assert.equal(result.reason, null);
  assert.equal(result.sdkInvoked, true);
  assert.equal(result.completionUncertain, false);
  assert.deepEqual([result.requestedTics, result.reportedTics, result.verifiedTics], [6, 2, 2]);
  assert.equal(result.cumulativeTics, before.tic + 2);
  assert.equal(result.observation.tic, result.cumulativeTics);
  assert.equal(result.observation.sessionId, scope.sessionId);
  assert.equal(result.observation.phase, 'terminal');
  assert.equal(result.observation.telemetry.health, signals === death ? 0 : before.telemetry.health);
  assert.equal(result.observation.frame.tic, result.observation.tic);
  assert.equal(result.observation.frame.nativeSha256, result.observation.frame.canvasSha256);
  assert.equal(result.observation.previousAction, null);
  assert.equal(result.observation.facingProbe, null);
  assert.ok(isAbsolute(result.pngPath));
  assert.deepEqual(await readFile(result.pngPath), Buffer.from(agentPngBytes(png)));
  assert.equal(game.view.session.controls.ready, false);
  assert.deepEqual(game.view.session.agentAuthorization, { runId: scope.runId, active: false,
    limit: 3, reserved: reservation, sdkInvoked: reservation, remaining: 0 });
  assert.equal(game.sdkCalls, reservation);
  assert.equal(game.gameCalls, consumed);
});
it.each(['stop', 'disconnect', 'second-page'].flatMap(interruption => [false, true].map(bounded => ({ interruption, bounded }))))('$interruption revokes controller admission (bounded=$bounded) and never delivers a late paid result', async ({ interruption, bounded }) => {
  const game = fixture({ pngFor, delayedBody: true });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const h = harness();
  let controllerStopped = false;
  const controller = {
    ...game.controller,
    stopAgent() { controllerStopped = true; game.controller.stopAgent(); },
  };
  const page = h.browser(fresh => game.controller.observe(fresh), {
    controller,
    post(path, _data, _signal, send) {
      if (path.endsWith('/revoke')) assert.equal(controllerStopped, true);
      return send();
    },
    close(send) { assert.equal(controllerStopped, true); send(); },
  });
  await page.ready;
  const lease = await h.post('attach', { ownerId: randomUUID() });
  const observed = await h.post('observe', { ...lease, commandId: randomUUID() });
  assert.equal(bounded ? page.allowRun() : page.allow(), true);
  const prompt = bounded ? game.controller.agentPrompt(lease.epoch, observed.observation.sessionId, () => {}) : null;
  const scope = prompt ? { sessionId: prompt.sessionId, runId: prompt.run.runId, revision: prompt.revision } : {};
  const cli = h.send('decide', { ...lease, commandId: randomUUID(), observationId: observed.observation.observationId, ...scope });
  await game.waiting;
  if (interruption === 'stop') page.stop();
  if (interruption === 'disconnect') h.broker.close();
  if (interruption === 'second-page') {
    const rejected = await h.send('register', { pageId: randomUUID() }, 'page').result.promise;
    assert.equal(rejected.status, 409);
    await checkpoint(() => controllerStopped);
  }
  assert.equal(controllerStopped, true);
  assert.equal(game.controller.agentConfig(lease.epoch, observed.observation.sessionId, () => {}).error, 'lease-revoked');
  assert.equal(game.view.session.agentBusy, true);
  assert.equal(game.view.session.controls.ready, false);
  const stopped = await cli.result.promise;
  assert.equal(stopped.status, 409);
  assert.deepEqual(await stopped.json(), { error: interruption === 'stop' ? 'agent-stopped' : interruption === 'second-page' ? 'multiple-pages' : 'lease-revoked' });
  await assert.rejects(h.post('decide', { ...lease, commandId: randomUUID(), observationId: randomUUID(), ...scope }),
    interruption === 'stop' ? /agent-stopped/ : /lease-revoked/);
  assert.equal(game.sdkCalls, 1, 'Revocation result does not wait for the held SDK reader');
  assert.equal(game.sdkCalls, 1);
  game.releaseBody();
  await checkpoint(() => !game.view.session.agentBusy);
  assert.equal(game.gameCalls, 0);
  assert.equal(game.view.session.controls.ready, true);
  if (bounded) assert.equal(game.controller.allowAgentRun(lease.epoch), false);
});

it('CLI reads and CAS-writes only effective instructions, then uses three individually verified bounded decisions', async () => {
  const game = fixture({ pngFor });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const h = harness();
  const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  await page.ready;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-agent-run-'));
  cleanups.push(() => rm(temporaryRoot, { recursive: true, force: true }));
  const cli = args => runAgentCli(args, { transport: h.transport, temporaryRoot });
  const attached = await cli(['attach']);
  const base = ['--lease', attached.leaseFile];
  const observe = () => cli(['observe', ...base]);
  let observation = await observe();
  const get = () => cli(['get-prompt', ...base, '--session', observation.sessionId]);
  assert.equal((await get()).run, null, 'Read never mints authorization');
  assert.equal(page.allowRun(), true);
  let prompt = await get();
  const file = join(temporaryRoot, 'instructions.txt');
  const instructions = 'Reach the visible opening; previous route may have stalled. Choose the action yourself. {{tics}} tics.';
  await writeFile(file, instructions);
  prompt = await cli(['set-prompt', ...base, '--session', prompt.sessionId, '--run', prompt.run.runId,
    '--revision', String(prompt.revision), '--instructions-file', file]);
  assert.equal(prompt.instructions, instructions);
  assert.equal(prompt.revision, 1);
  assert.equal(prompt.run.remaining, 3);
  const decide = current => cli(['decide', ...base, '--observation', current.observationId,
    '--session', prompt.sessionId, '--run', prompt.run.runId, '--revision', String(prompt.revision)]);
  assert.equal((await decide(observation)).reason, 'stale-observation');
  assert.equal(game.sdkCalls, 0);
  for (let i = 1; i <= 3; i++) {
    observation = await observe();
    const result = await decide(observation);
    assert.equal(result.outcome, 'completed');
    assert.equal(result.observation.sessionId, prompt.sessionId);
    assert.deepEqual(result.observation.previousAction, { action: 'neutral', tics: 6, endTic: i * 6 + 1,
      text: 'Previous verified action: neutral (6 tics).' });
    assert.ok((await readFile(result.pngPath)).length > 33);
    await assert.rejects(decide(observation), /duplicate-command/);
    prompt = await get();
    assert.equal(prompt.run.remaining, 3 - i);
    assert.equal(prompt.run.sdkInvoked, i);
    assert.equal(JSON.stringify(prompt).includes('offline-not-a-credential'), false);
  }
  observation = await observe();
  assert.equal((await decide(observation)).reason, 'no-grant');
  assert.equal(page.allowRun(), false);
  assert.equal(game.sdkCalls, 3);
  assert.equal(game.inputs[0].questions[0].instructions, instructions.replace('{{tics}}', '6'));
  page.stop();
  await assert.rejects(get(), /agent-stopped/);
});

it('strict prompt and bounded command shapes reject extra fields and fence foreign owner/epoch/session/run identities', async () => {
  const game = fixture({ pngFor });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const h = harness();
  const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  await page.ready;
  const lease = await h.post('attach', { ownerId: randomUUID() });
  const observed = await h.post('observe', { ...lease, commandId: randomUUID() });
  page.allowRun();
  const sessionId = observed.observation.sessionId;
  const read = () => h.post('get-prompt', { ...lease, commandId: randomUUID(), sessionId });
  const state = (await read()).prompt;
  const command = { ...lease, commandId: randomUUID(), sessionId, runId: state.run.runId, revision: state.revision, instructions: 'Explore the opening.' };
  for (const invalid of [{ ...command, key: 'offline-dummy' }, { ...command, revision: -1 }, { ...command, instructions: ' ' }, { ...command, instructions: 'x'.repeat(16001) }]) {
    assert.equal(validAgentCommand('set-prompt', invalid), false);
    await assert.rejects(h.post('set-prompt', invalid), /invalid-request/);
  }
  for (const key of ['ownerId', 'epoch'])
    await assert.rejects(h.post('set-prompt', { ...command, [key]: randomUUID() }), /lease-revoked/);
  assert.throws(() => parseAgentPromptResult({ ...state, credential: 'offline-dummy' }));
  assert.throws(() => parseAgentPromptResult({ ...state, run: { ...state.run, sdkInvoked: 4 } }));
  assert.equal((await h.post('set-prompt', { ...command, runId: randomUUID() })).prompt.error, 'run-unavailable');
  await assert.rejects(h.post('set-prompt', { ...command, runId: randomUUID() }), /duplicate-command/);
  assert.deepEqual((await read()).prompt, state, 'Wrong scope does not mutate the live run');
  assert.equal((await h.post('get-prompt', { ...lease, commandId: randomUUID(), sessionId: randomUUID() })).prompt.error, 'session-mismatch');
  assert.equal(game.sdkCalls, 0);
  assert.equal(game.ports.readDecisionConfiguration().instructionTemplate, state.instructions);
});
it('rejects credentials and speculative success in the decision response allowlist', () => {
  const base = {
    outcome: 'stopped', reason: null, beforeObservationId: randomUUID(), sdkInvoked: true,
    action: null, requestedTics: 6, reportedTics: null, verifiedTics: null, cumulativeTics: null,
    completionUncertain: false, requestIdentity: null, responseMetadata: null, observation: null,
  };
  parseAgentDecisionResult(base);
  for (const mutate of [
    d => { d.credential = 'offline-dummy'; },
    d => { d.outcome = 'completed'; },
    d => { d.requestIdentity = { provider: 'OpenRouter', requestedModel: 'model', credential: 'offline-dummy' }; },
    d => { d.responseMetadata = { reportedModel: 'model', usage: { input: 1, output: 1, total: 2, credential: 'offline-dummy' } }; },
  ]) {
    const result = structuredClone(base); mutate(result);
    assert.throws(() => parseAgentDecisionResult(result));
  }
});

it('shows authorization revoked when the actual controller replaces its observation or configuration', async () => {
  const game = fixture({ pngFor });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const h = harness();
  const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  game.ports.agentGrantRevoked = () => page.authorizationRevoked();
  await page.ready;
  const lease = await h.post('attach', { ownerId: randomUUID() });
  assert.equal(page.allow(), false, 'Attach alone is insufficient');
  await h.post('observe', { ...lease, commandId: randomUUID() });
  assert.equal(page.allow(), true);
  assert.equal(page.states.at(-1), 'authorized');
  const replacement = await h.post('observe', { ...lease, commandId: randomUUID() });
  assert.equal(page.states.at(-1), 'attached');
  const denied = await h.post('decide', { ...lease, commandId: randomUUID(), observationId: replacement.observation.observationId });
  assert.equal(denied.decision.reason, 'no-grant');
  assert.equal(denied.decision.sdkInvoked, false);
  assert.equal(page.allow(), true);
  game.controller.configure(() => { game.browserInputs.tics = 12; });
  assert.equal(page.states.at(-1), 'attached');
  game.controller.configure(() => { game.browserInputs.tics = 6; });
  assert.equal(page.states.at(-1), 'attached');
  assert.equal(page.allow(), false, 'Restoring configuration cannot revive the old observation');
  assert.equal(game.sdkCalls, 0);
  assert.equal(game.gameCalls, 0);
});

it('round-trips config CAS through CLI/broker/browser and shares ephemeral instructions/revision with prompt commands', async () => {
  const game = fixture({ pngFor }); cleanups.push(() => game.dispose()); await game.prepare();
  const savedHuman = game.ports.readDecisionConfiguration();
  const h = harness(); const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  await page.ready;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-agent-config-'));
  cleanups.push(() => rm(temporaryRoot, { recursive: true, force: true }));
  const cli = args => runAgentCli(args, { transport: h.transport, temporaryRoot });
  const attached = await cli(['attach']); const base = ['--lease', attached.leaseFile];
  let observation = await cli(['observe', ...base]);
  const get = () => cli(['get-config', ...base, '--session', observation.sessionId]);
  const before = await get();
  for (const flag of ['includeReadyWeapon', 'includeAmmo', 'includeHealth', 'includeFacingProbe', 'includePreviousAction'])
    assert.equal(before.configuration[flag], true);
  assert.equal(before.run, null); assert.equal(game.sdkCalls, 0);
  assert.equal(page.allowRun(), true);
  const first = await get();
  const configFile = join(temporaryRoot, 'configuration.json');
  const configuration = { ...first.configuration, includeHealth: false, includeAmmo: false, instructionTemplate: 'Ephemeral route for {{tics}} tics.' };
  await writeFile(configFile, JSON.stringify(configuration));
  let current = await cli(['set-config', ...base, '--session', first.sessionId, '--run', first.run.runId,
    '--revision', String(first.revision), '--config-file', configFile]);
  assert.deepEqual(current.configuration, configuration);
  assert.deepEqual(current.run, first.run); assert.equal(current.revision, first.revision + 1);
  assert.equal(game.ports.readDecisionConfiguration(), savedHuman);
  const prompt = await cli(['get-prompt', ...base, '--session', first.sessionId]);
  assert.equal(prompt.revision, current.revision); assert.equal(prompt.instructions, configuration.instructionTemplate);
  const textFile = join(temporaryRoot, 'instructions.txt'); await writeFile(textFile, 'Ephemeral text edit {{tics}}.');
  const changedPrompt = await cli(['set-prompt', ...base, '--session', first.sessionId, '--run', first.run.runId,
    '--revision', String(current.revision), '--instructions-file', textFile]);
  current = await get(); assert.equal(current.revision, changedPrompt.revision);
  assert.deepEqual(current.configuration, { ...configuration, instructionTemplate: 'Ephemeral text edit {{tics}}.' });
  const decide = value => cli(['decide', ...base, '--observation', value.observationId, '--session', first.sessionId,
    '--run', first.run.runId, '--revision', String(current.revision)]);
  assert.equal((await decide(observation)).reason, 'stale-observation');
  for (let i = 0; i < 2; i++) {
    observation = await cli(['observe', ...base]);
    assert.equal((await decide(observation)).outcome, 'completed');
  }
  assert.equal((await get()).run.remaining, 1);
  assert.equal(game.inputs[0].questions[0].instructions, 'Ephemeral text edit 6.');
  assert.doesNotMatch(game.inputs[0].input[0].content[0].text, /Health:|Ammo:/);
  assert.match(game.inputs[0].input[0].content[0].text, /Ready weapon:/);
  assert.equal(game.ports.readDecisionConfiguration(), savedHuman);
  page.stop();
  assert.equal(game.controller.agentConfig(attached.epoch, first.sessionId, () => {}).error, 'lease-revoked');
});

it('strict config command/result schemas reject missing, extra and nonboolean fields without modifying authorization', async () => {
  const game = fixture({ pngFor }); cleanups.push(() => game.dispose()); await game.prepare();
  const h = harness(); const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  await page.ready;
  const lease = await h.post('attach', { ownerId: randomUUID() });
  const observed = await h.post('observe', { ...lease, commandId: randomUUID() }); page.allowRun();
  const sessionId = observed.observation.sessionId;
  const get = async () => (await h.post('get-config', { ...lease, commandId: randomUUID(), sessionId })).config;
  const before = await get(); parseAgentConfigResult(before);
  const command = { ...lease, commandId: randomUUID(), sessionId, runId: before.run.runId,
    revision: before.revision, configuration: before.configuration };
  for (const mutate of [
    d => { delete d.configuration.includeHealth; }, d => { d.configuration.includeAmmo = 1; },
    d => { d.configuration.includeFacingProbe = null; }, d => { d.configuration.includePreviousAction = 'false'; },
    d => { d.configuration.extra = false; }, d => { d.configuration.instructionTemplate = ''; },
    d => { d.extra = false; }, d => { delete d.revision; }, d => { d.revision = -1; },
  ]) {
    const invalid = structuredClone(command); mutate(invalid);
    assert.equal(validAgentCommand('set-config', invalid), false);
    await assert.rejects(h.post('set-config', invalid), /invalid-request/);
    assert.deepEqual(await get(), before);
  }
  for (const [key, value, error] of [
    ['revision', before.revision + 1, 'revision-conflict'], ['sessionId', randomUUID(), 'session-mismatch'],
    ['runId', randomUUID(), 'run-unavailable'],
  ]) {
    assert.equal((await h.post('set-config', { ...command, commandId: randomUUID(), [key]: value })).config.error, error);
    assert.deepEqual(await get(), before);
  }
  for (const key of ['ownerId', 'epoch'])
    await assert.rejects(h.post('set-config', { ...command, [key]: randomUUID() }), /lease-revoked/);
  assert.throws(() => parseAgentConfigResult({ ...before, extra: false }));
  assert.throws(() => parseAgentConfigResult({ ...before, configuration: { ...before.configuration, extra: false } }));
  assert.throws(() => parseAgentConfigResult({ ...before, run: { ...before.run, remaining: 4 } }));
  await h.post('set-config', command);
  await assert.rejects(h.post('set-config', command), /duplicate-command/);
  assert.equal((await get()).revision, before.revision + 1);
  assert.deepEqual((await get()).run, before.run);
  assert.equal(game.sdkCalls, 0);
});
