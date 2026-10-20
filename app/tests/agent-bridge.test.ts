// Entire browser → Vite middleware → CLI exchange uses in-memory HTTP fakes.
// No listener, browser, game asset, WASM or provider request.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, it, vi } from 'vitest';
import config from '../vite.config.js';
import { createAgentBridge } from '../agent-bridge.mjs';
import { startAgentObservationBridge } from '../src/agent-browser.ts';
import { agentOrigin, agentPath, agentPngBytes, parseAgentObservation, parseAgentDecisionResult } from '../src/agent-observation.ts';
import { runAgentCli } from '../../scripts/doom-agent.mjs';
import { agentObservation, pngFor } from './fixtures/agent.ts';
import { deferred, checkpoint, fixture } from './fixtures/session.ts';

const cleanups = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()(); vi.restoreAllMocks(); });
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
      stopAgent: () => network.controller?.stopAgent(),
      decide: (epoch, id, fresh) => network.controller.agentNext(epoch, id, fresh),
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
  assert.equal(result.sessionId, observation.sessionId); assert.equal(result.tic, 1);
  assert.deepEqual(await readFile(result.pngPath), Buffer.from(agentPngBytes(observation.png)));
  assert.equal(JSON.stringify(result).includes('base64'), false);
  assert.deepEqual((await readdir(join(attached.leaseFile, '..'))).sort(), [`${result.commandId}.png`, 'lease.json'].sort());
  await assert.rejects(h.post('attach', { ownerId: randomUUID() }), /owner-already-attached/);
  page.stop();
  await assert.rejects(runAgentCli(['observe', '--lease', attached.leaseFile], { transport: h.transport }), /lease-revoked/);
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
  let fresh; let captures = 0;
  const posts = [];
  const handle = startAgentObservationBridge({
    pageId, events: () => events, state: () => {},
    async post(path, data) {
      posts.push(path);
      if (path.endsWith('/register')) return { pageId, pageToken };
      if (path.endsWith('/revoke')) return acknowledgement.promise;
      assert.fail('No result after local Stop');
    },
    async observe(check) { captures++; fresh = check; await gate.promise; check(); return agentObservation(); },
  });
  await handle.ready;
  const send = data => events.onmessage({ data: JSON.stringify(data) });
  send({ type: 'attached', pageId, epoch, ownerId });
  send({ type: 'observe', pageId, epoch, ownerId, commandId: randomUUID() });
  handle.stop();
  assert.throws(fresh, /revoked/);
  send({ type: 'observe', pageId, epoch, ownerId, commandId: randomUUID() });
  assert.equal(captures, 1); assert.equal(events.close.mock.calls.length, 1);
  gate.resolve(); acknowledgement.resolve({ stopped: true });
  await checkpoint(() => posts.some(path => path.endsWith('/revoke')));
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
      closeStream(); revokeDelivery.resolve();
      assert.equal((await cli.result.promise).status, 409);
      await assert.rejects(h.post('observe', { ...lease, commandId: randomUUID() }), /lease-revoked/);
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
        page.stop(); // Broker learns stream closure before the body finishes.
        finishBody();
        assert.equal((await cli).status, 409);
      }
      assert.equal(signal?.aborted, true);
      assert.equal((await upload.result.promise).status, acceptedFirst ? 200 : 409);
      acknowledgement.resolve();
      if (acceptedFirst) { await acknowledged.promise; await Promise.resolve(); }
      assert.equal(page.states.at(-1), 'stopped', 'Late acknowledgement cannot rearm');
      await assert.rejects(h.post('observe', { ...command, commandId: randomUUID() }), /lease-revoked/);
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
  await assert.rejects(decide(randomUUID()), /lease-revoked/);
  assert.equal(game.sdkCalls, 1);
});
it.each(['stop', 'disconnect', 'second-page'])('%s revokes controller admission and never delivers a late paid result', async interruption => {
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
  assert.equal(page.allow(), true);
  const cli = h.send('decide', { ...lease, commandId: randomUUID(), observationId: observed.observation.observationId });
  await game.waiting;
  if (interruption === 'stop') page.stop();
  if (interruption === 'disconnect') h.broker.close();
  if (interruption === 'second-page') {
    const rejected = await h.send('register', { pageId: randomUUID() }, 'page').result.promise;
    assert.equal(rejected.status, 409);
    await checkpoint(() => controllerStopped);
  }
  assert.equal(controllerStopped, true);
  assert.equal(game.view.session.agentBusy, true);
  assert.equal(game.view.session.controls.ready, false);
  assert.equal((await cli.result.promise).status, 409);
  assert.equal(game.sdkCalls, 1);
  game.releaseBody();
  await checkpoint(() => !game.view.session.agentBusy);
  assert.equal(game.gameCalls, 0);
  assert.equal(game.view.session.controls.ready, true);
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
