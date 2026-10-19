// Real pinned SDK, synthetic PNG/Responses, fake fetch and synthetic controller
// ports only. These tests never start a browser, native Doom, or a real request.
import assert from 'node:assert/strict';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { DecisionFailure, validateChoice } from '../src/decision.ts';
import type { DecisionDiagnostics, DecisionLifecycle } from '../src/decision-provider.ts';
import { buildDefaultDecisionRequest, defaultDecisionConfiguration } from '../src/decision-request.ts';
import {
  decodeJevDecision,
  jevDecisionProviderFactory,
} from '../src/jev-decision-provider.ts';
import { checkpoint, cleanup, deferred, fixture } from './fixtures/session.ts';

beforeEach(() => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('MODE', 'jev');
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

const actions = ['neutral', 'forward', 'turn_right', 'backward', 'turn_left', 'fire', 'use'] as const;
// A valid tiny PNG: only fake fetch sees it. Real Doom still captures 640×400.
const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const png = `data:image/png;base64,${base64}`;
const template = '  Fire for {{tics}} tics.\nUse fire.  ';
const input = () => buildDefaultDecisionRequest(73, 6, png, undefined, { ...defaultDecisionConfiguration, instructionTemplate: template });
const answer = (action: unknown = 'forward') => ({
  model: 'jev-1.14.0',
  answers: {
    next_action: {
      type: 'choice',
      choice: action,
      confidence: 0.8,
      probabilities: Object.fromEntries(actions.map((value) => [value, value === action ? 1 : 0])),
    },
  },
});
const response = (body: unknown = answer(), status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'x-typesafe-request-id': 'jev_offline-1' },
});

function start(request = input(), startedAt = performance.now()) {
  const lifecycle: DecisionLifecycle = {};
  const diagnostics: DecisionDiagnostics = { requestId: null, http: null, latencyMs: null };
  const hooks = { assertFresh: vi.fn(), beforeCreate: vi.fn(), onReadStateChange: vi.fn() };
  const provider = jevDecisionProviderFactory.create('offline-not-a-credential');
  const pending = provider.request(request, lifecycle, diagnostics, hooks, startedAt);
  return { pending, lifecycle, diagnostics, hooks };
}

it('probes without transport or credential discovery and requires an explicit key', () => {
  const fetch = vi.fn(() => { throw Error('Unexpected transport'); });
  vi.stubGlobal('fetch', fetch);
  assert.match(jevDecisionProviderFactory.probe().status, /0\.7\.0.*jev-1\.14\.0/);
  assert.throws(() => jevDecisionProviderFactory.create(''));
  assert.throws(() => jevDecisionProviderFactory.create('key with spaces'));
  assert.equal(fetch.mock.calls.length, 0);
});

it('fails closed outside Jev development, even for a previously created provider', async () => {
  const provider = jevDecisionProviderFactory.create('offline-not-a-credential');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  for (const [dev, mode] of [[false, 'jev'], [true, 'development'], [false, 'production']] as const) {
    vi.stubEnv('DEV', dev);
    vi.stubEnv('MODE', mode);
    assert.throws(() => jevDecisionProviderFactory.probe(), /local Vite development proxy/);
    assert.throws(() => jevDecisionProviderFactory.create('offline'), /local Vite development proxy/);
    const hooks = { assertFresh: vi.fn(), beforeCreate: vi.fn(), onReadStateChange: vi.fn() };
    await assert.rejects(provider.request(input(), {}, { requestId: null, http: null, latencyMs: null }, hooks, performance.now()), /local Vite development proxy/);
    assert.equal(hooks.beforeCreate.mock.calls.length, 0);
  }
  assert.equal(fetch.mock.calls.length, 0);
});

it.each([false, true])('uses one charged SDK invocation preserving PNG, instructions and optional state=%s', async (includeTelemetry) => {
  const requestInput = buildDefaultDecisionRequest(73, 6, png, undefined, {
    instructionTemplate: template, includeReadyWeapon: includeTelemetry, includeAmmo: includeTelemetry, includeHealth: includeTelemetry,
  }, {
    health: 87,
    readyWeapon: { id: 1, name: 'pistol', ammoType: 'bullets' },
    ammo: { bullets: { current: 49, max: 200 }, shells: { current: 0, max: 50 }, cells: { current: 0, max: 300 }, rockets: { current: 0, max: 50 } },
  });
  let calls = 0;
  let charges = 0;
  const original = TypeSafeClient.prototype.systemOne;
  // Plain wrapper: observing an APIPromise must not trigger its lazy parser.
  TypeSafeClient.prototype.systemOne = function (request, options) {
    ++calls;
    assert.equal(charges, calls, 'Charge immediately precedes each SDK invocation');
    assert.equal(this.retry.maxRetries, 0);
    assert.equal(options?.retry?.maxRetries, 0);
    assert.equal(this.compression, false);
    assert.equal(this.logLevel, 'off');
    assert.equal(this.timeout, 10000);
    assert.equal(this.baseURL, '/__jev');
    assert.equal(options?.signal?.aborted, false);
    return original.call(this, request, options);
  };
  const fetch = vi.fn(async (url, init) => {
    assert.equal(url, '/__jev/v1/systemone');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer offline-not-a-credential');
    assert.equal(headers.get('TypeSafe-Danger-Zone-Images'), 'true');
    assert.match(headers.get('content-type') ?? '', /^multipart\/form-data; boundary=/);
    assert.equal(headers.has('content-encoding'), false);
    assert.equal(headers.has('X-TypeSafe-Retry-Count'), false);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.mode, 'cors');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.referrerPolicy, 'no-referrer');
    const form = await new Response(init.body, { headers }).formData();
    const metadata = form.get('request');
    // SDK 0.7.0 gives the JSON part no filename, so formData returns text.
    assert.equal(typeof metadata, 'string');
    const payload = JSON.parse(metadata);
    assert.equal(payload.model, 'jev-1.14.0');
    assert.equal(payload.state.context, 'Current rendered Doom E1M1 frame at verified tic 73.' + (includeTelemetry ? '\nReady weapon: pistol (id: 1; ammo type: bullets)\nAmmo: bullets 49/200\nHealth: 87' : ''));
    assert.deepEqual(Object.keys(payload.questions), ['next_action']);
    assert.deepEqual(payload.questions.next_action, {
      type: 'choice', instructions: input().instructions,
      criteria: { neutral: null, forward: null, turn_right: null, backward: null, turn_left: null, fire: null, use: null },
    });
    assert.equal(payload.questions.next_action.instructions, '  Fire for 6 tics.\nUse fire.  ');
    assert.deepEqual(Object.keys(payload.questions.next_action.criteria), actions);
    const asset = payload.assets[payload.state.screenshot];
    assert.equal(asset.type, 'image');
    const file = form.get(asset.part);
    assert.ok(file instanceof Blob);
    assert.equal(file.type, 'image/png');
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    assert.equal([...form.keys()].length, 2);
    return response();
  });
  vi.stubGlobal('fetch', fetch);
  const lifecycle: DecisionLifecycle = {};
  const diagnostics = { requestId: null, http: null, latencyMs: null };
  try {
    const pending = jevDecisionProviderFactory.create('offline-not-a-credential').request(
      requestInput, lifecycle, diagnostics,
      { assertFresh() {}, beforeCreate() { ++charges; }, onReadStateChange() {} },
      performance.now(),
    );
    const result = await pending;
    await lifecycle.sdkRead;
    assert.equal(validateChoice(result).action, 'forward');
    assert.equal(charges, 1);
    assert.equal(calls, 1);
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(diagnostics.http, 200);
    assert.equal(diagnostics.requestId, 'jev_offline-1');
    assert.equal(lifecycle.sdkRead, undefined);
    assert.equal(lifecycle.apiController, undefined);
  } finally {
    TypeSafeClient.prototype.systemOne = original;
  }
});

it('maps only valid optional metrics and leaves action membership to domain validation', () => {
  for (const action of actions) {
    const decoded = decodeJevDecision(answer(action), actions);
    const validated = validateChoice(decoded);
    assert.equal(validated.action, action);
    assert.equal(validated.confidence, 0.8);
    assert.deepEqual(validated.probabilities?.map((p) => p.value), actions);
  }
  for (const action of ['FORWARD', 'forward+fire', '__proto__', '1'])
    assert.throws(() => validateChoice(decodeJevDecision(answer(action), actions)));
  for (const invalid of [null, {}, { answers: [] }, { answers: {} },
    { answers: { wrong: answer().answers.next_action } },
    { answers: { ...answer().answers, extra: {} } }, answer(1),
    { answers: { next_action: { type: 'refusal' } } },
    { answers: { next_action: { type: 'score', choice: 'forward' } } },
  ]) assert.throws(() => decodeJevDecision(invalid, actions), DecisionFailure);
  for (const probabilities of [null, [], {}, { forward: 1 },
    { ...answer().answers.next_action.probabilities, extra: 0 },
    { ...answer().answers.next_action.probabilities, fire: NaN },
    { ...answer().answers.next_action.probabilities, fire: -1 },
  ]) {
    const data = answer();
    Object.assign(data.answers.next_action, { confidence: Infinity, probabilities });
    const validated = validateChoice(decodeJevDecision(data, actions));
    assert.equal(validated.action, 'forward');
    assert.equal(validated.confidence, null);
    assert.equal(validated.probabilities, null);
  }
});

it('does not charge invalid, stale or expired preparation, including elapsed encoding time', async () => {
  const fetch = vi.fn(async () => { throw Error('Unexpected transport'); });
  vi.stubGlobal('fetch', fetch);
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
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
  const lifecycle: DecisionLifecycle = {};
  let charges = 0;
  await assert.rejects(jevDecisionProviderFactory.create('offline').request(
    input(), lifecycle, { requestId: null, http: null, latencyMs: null },
    { assertFresh() { throw new DecisionFailure('Stale attempt'); }, beforeCreate() { ++charges; }, onReadStateChange() {} },
    performance.now(),
  ), /Stale attempt/);
  assert.equal(charges, 0);
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(vi.getTimerCount(), 0);
});

it('sanitizes HTTP/body/network failures and never retries a charged request', async () => {
  for (const status of [401, 403, 429, 500]) {
    const fetch = vi.fn(async () => response({ error: 'private response detail' }, status));
    vi.stubGlobal('fetch', fetch);
    const h = start();
    await assert.rejects(h.pending, (error: Error) => {
      assert.ok(error instanceof DecisionFailure);
      assert.doesNotMatch(error.message, /private response detail/);
      assert.match(error.message, new RegExp(`\\(${status}\\)`));
      return true;
    });
    await h.lifecycle.sdkRead;
    assert.equal(h.diagnostics.http, status);
    assert.equal(h.hooks.beforeCreate.mock.calls.length, 1);
    assert.equal(fetch.mock.calls.length, 1);
  }
  for (const outcome of [() => { throw Error('private transport error'); },
    () => new Response('{broken', { headers: { 'content-type': 'application/json', 'x-typesafe-request-id': 'bad id' } }),
  ]) {
    const fetch = vi.fn(async () => outcome());
    vi.stubGlobal('fetch', fetch);
    const h = start();
    await assert.rejects(h.pending, DecisionFailure);
    await h.lifecycle.sdkRead;
    assert.equal(h.diagnostics.requestId, null);
    assert.equal(h.hooks.beforeCreate.mock.calls.length, 1);
    assert.equal(fetch.mock.calls.length, 1);
  }
});

it('retains fetch and actual text-reader ownership after abort or the original deadline', async () => {
  for (const boundary of ['fetch', 'text']) {
    for (const cancel of ['abort', 'deadline']) {
      const gate = deferred();
      const reading = deferred();
      const fetch = vi.fn(async () => {
        const res = response();
        if (boundary === 'fetch') { reading.resolve(); await gate.promise; }
        else {
          const text = res.text.bind(res);
          res.text = async () => { reading.resolve(); await gate.promise; return text(); };
        }
        return res;
      });
      vi.stubGlobal('fetch', fetch);
      vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
      const h = start();
      const rejected = assert.rejects(h.pending, /API (request aborted|deadline exceeded)/);
      try {
        await reading.promise;
        const ownership = h.lifecycle.sdkRead;
        if (cancel === 'abort') h.lifecycle.apiController?.abort();
        else await vi.advanceTimersByTimeAsync(10000);
        await rejected;
        for (let n = 0; n < 20; ++n) await Promise.resolve();
        assert.ok(ownership);
        assert.equal(h.lifecycle.sdkRead, ownership);
        gate.resolve();
        await ownership;
        assert.equal(h.lifecycle.sdkRead, undefined);
        assert.equal(h.hooks.beforeCreate.mock.calls.length, 1);
        assert.equal(fetch.mock.calls.length, 1);
        assert.equal(vi.getTimerCount(), 0);
      } finally { gate.resolve(); await h.lifecycle.sdkRead; vi.useRealTimers(); }
    }
  }
});

it('waits for both SDK reader cancellations even after SDK rejection', async () => {
  const reading = deferred(), pulling = deferred(), cancelling = deferred(), cancelled = deferred();
  const sdkRejected = deferred();
  const original = TypeSafeClient.prototype.systemOne;
  TypeSafeClient.prototype.systemOne = function (request, options) {
    const pending = original.call(this, request, options);
    void pending.asResponse().then(() => {}, () => sdkRejected.resolve());
    return pending;
  };
  const stream = new ReadableStream<Uint8Array>({
    pull() { return pulling.promise; },
    cancel() { cancelling.resolve(); return cancelled.promise; },
  });
  const res = new Response(stream);
  const clone = res.clone.bind(res);
  res.clone = () => {
    const copy = clone();
    const getReader = copy.body.getReader.bind(copy.body);
    copy.body.getReader = () => {
      const reader = getReader();
      const read = reader.read.bind(reader);
      // bufferResponse installs its abort listener before its first read.
      // An eager source pull does not establish that checkpoint.
      reader.read = () => { reading.resolve(); return read(); };
      return reader;
    };
    return copy;
  };
  vi.stubGlobal('fetch', async () => res);
  const h = start();
  const rejected = assert.rejects(h.pending, /API request aborted/);
  try {
    await reading.promise;
    h.lifecycle.apiController?.abort();
    await rejected;
    await cancelling.promise;
    await sdkRejected.promise;
    const ownership = h.lifecycle.sdkRead;
    assert.ok(ownership);
    let drained = false;
    void ownership.then(() => { drained = true; });
    for (let n = 0; n < 20; ++n) await Promise.resolve();
    assert.equal(drained, false);
    assert.equal(h.lifecycle.sdkRead, ownership);
    cancelled.resolve();
    await ownership;
    assert.equal(h.lifecycle.sdkRead, undefined);
  } finally {
    pulling.resolve();
    cancelled.resolve();
    await h.lifecycle.sdkRead;
    TypeSafeClient.prototype.systemOne = original;
  }
});

it('reuses the controller to verify one manual action and reject invalid SDK answers without dispatch', async () => {
  // The shared native fixture implements neutral only. Other legal labels are
  // covered above at the adapter/domain boundary, without inventing native proof.
  for (const data of [answer('neutral'), answer('forward+fire'), { answers: {} },
    { answers: { ...answer().answers, extra: {} } }, answer(false),
  ]) {
    const h = fixture({ providerFactory: jevDecisionProviderFactory });
    try {
      await h.prepare();
      const capture = h.ports.capture;
      h.ports.capture = () => ({ ...capture(), png });
      const fetch = vi.fn(async () => response(data));
      vi.stubGlobal('fetch', fetch);
      h.browserInputs.tics = 6;
      const outcome = await h.next();
      assert.equal(fetch.mock.calls.length, 1);
      const valid = data.answers.next_action?.choice === 'neutral' && Object.keys(data.answers).length === 1;
      assert.equal(outcome, valid ? 'completed' : 'api-failure');
      assert.equal(h.gameCalls, valid ? 6 : 0);
      const entry = h.view.session.evidence.decisions[0];
      assert.equal(entry.waitUnchanged, true);
      if (valid) {
        assert.deepEqual(h.actions.at(-1), { mask: 0, tics: 6 });
        assert.equal(entry.execution.independentlyVerifiedTics, 6);
        assert.equal(entry.result.nativeSha256, entry.result.canvasSha256);
      } else assert.equal(h.gameOps.includes('action'), false);
    } finally { await h.dispose(); }
  }
});

it('fences late Jev results after Stop or close and locks admission until reader cleanup', async () => {
  for (const command of ['stop', 'close']) {
    const h = fixture({ providerFactory: jevDecisionProviderFactory });
    const reading = deferred(), gate = deferred();
    let pending;
    try {
      await h.prepare();
      const capture = h.ports.capture;
      h.ports.capture = () => ({ ...capture(), png });
      vi.stubGlobal('fetch', async () => {
        const res = response();
        const text = res.text.bind(res);
        res.text = async () => { reading.resolve(); await gate.promise; return text(); };
        return res;
      });
      h.browserInputs.budget = 1;
      pending = h.start();
      await reading.promise;
      h.controller[command]();
      await checkpoint(() => h.view.session.waitingForSdk);
      assert.equal(h.view.session.controls.ready, false);
      assert.equal(await h.next(), 'not-admitted');
      assert.equal(h.view.session.continuous.used, 1);
      if (command === 'stop') {
        await checkpoint(() => h.view.session.evidence.decisions[0].stage === 'cleanup');
        assert.equal(h.view.session.continuous.active, true);
      }
      gate.resolve();
      await pending;
      await checkpoint(() => !h.view.session.waitingForSdk);
      assert.equal(h.gameCalls, 0);
      assert.equal(h.gameOps.includes('action'), false);
      assert.equal(h.view.session.controls.ready, command === 'stop');
    } finally { gate.resolve(); await pending; await h.dispose(); }
  }
});
