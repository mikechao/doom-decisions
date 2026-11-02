import { mkdtempSync, readFileSync, rmdirSync, writeSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LanguageModel } from 'ai';
import { acpTools, createACPProvider } from '@mcpc-tech/acp-ai-provider';
import {
  executeAgentOperation, type AttachedLease, type MaterializedObserve,
} from '../../../scripts/doom-agent-client.ts';
import { cleanupDoomProviders, fenceDoomInitialization, type DoomInitialization } from './agent-lifecycle.ts';
import { consumeDoomStream, DoomStreamError, envelopeMatches } from './agent-stream.ts';
import {
  createConsultLandmarks, createDoomPlayAgent, rebuildParentTools, validateParentOutput, validateDecisionOutput, maxDecisionOutputCharacters, type ConsultReceipt,
} from './doom-play-agent.ts';
import { rebuildSmokeTools } from './find-landmarks-acp-smoke.ts';
import { createLandmarksAgent } from './landmarks-tool-loop-agent.ts';
import {
  createLandmarksTool, lookupLandmarks, type LandmarkReceipt, type SavedContext,
} from './landmarks-tool.ts';
import { createGuardedDecision, decisionLedger, type DecisionPorts } from './guarded-decision.ts';
import { liveObserve, parseLease, requireLive, type ReadPng } from './live-observation.ts';

type Provider = Pick<ReturnType<typeof createACPProvider>, 'cleanup' | 'getSessionId'> & {
  languageModel(): LanguageModel;
  initSession: (...args: Parameters<ReturnType<typeof createACPProvider>['initSession']>) => Promise<unknown>;
};

// Construction/import is inert. Mutating ports are wired only behind explicit authorization.
export type MainPorts = {
  attach(signal: AbortSignal): Promise<AttachedLease>;
  observe(leaseFile: string, signal: AbortSignal): Promise<MaterializedObserve>;
  readPng: ReadPng;
  createProvider(cwd: string): Provider;
  makeDirectory(): string;
  removeDirectory(path: string): void;
  lookup: typeof lookupLandmarks;
  decision?: DecisionPorts;
};

const operatorInstruction = 'Browser ownership is not released by ACP cleanup or process exit. Press Stop Agent in the browser before another attach, including after failed or uncertain attachment. Do not automatically retry.';

export async function runMain(ports: MainPorts, signal: AbortSignal, timeoutMs = 120_000, authorizeOneDecision = false) {
  const abort = new AbortController();
  const interrupt = () => abort.abort(signal.reason);
  signal.addEventListener('abort', interrupt, { once: true });
  if (signal.aborted) interrupt();
  const timer = setTimeout(() => abort.abort(new Error('DEADLINE')), timeoutMs);
  const providers: Provider[] = [];
  const startups: DoomInitialization[] = [];
  const directories: string[] = [];
  const landmarks: LandmarkReceipt[] = [];
  const consults: ConsultReceipt[] = [];
  let guardedDecision: ReturnType<typeof createGuardedDecision> | undefined;
  const report = {
    outcome: 'failed', error: null as string | null,
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
    evidenceLimits: 'Initial PNG input only; structured decision feedback is not a second agent-visible image. Offline tests do not prove live inference or model understanding. Public ACP cleanup does not prove child-process exit or complete tool isolation.',
  };
  let onAbort = () => {};
  try {
    abort.signal.throwIfAborted();
    // Allocate owners synchronously before racing work: no late provider/directory creation.
    for (let i = 0; i < 2; i++) {
      directories.push(ports.makeDirectory());
      providers.push(ports.createProvider(directories.at(-1)!));
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
      report.lease.state = 'possibly-held'; // Set before dispatch, including lost attach acknowledgments.
      const attached = await ports.attach(abort.signal);
      abort.signal.throwIfAborted();
      const lease = parseLease(attached);
      report.lease = { state: 'held', leaseFile: lease.leaseFile };
      const value = await ports.observe(lease.leaseFile, abort.signal);
      abort.signal.throwIfAborted();
      const { observation, image, payload } = await liveObserve(value, lease, ports.readPng, abort.signal);
      abort.signal.throwIfAborted();
      // The typed client correlates the request; the controller independently
      // allocates observationId for this capture. No pre-existing run is resumed.
      requireLive(observation.run === null);
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
        if (++report.sdkRequests[role] > (authorizeOneDecision && role === 'parent' ? 3 : 1)) throw new Error('REPEATED_SDK_REQUEST');
      };
      const childTools = acpTools({ findLandmarks: createLandmarksTool(context, landmarks, abort, undefined, ports.lookup) });
      const child = createLandmarksAgent(childModel, rebuildSmokeTools(childTools), count('child'));
      requireLive(!authorizeOneDecision || ports.decision);
      if (authorizeOneDecision && ports.decision)
        guardedDecision = createGuardedDecision(true, lease, observation, ports.decision, report.decision, abort.signal);
      const parentTools = acpTools({
        consultLandmarks: createConsultLandmarks(context, child, landmarks, consults, abort),
        ...(guardedDecision ? { executeGuardedDecision: guardedDecision } : {}),
      });
      const parent = createDoomPlayAgent(parentModel, rebuildParentTools(parentTools), count('parent'), 'live', authorizeOneDecision);
      for (const [owner, initialize] of [
        [childProvider, () => childProvider.initSession(childTools)],
        [parentProvider, () => parentProvider.initSession(parentTools)],
      ] as const) {
        abort.signal.throwIfAborted();
        const startup = fenceDoomInitialization(owner, initialize, abort.signal);
        startups.push(startup);
        await startup.settled;
        abort.signal.throwIfAborted();
      }
      const ids = providers.map(provider => provider.getSessionId());
      requireLive(ids[0] && ids[1] && ids[0] !== ids[1]);
      const stream = await parent.stream({
        messages: [{ role: 'user', content: [
          { type: 'text', text: `${authorizeOneDecision ? 'Request the single authorized guarded decision, then report its actual result in this same run.' : 'Propose one navigation question.'} Reason from this fresh verified observation and its attached PNG. Historical memory is advisory. State=${JSON.stringify(payload)}` },
          { type: 'file', data: image, mediaType: 'image/png' },
        ] }],
        abortSignal: abort.signal,
      });
      abort.signal.throwIfAborted();
      const consumed = await consumeDoomStream(stream, abort.signal,
        (output, name, ordinal) => envelopeMatches(output, name === 'executeGuardedDecision'
          ? report.decision.calls[ordinal]?.envelope ?? null : consults[ordinal]?.envelope ?? null),
        authorizeOneDecision ? ['consultLandmarks', 'executeGuardedDecision'] : 'consultLandmarks',
        authorizeOneDecision ? maxDecisionOutputCharacters : undefined,
        // Allow one event per text character plus the existing 2000-event
        // allowance for tool/lifecycle events and empty chunks; floods stay finite.
        authorizeOneDecision ? maxDecisionOutputCharacters + 2000 : undefined);
      report.parentStream = consumed;
      requireLive((consumed.tools.consultLandmarks?.calls ?? 0) === consults.length &&
        (consumed.tools.executeGuardedDecision?.calls ?? 0) === report.decision.attempted);
      const [text, steps, finish, rawFinish] = await Promise.all([
        stream.text, stream.steps, stream.finishReason, stream.rawFinishReason,
      ]);
      abort.signal.throwIfAborted();
      requireLive(finish === 'stop' && rawFinish === 'end_turn' && steps.length === consumed.steps &&
        providers.every((provider, index) => provider.getSessionId() === ids[index]) &&
        report.sdkRequests.parent >= 1 && report.sdkRequests.parent <= (authorizeOneDecision ? 3 : 1) &&
        report.sdkRequests.child === consults.length);
      const result = authorizeOneDecision
        ? validateDecisionOutput(text, report.decision, consults, landmarks, abort.signal)
        : validateParentOutput(text, consults, landmarks, abort.signal);
      report.result = result;
      report.receiptAwareSummary = authorizeOneDecision;
      report.outcome = authorizeOneDecision
        ? report.decision.receipt && report.decision.calls[0]?.feedback.error === null ? report.decision.receipt.outcome : 'failed'
        : consults[0].result?.selection.status === 'empty' ? 'empty' : 'completed';
    };
    await Promise.race([work(), cancelled]);
  } catch (error) {
    if (error instanceof DoomStreamError) report.parentStream = error.receipt;
    report.error = error instanceof DoomStreamError ? error.message : abort.signal.aborted ? 'CANCELLED_OR_FAILED_CONSULT' : 'MAIN_FAILED';
    report.result = null;
    report.outcome = 'failed';
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', interrupt);
    abort.abort();
    abort.signal.removeEventListener('abort', onAbort);
    await guardedDecision?.settleFileCleanup();
    report.cleanup = cleanupDoomProviders(providers, startups);
    for (const directory of directories) {
      try { ports.removeDirectory(directory); report.directoryCleanup.push('empty-directory-removed'); }
      catch { report.directoryCleanup.push('not-removed'); }
    }
    if (report.cleanup.some(value => value !== 'returned-session-cleared; child-exit-unverified') ||
        report.directoryCleanup.some(value => value !== 'empty-directory-removed')) {
      report.outcome = 'failed'; report.result = null; report.error ??= 'CLEANUP_UNVERIFIED';
    }
    if (report.decision.fileCleanup === 'failed') { report.outcome = 'failed'; report.error ??= 'INSTRUCTIONS_CLEANUP_FAILED'; }
    report.callbacks = { consult: consults.length, find: landmarks.length };
    report.childStream = consults[0]?.childStream ? { ...consults[0].childStream } : null;
  }
  return structuredClone(report); // Late settlements cannot rewrite returned evidence.
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
  for (const [name, expected] of Object.entries({ ai: '7.0.159', '@mcpc-tech/acp-ai-provider': '0.3.9',
    '@mcpc-tech/acp-ai-provider/node_modules/ai': '6.0.320', '@agentclientprotocol/codex-acp': '2.5.0',
    '@openai/codex': '0.165.0' })) {
    if (JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version !== expected)
      throw new Error('VERSION_MISMATCH');
  }
  if (JSON.parse(readFileSync(new URL('../../../app/node_modules/typescript/package.json', import.meta.url), 'utf8')).version !== '7.0.2')
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
      makeDirectory: () => mkdtempSync(join(tmpdir(), 'doom-main-acp-')),
      removeDirectory: rmdirSync,
      createProvider: cwd => createACPProvider({
        command: fileURLToPath(new URL('../node_modules/.bin/codex-acp', import.meta.url)),
        env: { INITIAL_AGENT_MODE: 'read-only', CODEX_CONFIG: JSON.stringify({ model: 'gpt-6-luna', model_reasoning_effort: 'xhigh' }) },
        session: { cwd, mcpServers: [] }, persistSession: true,
      }),
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
    writeSync(1, `${JSON.stringify(report, null, 2)}\n`);
    return reportExitCode(report, authorizeOneDecision);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

export async function main(args: string[], run: (authorizeOneDecision?: boolean) => Promise<number> = launch, print = (value: string) => { writeSync(1, value); }) {
  if (args.length === 1 && args[0] === '--authorize-live-observation-acp') return run(false);
  if (args.length === 2 && new Set(args).size === 2 && args.includes('--authorize-live-observation-acp') && args.includes('--authorize-agent-one-decision')) return run(true);
  print('Inert: no attach, SQLite open or ACP startup. After separate live authorization only:\nnode --experimental-strip-types experiments/codex-acp-ai-sdk7/src/main.ts --authorize-live-observation-acp\n' + 'One decision additionally requires --authorize-agent-one-decision and a restarted broker with AGENT_DECISION_BUDGET=1.\n' + operatorInstruction + '\n');
  return args.length === 0 || (args.length === 1 && args[0] === '--help') ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code = 1;
  try { code = await main(process.argv.slice(2)); }
  catch { writeSync(1, `${JSON.stringify({ outcome: 'failed', error: 'PREFLIGHT_FAILED', lease: 'unknown', operatorInstruction })}\n`); }
  process.exit(code); // Public ACP cleanup cannot prove subprocess exit; browser lease is retained.
}
