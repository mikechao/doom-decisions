// Real pinned SDK with fake fetch/Response and synthetic controller ports only.
import assert from 'node:assert/strict';
import { resetEnv } from '@openrouter/sdk/lib/env.js';
import { Decisions } from '@openrouter/sdk/sdk/decisions.js';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { DecisionFailure, validateChoice } from '../src/decision.ts';
import type { DecisionDiagnostics, DecisionLifecycle } from '../src/decision-provider.ts';
import { buildDefaultDecisionRequest, defaultDecisionConfiguration, defaultDecisionInstructionTemplate } from '../src/decision-request.ts';
import { openAiDecisionProviderFactory } from '../src/openai-decision-provider.ts';
import { createOpenRouterDecisionProviderFactory, openRouterDecisionProviderFactory, openRouterModels } from '../src/openrouter-decision-provider.ts';
import { checkpoint, cleanup, deferred, fixture } from './fixtures/session.ts';

const actions = ['neutral', 'forward', 'turn_right', 'backward', 'turn_left', 'fire', 'use'] as const;
const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const png = `data:image/png;base64,${base64}`;
const key = 'offline-openrouter-dummy-only';
const input = () => buildDefaultDecisionRequest(73, 2, png);
const answer = (action: unknown = 'forward') => ({
  model: 'openai/gpt-6-luna-decisions',
  answers: {
    next_action: {
      type: 'choice', choice: action, confidence: 0.8,
      probabilities: Object.fromEntries(actions.map(value => [value, value === action ? 1 : 0])),
    },
  },
  usage: { input_tokens: 123, output_tokens: 0 },
  id: 'gen-dec-offline-1',
});
const response = (body: unknown = answer(), status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('OPENROUTER_DEBUG', undefined);
  vi.stubEnv('OPENROUTER_HTTP_REFERER', undefined);
  vi.stubEnv('OPENROUTER_APP_TITLE', undefined);
  vi.stubEnv('OPENROUTER_APP_CATEGORIES', undefined);
  resetEnv();
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('Unexpected offline transport'); }));
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); resetEnv(); });

function start(request = input(), startedAt = performance.now(), factory = openRouterDecisionProviderFactory) {
  const lifecycle: DecisionLifecycle = {};
  const diagnostics: DecisionDiagnostics = { requestId: null, http: null, latencyMs: null };
  const hooks = { assertFresh: vi.fn(), beforeCreate: vi.fn(), onReadStateChange: vi.fn() };
  const provider = factory.create(key);
  const pending = provider.request(request, lifecycle, diagnostics, hooks, startedAt);
  return { pending, lifecycle, diagnostics, hooks };
}

it('probes inertly in DEV/PROD and rejects bad keys or SDK debug logging', async () => {
  const transport = vi.mocked(fetch);
  assert.deepEqual(openRouterModels, {
    'openai/gpt-6-luna-decisions': 'GPT-6 Luna Decisions',
    'typesafe/jev-1.14': 'Jev 1.14',
  });
  for (const model of Object.keys(openRouterModels) as (keyof typeof openRouterModels)[]) {
    const probe = createOpenRouterDecisionProviderFactory(model).probe();
    assert.ok(probe.status.includes(`configured model: ${model}`));
    assert.match(probe.status, /model access unverified/);
    assert.equal(probe.evidence.configuredModel, model);
    assert.equal(probe.evidence.modelAccess, 'unverified by SDK probe');
  }
  assert.throws(() => createOpenRouterDecisionProviderFactory('unsupported' as never), /Unsupported OpenRouter model/);
  assert.match(openRouterDecisionProviderFactory.probe().status, /1\.4\.25.*openai\/gpt-6-luna-decisions/);
  assert.throws(() => openRouterDecisionProviderFactory.create(''));
  assert.throws(() => openRouterDecisionProviderFactory.create('bad key'));
  const provider = openRouterDecisionProviderFactory.create(key);
  for (const [dev, mode] of [[false, 'production'], [false, 'openrouter'], [true, 'development'], [true, 'impeccable']] as const) {
    vi.stubEnv('DEV', dev); vi.stubEnv('MODE', mode);
    assert.match(openRouterDecisionProviderFactory.probe().status, /OpenRouter SDK 1\.4\.25/);
    assert.equal(typeof openRouterDecisionProviderFactory.create(key).request, 'function');
  }
  vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production');
  for (const flag of ['true', 'false']) {
    // SDK 1.4.25 coerces any nonempty environment string, even "false", to true.
    vi.stubEnv('OPENROUTER_DEBUG', flag); resetEnv();
    assert.throws(() => openRouterDecisionProviderFactory.create(key), /Disable OpenRouter SDK debug logging/);
    assert.throws(() => openRouterDecisionProviderFactory.probe(), /Disable OpenRouter SDK debug logging/);
    await assert.rejects(provider.request(input(), {}, { requestId: null, http: null, latencyMs: null },
      { assertFresh() {}, beforeCreate() { assert.fail('No charge'); }, onReadStateChange() {} }, performance.now()), /Disable OpenRouter SDK debug logging/);
  }
  assert.equal(transport.mock.calls.length, 0);
});

for (const model of Object.keys(openRouterModels) as (keyof typeof openRouterModels)[]) {
  it(`never constructs OpenAI or retries after a ${model} request failure`, async () => {
    for (const outcome of [
      () => response({ error: { message: 'offline failure', code: 503 } }, 503),
      () => { throw new TypeError('offline CORS failure'); },
      () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    ]) {
      const openAi = vi.spyOn(openAiDecisionProviderFactory, 'create').mockImplementation(() => {
        assert.fail('OpenAI must be explicitly selected');
      });
      const h = fixture({ providerFactory: createOpenRouterDecisionProviderFactory(model) });
      try {
        await h.prepare();
        const capture = h.ports.capture;
        h.ports.capture = () => ({ ...capture(), png });
        const transport = vi.fn(async () => outcome()); vi.stubGlobal('fetch', transport);
        assert.equal(await h.next(), 'api-failure');
        assert.equal(transport.mock.calls.length, 1);
        assert.equal(h.gameCalls, 0);
        assert.equal(openAi.mock.calls.length, 0);
      } finally { await h.dispose(); }
    }
  });

  it(`uses one charged ${model} SDK request with original PNG, strings and ordered keys`, async () => {
    const create = vi.spyOn(Decisions.prototype, 'create');
    const transport = vi.fn(async (request: Request) => {
      assert.equal(h.hooks.beforeCreate.mock.calls.length, 1);
      assert.equal(request.url, 'https://openrouter.ai/api/alpha/decisions');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('authorization'), `Bearer ${key}`);
      assert.equal(request.headers.get('content-type'), 'application/json');
      assert.equal(request.headers.get('accept'), 'application/json');
      assert.equal(request.headers.has('http-referer'), false);
      assert.equal(request.headers.has('x-openrouter-title'), false);
      assert.equal(request.headers.has('x-openrouter-categories'), false);
      assert.equal(request.mode, 'cors');
      assert.equal(request.credentials, 'omit');
      assert.equal(request.cache, 'no-store');
      assert.equal(request.redirect, 'error');
      assert.equal(request.referrerPolicy, 'no-referrer');
      assert.equal(request.signal.aborted, false);
      const wire = await request.json();
      assert.deepEqual(wire, {
        model, provider: { allow_fallbacks: false },
        state: [input().context, { type: 'image_url', image_url: { url: png } }],
        questions: { next_action: { type: 'choice', instructions: input().instructions,
          criteria: { neutral: null, forward: null, turn_right: null, backward: null, turn_left: null, fire: null, use: null } } },
      });
      assert.deepEqual(Object.keys(wire.questions.next_action.criteria), actions);
      assert.deepEqual(Buffer.from(wire.state[1].image_url.url.slice('data:image/png;base64,'.length), 'base64'), Buffer.from(base64, 'base64'));
      return response({ ...answer(), model });
    });
    vi.stubGlobal('fetch', transport);
    const h = start(input(), performance.now(), createOpenRouterDecisionProviderFactory(model));
    const selected = validateChoice(await h.pending);
    await h.lifecycle.sdkRead;
    assert.equal(create.mock.calls.length, 1);
    const [wrapper, options] = create.mock.calls[0];
    assert.deepEqual(Object.keys(wrapper), ['decisionsRequest']);
    assert.equal(wrapper.decisionsRequest.provider.allowFallbacks, false);
    assert.deepEqual(options.retries, { strategy: 'none' });
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(transport.mock.calls.length, 1);
    assert.equal(selected.action, 'forward');
    assert.equal(selected.confidence, 0.8);
    assert.deepEqual(selected.probabilities?.map(p => p.value), actions);
    assert.equal(h.diagnostics.requestId, 'gen-dec-offline-1');
    assert.equal(h.diagnostics.http, null, 'Success client returns no raw HTTP metadata');
    assert.equal(h.lifecycle.sdkRead, undefined);
    assert.equal(h.lifecycle.apiController, undefined);
  });
}

it('normalizes all legal labels and rejects malformed, missing and unsupported SDK responses', async () => {
  for (const action of actions) {
    vi.stubGlobal('fetch', vi.fn(async () => response(answer(action))));
    const h = start();
    assert.equal(validateChoice(await h.pending).action, action);
    await h.lifecycle.sdkRead;
  }
  for (const data of [null, {}, { ...answer(), answers: {} },
    { ...answer(), answers: { wrong: answer().answers.next_action } },
    { ...answer(), answers: { ...answer().answers, extra: answer().answers.next_action } },
    answer(1), { ...answer(), answers: { next_action: { type: 'refusal' } } },
    { ...answer(), answers: { next_action: { type: 'noul', noul: 0.8 } } },
  ]) {
    const transport = vi.fn(async () => response(data)); vi.stubGlobal('fetch', transport);
    const h = start();
    await assert.rejects(h.pending, DecisionFailure);
    await h.lifecycle.sdkRead;
    assert.equal(transport.mock.calls.length, 1);
  }
  for (const action of ['FORWARD', 'forward+fire', '__proto__', '1']) {
    vi.stubGlobal('fetch', vi.fn(async () => response(answer(action))));
    const h = start();
    const result = await h.pending;
    assert.throws(() => validateChoice(result), /Invalid next_action choice/);
    await h.lifecycle.sdkRead;
  }
});

it('does not charge local validation, stale state or expired construction; SDK validation is charged', async () => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  const originalCreate = Decisions.prototype.create;
  const create = vi.spyOn(Decisions.prototype, 'create');
  for (const request of [
    { ...input(), png: 'data:image/jpeg;base64,AAAA' },
    { ...input(), png: 'data:image/png;base64,%%%' },
    { ...input(), png: 'data:image/png;base64,AAAA' },
    { ...input(), get context() { vi.advanceTimersByTime(10000); return 'late'; } },
  ]) {
    const h = start(request);
    await assert.rejects(h.pending, DecisionFailure);
    assert.equal(h.hooks.beforeCreate.mock.calls.length, 0);
    assert.equal(h.lifecycle.sdkRead, undefined);
  }
  const expired = start(input(), performance.now() - 10000);
  await assert.rejects(expired.pending, /deadline exceeded/);
  assert.equal(expired.hooks.beforeCreate.mock.calls.length, 0);
  const hooks = { assertFresh() { throw new DecisionFailure('Stale attempt'); }, beforeCreate: vi.fn(), onReadStateChange() {} };
  await assert.rejects(openRouterDecisionProviderFactory.create(key).request(input(), {},
    { requestId: null, http: null, latencyMs: null }, hooks, performance.now()), /Stale attempt/);
  assert.equal(hooks.beforeCreate.mock.calls.length, 0);
  assert.equal(create.mock.calls.length, 0);
  // Inject a runtime type violation at the SDK boundary, then let its actual
  // generated validator reject it. This is charged despite sending no HTTP.
  create.mockImplementationOnce(function (request, options) {
    return originalCreate.call(this, { ...request,
      decisionsRequest: { ...request.decisionsRequest, model: undefined as never },
    }, options);
  });
  const internal = start();
  await assert.rejects(internal.pending, DecisionFailure);
  await internal.lifecycle.sdkRead;
  assert.equal(internal.hooks.beforeCreate.mock.calls.length, 1);
  assert.equal(create.mock.calls.length, 1);
  assert.equal(vi.mocked(fetch).mock.calls.length, 0);
  assert.equal(vi.getTimerCount(), 0);
});

it('drops ambiguous optional metrics and unsafe request IDs', async () => {
  for (const probabilities of [undefined, {}, { forward: 1 },
    { ...answer().answers.next_action.probabilities, extra: 0 },
    { ...answer().answers.next_action.probabilities, fire: -1 },
  ]) {
    const data = answer();
    Object.assign(data.answers.next_action, { confidence: 2, probabilities });
    data.id = `gen-dec-${key}`;
    vi.stubGlobal('fetch', async () => response(data));
    const h = start();
    const result = validateChoice(await h.pending);
    await h.lifecycle.sdkRead;
    assert.equal(result.confidence, null);
    assert.equal(result.probabilities, null);
    assert.equal(h.diagnostics.requestId, null);
  }
});

it('records SDK-added Node headers without optional attribution or cookies', async () => {
  let headers: Headers;
  const transport = vi.fn(async (request: Request) => {
    headers = request.headers;
    return response();
  });
  vi.stubGlobal('fetch', transport);
  const h = start(); await h.pending; await h.lifecycle.sdkRead;
  assert.equal(headers.has('http-referer'), false);
  assert.equal(headers.has('x-openrouter-title'), false);
  assert.equal(headers.has('x-openrouter-categories'), false);
  assert.deepEqual([...headers.keys()], ['accept', 'authorization', 'content-type', 'cookie', 'user-agent']);
  assert.match(headers.get('user-agent'), /@openrouter\/sdk/);
  // SDK sets an empty Cookie header and adds User-Agent only outside browsers.
  // Actual browser filtering/preflight remains owner-run evidence, not Node proof.
  assert.equal(headers.get('cookie'), '');
  assert.equal(transport.mock.calls.length, 1);
});

it('sanitizes HTTP, JSON, network and synthetic SDK errors without retries or logging', async () => {
  const logs = ['log', 'warn', 'error', 'group', 'groupEnd'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => {}));
  for (const status of [401, 402, 403, 429, 500, 503]) {
    const transport = vi.fn(async () => response({ error: { code: status, message: `Authorization Bearer ${key} ${png}` } }, status));
    vi.stubGlobal('fetch', transport);
    const h = start();
    await assert.rejects(h.pending, (error: Error) => {
      assert.equal(error.message, `API HTTP failure (${status})`); return true;
    });
    await h.lifecycle.sdkRead;
    assert.equal(h.diagnostics.http, status);
    assert.equal(h.hooks.beforeCreate.mock.calls.length, 1);
    assert.equal(transport.mock.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(h.diagnostics), /offline-openrouter|Authorization|data:image/);
  }
  for (const outcome of [() => { throw new TypeError(`Failed to fetch ${key} ${png}`); },
    () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
  ]) {
    const transport = vi.fn(async () => outcome()); vi.stubGlobal('fetch', transport);
    const h = start();
    await assert.rejects(h.pending, (error: Error) => {
      assert.ok(error instanceof DecisionFailure);
      assert.doesNotMatch(error.message, /offline-openrouter|Authorization|data:image/); return true;
    });
    await h.lifecycle.sdkRead;
    assert.equal(transport.mock.calls.length, 1);
  }
  vi.spyOn(Decisions.prototype, 'create').mockRejectedValueOnce(Error(`Authorization: Bearer ${key} ${png}`));
  const h = start();
  await assert.rejects(h.pending, { message: 'SDK or response-body failure' });
  await h.lifecycle.sdkRead;
  assert.ok(logs.every(log => log.mock.calls.length === 0));
});

it('retains entire SDK fetch/body ownership through abort and the original deadline with late settlement', async () => {
  for (const boundary of ['fetch', 'text']) for (const cancel of ['abort', 'deadline']) for (const rejects of [false, true]) {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const gate = deferred(), reading = deferred();
    let signal: AbortSignal;
    const transport = vi.fn(async (request: Request) => {
      signal = request.signal;
      if (boundary === 'fetch') {
        reading.resolve(); await gate.promise;
        if (rejects) throw Error(`private late ${key}`);
      }
      const res = response();
      if (boundary === 'text') {
        const text = res.text.bind(res);
        res.text = async () => {
          reading.resolve(); await gate.promise;
          if (rejects) throw Error(`private late ${key}`);
          return text();
        };
      }
      return res;
    });
    vi.stubGlobal('fetch', transport);
    // Four seconds of prior domain construction leaves only six seconds.
    const h = start(input(), performance.now() - 4000);
    const rejected = assert.rejects(h.pending, cancel === 'abort' ? /API request aborted/ : /deadline exceeded/);
    try {
      await reading.promise;
      const ownership = h.lifecycle.sdkRead;
      assert.ok(ownership);
      if (cancel === 'abort') h.lifecycle.apiController.abort();
      else { await vi.advanceTimersByTimeAsync(5999); assert.equal(signal.aborted, false); await vi.advanceTimersByTimeAsync(1); }
      await rejected;
      assert.equal(signal.aborted, true);
      for (let n = 0; n < 20; ++n) await Promise.resolve();
      assert.equal(h.lifecycle.sdkRead, ownership);
      gate.resolve(); await ownership;
      assert.equal(h.lifecycle.sdkRead, undefined);
      assert.equal(h.hooks.beforeCreate.mock.calls.length, 1);
      assert.equal(transport.mock.calls.length, 1);
      assert.equal(vi.getTimerCount(), 0);
    } finally { gate.resolve(); await h.lifecycle.sdkRead; vi.useRealTimers(); }
  }
});

it('clears only lifecycle references it still owns', async () => {
  const gate = deferred(), reading = deferred();
  vi.stubGlobal('fetch', async () => {
    const res = response(); const text = res.text.bind(res);
    res.text = async () => { reading.resolve(); await gate.promise; return text(); };
    return res;
  });
  const h = start(); await reading.promise;
  const ownership = h.lifecycle.sdkRead;
  const controller = new AbortController(); const replacement = Promise.resolve();
  h.lifecycle.apiController = controller; h.lifecycle.sdkRead = replacement;
  gate.resolve(); await h.pending; await ownership;
  assert.equal(h.lifecycle.apiController, controller);
  assert.equal(h.lifecycle.sdkRead, replacement);
});

it('verifies one synthetic manual action and recovers invalid SDK answers without native dispatch', async () => {
  for (const data of [answer('neutral'), answer('forward+fire'), { ...answer(), answers: {} },
    { ...answer(), answers: { next_action: { type: 'refusal' } } },
  ]) {
    const h = fixture({ providerFactory: openRouterDecisionProviderFactory });
    try {
      await h.prepare();
      const capture = h.ports.capture;
      h.ports.capture = () => ({ ...capture(), png });
      const transport = vi.fn(async () => response(data)); vi.stubGlobal('fetch', transport);
      h.browserInputs.tics = 2;
      const outcome = await h.next();
      const valid = data.answers.next_action?.choice === 'neutral';
      assert.equal(outcome, valid ? 'completed' : 'api-failure');
      assert.equal(transport.mock.calls.length, 1);
      assert.equal(h.gameCalls, valid ? 2 : 0);
      const entry = h.view.session.evidence.decisions[0];
      assert.equal(entry.waitUnchanged, true);
      if (valid) {
        assert.equal(entry.execution.requestedTics, 2);
        assert.equal(entry.execution.reportedCompletedTics, 2);
        assert.equal(entry.execution.independentlyVerifiedTics, 2);
        assert.equal(entry.result.tic, 3);
        assert.equal(entry.result.nativeSha256, entry.result.canvasSha256);
        assert.match(h.view.session.collisionEvidence, /Last verified action: neutral, 2 tics \(1 → 3\)/);
        assert.match(h.view.session.collisionEvidence, /trial 0 · success 0 · rejection 0 · slide 0/);
      } else {
        assert.equal(h.gameOps.includes('action'), false);
        assert.equal(h.view.session.collisionEvidence, 'No verified action yet.');
      }
    } finally { await h.dispose(); }
  }
});

for (const mode of ['manual', 'continuous'] as const) {
  it(`serializes full templates without appended text and preserves history across a ${mode} edit race`, async () => {
    const h = fixture({ providerFactory: openRouterDecisionProviderFactory });
    const originalTemplate = 'Fire for {{tics}} tics; choose wisely. Again: {{tics}}.';
    const editedTemplate = 'Use fire';
    let savedInstructionTemplate = originalTemplate;
    const readTemplate = vi.fn(() => ({ ...defaultDecisionConfiguration, instructionTemplate: savedInstructionTemplate }));
    h.ports.readDecisionConfiguration = readTemplate;
    const payloads = [];
    const snapshots = [];
    let pending;
    let barrier;
    try {
      await h.prepare();
      assert.equal(readTemplate.mock.calls.length, 0, 'Preparation does not read the template');
      const capture = h.ports.capture;
      h.ports.capture = () => ({ ...capture(), png });
      const transport = vi.fn(async (request: Request) => {
        assert.equal(request.url, 'https://openrouter.ai/api/alpha/decisions');
        payloads.push(await request.json()); // Real SDK serialization, no network.
        snapshots.push(h.view.session.inspectorRequests);
        return response(answer('neutral'));
      });
      vi.stubGlobal('fetch', transport);
      h.browserInputs.tics = 6;
      h.browserInputs.budget = 2;
      barrier = h.hold('snapshot');
      pending = mode === 'manual' ? h.next() : h.start();
      assert.equal(readTemplate.mock.calls.length, 1, 'Template sampled synchronously at admission');
      await barrier.waiting;
      assert.equal(transport.mock.calls.length, 0, 'Barrier precedes request construction');
      savedInstructionTemplate = editedTemplate;
      h.browserInputs.tics = 3;
      h.browserInputs.budget = 1000;
      assert.equal(await h.next(), 'not-admitted');
      assert.equal(readTemplate.mock.calls.length, 1, 'Rejected admissions do not sample the template');
      barrier.release(); barrier = undefined;
      await pending;
      if (mode === 'manual') assert.equal(await h.next(), 'completed');
      assert.equal(transport.mock.calls.length, 2);
      assert.equal(readTemplate.mock.calls.length, 2);
      const requests = h.view.session.inspectorRequests;
      for (const [index, expected] of ['Fire for 6 tics; choose wisely. Again: 6.', 'Use fire'].entries()) {
        const n = index === 0 ? 6 : 3;
        assert.equal(payloads[index].questions.next_action.instructions, expected);
        assert.equal(payloads[index].questions.next_action.type, 'choice');
        assert.deepEqual(payloads[index].questions.next_action.criteria, Object.fromEntries(actions.map(action => [action, null])));
        assert.equal(requests[index + 1].instructions, expected);
        assert.equal(Object.isFrozen(requests[index + 1]), true);
        const entry = h.view.session.evidence.decisions[index];
        assert.equal(entry.selectedTics, n);
        assert.equal(entry.execution.requestedTics, n);
        assert.equal(entry.execution.independentlyVerifiedTics, n);
        assert.equal(entry.result.nativeSha256, entry.result.canvasSha256);
      }
      savedInstructionTemplate = 'A still later edit';
      assert.equal(requests[1], snapshots[0][1], 'Later admissions keep the original history object');
      assert.equal(snapshots[0][2], undefined, 'Earlier history containers remain frozen');
      assert.deepEqual(h.actions, [{ mask: 0, tics: 1 }, { mask: 0, tics: 6 }, { mask: 0, tics: 3 }]);
      assert.equal(h.creations, 1);
      assert.equal(h.view.session.controls.ready, true);
      if (mode === 'continuous') {
        assert.equal(h.view.session.continuous.limit, 2);
        assert.equal(h.view.session.continuous.used, 2);
        assert.equal(h.view.session.continuous.active, false);
      }
    } finally { barrier?.release(); await pending; await h.dispose(); }
  });
}

for (const includeReadyWeapon of [false, true]) {
  for (const includeAmmo of [false, true]) {
    it.each([false, true])(`serializes verified OpenRouter state (weapon=${includeReadyWeapon}, ammo=${includeAmmo}, health=%s) independently of instructions`, async (includeHealth) => {
      const h = fixture({ providerFactory: openRouterDecisionProviderFactory });
      try {
        await h.prepare();
        h.ports.readDecisionConfiguration = () => ({ ...defaultDecisionConfiguration, includeReadyWeapon, includeAmmo, includeHealth });
        const capture = h.ports.capture;
        h.ports.capture = () => ({ ...capture(), png });
        const payloads = [];
        vi.stubGlobal('fetch', async (request: Request) => {
          assert.equal(request.url, 'https://openrouter.ai/api/alpha/decisions');
          payloads.push(await request.json());
          return response(answer('neutral'));
        });
        assert.equal(await h.next(), 'completed');
        assert.equal(payloads.length, 1);
        const expectedState = ['Current rendered Doom frame at verified tic 1.'];
        if (includeReadyWeapon) expectedState.push('Ready weapon: pistol (id: 1; ammo type: bullets)');
        if (includeAmmo) expectedState.push('Ammo: bullets 50/200');
        if (includeHealth) expectedState.push('Health: 100');
        assert.deepEqual(payloads[0].state, [expectedState.join('\n'), { type: 'image_url', image_url: { url: png } }]);
        assert.equal(payloads[0].questions.next_action.instructions, defaultDecisionInstructionTemplate.replaceAll('{{tics}}', '6'));
        assert.deepEqual(Object.keys(payloads[0].questions.next_action.criteria), actions);
        assert.equal(h.view.session.inspectorRequests[1].context, expectedState.join('\n'));
        assert.equal(h.view.session.inspectorRequests[1].instructions, payloads[0].questions.next_action.instructions);
      } finally { await h.dispose(); }
    });
  }
}

for (const mode of ['manual', 'continuous'] as const) {
  it.each([false, true])(`snapshots configuration before the first await and retains verified ${mode} state and history (initial ammo=%s)`, async (initialAmmo) => {
    const h = fixture({
      providerFactory: openRouterDecisionProviderFactory, at: 1,
      signals: {
        health: 87,
        readyWeapon: { id: 4, name: 'rocket_launcher', ammoType: 'rockets' },
        ammo: {
          bullets: { current: 11, max: 111 }, shells: { current: 22, max: 222 },
          cells: { current: 33, max: 333 }, rockets: { current: 44, max: 444 },
        },
      },
    });
    // Mutate the returned object too: admission must own a copy, not a reference.
    const saved = { instructionTemplate: '{{tics}} tics. Again {{tics}}.', includeReadyWeapon: !initialAmmo, includeAmmo: initialAmmo, includeHealth: initialAmmo };
    const readConfiguration = vi.fn(() => saved);
    h.ports.readDecisionConfiguration = readConfiguration;
    const payloads = [];
    const history = [];
    const screenshots = [png, `data:image/png;base64,${btoa(atob(base64) + 'second')}`];
    let barrier, pending, captures = 0;
    try {
      await h.prepare();
      assert.equal(readConfiguration.mock.calls.length, 0);
      const capture = h.ports.capture;
      h.ports.capture = () => ({ ...capture(), png: screenshots[captures++] });
      vi.stubGlobal('fetch', async (request: Request) => {
        assert.equal(request.url, 'https://openrouter.ai/api/alpha/decisions');
        payloads.push(await request.json());
        history.push(h.view.session.inspectorRequests);
        return response(answer('neutral'));
      });
      h.browserInputs.tics = 1;
      h.browserInputs.budget = 2;
      barrier = h.hold('snapshot');
      pending = mode === 'manual' ? h.next() : h.start();
      assert.equal(readConfiguration.mock.calls.length, 1, 'Whole configuration captured synchronously');
      await barrier.waiting;
      assert.equal(payloads.length, 0);
      saved.instructionTemplate = 'Next {{tics}} tics';
      saved.includeReadyWeapon = initialAmmo;
      saved.includeAmmo = !initialAmmo;
      saved.includeHealth = !initialAmmo;
      h.browserInputs.tics = 2;
      h.browserInputs.budget = 1000;
      assert.equal(await h.next(), 'not-admitted');
      assert.equal(readConfiguration.mock.calls.length, 1, 'Rejected admissions do not sample configuration');
      barrier.release(); barrier = undefined;
      await pending;
      if (mode === 'manual') assert.equal(await h.next(), 'completed');
      const instructions = ['1 tics. Again 1.', 'Next 2 tics'];
      const states = [
        'Current rendered Doom frame at verified tic 1.' + (!initialAmmo ? '\nReady weapon: pistol (id: 1; ammo type: bullets)' : '') + (initialAmmo ? '\nAmmo: bullets 50/200\nHealth: 100' : ''),
        'Current rendered Doom frame at verified tic 2.' + (initialAmmo ? '\nReady weapon: rocket_launcher (id: 4; ammo type: rockets)' : '') + (!initialAmmo ? '\nAmmo: bullets 11/111; shells 22/222; cells 33/333; rockets 44/444\nHealth: 87' : ''),
      ];
      assert.equal(payloads.length, 2);
      assert.equal(readConfiguration.mock.calls.length, 2);
      for (const [index, text] of instructions.entries()) {
        const wire = payloads[index].questions.next_action;
        assert.equal(wire.instructions, text);
        assert.deepEqual(Object.keys(wire.criteria), actions);
        assert.deepEqual(payloads[index].state, [states[index], { type: 'image_url', image_url: { url: screenshots[index] } }]);
        const request = h.view.session.inspectorRequests[index + 1];
        assert.equal(request.instructions, text);
        assert.equal(request.context, states[index]);
        assert.equal(request.png, screenshots[index]);
        const entry = h.view.session.evidence.decisions[index];
        assert.equal(entry.observation.tic, index + 1);
        assert.equal(entry.selectedTics, index + 1);
        assert.equal(entry.execution.independentlyVerifiedTics, index + 1);
        assert.equal(entry.result.nativeSha256, entry.result.canvasSha256);
      }
      saved.instructionTemplate = 'Later edit'; saved.includeAmmo = false; saved.includeHealth = false;
      assert.equal(h.view.session.inspectorRequests[1], history[0][1]);
      assert.equal(history[0][1].instructions, instructions[0]);
      assert.equal(history[0][1].context, states[0]);
      assert.equal(history[0][1].png, screenshots[0]);
      assert.equal(history[0][2], undefined);
      assert.equal(Object.isFrozen(history[0]), true);
      assert.equal(Object.isFrozen(history[0][1]), true);
      assert.deepEqual(h.actions, [{ mask: 0, tics: 1 }, { mask: 0, tics: 1 }, { mask: 0, tics: 2 }]);
      if (mode === 'continuous') {
        assert.equal(h.view.session.continuous.limit, 2);
        assert.equal(h.view.session.continuous.used, 2);
        assert.equal(h.view.session.continuous.active, false);
      }
    } finally { barrier?.release(); await pending; await h.dispose(); }
  });
}

it('fences Stop and close while late SDK body work retains controller admission', async () => {
  for (const command of ['stop', 'close']) {
    const h = fixture({ providerFactory: openRouterDecisionProviderFactory });
    const reading = deferred(), gate = deferred(); let pending;
    try {
      await h.prepare();
      const capture = h.ports.capture; h.ports.capture = () => ({ ...capture(), png });
      vi.stubGlobal('fetch', async () => {
        const res = response(answer('neutral')); const text = res.text.bind(res);
        res.text = async () => { reading.resolve(); await gate.promise; return text(); };
        return res;
      });
      h.browserInputs.budget = 1; pending = h.start(); await reading.promise;
      h.controller[command]();
      await checkpoint(() => h.view.session.waitingForSdk);
      assert.equal(h.view.session.controls.ready, false);
      assert.equal(await h.next(), 'not-admitted');
      assert.equal(h.view.session.continuous.used, 1);
      if (command === 'stop') await checkpoint(() => h.view.session.evidence.decisions[0].stage === 'cleanup');
      gate.resolve(); await pending;
      await checkpoint(() => !h.view.session.waitingForSdk);
      assert.equal(h.gameCalls, 0);
      assert.equal(h.view.session.controls.ready, command === 'stop');
    } finally { gate.resolve(); await pending; await h.dispose(); }
  }
});

it('sends optional verified movement feedback in state and freezes the exact inspector input', async () => {
  const h = fixture({ providerFactory: openRouterDecisionProviderFactory, onStep(next, previous, mask) {
    if (mask === 1) {
      next.native.x = previous.native.x - 1;
      next.native.y = previous.native.y + 65536;
    }
  } });
  try {
    await h.prepare();
    const configuration = { ...defaultDecisionConfiguration, includePreviousAction: true, instructionTemplate: '  Explore {{tics}}. {{ammo}}  ' };
    h.ports.readDecisionConfiguration = () => configuration;
    const capture = h.ports.capture;
    h.ports.capture = () => ({ ...capture(), png });
    const payloads = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      payloads.push(await request.json());
      return response(answer('forward'));
    });
    h.browserInputs.tics = 2;
    await h.controller.startContinuous(2);
    const first = h.view.session.inspectorRequests[1];
    const second = h.view.session.inspectorRequests[2];
    assert.equal(first.context, 'Current rendered Doom frame at verified tic 1.');
    assert.equal(second.context, 'Current rendered Doom frame at verified tic 3.\nPrevious verified action: forward (2 tics).\nPlayer XY displacement: dx=-0.000030517578125, dy=2 Doom units; net translation observed.');
    assert.deepEqual(payloads[1].state, [second.context, { type: 'image_url', image_url: { url: second.png } }]);
    assert.equal(payloads[1].questions.next_action.instructions, '  Explore 2. {{ammo}}  ');
    assert.deepEqual(Object.keys(payloads[1].questions.next_action.criteria), actions);
    const frozen = second.context;
    configuration.includePreviousAction = false;
    assert.equal(await h.next(), 'completed');
    assert.equal(h.view.session.inspectorRequests[3].context, 'Current rendered Doom frame at verified tic 5.');
    assert.equal(second.context, frozen);
    assert.equal(h.view.session.inspectorRequests[2], second);
    assert.equal(Object.isFrozen(second), true);
    assert.equal(payloads.length, 3);
  } finally { await h.dispose(); }
});

it('transmits current facing geometry only in state through the pinned OpenRouter fake transport', async () => {
  const payloads = [];
  const h = fixture({ providerFactory: openRouterDecisionProviderFactory, onStep(next) {
    const tic = next.counters.gametic;
    Object.assign(next.native, { facingKind: tic === 1 ? 3 : 4, facingDoor: 2, facingDistance: tic === 1 ? 24 : 12 });
  } });
  try {
    await h.prepare();
    h.browserInputs.tics = 1;
    const configuration = { ...defaultDecisionConfiguration, includeFacingProbe: true, instructionTemplate: '  Explore {{tics}}.  ' };
    h.ports.readDecisionConfiguration = () => configuration;
    const capture = h.ports.capture;
    h.ports.capture = () => ({ ...capture(), png });
    vi.stubGlobal('fetch', async (request: Request) => {
      payloads.push(await request.json()); return response(answer('turn_right'));
    });
    await h.controller.startContinuous(2);
    const first = h.view.session.inspectorRequests[1];
    const second = h.view.session.inspectorRequests[2];
    assert.match(first.context, /verified tic 1.*\nFacing probe.*clearance restriction about 24 units ahead/);
    assert.match(second.context, /verified tic 2.*\nFacing probe.*manual-door boundary about 12 units ahead/);
    assert.deepEqual(payloads[0].state, [first.context, { type: 'image_url', image_url: { url: first.png } }]);
    assert.deepEqual(payloads[1].state, [second.context, { type: 'image_url', image_url: { url: second.png } }]);
    assert.equal(payloads[1].questions.next_action.instructions, '  Explore 1.  ');
    assert.deepEqual(Object.keys(payloads[1].questions.next_action.criteria), actions);
    const frozen = first.context;
    configuration.includeFacingProbe = false;
    assert.equal(await h.next(), 'completed');
    assert.equal(payloads[2].state[0], 'Current rendered Doom frame at verified tic 3.');
    assert.equal(h.view.session.inspectorRequests[1], first);
    assert.equal(first.context, frozen);
    assert.equal(Object.isFrozen(first), true);
  } finally { await h.dispose(); }
});
