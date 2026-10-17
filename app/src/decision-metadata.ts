import type { DecisionDiagnostics } from './decision-provider.ts';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const tokens = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

// Display-only allowlist. Never retain a body, arbitrary metadata or credentials.
export function readDecisionMetadata(
  data: unknown,
  provider: NonNullable<DecisionDiagnostics['requestIdentity']>['provider'],
  apiKey: string,
): NonNullable<DecisionDiagnostics['responseMetadata']> {
  const response = record(data);
  const usage = record(response.usage);
  const model = response.model;
  return {
    reportedModel:
      typeof model === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(model) &&
      (!apiKey || !model.includes(apiKey))
        ? model
        : null,
    usage: {
      input: tokens(
        provider === 'OpenRouter' ? usage.inputTokens : usage.input_tokens,
      ),
      output: tokens(
        provider === 'OpenRouter' ? usage.outputTokens : usage.output_tokens,
      ),
      // The other installed SDKs expose no reported total. Do not derive one.
      total: provider === 'OpenAI' ? tokens(usage.total_tokens) : null,
    },
  };
}
