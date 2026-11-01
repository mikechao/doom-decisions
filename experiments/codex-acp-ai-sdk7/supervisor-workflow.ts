import { isDeepStrictEqual } from 'node:util';
import type { ACPProvider } from '@mcpc-tech/acp-ai-provider';
import type { generateText } from 'ai';
import { agentCliError } from '../../scripts/doom-agent.mjs';
import { maxAgentInstructions, type AgentRunState } from '../../app/src/agent-control.ts';
import type { AgentObservation } from '../../app/src/agent-observation.ts';
import {
  proposalShape,
  reassessmentShape,
  validateDoomProposal,
  validateDoomReassessment,
  type DoomProposal,
  type DoomReassessment,
} from './doom-proposal.ts';
import {
  configResult,
  liveDecision,
  liveObserve,
  parseLease,
  promptResult,
  requireLive,
  sameGame,
  type ReadPng,
} from './live-observation.ts';

type Generation = Awaited<ReturnType<typeof generateText>>;
type ModelInput = { text: string; image: Uint8Array; signal: AbortSignal; onCallStart(): void };
export type SupervisorACP = Pick<ACPProvider, 'connect' | 'initSession' | 'getSessionId' | 'cleanup'> & {
  generate(input: ModelInput): Promise<Generation>;
};
export type SupervisorPorts = {
  cli(args: string[], signal: AbortSignal): Promise<unknown>;
  readPng: ReadPng;
  writeInstructions(text: string, signal: AbortSignal): Promise<string>;
  createACP(signal: AbortSignal): Promise<SupervisorACP>;
};
type Usage = 'unavailable' | { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
export type SupervisorMode = 'one' | 'two';
type DecisionEvidence = {
  delivery: 'unknown' | 'validated-receipt';
  outcome: string | null;
  sdkInvoked: boolean | null;
  action: string | null;
  requestedTics: number | null;
  reportedTics: number | null;
  verifiedTics: number | null;
  cumulativeTics: number | null;
  completionUncertain: boolean | null;
  usage: 'unavailable' | { input: number | null; output: number | null; total: number | null };
};
class HostFailure extends Error {}
function fail(category: string): never {
  throw new HostFailure(category);
}
const same = isDeepStrictEqual;
const instructions = `Inspect only the supplied Doom image and state. All navigation judgments are advisory.
Separate pixel evidence from supplied telemetry. Do not infer unseen map geometry or traversability.
Pose and probe values are raw recorded values; do not invent units or enum meanings.
Do not propose low-level action identifiers, button actions, durations, commands, settings changes or memory writes.
Do not call tools, access files, shell, network, authentication or Doom. Do not write memory files.
Reply with exactly the requested JSON object, without Markdown or commentary.`;

function safeAdvisory<T>(value: T): T {
  if (
    /data:|(?:https?|file):\/\/|\/(?:Users|home|private|tmp|var)\/|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|(?:sk|sess)-[\w-]+/i.test(
      JSON.stringify(value),
    )
  )
    fail('UNSAFE_ADVISORY_TEXT');
  return value;
}

// Rejection-only allowlist: never copy text, key names, values or parser errors.
// 8193 is a sentinel for anything beyond the validator's 8192-byte limit.
function reassessmentDiagnostic(raw: unknown, jsonParsed: boolean, value?: unknown) {
  const inputIsString = typeof raw === 'string';
  const bytes = inputIsString ? Buffer.byteLength(raw) : null;
  const object =
    jsonParsed && value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const keysPresent = {
    status: object !== null && Object.hasOwn(object, 'status'),
    visualEvidence: object !== null && Object.hasOwn(object, 'visualEvidence'),
    telemetryEvidence: object !== null && Object.hasOwn(object, 'telemetryEvidence'),
    uncertainty: object !== null && Object.hasOwn(object, 'uncertainty'),
    nextGuidance: object !== null && Object.hasOwn(object, 'nextGuidance'),
  };
  const evidence = object ? [object.visualEvidence, object.telemetryEvidence] : [];
  const next =
    object?.nextGuidance && typeof object.nextGuidance === 'object' && !Array.isArray(object.nextGuidance)
      ? (object.nextGuidance as Record<string, unknown>)
      : null;
  const continuing = object?.status === 'continue' || object?.status === 'revise';
  // Mirror only the delegated byte-limit measurement, never its acceptance.
  const delegatedBytes = object
    ? Buffer.byteLength(
        JSON.stringify({
          target: continuing ? next?.target : 'Reassess original objective',
          visualEvidence: object.visualEvidence,
          telemetryEvidence: object.telemetryEvidence,
          uncertainty: object.uncertainty,
          nextExperiment: continuing ? next?.nextExperiment : 'No further gameplay authorized',
        }),
      )
    : null;
  return {
    inputIsString,
    utf8BytesUpTo8193: bytes === null ? null : Math.min(bytes, 8193),
    byteLimitExceeded: bytes === null ? null : bytes > 8192,
    hasFenceMarker: inputIsString && (raw.includes('```') || raw.includes('~~~')),
    jsonParsed,
    rootType: !jsonParsed ? null : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    keysPresent,
    unexpectedKeyCount: object ? Object.keys(object).filter((key) => !Object.hasOwn(keysPresent, key)).length : null,
    statusValid: object
      ? typeof object.status === 'string' && ['continue', 'revise', 'achieved', 'uncertain'].includes(object.status)
      : null,
    delegatedByteLimitExceeded: delegatedBytes === null ? null : delegatedBytes > 8192,
    fieldTextOverLimit: object
      ? [object.uncertainty, next?.target, next?.nextExperiment].some(
          (text) => typeof text === 'string' && text.length > 800,
        ) ||
        evidence.some(
          (items) => Array.isArray(items) && items.some((item) => typeof item === 'string' && item.length > 400),
        )
      : null,
    evidenceCountOverLimit: object ? evidence.some((items) => Array.isArray(items) && items.length > 5) : null,
  };
}

export function composeGuidance(
  base: string,
  proposal: Pick<DoomProposal, 'target' | 'nextExperiment' | 'uncertainty'>,
) {
  requireLive(base.includes('{{tics}}'));
  // Conservative explicit-directive guard, not semantic isolation of natural language.
  safeAdvisory(proposal);
  for (const text of [proposal.target, proposal.nextExperiment, proposal.uncertainty]) {
    if (
      /\b(?:neutral|forward|turn_right|backward|turn_left|fire)\b|^\s*use\s*$|\b(?:action|choose|select|press|hold|turn)\s+(?:use|left|right)\b|\b(?:tics?|ticks?|seconds?|milliseconds?|duration)\b/i.test(
        text,
      )
    )
      fail('UNSAFE_ADVISORY_TEXT');
  }
  const text = `${base}\n\nAdvisory navigation interpretation (unverified): ${JSON.stringify({
    objective: proposal.target,
    question: proposal.nextExperiment,
    uncertainty: proposal.uncertainty,
  })}\nUse current verified evidence to assess this question. You retain selection of the low-level action; this is not a command or proof of a route.`;
  requireLive(text.length <= maxAgentInstructions);
  return text;
}

function usage(value: Generation['totalUsage']): Usage {
  const count = (n: number | undefined) => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null);
  const result = {
    inputTokens: count(value.inputTokens),
    outputTokens: count(value.outputTokens),
    totalTokens: count(value.totalTokens),
  };
  return Object.values(result).some((n) => n !== null) ? result : 'unavailable';
}

function runMatches(run: AgentRunState | null, runId: string, limit: 1 | 2, completed: number) {
  requireLive(
    run &&
      run.runId === runId &&
      run.limit === limit &&
      run.active === completed < limit &&
      run.reserved === completed &&
      run.sdkInvoked === completed &&
      run.remaining === limit - completed,
  );
  return run;
}

// No real defaults: callers must supply every I/O port. The linear workflow has
// one or two fixed decisions and no recovery/retry path.
export async function supervise(
  ports: SupervisorPorts,
  options: {
    signal?: AbortSignal;
    stageMs?: number;
    overallMs?: number;
    mode?: SupervisorMode;
  } = {},
) {
  const report = initialReport();
  const limit = options.mode === 'two' ? 2 : 1;
  const abort = new AbortController();
  const cancel = () => abort.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const until = Date.now() + (options.overallMs ?? 480_000);
  let acp: SupervisorACP | undefined;
  let attached = false;
  let finished = false;
  let mutationPending = false;
  const observationIds = new Set<string>();
  const decidedIds = new Set<string>();

  try {
    requireLive(options.mode === undefined || options.mode === 'one' || options.mode === 'two');
    const { lease, initial } = await attachAndObserveInitial();
    const before = initial.observation;
    const advisory = await openAdvisorySession();
    const proposal = await proposeNavigation(advisory, initial);

    // Prepare the complete guidance before claiming the nonrefundable allowance.
    const originalTemplate = before.configuration.instructionTemplate;
    const guidance = composeGuidance(originalTemplate, proposal);
    const file = await bounded('instructions-file', () => ports.writeInstructions(guidance, abort.signal));
    const runId = await claimRun(lease, before);
    const promptAcknowledgment = await applyGuidanceCAS(lease, before, runId, guidance, file);
    const ready = await observeAndConfirmGuidance(lease, before, runId, guidance, promptAcknowledgment);

    // The provider selects the action; the browser owns duration and execution.
    // This command supplies scope, never an action override.
    const after = await requestAndValidateDecision(lease, ready, runId);
    acceptCompleted(after);
    if (limit === 1) {
      await readExhaustedAccounting(lease, ready, runId);
      await reassessOriginalObjective(advisory, initial, after);
    } else {
      const interim = await observeInterim(lease, ready, runId, after);
      await reassessOriginalObjective(advisory, initial, after);
      const reassessment = report.reassessment;
      requireLive(reassessment);
      if (reassessment.nextGuidance === null) {
        report.outcome = 'partial';
        report.stage = 'early-advisory-end';
        report.humanStopRequired = true;
        return report;
      }
      const secondGuidance = composeGuidance(originalTemplate, {
        ...reassessment.nextGuidance,
        uncertainty: reassessment.uncertainty,
      });
      if (secondGuidance === guidance) fail('UNCHANGED_GUIDANCE');
      const secondFile = await bounded('instructions-file', () =>
        ports.writeInstructions(secondGuidance, abort.signal),
      );
      const secondAcknowledgment = await applyGuidanceCAS(lease, interim, runId, secondGuidance, secondFile);
      const secondReady = await observeAndConfirmGuidance(lease, interim, runId, secondGuidance, secondAcknowledgment);
      const secondAfter = await requestAndValidateDecision(lease, secondReady, runId);
      acceptCompleted(secondAfter);
      await readExhaustedAccounting(lease, secondReady, runId);
      // Exactly two ACP checkpoints. No final advisory turn in two-decision mode.
    }
    report.outcome = 'completed';
    report.stage = 'complete';
  } catch (error) {
    report.errorCategory = error instanceof HostFailure ? error.message : 'INVALID_EVIDENCE_OR_MODEL_RESULT';
    report.outcome =
      report.errorCategory === 'AGENT_STOPPED'
        ? 'stopped'
        : report.errorCategory === 'TERMINAL'
          ? 'terminal'
          : mutationPending ||
              report.decisions.some((decision) => decision.completionUncertain) ||
              (report.claim !== 'not-attempted' && !report.accounting && !report.interimAccounting)
            ? 'uncertain'
            : 'failed';
    report.humanStopRequired = attached && !['stopped', 'terminal'].includes(report.outcome);
  } finally {
    finished = true;
    abort.abort();
    options.signal?.removeEventListener('abort', cancel);
    if (acp) {
      try {
        acp.cleanup();
        report.cleanup =
          acp.getSessionId() === null ? 'returned-session-cleared; child-exit-unverified' : 'session-not-cleared';
      } catch {
        report.cleanup = 'cleanup-failed; child-exit-unverified';
      }
      if (report.outcome === 'completed' && report.cleanup !== 'returned-session-cleared; child-exit-unverified') {
        report.outcome = 'uncertain';
        report.humanStopRequired = attached;
      }
    }
  }
  return report;

  // Phase helpers retain the report as the invocation/evidence ledger. Evidence
  // passed between phases stays distinct from transport and checkpoint mechanics.
  type Lease = ReturnType<typeof parseLease>;
  type ObservationEvidence = Awaited<ReturnType<typeof liveObserve>>;
  type Observation = ObservationEvidence['observation'];
  type AdvisorySession = { supervisor: SupervisorACP; acpSession: string };

  function rememberObservation(observation: AgentObservation) {
    requireLive(!observationIds.has(observation.observationId));
    observationIds.add(observation.observationId);
  }

  function unchangedNative(next: AgentObservation, previous: AgentObservation) {
    sameGame(next, previous);
    requireLive(
      next.tic === previous.tic &&
        same(next.frame, previous.frame) &&
        same(next.telemetry, previous.telemetry) &&
        same(next.facingProbe, previous.facingProbe) &&
        same(next.previousAction, previous.previousAction) &&
        next.counters.leveltime === previous.counters.leveltime,
    );
  }

  function acceptCompleted(after: Awaited<ReturnType<typeof liveDecision>>) {
    const receipt = after.receipt;
    // Prefix evidence is already recorded. Stop/terminal/unsuccessful results cannot continue.
    if (receipt.outcome !== 'completed' && receipt.outcome !== 'terminal')
      fail(receipt.outcome === 'stopped' ? 'AGENT_STOPPED' : 'DECISION_NOT_COMPLETED');
    requireLive(receipt.reason === null && receipt.requestedTics === 6 && receipt.verifiedTics !== null);
    if (receipt.outcome === 'terminal') fail('TERMINAL');
    report.verifiedActions++;
  }

  async function observeInterim(
    lease: Lease,
    ready: Observation,
    runId: string,
    after: Awaited<ReturnType<typeof liveDecision>>,
  ) {
    requireLive(after.receipt.observation);
    const raw = await command(['observe', '--lease', lease.leaseFile]);
    const { observation } = await bounded('interim-observation', () =>
      liveObserve(raw, lease, ports.readPng, abort.signal),
    );
    unchangedNative(observation, after.receipt.observation);
    requireLive(observation.revision === ready.revision && same(observation.configuration, ready.configuration));
    const { runId: _runId, ...counts } = runMatches(observation.run, runId, limit, 1);
    rememberObservation(observation);
    report.interimAccounting = counts;
    return observation;
  }

  async function attachAndObserveInitial() {
    attached = true; // A lost attach response can still leave ownership behind.
    const lease = parseLease(await command(['attach']));
    report.attachment = 'acknowledged';
    const initialRaw = await command(['observe', '--lease', lease.leaseFile]);
    const initial = await bounded('initial-observation', () =>
      liveObserve(
        // Materialization is read separately so parsing never causes transport I/O.
        initialRaw,
        lease,
        ports.readPng,
        abort.signal,
      ),
    );
    const before = initial.observation;
    rememberObservation(before);
    requireLive(
      before.run === null &&
        before.configuration.tics === 6 &&
        before.configuration.instructionTemplate.includes('{{tics}}'),
    );
    return { lease, initial };
  }

  async function openAdvisorySession(): Promise<AdvisorySession> {
    report.cleanup = 'creation-outcome-unverified';
    const supervisor = await bounded(
      'acp-create',
      async () => {
        const value = await ports.createACP(abort.signal);
        if (abort.signal.aborted) {
          value.cleanup();
          fail('HOST_CANCELLED');
        }
        return value;
      },
      45_000,
    );
    acp = supervisor; // Register cleanup ownership before connect/init can fail.
    await bounded('acp-connect', () => supervisor.connect(), 45_000);
    await bounded(
      'acp-session',
      () => {
        report.acpSessionStarts++;
        return supervisor.initSession();
      },
      45_000,
    );
    const acpSession = supervisor.getSessionId();
    requireLive(acpSession);
    report.acpSessions = 1;
    return { supervisor, acpSession };
  }

  async function proposeNavigation(advisory: AdvisorySession, initial: ObservationEvidence) {
    report.proposal = safeAdvisory(
      validateDoomProposal(
        await checkpoint(
          advisory,
          `${instructions}\nChoose ONE observable navigation objective/question. Shape=${JSON.stringify(proposalShape)}\nSTATE=${JSON.stringify(initial.payload)}`,
          initial.image,
        ),
      ),
    );
    return report.proposal;
  }

  async function claimRun(lease: Lease, before: Observation) {
    const configuration = before.configuration;
    open();
    const started = configResult(
      await command([
        'start-run',
        '--lease',
        lease.leaseFile,
        '--observation',
        before.observationId,
        '--session',
        before.sessionId,
        '--revision',
        String(before.revision),
      ]),
      lease,
    );
    if ('error' in started) fail(started.error === 'lease-revoked' ? 'LEASE_REVOKED' : 'CLAIM_REJECTED');
    requireLive(
      started.sessionId === before.sessionId &&
        started.revision === before.revision &&
        same(started.configuration, configuration) &&
        started.run,
    );
    const runId = started.run.runId;
    runMatches(started.run, runId, limit, 0);
    report.claim = 'acknowledged';
    mutationPending = false;
    return runId;
  }

  async function applyGuidanceCAS(lease: Lease, before: Observation, runId: string, guidance: string, file: string) {
    requireLive(report.guidance.length < limit);
    report.guidance.push('application-unknown');
    const changed = promptResult(
      await command([
        'set-prompt',
        '--lease',
        lease.leaseFile,
        '--session',
        before.sessionId,
        '--run',
        runId,
        '--revision',
        String(before.revision),
        '--instructions-file',
        file,
      ]),
      lease,
    );
    if ('error' in changed) fail('GUIDANCE_REJECTED');
    requireLive(
      changed.sessionId === before.sessionId &&
        changed.revision === before.revision + 1 &&
        changed.instructions === guidance,
    );
    runMatches(changed.run, runId, limit, report.verifiedActions);
    mutationPending = false;
    report.guidance[report.guidance.length - 1] = 'last-acknowledged; current-state-unverified';
    return changed;
  }

  async function observeAndConfirmGuidance(
    lease: Lease,
    before: Observation,
    runId: string,
    guidance: string,
    changed: Awaited<ReturnType<typeof applyGuidanceCAS>>,
  ) {
    const configuration = before.configuration;
    const freshRaw = await command(['observe', '--lease', lease.leaseFile]);
    const fresh = await bounded('fresh-observation', () => liveObserve(freshRaw, lease, ports.readPng, abort.signal));
    const ready = fresh.observation;
    unchangedNative(ready, before);
    requireLive(
      ready.revision === changed.revision &&
        same(ready.configuration, { ...configuration, instructionTemplate: guidance }) &&
        ready.observationId !== before.observationId,
    );
    runMatches(ready.run, runId, limit, report.verifiedActions);
    rememberObservation(ready);
    report.guidance[report.guidance.length - 1] = 'independently-observed';
    return ready;
  }

  async function requestAndValidateDecision(lease: Lease, ready: Observation, runId: string) {
    open();
    const decisionRaw = await command([
      'decide',
      '--lease',
      lease.leaseFile,
      '--observation',
      ready.observationId,
      '--session',
      ready.sessionId,
      '--run',
      runId,
      '--revision',
      String(ready.revision),
    ]);
    const after = await bounded('decision-evidence', () =>
      liveDecision(decisionRaw, lease, ready, ports.readPng, abort.signal),
    );
    const receipt = after.receipt;
    const evidence = report.decisions[report.decisions.length - 1];
    evidence.delivery = 'validated-receipt';
    evidence.outcome = receipt.outcome;
    evidence.sdkInvoked = receipt.sdkInvoked;
    evidence.action = receipt.action;
    evidence.requestedTics = receipt.requestedTics;
    evidence.reportedTics = receipt.reportedTics;
    // A retired/uncertain result can still retain an independently verified
    // native prefix. Preserve it without calling the whole action completed.
    evidence.verifiedTics = receipt.verifiedTics;
    evidence.cumulativeTics = receipt.cumulativeTics;
    evidence.completionUncertain = receipt.completionUncertain;
    if (receipt.responseMetadata && Object.values(receipt.responseMetadata.usage).some((n) => n !== null))
      evidence.usage = receipt.responseMetadata.usage;
    if (receipt.observation) rememberObservation(receipt.observation);
    mutationPending = false;
    return after;
  }

  async function readExhaustedAccounting(lease: Lease, ready: Observation, runId: string) {
    const final = configResult(
      await command(['get-config', '--lease', lease.leaseFile, '--session', ready.sessionId]),
      lease,
    );
    if ('error' in final) fail('ACCOUNTING_UNAVAILABLE');
    requireLive(
      final.sessionId === ready.sessionId &&
        final.revision === ready.revision &&
        same(final.configuration, ready.configuration),
    );
    const { runId: _runId, ...counts } = runMatches(final.run, runId, limit, limit);
    report.accounting = counts;
    report.guidance[report.guidance.length - 1] =
      'lease-local-retained; exhausted run cannot restore through set-prompt';
  }

  async function reassessOriginalObjective(
    advisory: AdvisorySession,
    initial: ObservationEvidence,
    after: Awaited<ReturnType<typeof liveDecision>>,
  ) {
    requireLive(after.image && after.payload);
    // Completion, cancellation, session and tool checks stay outside text validation.
    const reassessmentText = await checkpoint(
      advisory,
      `${instructions}\nReassess the ORIGINAL objective from the prior turn against the new POST-ACTION image. ${
        limit === 2
          ? 'One further browser decision is authorized only if you supply defensible nextGuidance. Continue/revise require target and nextExperiment. Achieved/uncertain require nextGuidance:null and end gameplay. Uncertain means no defensible next experiment can be offered.'
          : 'No more gameplay will occur. Any nextGuidance is advisory only. Continue/revise require target and nextExperiment; achieved/uncertain require nextGuidance:null.'
      }\nShape=${JSON.stringify(reassessmentShape)}\nORIGINAL_OBJECTIVE=${JSON.stringify(report.proposal)}\nBEFORE=${JSON.stringify(initial.payload)}\nAFTER=${JSON.stringify(after.payload)}`,
      after.image,
    );
    // Both checkpoints passed their before/after ID checks; not proof of
    // invisible provider-internal continuity or reassessment acceptance.
    report.sameACPSession = true;
    report.stage = 'reassessment-validation';
    let parsed: unknown;
    function rejectReassessment(category: string, jsonParsed: boolean): never {
      report.reassessmentDiagnostic = reassessmentDiagnostic(reassessmentText, jsonParsed, parsed);
      fail(category);
    }
    if (typeof reassessmentText !== 'string') rejectReassessment('INVALID_REASSESSMENT_SHAPE', false);
    try {
      parsed = JSON.parse(reassessmentText);
    } catch (error) {
      if (error instanceof SyntaxError) rejectReassessment('INVALID_REASSESSMENT_JSON', false);
      throw error;
    }
    let validated: DoomReassessment;
    try {
      validated = validateDoomReassessment(reassessmentText);
    } catch (error) {
      // These are the existing validators' explicit rejection sentinels only.
      // TypeErrors and other unexpected exceptions retain the generic category.
      if (
        error instanceof Error &&
        error.constructor === Error &&
        ['INVALID_REASSESSMENT', 'INVALID_PROPOSAL'].includes(error.message)
      )
        rejectReassessment('INVALID_REASSESSMENT_SHAPE', true);
      throw error;
    }
    try {
      safeAdvisory(validated);
      if (validated.nextGuidance)
        composeGuidance('{{tics}}', { ...validated.nextGuidance, uncertainty: validated.uncertainty });
      report.reassessment = validated;
    } catch (error) {
      if (error instanceof HostFailure && error.message === 'UNSAFE_ADVISORY_TEXT')
        rejectReassessment('UNSAFE_ADVISORY_TEXT', true);
      throw error;
    }
    requireLive(advisory.supervisor.getSessionId() === advisory.acpSession);
  }

  // Shared mechanics preserve the original operation bounds, invocation timing,
  // cancellation fences, and protocol checks; phases do not add outer timeouts.
  async function checkpoint(advisory: AdvisorySession, text: string, image: Uint8Array) {
    const { supervisor, acpSession } = advisory;
    open();
    requireLive(supervisor.getSessionId() === acpSession && report.supervisorCalls < 2);
    let calls = 0;
    const result = await bounded(
      'acp-checkpoint',
      () => {
        report.supervisorCalls++;
        return supervisor.generate({
          text,
          image,
          signal: abort.signal,
          onCallStart() {
            open();
            calls++;
            report.providerCallStarts++;
            requireLive(calls === 1);
          },
        });
      },
      120_000,
    );
    open();
    requireLive(
      calls === 1 &&
        supervisor.getSessionId() === acpSession &&
        result.finishReason === 'stop' &&
        result.rawFinishReason === 'end_turn' &&
        result.steps.every((step) => step.toolCalls.length === 0),
    );
    report.supervisorUsage.push(usage(result.totalUsage));
    return result.text;
  }

  function open() {
    if (abort.signal.aborted || finished) fail('HOST_CANCELLED');
    if (Date.now() >= until) fail('HOST_DEADLINE');
  }
  async function bounded<T>(stage: string, operation: () => Promise<T>, ms = 15_000): Promise<T> {
    open();
    report.stage = stage;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          open();
          return operation();
        }),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new HostFailure('HOST_CANCELLED'));
          abort.signal.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(
            () => {
              reject(new HostFailure('HOST_DEADLINE'));
              abort.abort();
            },
            Math.max(1, Math.min(options.stageMs ?? ms, until - Date.now())),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      abort.signal.removeEventListener('abort', onAbort);
    }
  }
  async function command(args: string[]) {
    return bounded(
      args[0],
      async () => {
        if (args[0] === 'start-run') {
          requireLive(report.startRunCalls === 0);
          report.startRunCalls++;
          report.claim = 'unknown';
        }
        if (args[0] === 'decide') {
          requireLive(report.decideCalls < limit && !decidedIds.has(args[4]));
          decidedIds.add(args[4]);
          report.decisions.push({
            delivery: 'unknown',
            outcome: null,
            sdkInvoked: null,
            action: null,
            requestedTics: null,
            reportedTics: null,
            verifiedTics: null,
            cumulativeTics: null,
            completionUncertain: null,
            usage: 'unavailable',
          });
        }
        if (['start-run', 'set-prompt', 'decide'].includes(args[0])) mutationPending = true;
        try {
          return await ports.cli(args, abort.signal);
        } catch (error) {
          const sanitized = agentCliError(error).error;
          report.transportError = sanitized.startsWith('Usage:') ? 'Invalid command arguments.' : sanitized;
          if (sanitized === 'agent-stopped') fail('AGENT_STOPPED');
          fail('CLI_FAILED');
        }
      },
      args[0] === 'decide' ? 35_000 : 15_000,
    );
  }

  function initialReport() {
    const decisions: DecisionEvidence[] = [];
    return {
      mode: options.mode ?? 'one',
      outcome: 'failed' as 'completed' | 'partial' | 'failed' | 'uncertain' | 'stopped' | 'terminal',
      stage: 'initialization',
      errorCategory: null as string | null,
      transportError: null as string | null,
      startRunCalls: 0,
      get decideCalls() {
        return decisions.length;
      },
      decisions,
      supervisorCalls: 0,
      providerCallStarts: 0,
      acpSessionStarts: 0,
      acpSessions: 0,
      sameACPSession: false,
      claim: 'not-attempted' as 'not-attempted' | 'unknown' | 'acknowledged',
      attachment: 'unknown' as 'unknown' | 'acknowledged',
      verifiedActions: 0,
      interimAccounting: null as Omit<AgentRunState, 'runId'> | null,
      accounting: null as Omit<AgentRunState, 'runId'> | null,
      supervisorUsage: [] as Usage[],
      totalCost: 'unavailable',
      proposal: null as DoomProposal | null,
      reassessment: null as DoomReassessment | null,
      reassessmentDiagnostic: null as ReturnType<typeof reassessmentDiagnostic> | null,
      achievement: 'advisory-only; never engine-verified',
      guidance: [] as string[],
      cleanup: 'not-created',
      internalCodexTools: 'not-isolated-or-fully-observable',
      retryBoundary: 'host-and-ai-sdk-only; ACP lazy-auth can retry internally',
      noFurtherGameplayScheduled: true,
      humanStopRequired: false,
    };
  }
}
