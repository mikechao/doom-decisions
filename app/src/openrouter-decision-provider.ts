import { OpenRouter } from '@openrouter/sdk';
import { SDK_METADATA } from '@openrouter/sdk/lib/config.js';
import { env as sdkEnv } from '@openrouter/sdk/lib/env.js';
import type { DecisionsResponse } from '@openrouter/sdk/models/decisionsresponse.js';
import {
  ConnectionError,
  OpenRouterError,
  RequestAbortedError,
  RequestTimeoutError,
} from '@openrouter/sdk/models/errors';
import type { CreateApiAlphaDecisionsRequest } from '@openrouter/sdk/models/operations/createapialphadecisions.js';
import { DecisionFailure, DecisionStopped } from './decision.ts';
import type {
  DecisionProviderFactory,
  DecisionRequest,
  DecisionResult,
} from './decision-provider.ts';

const model = 'openai/gpt-6-luna-decisions';
const deadlineMs = 10000;
const pngPrefix = 'data:image/png;base64,';

function assertOpenRouterDevelopment() {
  if (!import.meta.env.DEV || import.meta.env.MODE !== 'openrouter')
    throw new DecisionFailure('OpenRouter requires explicit development mode.');
  // 1.4.25 falls back to console logging when OPENROUTER_DEBUG is truthy.
  // Reject it rather than enabling a no-op logger (which still clones/reads bodies).
  let debug: boolean | undefined;
  try {
    debug = sdkEnv().OPENROUTER_DEBUG;
  } catch {
    throw new DecisionFailure('OpenRouter SDK configuration unavailable.');
  }
  if (debug) throw new DecisionFailure('Disable OpenRouter SDK debug logging.');
}

export function encodeOpenRouterDecisionRequest(
  input: DecisionRequest,
): CreateApiAlphaDecisionsRequest {
  if (
    typeof input.context !== 'string' ||
    typeof input.instructions !== 'string' ||
    typeof input.png !== 'string' ||
    !input.png.startsWith(pngPrefix)
  )
    throw new DecisionFailure('Invalid decision input or Canvas PNG.');
  let bytes: string;
  try {
    bytes = atob(input.png.slice(pngPrefix.length));
  } catch {
    throw new DecisionFailure('Invalid Canvas PNG.');
  }
  if (
    ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, i) => bytes.charCodeAt(i) === byte,
    )
  )
    throw new DecisionFailure('Invalid Canvas PNG.');
  return {
    decisionsRequest: {
      model,
      provider: { allowFallbacks: false },
      state: [
        input.context,
        { type: 'image_url', image_url: { url: input.png } },
      ],
      questions: {
        next_action: {
          type: 'choice',
          instructions: input.instructions,
          criteria: Object.fromEntries(
            input.permittedActions.map((action) => [action, null]),
          ),
        },
      },
    },
  };
}

export function decodeOpenRouterDecision(
  data: DecisionsResponse,
  permittedActions: DecisionRequest['permittedActions'],
): DecisionResult {
  if (
    Object.keys(data.answers).length !== 1 ||
    !Object.hasOwn(data.answers, 'next_action')
  )
    throw new DecisionFailure('Invalid answer count');
  const answer = data.answers.next_action;
  if (
    answer?.type !== 'choice' ||
    !('choice' in answer) ||
    typeof answer.choice !== 'string'
  )
    throw new DecisionFailure('Invalid next_action choice');
  return {
    kind: 'choice',
    action: answer.choice,
    confidence: answer.confidence,
    probabilities:
      answer.probabilities &&
      Object.keys(answer.probabilities).length === permittedActions.length &&
      permittedActions.every((value) =>
        Object.hasOwn(answer.probabilities ?? {}, value),
      )
        ? permittedActions.map((value) => ({
            value,
            probability: answer.probabilities?.[value],
          }))
        : undefined,
  };
}

export const openRouterDecisionProviderFactory: DecisionProviderFactory = {
  probe() {
    assertOpenRouterDevelopment();
    if (SDK_METADATA.sdkVersion !== '1.4.25')
      throw new DecisionFailure('Require OpenRouter SDK 1.4.25.');
    return {
      status: `Experimental OpenRouter SDK 1.4.25 · ${model} · browser POST/access unverified`,
      evidence: { provider: 'OpenRouter', version: '1.4.25', model },
    };
  },
  create(apiKey) {
    assertOpenRouterDevelopment();
    if (!apiKey || !/^[\x21-\x7e]+$/.test(apiKey))
      throw new DecisionFailure('A usable temporary API key is required.');
    const client = new OpenRouter({
      apiKey,
      serverURL: 'https://openrouter.ai',
      retryConfig: { strategy: 'none' },
    });
    return {
      async request(input, lifecycle, diagnostics, hooks, startedAt) {
        assertOpenRouterDevelopment();
        const controller = new AbortController();
        lifecycle.apiController = controller;
        let timedOut = false;
        const abortError = () =>
          new DecisionFailure(
            timedOut
              ? 'API deadline exceeded (10 seconds)'
              : 'API request aborted',
          );
        const onAbort = () => rejectAbort(abortError());
        let rejectAbort: (error: Error) => void = () => {};
        const cancelled = new Promise<never>((_resolve, reject) => {
          rejectAbort = reject;
        });
        void cancelled.catch(() => {});
        controller.signal.addEventListener('abort', onAbort, { once: true });
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
          const prepared = encodeOpenRouterDecisionRequest(input);
          checkDeadline();
          hooks.beforeCreate();
          const pending = client.alpha.decisions.create(prepared, {
            serverURL: 'https://openrouter.ai',
            retries: { strategy: 'none' },
            // A supplied signal takes precedence over SDK timeoutMs in 1.4.25.
            // The adapter timer owns the remaining construction + read budget.
            signal: controller.signal,
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
          });
          // SDK 1.4.25 awaits HTTPClient.request and matchers' response.text(),
          // JSON parsing and schema validation, without racing the reader on Abort.
          // Track that entire operation independently of outward cancellation.
          const cleanup = pending
            .then(
              () => {},
              () => {},
            )
            .then(() => {
              if (lifecycle.sdkRead === cleanup) lifecycle.sdkRead = undefined;
              hooks.onReadStateChange();
            });
          lifecycle.sdkRead = cleanup;
          hooks.onReadStateChange();
          const result = pending.then((data) => {
            checkDeadline();
            diagnostics.requestId =
              data.id &&
              /^gen-dec-[A-Za-z0-9_-]{1,200}$/.test(data.id) &&
              !data.id.includes(apiKey)
                ? data.id
                : null;
            return decodeOpenRouterDecision(data, input.permittedActions);
          });
          return await Promise.race([result, cancelled]);
        } catch (error) {
          if (controller.signal.aborted) throw abortError();
          if (
            error instanceof DecisionFailure ||
            error instanceof DecisionStopped
          )
            throw error;
          if (error instanceof OpenRouterError) {
            const status = error.statusCode;
            if (Number.isInteger(status) && status >= 100 && status <= 599) {
              diagnostics.http = status;
              throw new DecisionFailure(
                status >= 400
                  ? `API HTTP failure (${status})`
                  : 'Invalid API response',
              );
            }
          }
          if (error instanceof RequestTimeoutError)
            throw new DecisionFailure('SDK timeout');
          if (error instanceof RequestAbortedError)
            throw new DecisionFailure('API request aborted');
          if (error instanceof ConnectionError)
            throw new DecisionFailure(
              'API connection failure (network/CORS/access)',
            );
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
