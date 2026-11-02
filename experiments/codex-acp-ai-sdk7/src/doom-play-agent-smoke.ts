import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeSync } from 'node:fs';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { acpTools, createACPProvider } from '@mcpc-tech/acp-ai-provider';
import {
  consumeDoomStream, createConsultLandmarks, createDoomPlayAgent, DoomStreamError, envelopeMatches,
  rebuildParentTools, validateParentOutput, type ConsultReceipt,
} from './doom-play-agent.ts';
import { rebuildSmokeTools } from './find-landmarks-acp-smoke.ts';
import { createLandmarksAgent } from './landmarks-tool-loop-agent.ts';
import {
  createLandmarksTool, loadSavedContext, savedObservationPath, snapshotPath, verifySnapshot, type LandmarkReceipt,
} from './landmarks-tool.ts';

function versions() {
  const pins = { ai: '7.0.159', '@mcpc-tech/acp-ai-provider': '0.3.9',
    '@mcpc-tech/acp-ai-provider/node_modules/ai': '6.0.320',
    '@agentclientprotocol/codex-acp': '2.5.0', '@openai/codex': '0.165.0' };
  for (const [name, version] of Object.entries(pins))
    if (JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version !== version)
      throw new Error('VERSION_MISMATCH');
  if (process.versions.node !== '22.20.0') throw new Error('VERSION_MISMATCH');
  if (JSON.parse(readFileSync(new URL('../../../app/node_modules/typescript/package.json', import.meta.url), 'utf8')).version !== '7.0.2')
    throw new Error('VERSION_MISMATCH');
  return { ...pins, node: process.version, typescript: '7.0.2' };
}

// Byte reads only; this never opens SQLite. Paths are fixed, not archive-supplied.
function fixtureEvidence() {
  return [snapshotPath, savedObservationPath, join(dirname(savedObservationPath), 'observation.png')].map(path => {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error('INVALID_FIXTURE');
    const sidecarCount = readdirSync(dirname(path)).filter(name => name.startsWith(`${basename(path)}-`)).length;
    return { sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      bytes: stat.size, mtimeMs: stat.mtimeMs, sidecarCount };
  });
}

type DoomOwner = { cleanup(): void; getSessionId(): string | null };
type DoomInitialization = {
  owner: DoomOwner; pending: boolean; cleanupRequested: boolean;
  lateCleanup: string | null; settled: Promise<unknown>;
};

// Keep ownership of lazy-auth continuations even when cancellation wins the race.
// No wait is added to the 120s deadline. Pending startup is reported unverified;
// resolution AND rejection run one final cleanup after all provider retries settle.
export function fenceDoomInitialization(owner: DoomOwner, initialize: () => Promise<unknown>, signal: AbortSignal): DoomInitialization {
  const startup: DoomInitialization = { owner, pending: true, cleanupRequested: false, lateCleanup: null,
    settled: Promise.resolve() };
  startup.settled = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return initialize();
  }).finally(() => {
    startup.pending = false;
    if (startup.cleanupRequested) startup.lateCleanup = cleanupDoomProviders([owner])[0];
  }).then(value => { signal.throwIfAborted(); return value; });
  return startup;
}

// Initial shutdown stays in finally; only pending initialization needs a later pass.
export function cleanupDoomProviders(owners: DoomOwner[], startups: DoomInitialization[] = []) {
  return owners.map(owner => {
    const startup = startups.find(value => value.owner === owner);
    if (startup) startup.cleanupRequested = true;
    try {
      owner.cleanup();
      if (startup?.pending) return 'initialization-pending; cleanup-unverified; child-exit-unverified';
      return owner.getSessionId() === null ? 'returned-session-cleared; child-exit-unverified' : 'session-not-cleared';
    } catch { return 'cleanup-failed; child-exit-unverified'; }
  });
}

async function runAuthorized() {
  const installed = versions();
  if (process.env.DEBUG?.trim() || process.env.ACP_AI_PROVIDER_DEBUG?.trim()) throw new Error('DEBUG_MUST_BE_DISABLED');
  const before = fixtureEvidence();
  // A copied snapshot must be self-contained, avoiding WAL/SHM side effects.
  if (before.some(value => value.sidecarCount !== 0)) throw new Error('FIXTURE_SIDECARS');
  verifySnapshot();
  const context = loadSavedContext(); // Validates archived receipt and PNG hash, not fresh gameplay.
  const abort = new AbortController();
  const landmarks: LandmarkReceipt[] = [];
  const consults: ConsultReceipt[] = [];
  const providers: ReturnType<typeof createACPProvider>[] = [];
  const startups: DoomInitialization[] = [];
  const directories: string[] = [];
  const report = {
    versions: installed, outcome: 'failed', error: null as string | null,
    recordedContext: context, fixturesBefore: before, fixturesUnchanged: false,
    sessions: [] as string[], sessionsStableAndDistinct: false,
    sdkRequests: { parent: 0, child: 0 }, callbacks: { consult: 0, find: 0 },
    parentStream: null as Awaited<ReturnType<typeof consumeDoomStream>> | null,
    childStream: null as ConsultReceipt['childStream'],
    parentFinish: null as string | null, parentRawFinish: null as string | null,
    childCompletion: null as ConsultReceipt['completion'], consultError: null as string | null,
    result: null as ReturnType<typeof validateParentOutput> | null,
    cleanup: [] as string[], directoryCleanup: [] as string[],
    limits: 'Two independent ACP sessions; one SDK request and at most two SDK steps per agent; one callback each; 120s overall. SDK limits do not bound internal Codex processing or lazy-auth retries.',
    evidenceLimits: 'No PNG supplied to models; historical advisory data only. Session IDs and cleanup returns do not prove tool isolation, cancellation acknowledgment or subprocess exit.',
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interrupt = () => abort.abort(new Error('INTERRUPTED'));
  let onAbort = () => {};
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    // Allocate every owner before racing asynchronous ACP startup; no late provider creation.
    for (const role of ['parent', 'child']) {
      directories.push(await mkdtemp(join(tmpdir(), `doom-${role}-acp-`)));
      abort.signal.throwIfAborted();
      providers.push(createACPProvider({
        command: fileURLToPath(new URL('../node_modules/.bin/codex-acp', import.meta.url)),
        env: { INITIAL_AGENT_MODE: 'read-only', CODEX_CONFIG: JSON.stringify({ model: 'gpt-6-luna', model_reasoning_effort: 'xhigh' }) },
        session: { cwd: directories.at(-1)!, mcpServers: [] }, persistSession: true,
      }));
    }
    const [parentProvider, childProvider] = providers;
    const parentModel = parentProvider.languageModel();
    const childModel = childProvider.languageModel();
    if (parentModel === childModel) throw new Error('SHARED_MODEL');
    const childRegistered = acpTools({ findLandmarks: createLandmarksTool(context, landmarks, abort) });
    const child = createLandmarksAgent(childModel, rebuildSmokeTools(childRegistered), () => {
      abort.signal.throwIfAborted();
      if (++report.sdkRequests.child !== 1) throw new Error('REPEATED_SDK_REQUEST');
    });
    const parentRegistered = acpTools({ consultLandmarks: createConsultLandmarks(context, child, landmarks, consults, abort) });
    const parent = createDoomPlayAgent(parentModel, rebuildParentTools(parentRegistered), () => {
      abort.signal.throwIfAborted();
      if (++report.sdkRequests.parent !== 1) throw new Error('REPEATED_SDK_REQUEST');
    });
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('CANCELLED'));
      abort.signal.addEventListener('abort', onAbort, { once: true });
    });
    timer = setTimeout(() => abort.abort(new Error('DEADLINE')), 120_000);
    const work = async () => {
      abort.signal.throwIfAborted();
      const childStartup = fenceDoomInitialization(childProvider, () => childProvider.initSession(childRegistered), abort.signal);
      startups.push(childStartup);
      await childStartup.settled;
      abort.signal.throwIfAborted();
      const parentStartup = fenceDoomInitialization(parentProvider, () => parentProvider.initSession(parentRegistered), abort.signal);
      startups.push(parentStartup);
      await parentStartup.settled;
      abort.signal.throwIfAborted();
      const ids = providers.map(provider => provider.getSessionId());
      if (!ids[0] || !ids[1] || ids[0] === ids[1] ||
          !ids.every(id => id !== null && /^[a-zA-Z0-9._:-]{1,128}$/.test(id))) throw new Error('SESSION_MISMATCH');
      report.sessions = [ids[0], ids[1]];
      const stream = await parent.stream({
        prompt: `Propose one high-level navigation question using this host-validated ARCHIVED context. No image was supplied. Recorded context=${JSON.stringify(context)}`,
        abortSignal: abort.signal,
      });
      report.parentStream = await consumeDoomStream(stream, abort.signal,
        output => envelopeMatches(output, consults.length === 1 ? consults[0].envelope : null), 'consultLandmarks');
      const [text, steps, finish, rawFinish] = await Promise.all([
        stream.text, stream.steps, stream.finishReason, stream.rawFinishReason,
      ]);
      abort.signal.throwIfAborted();
      report.parentFinish = finish;
      report.parentRawFinish = rawFinish === 'end_turn' ? rawFinish : null;
      report.sessionsStableAndDistinct = providers.every((provider, index) => provider.getSessionId() === report.sessions[index]);
      if (finish !== 'stop' || rawFinish !== 'end_turn' || steps.length !== report.parentStream.steps ||
          !report.sessionsStableAndDistinct || report.sdkRequests.parent !== 1 || report.sdkRequests.child !== 1)
        throw new Error('COMPLETION_MISMATCH');
      report.result = validateParentOutput(text, consults, landmarks, abort.signal);
      report.outcome = report.result.historicalMemory ? 'passed' : consults[0].result?.selection.status === 'empty' ? 'empty' : 'completed-unattributed';
    };
    await Promise.race([work(), cancelled]);
  } catch (error) {
    // Never print arbitrary SDK errors, rejected model output, note text or credentials.
    if (error instanceof DoomStreamError) report.parentStream = error.receipt;
    report.error = error instanceof DoomStreamError ? error.message :
      abort.signal.aborted ? 'CANCELLED_OR_FAILED_CONSULT' : 'NESTED_SMOKE_FAILED';
    report.outcome = 'failed';
    report.result = null;
  } finally {
    clearTimeout(timer);
    abort.abort();
    abort.signal.removeEventListener('abort', onAbort);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    report.cleanup = cleanupDoomProviders(providers, startups);
    for (const directory of directories) {
      try { await rmdir(directory); report.directoryCleanup.push('empty-directory-removed'); }
      catch { report.directoryCleanup.push('not-removed'); }
    }
    try { report.fixturesUnchanged = isDeepStrictEqual(before, fixtureEvidence()); } catch { /* fail closed */ }
    if (!report.fixturesUnchanged || report.cleanup.some(value => value !== 'returned-session-cleared; child-exit-unverified') ||
        report.directoryCleanup.some(value => value !== 'empty-directory-removed')) {
      report.outcome = 'failed';
      report.error ??= 'CLOSEOUT_FAILED';
      report.result = null;
    }
    report.callbacks = { consult: consults.length, find: landmarks.length };
    report.childStream = consults[0]?.childStream ?? null;
    report.childCompletion = consults[0]?.completion ?? null;
    report.consultError = consults[0]?.error ?? null;
  }
  writeSync(1, `${JSON.stringify(report, null, 2)}\n`);
  return report.outcome === 'failed' ? 1 : 0;
}

// Future inference only, after separate authorization:
// node --experimental-strip-types experiments/codex-acp-ai-sdk7/src/doom-play-agent-smoke.ts --authorize-acp
export async function doomPlayMain(args: string[], launch: () => Promise<number> = runAuthorized, print = (text: string) => { writeSync(1, text); }) {
  if (args.length === 1 && args[0] === '--authorize-acp') return launch();
  print('No ACP started. After separate approval only: node --experimental-strip-types experiments/codex-acp-ai-sdk7/src/doom-play-agent-smoke.ts --authorize-acp\n');
  return args.length === 0 || (args.length === 1 && args[0] === '--help') ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code = 1;
  try { code = await doomPlayMain(process.argv.slice(2)); }
  catch { writeSync(1, '{"outcome":"failed","error":"PREFLIGHT_FAILED","cleanup":"not-created"}\n'); }
  process.exit(code); // Provider cleanup has no child-process exit receipt.
}
