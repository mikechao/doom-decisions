// Config transformation and imported main with synthetic DOM/controller only.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs, { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { runInNewContext } from 'node:vm';
import { Decisions } from '@openrouter/sdk/sdk/decisions.js';
import { afterEach, it, vi } from 'vitest';
import config from '../vite.config.js';
import { jevDecisionProviderFactory } from '../src/jev-decision-provider.ts';
import { openAiDecisionProviderFactory } from '../src/openai-decision-provider.ts';
import { openRouterDecisionProviderFactory } from '../src/openrouter-decision-provider.ts';

const bridge = vi.hoisted(() => ({ start: vi.fn(() => ({ stop: vi.fn() })) }));
vi.mock('../src/agent-browser', () => ({ startAgentObservationBridge: bridge.start }));

const session = vi.hoisted(() => ({
  ports: undefined, factory: undefined,
  controller: { configure: vi.fn(change => { change(); return true; }), initialize: vi.fn(), next: vi.fn(), startContinuous: vi.fn(), stop: vi.fn(),
    prepare: vi.fn(), close: vi.fn(), restore: vi.fn(), agentPrompt: vi.fn(), agentConfig: vi.fn(), attachAgent: vi.fn(), startAgentRun: vi.fn(), stopAgent: vi.fn() },
}));
const agent = vi.hoisted(() => ({ enabled: false, key: '', model: 'typesafe/jev-1.14', localIwad: null as null | { size: number } | { error: string } }));
vi.mock('virtual:agent-bootstrap', () => ({
  get enabled() { return agent.enabled; },
  get model() { return agent.model; },
  get localIwad() { return agent.localIwad; },
  takeKey() { const key = agent.key; agent.key = ''; return key; },
}));
vi.mock('../src/session-controller', () => ({
  createSessionController: (ports, factory) => {
    session.ports = ports; session.factory = factory; return session.controller;
  },
}));
vi.mock('../src/decision-history', () => ({ defineDecisionHistory: () => {} }));
// Provider/controller fixtures retain fake DOM behavior, not Shadow DOM coverage.
vi.mock('../src/doom-button', () => ({ defineDoomButton: () => {} }));
afterEach(() => {
  agent.enabled = false; agent.key = ''; agent.model = 'typesafe/jev-1.14'; agent.localIwad = null;
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); vi.restoreAllMocks();
});

it('permits both exact API origins by default and preserves bounded dev tooling', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sourcePolicy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(sourcePolicy, "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; img-src data:; worker-src 'self'; connect-src 'self' https://openrouter.ai https://api.openai.com; base-uri 'none'; form-action 'none'");
  for (const env of [
    { command: 'serve', mode: 'openrouter' },
    { command: 'serve', mode: 'development' },
    { command: 'serve', mode: 'jev' },
    { command: 'serve', mode: 'impeccable' },
    { command: 'build', mode: 'production' },
    { command: 'build', mode: 'openrouter' },
    { command: 'build', mode: 'jev' },
    { command: 'build', mode: 'impeccable' },
    { command: 'serve', mode: 'openrouter', isPreview: true },
    { command: 'serve', mode: 'jev', isPreview: true },
    { command: 'serve', mode: 'impeccable', isPreview: true },
  ]) {
    vi.stubEnv('TYPESAFE_API_KEY', 'offline-server-dummy-only');
    const raw = config(env);
    const transformed = raw.plugins.find(p => p.name === 'dev-csp')?.transformIndexHtml(html) ?? html;
    const devServe = env.command === 'serve' && !env.isPreview;
    const jev = devServe && env.mode === 'jev';
    const impeccable = devServe && env.mode === 'impeccable';
    const policy = transformed.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    let expected = devServe ? sourcePolicy.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'") : sourcePolicy;
    if (jev) expected = expected.replace("connect-src 'self' https://openrouter.ai https://api.openai.com", "connect-src 'self'");
    if (impeccable) expected = expected
      .replace("script-src 'self'", "script-src 'self' http://localhost:8400")
      .replace("connect-src 'self'", "connect-src 'self' http://localhost:8400 ws://127.0.0.1:5173");
    assert.equal(policy, expected);
    assert.match(policy, /(?:^|; )img-src data:;/);
    assert.doesNotMatch(policy, /img-src[^;]*(?:https?:|blob:|'self'|\*)/);
    assert.equal(policy.includes('https://openrouter.ai'), !jev);
    assert.equal(policy.includes('https://api.openai.com'), !jev);
    if (env.command === 'build' || env.isPreview) assert.equal(transformed, html);
    if (jev) {
      assert.match(transformed, /connect-src 'self';/);
      assert.equal(raw.server.proxy['/__jev'].target, 'https://api.typesafe.ai');
    } else assert.equal(raw.server?.proxy, undefined);
    assert.deepEqual(raw.preview.proxy, {});
    assert.deepEqual(raw.worker, { format: 'es' });
    assert.deepEqual(raw.build, { minify: false, sourcemap: true });
  }
});

it('rejects ambiguous or altered source CSP and bounds Live rewrites', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)![0];
  const policy = meta.match(/content="([^"]+)"/)![1];
  const transform = config({ command: 'serve', mode: 'impeccable' }).plugins[0].transformIndexHtml;
  for (const bad of [html.replace(meta, ''), html.replace(meta, meta + meta), html.replace("worker-src 'self'", "worker-src *")]) {
    assert.throws(() => transform(bad), /exactly one unambiguous strict CSP/);
  }
  const live = html.replace(meta, `<meta http-equiv="Content-Security-Policy" content="default-src *" data-impeccable-csp-original="${Buffer.from(policy).toString('base64')}">`);
  const transformed = transform(live);
  assert.equal(transformed.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1],
    transform(html).match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1]);
});

class Element extends EventTarget {
  display = vi.fn();
  value = ''; valueAsNumber = 2; disabled = true; hidden = false; open = true; checked = false;
  private content = '';
  children: Element[] = [];
  dataset = {}; files = [];
  get textContent() { return this.content + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.content = String(value); this.children = []; }
  appendChild(child: Element) { this.children.push(child); return child; }
  getContext() { return {}; }
  querySelector() { return undefined; }
  contains(node: Element) { return this.children.includes(node); }
  attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() { document.activeElement = this; }
}

const callback = 'http://127.0.0.1:5173/';
const pendingKey = 'doom-decisions.openrouter-oauth.pending.v1';
const nonce = 's'.repeat(43);
const minted = 'offline-oauth-dummy-only';

function browserFixture(query = '', hasPending = false) {
  const elements = new Map<string, Element>();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  element('#openrouter-signin-button').appendChild(element('#openrouter-signin-logo'));
  element('#openrouter-signin-button').appendChild(element('#openrouter-signin-label'));
  element('#key-label').textContent = 'Temporary OpenRouter API key';
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  element('#key-note').textContent = html.match(/<p id="key-note" class="help">([\s\S]*?)<\/p>/)![1].replace(/<[^>]+>/g, '');
  element('#openrouter-connect').hidden = true;
  element('#openrouter-back').hidden = true;
  element('#openrouter-key-settings').hidden = true;
  element('#stop-agent').disabled = false;
  element('#view-prompt').disabled = false;
  element('#openrouter-model-gpt').value = 'openai/gpt-6-luna-decisions';
  element('#openrouter-model-gpt').checked = true;
  element('#openrouter-model-jev').value = 'typesafe/jev-1.14';
  const document = new EventTarget();
  Object.assign(document, { querySelector: element, activeElement: null });
  vi.stubGlobal('document', document);
  const values = new Map<string, string>();
  if (hasPending) values.set(pendingKey, JSON.stringify({
    verifier: 'v'.repeat(43), state: nonce, callback, search: '?view=wide', hash: '#prompt',
  }));
  const storage = {
    getItem: vi.fn(name => values.get(name) ?? null),
    setItem: vi.fn((name, value) => { values.set(name, value); }),
    removeItem: vi.fn(name => { values.delete(name); }),
  };
  const location = { href: callback + query, assign: vi.fn() };
  const history = { state: { keep: true }, replaceState: vi.fn((_state, _title, path) => {
    location.href = new URL(path, location.href).href;
  }) };
  const transport = vi.fn(async () => new Response(JSON.stringify({ key: minted })));
  const window = new EventTarget();
  Object.assign(window, { location, history, sessionStorage: storage, crypto: webcrypto, fetch: transport });
  vi.stubGlobal('window', window);
  const worker = vi.fn(() => { throw Error('No Worker during auth'); });
  vi.stubGlobal('Worker', worker);
  session.controller.initialize.mockImplementation(() => {
    session.ports.present({ iwadEnabled: true });
    return Promise.resolve();
  });
  // Real controller.close clears credentials through this port, which also
  // refreshes OAuth/model availability after the early OAuth pagehide handler.
  session.controller.close.mockImplementation(() => session.ports.clearKey());
  return { element, elements, document, window, storage, values, location, history, transport, worker };
}

async function settleStartup() {
  // Flush the caught auth/bootstrap promises, without timers or real transport.
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

it('serves an optional private agent bootstrap only on loopback dev, with inert production output', () => {
  const root = mkdtempSync(join(tmpdir(), 'doom-agent-bootstrap-'));
  const sentinel = 'offline-agent-sentinel-only';
  const evaluate = (source) => runInNewContext(source.replaceAll('export ', '') + '\n({ enabled, model, takeKey })');
  try {
    writeFileSync(join(root, '.env.agent.local'), `AGENT_OPENROUTER_API_KEY="${sentinel}"\nAGENT_MODEL=${sentinel}\n`);
    const reads = vi.spyOn(fs, 'readFileSync');
    for (const env of [
      { command: 'serve', mode: 'development' },
      { command: 'serve', mode: 'impeccable' },
      { command: 'serve', mode: 'production', isPreview: true },
      { command: 'build', mode: 'production' },
      { command: 'build', mode: 'openrouter' },
      { command: 'build', mode: 'jev' },
    ]) {
      const raw = config(env);
      assert.equal(inspect(raw, { depth: 20 }).includes(sentinel), false);
      assert.equal(raw.define, undefined);
      assert.equal(raw.envPrefix, undefined);
      const plugin = raw.plugins.find(p => p.name === 'agent-bootstrap');
      plugin.configResolved({ root, server: {} });
      assert.equal(plugin.resolveId('./unrelated.ts'), undefined);
      assert.equal(plugin.load('./unrelated.ts'), undefined);
      reads.mockClear();
      const output = plugin.load(plugin.resolveId('virtual:agent-bootstrap'));
      assert.equal(reads.mock.calls.length, 0, 'Inert bootstrap never reads the private file');
      assert.equal(output.includes(sentinel), false, 'Production bootstrap module cannot emit a credential');
      const boot = evaluate(output);
      assert.equal(boot.enabled, false);
      assert.equal(boot.model, 'openai/gpt-6-luna-decisions');
      assert.equal(boot.takeKey(), '');
    }
    assert.throws(() => config({ command: 'build', mode: 'agent' }), /development serving only/);
    assert.throws(() => config({ command: 'serve', mode: 'agent', isPreview: true }), /development serving only/);
    const raw = config({ command: 'serve', mode: 'agent' });
    assert.equal(raw.server.host, '127.0.0.1');
    assert.equal(raw.server.cors, false);
    assert.equal(raw.server.headers['Cache-Control'], 'no-store');
    assert.equal(inspect(raw, { depth: 20 }).includes(sentinel), false);
    const plugin = raw.plugins.find(p => p.name === 'agent-bootstrap');
    for (const host of [true, '0.0.0.0', 'localhost'])
      assert.throws(() => plugin.configResolved({ root, server: { host } }), /host 127.0.0.1/);
    plugin.configResolved({ root, server: raw.server });
    const id = plugin.resolveId('virtual:agent-bootstrap');
    writeFileSync(join(root, '.env.agent.local'), `AGENT_OPENROUTER_API_KEY="${sentinel}"\n`);
    const boot = evaluate(plugin.load(id));
    assert.equal(boot.enabled, true);
    assert.equal(boot.model, 'typesafe/jev-1.14', 'Missing AGENT_MODEL defaults to Jev');
    assert.equal(boot.takeKey(), sentinel);
    assert.equal(boot.takeKey(), '', 'One-time transfer into ephemeral app memory');
    for (const input of ['', 'AGENT_OPENROUTER_API_KEY=', 'AGENT_OPENROUTER_API_KEY="bad key"']) {
      writeFileSync(join(root, '.env.agent.local'), input);
      const optional = evaluate(plugin.load(id));
      assert.equal(optional.takeKey(), '');
      assert.equal(optional.model, 'typesafe/jev-1.14');
    }
    // A process setting must never override this file or the agent default.
    vi.stubEnv('AGENT_MODEL', 'invalid-process-setting');
    for (const [setting, expected] of [
      ['jev', 'typesafe/jev-1.14'],
      ['gpt6', 'openai/gpt-6-luna-decisions'],
      ['', 'typesafe/jev-1.14'],
      ['"   "', 'typesafe/jev-1.14'],
    ]) {
      writeFileSync(join(root, '.env.agent.local'), `AGENT_MODEL=${setting}\nAGENT_OPENROUTER_API_KEY=${sentinel}\n`);
      const selected = evaluate(plugin.load(id));
      assert.equal(selected.model, expected);
      assert.equal(selected.takeKey(), sentinel);
      assert.equal(selected.takeKey(), '');
    }
    const sdk = vi.spyOn(Decisions.prototype, 'create').mockImplementation(() => assert.fail('No inference during bootstrap'));
    for (const invalid of [sentinel, 'JEV', 'typesafe/jev-1.14']) {
      writeFileSync(join(root, '.env.agent.local'), `AGENT_MODEL=${invalid}\nAGENT_OPENROUTER_API_KEY=${sentinel}\n`);
      assert.throws(() => plugin.load(id), error => {
        assert.equal(error.message, 'AI Agent AGENT_MODEL in .env.agent.local must be jev or gpt6.');
        assert.equal(inspect(error).includes(sentinel), false);
        return true;
      });
    }
    assert.equal(sdk.mock.calls.length, 0);
    rmSync(join(root, '.env.agent.local'));
    const missing = evaluate(plugin.load(id));
    assert.equal(missing.takeKey(), '', 'Missing key still enables agent startup');
    assert.equal(missing.model, 'typesafe/jev-1.14', 'Missing file defaults to Jev');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('auto-selects included Freedoom once after agent readiness without a key, retaining inference gates', async () => {
  agent.enabled = true;
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'agent'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  let finish;
  session.controller.initialize.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  session.controller.prepare.mockImplementation(() => {
    session.ports.present({ session: {
      phase: 'preparing', prepared: false, hasClient: false, verifiedTics: 0,
      controls: { ready: false, stop: false, tics: false, iwad: false }, evidence: { decisions: [] },
    } });
  });
  await import('../src/main.ts?agent-no-key-startup');
  await settleStartup();
  const create = vi.spyOn(session.factory, 'create');
  assert.equal(session.controller.prepare.mock.calls.length, 0, 'Initialization has not completed');
  session.ports.present({ iwadEnabled: true });
  assert.equal(session.controller.prepare.mock.calls.length, 0, 'Presentation alone is not a startup command');
  finish();
  await settleStartup();
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  const [file] = session.controller.prepare.mock.calls[0];
  assert.equal(file.size, 28795076);
  assert.equal(typeof file.arrayBuffer, 'function');
  assert.match(h.element('#setup-asset').textContent, /Included Freedoom/);
  assert.equal(h.element('#included-freedoom').textContent, 'Loading Doom…');
  h.element('#included-freedoom').dispatchEvent(new Event('click'));
  assert.equal(session.controller.prepare.mock.calls.length, 1, 'Existing admission rejects competing selection');
  // Completion of the preparation command alone must not make the UI ready.
  assert.equal(h.element('#next').disabled, true);
  assert.equal(h.element('#start').disabled, true);
  ready();
  assert.equal(h.element('#openrouter-model-jev').checked, true);
  assert.equal(h.element('#openrouter-model-gpt').checked, false);
  assert.match(session.factory.probe().status, /configured model: typesafe\/jev-1\.14/);
  assert.equal(h.element('#next').disabled, true);
  assert.equal(h.element('#start').disabled, true);
  assert.match(h.element('#control-prerequisite').textContent, /Agent Mode: human decision controls are disabled/);
  h.element('#key').dispatchEvent(new Event('input'));
  session.ports.present({ iwadEnabled: true });
  await settleStartup();
  assert.equal(session.controller.prepare.mock.calls.length, 1, 'Readiness updates never restart preparation');
  assert.equal(create.mock.calls.length, 0);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
  assert.equal(h.transport.mock.calls.length, 0);
});

it('auto-selects the configured local IWAD once, with a lazy read and no inference', async () => {
  agent.enabled = true;
  agent.localIwad = { size: 12 };
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'agent'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  const fetch = vi.fn(() => assert.fail('The controller mock has not read the file'));
  vi.stubGlobal('fetch', fetch);
  session.controller.prepare.mockImplementation(() => {
    session.ports.present({ session: {
      phase: 'preparing', prepared: false, hasClient: false, verifiedTics: 0,
      controls: { ready: false, stop: false, tics: false, iwad: false }, evidence: { decisions: [] },
    } });
  });
  await import('../src/main.ts?agent-configured-local-iwad');
  await settleStartup();
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  const [file] = session.controller.prepare.mock.calls[0];
  assert.equal(file.size, 12);
  assert.equal(typeof file.arrayBuffer, 'function');
  assert.match(h.element('#setup-asset').textContent, /Configured local IWAD/);
  assert.doesNotMatch(h.element('#setup-asset').textContent, /Freedoom/);
  session.ports.present({ iwadEnabled: true });
  await settleStartup();
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(h.transport.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
});

it('shows configured IWAD errors without preparing or falling back to Freedoom', async () => {
  agent.enabled = true;
  agent.localIwad = { error: 'Check AGENT_IWAD_PATH, then fully stop and relaunch dev:agent.' };
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'agent'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  await import('../src/main.ts?agent-configured-iwad-error');
  await settleStartup();
  assert.equal(h.element('#status').textContent, agent.localIwad.error);
  session.ports.present({ iwadEnabled: true });
  await settleStartup();
  assert.equal(session.controller.prepare.mock.calls.length, 0);
  assert.equal(h.transport.mock.calls.length, 0);
  assert.equal(bridge.start.mock.calls.length, 0);
});

it('retains preparation failure presentation without automatically retrying the asset', async () => {
  agent.enabled = true;
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'agent'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  const error = 'Preparation failed: Included Freedoom could not be loaded or verified. Choose an IWAD again to retry preparation.';
  session.controller.prepare.mockImplementation(() => {
    session.ports.clearKey();
    session.ports.present({ status: error, session: {
      phase: 'unprepared', prepared: false, hasClient: false, verifiedTics: 0,
      controls: { ready: false, stop: false, tics: false, iwad: true }, evidence: { decisions: [] },
    } });
    return Promise.resolve();
  });
  await import('../src/main.ts?agent-asset-failure');
  await settleStartup();
  h.element('#key').dispatchEvent(new Event('input'));
  session.ports.present({ iwadEnabled: true });
  await settleStartup();
  assert.equal(h.element('#status').textContent, error);
  assert.equal(h.element('#included-freedoom').textContent, 'Use included Freedoom');
  assert.equal(h.element('#included-freedoom').disabled, false, 'Existing manual retry stays available');
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
});

it.each([
  ['typesafe/jev-1.14', '#openrouter-model-jev', '#openrouter-model-gpt', 'openai/gpt-6-luna-decisions', () => import('../src/main.ts?agent-key-startup-jev')],
  ['openai/gpt-6-luna-decisions', '#openrouter-model-gpt', '#openrouter-model-jev', 'typesafe/jev-1.14', () => import('../src/main.ts?agent-key-startup-gpt6')],
])('keeps agent %s credentials lazy and radios editable until client creation', async (model, selected, other, changedModel, load) => {
  agent.enabled = true; agent.key = 'offline-agent-browser-dummy';
  agent.model = model;
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'agent'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  let finish;
  session.controller.initialize.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const sdk = vi.spyOn(Decisions.prototype, 'create').mockImplementation(() => assert.fail('No inference in this test'));
  await load();
  await settleStartup();
  assert.equal(h.element(selected).checked, true);
  assert.equal(h.element(other).checked, false, 'Startup overrides the HTML radio default');
  assert.equal(session.factory.probe().status.includes(`configured model: ${model}`), true);
  const create = vi.spyOn(session.factory, 'create');
  session.ports.present({ iwadEnabled: true }); finish();
  await settleStartup();
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  assert.equal(create.mock.calls.length, 0);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
  ready();
  assert.equal(h.element('#next').disabled, true);
  assert.equal(h.element('#start').disabled, true);
  assert.match(h.element('#openrouter-auth-status').textContent, /Local agent key.*unverified/);
  assert.equal(h.element('#key').value, '');
  assert.equal(h.values.size, 0);
  for (const el of h.elements.values()) assert.equal(el.textContent.includes('offline-agent-browser-dummy'), false);
  assert.equal(h.element('#openrouter-model').disabled, false);
  h.element(other).checked = true;
  h.element(other).dispatchEvent(new Event('change'));
  assert.equal(h.element(other).checked, true);
  assert.equal(h.element(selected).checked, false);
  assert.equal(session.factory.probe().status.includes(`configured model: ${changedModel}`), true);
  // Human admission stays fenced; simulate the agent controller's lazy client construction.
  h.element('#next').dispatchEvent(new Event('click'));
  assert.equal(session.controller.next.mock.calls.length, 0);
  session.factory.create(session.ports.takeKey());
  assert.deepEqual(create.mock.calls, [['offline-agent-browser-dummy']]);
  assert.equal(h.element('#openrouter-model').disabled, true);
  h.element(selected).checked = true;
  h.element(selected).dispatchEvent(new Event('change'));
  assert.equal(h.element(other).checked, true, 'Client creation locks the changed selection');
  assert.equal(h.element(selected).checked, false);
  assert.equal(session.factory.probe().status.includes(`configured model: ${changedModel}`), true);
  assert.equal(session.ports.takeKey(), '');
  assert.equal(sdk.mock.calls.length, 0, 'Client construction makes no inference request');
  assert.equal(h.transport.mock.calls.length, 0);
});

it('preserves manual/OAuth precedence and clears unused agent credentials on retirement and page exit', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'agent'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  for (const [kind, load] of [
    ['manual', () => import('../src/main.ts?agent-manual-precedence')],
    ['oauth', () => import('../src/main.ts?agent-oauth-precedence')],
    ['retirement', () => import('../src/main.ts?agent-retirement-clear')],
    ['pagehide', () => import('../src/main.ts?agent-pagehide-clear')],
  ]) {
    agent.enabled = true; agent.key = 'offline-agent-discarded';
    const h = browserFixture(kind === 'oauth' ? `?code=offline-code&state=${nonce}` : '', kind === 'oauth');
    await load(); await settleStartup();
    if (kind === 'manual') h.element('#key').value = 'bad replacement';
    if (kind === 'retirement') session.ports.clearKey();
    if (kind === 'pagehide') h.window.dispatchEvent(new Event('pagehide'));
    assert.equal(session.ports.takeKey(), kind === 'manual' ? 'bad replacement' : kind === 'oauth' ? minted : '');
    assert.equal(session.ports.takeKey(), '', 'Never falls back to a superseded or cleared startup key');
  }
});

it('keeps ordinary dev/production manual and refuses auto-preparation after failed initialization or page exit', async () => {
  for (const [kind, dev, mode, load] of [
    ['ordinary', true, 'development', () => import('../src/main.ts?agent-ordinary-dev')],
    ['ordinary', false, 'production', () => import('../src/main.ts?agent-ordinary-production')],
    ['ordinary', false, 'agent', () => import('../src/main.ts?agent-production-defense')],
    ['failed', true, 'agent', () => import('../src/main.ts?agent-initialize-failure')],
    ['pagehide', true, 'agent', () => import('../src/main.ts?agent-initialize-pagehide')],
  ] as const) {
    vi.resetAllMocks();
    agent.enabled = true; agent.key = 'offline-key-must-not-leak';
    vi.stubEnv('DEV', dev); vi.stubEnv('MODE', mode); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
    const h = browserFixture();
    if (kind === 'failed') session.controller.initialize.mockImplementation(() => {
      session.ports.present({ status: 'Startup failed: synthetic metadata failure.' });
    });
    if (kind === 'pagehide') session.controller.initialize.mockImplementation(async () => {
      h.window.dispatchEvent(new Event('pagehide'));
      session.ports.present({ iwadEnabled: true });
    });
    await load(); await settleStartup();
    assert.equal(session.controller.prepare.mock.calls.length, 0);
    if (kind === 'ordinary') {
      assert.equal(h.element('#openrouter-model-gpt').checked, true);
      assert.equal(h.element('#openrouter-model-jev').checked, false);
      assert.match(session.factory.probe().status, /configured model: openai\/gpt-6-luna-decisions/);
      assert.equal(h.element('#included-freedoom').disabled, true);
      h.element('#included-freedoom').dispatchEvent(new Event('click'));
      assert.equal(session.controller.prepare.mock.calls.length, 0);
    }
    assert.equal(session.ports.takeKey(), '');
    assert.equal(session.controller.next.mock.calls.length, 0);
    assert.equal(session.controller.startContinuous.mock.calls.length, 0);
  }
});

it('keeps auth alternatives together and two native model choices in a separate provider-gated group', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="openrouter-connect" hidden>\s*<div id="openrouter-signin">\s*<doom-button id="openrouter-signin-button"[^>]*>[\s\S]*?<\/doom-button>\s*<\/div>\s*<doom-button id="openrouter-manual" appearance="text" aria-controls="manual-key" aria-expanded="false">Use an API key instead<\/doom-button>\s*<p id="openrouter-auth-note" class="help auth-charge-note">API usage will incur charges\.<\/p>\s*<p id="openrouter-auth-status"[^>]*><\/p>\s*<\/div>\s*<div id="manual-key">/);
  const buttonContents = html.match(/<doom-button id="openrouter-signin-button"[^>]*>([\s\S]*?)<\/doom-button>/)![1];
  assert.match(buttonContents, /<svg id="openrouter-signin-logo" class="openrouter-signin-logo" slot="start" viewBox="0 0 401\.4 293\.7" xmlns="http:\/\/www\.w3\.org\/2000\/svg" fill="currentColor" aria-hidden="true" focusable="false">\s*<path d="M303\.9475,/);
  assert.match(buttonContents, /<span id="openrouter-signin-label">Sign in with OpenRouter<\/span>/);
  assert.match(html, /OpenRouter logo: <a href="\.\/notices\/openrouter-sign-in\/LICENSE\.txt">MIT license<\/a>/);
  const group = html.match(/<fieldset id="openrouter-model"[^>]*>([\s\S]*?)<\/fieldset>/)![1];
  assert.match(group, /<legend>2 AI Model<\/legend>/);
  assert.equal((group.match(/type="radio"/g) ?? []).length, 2);
  assert.match(group, /<label><input id="openrouter-model-gpt" type="radio" name="openrouter-model" value="openai\/gpt-6-luna-decisions" checked> GPT-6 Luna Decisions<\/label>/);
  assert.match(group, /<label><input id="openrouter-model-jev" type="radio" name="openrouter-model" value="typesafe\/jev-1\.14"> Jev 1.14<\/label>/);
  assert.match(html, /<div class="setup-group setup-model">\s*<fieldset id="openrouter-model" aria-describedby="openrouter-model-help" disabled>[\s\S]*?<\/fieldset>\s*<p id="openrouter-model-help" class="help" role="status"><\/p>\s*<\/div>/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  // Source contract only: the synthetic DOM does not compute provider visibility.
  assert.match(css, /\.setup-content:has\(#openrouter-connect\[hidden\]\) > \.setup-model\s*\{\s*display: none;\s*\}/);
  assert.match(html, /<p id="openrouter-model-help" class="help" role="status"><\/p>/);
  assert.match(html, /<p id="openrouter-auth-status" class="help" role="status" aria-live="polite" aria-atomic="true"><\/p>/);
});

function ready(collisionEvidence?: string) {
  session.ports.present({ session: {
    phase: 'ready', prepared: true, hasClient: false, verifiedTics: 1,
    collisionEvidence,
    evidence: { decisions: [] }, controls: { ready: true, stop: false, tics: true, iwad: false },
  } });
}

it('selects the provider at the app edge, labels BYOK truthfully and retains capture/replacement semantics', async () => {
  // OpenRouter wraps a per-session model factory; direct factories stay unchanged.
  for (const [dev, mode, setting, expected, load] of [
    [true, 'openrouter', undefined, openRouterDecisionProviderFactory, () => import('../src/main.ts?openrouter-test')],
    [true, 'jev', undefined, jevDecisionProviderFactory, () => import('../src/main.ts?jev-test')],
    [true, 'jev', 'openrouter', jevDecisionProviderFactory, () => import('../src/main.ts?jev-explicit-test')],
    [true, 'development', undefined, openRouterDecisionProviderFactory, () => import('../src/main.ts?default-test')],
    [true, 'impeccable', '', openRouterDecisionProviderFactory, () => import('../src/main.ts?impeccable-test')],
    [false, 'production', undefined, openRouterDecisionProviderFactory, () => import('../src/main.ts?production-test')],
    [false, 'openrouter', 'openrouter', openRouterDecisionProviderFactory, () => import('../src/main.ts?production-openrouter-test')],
    [false, 'jev', undefined, openRouterDecisionProviderFactory, () => import('../src/main.ts?production-jev-test')],
    [false, 'impeccable', undefined, openRouterDecisionProviderFactory, () => import('../src/main.ts?production-impeccable-test')],
    [true, 'development', 'openai', openAiDecisionProviderFactory, () => import('../src/main.ts?openai-dev-test')],
    [true, 'openrouter', 'openai', openAiDecisionProviderFactory, () => import('../src/main.ts?openai-legacy-mode-test')],
    [true, 'impeccable', 'openai', openAiDecisionProviderFactory, () => import('../src/main.ts?openai-impeccable-test')],
    [false, 'production', 'openai', openAiDecisionProviderFactory, () => import('../src/main.ts?openai-production-test')],
    [false, 'jev', 'openai', openAiDecisionProviderFactory, () => import('../src/main.ts?openai-production-jev-test')],
  ] as const) {
    vi.stubEnv('DEV', dev); vi.stubEnv('MODE', mode); vi.stubEnv('VITE_DECISION_PROVIDER', setting);
    const h = browserFixture('?code=unrelated&state=unrelated');
    const { element } = h;
    // Literal query imports re-evaluate only the app entry per mode.
    await load();
    await settleStartup();
    if (expected === openRouterDecisionProviderFactory) {
      assert.deepEqual(session.factory.probe().evidence, { provider: 'OpenRouter', version: '1.4.25' });
    } else assert.equal(session.factory, expected);
    if (expected === openRouterDecisionProviderFactory) {
      assert.equal(element('#key-label').textContent, 'Temporary OpenRouter API key');
      assert.match(element('#key-note').textContent, /Your API key/);
      assert.match(element('#key-note').textContent, /Signing in with OpenRouter issues an API key for Doom Decisions/);
      assert.match(element('#key-note').textContent, /page memory, not localStorage/);
      assert.match(element('#key-note').textContent, /Refreshing clears the app's local access but does not revoke the issued key/);
      assert.equal(element('#openrouter-key-settings').hidden, false);
      assert.equal(element('#openrouter-connect').hidden, false);
      assert.equal(element('#openrouter-model').disabled, true);
      assert.equal(element('#openrouter-model-gpt').checked, true);
      assert.equal(element('#openrouter-model-help').textContent, '');
      assert.equal(element('#openrouter-auth-status').textContent, '');
      assert.equal(element('#manual-key').hidden, true);
      assert.equal(element('#key').hidden, true);
      element('#openrouter-manual').dispatchEvent(new Event('click'));
      assert.equal(element('#openrouter-model').disabled, false);
      assert.equal(element('#manual-key').hidden, false);
      assert.equal(element('#openrouter-signin').hidden, true);
      assert.equal(element('#openrouter-manual').attributes.get('aria-expanded'), 'true');
      assert.equal(element('#key').disabled, false, 'Manual BYOK is editable before game selection');
      assert.equal(document.activeElement, element('#key'));
      ready();
      assert.match(element('#control-prerequisite').textContent, /OpenRouter/);
      assert.equal(element('#key').hidden, false);
      assert.equal(element('#key').disabled, false);
      element('#key').value = '  offline-first  ';
      assert.equal(session.ports.takeKey(), 'offline-first');
      assert.equal(element('#key').value, '');
      assert.equal(session.ports.takeKey(), '');
      element('#key').value = 'offline-replacement';
      assert.equal(session.ports.takeKey(), 'offline-replacement');
      element('#key').value = 'offline-clear'; session.ports.clearKey();
      assert.equal(element('#key').value, '');
      element('#next').dispatchEvent(new Event('click'));
      assert.equal(session.controller.next.mock.calls.length, 1);
      element('#key').value = 'unsubmitted-edit';
      element('#openrouter-back').dispatchEvent(new Event('click'));
      assert.equal(element('#key').value, '');
      assert.equal(element('#manual-key').hidden, true);
      assert.equal(element('#openrouter-signin').hidden, false);
      assert.equal(element('#openrouter-signin-button').disabled, true);
      assert.equal(document.activeElement, element('#openrouter-manual'));
    } else if (expected === jevDecisionProviderFactory) {
      for (const id of ['#iwad', '#iwad-picker', '#included-freedoom']) assert.equal(element(id).disabled, false);
      assert.equal(element('#key').hidden, true);
      assert.equal(session.ports.takeKey(), 'jev-vite-proxy-not-a-credential');
    } else {
      for (const id of ['#iwad', '#iwad-picker', '#included-freedoom']) assert.equal(element(id).disabled, false);
      assert.equal(element('#key').disabled, true, 'Direct OpenAI retains preparation-before-key behavior');
      assert.equal(element('#key-label').textContent, 'Temporary OpenAI API key (experimental)');
      assert.match(element('#key-note').textContent, /explicitly selected.*CORS.*unverified/);
    }
    if (expected !== openRouterDecisionProviderFactory) {
      assert.equal(h.storage.getItem.mock.calls.length, 0);
      assert.equal(h.storage.removeItem.mock.calls.length, 0);
      assert.equal(element('#openrouter-connect').hidden, true);
      assert.equal(element('#openrouter-back').hidden, true);
      assert.equal(element('#openrouter-key-settings').hidden, true);
    }
    // This diagnostic is independent of provider selection and raw JSON updates.
    ready('Last verified action: neutral, 2 tics (1 → 3)');
    assert.equal(element('#collision-evidence').textContent, 'Last verified action: neutral, 2 tics (1 → 3)');
    ready();
    assert.equal(element('#collision-evidence').textContent, 'No verified action yet.');
    const calls = session.controller.next.mock.calls.length;
    element('.advanced').dispatchEvent(new Event('toggle'));
    element('.advanced').dispatchEvent(new Event('toggle'));
    assert.equal(session.controller.next.mock.calls.length, calls);
    assert.equal(h.transport.mock.calls.length, 0);
    assert.equal(h.worker.mock.calls.length, 0);
    assert.equal(h.history.replaceState.mock.calls.length, 0);
    assert.equal(h.location.href, callback + '?code=unrelated&state=unrelated');
    vi.clearAllMocks();
  }
});

it('rejects invalid settings and Jev/OpenAI conflicts before OAuth or controller startup', async () => {
  for (const [dev, mode, setting, load] of [
    [true, 'development', 'private-invalid-value', () => import('../src/main.ts?invalid-dev-test')],
    [false, 'production', 'private-invalid-value', () => import('../src/main.ts?invalid-production-test')],
    [true, 'jev', 'private-invalid-value', () => import('../src/main.ts?invalid-jev-test')],
    [true, 'jev', 'openai', () => import('../src/main.ts?conflicting-jev-test')],
  ] as const) {
    vi.stubEnv('DEV', dev); vi.stubEnv('MODE', mode); vi.stubEnv('VITE_DECISION_PROVIDER', setting);
    const h = browserFixture(`?code=offline-code&state=${nonce}`, true);
    await assert.rejects(load(), (error: Error) => {
      assert.match(error.message, /VITE_DECISION_PROVIDER/);
      assert.doesNotMatch(error.message, /private-invalid-value/);
      return true;
    });
    assert.match(h.element('#status').textContent, /^Startup failed:/);
    assert.doesNotMatch(h.element('#status').textContent, /private-invalid-value/);
    assert.equal(h.storage.getItem.mock.calls.length, 0);
    assert.equal(h.storage.removeItem.mock.calls.length, 0);
    assert.equal(h.transport.mock.calls.length, 0);
    assert.equal(h.worker.mock.calls.length, 0);
    assert.equal(session.controller.initialize.mock.calls.length, 0);
  }
});

it('returns an OAuth key through the existing port only on an explicit decision, never through DOM/storage', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture(`?code=offline-code&state=${nonce}`, true);
  await import('../src/main.ts?oauth-handoff-test');
  await settleStartup();
  const create = vi.spyOn(session.factory, 'create');
  assert.equal(h.history.replaceState.mock.calls.length, 1);
  assert.equal(h.transport.mock.calls.length, 1);
  assert.equal(h.location.href, callback + '?view=wide#prompt');
  assert.equal(h.values.size, 0);
  assert.equal(h.element('#key').value, '');
  assert.equal(h.element('#openrouter-signin-label').textContent, 'OpenRouter sign-in complete');
  assert.equal(h.element('#openrouter-signin-button').disabled, true);
  assert.equal(h.element('#openrouter-signin-button').attributes.get('aria-busy'), 'false');
  assert.equal(h.element('#openrouter-signin-button').contains(h.element('#openrouter-signin-logo')), true);
  assert.match(h.element('#openrouter-auth-status').textContent, /key received/);
  assert.equal(h.element('#openrouter-model').disabled, false);
  for (const id of ['#iwad', '#iwad-picker', '#included-freedoom']) assert.equal(h.element(id).disabled, false, 'OAuth key enables selection');
  h.element('#openrouter-model-jev').checked = true;
  h.element('#openrouter-model-jev').dispatchEvent(new Event('change'));
  assert.equal(h.element('#openrouter-model-gpt').checked, false);
  assert.equal(h.element('#openrouter-model-help').textContent, '');
  assert.match(h.element('#sdk').textContent, /configured model: typesafe\/jev-1\.14.*access unverified/);
  assert.doesNotMatch(h.element('#sdk').textContent, /gpt-6/);
  assert.equal(h.storage.setItem.mock.calls.length, 0);
  assert.equal(create.mock.calls.length, 0);
  assert.equal(session.controller.prepare.mock.calls.length, 0);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
  ready();
  assert.equal(h.element('#next').disabled, false, 'Pending memory key enables explicit admission');
  assert.equal(h.element('#openrouter-signin-button').disabled, true);
  // The unchanged controller does this on admission; mock only its native work.
  session.controller.next.mockImplementation(() => session.factory.create(session.ports.takeKey()));
  h.element('#next').dispatchEvent(new Event('click'));
  assert.deepEqual(create.mock.calls, [[minted]]);
  assert.equal(h.element('#openrouter-model').disabled, true);
  assert.equal(h.element('#openrouter-model-help').textContent, 'Model locked for this session. Refresh to choose again.');
  assert.equal(session.ports.takeKey(), '', 'One-time handoff; retained-client logic remains in controller');
  assert.equal(h.element('#key').value, '');
});

it('explicit production OpenAI leaves even an owned OAuth callback and pending storage untouched', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', 'openai');
  const h = browserFixture(`?code=offline-code&state=${nonce}`, true);
  await import('../src/main.ts?openai-owned-callback-test');
  await settleStartup();
  assert.equal(session.factory, openAiDecisionProviderFactory);
  assert.equal(h.storage.getItem.mock.calls.length, 0);
  assert.equal(h.storage.removeItem.mock.calls.length, 0);
  assert.equal(h.storage.setItem.mock.calls.length, 0);
  assert.equal(h.values.has(pendingKey), true);
  assert.equal(h.history.replaceState.mock.calls.length, 0);
  assert.equal(h.transport.mock.calls.length, 0);
  assert.equal(h.location.href, callback + `?code=offline-code&state=${nonce}`);
});

it('allows manual model selection until successful construction, then retains the frozen model through errors and continuous/Stop states', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  await import('../src/main.ts?model-manual-freeze-test');
  await settleStartup();
  session.factory.probe();
  const choose = (id) => {
    h.element(id).checked = true;
    h.element(id).dispatchEvent(new Event('change'));
  };
  choose('#openrouter-model-jev');
  assert.equal(h.element('#openrouter-model-gpt').checked, true, 'Unavailable before connection');
  h.element('#openrouter-manual').dispatchEvent(new Event('click'));
  choose('#openrouter-model-jev');
  assert.equal(h.element('#openrouter-model').disabled, false);
  assert.equal(h.element('#openrouter-signin').hidden, true);
  assert.equal(h.element('#openrouter-connect').hidden, false);
  assert.match(h.element('#sdk').textContent, /configured model: typesafe\/jev-1\.14/);
  h.element('#openrouter-back').dispatchEvent(new Event('click'));
  assert.equal(h.element('#openrouter-model-gpt').checked, true, 'Sign-in starts fresh setup');
  assert.equal(h.element('#openrouter-model').disabled, true);
  h.element('#openrouter-manual').dispatchEvent(new Event('click'));
  choose('#openrouter-model-jev');
  assert.throws(() => session.factory.create('bad key'));
  assert.equal(h.element('#openrouter-model').disabled, false, 'Failed construction does not lock');
  choose('#openrouter-model-gpt');
  assert.match(h.element('#sdk').textContent, /configured model: openai\/gpt-6-luna-decisions/);
  choose('#openrouter-model-jev');
  ready();
  for (const state of [{ phase: 'busy' }, { phase: 'ready', continuous: { active: true } }]) {
    session.ports.present({ session: {
      hasClient: false, prepared: true, verifiedTics: 1, evidence: { decisions: [] },
      controls: { ready: false, stop: false, tics: false, iwad: false }, ...state,
    } });
    choose('#openrouter-model-gpt');
    assert.equal(h.element('#openrouter-model').disabled, true);
    assert.equal(h.element('#openrouter-model-jev').checked, true);
  }
  ready();
  const evidence = JSON.parse(h.element('#evidence').textContent);
  assert.equal(evidence.sdk.configuredModel, 'typesafe/jev-1.14');
  assert.equal(evidence.sdk.modelAccess, 'unverified by SDK probe');
  assert.equal(session.controller.prepare.mock.calls.length, 0);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
  assert.equal(h.transport.mock.calls.length, 0);
  assert.equal(h.storage.setItem.mock.calls.length, 0);

  const sdk = vi.spyOn(Decisions.prototype, 'create').mockResolvedValue({
    answers: { next_action: { type: 'choice', choice: 'neutral' } },
  } as never);
  const retained = session.factory.create('offline-manual-dummy');
  assert.equal(sdk.mock.calls.length, 0, 'Construction is inert');
  assert.equal(h.element('#openrouter-model').disabled, true);
  assert.equal(h.element('#openrouter-model-help').textContent, 'Model locked for this session. Refresh to choose again.');
  for (const state of [
    { phase: 'busy' },
    { phase: 'ready', continuous: { active: true } },
    { phase: 'ready', continuous: { active: true, stopRequested: true }, waitingForSdk: true },
    { phase: 'ready', continuous: { active: false } },
    { phase: 'error', hasClient: false },
  ]) {
    session.ports.present({ session: {
      phase: 'ready', hasClient: true, prepared: true, verifiedTics: 1,
      evidence: { sdk: { provider: 'OpenRouter', version: '1.4.25' }, decisions: [] },
      controls: { ready: true, stop: false, tics: true, iwad: false }, ...state,
    } });
    choose('#openrouter-model-gpt');
    assert.equal(h.element('#openrouter-model').disabled, true);
    assert.equal(h.element('#openrouter-model-jev').checked, true);
    assert.doesNotMatch(h.element('#sdk').textContent, /gpt-6/);
  }
  const request = {
    context: 'offline context', instructions: 'offline instructions',
    png: 'data:image/png;base64,iVBORw0KGgo=', permittedActions: ['neutral'] as const,
  };
  const hooks = { assertFresh() {}, beforeCreate() {}, onReadStateChange() {} };
  // Retained and replacement clients both close over the locked selection.
  for (const provider of [retained, session.factory.create('offline-replacement-dummy')]) {
    const lifecycle = {};
    await provider.request(request, lifecycle, { requestId: null, http: null, latencyMs: null }, hooks, performance.now());
    await lifecycle.sdkRead;
  }
  assert.deepEqual(sdk.mock.calls.map(([request]) => request.decisionsRequest.model), ['typesafe/jev-1.14', 'typesafe/jev-1.14']);
  h.window.dispatchEvent(new Event('pagehide'));
  choose('#openrouter-model-gpt');
  assert.equal(h.element('#openrouter-model-jev').checked, true);
  assert.equal(h.element('#openrouter-model').disabled, true);
  assert.equal(h.transport.mock.calls.length, 0);
});

it('production page exit clears a received OAuth key without admitting Decisions', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture(`?code=offline-code&state=${nonce}`, true);
  const create = vi.spyOn(Decisions.prototype, 'create');
  await import('../src/main.ts?oauth-exit-after-exchange-test');
  await settleStartup();
  assert.match(h.element('#openrouter-auth-status').textContent, /key received/);
  assert.equal(h.element('#openrouter-model').disabled, false);
  h.window.dispatchEvent(new Event('pagehide'));
  assert.equal(h.element('#openrouter-model').disabled, true);
  h.element('#openrouter-model-jev').checked = true;
  h.element('#openrouter-model-jev').dispatchEvent(new Event('change'));
  assert.equal(h.element('#openrouter-model-gpt').checked, true);
  assert.equal(session.ports.takeKey(), '');
  assert.equal(h.values.size, 0);
  assert.equal(session.controller.close.mock.calls.length, 1);
  assert.equal(create.mock.calls.length, 0);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
});

it.each([
  ['local', 'manual', 'typesafe/jev-1.14', () => import('../src/main.ts?local-manual-model-after-prepare')],
  ['included', 'manual', 'openai/gpt-6-luna-decisions', () => import('../src/main.ts?included-manual-model-after-prepare')],
  ['local', 'oauth', 'openai/gpt-6-luna-decisions', () => import('../src/main.ts?local-oauth-model-after-prepare')],
  ['included', 'oauth', 'typesafe/jev-1.14', () => import('../src/main.ts?included-oauth-model-after-prepare')],
] as const)('keeps model choice open after %s preparation with %s credentials until first decision', async (source, auth, model, load) => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture(auth === 'oauth' ? `?code=offline-code&state=${nonce}` : '', auth === 'oauth');
  const fetch = vi.fn(() => assert.fail('No asset or live API fetch in this fixture'));
  vi.stubGlobal('fetch', fetch);
  await load();
  await settleStartup();
  if (auth === 'manual') {
    h.element('#openrouter-manual').dispatchEvent(new Event('click'));
    assert.equal(h.element('#key').disabled, false);
    h.element('#key').value = 'offline-manual-selection';
    h.element('#key').dispatchEvent(new Event('input'));
  }
  for (const id of ['#iwad', '#iwad-picker', '#included-freedoom']) assert.equal(h.element(id).disabled, false);
  const create = vi.spyOn(session.factory, 'create');
  session.controller.prepare.mockImplementation(() => {
    session.ports.present({ session: {
      phase: 'preparing', prepared: false, hasClient: false, verifiedTics: 0,
      evidence: { decisions: [] }, controls: { ready: false, stop: false, tics: false, iwad: false },
    } });
    return Promise.resolve();
  });
  if (source === 'local') {
    h.element('#iwad').files = [{ name: 'offline-local.wad' }];
    h.element('#iwad').dispatchEvent(new Event('change'));
  } else h.element('#included-freedoom').dispatchEvent(new Event('click'));
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  for (const id of ['#iwad', '#iwad-picker', '#included-freedoom', '#key']) assert.equal(h.element(id).disabled, true);
  assert.equal(h.element('#prepared-asset').hidden, true);
  ready();
  assert.equal(h.element('#prepared-asset').hidden, false);
  assert.equal(create.mock.calls.length, 0);
  assert.equal(h.element('#openrouter-model').disabled, false);
  const choose = (id) => {
    h.element(id).checked = true;
    h.element(id).dispatchEvent(new Event('change'));
  };
  // Change after preparation, including away from and back to the default model.
  choose('#openrouter-model-jev');
  if (model === 'openai/gpt-6-luna-decisions') choose('#openrouter-model-gpt');
  assert.match(h.element('#sdk').textContent, new RegExp(`configured model: ${model.replaceAll('.', '\\.')}`));
  assert.equal(h.element('#openrouter-model-help').textContent, '');
  const sdk = vi.spyOn(Decisions.prototype, 'create').mockResolvedValue({
    answers: { next_action: { type: 'choice', choice: 'neutral' } },
  } as never);
  let decision;
  const lifecycle = {};
  session.controller.next.mockImplementation(() => {
    const provider = session.factory.create(session.ports.takeKey());
    decision = provider.request({
      context: 'offline context', instructions: 'offline instructions',
      png: 'data:image/png;base64,iVBORw0KGgo=', permittedActions: ['neutral'],
    }, lifecycle, { requestId: null, http: null, latencyMs: null },
    { assertFresh() {}, beforeCreate() {}, onReadStateChange() {} }, performance.now());
    return decision;
  });
  h.element('#next').dispatchEvent(new Event('click'));
  await decision;
  await lifecycle.sdkRead;
  assert.deepEqual(create.mock.calls, [[auth === 'oauth' ? minted : 'offline-manual-selection']]);
  assert.equal(sdk.mock.calls.length, 1);
  assert.equal(sdk.mock.calls[0][0].decisionsRequest.model, model);
  assert.equal(h.element('#openrouter-model').disabled, true);
  assert.match(h.element('#openrouter-model-help').textContent, /Model locked/);
  choose(model === 'typesafe/jev-1.14' ? '#openrouter-model-gpt' : '#openrouter-model-jev');
  assert.equal(h.element(model === 'typesafe/jev-1.14' ? '#openrouter-model-jev' : '#openrouter-model-gpt').checked, true);
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
  assert.equal(h.transport.mock.calls.length, auth === 'oauth' ? 1 : 0, 'Only fake OAuth exchange transport');
});

it('manual replacements discard unused OAuth keys, including invalid candidates; retirement clears memory', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture(`?code=offline-code&state=${nonce}`, true);
  await import('../src/main.ts?oauth-manual-precedence-test');
  await settleStartup();
  ready();
  h.element('#openrouter-manual').dispatchEvent(new Event('click'));
  assert.equal(document.activeElement, h.element('#key'));
  h.element('#key').value = '  invalid manual replacement  ';
  assert.equal(session.ports.takeKey(), 'invalid manual replacement');
  assert.equal(session.ports.takeKey(), '');
  assert.equal(h.element('#key').value, '');

  const retired = browserFixture(`?code=offline-code&state=${nonce}`, true);
  await import('../src/main.ts?oauth-retirement-test');
  await settleStartup();
  session.ports.clearKey();
  assert.equal(session.ports.takeKey(), '');
  assert.doesNotMatch(retired.element('#openrouter-auth-status').textContent, /received/);
});

it('blocks duplicate sign-in and WAD preparation while connecting and after WAD selection', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  await import('../src/main.ts?oauth-setup-only-test');
  await settleStartup();
  const signinButton = h.element('#openrouter-signin-button');
  const signinLogo = h.element('#openrouter-signin-logo');
  assert.equal(h.element('#openrouter-signin-label').textContent, 'Sign in with OpenRouter');
  assert.equal(signinButton.disabled, false);
  assert.equal(signinButton.attributes.get('aria-busy'), 'false');
  signinButton.dispatchEvent(new Event('click'));
  assert.equal(h.element('#openrouter-signin-label').textContent, 'Connecting…');
  assert.equal(signinButton.disabled, true);
  assert.equal(signinButton.attributes.get('aria-busy'), 'true');
  assert.equal(signinButton.contains(signinLogo), true);
  signinButton.dispatchEvent(new Event('click'));
  h.element('#openrouter-model-jev').checked = true;
  h.element('#openrouter-model-jev').dispatchEvent(new Event('change'));
  assert.equal(h.element('#openrouter-model').disabled, true);
  assert.equal(h.element('#openrouter-model-gpt').checked, true);
  assert.equal(h.element('#iwad').disabled, true);
  assert.equal(h.element('#included-freedoom').disabled, true);
  assert.equal(h.element('#included-freedoom').textContent, 'Use included Freedoom');
  assert.equal(h.element('#included-freedoom').attributes.get('aria-busy'), 'false');
  h.element('#included-freedoom').dispatchEvent(new Event('click'));
  h.element('#iwad').files = [{}];
  h.element('#iwad').dispatchEvent(new Event('change'));
  await vi.waitFor(() => assert.equal(h.location.assign.mock.calls.length, 1));
  assert.equal(session.controller.prepare.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
  assert.equal(h.transport.mock.calls.length, 0);
  h.window.dispatchEvent(new Event('pagehide'));
  h.element('#openrouter-model-jev').checked = true;
  h.element('#openrouter-model-jev').dispatchEvent(new Event('change'));
  assert.equal(h.element('#openrouter-model').disabled, true);
  assert.equal(h.element('#openrouter-model-gpt').checked, true);
  assert.equal(h.values.has(pendingKey), true);

  const selected = browserFixture();
  await import('../src/main.ts?oauth-after-wad-test');
  await settleStartup();
  selected.element('#openrouter-manual').dispatchEvent(new Event('click'));
  selected.element('#key').value = 'offline-selection-key';
  selected.element('#key').dispatchEvent(new Event('input'));
  selected.element('#iwad').files = [{}];
  selected.element('#iwad').dispatchEvent(new Event('change'));
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  assert.equal(selected.element('#openrouter-signin-button').disabled, true);
  selected.element('#openrouter-signin-button').dispatchEvent(new Event('click'));
  await settleStartup();
  assert.equal(selected.location.assign.mock.calls.length, 0);
});

it('gates both IWAD choices on usable manual credentials, then shares admission and retry locks', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  const fetch = vi.fn(() => assert.fail('No asset or provider fetch before the admitted file read'));
  vi.stubGlobal('fetch', fetch);
  await import('../src/main.ts?included-freedoom-controls-test');
  await settleStartup();
  assert.equal(h.element('#openrouter-signin-button').disabled, false);
  for (const id of ['#iwad', '#iwad-picker', '#included-freedoom']) assert.equal(h.element(id).disabled, true);
  h.element('#iwad').click = vi.fn();
  const trySelection = () => {
    h.element('#iwad-picker').dispatchEvent(new Event('click'));
    h.element('#included-freedoom').dispatchEvent(new Event('click'));
    h.element('#iwad').files = [{ name: 'blocked.wad' }];
    h.element('#iwad').dispatchEvent(new Event('change'));
    assert.equal(h.element('#iwad').click.mock.calls.length, 0);
    assert.equal(session.controller.prepare.mock.calls.length, 0);
  };
  trySelection();
  h.element('#openrouter-manual').dispatchEvent(new Event('click'));
  assert.equal(h.element('#key').disabled, false);
  for (const value of ['   ', 'invalid key', 'bad\u0001key', 'badékey']) {
    h.element('#key').value = value;
    h.element('#key').dispatchEvent(new Event('input'));
    for (const id of ['#iwad', '#iwad-picker', '#included-freedoom']) assert.equal(h.element(id).disabled, true);
    trySelection();
  }
  h.element('#key').value = '  offline-selection-key  ';
  h.element('#key').dispatchEvent(new Event('input'));
  for (const id of ['#iwad', '#iwad-picker', '#included-freedoom']) assert.equal(h.element(id).disabled, false);
  h.element('#iwad-picker').dispatchEvent(new Event('click'));
  assert.equal(h.element('#iwad').click.mock.calls.length, 1);
  const button = h.element('#included-freedoom');
  assert.equal(button.textContent, 'Use included Freedoom');
  assert.equal(button.attributes.get('aria-busy'), 'false');
  assert.equal(session.controller.prepare.mock.calls.length, 0);
  const present = (phase, iwad) => session.ports.present({ session: {
    phase, prepared: phase === 'ready', hasClient: false, verifiedTics: 0,
    evidence: { decisions: [] }, controls: { ready: phase === 'ready', stop: false, tics: false, iwad },
  } });
  session.controller.prepare.mockImplementation(() => { present('preparing', false); return Promise.resolve(); });
  h.element('#included-freedoom').dispatchEvent(new Event('click'));
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  const [file] = session.controller.prepare.mock.calls[0];
  assert.equal(file.size, 28795076);
  assert.equal(typeof file.arrayBuffer, 'function');
  assert.equal(h.element('#openrouter-signin-button').disabled, true);
  assert.match(h.element('#setup-asset').textContent, /Included Freedoom Phase 1 v0.13.0/);
  assert.equal(button.textContent, 'Loading Doom…');
  assert.equal(button.attributes.get('aria-busy'), 'true');
  present('unprepared', true);
  session.ports.clearKey(); // Real preparation failure retires the attempt and clears credentials.
  for (const id of ['#iwad', '#iwad-picker', '#included-freedoom']) assert.equal(h.element(id).disabled, true);
  assert.equal(h.element('#key').disabled, false, 'Retryable failure leaves manual credentials editable');
  h.element('#key').value = 'offline-retry-key';
  h.element('#key').dispatchEvent(new Event('input'));
  for (const id of ['#iwad', '#included-freedoom']) assert.equal(h.element(id).disabled, false);
  assert.equal(button.textContent, 'Use included Freedoom');
  assert.equal(button.attributes.get('aria-busy'), 'false');
  assert.equal(h.element('#openrouter-signin-button').disabled, true, 'Existing post-admission auth semantics remain');
  h.element('#iwad').files = [{ name: 'local.wad' }];
  h.element('#iwad').dispatchEvent(new Event('change'));
  assert.equal(session.controller.prepare.mock.calls.length, 2);
  assert.match(h.element('#setup-asset').textContent, /local.wad/);
  assert.equal(button.textContent, 'Loading Doom…');
  assert.equal(button.attributes.get('aria-busy'), 'true');
  for (const phase of ['preparing', 'ready', 'busy', 'error', 'terminal']) {
    present(phase, false);
    for (const id of ['#iwad', '#included-freedoom']) assert.equal(h.element(id).disabled, true);
    assert.equal(button.textContent, phase === 'preparing' ? 'Loading Doom…' : 'Doom loaded');
    assert.equal(button.attributes.get('aria-busy'), String(phase === 'preparing'));
    h.element('#included-freedoom').dispatchEvent(new Event('click'));
    h.element('#iwad').files = [{ name: 'local.wad' }];
    h.element('#iwad').dispatchEvent(new Event('change'));
    assert.equal(session.controller.prepare.mock.calls.length, 2);
  }
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
});

it('preserves the Freedoom host label during credential focusout and admits one delivered click', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  const fetch = vi.fn(() => assert.fail('No asset or provider fetch in the focusout fixture'));
  vi.stubGlobal('fetch', fetch);
  await import('../src/main.ts?included-freedoom-focusout-test');
  await settleStartup();
  h.element('#openrouter-manual').dispatchEvent(new Event('click'));
  const key = h.element('#key'), button = h.element('#included-freedoom');
  key.value = 'offline-focusout-key';
  key.dispatchEvent(new Event('input'));
  key.focus();
  assert.equal(button.textContent, 'Use included Freedoom');
  assert.equal(button.disabled, false);
  assert.equal(button.attributes.get('aria-busy'), 'false');
  const labelWrites = vi.spyOn(button, 'textContent', 'set');

  // Explicit event delivery models the refresh sequence, not native pointer targeting.
  h.document.dispatchEvent(new Event('pointerdown'));
  key.dispatchEvent(new Event('change'));
  button.focus();
  h.element('#setup').dispatchEvent(Object.assign(new Event('focusout'), {
    relatedTarget: button,
  }));
  assert.equal(labelWrites.mock.calls.length, 0, 'Unchanged slotted text must not be replaced');
  assert.equal(button.disabled, false);
  assert.equal(button.attributes.get('aria-busy'), 'false');
  assert.equal(session.controller.prepare.mock.calls.length, 0);

  session.controller.prepare.mockImplementation(() => {
    session.ports.present({ session: {
      phase: 'preparing', prepared: false, hasClient: false, verifiedTics: 0,
      evidence: { decisions: [] }, controls: { ready: false, stop: false, tics: false, iwad: false },
    } });
    return Promise.resolve();
  });
  button.dispatchEvent(new Event('click'));
  h.document.dispatchEvent(new Event('click'));
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  assert.deepEqual(labelWrites.mock.calls, [['Loading Doom…']]);
  assert.equal(button.textContent, 'Loading Doom…');
  assert.equal(button.attributes.get('aria-busy'), 'true');
  assert.equal(button.disabled, true);
  assert.equal(button.hidden, false);
  button.dispatchEvent(new Event('click'));
  assert.equal(session.controller.prepare.mock.calls.length, 1, 'Duplicate click stays fenced');
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(h.transport.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
});

it('clears the loading presentation after preparation fails and requires reload', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  await import('../src/main.ts?included-freedoom-loading-failure-test');
  await settleStartup();
  h.element('#openrouter-manual').dispatchEvent(new Event('click'));
  h.element('#key').value = 'offline-selection-key';
  h.element('#key').dispatchEvent(new Event('input'));
  const present = phase => session.ports.present({ session: {
    phase, prepared: false, hasClient: false, verifiedTics: 0,
    evidence: { decisions: [] }, controls: { ready: false, stop: false, tics: false, iwad: false },
  } });
  session.controller.prepare.mockImplementation(() => { present('preparing'); return Promise.resolve(); });
  const button = h.element('#included-freedoom');
  button.dispatchEvent(new Event('click'));
  assert.equal(button.textContent, 'Loading Doom…');
  assert.equal(button.attributes.get('aria-busy'), 'true');
  present('error');
  assert.equal(button.textContent, 'Reload to retry');
  assert.equal(button.attributes.get('aria-busy'), 'false');
  assert.equal(button.disabled, true);
  button.dispatchEvent(new Event('click'));
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  assert.equal(h.worker.mock.calls.length, 0);
});

it('shows fixed failure/cancellation status and preserves manual fallback with no native work', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture('?error=access_denied', true);
  const openAi = vi.spyOn(openAiDecisionProviderFactory, 'create').mockImplementation(() => {
    assert.fail('OAuth failure must not select OpenAI');
  });
  await import('../src/main.ts?oauth-denied-ui-test');
  await settleStartup();
  assert.match(h.element('#openrouter-auth-status').textContent, /not completed/);
  assert.equal(h.element('#openrouter-signin-button').disabled, false);
  h.element('#openrouter-manual').dispatchEvent(new Event('click'));
  assert.equal(h.element('#manual-key').hidden, false);
  assert.equal(h.transport.mock.calls.length, 0);

  const failed = browserFixture(`?code=offline-code&state=${nonce}`, true);
  failed.transport.mockRejectedValue(Error('private server details'));
  await import('../src/main.ts?oauth-failed-ui-test');
  await settleStartup();
  assert.equal(failed.element('#openrouter-auth-status').textContent,
    'OpenRouter key exchange failed. Try again or use an API key.');
  assert.equal(failed.element('#openrouter-signin-button').disabled, false);
  assert.equal(session.controller.prepare.mock.calls.length, 0);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(failed.worker.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
  assert.deepEqual(session.factory.probe().evidence, { provider: 'OpenRouter', version: '1.4.25' });
  assert.equal(openAi.mock.calls.length, 0);
});

it('scrubs owned returns before Canvas startup failure and never exchanges on that failure', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture(`?code=offline-code&state=${nonce}`, true);
  h.element('#screen').getContext = () => null;
  await assert.rejects(import('../src/main.ts?oauth-startup-failure-test'), /Canvas/);
  assert.equal(h.history.replaceState.mock.calls.length, 1);
  assert.equal(h.values.size, 0);
  assert.equal(h.transport.mock.calls.length, 0);
});

it('pagehide during exchange aborts and prevents late key/initialization restoration', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture(`?code=offline-code&state=${nonce}`, true);
  let resolve!: (response: Response) => void;
  h.transport.mockImplementation(() => new Promise(done => { resolve = done; }));
  await import('../src/main.ts?oauth-exit-during-exchange-test');
  assert.equal(h.transport.mock.calls.length, 1);
  assert.equal(h.element('#iwad').disabled, true);
  h.window.dispatchEvent(new Event('pagehide'));
  resolve(new Response(JSON.stringify({ key: minted })));
  await settleStartup();
  assert.equal(h.transport.mock.calls[0][1].signal.aborted, true);
  assert.equal(session.ports.takeKey(), '');
  assert.equal(session.controller.initialize.mock.calls.length, 0);
  assert.equal(h.element('#openrouter-signin-button').disabled, true);
  assert.doesNotMatch(h.element('#openrouter-auth-status').textContent, /received/);
  assert.equal(h.values.size, 0);
});

it('exposes watch/Stop and one-time start wiring without browser grant controls', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="allow-agent(?:-run)?"/);
  agent.enabled = true;
  agent.key = 'offline-agent-browser-dummy';
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'agent'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  await import('../src/main.ts?agent-watch-and-stop');
  session.ports.present({ iwadEnabled: true });
  ready();
  const ports = bridge.start.mock.calls[0][0];
  const handle = bridge.start.mock.results[0].value;
  assert.equal(ports.allow, undefined); assert.equal(ports.allowRun, undefined);
  assert.equal(session.ports.agentGrantRevoked, undefined);
  ports.state('available');
  assert.match(h.element('#agent-status').textContent, /\$doom-decisions play/);
  assert.equal(h.element('#stop-agent').hidden, false);
  assert.equal(h.element('#stop-agent').disabled, false);
  const scope = { sessionId: 'session', runId: 'broker-run', revision: 0, limit: 30 };
  const fresh = () => {};
  ports.startRun('epoch', 'observation', scope, fresh);
  assert.deepEqual(session.controller.startAgentRun.mock.calls, [['epoch', 'observation', scope, fresh]]);
  ports.state('run-unavailable');
  assert.match(h.element('#agent-status').textContent, /AGENT_DECISION_BUDGET/);
  assert.match(h.element('#agent-status').textContent, /Fully stop and relaunch dev:agent/);
  assert.match(h.element('#agent-status').textContent, /browser reload and Vite internal restart do not replenish/);
  h.element('#stop-agent').dispatchEvent(new Event('click'));
  assert.equal(handle.stop.mock.calls.length, 1);
  ports.state('stopped');
  assert.match(h.element('#agent-status').textContent, /Agent stopped.*safe cleanup/);
  assert.match(h.element('#agent-status').textContent, /Fully stop and relaunch dev:agent/);
  assert.equal(h.element('#stop-agent').hidden, true);
  assert.equal(session.controller.next.mock.calls.length, 0);
});

it('shows bounded allowance and routes ephemeral agent settings without writing human saved settings or drafts', async () => {
  agent.enabled = true;
  agent.key = 'offline-agent-browser-dummy';
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'agent'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  await import('../src/main.ts?agent-bounded-controls');
  session.ports.present({ iwadEnabled: true });
  ready();
  const ports = bridge.start.mock.calls[0][0];
  ports.state('attached');
  const authorization = { runId: '00000000-0000-0000-0000-000000000001', active: true, limit: 30, reserved: 1, sdkInvoked: 0, remaining: 29 };
  const present = state => session.ports.present({ session: {
    phase: 'ready', prepared: true, hasClient: true, verifiedTics: 1,
    evidence: { decisions: [] }, controls: { ready: true, stop: false, tics: true, iwad: false },
    agentAuthorization: state,
  } });
  present(authorization);
  assert.match(h.element('#agent-run-status').textContent, /29 of 30 attempts remaining · 1 reserved · 0 SDK calls started/);
  assert.equal(ports.allow, undefined); assert.equal(ports.allowRun, undefined);
  h.element('#prompt-dialog').open = false;
  assert.equal(session.ports.promptEditorOpen(), false);
  const saved = session.ports.readDecisionConfiguration();
  const n = session.ports.readTics();
  assert.equal(session.ports.saveDecisionInstructions, undefined, 'No agent-to-human Save callback');
  h.element('#prompt-instructions').value = 'Unsaved human instructions';
  h.element('#prompt-ammo').checked = !saved.includeAmmo;
  const scope = { sessionId: '00000000-0000-0000-0000-000000000002', runId: authorization.runId, revision: 0 };
  session.controller.agentPrompt.mockReturnValue({ sessionId: scope.sessionId, revision: 1,
    instructions: 'Temporary agent instructions', run: authorization });
  ports.prompt('epoch', scope.sessionId, () => {}, { ...scope, instructions: 'Temporary agent instructions' });
  const configuration = { ...saved, instructionTemplate: 'Temporary full settings', includeAmmo: true };
  session.controller.agentConfig.mockReturnValue({ sessionId: scope.sessionId, revision: 2, configuration, run: authorization });
  ports.config('epoch', scope.sessionId, () => {}, { ...scope, revision: 1, configuration });
  assert.equal(session.controller.agentConfig.mock.calls.length, 1);
  assert.equal(session.controller.agentPrompt.mock.calls.length, 1);
  assert.equal(session.ports.readDecisionConfiguration(), saved);
  assert.equal(h.element('#prompt-instructions').value, 'Unsaved human instructions');
  assert.equal(h.element('#prompt-ammo').checked, !saved.includeAmmo);
  assert.match(h.element('#agent-status').textContent, /temporary; human settings are retained/);
  assert.equal(session.ports.readTics(), n);
  h.element('#prompt-dialog').open = true;
  assert.equal(session.ports.promptEditorOpen(), true);
  present({ ...authorization, active: false, remaining: 0 });
  assert.match(h.element('#agent-run-status').textContent, /run ended · 0 of 30/);
  assert.match(h.element('#agent-run-status').textContent, /Fully stop and relaunch dev:agent/);
  present({ ...authorization, active: false, remaining: 0, reserved: 30, sdkInvoked: 29 });
  assert.match(h.element('#agent-run-status').textContent, /run exhausted · 0 of 30.*30 reserved · 29 SDK calls/);
  assert.match(h.element('#agent-run-status').textContent, /browser reload and Vite internal restart do not replenish/);
});

it('keeps human decisions disabled throughout Agent Mode and ignores synthetic human edits during an active run', async () => {
  agent.enabled = true;
  agent.key = 'offline-agent-browser-dummy';
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'agent'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  const humanControls = ['#tics', '#next', '#budget', '#start', '#stop', '#view-prompt'];
  // Start enabled so this checks the startup assignment, independently of HTML defaults.
  for (const id of humanControls) h.element(id).disabled = false;
  h.element('#prompt-dialog').open = false;
  const showModal = vi.fn();
  Object.assign(h.element('#prompt-dialog'), { showModal });
  const assertDisabled = () => {
    for (const id of humanControls) assert.equal(h.element(id).disabled, true, id);
  };
  await import('../src/main.ts?agent-human-controls');
  assertDisabled(); // No controller presentation or bounded run yet.
  session.ports.present({ iwadEnabled: true });
  assertDisabled();
  assert.equal(h.element('#included-freedoom').disabled, false, 'Preparation remains available');
  ready();
  assertDisabled(); // Ready before a bounded run also remains agent-owned.
  const ports = bridge.start.mock.calls[0][0];
  const authorization = { runId: 'run', active: true, limit: 30, reserved: 1, sdkInvoked: 1, remaining: 29 };
  for (const [phase, state] of [['busy', 'deciding'], ['ready', 'settled']]) {
    session.ports.present({ session: {
      phase, prepared: true, hasClient: true, verifiedTics: 1,
      evidence: { decisions: [] }, controls: { ready: true, stop: true, tics: true, iwad: false },
      agentAuthorization: authorization,
    } });
    ports.state(state);
    assertDisabled();
  }
  const saved = session.ports.readDecisionConfiguration();
  const accounting = h.element('#agent-run-status').textContent;
  for (const event of ['input', 'change']) {
    h.element('#tics').valueAsNumber = 12;
    h.element('#tics').dispatchEvent(new Event(event));
  }
  h.element('#budget').valueAsNumber = 99;
  for (const id of ['#next', '#start', '#stop', '#view-prompt'])
    h.element(id).dispatchEvent(new Event('click'));
  assert.equal(showModal.mock.calls.length, 0);
  assert.equal(h.element('#prompt-dialog').open, false);
  // Even forcing a dialog open cannot save or reset human settings in Agent Mode.
  h.element('#prompt-dialog').open = true;
  h.element('#prompt-instructions').value = 'Synthetic human edit';
  h.element('#prompt-ammo').checked = true;
  h.element('#reset-prompt').dispatchEvent(new Event('click'));
  assert.equal(h.element('#prompt-instructions').value, 'Synthetic human edit');
  h.element('#save-prompt').dispatchEvent(new Event('click'));
  assert.equal(session.ports.readDecisionConfiguration(), saved);
  for (const name of ['next', 'startContinuous', 'stop', 'configure'])
    assert.equal(session.controller[name].mock.calls.length, 0, name);
  assert.equal(h.element('#agent-run-status').textContent, accounting);
  assert.equal(h.element('#stop-agent').hidden, false);
  assert.equal(h.element('#stop-agent').disabled, false);
  h.element('#stop-agent').dispatchEvent(new Event('click'));
  assert.equal(bridge.start.mock.results[0].value.stop.mock.calls.length, 1);
  ports.state('stopped');
  ready();
  assertDisabled();
});
