import { OpenAI } from 'openai/client';
import type { DecisionCreateParams } from 'openai/resources/decisions';
import { VERSION } from 'openai/version';
import { DecisionFailure } from './decision.ts';
import { readDecisionMetadata } from './decision-metadata.ts';
import type {
  DecisionProviderFactory,
  DecisionRequest,
  DecisionResult,
} from './decision-provider.ts';
import { createClient, requestDecision } from './decisions-api.ts';

export function encodeOpenAIDecisionRequest(
  input: DecisionRequest,
): DecisionCreateParams {
  return {
    model: 'gpt-6-luna',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: input.context },
          { type: 'input_image', image_url: input.png },
        ],
      },
    ],
    questions: [
      {
        type: 'choice',
        name: 'next_action',
        instructions: input.instructions,
        choices: input.permittedActions.map((value) => ({ value })),
      },
    ],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
export function decodeOpenAIDecision(data: unknown): DecisionResult {
  const answers = record(data).answers;
  if (!Array.isArray(answers) || answers.length !== 1)
    throw new DecisionFailure('Invalid answer count');
  const answer = record(answers[0]);
  if (answer.type === 'refusal') return { kind: 'refusal' };
  if (
    answer.type !== 'choice' ||
    answer.name !== 'next_action' ||
    typeof answer.choice !== 'string'
  )
    throw new DecisionFailure('Invalid next_action choice');
  return {
    kind: 'choice',
    action: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
  };
}

export const openAiDecisionProviderFactory: DecisionProviderFactory = {
  probe() {
    if (VERSION !== '7.32.0')
      throw Error('Require official OpenAI SDK 7.32.0.');
    const client = new OpenAI({
      apiKey: 'sdk-probe-not-a-credential',
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
      logLevel: 'off',
      fetch: async () => {
        throw Error('SDK availability probe cannot send requests.');
      },
    });
    if (typeof client.decisions?.create !== 'function')
      throw Error('Bundled SDK lacks decisions.create.');
    return {
      status: `OpenAI SDK ${VERSION} loaded · decisions.create available · manual steps or explicitly started continuous mode`,
      evidence: {
        version: VERSION,
        decisionsCreateAvailable: true,
        requestsEnabled: true,
      },
    };
  },
  create(apiKey) {
    const client = createClient(apiKey);
    return {
      request(input, lifecycle, diagnostics, hooks, startedAt) {
        // Keep encoding synchronous and outside the executor's error mapping,
        // as before: construction failures never charge an SDK invocation.
        const preparedRequest = encodeOpenAIDecisionRequest(input);
        diagnostics.requestIdentity = {
          provider: 'OpenAI',
          requestedModel: preparedRequest.model,
        };
        return requestDecision(
          client,
          preparedRequest,
          lifecycle,
          diagnostics,
          hooks,
          startedAt,
        ).then((data) => {
          diagnostics.responseMetadata = readDecisionMetadata(
            data,
            'OpenAI',
            apiKey,
          );
          return decodeOpenAIDecision(data);
        });
      },
    };
  },
};
