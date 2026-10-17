// Installed SDKs, fake transports only. No authenticated or live requests.
import assert from 'node:assert/strict';
import { resetEnv } from '@openrouter/sdk/lib/env.js';
import { afterEach, it, vi } from 'vitest';
import { readDecisionMetadata } from '../src/decision-metadata.ts';
import type { DecisionDiagnostics, DecisionLifecycle } from '../src/decision-provider.ts';
import { buildDefaultDecisionRequest } from '../src/decision-request.ts';
import { jevDecisionProviderFactory } from '../src/jev-decision-provider.ts';
import { openAiDecisionProviderFactory } from '../src/openai-decision-provider.ts';
import { createOpenRouterDecisionProviderFactory } from '../src/openrouter-decision-provider.ts';

const key = 'offline-metadata-secret';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const providers = ['OpenRouter', 'OpenAI', 'TypeSafe / Jev'] as const;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnv(); });

for (const provider of providers) {
  const usage = (input: unknown, output: unknown, total: unknown = 17) =>
    provider === 'OpenRouter' ? { inputTokens: input, outputTokens: output, totalTokens: total }
      : { input_tokens: input, output_tokens: output, total_tokens: total };

  it(`${provider}: keeps reported zero/partial usage, never derives totals or trusts invalid counters`, () => {
    const project = (value: unknown) => readDecisionMetadata({ model: 'vendor/reported-2', usage: value }, provider, key);
    assert.deepEqual(project(usage(12, 0)), {
      reportedModel: 'vendor/reported-2',
      usage: { input: 12, output: 0, total: provider === 'OpenAI' ? 17 : null },
    });
    assert.deepEqual(project(provider === 'OpenRouter' ? { inputTokens: 0 } : { input_tokens: 0 }).usage,
      { input: 0, output: null, total: null });
    for (const missing of [undefined, null, {}, []])
      assert.deepEqual(project(missing).usage, { input: null, output: null, total: null });
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '3', true, null])
      assert.deepEqual(project(usage(invalid, invalid, invalid)).usage, { input: null, output: null, total: null });
    assert.deepEqual(project(usage(Number.MAX_SAFE_INTEGER, 0, 0)).usage,
      { input: Number.MAX_SAFE_INTEGER, output: 0, total: provider === 'OpenAI' ? 0 : null });
    for (const model of [key, `vendor/${key}`, '<img src=x>', 'bad\nmodel', 'a'.repeat(201), '', {}, null]) {
      assert.equal(readDecisionMetadata({ model }, provider, key).reportedModel, null);
    }
    const safe = readDecisionMetadata({ model: 'safe/model', usage: usage(1, 2), headers: key, body: key, apiKey: key }, provider, key);
    assert.deepEqual(Object.keys(safe), ['reportedModel', 'usage']);
    assert.doesNotMatch(JSON.stringify(safe), /offline-metadata-secret|headers|apiKey|body/);
  });
}

const choice = { type: 'choice', choice: 'neutral', confidence: 0.8,
  probabilities: { neutral: 1, forward: 0, turn_right: 0, backward: 0, turn_left: 0, fire: 0, use: 0 } };

for (const provider of providers) {
  it(`${provider}: retains encoded call identity and genuine metadata independently of answer decoding`, async () => {
    vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'jev');
    vi.stubEnv('OPENROUTER_DEBUG', undefined); resetEnv();
    const factory = provider === 'OpenRouter' ? createOpenRouterDecisionProviderFactory('typesafe/jev-1.14')
      : provider === 'OpenAI' ? openAiDecisionProviderFactory : jevDecisionProviderFactory;
    const expectedModel = provider === 'OpenRouter' ? 'typesafe/jev-1.14'
      : provider === 'OpenAI' ? 'gpt-6-luna' : 'jev-1.14.0';
    for (const supplied of [true, false]) {
      const wire = {
        model: 'vendor/actually-reported',
        answers: provider === 'OpenAI'
          ? [{ ...choice, name: 'next_action', probabilities: Object.entries(choice.probabilities).map(([value, probability]) => ({ value, probability })) }]
          : { next_action: choice },
        ...(supplied ? { usage: { input_tokens: 13, output_tokens: 0, total_tokens: 99 } } : {}),
      };
      const transport = vi.fn(async () => new Response(JSON.stringify(wire), { headers: { 'content-type': 'application/json' } }));
      vi.stubGlobal('fetch', transport);
      const diagnostics: DecisionDiagnostics = { requestId: null, http: null, latencyMs: null };
      const lifecycle: DecisionLifecycle = {};
      const hooks = { assertFresh() {}, beforeCreate() { diagnostics.sdkInvoked = true; }, onReadStateChange() {} };
      const pending = factory.create(key).request(buildDefaultDecisionRequest(1, 2, png), lifecycle, diagnostics, hooks, performance.now());
      if (!supplied && provider === 'OpenRouter') {
        await assert.rejects(pending);
        assert.equal(diagnostics.responseMetadata, undefined, 'Required usage remains an SDK transport/schema failure');
      } else {
        assert.equal((await pending).kind, 'choice');
        assert.deepEqual(diagnostics.responseMetadata, {
          reportedModel: 'vendor/actually-reported',
          usage: supplied ? { input: 13, output: 0, total: provider === 'OpenAI' ? 99 : null }
            : { input: null, output: null, total: null },
        });
      }
      await lifecycle.sdkRead;
      assert.deepEqual(diagnostics.requestIdentity, { provider, requestedModel: expectedModel });
      assert.equal(diagnostics.sdkInvoked, true);
      assert.equal(transport.mock.calls.length, 1);
      assert.doesNotMatch(JSON.stringify(diagnostics), /offline-metadata-secret/);
    }
    // A received response may have usage even if its action envelope is invalid.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      model: 'vendor/rejected-answer', usage: { input_tokens: 4, output_tokens: 0, total_tokens: 4 }, answers: provider === 'OpenAI' ? [] : {},
    }), { headers: { 'content-type': 'application/json' } })));
    const diagnostics: DecisionDiagnostics = { requestId: null, http: null, latencyMs: null };
    const lifecycle: DecisionLifecycle = {};
    await assert.rejects(factory.create(key).request(buildDefaultDecisionRequest(1, 2, png), lifecycle, diagnostics,
      { assertFresh() {}, beforeCreate() {}, onReadStateChange() {} }, performance.now()));
    await lifecycle.sdkRead;
    assert.equal(diagnostics.responseMetadata?.usage.input, 4);
  });
}
