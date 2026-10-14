// Actual executor imports with controlled SDK helpers and offline fetch only.
import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { OpenAI } from 'openai/client';
import {
  createClient,
  DecisionFailure,
  DecisionStopped,
  requestDecision,
} from '../src/decisions-api.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function checkpoint(predicate) {
  for (let i = 0; i < 100; ++i) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Expected bounded microtask checkpoint');
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
// Two valid prebuilt SDK bodies with different input/question representations.
// The executor must forward both without knowing any application vocabulary.
const requests = [
  freeze({
    model: 'gpt-6-luna',
    input: 'fixture evidence A',
    questions: [
      {
        type: 'choice',
        name: 'fixture_choice',
        instructions: 'Select a value.',
        choices: [{ value: 'a' }, { value: 'b' }],
      },
    ],
  }),
  freeze({
    model: 'gpt-6-luna',
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'fixture evidence B' }],
      },
    ],
    questions: [
      {
        type: 'predicate',
        name: 'fixture_predicate',
        instructions: 'Is it present?',
      },
    ],
  }),
];

// Scope the fake application clock to serial executor cases. No sleeps/network.
async function withClock(test) {
  let now = 100;
  const timers = new Map();
  try {
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('setTimeout', (callback, ms) => {
      const timer = {};
      timers.set(timer, { callback, ms });
      return timer;
    });
    vi.stubGlobal('clearTimeout', (timer) => timers.delete(timer));
    await test({
      advance: (ms) => {
        now += ms;
      },
      get remainingMs() {
        return [...timers.values()][0]?.ms;
      },
      expire: () => {
        assert.equal(timers.size, 1);
        const { callback, ms } = [...timers.values()][0];
        now += ms;
        callback();
      },
    });
    assert.equal(timers.size, 0, 'Every executor path clears its deadline');
  } finally {
    vi.unstubAllGlobals();
  }
}
function fixture(options = {}) {
  const lifecycle = {},
    diagnostics = { requestId: null, http: null, latencyMs: null };
  const events = [],
    reader = deferred(),
    helper = deferred();
  const data = { decoded: 'SDK data, not a validated action' };
  let calls = 0,
    charges = 0,
    reads = 0,
    installed = false;
  let requestOptions, received;
  const originalText = () => {
    ++reads;
    return reader.promise;
  };
  const response = {
    status: 200,
    headers: new Headers({ 'x-request-id': options.headerId ?? 'req_header' }),
    text: originalText,
  };
  const client = {
    decisions: {
      create(body, opts) {
        events.push('create');
        ++calls;
        received = body;
        requestOptions = opts;
        assert.equal(
          charges,
          1,
          'Synchronous charge immediately precedes SDK invocation',
        );
        assert.deepEqual(Object.keys(opts).sort(), [
          'maxRetries',
          'signal',
          'timeout',
        ]);
        assert.equal(opts.maxRetries, 0);
        assert.equal(opts.timeout, 10000);
        assert.equal(opts.signal, lifecycle.apiController.signal);
        if (options.syncError) throw options.syncError;
        return {
          asResponse() {
            events.push('headers');
            return options.headerError
              ? Promise.reject(options.headerError)
              : Promise.resolve(response);
          },
          withResponse() {
            events.push('parse');
            installed = response.text !== originalText;
            assert.equal(
              installed,
              true,
              'Reader observation installed before SDK parsing',
            );
            const reading = response.text();
            const parsed = reading.then(() => ({
              data,
              request_id: options.bodyId ?? 'req_body',
            }));
            // Simulate a helper race that can reject before the actual reader settles.
            return options.racedHelper
              ? Promise.race([parsed, helper.promise])
              : parsed;
          },
        };
      },
    },
  };
  const hooks = {
    assertFresh() {
      events.push('fresh');
      if (options.freshError) throw options.freshError;
    },
    beforeCreate() {
      events.push('charge');
      if (options.beforeError) throw options.beforeError;
      ++charges;
    },
    onReadStateChange() {
      events.push(lifecycle.sdkRead ? 'locked' : 'unlocked');
    },
  };
  return {
    lifecycle,
    diagnostics,
    events,
    reader,
    helper,
    response,
    originalText,
    data,
    start: (body = requests[0], startedAt = 100) =>
      requestDecision(client, body, lifecycle, diagnostics, hooks, startedAt),
    get calls() {
      return calls;
    },
    get charges() {
      return charges;
    },
    get reads() {
      return reads;
    },
    get received() {
      return received;
    },
    get signal() {
      return requestOptions.signal;
    },
  };
}

// Error categories and ID allowlisting never expose server/body error text.
const apiError = (status, id) =>
  new OpenAI.APIError(
    status,
    { message: 'untrusted private detail' },
    'untrusted private detail',
    new Headers({ 'x-request-id': id }),
  );

describe('decisions-api', { concurrent: false }, () => {
  // Also restore descriptors if a regression leaves a clock case timed out.
  afterEach(() => vi.unstubAllGlobals());

  it('forwards both prepared bodies unchanged and accounts construction time and cleanup', async () => {
    for (const body of requests)
      await withClock(async (clock) => {
        const h = fixture();
        const pending = h.start(body, 75); // Include time spent preparing the body.
        assert.equal(
          clock.remainingMs,
          9975,
          'Construction time counts toward the application deadline',
        );
        assert.deepEqual(h.events, ['fresh', 'charge', 'create', 'locked']);
        assert.equal(h.received, body, 'Forward the prepared object unchanged');
        await checkpoint(() => h.reads === 1);
        clock.advance(17);
        h.reader.resolve('ignored by fake SDK');
        assert.equal(await pending, h.data);
        await h.lifecycle.sdkRead;
        assert.equal(h.calls, 1);
        assert.equal(h.charges, 1);
        assert.equal(h.lifecycle.apiController, undefined);
        assert.equal(h.lifecycle.sdkRead, undefined);
        assert.equal(h.response.text, h.originalText);
        assert.deepEqual(h.diagnostics, {
          http: 200,
          requestId: 'req_body',
          latencyMs: 42,
        });
        assert.equal(h.events.at(-1), 'unlocked');
      });
  });

  it('charges only started SDK invocations and rejects expired preflight deadlines', async () => {
    // Preflight failures consume no attempt; a synchronous SDK throw consumes one.
    for (const options of [
      { freshError: new DecisionStopped() },
      { beforeError: new DecisionStopped() },
      { syncError: Error('untrusted private detail') },
    ])
      await withClock(async () => {
        const h = fixture(options);
        await assert.rejects(
          h.start(),
          options.syncError
            ? {
                constructor: DecisionFailure,
                message: 'SDK or response-body failure',
              }
            : (error) => error === (options.freshError ?? options.beforeError),
        );
        assert.equal(h.calls, options.syncError ? 1 : 0);
        assert.equal(h.charges, options.syncError ? 1 : 0);
        assert.equal(h.diagnostics.latencyMs, 0);
        assert.equal(h.lifecycle.apiController, undefined);
        assert.equal(h.lifecycle.sdkRead, undefined);
      });
    await withClock(async () => {
      const h = fixture();
      await assert.rejects(
        h.start(requests[0], -9900),
        /API deadline exceeded/,
      );
      assert.equal(h.calls, 0);
      assert.equal(h.charges, 0);
      assert.equal(h.diagnostics.latencyMs, 10000);
    });
  });

  it('sanitizes every API error category and request ID', async () => {
    for (const [error, message, http, id] of [
      [apiError(401, 'req_auth-1'), 'authentication (401)', 401, 'req_auth-1'],
      [apiError(403, 'unsafe-id'), 'permission/access (403)', 403, null],
      [apiError(429, 'req_quota'), 'rate limit/quota (429)', 429, 'req_quota'],
      [
        apiError(503, `req_${'a'.repeat(201)}`),
        'HTTP failure (503)',
        503,
        null,
      ],
      [
        apiError(999, 'req_invalid_status'),
        'SDK or response-body failure',
        null,
        null,
      ],
      [
        new SyntaxError('untrusted private detail'),
        'Malformed API response JSON',
        null,
        null,
      ],
      [new OpenAI.APIConnectionTimeoutError(), 'SDK timeout', null, null],
      [
        new OpenAI.APIConnectionError({}),
        'API connection failure (network/CORS/access)',
        null,
        null,
      ],
    ])
      await withClock(async (clock) => {
        const h = fixture({ headerError: error });
        clock.advance(9);
        await assert.rejects(h.start(), {
          constructor: DecisionFailure,
          message,
        });
        await h.lifecycle.sdkRead;
        assert.deepEqual(h.diagnostics, { http, requestId: id, latencyMs: 9 });
        assert.equal(h.calls, 1);
        assert.equal(h.lifecycle.sdkRead, undefined);
      });
  });

  it('uses only allowlisted body or header request IDs', async () => {
    for (const [headerId, bodyId, expectedId] of [
      ['req_header', 'unsafe-id', 'req_header'],
      ['unsafe-id', 'also-unsafe', null],
      [`req_${'a'.repeat(200)}`, 'unsafe-id', `req_${'a'.repeat(200)}`],
    ])
      await withClock(async () => {
        const h = fixture({ headerId, bodyId });
        const pending = h.start();
        h.reader.resolve('body');
        await pending;
        await h.lifecycle.sdkRead;
        assert.equal(h.diagnostics.requestId, expectedId);
      });
  });

  it('retains actual reader ownership across Abort deadline and helper rejection races', async () => {
    // Cancellation/helper rejection must surface promptly while reader ownership stays.
    for (const cancel of ['abort', 'deadline', 'helper']) {
      for (const rejectReader of [false, true])
        await withClock(async (clock) => {
          const h = fixture({ racedHelper: true });
          const pending = h.start();
          await checkpoint(() => h.reads === 1);
          const drain = h.lifecycle.sdkRead;
          if (cancel === 'abort') h.lifecycle.apiController.abort();
          if (cancel === 'deadline') clock.expire();
          if (cancel === 'helper')
            h.helper.reject(new OpenAI.APIConnectionTimeoutError());
          await assert.rejects(pending, {
            constructor: DecisionFailure,
            message:
              cancel === 'abort'
                ? 'API request aborted'
                : cancel === 'deadline'
                  ? 'API deadline exceeded (10 seconds)'
                  : 'SDK timeout',
          });
          if (cancel !== 'helper')
            h.helper.reject(new OpenAI.APIUserAbortError());
          let drained = false;
          void drain.then(() => {
            drained = true;
          });
          // Bounded never-settling-reader observation; no wall-clock sleeps.
          for (let i = 0; i < 100; ++i) await Promise.resolve();
          assert.equal(drained, false);
          assert.equal(h.lifecycle.sdkRead, drain);
          assert.notEqual(h.response.text, h.originalText);
          assert.equal(h.lifecycle.apiController, undefined);
          assert.equal(h.diagnostics.http, 200);
          assert.equal(h.diagnostics.requestId, 'req_header');
          if (rejectReader) h.reader.reject(Error('late private detail'));
          else h.reader.resolve('late body');
          await drain;
          assert.equal(h.response.text, h.originalText);
          assert.equal(h.lifecycle.sdkRead, undefined);
          assert.equal(h.calls, 1);
          assert.equal(h.charges, 1);
        });
    }
  });

  it('cleans up only the controller and reader ownership it still owns', async () => {
    // Cleanup only clears ownership it still owns, for both controller and reader.
    await withClock(async () => {
      const h = fixture(),
        pending = h.start();
      await checkpoint(() => h.reads === 1);
      const drain = h.lifecycle.sdkRead;
      const replacementController = new AbortController(),
        replacementRead = Promise.resolve();
      h.lifecycle.apiController = replacementController;
      h.lifecycle.sdkRead = replacementRead;
      h.reader.resolve('body');
      await pending;
      await drain;
      assert.equal(h.lifecycle.apiController, replacementController);
      assert.equal(h.lifecycle.sdkRead, replacementRead);
      assert.equal(h.response.text, h.originalText);
    });
  });

  it('serializes both bodies with the pinned SDK and exact offline transport settings', async () => {
    // The real pinned SDK serializes both prepared bodies using the factory's exact
    // hardened transport configuration. Replacing fetch here cannot reach the network.
    for (const body of requests) {
      const client = createClient('offline-not-a-credential');
      assert.equal(client.baseURL, 'https://api.openai.com/v1');
      assert.equal(client.organization, null);
      assert.equal(client.project, null);
      assert.equal(client.maxRetries, 0);
      assert.equal(client.timeout, 10000);
      assert.equal(client.logLevel, 'off');
      assert.equal(client._options.dangerouslyAllowBrowser, true);
      let calls = 0;
      client.fetch = async (url, init) => {
        ++calls;
        assert.equal(url, 'https://api.openai.com/v1/decisions');
        assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(init.body), body);
        for (const [key, value] of Object.entries({
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
        }))
          assert.equal(init[key], value);
        return new Response(JSON.stringify({ answers: [] }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req_offline',
          },
        });
      };
      const lifecycle = {},
        diagnostics = { requestId: null, http: null, latencyMs: null };
      let charges = 0;
      assert.deepEqual(
        await requestDecision(
          client,
          body,
          lifecycle,
          diagnostics,
          {
            assertFresh() {},
            beforeCreate() {
              ++charges;
            },
            onReadStateChange() {},
          },
          performance.now(),
        ),
        { answers: [] },
      );
      await lifecycle.sdkRead;
      assert.equal(calls, 1);
      assert.equal(charges, 1);
      assert.equal(diagnostics.requestId, 'req_offline');
    }
  });
});
