import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import {
  maxAgentInstructions,
  parseAgentConfigResult,
  parseAgentObserveResult,
  parseAgentPromptResult,
  promptErrors,
  validAgentLimit,
  validAgentCommand,
  type AgentConfigResult,
  type AgentObserveResult,
  type AgentPromptResult,
  type AgentScope,
} from '../app/src/agent-control.ts';
import {
  agentOrigin,
  agentPath,
  agentPngBytes,
  isAgentId,
  parseAgentDecisionResult,
  type AgentDecisionResult,
  type AgentObservation,
} from '../app/src/agent-observation.ts';

type LeaseIdentity = { pageId: string; ownerId: string; epoch: string };
export type AttachedLease = LeaseIdentity & {
  configuredDecisionBudget: number | null;
  budgetUnclaimedAtAttach: boolean;
  leaseFile: string;
};
export type DetachedLease = LeaseIdentity & { commandId: string; released: true };
type FileLease = { leaseFile: string };
type Correlation = { pageId: string; epoch: string; commandId: string };
export type MaterializedObserve = Correlation & Omit<AgentObserveResult, 'png'> & { pngPath: string };
export type MaterializedDecision = Correlation &
  Omit<AgentDecisionResult, 'observation'> & {
    pngPath: string | null;
    observation: Omit<AgentObservation, 'png'> | null;
  };
export type ConfigResult = Correlation & Exclude<AgentConfigResult, { error: string }>;
export type PromptResult = Correlation & Exclude<AgentPromptResult, { error: string }>;

export type AgentOperation =
  | { op: 'attach' }
  | ({ op: 'detach' } & FileLease)
  | ({ op: 'observe' } & FileLease)
  | ({ op: 'get-config' | 'get-prompt'; sessionId: string } & FileLease)
  | ({ op: 'start-run'; observationId: string; sessionId: string; revision: number } & FileLease)
  | ({ op: 'set-config'; configFile: string } & FileLease & AgentScope)
  | ({ op: 'set-prompt'; instructions?: string; instructionsFile?: string } & FileLease & AgentScope)
  | ({ op: 'decide'; observationId: string; scope?: AgentScope } & FileLease);

export type AgentClientOptions = { transport?: typeof fetch; temporaryRoot?: string };
type OperationResult = AttachedLease | DetachedLease | MaterializedObserve | MaterializedDecision | ConfigResult | PromptResult;

const errors = new Set<string>([
  'forbidden',
  'invalid-request',
  'no-ready-page',
  'multiple-pages',
  'owner-already-attached',
  'lease-revoked',
  'agent-stopped',
  'duplicate-command',
  'observation-busy',
  'observation-unavailable',
  'invalid-observation',
  ...promptErrors,
]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid bridge response.');
  return value as Record<string, unknown>;
}

function leaseValue(value: unknown): LeaseIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid agent lease.');
  const data = object(value);
  if (
    Object.keys(data).sort().join(',') !== 'epoch,ownerId,pageId' ||
    !isAgentId(data.pageId) ||
    !isAgentId(data.ownerId) ||
    !isAgentId(data.epoch)
  )
    throw Error('Invalid agent lease.');
  // Preserve the admitted file's property order in the wire command.
  return { ...data, pageId: data.pageId, ownerId: data.ownerId, epoch: data.epoch };
}

function attachedLeaseValue(value: unknown, expectedOwnerId: string) {
  const data = object(value);
  // Missing metadata is a protocol mismatch, not an absent allowance. Fail closed
  // so main never treats an older broker response as a safe preflight result.
  if (
    Object.keys(data).sort().join(',') !==
    'budgetUnclaimedAtAttach,configuredDecisionBudget,epoch,ownerId,pageId'
  )
    throw Error('Invalid agent attach acknowledgment.');
  const lease = leaseValue({
    pageId: data.pageId,
    ownerId: data.ownerId,
    epoch: data.epoch,
  });
  const configuredDecisionBudget = data.configuredDecisionBudget;
  const budgetUnclaimedAtAttach = data.budgetUnclaimedAtAttach;
  if (
    lease.ownerId !== expectedOwnerId ||
    !(configuredDecisionBudget === null || validAgentLimit(configuredDecisionBudget)) ||
    typeof budgetUnclaimedAtAttach !== 'boolean' ||
    (budgetUnclaimedAtAttach && configuredDecisionBudget === null)
  )
    throw Error('Invalid agent attach acknowledgment.');
  return {
    ...lease,
    configuredDecisionBudget,
    budgetUnclaimedAtAttach,
  };
}

async function materialize<T extends AgentObservation>(observation: T, leaseFile: string, commandId: string) {
  const bytes = agentPngBytes(observation.png);
  if (createHash('sha256').update(bytes).digest('hex') !== observation.pngSha256)
    throw Error('Invalid observation PNG hash.');
  const pngPath = join(dirname(leaseFile), `${commandId}.png`);
  await writeFile(pngPath, bytes, { mode: 0o600, flag: 'wx' });
  const { png: _png, ...metadata } = observation;
  return { pngPath, metadata };
}

// The final callback is CLI-only: retain lease-read/ID-before-syntax-error ordering.
// Programmatic callers supply typed inputs; all paths still validate wire commands.
export function executeAgentOperation(
  input: Extract<AgentOperation, { op: 'attach' }>,
  options?: AgentClientOptions,
): Promise<AttachedLease>;
export function executeAgentOperation(
  input: Extract<AgentOperation, { op: 'detach' }>,
  options?: AgentClientOptions,
): Promise<DetachedLease>;
export function executeAgentOperation(
  input: Extract<AgentOperation, { op: 'observe' }>,
  options?: AgentClientOptions,
): Promise<MaterializedObserve>;
export function executeAgentOperation(
  input: Extract<AgentOperation, { op: 'decide' }>,
  options?: AgentClientOptions,
  validateArguments?: () => void,
): Promise<MaterializedDecision>;
export function executeAgentOperation(
  input: Extract<AgentOperation, { op: 'set-prompt' }> | (FileLease & { op: 'get-prompt'; sessionId: string }),
  options?: AgentClientOptions,
  validateArguments?: () => void,
): Promise<PromptResult>;
export function executeAgentOperation(
  input:
    | Extract<AgentOperation, { op: 'set-config' | 'start-run' }>
    | (FileLease & { op: 'get-config'; sessionId: string }),
  options?: AgentClientOptions,
  validateArguments?: () => void,
): Promise<ConfigResult>;
export function executeAgentOperation(
  input: AgentOperation,
  options?: AgentClientOptions,
  validateArguments?: () => void,
): Promise<OperationResult>;
export async function executeAgentOperation(
  input: AgentOperation,
  { transport = fetch, temporaryRoot = tmpdir() }: AgentClientOptions = {},
  validateArguments?: () => void,
): Promise<OperationResult> {
  async function post(op: AgentOperation['op'], body: object): Promise<unknown> {
    const response = await transport(`${agentOrigin}${agentPath}/${op}`, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Doom-Agent': 'cli' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(op === 'decide' ? 35000 : 15000),
    });
    const text = await response.text();
    if (text.length > 2_100_000) throw Error('Invalid bridge response.');
    const data: unknown = JSON.parse(text);
    if (!response.ok) {
      const error = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
      throw Error(typeof error === 'string' && errors.has(error) ? error : 'Agent bridge rejected request.');
    }
    return data;
  }
  if (input.op === 'attach') {
    const ownerId = randomUUID();
    const attached = attachedLeaseValue(await post('attach', { ownerId }), ownerId);
    const directory = await mkdtemp(join(temporaryRoot, 'doom-agent-'));
    const leaseFile = join(directory, 'lease.json');
    const lease = {
      pageId: attached.pageId,
      ownerId: attached.ownerId,
      epoch: attached.epoch,
    };
    await writeFile(leaseFile, JSON.stringify(lease), { mode: 0o600, flag: 'wx' });
    return { ...attached, leaseFile };
  }
  if (!isAbsolute(input.leaseFile)) throw Error('Invalid agent lease.');
  const lease = leaseValue(JSON.parse(await readFile(input.leaseFile, 'utf8')));
  // Observation IDs reserve decision IDs even after a timeout/lost response.
  const commandId = input.op === 'decide' ? input.observationId : randomUUID();
  validateArguments?.();
  const command: Record<string, unknown> = { ...lease, commandId };
  if (input.op === 'detach') {
    const result = object(await post('detach', command));
    if (
      Object.keys(result).sort().join(',') !== 'commandId,epoch,ownerId,pageId,released' ||
      result.pageId !== lease.pageId || result.ownerId !== lease.ownerId || result.epoch !== lease.epoch ||
      result.commandId !== commandId || result.released !== true
    )
      throw Error('Invalid detach acknowledgment.');
    return { ...lease, commandId, released: true };
  }
  if (input.op === 'decide' || input.op === 'start-run') command.observationId = input.observationId;
  if (input.op === 'start-run') Object.assign(command, { sessionId: input.sessionId, revision: input.revision });
  if (input.op === 'get-config' || input.op === 'get-prompt' || input.op === 'set-config' || input.op === 'set-prompt')
    command.sessionId = input.sessionId;
  if (input.op === 'set-config' || input.op === 'set-prompt')
    Object.assign(command, { sessionId: input.sessionId, runId: input.runId, revision: input.revision });
  if (input.op === 'decide' && input.scope) Object.assign(command, input.scope);
  if (
    input.op === 'set-prompt' &&
    Object.hasOwn(input, 'instructions') === Object.hasOwn(input, 'instructionsFile')
  )
    throw Error('Invalid command.');
  if (input.op === 'set-prompt' && Object.hasOwn(input, 'instructions')) {
    if (typeof input.instructions !== 'string') throw Error('Invalid command.');
    command.instructions = input.instructions;
  } else if (input.op === 'set-config' || input.op === 'set-prompt') {
    const file = input.op === 'set-config' ? input.configFile : input.instructionsFile;
    if (typeof file !== 'string' || !isAbsolute(file) || /(^|\/)\.env[^/]*$/.test(file))
      throw Error('Invalid settings file.');
    const bytes = await readFile(file);
    if (bytes.length > maxAgentInstructions * 4 + (input.op === 'set-config' ? 1024 : 0))
      throw Error('Invalid settings file.');
    if (input.op === 'set-config') command.configuration = JSON.parse(bytes.toString('utf8'));
    else command.instructions = bytes.toString('utf8');
  }
  if (!validAgentCommand(input.op, command)) throw Error('Invalid command.');
  const result = object(await post(input.op, command));
  const configCommand = ['get-config', 'set-config', 'start-run'].includes(input.op);
  const field =
    input.op === 'decide' ? 'decision' : input.op === 'observe' ? 'observation' : configCommand ? 'config' : 'prompt';
  if (
    Object.keys(result).sort().join(',') !== ['commandId', 'epoch', field, 'pageId'].sort().join(',') ||
    result.pageId !== lease.pageId ||
    result.epoch !== lease.epoch ||
    result.commandId !== commandId
  )
    throw Error('Invalid command correlation.');
  const correlation = { pageId: lease.pageId, epoch: lease.epoch, commandId };
  if (input.op !== 'observe' && input.op !== 'decide') {
    const prompt = configCommand ? parseAgentConfigResult(result.config) : parseAgentPromptResult(result.prompt);
    if ('error' in prompt) throw Error(prompt.error);
    const setting = input.op === 'set-config' || input.op === 'set-prompt';
    if (prompt.sessionId !== input.sessionId || (setting && prompt.run?.runId !== input.runId))
      throw Error('Invalid prompt correlation.');
    // Compare against the exact submitted snapshot, never reread the settings file.
    if (
      setting &&
      (prompt.revision !== input.revision + 1 ||
        (input.op === 'set-config'
          ? !('configuration' in prompt) ||
            !Object.entries(object(command.configuration)).every(
              ([key, value]) => object(prompt.configuration)[key] === value,
            )
          : !('instructions' in prompt) || prompt.instructions !== command.instructions))
    )
      throw Error('Invalid settings acknowledgment.');
    if (input.op === 'start-run' && (!prompt.run?.active || prompt.revision !== input.revision))
      throw Error('claim-failed');
    return { ...correlation, ...prompt };
  }
  if (input.op === 'decide') {
    const decision = parseAgentDecisionResult(result.decision);
    if (decision.beforeObservationId !== input.observationId) throw Error('Invalid decision correlation.');
    const image = decision.observation ? await materialize(decision.observation, input.leaseFile, commandId) : null;
    return { ...correlation, pngPath: image?.pngPath ?? null, ...decision, observation: image?.metadata ?? null };
  }
  const observation = parseAgentObserveResult(result.observation);
  const image = await materialize(observation, input.leaseFile, commandId);
  return { ...correlation, pngPath: image.pngPath, ...image.metadata };
}

// Shared by CLI stderr and MCP. Never expose raw exceptions.
export function agentCliError(error: unknown): { error: string } {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : undefined;
  return {
    error:
      typeof message === 'string' && (errors.has(message) || message.startsWith('Usage:'))
        ? message
        : 'Agent command failed; outcome may be unknown. Check the dev:agent page and lease; no retry was made.',
  };
}
