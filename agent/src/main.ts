import { ToolTrace } from './tool-trace.ts';
import { wrapLanguageModel } from 'ai';
import { mkdtempSync, readFileSync, rmdirSync, writeSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCliProvider, cliFailureCode, type CliFailureCode, type CliProvider } from './cli-provider.ts';
import { nativeTool, hostResultMatches, domainResultMatches, type HostCall } from './native-tools.ts';
import {
  executeAgentOperation, type AttachedLease, type DetachedLease, type MaterializedObserve,
} from '../../scripts/doom-agent-client.ts';
import { closeCliProviders, fenceCliInitialization, type CliInitialization } from './agent-lifecycle.ts';
import { consumeDoomStream, DoomStreamError, type DoomStreamCode } from './agent-stream.ts';
import {
  createConsultLandmarks, createDoomPlayAgent, validateParentOutput, validateDecisionOutput, validateTwoDecisionOutput, maxDecisionOutputCharacters, maxTwoDecisionOutputCharacters, ParentOutputError, type ConsultReceipt,
} from './doom-play-agent.ts';
import { createLandmarksAgent } from './landmarks-tool-loop-agent.ts';
import {
  createLandmarksTool, lookupLandmarks, type LandmarkReceipt, type SavedContext,
} from './landmarks-tool.ts';
import { createGuardedDecision, createTwoGuardedDecisions, decisionLedger, type DecisionPorts } from './guarded-decision.ts';
import { liveObserve, parseLease, requireLive, type ReadPng } from './live-observation.ts';
import { isAgentId } from '../../app/src/agent-observation.ts';
import { createOperatorConsole } from './operator-console.ts';

// Construction/import is inert. Mutating ports are wired only behind explicit authorization.
export type MainPorts = {
  attach(signal: AbortSignal): Promise<AttachedLease>;
  detach(leaseFile: string, signal: AbortSignal): Promise<DetachedLease>;
  observe(leaseFile: string, signal: AbortSignal): Promise<MaterializedObserve>;
  readPng: ReadPng;
  createProvider(cwd: string, abort: AbortController, trace?: ToolTrace): CliProvider;
  makeDirectory(): string;
  removeDirectory(path: string): void;
  lookup: typeof lookupLandmarks;
  decision?: DecisionPorts;
  logger?: ReturnType<typeof createOperatorConsole>;
};

const operatorInstruction = 'Press Stop Agent in the browser before another attach if detach is unverified or attachment is possibly held. Do not automatically retry. Refresh the page for another attach; fully restart dev:agent for another allowance. CLI provider cleanup and process exit do not release browser ownership.';
const releasedInstruction = 'Broker confirmed lease release; browser Stop and safe cleanup may still be pending. Refresh the page for another attach; fully restart dev:agent for another allowance. No automatic retry.';

type FailureDiagnostic = {
  stage: 'setup' | 'attach' | 'initial_observation' | 'provider_initialization' | 'parent_stream' |
    'callback_correlation' | 'completion_await' | 'completion_validation' | 'provider_invariants' |
    'final_validation' | ParentOutputError['stage'] | 'cleanup' | 'unknown';
  code: ParentOutputError['code'] | CliFailureCode | DoomStreamCode | 'COMPLETION_METADATA_INVALID' | 'PROVIDER_INVARIANTS_INVALID' |
    'CANCELLED' | 'DEADLINE' | 'CLEANUP_UNVERIFIED' | 'INSTRUCTIONS_CLEANUP_FAILED' | 'DETACH_UNVERIFIED' | 'unknown';
};

export async function runMain(ports: MainPorts, signal: AbortSignal, timeoutMs = 120_000, authorization: boolean | 2 = false, traceToolCalls = false) {
  const trace = traceToolCalls ? new ToolTrace() : undefined;
  const two = authorization === 2;
  const parentSteps = two ? 4 : authorization ? 3 : 2;
  const parentCharacters = two ? maxTwoDecisionOutputCharacters : authorization ? maxDecisionOutputCharacters : undefined;
  const logger = ports.logger ?? createOperatorConsole();
  const doomLog = logger.withTag('doom'), agentLog = logger.withTag('agent');
  const cleanupLog = logger.withTag('cleanup'), runLog = logger.withTag('run');
  let stage: FailureDiagnostic['stage'] = 'setup';
  let failureCode: FailureDiagnostic['code'] = 'unknown';
  const abort = new AbortController();
  const traceAbort = () => trace?.abort();
  abort.signal.addEventListener('abort', traceAbort, { once: true });
  const interrupt = () => abort.abort(signal.reason);
  signal.addEventListener('abort', interrupt, { once: true });
  if (signal.aborted) interrupt();
  const deadline = new Error('DEADLINE');
  const timer = setTimeout(() => abort.abort(deadline), timeoutMs);
  const providers: CliProvider[] = [];
  const startups: CliInitialization[] = [];
  const directories: string[] = [];
  const landmarks: LandmarkReceipt[] = [];
  const consults: ConsultReceipt[] = [];
  let guardedDecision: ReturnType<typeof createGuardedDecision> | ReturnType<typeof createTwoGuardedDecisions> | undefined;
  let acknowledgedLease: AttachedLease | undefined;
  const report = {
    outcome: 'failed', error: null as string | null,
    failureDiagnostic: null as FailureDiagnostic | null,
    toolTrace: null as ReturnType<ToolTrace['finish']> | null,
    lease: { state: 'not-attempted' as 'not-attempted' | 'possibly-held' | 'held', leaseFile: null as string | null },
    release: { status: 'not-attempted' as 'not-attempted' | 'broker-confirmed' | 'unverified' | 'unavailable',
      error: null as 'DETACH_TIMEOUT' | 'DETACH_FAILED' | null },
    operatorInstruction,
    source: null as { observationId: string; sessionId: string; tic: number; mapKey: string; pngSha256: string; imageBytes: number } | null,
    sdkRequests: { parent: 0, child: 0 }, callbacks: { consult: 0, find: 0 },
    parentStream: null as Awaited<ReturnType<typeof consumeDoomStream>> | null,
    childStream: null as ConsultReceipt['childStream'],
    result: null as ReturnType<typeof validateParentOutput> | ReturnType<typeof validateDecisionOutput> | ReturnType<typeof validateTwoDecisionOutput> | null,
    decision: decisionLedger(),
    secondDecision: decisionLedger(),
    receiptAwareSummary: false,
    cleanup: [] as string[], directoryCleanup: [] as string[],
    evidenceLimits: two ? 'The verified first resulting PNG and current state are projected as next-model input; offline conversion does not prove live model interpretation. Public CLI provider cleanup does not prove child-process exit or complete tool isolation.' : 'Initial PNG input only; structured decision feedback is not a second agent-visible image. Offline tests do not prove live inference or model understanding. Public CLI provider cleanup does not prove child-process exit or complete tool isolation.',
  };
  let onAbort = () => {};
  try {
    abort.signal.throwIfAborted();
    // Allocate owners synchronously before racing work: no late provider/directory creation.
    for (let i = 0; i < 2; i++) {
      directories.push(ports.makeDirectory());
      providers.push(ports.createProvider(directories.at(-1)!, abort, i === 0 ? trace : undefined));
    }
    const [parentProvider, childProvider] = providers;
    const parentBase = parentProvider.languageModel();
    const parentModel = trace ? wrapLanguageModel({ model: parentBase, middleware: trace.parsedMiddleware() }) : parentBase;
    const childModel = childProvider.languageModel();
    requireLive(parentProvider !== childProvider && parentBase !== childModel);
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('CANCELLED'));
      abort.signal.addEventListener('abort', onAbort, { once: true });
      if (abort.signal.aborted) onAbort();
    });
    const work = async () => {
      abort.signal.throwIfAborted();
      stage = 'attach';
      doomLog.info('Attaching to browser');
      report.lease.state = 'possibly-held'; // Set before dispatch, including lost attach acknowledgments.
      const attached = await ports.attach(abort.signal);
      abort.signal.throwIfAborted();
      const lease = parseLease(attached);
      acknowledgedLease = structuredClone(lease);
      report.lease = { state: 'held', leaseFile: lease.leaseFile };
      doomLog.info('Browser lease acknowledged');
      stage = 'initial_observation';
      const value = await ports.observe(lease.leaseFile, abort.signal);
      abort.signal.throwIfAborted();
      const { observation, image, payload } = await liveObserve(value, lease, ports.readPng, abort.signal);
      abort.signal.throwIfAborted();
      // The typed client correlates the request; the controller independently
      // allocates observationId for this capture. No pre-existing run is resumed.
      requireLive(observation.run === null);
      doomLog.info(`Initial observation verified: ${observation.mapIdentity.mapSlot}, tic ${observation.tic}`);
      const context: SavedContext = {
        observationId: observation.observationId, sessionId: observation.sessionId, tic: observation.tic,
        mapIdentity: structuredClone(observation.mapIdentity),
        query: { mode: 'nearby', mapNamespace: observation.mapIdentity.mapKey,
          x: observation.telemetry.x, y: observation.telemetry.y,
          angle: observation.telemetry.angle, radius: 8388608, limit: 3 },
      };
      report.source = { observationId: context.observationId, sessionId: context.sessionId, tic: context.tic,
        mapKey: context.mapIdentity.mapKey, pngSha256: observation.pngSha256, imageBytes: image.length };
      const count = (role: 'parent' | 'child') => () => {
        abort.signal.throwIfAborted();
        if (++report.sdkRequests[role] > (role === 'parent' ? parentSteps : 2)) throw new Error('REPEATED_SDK_REQUEST');
        if (role === 'parent') agentLog.info(two ? 'DoomPlayAgent request started (verified image input)' : 'DoomPlayAgent request started (initial image supplied)');
      };
      const childCalls: HostCall[] = [], parentCalls: HostCall[] = [];
      const childTools = { findLandmarks: nativeTool('findLandmarks',
        createLandmarksTool(context, landmarks, abort, undefined, ports.lookup), childCalls, abort.signal) };
      const child = createLandmarksAgent(childModel, childTools, count('child'), childCalls);
      requireLive(!authorization || ports.decision);
      if (authorization && ports.decision)
        guardedDecision = two
          ? createTwoGuardedDecisions(lease, observation, ports.decision, report.decision, report.secondDecision, abort.signal, logger.withTag('decision'))
          : createGuardedDecision(true, lease, observation, ports.decision, report.decision, abort.signal, logger.withTag('decision'));
      const parentTools = {
        consultLandmarks: nativeTool('consultLandmarks', createConsultLandmarks(context, child, landmarks, consults, abort, logger.withTag('landmarks')), parentCalls, abort.signal, trace),
        ...(guardedDecision ? { executeGuardedDecision: nativeTool('executeGuardedDecision', guardedDecision, parentCalls, abort.signal, trace) } : {}),
      };
      const parent = createDoomPlayAgent(parentModel, parentTools, count('parent'), 'live', authorization, parentCalls, () => !!guardedDecision && 'secondReady' in guardedDecision && guardedDecision.secondReady(), trace);
      stage = 'provider_initialization';
      agentLog.info('Initializing separate parent and landmark CLI provider owners (stateless threads)');
      for (const owner of [childProvider, parentProvider]) {
        abort.signal.throwIfAborted();
        const startup = fenceCliInitialization(owner, abort.signal);
        startups.push(startup);
        await startup.settled;
        abort.signal.throwIfAborted();
      }
      stage = 'parent_stream';
      const stream = await parent.stream({
        messages: [{ role: 'user', content: [
          { type: 'text', text: `${two ? 'Request exactly two sequential guarded decisions, using the first verified resulting PNG and current state before decision 2. Report ordered actual results.' : authorization ? 'Request the single authorized guarded decision, then report its actual result in this same run.' : 'Propose one navigation question.'} Reason from this fresh verified observation and its attached PNG. Historical memory is advisory. State=${JSON.stringify(payload)}` },
          { type: 'file', data: image, mediaType: 'image/png' },
        ] }],
        abortSignal: abort.signal,
      });
      abort.signal.throwIfAborted();
      const consumed = await consumeDoomStream(stream, abort.signal,
        (output, name, ordinal, evidence) => hostResultMatches(parentCalls, output, name, ordinal, evidence) && domainResultMatches(output, name === 'executeGuardedDecision'
          ? (ordinal === 0 ? report.decision : report.secondDecision).calls[0]?.envelope ?? null : consults[ordinal]?.envelope ?? null),
        authorization ? ['consultLandmarks', 'executeGuardedDecision'] : 'consultLandmarks',
        parentCharacters,
        // Allow one event per text character plus the existing 2000-event
        // allowance for tool/lifecycle events and empty chunks; floods stay finite.
        parentCharacters === undefined ? undefined : parentCharacters + 2000,
        parentSteps, trace);
      report.parentStream = consumed;
      stage = 'callback_correlation';
      requireLive((consumed.tools.consultLandmarks?.calls ?? 0) === consults.length &&
        (consumed.tools.executeGuardedDecision?.calls ?? 0) === report.decision.attempted + report.secondDecision.attempted);
      agentLog.info('Parent stream drained; tool calls/results and callback counts matched');
      stage = 'completion_await';
      agentLog.info('Awaiting parent completion metadata and final output');
      const [text, steps, finish, rawFinish] = await Promise.all([
        stream.text, stream.steps, stream.finishReason, stream.rawFinishReason,
      ]);
      abort.signal.throwIfAborted();
      stage = 'completion_validation';
      if (!(finish === 'stop' && rawFinish === 'completed' && steps.length === consumed.steps)) {
        failureCode = 'COMPLETION_METADATA_INVALID'; requireLive(false);
      }
      stage = 'provider_invariants';
      if (!(providers.every(provider => { provider.assertHealthy(); return true; }) &&
        report.sdkRequests.parent === consumed.steps && report.sdkRequests.parent === 1 + consults.length + report.decision.attempted + report.secondDecision.attempted &&
        report.sdkRequests.child === 2 * consults.length)) {
        failureCode = 'PROVIDER_INVARIANTS_INVALID'; requireLive(false);
      }
      failureCode = 'unknown'; stage = 'final_validation';
      agentLog.info('Parent completion metadata and provider invariants verified; validating final JSON and grounding');
      const result = two
        ? validateTwoDecisionOutput(text, report.decision, report.secondDecision, consults, landmarks, abort.signal)
        : authorization
        ? validateDecisionOutput(text, report.decision, consults, landmarks, abort.signal)
        : validateParentOutput(text, consults, landmarks, abort.signal);
      report.result = result;
      report.receiptAwareSummary = !!authorization;
      agentLog.info('Parent final output accepted; schema and grounding verified');
      const last = two && report.secondDecision.attempted ? report.secondDecision : report.decision;
      report.outcome = authorization
        ? last.receipt && last.calls[0]?.feedback.error === null ? last.receipt.outcome : 'failed'
        : consults[0].result?.selection.status === 'empty' ? 'empty' : 'completed';
    };
    await Promise.race([work(), cancelled]);
  } catch (error) {
    if (error instanceof DoomStreamError) report.parentStream = error.receipt;
    const streamCode = error instanceof DoomStreamError && ['AFTER_FINISH', 'DUPLICATE_TOOL_CALL', 'TOOL_CALL_MISMATCH',
      'DUPLICATE_TOOL_RESULT', 'TOOL_RESULT_MISMATCH', 'TOOL_ENVELOPE_MISMATCH', 'INCOMPLETE_STREAM'].includes(error.code) ? error.code : null;
    const providerCode = cliFailureCode(abort.signal.reason) ?? cliFailureCode(error);
    const failedStage = stage as FailureDiagnostic['stage']; // Updated inside the raced work closure.
    report.error = streamCode ?? providerCode ?? (abort.signal.aborted ? 'CANCELLED_OR_FAILED_CONSULT' : 'MAIN_FAILED');
    report.failureDiagnostic = error instanceof ParentOutputError ? { stage: error.stage, code: error.code } : {
      stage: failedStage, code: providerCode ?? (abort.signal.aborted ? abort.signal.reason === deadline ? 'DEADLINE' : 'CANCELLED'
        : error instanceof DoomStreamError ? error.code : failedStage === 'parent_stream' ? 'STREAM_FAILURE' : failureCode),
    };
    runLog.warn(`Run failed: ${report.error}; stage=${report.failureDiagnostic.stage}, code=${report.failureDiagnostic.code}`);
    report.result = null;
    report.outcome = 'failed';
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', interrupt);
    abort.abort();
    abort.signal.removeEventListener('abort', onAbort);
    cleanupLog.info('Cleanup started');
    if (acknowledgedLease) {
      const lease = acknowledgedLease;
      const cleanup = new AbortController();
      let detachTimer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        const timeout = new Promise<never>((_, reject) => {
          detachTimer = setTimeout(() => {
            timedOut = true;
            cleanup.abort();
            reject(new Error('DETACH_TIMEOUT'));
          }, 5000);
        });
        // Race the entire port, including file/body reads. Even ignored aborts
        // cannot hold finalization; late settlements never write report fields.
        const released = await Promise.race([
          Promise.resolve().then(() => ports.detach(lease.leaseFile, cleanup.signal)), timeout,
        ]);
        requireLive(Object.keys(released).sort().join(',') === 'commandId,epoch,ownerId,pageId,released' &&
          isAgentId(released.commandId) && released.pageId === lease.pageId && released.ownerId === lease.ownerId &&
          released.epoch === lease.epoch && released.released === true);
        report.release.status = 'broker-confirmed';
        report.operatorInstruction = releasedInstruction;
        cleanupLog.info(releasedInstruction);
      } catch {
        report.release = { status: 'unverified', error: timedOut ? 'DETACH_TIMEOUT' : 'DETACH_FAILED' };
        report.outcome = 'failed'; report.error ??= 'DETACH_UNVERIFIED';
        report.failureDiagnostic ??= { stage: 'cleanup', code: 'DETACH_UNVERIFIED' };
        cleanupLog.warn('Broker lease release unverified');
      } finally {
        clearTimeout(detachTimer);
        cleanup.abort();
      }
    } else if (report.lease.state === 'possibly-held') {
      report.release.status = 'unavailable';
    }
    await guardedDecision?.settleFileCleanup();
    report.cleanup = await closeCliProviders(providers, startups);
    for (const directory of directories) {
      try { ports.removeDirectory(directory); report.directoryCleanup.push('empty-directory-removed'); }
      catch { report.directoryCleanup.push('not-removed'); }
    }
    if (report.cleanup.some(value => !['close-returned; child-exit-unverified', 'close-returned; child-exit-observed'].includes(value)) ||
        report.directoryCleanup.some(value => value !== 'empty-directory-removed')) {
      report.outcome = 'failed'; report.result = null; report.error ??= 'CLEANUP_UNVERIFIED';
      report.failureDiagnostic ??= { stage: 'cleanup', code: 'CLEANUP_UNVERIFIED' };
      cleanupLog.warn('CLI provider or temporary-directory cleanup unverified');
    }
    if ([report.decision, report.secondDecision].some(slot => slot.fileCleanup === 'failed')) {
      report.outcome = 'failed'; report.error ??= 'INSTRUCTIONS_CLEANUP_FAILED';
      report.failureDiagnostic ??= { stage: 'cleanup', code: 'INSTRUCTIONS_CLEANUP_FAILED' };
      cleanupLog.warn('Instructions file cleanup failed');
    }
    report.callbacks = { consult: consults.length, find: landmarks.length };
    report.childStream = consults[0]?.childStream ? { ...consults[0].childStream } : null;
    cleanupLog.info('CLI close attempts finished; child exit evidence is reported per owner');
    if (report.lease.state !== 'not-attempted' && report.release.status !== 'broker-confirmed') cleanupLog.warn(operatorInstruction);
    runLog.info(`Final report ready: ${report.outcome}`);
  }
  report.toolTrace = trace?.finish() ?? null;
  abort.signal.removeEventListener('abort', traceAbort);
  return structuredClone(report); // Late settlements cannot rewrite returned evidence.
}

export function writeMainReport(report: Awaited<ReturnType<typeof runMain>>, print = (value: string) => { writeSync(1, value); }) {
  print(`${JSON.stringify(report, null, 2)}\n`);
}

export function reportExitCode(report: Awaited<ReturnType<typeof runMain>>, authorization: boolean | 2) {
  if (report.error !== null || report.result === null || report.release.status !== 'broker-confirmed') return 1;
  if (!authorization) return ['completed', 'empty'].includes(report.outcome) ? 0 : 1;
  const slot = authorization === 2 ? report.secondDecision : report.decision;
  if (authorization === 2 && (report.decision.receipt?.outcome !== 'completed' || report.decision.accounting !== 'remaining')) return 1;
  const receipt = slot.receipt;
  return ['completed', 'terminal'].includes(report.outcome) &&
    report.receiptAwareSummary && slot.dispatch === 'validated-receipt' &&
    receipt?.outcome === report.outcome && receipt.completionUncertain === false ? 0 : 1;
}

async function launch(authorization: boolean | 2 = false, traceToolCalls = false) {
  for (const [name, expected] of Object.entries({ ai: '7.0.159', 'ai-sdk-provider-codex-cli': '2.4.0',
    '@ai-sdk-tool/parser': '5.1.6', zod: '4.6.7' })) {
    if (JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version !== expected)
      throw new Error('VERSION_MISMATCH');
  }
  if (JSON.parse(readFileSync(new URL('../../app/node_modules/typescript/package.json', import.meta.url), 'utf8')).version !== '7.0.2')
    throw new Error('VERSION_MISMATCH');
  if (process.versions.node !== '22.20.0' || process.env.DEBUG?.trim() || process.env.ACP_AI_PROVIDER_DEBUG?.trim())
    throw new Error('PREFLIGHT_FAILED');
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const options = (signal: AbortSignal) => ({
      transport: (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        fetch(url, { ...init, signal: AbortSignal.any([signal, init?.signal ?? signal]) }),
    });
    const report = await runMain({
      attach: signal => executeAgentOperation({ op: 'attach' }, options(signal)),
      detach: (leaseFile, signal) => executeAgentOperation({ op: 'detach', leaseFile }, options(signal)),
      observe: (leaseFile, signal) => executeAgentOperation({ op: 'observe', leaseFile }, options(signal)),
      readPng: (path, signal) => readFile(path, { signal }),
      makeDirectory: () => mkdtempSync(join(tmpdir(), 'doom-main-cli-')),
      removeDirectory: rmdirSync,
      createProvider: createCliProvider,
      lookup: lookupLandmarks,
      ...(authorization ? { decision: {
        startRun: (input, signal) => executeAgentOperation({ op: 'start-run', ...input }, options(signal)),
        setPrompt: (input, signal) => executeAgentOperation({ op: 'set-prompt', ...input }, options(signal)),
        observe: (leaseFile, signal) => executeAgentOperation({ op: 'observe', leaseFile }, options(signal)),
        decide: (input, signal) => executeAgentOperation({ op: 'decide', ...input }, options(signal)),
        getConfig: (input, signal) => executeAgentOperation({ op: 'get-config', ...input }, options(signal)),
        readPng: (path, signal) => readFile(path, { signal }),
        instructions: text => {
          const directory = mkdtempSync(join(tmpdir(), 'doom-guarded-instructions-'));
          const path = join(directory, 'instructions.txt');
          try { writeFileSync(path, text, { mode: 0o600, flag: 'wx' }); }
          catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
          return { path, remove: () => rmSync(directory, { recursive: true, force: true }) };
        },
      } satisfies DecisionPorts } : {}),
    }, abort.signal, 120_000, authorization, traceToolCalls);
    writeMainReport(report);
    return reportExitCode(report, authorization);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

export async function main(args: string[], run: (authorization?: boolean | 2, traceToolCalls?: boolean) => Promise<number> = launch, print = (value: string) => { writeSync(1, value); }) {
  if (args.includes('--trace-tool-calls') && args.filter(arg => arg === '--trace-tool-calls').length === 1)
    return main(args.filter(arg => arg !== '--trace-tool-calls'), authorization => run(authorization, true), print);
  if (args.length === 1 && args[0] === '--authorize-live-observation-cli') return run(false);
  if (args.length === 2 && new Set(args).size === 2 && args.includes('--authorize-live-observation-cli') && args.includes('--authorize-agent-one-decision')) return run(true);
  if (args.length === 2 && new Set(args).size === 2 && args.includes('--authorize-live-observation-cli') && args.includes('--authorize-agent-two-decisions')) return run(2);
  print('Inert: no attach, SQLite open or CLI startup. Optional --trace-tool-calls adds bounded parent diagnostics (no payloads) to toolTrace.\nAfter separate live authorization only:\nnode --experimental-strip-types agent/src/main.ts --authorize-live-observation-cli\n' + 'Two decisions require --authorize-agent-two-decisions (mutually exclusive with one-decision) and a restarted broker with AGENT_DECISION_BUDGET=2.\nOne decision additionally requires --authorize-agent-one-decision and a restarted broker with AGENT_DECISION_BUDGET=1.\n' + operatorInstruction + '\n');
  return args.length === 0 || (args.length === 1 && args[0] === '--help') ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code = 1;
  try { code = await main(process.argv.slice(2)); }
  catch {
    createOperatorConsole().withTag('run').warn('Preflight/launch failed; no automatic retry');
    writeSync(1, `${JSON.stringify({ outcome: 'failed', error: 'PREFLIGHT_FAILED', failureDiagnostic: { stage: 'setup', code: 'unknown' }, lease: 'unknown', operatorInstruction })}\n`);
  }
  await new Promise<void>(resolve => process.stderr.write('', () => resolve()));
  process.exit(code); // Provider cleanup cannot prove subprocess exit; release evidence is reported separately.
}
