import { isAgentId } from './agent-observation.ts';

export const agentRunLimit = 3;
export const maxAgentInstructions = 16000;
export const validAgentInstructions = (value: unknown): boolean =>
  typeof value === 'string' &&
  value.length <= maxAgentInstructions &&
  value.trim().length > 0;

export type AgentRunState = {
  runId: string;
  active: boolean;
  limit: 3;
  reserved: number;
  sdkInvoked: number;
  remaining: number;
};
export type AgentScope = {
  sessionId: string;
  runId: string;
  revision: number;
};
export const promptErrors = [
  'lease-revoked',
  'session-mismatch',
  'not-ready',
  'run-unavailable',
  'revision-conflict',
  'editor-open',
  'invalid-instructions',
] as const;
export type AgentPromptResult =
  | { error: (typeof promptErrors)[number] }
  | {
      sessionId: string;
      revision: number;
      instructions: string;
      run: AgentRunState | null;
    };

function requireValue(ok: unknown): asserts ok {
  if (!ok) throw Error('Invalid agent control.');
}
const revision = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
function keys(
  value: unknown,
  names: string[],
): asserts value is Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue(
    Object.keys(value).length === names.length &&
      names.every((name) => Object.hasOwn(value, name)),
  );
}
export function parseAgentRunState(value: unknown): AgentRunState {
  keys(value, [
    'runId',
    'active',
    'limit',
    'reserved',
    'sdkInvoked',
    'remaining',
  ]);
  requireValue(
    isAgentId(value.runId) &&
      typeof value.active === 'boolean' &&
      value.limit === agentRunLimit,
  );
  requireValue(
    revision(value.reserved) &&
      Number(value.reserved) <= agentRunLimit &&
      revision(value.sdkInvoked) &&
      Number(value.sdkInvoked) <= Number(value.reserved),
  );
  requireValue(
    value.remaining ===
      (value.active ? agentRunLimit - Number(value.reserved) : 0),
  );
  return value as AgentRunState;
}
export function parseAgentPromptResult(value: unknown): AgentPromptResult {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'error')) {
    keys(value, ['error']);
    requireValue(
      promptErrors.includes(value.error as (typeof promptErrors)[number]),
    );
  } else {
    keys(value, ['sessionId', 'revision', 'instructions', 'run']);
    requireValue(
      isAgentId(value.sessionId) &&
        revision(value.revision) &&
        validAgentInstructions(value.instructions),
    );
    if (value.run !== null) parseAgentRunState(value.run);
  }
  return value as AgentPromptResult;
}

// Shared strict command validation at broker AND browser ingress. No arbitrary
// configuration, action, credential or provider object can cross this boundary.
export function validAgentCommand(op: string, value: unknown): boolean {
  try {
    requireValue(
      ['observe', 'decide', 'get-prompt', 'set-prompt'].includes(op),
    );
    const data = value as Record<string, unknown>;
    const scoped =
      op === 'set-prompt' || (op === 'decide' && Object.hasOwn(data, 'runId'));
    keys(data, [
      'pageId',
      'ownerId',
      'epoch',
      'commandId',
      ...(op === 'decide' ? ['observationId'] : []),
      ...(op === 'get-prompt' ? ['sessionId'] : []),
      ...(scoped ? ['sessionId', 'runId', 'revision'] : []),
      ...(op === 'set-prompt' ? ['instructions'] : []),
    ]);
    requireValue(
      [
        'pageId',
        'ownerId',
        'epoch',
        'commandId',
        ...(op === 'decide' ? ['observationId'] : []),
        ...(op === 'get-prompt' || scoped ? ['sessionId'] : []),
        ...(scoped ? ['runId'] : []),
      ].every((name) => isAgentId(data[name])),
    );
    if (scoped) requireValue(revision(data.revision));
    if (op === 'set-prompt')
      requireValue(validAgentInstructions(data.instructions));
    return true;
  } catch {
    return false;
  }
}
