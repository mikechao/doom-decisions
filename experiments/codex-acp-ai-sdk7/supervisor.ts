import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { agentCliError, runAgentCli } from '../../scripts/doom-agent.mjs';
import { maxAgentInstructions, type AgentRunState } from '../../app/src/agent-control.ts';
import { installedVersions } from './doom-observation-once.ts';
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
  record,
  requireLive,
  sameGame,
  type ReadPng,
} from './live-observation.ts';

type Generation = {
  text: string;
  finishReason: string;
  rawFinishReason?: string;
  steps: { toolCalls: readonly unknown[] }[];
  totalUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};
type ModelInput = { text: string; image: Uint8Array; signal: AbortSignal; onCallStart(): void };
export type SupervisorACP = {
  connect(): Promise<unknown>;
  initSession(): Promise<unknown>;
  getSessionId(): string | null;
  generate(input: ModelInput): Promise<Generation>;
  cleanup(): void;
};
export type SupervisorPorts = {
  cli(args: string[], signal: AbortSignal): Promise<unknown>;
  readPng: ReadPng;
  writeInstructions(text: string, signal: AbortSignal): Promise<string>;
  createACP(signal: AbortSignal): Promise<SupervisorACP>;
};
type Usage = 'unavailable' | { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
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
  };
  const evidence = object ? [object.visualEvidence, object.telemetryEvidence] : [];
  // Mirror only the delegated byte-limit measurement, never its acceptance.
  const delegatedBytes = object
    ? Buffer.byteLength(
        JSON.stringify({
          target: 'Reassess original objective',
          visualEvidence: object.visualEvidence,
          telemetryEvidence: object.telemetryEvidence,
          uncertainty: object.uncertainty,
          nextExperiment: 'No further gameplay authorized',
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
      ? (typeof object.uncertainty === 'string' && object.uncertainty.length > 800) ||
        evidence.some(
          (items) => Array.isArray(items) && items.some((item) => typeof item === 'string' && item.length > 400),
        )
      : null,
    evidenceCountOverLimit: object ? evidence.some((items) => Array.isArray(items) && items.length > 5) : null,
  };
}

export function composeGuidance(base: string, proposal: DoomProposal) {
  requireLive(base.includes('{{tics}}'));
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

function runMatches(run: AgentRunState | null, runId: string, exhausted = false) {
  requireLive(
    run &&
      run.runId === runId &&
      run.limit === 1 &&
      run.active === !exhausted &&
      run.reserved === Number(exhausted) &&
      run.sdkInvoked === Number(exhausted) &&
      run.remaining === Number(!exhausted),
  );
  return run;
}

// No real defaults: callers must supply every I/O port. The linear workflow has
// exactly one decide call site and no recovery/retry path.
export async function supervise(
  ports: SupervisorPorts,
  options: {
    signal?: AbortSignal;
    stageMs?: number;
    overallMs?: number;
  } = {},
) {
  const report = {
    outcome: 'failed' as 'completed' | 'failed' | 'uncertain' | 'stopped' | 'terminal',
    stage: 'initialization',
    errorCategory: null as string | null,
    transportError: null as string | null,
    startRunCalls: 0,
    decideCalls: 0,
    supervisorCalls: 0,
    providerCallStarts: 0,
    acpSessionStarts: 0,
    acpSessions: 0,
    sameACPSession: false,
    claim: 'not-attempted' as 'not-attempted' | 'unknown' | 'acknowledged',
    attachment: 'unknown' as 'unknown' | 'acknowledged',
    decisionDelivery: 'not-attempted' as 'not-attempted' | 'unknown' | 'validated-receipt',
    domainOutcome: null as string | null,
    decisionSdkInvoked: null as boolean | null,
    verifiedActions: 0,
    verifiedTics: null as number | null,
    cumulativeTics: null as number | null,
    completionUncertain: null as boolean | null,
    action: null as string | null,
    requestedTics: null as number | null,
    reportedTics: null as number | null,
    accounting: null as Omit<AgentRunState, 'runId'> | null,
    decisionsUsage: 'unavailable' as
      | 'unavailable'
      | { input: number | null; output: number | null; total: number | null },
    supervisorUsage: [] as Usage[],
    totalCost: 'unavailable',
    proposal: null as DoomProposal | null,
    reassessment: null as DoomReassessment | null,
    reassessmentDiagnostic: null as ReturnType<typeof reassessmentDiagnostic> | null,
    achievement: 'advisory-only; never engine-verified',
    guidance: 'not-applied',
    cleanup: 'not-created',
    internalCodexTools: 'not-isolated-or-fully-observable',
    retryBoundary: 'host-and-ai-sdk-only; ACP lazy-auth can retry internally',
    noFurtherGameplayScheduled: true,
    humanStopRequired: false,
  };
  const abort = new AbortController();
  const cancel = () => abort.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const until = Date.now() + (options.overallMs ?? 480_000);
  let acp: SupervisorACP | undefined;
  let attached = false;
  let finished = false;
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
          requireLive(report.decideCalls === 0);
          report.decideCalls++;
          report.decisionDelivery = 'unknown';
        }
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
  try {
    attached = true; // A lost attach response can still leave ownership behind.
    const lease = parseLease(await command(['attach']));
    report.attachment = 'acknowledged';
    const base = ['--lease', lease.leaseFile];
    const initialRaw = await command(['observe', ...base]);
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
    requireLive(
      before.run === null &&
        before.configuration.tics === 6 &&
        before.configuration.instructionTemplate.includes('{{tics}}'),
    );
    const configuration = before.configuration;
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
    acp = supervisor;
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
    async function checkpoint(text: string, image: Uint8Array) {
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
    report.proposal = safeAdvisory(
      validateDoomProposal(
        await checkpoint(
          `${instructions}\nChoose ONE observable navigation objective/question. Shape=${JSON.stringify(proposalShape)}\nSTATE=${JSON.stringify(initial.payload)}`,
          initial.image,
        ),
      ),
    );
    const guidance = composeGuidance(configuration.instructionTemplate, report.proposal);
    const file = await bounded('instructions-file', () => ports.writeInstructions(guidance, abort.signal));
    open();
    const started = configResult(
      await command([
        'start-run',
        ...base,
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
    runMatches(started.run, runId);
    report.claim = 'acknowledged';
    report.guidance = 'application-unknown';
    const changed = promptResult(
      await command([
        'set-prompt',
        ...base,
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
    runMatches(changed.run, runId);
    report.guidance = 'last-acknowledged; current-state-unverified';
    const freshRaw = await command(['observe', ...base]);
    const fresh = await bounded('fresh-observation', () => liveObserve(freshRaw, lease, ports.readPng, abort.signal));
    const ready = fresh.observation;
    sameGame(ready, before);
    requireLive(
      ready.revision === changed.revision &&
        same(ready.configuration, { ...configuration, instructionTemplate: guidance }) &&
        ready.observationId !== before.observationId &&
        ready.tic === before.tic &&
        same(ready.frame, before.frame) &&
        same(ready.telemetry, before.telemetry) &&
        same(ready.facingProbe, before.facingProbe) &&
        same(ready.previousAction, before.previousAction) &&
        ready.counters.leveltime === before.counters.leveltime,
    );
    runMatches(ready.run, runId);
    open();
    const decisionRaw = await command([
      'decide',
      ...base,
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
    report.decisionDelivery = 'validated-receipt';
    report.domainOutcome = receipt.outcome;
    report.decisionSdkInvoked = receipt.sdkInvoked;
    report.action = receipt.action;
    report.requestedTics = receipt.requestedTics;
    report.reportedTics = receipt.reportedTics;
    // A retired/uncertain result can still retain an independently verified
    // native prefix. Preserve it without calling the whole action completed.
    report.verifiedTics = receipt.verifiedTics;
    report.cumulativeTics = receipt.cumulativeTics;
    report.completionUncertain = receipt.completionUncertain;
    if (receipt.responseMetadata && Object.values(receipt.responseMetadata.usage).some((n) => n !== null))
      report.decisionsUsage = receipt.responseMetadata.usage;
    if (receipt.outcome !== 'completed' && receipt.outcome !== 'terminal')
      fail(receipt.outcome === 'stopped' ? 'AGENT_STOPPED' : 'DECISION_NOT_COMPLETED');
    requireLive(receipt.reason === null && receipt.requestedTics === 6 && receipt.verifiedTics !== null);
    if (receipt.outcome === 'terminal') fail('TERMINAL');
    report.verifiedActions = 1;
    const final = configResult(await command(['get-config', ...base, '--session', ready.sessionId]), lease);
    if ('error' in final) fail('ACCOUNTING_UNAVAILABLE');
    requireLive(
      final.sessionId === ready.sessionId &&
        final.revision === ready.revision &&
        same(final.configuration, ready.configuration),
    );
    const { runId: _runId, ...counts } = runMatches(final.run, runId, true);
    report.accounting = counts;
    report.guidance = 'lease-local-retained; exhausted run cannot restore through set-prompt';
    requireLive(after.image && after.payload);
    // Completion, cancellation, session and tool checks stay outside text validation.
    const reassessmentText: unknown = await checkpoint(
      `${instructions}\nReassess the ORIGINAL objective from the prior turn against the new POST-ACTION image. No more gameplay will occur.\nShape=${JSON.stringify(reassessmentShape)}\nORIGINAL_OBJECTIVE=${JSON.stringify(report.proposal)}\nBEFORE=${JSON.stringify(initial.payload)}\nAFTER=${JSON.stringify(after.payload)}`,
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
      report.reassessment = safeAdvisory(validated);
    } catch (error) {
      if (error instanceof HostFailure && error.message === 'UNSAFE_ADVISORY_TEXT')
        rejectReassessment('UNSAFE_ADVISORY_TEXT', true);
      throw error;
    }
    requireLive(acp.getSessionId() === acpSession);
    report.outcome = 'completed';
    report.stage = 'complete';
  } catch (error) {
    report.errorCategory = error instanceof HostFailure ? error.message : 'INVALID_EVIDENCE_OR_MODEL_RESULT';
    report.outcome =
      report.errorCategory === 'AGENT_STOPPED'
        ? 'stopped'
        : report.errorCategory === 'TERMINAL'
          ? 'terminal'
          : report.claim !== 'not-attempted' && !report.accounting
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
      if (report.outcome === 'completed' && report.cleanup !== 'returned-session-cleared; child-exit-unverified')
        report.outcome = 'uncertain';
    }
  }
  return report;
}

const help =
  'Offline by default. After separate human approval only: node --experimental-strip-types supervisor.ts --live --authorize-one-decision --trial NEW_ID 2>/dev/null\nRequires one visible prepared dev:agent page, AGENT_DECISION_BUDGET=1, and browser Stop Agent available.\n';

// Entry and optional runtime are separate from the injectable offline workflow.
// Existing historical markers/runners are never invoked.
export async function supervisorMain(
  args: string[],
  launch = runLive,
  print: (text: string) => void = (text) => {
    writeSync(1, text);
  },
) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    print(help);
    return 0;
  }
  if (
    args.length !== 4 ||
    args[0] !== '--live' ||
    args[1] !== '--authorize-one-decision' ||
    args[2] !== '--trial' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(args[3])
  ) {
    print(help);
    return 2;
  }
  return launch(args[3]);
}

async function runLive(trial: string) {
  const versions = installedVersions();
  // The provider can otherwise write raw transcript/debug artifacts on import.
  requireLive(!process.env.DEBUG?.trim() && !process.env.ACP_AI_PROVIDER_DEBUG?.trim());
  const local = new URL('.local/', import.meta.url);
  await mkdir(local, { recursive: true, mode: 0o700 });
  const root = fileURLToPath(new URL(`supervisor-${trial}/`, local));
  // Exclusive new namespace BEFORE attach/startup. Never removed or reused.
  await mkdir(root, { mode: 0o700 });
  await writeFile(join(root, 'started.json'), JSON.stringify({ startedAt: new Date().toISOString(), decisions: 1 }), {
    flag: 'wx',
    mode: 0o600,
  });
  const cwd = join(root, 'acp-cwd');
  await mkdir(cwd, { mode: 0o700 });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let promptFile: string | undefined;
  let leaseFile: string | undefined;
  let receiptNumber = 0;
  try {
    const report = await supervise(
      {
        async cli(args, signal) {
          const result = await runAgentCli(args, {
            temporaryRoot: root,
            transport: (url, init) =>
              fetch(url, { ...init, signal: AbortSignal.any([signal, init?.signal ?? signal]) }),
          });
          if (args[0] === 'attach') leaseFile = parseLease(result).leaseFile;
          // Private local receipts retain correlation/native evidence, excluding
          // full instructions. Neither these files nor their IDs enter ACP input.
          const { configuration, instructions: _instructions, ...evidence } = record(result);
          if (configuration) {
            const { instructionTemplate: _template, ...settings } = record(configuration);
            evidence.configuration = settings;
          }
          await writeFile(join(root, `receipt-${++receiptNumber}.json`), JSON.stringify(evidence), {
            signal,
            flag: 'wx',
            mode: 0o600,
          });
          return result;
        },
        readPng: (path, signal) => readFile(path, { signal }),
        async writeInstructions(text, signal) {
          requireLive(leaseFile);
          promptFile = join(dirname(leaseFile), 'supervisor-instructions.txt');
          await writeFile(promptFile, text, { signal, flag: 'wx', mode: 0o600 });
          return promptFile;
        },
        async createACP(signal) {
          const { createACPProvider } = await import('@mcpc-tech/acp-ai-provider');
          const { generateText } = await import('ai');
          signal.throwIfAborted();
          const provider = createACPProvider({
            command: fileURLToPath(new URL('node_modules/.bin/codex-acp', import.meta.url)),
            env: { INITIAL_AGENT_MODE: 'read-only' },
            session: { cwd, mcpServers: [] },
            persistSession: true,
          });
          const model = provider.languageModel();
          return {
            connect: () => provider.connect(),
            initSession: () => provider.initSession(),
            getSessionId: () => provider.getSessionId(),
            cleanup: () => provider.cleanup(),
            generate: ({ text, image, signal: turnSignal, onCallStart }) =>
              generateText({
                model,
                maxRetries: 0,
                abortSignal: turnSignal,
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text },
                      { type: 'image', image, mediaType: 'image/png' },
                    ],
                  },
                ],
                onLanguageModelCallStart: onCallStart,
              }),
          };
        },
      },
      { signal: abort.signal },
    );
    await writeFile(join(root, 'report.json'), `${JSON.stringify({ versions, ...report }, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    writeSync(1, `${JSON.stringify(report, null, 2)}\n`);
    if (report.humanStopRequired)
      writeSync(
        1,
        'Use the browser Stop Agent control now. Host exit does not revoke the lease or prove native/remote cancellation.\n',
      );
    return report.outcome === 'completed' ? 0 : 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    if (promptFile) await rm(promptFile, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code = 1;
  try {
    code = await supervisorMain(process.argv.slice(2));
  } catch {
    writeSync(
      1,
      'Supervisor setup/report failed; no retry. Check the local trial directory and use browser Stop Agent if attachment may have occurred.\n',
    );
  }
  // Public ACP cleanup has no exit receipt. Bound the standalone host's lifetime
  // without claiming that direct-child/descendant or remote processing stopped.
  process.exit(code);
}
