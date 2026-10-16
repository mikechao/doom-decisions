// Config transformation and imported main with synthetic DOM/controller only.
import assert from 'node:assert/strict';
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
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

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
    assert.equal(transformed.includes('https://openrouter.ai'), experimental);
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
  setAttribute() {}
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
    const elements = new Map<string, Element>();
    const element = (id) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    };
    element('#key-label').textContent = 'Temporary OpenAI API key';
    const document = new EventTarget();
    Object.assign(document, { querySelector: element, activeElement: null });
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', new EventTarget());
    // Literal query imports re-evaluate only the app entry per mode.
    await load();
    assert.equal(session.factory, expected);
    if (dev && mode === 'openrouter') {
      assert.equal(element('#key-label').textContent, 'Temporary OpenRouter API key');
      assert.match(element('#key-note').textContent, /key, screenshot, context, instructions and choices.*OpenRouter.*downstream provider/);
      session.ports.present({ session: {
        phase: 'ready', prepared: true, hasClient: false, verifiedTics: 1,
        evidence: { decisions: [] }, controls: { ready: true, stop: false, tics: true, iwad: false },
      } });
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
    } else if (mode === 'jev') {
      assert.equal(element('#key').hidden, true);
      assert.equal(session.ports.takeKey(), 'jev-vite-proxy-not-a-credential');
    } else assert.equal(element('#key-label').textContent, 'Temporary OpenAI API key');
    vi.clearAllMocks();
  }
});
