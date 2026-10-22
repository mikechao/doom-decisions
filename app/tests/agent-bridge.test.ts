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
import { createAgentBridge, createAgentAllowance, processAgentAllowance, agentBridgePlugin } from '../agent-bridge.mjs';
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
function harness(allowance) {
  const broker = createAgentBridge(allowance);
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
    let epoch;
    const handle = startAgentObservationBridge({
      pageId: randomUUID(), observe,
      attach: (id, budgetMode) => { epoch = id; network.controller?.attachAgent(id, budgetMode); },
      startRun: (epoch, id, scope, fresh) => network.controller.startAgentRun(epoch, id, scope, fresh),
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
    return { ...handle, states,
      // Legacy controller coverage only: these are NOT browser bridge entry points.
      legacyGrant: () => network.controller?.allowAgent(epoch) ?? false,
      legacyRun: () => network.controller?.allowAgentRun(epoch) ?? false,
    };
  };
  return { broker, request, transport, send, post, browser };
}

// Existing in-memory protocol and fake SDK, with a configured process allowance.
async function budgetSession(options = {}, allowance = createAgentAllowance('3'), network = {}) {
  const game = fixture({ pngFor, ...options });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const h = harness(allowance);
  const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller, ...network });
  await page.ready;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-agent-budget-'));
  cleanups.push(() => rm(temporaryRoot, { recursive: true, force: true }));
  const cli = args => runAgentCli(args, { transport: h.transport, temporaryRoot });
  const { leaseFile, ...lease } = await cli(['attach']);
  const base = ['--lease', leaseFile];
  const observe = () => cli(['observe', ...base]);
  const observation = await observe();
  const get = () => cli(['get-config', ...base, '--session', observation.sessionId]);
  const command = { ...lease, commandId: randomUUID(), observationId: observation.observationId, sessionId: observation.sessionId, revision: 0 };
  const start = () => cli(['start-run', ...base, '--observation', observation.observationId, '--session', observation.sessionId, '--revision', '0']);
  const decide = (current, config) => cli(['decide', ...base, '--observation', current.observationId,
    '--session', config.sessionId, '--run', config.run.runId, '--revision', String(config.revision)]);
  return { game, h, page, allowance, cli, base, lease, observe, observation, get, command, start, decide };
}

it('snapshots only the configured positive safe-integer cap, including absence and errors, once per process/root', async () => {
  for (const value of [undefined, '', '  ']) assert.equal(createAgentAllowance(value).limit, null);
  for (const value of ['1', '3', '30', '9007199254740991']) assert.equal(createAgentAllowance(value).limit, Number(value));
  for (const value of ['0', '-1', '1.5', '9007199254740992', 'no-budget', '1e2', '+3', 'Infinity']) {
    assert.throws(() => createAgentAllowance(value), error => !error.message.includes(value) && /AGENT_DECISION_BUDGET/.test(error.message));
  }
  for (const value of [undefined, '3', 'invalid']) {
    const root = join(tmpdir(), randomUUID()); let reads = 0;
    const load = () => { reads++; return value; };
    if (value === 'invalid') {
      assert.throws(() => processAgentAllowance(root, load));
      assert.throws(() => processAgentAllowance(root, () => { assert.fail('No reread after invalid snapshot'); }));
    } else {
      const state = processAgentAllowance(root, load);
      assert.equal(processAgentAllowance(root, () => { assert.fail('No reread after snapshot'); }), state);
    }
    assert.equal(reads, 1);
  }
});

it('keeps the process allowance closed across plugin recreation and internal server lifecycle reinitialization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'doom-agent-config-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '.env.agent.local'), 'AGENT_DECISION_BUDGET=3\nAGENT_MODEL=jev\n');
  const resolved = { root, server: { host: '127.0.0.1', port: 5174, strictPort: true } };
  const first = agentBridgePlugin(); first.configResolved(resolved);
  const state = processAgentAllowance(root); assert.equal(state.limit, 3);
  const httpServer = new EventEmitter();
  first.configureServer({ middlewares: { use() {} }, httpServer });
  httpServer.emit('close'); assert.equal(state.status, 'closed');
  await writeFile(join(root, '.env.agent.local'), 'AGENT_DECISION_BUDGET=30\n');
  vi.resetModules(); // Vite can re-evaluate the plugin module, not just its factory.
  const { agentBridgePlugin: reloadedPlugin } = await import('../agent-bridge.mjs');
  const next = reloadedPlugin(); next.configResolved(resolved);
  next.configureServer({ middlewares: { use() {} }, httpServer: new EventEmitter() });
  assert.equal(processAgentAllowance(root), state);
  assert.equal(state.limit, 3); assert.equal(state.status, 'closed');
  const script = `import {processAgentAllowance} from ${JSON.stringify(new URL('../agent-bridge.mjs', import.meta.url).href)};
const state = processAgentAllowance(${JSON.stringify(root)});
console.log(JSON.stringify({limit: state.limit, status: state.status}));`;
  const restarted = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), { limit: 30, status: 'unclaimed' });
});

it('CLI start-run claims three controller reservations without Allow and cannot replenish or choose a limit', async () => {
  const s = await budgetSession();
  assert.equal(s.page.allow, undefined); assert.equal(s.page.allowRun, undefined);
  assert.equal(s.page.states.at(-1), 'attached');
  assert.equal((await s.get()).run, null); assert.equal(s.allowance.status, 'unclaimed');
  assert.equal(s.page.legacyGrant(), false); assert.equal(s.page.legacyRun(), false);
  assert.equal(s.game.controller.allowAgent(s.lease.epoch), false);
  assert.equal(s.game.controller.allowAgentRun(s.lease.epoch), false);
  await assert.rejects(s.cli(['decide', ...s.base, '--observation', s.observation.observationId]), /budget-closed/);
  for (const extra of [{ limit: 30 }, { runId: randomUUID() }])
    await assert.rejects(s.h.post('start-run', { ...s.command, ...extra }), /invalid-request/);
  await assert.rejects(s.cli(['start-run', ...s.base, '--observation', s.observation.observationId, '--session', s.observation.sessionId, '--revision', '0', '--limit', '30']), /Usage:/);
  assert.equal(s.allowance.status, 'unclaimed');
  let config = await s.start();
  assert.equal(config.run.limit, 3); assert.equal(config.run.reserved, 0); assert.equal(s.game.sdkCalls, 0);
  await assert.rejects(s.start(), /budget-closed/);
  const revision = await s.h.post('set-config', { ...s.lease, commandId: randomUUID(), sessionId: config.sessionId,
    runId: config.run.runId, revision: config.revision, configuration: { ...config.configuration, includeAmmo: false } });
  assert.deepEqual(revision.config.run, config.run);
  config = revision.config;
  await assert.rejects(s.h.post('set-config', { ...s.lease, commandId: randomUUID(), sessionId: config.sessionId,
    runId: config.run.runId, revision: config.revision, configuration: { ...config.configuration, limit: 30 } }), /invalid-request/);
  for (let i = 1; i <= 3; i++) {
    const result = await s.decide(await s.observe(), config);
    assert.equal(result.outcome, 'completed');
    config = await s.get();
    assert.equal(config.run.reserved, i); assert.equal(config.run.sdkInvoked, i); assert.equal(config.run.remaining, 3 - i);
  }
  assert.equal((await s.decide(await s.observe(), config)).reason, 'no-grant');
  assert.equal(s.game.sdkCalls, 3);
  assert.equal(s.page.legacyRun(), false);
  await assert.rejects(s.start(), /budget-closed/);
});

it('executes the skill start template once against fresh CLI observation/configuration without browser grants', async () => {
  const s = await budgetSession();
  const initial = await s.get();
  const skill = await readFile(new URL('../../.agents/skills/doom-decisions/SKILL.md', import.meta.url), 'utf8');
  const starts = [...skill.matchAll(/`(node scripts\/doom-agent\.mjs start-run [^`]+)`/g)].map(match => match[1]);
  assert.equal(starts.length, 1, 'One executable start template; no alternate claim path');
  const values = { ABSOLUTE_LEASE_FILE: s.base[1], OBSERVATION_ID: s.observation.observationId,
    SESSION_ID: initial.sessionId, REVISION: String(initial.revision) };
  const args = starts[0].split(/\s+/).slice(2).map(token => values[token] ?? token);
  assert.equal(s.page.allow, undefined); assert.equal(s.page.allowRun, undefined);
  const started = await s.cli(args);
  assert.equal(started.run.active, true); assert.equal(started.run.reserved, 0);
  assert.equal(s.game.sdkCalls, 0);
  assert.equal((await s.decide(await s.observe(), started)).outcome, 'completed');
  await assert.rejects(s.cli(args), /budget-closed/);
});

it('freezes a configured cap above three across four SDK invocations', async () => {
  const s = await budgetSession({}, createAgentAllowance('30'));
  const config = await s.start();
  assert.equal(config.run.limit, 30); assert.equal(config.run.remaining, 30);
  for (let i = 1; i <= 4; i++) assert.equal((await s.decide(await s.observe(), config)).outcome, 'completed');
  assert.equal((await s.get()).run.remaining, 26); assert.equal(s.game.sdkCalls, 4);
});

it.each(['revision', 'observation', 'session', 'editor'])('burns a claim rejected by controller preflight (%s)', async reason => {
  const s = await budgetSession();
  const command = { ...s.command };
  if (reason === 'revision') command.revision++;
  if (reason === 'observation') command.observationId = randomUUID();
  if (reason === 'session') command.sessionId = randomUUID();
  if (reason === 'editor') s.game.browserInputs.promptEditorOpen = true;
  const result = await s.h.post('start-run', command);
  assert.ok(result.config.error); assert.equal(s.allowance.status, 'closed');
  assert.equal(s.page.states.at(-1), 'run-unavailable');
  assert.equal(s.game.sdkCalls, 0); assert.equal((await s.get()).run, null);
  await assert.rejects(s.start(), /budget-closed/);
  assert.equal(s.page.legacyGrant(), false);
});

it('shows an unavailable run without a budget and exposes no browser grant fallback', async () => {
  const s = await budgetSession({}, createAgentAllowance());
  assert.equal(s.page.states.at(-1), 'run-unavailable');
  assert.equal(s.page.allow, undefined); assert.equal(s.page.allowRun, undefined);
  await assert.rejects(s.start(), /budget-unavailable/);
  assert.equal((await s.get()).run, null); assert.equal(s.game.sdkCalls, 0);
  assert.equal(s.page.legacyRun(), true, 'Lower-level legacy helper remains test-only');
});

it('issues once for concurrent start commands and closes an ambiguously delivered claim on disconnect', async () => {
  const s = await budgetSession();
  const pending = s.h.send('start-run', s.command);
  const concurrent = s.h.send('start-run', { ...s.command, commandId: randomUUID() });
  assert.equal((await (await concurrent.result.promise).json()).error, 'budget-closed');
  assert.equal((await (await pending.result.promise).json()).config.run.limit, 3);
  s.page.disconnect();
  assert.equal(s.allowance.status, 'closed');
  await assert.rejects(s.get(), /lease-revoked/);
  const replacement = harness(s.allowance);
  const page = replacement.browser(fresh => s.game.controller.observe(fresh), { controller: s.game.controller });
  await page.ready;
  assert.equal(page.states.at(-1), 'run-unavailable');
  const lease = await replacement.post('attach', { ownerId: randomUUID() });
  const observed = (await replacement.post('observe', { ...lease, commandId: randomUUID() })).observation;
  assert.equal(page.legacyGrant(), false); assert.equal(page.legacyRun(), false);
  await assert.rejects(replacement.post('start-run', { ...lease, commandId: randomUUID(), observationId: observed.observationId, sessionId: observed.sessionId, revision: 0 }), /budget-closed/);
  assert.equal(s.game.sdkCalls, 0);
});

it.each(['disconnect', 'deadline'])('burns issuance when the start result is lost (%s)', async reason => {
  const sent = deferred(), release = deferred();
  const s = await budgetSession({}, createAgentAllowance('3'), {
    async post(path, data, _signal, send) {
      if (path.endsWith('/result') && data.config?.run) { sent.resolve(); await release.promise; }
      return send();
    },
  });
  if (reason === 'deadline') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const pending = s.h.send('start-run', s.command);
  await sent.promise;
  if (reason === 'deadline') {
    await vi.advanceTimersByTimeAsync(10000);
    assert.equal((await (await pending.result.promise).json()).error, 'claim-failed');
    vi.useRealTimers();
  } else { pending.destroyed = true; pending.emit('close'); }
  assert.equal(s.allowance.status, 'closed');
  release.resolve();
  await checkpoint(() => s.page.states.at(-1) === 'stopped');
  assert.equal(s.game.sdkCalls, 0);
  const next = harness(s.allowance);
  const page = next.browser(); await page.ready;
  const lease = await next.post('attach', { ownerId: randomUUID() });
  await assert.rejects(next.post('start-run', { ...s.command, ...lease, commandId: randomUUID() }), /budget-closed/);
  assert.equal(page.legacyRun(), false);
});

it.each([{ key: '' }, { throwOnCreate: true }])('does not refund or restart a failed configured reservation (%j)', async options => {
  const s = await budgetSession(options);
  const config = await s.start();
  assert.notEqual((await s.decide(s.observation, config)).outcome, 'completed');
  const ended = await s.get();
  assert.equal(ended.run.reserved, 1); assert.equal(ended.run.remaining, 0); assert.equal(ended.run.active, false);
  assert.equal(ended.run.sdkInvoked, options.key === '' ? 0 : 1);
  await assert.rejects(s.start(), /budget-closed/);
});

it('configured Stop during SDK read preserves reader ownership and old-lease Stop attribution', async () => {
  const s = await budgetSession({ delayedHeaders: true });
  const config = await s.start();
  const pending = s.decide(s.observation, config).catch(error => error.message);
  await checkpoint(() => s.game.sdkCalls === 1);
  s.page.stop();
  assert.equal(s.game.view.session.controls.ready, false);
  await assert.rejects(s.get(), /agent-stopped/);
  s.game.releaseHeaders(); s.game.releaseBody();
  await pending;
  await checkpoint(() => s.game.view.session.controls.ready);
  assert.equal(s.game.sdkCalls, 1); assert.equal(s.allowance.status, 'closed');
});

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
  plugin.configResolved({ root: join(tmpdir(), randomUUID()), server: raw.server });
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
      if (path.endsWith('/register')) return { pageId, pageToken, budgetAvailable: true };
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
  send({ type: 'attached', pageId, epoch, ownerId, budgetMode: false });
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
  assert.equal(page.legacyRun(), true);
  const config = game.controller.agentConfig(old.epoch, observation.sessionId, () => {});
  const scope = { sessionId: config.sessionId, runId: config.run.runId, revision: config.revision };
  page.stop();
  assert.equal(page.legacyRun(), false);
  assert.equal(page.legacyGrant(), false);
  assert.equal(game.controller.agentConfig(old.epoch, scope.sessionId, () => {}).error, 'lease-revoked');
  const command = { ...old, commandId: randomUUID() };
  await assert.rejects(h.post('observe', command), /agent-stopped/);
  await assert.rejects(h.post('attach', { ownerId: randomUUID() }), /no-ready-page/);
  const replacement = h.browser(); await replacement.ready;
  assert.equal(replacement.states.at(-1), 'run-unavailable');
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
  assert.equal(page.legacyGrant(), true); // Legacy controller-only compatibility coverage.
  await assert.rejects(decide(before.observationId), /duplicate-command/);
  const fresh = await observe();
  assert.equal(page.legacyGrant(), true); // A legacy grant is tied to its exact observation.
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
  { terminal: 'death', signals: death, reservation: 3, budget: '3' },
  { terminal: 'exit pending', signals: exit, reservation: 3, budget: '3' },
])('preserves verified $terminal through CLI stdout/PNG on reservation $reservation (budget $budget)', async ({ signals, reservation, budget }) => {
  const consumed = (reservation - 1) * 6 + 2;
  const game = fixture({ pngFor, at: consumed, signals });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const h = harness(createAgentAllowance(budget));
  const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  await page.ready;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-agent-terminal-'));
  cleanups.push(() => rm(temporaryRoot, { recursive: true, force: true }));
  const cli = args => runAgentCli(args, { transport: h.transport, temporaryRoot });
  const { leaseFile, ...lease } = await cli(['attach']);
  const base = ['--lease', leaseFile];
  let before = await cli(['observe', ...base]);
  if (budget) await cli(['start-run', ...base, '--observation', before.observationId, '--session', before.sessionId, '--revision', '0']);
  else assert.equal(page.legacyRun(), true); // Legacy prototype grant only when unconfigured.
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
it.each(['stop', 'disconnect', 'second-page'].flatMap(interruption => ['single', 'legacy', 'configured'].map(mode => ({ interruption, bounded: mode !== 'single', budget: mode === 'configured' ? '3' : undefined }))))('$interruption revokes controller admission (bounded=$bounded, budget=$budget) and never delivers a late paid result', async ({ interruption, bounded, budget }) => {
  const game = fixture({ pngFor, delayedBody: true });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const allowance = createAgentAllowance(budget);
  const h = harness(allowance);
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
  if (budget) await h.post('start-run', { ...lease, commandId: randomUUID(), observationId: observed.observation.observationId, sessionId: observed.observation.sessionId, revision: 0 });
  else assert.equal(bounded ? page.legacyRun() : page.legacyGrant(), true);
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
  if (budget) assert.equal(allowance.status, 'closed');
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
  assert.equal(page.legacyRun(), true);
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
  assert.equal(page.legacyRun(), false);
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
  page.legacyRun();
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

it('keeps legacy controller grants fenced without browser grant entry points', async () => {
  const game = fixture({ pngFor });
  cleanups.push(() => game.dispose());
  await game.prepare();
  const h = harness();
  const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  await page.ready;
  const lease = await h.post('attach', { ownerId: randomUUID() });
  assert.equal(page.legacyGrant(), false, 'Attach alone is insufficient');
  await h.post('observe', { ...lease, commandId: randomUUID() });
  assert.equal(page.legacyGrant(), true);
  assert.equal(page.allow, undefined);
  assert.equal(page.allowRun, undefined);
  assert.equal(page.authorizationRevoked, undefined);
  const replacement = await h.post('observe', { ...lease, commandId: randomUUID() });
  const denied = await h.post('decide', { ...lease, commandId: randomUUID(), observationId: replacement.observation.observationId });
  assert.equal(denied.decision.reason, 'no-grant');
  assert.equal(denied.decision.sdkInvoked, false);
  assert.equal(page.legacyGrant(), true);
  game.controller.configure(() => { game.browserInputs.tics = 12; });
  game.controller.configure(() => { game.browserInputs.tics = 6; });
  assert.equal(page.legacyGrant(), false, 'Restoring configuration cannot revive the old observation');
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
  assert.equal(page.legacyRun(), true);
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
  const observed = await h.post('observe', { ...lease, commandId: randomUUID() }); page.legacyRun();
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
