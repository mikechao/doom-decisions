// Entire browser → Vite middleware → CLI exchange uses in-memory HTTP fakes.
// No listener, browser, game asset, WASM or provider request.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, it, vi } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createAgentMcpServer } from '../agent-mcp.mjs';
import config from '../vite.config.js';
import { createAgentBridge, createAgentAllowance, processAgentAllowance, agentBridgePlugin } from '../agent-bridge.mjs';
import { startAgentObservationBridge } from '../src/agent-browser.ts';
import { agentOrigin, agentPath, agentPngBytes, parseAgentObservation, parseAgentDecisionResult } from '../src/agent-observation.ts';
import { agentCliError, runAgentCli } from '../../scripts/doom-agent.mjs';
import { agentObservation, agentObserveResult, pngFor } from './fixtures/agent.ts';
import { deferred, checkpoint, fixture } from './fixtures/session.ts';
import { death, exit } from './fixtures/synthetic-doom.ts';
import { defaultDecisionConfiguration, defaultDecisionInstructionTemplate } from '../src/decision-request.ts';
import { validAgentCommand, parseAgentPromptResult, parseAgentConfigResult, parseAgentConfiguration, parseAgentObserveResult } from '../src/agent-control.ts';

// Scoped deterministic seams for byte-for-byte CLI/MCP replay, including IDs and
// paths. All other tests keep the actual implementations; no IDs are discarded.
vi.mock('node:crypto', async original => {
  const actual = await original();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});
vi.mock('node:fs/promises', async original => {
  const actual = await original();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp) };
});

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
  const browser = (observe = async () => agentObserveResult(), network = {}) => {
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
  game.browserInputs.tics = options.browserTics ?? 6;
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

it('uses 6, 11 and 23 tics in one configured run through CLI config CAS and frozen provider requests', async () => {
  const s = await budgetSession({ browserTics: 47 });
  assert.equal((await s.get()).configuration.tics, 6, 'Independent of human duration');
  let config = await s.start();
  const runId = config.run.runId;
  const file = join(tmpdir(), `doom-agent-tics-${randomUUID()}.json`);
  cleanups.push(() => rm(file, { force: true }));
  let cumulative = 1;
  for (const [index, tics] of [6, 11, 23].entries()) {
    const old = await s.observe();
    if (tics !== config.configuration.tics) {
      const before = config;
      const configuration = { ...config.configuration, tics };
      await writeFile(file, JSON.stringify(configuration));
      config = await s.cli(['set-config', ...s.base, '--session', config.sessionId, '--run', runId,
        '--revision', String(config.revision), '--config-file', file]);
      assert.deepEqual(config.run, before.run);
      assert.equal(config.revision, before.revision + 1);
      assert.equal((await s.decide(old, config)).reason, 'stale-observation');
      const fresh = await s.observe();
      assert.equal((await s.decide(fresh, before)).reason, 'no-grant', 'Old revision cannot admit');
      assert.deepEqual((await s.get()).run, config.run);
      assert.equal(s.game.sdkCalls, index); assert.equal(s.game.gameCalls, cumulative - 1);
    }
    const observation = await s.observe();
    const confirmed = await s.get();
    assert.deepEqual(confirmed.configuration, config.configuration);
    const result = await s.decide(observation, confirmed);
    cumulative += tics;
    assert.equal(result.outcome, 'completed');
    assert.deepEqual([result.requestedTics, result.reportedTics, result.verifiedTics], [tics, tics, tics]);
    assert.equal(result.cumulativeTics, [7, 18, 41][index]);
    assert.equal(result.observation.tic, cumulative);
    assert.equal(result.observation.sessionId, s.observation.sessionId);
    assert.equal(result.observation.previousAction.tics, tics);
    assert.equal(s.game.inputs[index].questions[0].instructions,
      defaultDecisionInstructionTemplate.replaceAll('{{tics}}', String(tics)));
    assert.equal(s.game.actions.at(-1).tics, tics);
    config = await s.get();
    assert.deepEqual(config.run, { runId, limit: 3, active: index < 2,
      reserved: index + 1, sdkInvoked: index + 1, remaining: 2 - index });
    assert.equal(s.game.browserInputs.tics, 47);
  }
  assert.equal(s.game.creations, 1); assert.equal(s.game.gameCalls, 40);
  assert.equal((await s.decide(await s.observe(), config)).reason, 'no-grant');
  await assert.rejects(s.start(), /budget-closed/);
  // Human modes retain their positive-safe-integer duration, even above the agent cap.
  assert.equal(await s.game.next(), 'completed');
  s.game.browserInputs.budget = 1; await s.game.start();
  assert.deepEqual(s.game.actions.slice(-2).map(action => action.tics), [47, 47]);
  assert.equal((await s.get()).configuration.tics, 23);
});

it('validates the skill configuration example with the strict agent schema', async () => {
  const skill = await readFile(new URL('../../.agents/skills/doom-decisions/SKILL.md', import.meta.url), 'utf8');
  const example = JSON.parse(skill.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(parseAgentConfiguration(example).tics, 6);
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
  const observation = agentObserveResult();
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
  const page = h.browser(async check => { fresh = check; await gate.promise; check(); return agentObserveResult(); });
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
    async observe(check) { captures++; fresh = check; await gate.promise; check(); return agentObserveResult(); },
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
    const page = h.browser(async () => agentObserveResult(), {
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
    const page = h.browser(async () => agentObserveResult(), {
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
  const page = h.browser(async check => { fresh = check; await capture.promise; check(); return agentObserveResult(); }, {
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
  const page = h.browser(async fresh => { captured.resolve(); await release.promise; fresh(); return agentObserveResult(); });
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
  const consumed = (reservation - 1) * 23 + 2;
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
  let config = await cli(['get-config', ...base, '--session', before.sessionId]);
  const configFile = join(temporaryRoot, 'configuration.json');
  await writeFile(configFile, JSON.stringify({ ...config.configuration, tics: 23 }));
  config = await cli(['set-config', ...base, '--session', config.sessionId, '--run', config.run.runId,
    '--revision', String(config.revision), '--config-file', configFile]);
  before = await cli(['observe', ...base]);
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
  assert.deepEqual([result.requestedTics, result.reportedTics, result.verifiedTics], [23, 2, 2]);
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
  const configuration = { ...first.configuration, tics: 11, includeHealth: false, includeAmmo: false, instructionTemplate: 'Ephemeral route for {{tics}} tics.' };
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
  assert.equal(game.inputs[0].questions[0].instructions, 'Ephemeral text edit 11.');
  assert.doesNotMatch(game.inputs[0].input[0].content[0].text, /Health:|Ammo:/);
  assert.match(game.inputs[0].input[0].content[0].text, /Ready weapon:/);
  assert.equal(game.ports.readDecisionConfiguration(), savedHuman);
  page.stop();
  assert.equal(game.controller.agentConfig(attached.epoch, first.sessionId, () => {}).error, 'lease-revoked');
});

it('rejects invalid duration JSON in CLI config files before transport or authorization changes', async () => {
  const s = await budgetSession();
  const config = await s.start();
  const file = join(tmpdir(), `doom-agent-invalid-tics-${randomUUID()}.json`);
  cleanups.push(() => rm(file, { force: true }));
  const args = ['set-config', ...s.base, '--session', config.sessionId, '--run', config.run.runId,
    '--revision', String(config.revision), '--config-file', file];
  for (const literal of ['"6"', '1.5', '0', '-1', '36', 'null', 'true', '9007199254740992', '1e999']) {
    const json = JSON.stringify(config.configuration).replace('"tics":6', `"tics":${literal}`);
    await writeFile(file, json);
    await assert.rejects(runAgentCli(args, { transport: () => assert.fail('Invalid file reached transport') }), /Invalid command/);
    assert.deepEqual((await s.get()).run, config.run);
    assert.equal(s.game.sdkCalls, 0); assert.equal(s.game.gameCalls, 0);
  }
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
    d => { delete d.configuration.tics; },
    ...['6', null, true, 1.5, 0, -1, 36, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1].map(tics => d => { d.configuration.tics = tics; }),
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

async function mcpSession(options) {
  const [clientWire, serverWire] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(() => createAgentMcpServer(options), { transport: serverWire });
  const client = new Client({ name: 'offline-parity', version: '1' });
  cleanups.push(async () => { await client.close(); await handle.close(); });
  await client.connect(clientWire);
  return client;
}
const callMcp = (client, op, args) => client.callTool({ name: `doom_${op.replaceAll('-', '_')}`, arguments: args });
function delivered(result) {
  assert.equal(result.isError, false);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.content[0].text, JSON.stringify(result.structuredContent));
  return result.structuredContent;
}

it('uses one combined MCP read at startup, after start/CAS and before a decision, retaining final accounting', async () => {
  const s = await budgetSession({}, createAgentAllowance('2'));
  assert.equal(s.observation.run, null);
  assert.equal(s.observation.revision, 0);
  const ops = [];
  const client = await mcpSession({ transport: (url, options) => {
    ops.push(new URL(url).pathname.split('/').at(-1));
    return s.h.transport(url, options);
  } });
  const input = { leaseFile: s.base[1], sessionId: s.observation.sessionId };
  const call = async (op, fields = {}) => delivered(await callMcp(client, op, { ...input, ...fields }));
  const prompt = await call('get-prompt');
  assert.equal(prompt.instructions, s.observation.configuration.instructionTemplate);
  let config = await call('start-run', { observationId: s.observation.observationId, revision: s.observation.revision });
  const observe = async () => delivered(await callMcp(client, 'observe', { leaseFile: input.leaseFile }));
  const first = await observe();
  assert.notEqual(first.observationId, s.observation.observationId);
  assert.equal(first.tic, s.observation.tic);
  assert.equal(first.pngSha256, s.observation.pngSha256);
  assert.deepEqual(first.configuration, config.configuration);
  assert.deepEqual(first.run, config.run);
  assert.deepEqual(first.run, { runId: config.run.runId, active: true, limit: 2, reserved: 0, sdkInvoked: 0, remaining: 2 });
  const counters = structuredClone(first.run);
  const configFile = join(dirname(input.leaseFile), 'combined-config.json');
  const configuration = { ...first.configuration, tics: 11, includeAmmo: false };
  await writeFile(configFile, JSON.stringify(configuration));
  const scope = () => ({ runId: config.run.runId, revision: config.revision });
  config = await call('set-config', { ...scope(), configFile });
  assert.equal(config.revision, first.revision + 1);
  assert.deepEqual(config.run, counters);
  assert.equal((await call('decide', { ...scope(), observationId: first.observationId })).reason, 'stale-observation');
  const afterConfig = await observe();
  assert.deepEqual(afterConfig.configuration, configuration);
  assert.equal(afterConfig.revision, config.revision);
  const instructionsFile = join(dirname(input.leaseFile), 'combined-prompt.txt');
  await writeFile(instructionsFile, 'Observe verified evidence for {{tics}} tics.');
  const changed = await call('set-prompt', { ...scope(), instructionsFile });
  config = { ...config, revision: changed.revision };
  let fresh = await observe();
  assert.equal(fresh.revision, changed.revision);
  assert.deepEqual(fresh.configuration, { ...configuration, instructionTemplate: changed.instructions });
  assert.deepEqual(fresh.run, counters);
  assert.equal(ops.includes('get-config'), false);
  for (let count = 1; count <= 2; count++) {
    const receipt = await call('decide', { ...scope(), observationId: fresh.observationId });
    assert.equal(receipt.outcome, 'completed');
    assert.equal(receipt.requestedTics, 11);
    for (const key of ['configuration', 'revision', 'run']) assert.equal(Object.hasOwn(receipt.observation, key), false);
    assert.equal(createHash('sha256').update(await readFile(receipt.pngPath)).digest('hex'), receipt.observation.pngSha256);
    if (count === 1) {
      fresh = await observe();
      assert.deepEqual(fresh.run, { ...counters, reserved: 1, sdkInvoked: 1, remaining: 1 });
      assert.equal(fresh.revision, config.revision);
      assert.equal(ops.includes('get-config'), false);
    }
  }
  const ended = await call('get-config');
  assert.deepEqual(ended.run, { ...counters, active: false, reserved: 2, sdkInvoked: 2, remaining: 0 });
  const exhausted = await observe();
  assert.deepEqual(exhausted.run, ended.run);
  assert.equal(ops.filter(op => op === 'get-config').length, 1);
  assert.equal(s.game.sdkCalls, 2);
});

it('composes strict observe/config validators without widening decision observation DTOs', () => {
  const original = agentObserveResult();
  assert.equal(parseAgentObserveResult(original), original);
  assert.throws(() => parseAgentObservation(original));
  const { configuration, revision, run, ...base } = original;
  assert.equal(parseAgentObservation(base), base);
  for (const mutate of [
    d => { delete d.configuration; }, d => { delete d.revision; }, d => { delete d.run; },
    d => { d.extra = true; }, d => { d.telemetry.extra = true; },
    d => { d.configuration.extra = true; }, d => { d.configuration.includeHealth = 1; },
    d => { d.revision = -1; }, d => { d.run = {}; },
  ]) {
    const value = structuredClone(original); mutate(value);
    assert.throws(() => parseAgentObserveResult(value));
  }
});

it.each(['missing', 'extra', 'configuration', 'revision', 'counters', 'runId', 'limit'])(
  'rejects malformed or unissued combined observation state (%s) at broker ingress', async fault => {
    const s = await budgetSession(); await s.start();
    const post = s.game.controller.observe;
    // Corrupt the actual controller reply at the existing browser port.
    s.game.controller.observe = async fresh => {
      const value = await post(fresh);
      if (fault === 'missing') delete value.run;
      if (fault === 'extra') value.configurationIdentity = 'not-public';
      if (fault === 'configuration') value.configuration.tics = 36;
      if (fault === 'revision') value.revision = -1;
      if (fault === 'counters') value.run.sdkInvoked = value.run.reserved + 1;
      if (fault === 'runId') value.run.runId = randomUUID();
      if (fault === 'limit') { value.run.limit++; value.run.remaining++; }
      return value;
    };
    await assert.rejects(s.observe(), /lease-revoked/);
    assert.equal(s.game.sdkCalls, 0); assert.equal(s.game.gameCalls, 0);
  },
);

it.each([
  ['default', defaultDecisionInstructionTemplate],
  ['maximum escaped', '\u0001'.repeat(15999) + 'x'],
  ['maximum Unicode', '界'.repeat(16000)],
])('retains complete %s instructions through combined broker/CLI/MCP output', async (label, instructionTemplate) => {
  const s = await budgetSession({ decisionConfiguration: { ...defaultDecisionConfiguration, instructionTemplate } });
  const client = await mcpSession({ transport: s.h.transport });
  const result = delivered(await callMcp(client, 'observe', { leaseFile: s.base[1] }));
  assert.equal(result.configuration.instructionTemplate, instructionTemplate);
  const config = delivered(await callMcp(client, 'get-config', { leaseFile: s.base[1], sessionId: result.sessionId }));
  const { revision, configuration, run, ...oldObservation } = result;
  const combinedBytes = Buffer.byteLength(JSON.stringify(result));
  const pairBytes = Buffer.byteLength(JSON.stringify(oldObservation)) + Buffer.byteLength(JSON.stringify(config));
  console.info(`Combined observe ${label}: output=${combinedBytes} bytes; separate observe+config=${pairBytes} bytes; delta=${combinedBytes - pairBytes}`);
  assert.deepEqual({ sessionId: result.sessionId, revision, configuration, run },
    { sessionId: config.sessionId, revision: config.revision, configuration: config.configuration, run: config.run });
  assert.equal(createHash('sha256').update(await readFile(result.pngPath)).digest('hex'), result.pngSha256);
});

it('MCP matches all eight CLI operations byte-for-byte using actual broker/controller replies, IDs and PNG paths', async () => {
  const game = fixture({ pngFor }); cleanups.push(() => game.dispose()); await game.prepare();
  const h = harness(createAgentAllowance('3'));
  const page = h.browser(fresh => game.controller.observe(fresh), { controller: game.controller });
  await page.ready;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-mcp-parity-'));
  cleanups.push(() => rm(temporaryRoot, { recursive: true, force: true }));
  let recorded, replays = 0;
  const cliTransport = async (url, options) => {
    const response = await h.transport(url, options);
    recorded = { url, options, text: await response.clone().text(), status: response.status };
    return response;
  };
  const client = await mcpSession({ temporaryRoot, transport: async (url, options) => {
    replays++;
    assert.equal(url, recorded.url);
    for (const key of ['method', 'headers', 'body', 'redirect', 'credentials', 'cache'])
      assert.deepEqual(options[key], recorded.options[key]);
    assert.equal(options.signal.aborted, false);
    return new Response(recorded.text, { status: recorded.status });
  } });
  const seen = new Set();
  async function pair(op, input, args) {
    const expected = await runAgentCli(args, { temporaryRoot, transport: cliTransport });
    const command = JSON.parse(recorded.options.body);
    let bytes;
    if (expected.pngPath) { bytes = await readFile(expected.pngPath); await rm(expected.pngPath); }
    if (op === 'attach') {
      await rm(expected.leaseFile);
      mkdtemp.mockResolvedValueOnce(dirname(expected.leaseFile));
    }
    randomUUID.mockReturnValueOnce(command.commandId ?? command.ownerId);
    const actual = delivered(await callMcp(client, op, input));
    assert.deepEqual(actual, expected); // No normalization of IDs, hashes, counters or paths.
    if (bytes) {
      assert.deepEqual(await readFile(actual.pngPath), bytes);
      const observation = op === 'decide' ? actual.observation : actual;
      assert.equal(createHash('sha256').update(bytes).digest('hex'), observation.pngSha256);
      assert.equal(observation.frame.tic, observation.tic);
      assert.equal(observation.frame.nativeSha256, observation.frame.canvasSha256);
    }
    seen.add(op);
    return actual;
  }
  const attached = await pair('attach', {}, ['attach']);
  const base = ['--lease', attached.leaseFile];
  const lease = { leaseFile: attached.leaseFile };
  const observe = () => pair('observe', lease, ['observe', ...base]);
  let before = await observe();
  const session = { ...lease, sessionId: before.sessionId };
  const initial = await pair('get-config', session, ['get-config', ...base, '--session', before.sessionId]);
  assert.equal(initial.configuration.tics, 6); assert.equal(initial.run, null);
  await pair('get-prompt', session, ['get-prompt', ...base, '--session', before.sessionId]);
  let current = await pair('start-run', { ...session, observationId: before.observationId, revision: initial.revision },
    ['start-run', ...base, '--observation', before.observationId, '--session', before.sessionId, '--revision', String(initial.revision)]);
  const counters = structuredClone(current.run);
  const configFile = join(temporaryRoot, 'configuration.json');
  await writeFile(configFile, JSON.stringify({ ...current.configuration, tics: 11, includeAmmo: false }));
  const scope = () => ({ ...session, runId: current.run.runId, revision: current.revision });
  current = await pair('set-config', { ...scope(), configFile }, ['set-config', ...base, '--session', current.sessionId,
    '--run', current.run.runId, '--revision', String(current.revision), '--config-file', configFile]);
  assert.deepEqual(current.run, counters); assert.equal(current.revision, initial.revision + 1);
  const instructionsFile = join(temporaryRoot, 'instructions.txt');
  await writeFile(instructionsFile, 'Offline route {{tics}}.');
  const prompt = await pair('set-prompt', { ...scope(), instructionsFile }, ['set-prompt', ...base, '--session', current.sessionId,
    '--run', current.run.runId, '--revision', String(current.revision), '--instructions-file', instructionsFile]);
  current = { ...current, revision: prompt.revision };
  assert.deepEqual(prompt.run, counters);
  before = await observe(); // Both writes invalidate the pre-write observation.
  const result = await pair('decide', { ...scope(), observationId: before.observationId }, ['decide', ...base,
    '--observation', before.observationId, '--session', current.sessionId, '--run', current.run.runId, '--revision', String(current.revision)]);
  assert.equal(result.outcome, 'completed'); assert.equal(result.beforeObservationId, before.observationId);
  assert.equal(result.observation.sessionId, before.sessionId);
  assert.equal(result.observation.tic, before.tic + 11);
  assert.notEqual(result.observation.pngSha256, before.pngSha256);
  assert.equal(game.inputs[0].questions[0].instructions, 'Offline route 11.');
  assert.deepEqual([result.requestedTics, result.reportedTics, result.verifiedTics], [11, 11, 11]);
  assert.equal(game.sdkCalls, 1); assert.equal(replays, 9);
  assert.equal(seen.size, 8);
});

it('MCP rejects strict arguments before I/O and preserves sanitized CLI file/transport failures', async () => {
  const s = await budgetSession();
  let calls = 0;
  const client = await mcpSession({ transport: (...args) => { calls++; return s.h.transport(...args); } });
  for (const [op, args] of [
    ['attach', { extra: true }], ['observe', { leaseFile: 'relative.json' }],
    ['get-config', { leaseFile: s.base[1], sessionId: 'bad' }],
    ['decide', { leaseFile: s.base[1], observationId: s.observation.observationId, sessionId: s.observation.sessionId }],
    ['decide', { leaseFile: s.base[1], observationId: s.observation.observationId, runId: randomUUID(), revision: 0 }],
    ['start-run', { leaseFile: s.base[1], observationId: s.observation.observationId, sessionId: s.observation.sessionId, revision: '0' }],
    ['start-run', { leaseFile: s.base[1], observationId: s.observation.observationId, sessionId: s.observation.sessionId, revision: -1 }],
    ['start-run', { leaseFile: s.base[1], observationId: s.observation.observationId, sessionId: s.observation.sessionId, revision: Number.MAX_SAFE_INTEGER + 1 }],
  ]) assert.equal((await callMcp(client, op, args)).isError, true);
  assert.equal(calls, 0);
  const config = await s.start();
  const file = join(dirname(s.base[1]), 'bad.json');
  await writeFile(file, '{offline-private-content');
  const args = { leaseFile: s.base[1], sessionId: config.sessionId, runId: config.run.runId, revision: config.revision, configFile: file };
  const failed = await callMcp(client, 'set-config', args);
  assert.equal(failed.isError, true);
  assert.deepEqual(failed.structuredContent, agentCliError(Error('unsanitized file exception')));
  assert.doesNotMatch(JSON.stringify(failed), /offline-private-content|SyntaxError|stack/);
  assert.equal(calls, 0); assert.deepEqual((await s.get()).run, config.run);
  const disconnected = await mcpSession({ transport: () => { throw Error('offline-private-network-content'); } });
  const unknown = await callMcp(disconnected, 'decide', { ...args, observationId: s.observation.observationId });
  assert.equal(unknown.isError, true); // Unknown field is a schema failure; no admission.
  const { configFile: _file, ...scope } = args;
  const ambiguous = await callMcp(disconnected, 'decide', { ...scope, observationId: s.observation.observationId });
  assert.equal(ambiguous.isError, true);
  assert.deepEqual(ambiguous.structuredContent, agentCliError(Error('unknown')));
  assert.doesNotMatch(JSON.stringify(ambiguous), /offline-private-network-content/);
  assert.equal(s.game.sdkCalls, 0);
});

it('MCP retains denial, revision, lease, exhaustion and Stop semantics without minting authority on restart', async () => {
  const s = await budgetSession({}, createAgentAllowance('1'));
  let requests = 0;
  const options = { transport: (...args) => { requests++; return s.h.transport(...args); } };
  let client = await mcpSession(options);
  const input = { leaseFile: s.base[1], sessionId: s.observation.sessionId };
  await client.listTools(); assert.equal(requests, 0);
  const config = delivered(await callMcp(client, 'start-run', { ...input, observationId: s.observation.observationId, revision: 0 }));
  const scope = { ...input, runId: config.run.runId, revision: config.revision };
  const file = join(dirname(s.base[1]), 'config.json'); await writeFile(file, JSON.stringify(config.configuration));
  const conflict = await callMcp(client, 'set-config', { ...scope, revision: config.revision + 1, configFile: file });
  assert.equal(conflict.isError, true); assert.deepEqual(conflict.structuredContent, { error: 'revision-conflict' });
  assert.deepEqual((await s.get()).run, config.run);
  const foreign = await callMcp(client, 'decide', { ...scope, runId: randomUUID(), observationId: randomUUID() });
  assert.equal(foreign.isError, true); assert.deepEqual(foreign.structuredContent, { error: 'budget-closed' });
  const denied = delivered(await callMcp(client, 'decide', { ...scope, revision: scope.revision + 1, observationId: randomUUID() }));
  assert.equal(denied.outcome, 'not-admitted'); assert.equal(denied.reason, 'no-grant'); assert.equal(denied.pngPath, null);
  const stale = delivered(await callMcp(client, 'decide', { ...scope, observationId: randomUUID() }));
  assert.equal(stale.outcome, 'not-admitted'); assert.equal(stale.reason, 'stale-observation');
  assert.equal(s.game.sdkCalls, 0);
  const result = delivered(await callMcp(client, 'decide', { ...scope, observationId: s.observation.observationId }));
  assert.equal(result.outcome, 'completed'); assert.equal(s.game.sdkCalls, 1);
  const fresh = delivered(await callMcp(client, 'observe', { leaseFile: input.leaseFile }));
  const exhausted = delivered(await callMcp(client, 'decide', { ...scope, observationId: fresh.observationId }));
  assert.equal(exhausted.outcome, 'not-admitted'); assert.equal(exhausted.reason, 'no-grant');
  const ended = delivered(await callMcp(client, 'get-config', input));
  assert.deepEqual(ended.run, { runId: scope.runId, active: false, limit: 1, reserved: 1, sdkInvoked: 1, remaining: 0 });
  await client.close();
  const beforeRestart = requests;
  client = await mcpSession(options); await client.listTools();
  assert.equal(requests, beforeRestart);
  const closed = await callMcp(client, 'start-run', { ...input, observationId: fresh.observationId, revision: scope.revision });
  assert.equal(closed.isError, true); assert.deepEqual(closed.structuredContent, { error: 'budget-closed' });
  s.page.stop();
  const stopped = await callMcp(client, 'get-config', input);
  assert.equal(stopped.isError, true); assert.deepEqual(stopped.structuredContent, { error: 'agent-stopped' });
  assert.equal(s.game.sdkCalls, 1);
});

it.each([{ signals: death, phase: 'terminal' }, { signals: exit, phase: 'terminal' }, { trapAt: 2, phase: null }])(
  'MCP preserves verified terminal or uncertain retired receipts (%j)', async options => {
    const s = await budgetSession(options.signals ? { at: 2, signals: options.signals } : { trapAt: options.trapAt });
    const config = await s.start();
    const client = await mcpSession({ transport: s.h.transport });
    const result = delivered(await callMcp(client, 'decide', { leaseFile: s.base[1], sessionId: config.sessionId,
      runId: config.run.runId, revision: config.revision, observationId: s.observation.observationId }));
    assert.equal(result.outcome, options.phase ? 'terminal' : 'retired');
    assert.equal(result.sdkInvoked, true); assert.equal(result.completionUncertain, !options.phase);
    if (options.phase) {
      assert.equal(result.observation.phase, 'terminal');
      assert.equal(result.observation.tic, result.cumulativeTics);
      assert.equal(result.observation.frame.nativeSha256, result.observation.frame.canvasSha256);
      assert.equal(createHash('sha256').update(await readFile(result.pngPath)).digest('hex'), result.observation.pngSha256);
      assert.deepEqual([result.requestedTics, result.reportedTics, result.verifiedTics], [6, 2, 2]);
    } else { assert.equal(result.pngPath, null); assert.equal(result.observation, null); }
    assert.equal(s.game.sdkCalls, 1);
  });

it.each(['cancel', 'disconnect'])('MCP %s closes the owned fake request, never replays, and restart cannot renew authority', async interruption => {
  const s = await budgetSession({ delayedBody: true });
  const config = await s.start();
  let calls = 0, cancelled = false;
  const options = { transport: (url, init) => {
    calls++;
    const reply = s.h.request(new URL(url).pathname, init);
    return new Promise((resolve, reject) => {
      const abort = () => {
        cancelled = true; reply.destroyed = true; reply.emit('close');
        reject(new DOMException('Aborted', 'AbortError'));
      };
      init.signal.addEventListener('abort', abort, { once: true });
      reply.result.promise.then(response => {
        init.signal.removeEventListener('abort', abort); resolve(response);
      }, reject);
    });
  } };
  const client = await mcpSession(options);
  const abort = new AbortController();
  const work = client.callTool({ name: 'doom_decide', arguments: { leaseFile: s.base[1], sessionId: config.sessionId,
    runId: config.run.runId, revision: config.revision, observationId: s.observation.observationId } }, { signal: abort.signal });
  const rejected = assert.rejects(work);
  await s.game.waiting; assert.equal(s.game.sdkCalls, 1);
  if (interruption === 'cancel') abort.abort(); else await client.close();
  await rejected;
  await checkpoint(() => cancelled && s.allowance.status === 'closed');
  assert.equal(calls, 1); assert.equal(s.game.view.session.agentBusy, true);
  await client.close();
  const replacement = await mcpSession(options); await replacement.listTools();
  assert.equal(calls, 1); assert.equal(s.allowance.status, 'closed');
  s.game.releaseBody(); await checkpoint(() => !s.game.view.session.agentBusy);
  assert.equal(s.game.sdkCalls, 1); assert.equal(s.game.gameCalls, 0);
});

it.each([{ throwOnCreate: true, outcome: 'api-failure', invoked: true }, { key: '', outcome: 'not-admitted', invoked: false }])(
  'MCP delivers failed domain receipts without converting them to completed gameplay (%j)', async options => {
    const s = await budgetSession(options); const config = await s.start();
    const client = await mcpSession({ transport: s.h.transport });
    const result = delivered(await callMcp(client, 'decide', { leaseFile: s.base[1], sessionId: config.sessionId,
      runId: config.run.runId, revision: config.revision, observationId: s.observation.observationId }));
    assert.equal(result.outcome, options.outcome); assert.equal(result.sdkInvoked, options.invoked);
    assert.equal(result.pngPath, null); assert.equal(result.observation, null);
    const ended = await s.get();
    assert.equal(ended.run.reserved, 1); assert.equal(ended.run.active, false); assert.equal(ended.run.remaining, 0);
    assert.equal(s.game.sdkCalls, options.invoked ? 1 : 0);
  });

it('MCP lost decide response is sanitized unknown completion, without replay or fabricated success', async () => {
  const s = await budgetSession(); const config = await s.start(); let calls = 0;
  const client = await mcpSession({ transport: async (...args) => {
    calls++; await s.h.transport(...args); throw Error('offline-lost-response');
  } });
  const result = await callMcp(client, 'decide', { leaseFile: s.base[1], sessionId: config.sessionId,
    runId: config.run.runId, revision: config.revision, observationId: s.observation.observationId });
  assert.equal(result.isError, true); assert.deepEqual(result.structuredContent, agentCliError(Error('unknown')));
  assert.equal(result.structuredContent.outcome, undefined);
  assert.equal(calls, 1); assert.equal(s.game.sdkCalls, 1); assert.equal(s.game.gameCalls, 6);
});
