// Config transformation and imported main with synthetic DOM/controller only.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, it, vi } from 'vitest';
import config from '../vite.config.js';
import { jevDecisionProviderFactory } from '../src/jev-decision-provider.ts';
import { openAiDecisionProviderFactory } from '../src/openai-decision-provider.ts';
import { openRouterDecisionProviderFactory } from '../src/openrouter-decision-provider.ts';

const session = vi.hoisted(() => ({
  ports: undefined, factory: undefined,
  controller: { initialize: vi.fn(), next: vi.fn(), startContinuous: vi.fn(), stop: vi.fn(),
    prepare: vi.fn(), close: vi.fn(), restore: vi.fn() },
}));
vi.mock('../src/session-controller', () => ({
  createSessionController: (ports, factory) => {
    session.ports = ports; session.factory = factory; return session.controller;
  },
}));
vi.mock('../src/decision-history', () => ({ createDecisionHistory: () => () => {} }));
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); vi.restoreAllMocks();
});

it('allows only the OpenRouter API origin in explicit development with no proxy', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sourcePolicy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(sourcePolicy, "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; worker-src 'self'; connect-src 'self' https://api.openai.com; base-uri 'none'; form-action 'none'");
  for (const env of [
    { command: 'serve', mode: 'openrouter' },
    { command: 'serve', mode: 'development' },
    { command: 'serve', mode: 'jev' },
    { command: 'serve', mode: 'impeccable' },
    { command: 'build', mode: 'production' },
    { command: 'build', mode: 'openrouter' },
    { command: 'serve', mode: 'openrouter', isPreview: true },
  ]) {
    vi.stubEnv('TYPESAFE_API_KEY', 'offline-server-dummy-only');
    const raw = config(env);
    const transformed = raw.plugins[0]?.transformIndexHtml(html) ?? html;
    const experimental = env.command === 'serve' && env.mode === 'openrouter' && !env.isPreview;
    const policy = transformed.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    assert.equal(policy.includes('https://openrouter.ai'), experimental);
    if (experimental) {
      assert.equal(raw.server?.proxy, undefined);
      assert.equal(transformed, html.replace(sourcePolicy, sourcePolicy.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'").replace('https://api.openai.com', 'https://openrouter.ai')));
    }
    if (env.command === 'build' || env.isPreview) assert.equal(transformed, html);
    if (env.mode === 'jev') {
      assert.match(transformed, /connect-src 'self';/);
      assert.equal(raw.server.proxy['/__jev'].target, 'https://api.typesafe.ai');
    }
    assert.deepEqual(raw.preview.proxy, {});
    assert.deepEqual(raw.worker, { format: 'es' });
  }
});

class Element extends EventTarget {
  value = ''; valueAsNumber = 2; disabled = true; hidden = false; open = true;
  textContent = ''; dataset = {}; files = [];
  getContext() { return {}; }
  querySelector() { return undefined; }
  contains() { return false; }
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
  element('#key-label').textContent = 'Temporary OpenAI API key';
  element('#openrouter-connect').hidden = true;
  element('#openrouter-back').hidden = true;
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
  return { element, document, window, storage, values, location, history, transport, worker };
}

async function settleStartup() {
  // Flush the caught auth/bootstrap promises, without timers or real transport.
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function ready() {
  session.ports.present({ session: {
    phase: 'ready', prepared: true, hasClient: false, verifiedTics: 1,
    evidence: { decisions: [] }, controls: { ready: true, stop: false, tics: true, iwad: false },
  } });
}

it('selects the provider at the app edge, labels BYOK truthfully and retains capture/replacement semantics', async () => {
  // Do not reset imported provider modules: compare the actual injected factory.
  for (const [dev, mode, expected, load] of [
    [true, 'openrouter', openRouterDecisionProviderFactory, () => import('../src/main.ts?openrouter-test')],
    [true, 'jev', jevDecisionProviderFactory, () => import('../src/main.ts?jev-test')],
    [true, 'development', openAiDecisionProviderFactory, () => import('../src/main.ts?default-test')],
    [false, 'openrouter', openAiDecisionProviderFactory, () => import('../src/main.ts?production-test')],
  ] as const) {
    vi.stubEnv('DEV', dev); vi.stubEnv('MODE', mode);
    const h = browserFixture('?code=unrelated&state=unrelated');
    const { element } = h;
    // Literal query imports re-evaluate only the app entry per mode.
    await load();
    await settleStartup();
    assert.equal(session.factory, expected);
    if (dev && mode === 'openrouter') {
      assert.equal(element('#key-label').textContent, 'Temporary OpenRouter API key');
      assert.match(element('#key-note').textContent, /key, screenshot, context, instructions and choices.*OpenRouter.*downstream provider/);
      assert.equal(element('#openrouter-connect').hidden, false);
      assert.equal(element('#manual-key').hidden, true);
      assert.equal(element('#key').hidden, true);
      element('#openrouter-manual').dispatchEvent(new Event('click'));
      assert.equal(element('#manual-key').hidden, false);
      assert.equal(element('#openrouter-signin').hidden, true);
      assert.equal(element('#openrouter-manual').attributes.get('aria-expanded'), 'true');
      assert.equal(document.activeElement, element('#openrouter-back'));
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
    } else if (mode === 'jev') {
      assert.equal(element('#key').hidden, true);
      assert.equal(session.ports.takeKey(), 'jev-vite-proxy-not-a-credential');
    } else assert.equal(element('#key-label').textContent, 'Temporary OpenAI API key');
    if (!(dev && mode === 'openrouter')) {
      assert.equal(h.storage.getItem.mock.calls.length, 0);
      assert.equal(h.storage.removeItem.mock.calls.length, 0);
      assert.equal(element('#openrouter-connect').hidden, true);
      assert.equal(element('#openrouter-back').hidden, true);
    }
    assert.equal(h.transport.mock.calls.length, 0);
    assert.equal(h.worker.mock.calls.length, 0);
    assert.equal(h.history.replaceState.mock.calls.length, 0);
    assert.equal(h.location.href, callback + '?code=unrelated&state=unrelated');
    vi.clearAllMocks();
  }
});

it('returns an OAuth key through the existing port only on an explicit decision, never through DOM/storage', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'openrouter');
  const h = browserFixture(`?code=offline-code&state=${nonce}`, true);
  const create = vi.spyOn(openRouterDecisionProviderFactory, 'create');
  await import('../src/main.ts?oauth-handoff-test');
  await settleStartup();
  assert.equal(h.history.replaceState.mock.calls.length, 1);
  assert.equal(h.transport.mock.calls.length, 1);
  assert.equal(h.location.href, callback + '?view=wide#prompt');
  assert.equal(h.values.size, 0);
  assert.equal(h.element('#key').value, '');
  assert.match(h.element('#openrouter-auth-status').textContent, /key received/);
  assert.equal(create.mock.calls.length, 0);
  assert.equal(session.controller.prepare.mock.calls.length, 0);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
  ready();
  assert.equal(h.element('#next').disabled, false, 'Pending memory key enables explicit admission');
  assert.equal(h.element('#openrouter-signin-button').disabled, true);
  // The unchanged controller does this on admission; mock only its native work.
  create.mockImplementation(() => ({ request: vi.fn() }));
  session.controller.next.mockImplementation(() => session.factory.create(session.ports.takeKey()));
  h.element('#next').dispatchEvent(new Event('click'));
  assert.deepEqual(create.mock.calls, [[minted]]);
  assert.equal(session.ports.takeKey(), '', 'One-time handoff; retained-client logic remains in controller');
  assert.equal(h.element('#key').value, '');
});

it('manual replacements discard unused OAuth keys, including invalid candidates; retirement clears memory', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'openrouter');
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
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'openrouter');
  const h = browserFixture();
  await import('../src/main.ts?oauth-setup-only-test');
  await settleStartup();
  assert.equal(h.element('#openrouter-signin-button').disabled, false);
  h.element('#openrouter-signin-button').dispatchEvent(new Event('click'));
  h.element('#openrouter-signin-button').dispatchEvent(new Event('click'));
  assert.equal(h.element('#iwad').disabled, true);
  h.element('#iwad').files = [{}];
  h.element('#iwad').dispatchEvent(new Event('change'));
  await vi.waitFor(() => assert.equal(h.location.assign.mock.calls.length, 1));
  assert.equal(session.controller.prepare.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
  assert.equal(h.transport.mock.calls.length, 0);
  h.window.dispatchEvent(new Event('pagehide'));
  assert.equal(h.values.has(pendingKey), true);

  const selected = browserFixture();
  await import('../src/main.ts?oauth-after-wad-test');
  await settleStartup();
  selected.element('#iwad').files = [{}];
  selected.element('#iwad').dispatchEvent(new Event('change'));
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  assert.equal(selected.element('#openrouter-signin-button').disabled, true);
  selected.element('#openrouter-signin-button').dispatchEvent(new Event('click'));
  await settleStartup();
  assert.equal(selected.location.assign.mock.calls.length, 0);
});

it('shows fixed failure/cancellation status and preserves manual fallback with no native work', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'openrouter');
  const h = browserFixture('?error=access_denied', true);
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
});

it('scrubs owned returns before Canvas startup failure and never exchanges on that failure', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'openrouter');
  const h = browserFixture(`?code=offline-code&state=${nonce}`, true);
  h.element('#screen').getContext = () => null;
  await assert.rejects(import('../src/main.ts?oauth-startup-failure-test'), /Canvas/);
  assert.equal(h.history.replaceState.mock.calls.length, 1);
  assert.equal(h.values.size, 0);
  assert.equal(h.transport.mock.calls.length, 0);
});

it('pagehide during exchange aborts and prevents late key/initialization restoration', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'openrouter');
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
