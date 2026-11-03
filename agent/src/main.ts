import { mkdtempSync, readFileSync, rmdirSync, writeSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCliProvider, cliFailureCode, type CliFailureCode, type CliProvider } from './cli-provider.ts';
import { nativeTool, hostResultMatches, domainResultMatches, type HostCall } from './native-tools.ts';
import {
  executeAgentOperation, type AttachedLease, type MaterializedObserve,
} from '../../scripts/doom-agent-client.ts';
import { closeCliProviders, fenceCliInitialization, type CliInitialization } from './agent-lifecycle.ts';
import { consumeDoomStream, DoomStreamError } from './agent-stream.ts';
import {
  createConsultLandmarks, createDoomPlayAgent, validateParentOutput, validateDecisionOutput, maxDecisionOutputCharacters, ParentOutputError, type ConsultReceipt,
} from './doom-play-agent.ts';
import { createLandmarksAgent } from './landmarks-tool-loop-agent.ts';
import {
  createLandmarksTool, lookupLandmarks, type LandmarkReceipt, type SavedContext,
} from './landmarks-tool.ts';
import { createGuardedDecision, decisionLedger, type DecisionPorts } from './guarded-decision.ts';
import { liveObserve, parseLease, requireLive, type ReadPng } from './live-observation.ts';
import { createOperatorConsole } from './operator-console.ts';

// Construction/import is inert. Mutating ports are wired only behind explicit authorization.
export type MainPorts = {
  attach(signal: AbortSignal): Promise<AttachedLease>;
  observe(leaseFile: string, signal: AbortSignal): Promise<MaterializedObserve>;
  readPng: ReadPng;
  createProvider(cwd: string, abort: AbortController): CliProvider;
  makeDirectory(): string;
  removeDirectory(path: string): void;
  lookup: typeof lookupLandmarks;
  decision?: DecisionPorts;
  logger?: ReturnType<typeof createOperatorConsole>;
};

const operatorInstruction = 'Browser ownership is not released by CLI provider cleanup or process exit. Press Stop Agent in the browser before another attach, including after failed or uncertain attachment. Do not automatically retry.';

type FailureDiagnostic = {
  stage: 'setup' | 'attach' | 'initial_observation' | 'provider_initialization' | 'parent_stream' |
    'callback_correlation' | 'completion_await' | 'completion_validation' | 'provider_invariants' |
    'final_validation' | ParentOutputError['stage'] | 'cleanup' | 'unknown';
  code: ParentOutputError['code'] | CliFailureCode | 'COMPLETION_METADATA_INVALID' | 'PROVIDER_INVARIANTS_INVALID' |
    'STREAM_REJECTED' | 'CANCELLED' | 'DEADLINE' | 'CLEANUP_UNVERIFIED' | 'INSTRUCTIONS_CLEANUP_FAILED' | 'unknown';
};

export async function runMain(ports: MainPorts, signal: AbortSignal, timeoutMs = 120_000, authorizeOneDecision = false) {
  const logger = ports.logger ?? createOperatorConsole();
  const doomLog = logger.withTag('doom'), agentLog = logger.withTag('agent');
  const cleanupLog = logger.withTag('cleanup'), runLog = logger.withTag('run');
  let stage: FailureDiagnostic['stage'] = 'setup';
  let failureCode: FailureDiagnostic['code'] = 'unknown';
  const abort = new AbortController();
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
  let guardedDecision: ReturnType<typeof createGuardedDecision> | undefined;
  const report = {
    outcome: 'failed', error: null as string | null,
    failureDiagnostic: null as FailureDiagnostic | null,
    lease: { state: 'not-attempted' as 'not-attempted' | 'possibly-held' | 'held', leaseFile: null as string | null },
    operatorInstruction,
    source: null as { observationId: string; sessionId: string; tic: number; mapKey: string; pngSha256: string; imageBytes: number } | null,
    sdkRequests: { parent: 0, child: 0 }, callbacks: { consult: 0, find: 0 },
    parentStream: null as Awaited<ReturnType<typeof consumeDoomStream>> | null,
    childStream: null as ConsultReceipt['childStream'],
    result: null as ReturnType<typeof validateParentOutput> | ReturnType<typeof validateDecisionOutput> | null,
    decision: decisionLedger(),
    receiptAwareSummary: false,
    cleanup: [] as string[], directoryCleanup: [] as string[],
    evidenceLimits: 'Initial PNG input only; structured decision feedback is not a second agent-visible image. Offline tests do not prove live inference or model understanding. Public CLI provider cleanup does not prove child-process exit or complete tool isolation.',
  };
  let onAbort = () => {};
  try {
    abort.signal.throwIfAborted();
    // Allocate owners synchronously before racing work: no late provider/directory creation.
    for (let i = 0; i < 2; i++) {
      directories.push(ports.makeDirectory());
      providers.push(ports.createProvider(directories.at(-1)!, abort));
    }
    const [parentProvider, childProvider] = providers;
    const parentModel = parentProvider.languageModel();
    const childModel = childProvider.languageModel();
    requireLive(parentProvider !== childProvider && parentModel !== childModel);
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
          x: observation.telemetry.x / 65536, y: observation.telemetry.y / 65536,
          headingDeg: observation.telemetry.angle * 360 / 4294967296, radius: 128, limit: 3 },
      };
      report.source = { observationId: context.observationId, sessionId: context.sessionId, tic: context.tic,
        mapKey: context.mapIdentity.mapKey, pngSha256: observation.pngSha256, imageBytes: image.length };
      const count = (role: 'parent' | 'child') => () => {
        abort.signal.throwIfAborted();
        if (++report.sdkRequests[role] > (authorizeOneDecision && role === 'parent' ? 3 : 2)) throw new Error('REPEATED_SDK_REQUEST');
        if (role === 'parent') agentLog.info('DoomPlayAgent request started (initial image supplied)');
      };
      const childCalls: HostCall[] = [], parentCalls: HostCall[] = [];
      const childTools = { findLandmarks: nativeTool('findLandmarks',
        createLandmarksTool(context, landmarks, abort, undefined, ports.lookup), childCalls, abort.signal) };
      const child = createLandmarksAgent(childModel, childTools, count('child'), childCalls);
      requireLive(!authorizeOneDecision || ports.decision);
      if (authorizeOneDecision && ports.decision)
        guardedDecision = createGuardedDecision(true, lease, observation, ports.decision, report.decision, abort.signal, logger.withTag('decision'));
      const parentTools = {
        consultLandmarks: nativeTool('consultLandmarks', createConsultLandmarks(context, child, landmarks, consults, abort, logger.withTag('landmarks')), parentCalls, abort.signal),
        ...(guardedDecision ? { executeGuardedDecision: nativeTool('executeGuardedDecision', guardedDecision, parentCalls, abort.signal) } : {}),
      };
      const parent = createDoomPlayAgent(parentModel, parentTools, count('parent'), 'live', authorizeOneDecision, parentCalls);
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
          { type: 'text', text: `${authorizeOneDecision ? 'Request the single authorized guarded decision, then report its actual result in this same run.' : 'Propose one navigation question.'} Reason from this fresh verified observation and its attached PNG. Historical memory is advisory. State=${JSON.stringify(payload)}` },
          { type: 'file', data: image, mediaType: 'image/png' },
        ] }],
        abortSignal: abort.signal,
      });
      abort.signal.throwIfAborted();
      const consumed = await consumeDoomStream(stream, abort.signal,
        (output, name, ordinal, evidence) => hostResultMatches(parentCalls, output, name, ordinal, evidence) && domainResultMatches(output, name === 'executeGuardedDecision'
          ? report.decision.calls[ordinal]?.envelope ?? null : consults[ordinal]?.envelope ?? null),
        authorizeOneDecision ? ['consultLandmarks', 'executeGuardedDecision'] : 'consultLandmarks',
        authorizeOneDecision ? maxDecisionOutputCharacters : undefined,
        // Allow one event per text character plus the existing 2000-event
        // allowance for tool/lifecycle events and empty chunks; floods stay finite.
        authorizeOneDecision ? maxDecisionOutputCharacters + 2000 : undefined);
      report.parentStream = consumed;
      stage = 'callback_correlation';
      requireLive((consumed.tools.consultLandmarks?.calls ?? 0) === consults.length &&
        (consumed.tools.executeGuardedDecision?.calls ?? 0) === report.decision.attempted);
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
        report.sdkRequests.parent === consumed.steps && report.sdkRequests.parent === 1 + consults.length + report.decision.attempted &&
        report.sdkRequests.child === 2 * consults.length)) {
        failureCode = 'PROVIDER_INVARIANTS_INVALID'; requireLive(false);
      }
      failureCode = 'unknown'; stage = 'final_validation';
      agentLog.info('Parent completion metadata and provider invariants verified; validating final JSON and grounding');
      const result = authorizeOneDecision
        ? validateDecisionOutput(text, report.decision, consults, landmarks, abort.signal)
        : validateParentOutput(text, consults, landmarks, abort.signal);
      report.result = result;
      report.receiptAwareSummary = authorizeOneDecision;
      agentLog.info('Parent final output accepted; schema and grounding verified');
      report.outcome = authorizeOneDecision
        ? report.decision.receipt && report.decision.calls[0]?.feedback.error === null ? report.decision.receipt.outcome : 'failed'
        : consults[0].result?.selection.status === 'empty' ? 'empty' : 'completed';
    };
    await Promise.race([work(), cancelled]);
  } catch (error) {
    if (error instanceof DoomStreamError) report.parentStream = error.receipt;
    const streamCode = error instanceof DoomStreamError && ['AFTER_FINISH', 'DUPLICATE_TOOL_CALL', 'TOOL_CALL_MISMATCH',
      'DUPLICATE_TOOL_RESULT', 'TOOL_RESULT_MISMATCH', 'TOOL_ENVELOPE_MISMATCH', 'INCOMPLETE_STREAM'].includes(error.message) ? error.message : null;
    const providerCode = cliFailureCode(abort.signal.reason);
    report.error = streamCode ?? providerCode ?? (abort.signal.aborted ? 'CANCELLED_OR_FAILED_CONSULT' : 'MAIN_FAILED');
    report.failureDiagnostic = error instanceof ParentOutputError ? { stage: error.stage, code: error.code } : {
      stage, code: providerCode ?? (abort.signal.aborted ? abort.signal.reason === deadline ? 'DEADLINE' : 'CANCELLED'
        : error instanceof DoomStreamError ? 'STREAM_REJECTED' : failureCode),
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
    if (report.decision.fileCleanup === 'failed') {
      report.outcome = 'failed'; report.error ??= 'INSTRUCTIONS_CLEANUP_FAILED';
      report.failureDiagnostic ??= { stage: 'cleanup', code: 'INSTRUCTIONS_CLEANUP_FAILED' };
      cleanupLog.warn('Instructions file cleanup failed');
    }
    report.callbacks = { consult: consults.length, find: landmarks.length };
    report.childStream = consults[0]?.childStream ? { ...consults[0].childStream } : null;
    cleanupLog.info('CLI close attempts finished; child exit evidence is reported per owner');
    if (report.lease.state !== 'not-attempted') cleanupLog.warn(operatorInstruction);
    runLog.info(`Final report ready: ${report.outcome}`);
  }
  return structuredClone(report); // Late settlements cannot rewrite returned evidence.
}

export function writeMainReport(report: Awaited<ReturnType<typeof runMain>>, print = (value: string) => { writeSync(1, value); }) {
  print(`${JSON.stringify(report, null, 2)}\n`);
}

export function reportExitCode(report: Awaited<ReturnType<typeof runMain>>, authorizeOneDecision: boolean) {
  if (report.error !== null || report.result === null) return 1;
  if (!authorizeOneDecision) return ['completed', 'empty'].includes(report.outcome) ? 0 : 1;
  const receipt = report.decision.receipt;
  return ['completed', 'terminal'].includes(report.outcome) &&
    report.receiptAwareSummary && report.decision.dispatch === 'validated-receipt' &&
    receipt?.outcome === report.outcome && receipt.completionUncertain === false ? 0 : 1;
}

async function launch(authorizeOneDecision = false) {
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
      observe: (leaseFile, signal) => executeAgentOperation({ op: 'observe', leaseFile }, options(signal)),
      readPng: (path, signal) => readFile(path, { signal }),
      makeDirectory: () => mkdtempSync(join(tmpdir(), 'doom-main-cli-')),
      removeDirectory: rmdirSync,
      createProvider: createCliProvider,
      lookup: lookupLandmarks,
      ...(authorizeOneDecision ? { decision: {
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
    }, abort.signal, 120_000, authorizeOneDecision);
    writeMainReport(report);
    return reportExitCode(report, authorizeOneDecision);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

export async function main(args: string[], run: (authorizeOneDecision?: boolean) => Promise<number> = launch, print = (value: string) => { writeSync(1, value); }) {
  if (args.length === 1 && args[0] === '--authorize-live-observation-cli') return run(false);
  if (args.length === 2 && new Set(args).size === 2 && args.includes('--authorize-live-observation-cli') && args.includes('--authorize-agent-one-decision')) return run(true);
  print('Inert: no attach, SQLite open or CLI startup. After separate live authorization only:\nnode --experimental-strip-types agent/src/main.ts --authorize-live-observation-cli\n' + 'One decision additionally requires --authorize-agent-one-decision and a restarted broker with AGENT_DECISION_BUDGET=1.\n' + operatorInstruction + '\n');
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
  process.exit(code); // Public CLI provider cleanup cannot prove subprocess exit; browser lease is retained.
}
