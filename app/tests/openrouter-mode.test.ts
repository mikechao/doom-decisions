// Config transformation and imported main with synthetic DOM/controller only.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Decisions } from '@openrouter/sdk/sdk/decisions.js';
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
vi.mock('../src/decision-history', () => ({ defineDecisionHistory: () => {} }));
afterEach(() => {
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
  element('#key-label').textContent = 'Temporary OpenRouter API key';
  element('#openrouter-connect').hidden = true;
  element('#openrouter-back').hidden = true;
  element('#openrouter-key-settings').hidden = true;
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
  return { element, document, window, storage, values, location, history, transport, worker };
}

async function settleStartup() {
  // Flush the caught auth/bootstrap promises, without timers or real transport.
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

it('labels exactly two native model choices beneath sign-in in the shared OpenRouter container', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="openrouter-connect" hidden>\s*<div id="openrouter-signin">\s*<button id="openrouter-signin-button"[^>]*>Sign in with OpenRouter<\/button>\s*<\/div>\s*<p id="openrouter-auth-note" class="help compact-note-list" role="list"><span role="listitem">Connect with OpenRouter to let AI control Doom\.<\/span><span class="charge-emphasis" role="listitem">API usage will incur charges\.<\/span><\/p>\s*<fieldset id="openrouter-model" aria-describedby="openrouter-model-help" disabled>/);
  const group = html.match(/<fieldset id="openrouter-model"[^>]*>([\s\S]*?)<\/fieldset>/)![1];
  assert.match(group, /<legend>AI model<\/legend>/);
  assert.equal((group.match(/type="radio"/g) ?? []).length, 2);
  assert.match(group, /<label><input id="openrouter-model-gpt" type="radio" name="openrouter-model" value="openai\/gpt-6-luna-decisions" checked> GPT-6 Luna Decisions<\/label>/);
  assert.match(group, /<label><input id="openrouter-model-jev" type="radio" name="openrouter-model" value="typesafe\/jev-1\.14"> Jev 1.14<\/label>/);
  assert.ok(html.indexOf('</fieldset>') < html.indexOf('<button id="openrouter-manual"'));
  assert.match(html, /<p id="openrouter-model-help" class="help" role="status"><\/p>/);
  assert.match(html, /<p id="openrouter-auth-status" class="help" role="status" aria-live="polite" aria-atomic="true"><\/p>/);
});

function ready() {
  session.ports.present({ session: {
    phase: 'ready', prepared: true, hasClient: false, verifiedTics: 1,
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
      assert.match(element('#key-note').textContent, /Sign-in authorizes OpenRouter to issue an API key for Doom Decisions/);
      assert.match(element('#key-note').textContent, /page memory, not localStorage/);
      assert.match(element('#key-note').textContent, /Refresh clears the app's local access but does not revoke the issued key/);
      assert.match(element('#key-note').textContent, /Screenshots, context, instructions and decisions.*OpenRouter.*selected model provider/);
      assert.match(element('#key-note').textContent, /charges on your OpenRouter account/);
      assert.match(element('#key-note').textContent, /Trust this app and its served scripts with your key/);
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
    } else if (expected === jevDecisionProviderFactory) {
      assert.equal(element('#key').hidden, true);
      assert.equal(session.ports.takeKey(), 'jev-vite-proxy-not-a-credential');
    } else {
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
  assert.match(h.element('#openrouter-auth-status').textContent, /key received/);
  assert.equal(h.element('#openrouter-model').disabled, false);
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
  assert.equal(h.element('#openrouter-signin-button').disabled, false);
  h.element('#openrouter-signin-button').dispatchEvent(new Event('click'));
  h.element('#openrouter-signin-button').dispatchEvent(new Event('click'));
  h.element('#openrouter-model-jev').checked = true;
  h.element('#openrouter-model-jev').dispatchEvent(new Event('change'));
  assert.equal(h.element('#openrouter-model').disabled, true);
  assert.equal(h.element('#openrouter-model-gpt').checked, true);
  assert.equal(h.element('#iwad').disabled, true);
  assert.equal(h.element('#included-freedoom').disabled, true);
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
  selected.element('#iwad').files = [{}];
  selected.element('#iwad').dispatchEvent(new Event('change'));
  assert.equal(session.controller.prepare.mock.calls.length, 1);
  assert.equal(selected.element('#openrouter-signin-button').disabled, true);
  selected.element('#openrouter-signin-button').dispatchEvent(new Event('click'));
  await settleStartup();
  assert.equal(selected.location.assign.mock.calls.length, 0);
});

it('keeps both IWAD choices and sign-in available until preparation, then shares admission and retry locks', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_DECISION_PROVIDER', undefined);
  const h = browserFixture();
  const fetch = vi.fn(() => assert.fail('No asset or provider fetch before the admitted file read'));
  vi.stubGlobal('fetch', fetch);
  await import('../src/main.ts?included-freedoom-controls-test');
  await settleStartup();
  assert.equal(h.element('#openrouter-signin-button').disabled, false);
  for (const id of ['#iwad', '#included-freedoom']) assert.equal(h.element(id).disabled, false);
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
  for (const phase of ['preparing', 'ready', 'busy', 'error', 'terminal']) {
    present(phase, false);
    for (const id of ['#iwad', '#included-freedoom']) assert.equal(h.element(id).disabled, true);
    h.element('#included-freedoom').dispatchEvent(new Event('click'));
    h.element('#iwad').files = [{ name: 'local.wad' }];
    h.element('#iwad').dispatchEvent(new Event('change'));
    assert.equal(session.controller.prepare.mock.calls.length, 1);
  }
  present('unprepared', true);
  for (const id of ['#iwad', '#included-freedoom']) assert.equal(h.element(id).disabled, false);
  assert.equal(h.element('#openrouter-signin-button').disabled, true, 'Existing post-admission auth semantics remain');
  h.element('#iwad').dispatchEvent(new Event('change'));
  assert.equal(session.controller.prepare.mock.calls.length, 2);
  assert.match(h.element('#setup-asset').textContent, /local.wad/);
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(h.worker.mock.calls.length, 0);
  assert.equal(session.controller.next.mock.calls.length, 0);
  assert.equal(session.controller.startContinuous.mock.calls.length, 0);
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
