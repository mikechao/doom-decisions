import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  choice,
  Image,
  TypeSafeClient,
  VERSION,
} from '@typesafe-ai/sdk';
import { DecisionFailure, DecisionStopped } from './decision.ts';
import type {
  DecisionProviderFactory,
  DecisionRequest,
  DecisionResult,
} from './decision-provider.ts';

const deadlineMs = 10000;
const model = 'jev-1.14.0';
const pngPrefix = 'data:image/png;base64,';
const probability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const safeRequestId = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)
    ? value
    : null;

export function encodeJevDecisionRequest(input: DecisionRequest) {
  if (!input.png.startsWith(pngPrefix))
    throw new DecisionFailure('Canvas PNG unavailable.');
  const screenshot = Image.fromBase64(input.png.slice(pngPrefix.length));
  const bytes = screenshot.data;
  if (
    !(bytes instanceof Uint8Array) ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
  )
    throw new DecisionFailure('Invalid Canvas PNG.');
  return {
    model,
    state: { context: input.context, screenshot },
    questions: {
      next_action: choice(
        input.instructions,
        Object.fromEntries(input.permittedActions.map((action) => [action, null])),
      ),
    },
  };
}

export function decodeJevDecision(
  data: unknown,
  permittedActions: DecisionRequest['permittedActions'],
): DecisionResult {
  const answers = record(record(data).answers);
  if (Object.keys(answers).length !== 1 || !Object.hasOwn(answers, 'next_action'))
    throw new DecisionFailure('Invalid answer count');
  const answer = record(answers.next_action);
  // SDK 0.7.0 defines no refusal response. Unknown answer types are invalid.
  if (answer.type !== 'choice' || typeof answer.choice !== 'string')
    throw new DecisionFailure('Invalid next_action choice');
  const probabilities = record(answer.probabilities);
  return {
    kind: 'choice',
    action: answer.choice,
    confidence: probability(answer.confidence) ? answer.confidence : undefined,
    probabilities:
      Object.keys(probabilities).length === permittedActions.length &&
      permittedActions.every(
        (action) =>
          Object.hasOwn(probabilities, action) &&
          probability(probabilities[action]),
      )
        ? permittedActions.map((value) => ({
            value,
            probability: probabilities[value],
          }))
        : undefined,
  };
}

// SDK 0.7.0 bufferResponse clones the Response, reads the clone, and on Abort
// calls cancel on BOTH readers without awaiting those promises (index.mjs:820).
// Observe only that SDK's actual fetch/text/read/cancel work; never consume a
// second body or replace SDK parsing. Result cancellation cannot release this work.
function observeResponseWork() {
  const pending = new Set<Promise<void>>();
  const restore: (() => void)[] = [];
  function track<T>(promise: Promise<T>): Promise<T> {
    const settled = promise.then(
      () => {},
      () => {},
    );
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
    return promise;
  }
  function observe(response: Response): Response {
    const clone = response.clone;
    const text = response.text;
    response.clone = () => observe(clone.call(response));
    response.text = () => track(text.call(response));
    restore.push(() => {
      response.clone = clone;
      response.text = text;
    });
    const stream = response.body;
    if (stream) {
      const getReader = stream.getReader;
      // bufferResponse uses the default reader, never BYOB.
      stream.getReader = (() => {
        const reader = (
          getReader as () => ReadableStreamDefaultReader<Uint8Array>
        ).call(stream);
        const read = reader.read;
        const cancel = reader.cancel;
        reader.read = () => track(read.call(reader));
        reader.cancel = (reason) => track(cancel.call(reader, reason));
        restore.push(() => {
          reader.read = read;
          reader.cancel = cancel;
        });
        return reader;
      }) as typeof stream.getReader;
      restore.push(() => {
        stream.getReader = getReader;
      });
    }
    return response;
  }
  return {
    track,
    observe,
    async drain() {
      while (pending.size) await Promise.all([...pending]);
      for (const undo of restore.reverse()) undo();
    },
  };
}

export const jevDecisionProviderFactory: DecisionProviderFactory = {
  probe() {
    if (
      VERSION !== '0.7.0' ||
      typeof TypeSafeClient.prototype.systemOne !== 'function'
    )
      throw Error('Require official TypeSafe SDK 0.7.0 with systemOne.');
    return {
      status: `Experimental TypeSafe SDK ${VERSION} · ${model} · images enabled · browser access unverified`,
      evidence: {
        provider: 'TypeSafe / Jev',
        version: VERSION,
        model,
        experimentalImages: true,
      },
    };
  },
  create(apiKey) {
    if (!apiKey || !/^[\x21-\x7e]+$/.test(apiKey))
      throw Error('A usable temporary API key is required.');
    return {
      async request(input, lifecycle, diagnostics, hooks, startedAt) {
        const controller = new AbortController();
        lifecycle.apiController = controller;
        const work = observeResponseWork();
        let timedOut = false;
        const abortError = () =>
          new DecisionFailure(
            timedOut ? 'API deadline exceeded (10 seconds)' : 'API request aborted',
          );
        let onAbort = () => {};
        const cancelled = new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(abortError());
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        void cancelled.catch(() => {});
        const deadline = setTimeout(
          () => {
            timedOut = true;
            controller.abort();
          },
          Math.max(0, deadlineMs - (performance.now() - startedAt)),
        );
        const checkDeadline = () => {
          if (performance.now() - startedAt >= deadlineMs) {
            timedOut = true;
            controller.abort();
          }
          if (controller.signal.aborted) throw abortError();
          hooks.assertFresh();
        };
        try {
          checkDeadline();
          const prepared = encodeJevDecisionRequest(input);
          const client = new TypeSafeClient({
            apiKey,
            baseURL: 'https://api.typesafe.ai',
            defaultModel: model,
            dangerouslyAllowBrowser: true,
            logLevel: 'off',
            retry: { maxRetries: 0 },
            timeout: deadlineMs,
            compression: false,
            defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' },
            fetch: async (url, init) => {
              const response = await work.track(
                fetch(url, {
                  ...init,
                  mode: 'cors',
                  credentials: 'omit',
                  cache: 'no-store',
                  redirect: 'error',
                  referrerPolicy: 'no-referrer',
                }),
              );
              diagnostics.http =
                response.status >= 100 && response.status <= 599
                  ? response.status
                  : null;
              diagnostics.requestId = safeRequestId(
                response.headers.get('x-typesafe-request-id'),
              );
              return work.observe(response);
            },
          });
          checkDeadline();
          hooks.beforeCreate();
          const pending = client.systemOne(prepared, {
            signal: controller.signal,
            timeout: deadlineMs,
            retry: { maxRetries: 0 },
          });
          const body = pending.withResponse();
          const cleanup = Promise.allSettled([body]).then(async () => {
            await work.drain();
            if (lifecycle.sdkRead === cleanup) lifecycle.sdkRead = undefined;
            hooks.onReadStateChange();
          });
          lifecycle.sdkRead = cleanup;
          hooks.onReadStateChange();
          const result = body.then(({ data }) => {
            checkDeadline();
            return decodeJevDecision(data, input.permittedActions);
          });
          return await Promise.race([result, cancelled]);
        } catch (error) {
          if (controller.signal.aborted) throw abortError();
          if (error instanceof DecisionFailure || error instanceof DecisionStopped)
            throw error;
          if (error instanceof APIError) {
            const status = error.status;
            if (Number.isInteger(status) && status >= 100 && status <= 599) {
              diagnostics.http = status;
              diagnostics.requestId =
                safeRequestId(error.requestId) ?? diagnostics.requestId;
              const category =
                status === 401
                  ? 'authentication'
                  : status === 403
                    ? 'permission/access'
                    : status === 429
                      ? 'rate limit/quota'
                      : 'HTTP failure';
              throw new DecisionFailure(`${category} (${status})`);
            }
          }
          if (error instanceof APITimeoutError)
            throw new DecisionFailure('SDK timeout');
          if (error instanceof APIUserAbortError)
            throw new DecisionFailure('API request aborted');
          if (error instanceof APIConnectionError)
            throw new DecisionFailure('API connection failure (network/CORS/access)');
          throw new DecisionFailure('SDK or response-body failure');
        } finally {
          clearTimeout(deadline);
          controller.signal.removeEventListener('abort', onAbort);
          if (lifecycle.apiController === controller)
            lifecycle.apiController = undefined;
          diagnostics.latencyMs = Math.round(performance.now() - startedAt);
        }
      },
    };
  },
};
