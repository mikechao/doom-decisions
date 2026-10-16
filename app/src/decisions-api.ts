import { OpenAI } from 'openai/client';
import type {
  Decision,
  DecisionCreateParams,
} from 'openai/resources/decisions';
import { DecisionFailure, DecisionStopped } from './decision.ts';
import type {
  DecisionDiagnostics,
  DecisionHooks,
  DecisionLifecycle,
} from './decision-provider.ts';

export { DecisionFailure, DecisionStopped } from './decision.ts';

const deadlineMs = 10000;
const safeRequestId = (value: unknown) =>
  typeof value === 'string' && /^req_[A-Za-z0-9_-]{1,200}$/.test(value)
    ? value
    : null;
export function createClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.openai.com/v1',
    organization: null,
    project: null,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: deadlineMs,
    logLevel: 'off',
    fetchOptions: {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    },
  });
}
export async function requestDecision(
  client: OpenAI,
  preparedRequest: DecisionCreateParams,
  lifecycle: DecisionLifecycle,
  diagnostics: DecisionDiagnostics,
  hooks: DecisionHooks,
  startedAt: number,
): Promise<Decision> {
  const controller = new AbortController();
  lifecycle.apiController = controller;
  let timedOut = false;
  const abortError = () =>
    new DecisionFailure(
      timedOut ? 'API deadline exceeded (10 seconds)' : 'API request aborted',
    );
  let onAbort = () => {
    // Replaced synchronously by the Promise executor below.
  };
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError());
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  // A synchronous SDK failure can happen before the response race is installed.
  void cancelled.catch(() => {});
  // Request construction already elapsed under the controller's timing origin.
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
    hooks.beforeCreate();
    // Both response helpers observe this ONE SDK promise; neither retries nor
    // another call is used to obtain a request ID or parsed body.
    const pending = client.decisions.create(preparedRequest, {
      signal: controller.signal,
      maxRetries: 0,
      timeout: deadlineMs,
    });
    // Observe the public raw Response BEFORE starting SDK parsing. In 7.32.0,
    // withResponse() can reject on Abort/timeout while response.text() still runs.
    // Delegate the exact read and all decoding/error/response selection to the SDK.
    let readerSettlement: Promise<void> | undefined;
    let restoreText: (() => void) | undefined;
    const headers = Promise.resolve().then(async () => {
      const response = await pending.asResponse();
      const text = response.text;
      response.text = () => {
        const reading = text.call(response);
        readerSettlement = reading.then(
          () => {},
          () => {},
        );
        return reading;
      };
      restoreText = () => {
        response.text = text;
      };
      return response;
    });
    const body = headers.then(() => pending.withResponse());
    // Result cancellation does not release sdkRead.
    // Wait for both SDK helpers and the actual reader before clearing ownership.
    const readCleanup = Promise.allSettled([headers, body]).then(async () => {
      await readerSettlement; // Settlement of the actual reader, including late rejection.
      restoreText?.();
      if (lifecycle.sdkRead === readCleanup) lifecycle.sdkRead = undefined;
      hooks.onReadStateChange();
    });
    lifecycle.sdkRead = readCleanup;
    hooks.onReadStateChange();
    const responseData = (async () => {
      const response = await headers;
      checkDeadline();
      diagnostics.requestId = safeRequestId(
        response.headers.get('x-request-id'),
      );
      diagnostics.http = response.status;
      const { data, request_id } = await body;
      checkDeadline();
      diagnostics.requestId =
        safeRequestId(request_id) ?? diagnostics.requestId;
      return data;
    })();
    return await Promise.race([responseData, cancelled]);
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      if (
        status &&
        Number.isInteger(status) &&
        status >= 100 &&
        status <= 599
      ) {
        diagnostics.http = status;
        diagnostics.requestId =
          safeRequestId(error.requestID) ?? diagnostics.requestId;
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
    if (controller.signal.aborted) throw abortError();
    if (error instanceof DecisionFailure || error instanceof DecisionStopped)
      throw error;
    if (error instanceof SyntaxError)
      throw new DecisionFailure('Malformed API response JSON');
    if (error instanceof OpenAI.APIConnectionTimeoutError)
      throw new DecisionFailure('SDK timeout');
    if (error instanceof OpenAI.APIConnectionError)
      throw new DecisionFailure('API connection failure (network/CORS/access)');
    throw new DecisionFailure('SDK or response-body failure');
  } finally {
    clearTimeout(deadline);
    controller.signal.removeEventListener('abort', onAbort);
    if (lifecycle.apiController === controller)
      lifecycle.apiController = undefined;
    diagnostics.latencyMs = Math.round(performance.now() - startedAt);
  }
}
