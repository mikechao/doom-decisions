import { readFileSync, writeSync } from 'node:fs';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCliProvider } from './cli-provider.ts';
import { closeCliProviders, fenceCliInitialization, type CliInitialization } from './agent-lifecycle.ts';
import { nativeTool, hostResultMatches, domainResultMatches, type HostCall } from './native-tools.ts';
import { consumeDoomStream, DoomStreamError } from './agent-stream.ts';
import { createLandmarksAgent } from './landmarks-tool-loop-agent.ts';
import {
  createLandmarksTool, loadSavedContext, snapshotPath, summarizeLandmarkEvent, validateSelection, verifySnapshot,
  type LandmarkReceipt,
} from './landmarks-tool.ts';

function installedVersions() {
  const pins = { ai: '7.0.159', 'ai-sdk-provider-codex-cli': '2.4.0', '@ai-sdk-tool/parser': '5.1.6', zod: '4.6.7' };
  for (const [name, expected] of Object.entries(pins)) {
    if (JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version !== expected)
      throw new Error('VERSION_MISMATCH');
  }
  const typescript = JSON.parse(readFileSync(new URL('../../../app/node_modules/typescript/package.json', import.meta.url), 'utf8')).version;
  if (typescript !== '7.0.2') throw new Error('VERSION_MISMATCH');
  if (process.versions.node !== '22.20.0') throw new Error('NODE_VERSION_MISMATCH');
  return { ...pins, typescript, node: process.version };
}

function errorCode(error: unknown) {
  const known = ['VERSION_MISMATCH', 'NODE_VERSION_MISMATCH', 'DEBUG_MUST_BE_DISABLED', 'DEADLINE', 'INTERRUPTED',
    'SECOND_SDK_REQUEST', 'STREAM_ERROR', 'TOO_MANY_EVENTS', 'OVERSIZED_OUTPUT', 'INVALID_JSON', 'INVALID_SELECTION',
    'CALLBACK_FAILURE', 'EVIDENCE_MISMATCH', 'STREAM_ABORTED', 'TEXT_UNAVAILABLE', 'SDK_METADATA_UNAVAILABLE', 'INVALID_SAVED_OBSERVATION', 'INVALID_SAVED_PNG',
    'SNAPSHOT_PATH_MISMATCH', 'SNAPSHOT_MISSING', 'SNAPSHOT_NOT_FILE', 'SNAPSHOT_INTEGRITY', 'SNAPSHOT_SCHEMA'];
  return error instanceof Error && known.includes(error.message) ? error.message : 'CLI_OR_LOOKUP_FAILURE';
}

// Inspect settled SDK output before acting on validation. Return no raw text or
// provider errors, even when JSON parsing or schema/evidence validation fails.
export { inspectLandmarksCompletion } from './landmarks-completion.ts';
import { inspectLandmarksCompletion } from './landmarks-completion.ts';

export function summarizeLandmarkReceipts(receipts: LandmarkReceipt[]) {
  return receipts.map(receipt => ({
    ordinal: receipt.ordinal, arguments: receipt.arguments, error: receipt.error,
    result: receipt.result ? {
      status: receipt.result.status, advisoryStatus: receipt.result.advisoryStatus,
      candidates: receipt.result.candidates.map(({ noteId, mapNamespace, status, revision }) => ({ noteId, mapNamespace, status, revision })),
    } : null,
    returnedEnvelope: receipt.returnedEnvelope ? { contentBlocks: receipt.returnedEnvelope.content.length,
      textCharacters: receipt.returnedEnvelope.content.reduce((sum, block) => sum + block.text.length, 0),
      matchesReceipt: summarizeLandmarkEvent(receipt.returnedEnvelope, [receipt]).envelopeMatches,
    } : null,
  }));
}

async function runAuthorized() {
  const versions = installedVersions();
  if (process.env.DEBUG?.trim() || process.env.ACP_AI_PROVIDER_DEBUG?.trim()) throw new Error('DEBUG_MUST_BE_DISABLED');
  verifySnapshot(); // Fail before starting CLI if storage is absent/invalid/redirected.
  const context = loadSavedContext();
  const abort = new AbortController();
  const receipts: LandmarkReceipt[] = [];
  const report = {
    versions, snapshotPath, context, outcome: 'failed', stage: 'setup', callbackCount: 0,
    sdkRequests: 0, sdkSteps: 0, statelessThreads: true,
    output: { nonempty: false, characters: null as number | null }, metadataUnavailable: [] as string[],
    stream: null as Awaited<ReturnType<typeof consumeDoomStream>> | null,
    modelFinalJSON: null as string | null, validation: null as ReturnType<typeof validateSelection> | null,
    finishReason: null as string | null, rawFinishReason: null as string | null,
    error: null as string | null, cleanup: 'not-created', cwdCleanup: 'not-created',
    limits: 'Two SDK requests/steps, one callback, 120s; internal Codex work not bounded by SDK steps.',
  };
  let provider: ReturnType<typeof createCliProvider> | undefined;
  let cwd: string | undefined;
  const startups: CliInitialization[] = [];
  const interrupt = () => abort.abort(new Error('INTERRUPTED'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const timer = setTimeout(() => abort.abort(new Error('DEADLINE')), 120_000);
  let onAbort = () => {};
  try {
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(abort.signal.reason);
      abort.signal.addEventListener('abort', onAbort, { once: true });
    });
    const work = async () => {
      cwd = await mkdtemp(join(tmpdir(), 'doom-landmarks-cli-'));
      abort.signal.throwIfAborted();
      const calls: HostCall[] = [];
      const tools = { findLandmarks: nativeTool('findLandmarks', createLandmarksTool(context, receipts, abort), calls, abort.signal) };
      provider = createCliProvider(cwd, abort);
      const model = provider.languageModel();
      report.stage = 'initialize';
      const startup = fenceCliInitialization(provider, abort.signal);
      startups.push(startup);
      await startup.settled;
      abort.signal.throwIfAborted();
      const agent = createLandmarksAgent(model, tools, () => {
        abort.signal.throwIfAborted();
        if (++report.sdkRequests > 2) throw new Error('SECOND_SDK_REQUEST');
      }, calls);
      report.stage = 'stream';
      const result = await agent.stream({ prompt: 'Retrieve and select one historical Doom landmark using findLandmarks.', abortSignal: abort.signal });
      const consumed = await consumeDoomStream(result, abort.signal,
        (output, name, ordinal, evidence) => hostResultMatches(calls, output, name, ordinal, evidence) && domainResultMatches(output, receipts[ordinal]?.returnedEnvelope ?? null), 'findLandmarks');
      report.stream = consumed;
      report.sdkSteps = consumed.steps;
      report.stage = 'verify';
      const completion = await inspectLandmarksCompletion(result, receipts);
      Object.assign(report, completion);
      if (completion.error) throw new Error(completion.error);
      if (!completion.validation?.ok) throw new Error('EVIDENCE_MISMATCH');
      if (report.sdkRequests !== 2 || report.sdkSteps < 1 || report.sdkSteps > 2 ||
        report.finishReason !== 'stop' || report.rawFinishReason !== 'completed') throw new Error('EVIDENCE_MISMATCH');
      provider.assertHealthy();
      report.outcome = completion.validation.selection.status === 'selected' ? 'passed' : 'empty';
    };
    await Promise.race([work(), cancelled]);
  } catch (error) {
    if (error instanceof DoomStreamError) report.stream = error.receipt;
    report.error = receipts.some(receipt => receipt.error !== null) ? 'CALLBACK_FAILURE' : errorCode(error);
  } finally {
    clearTimeout(timer);
    abort.signal.removeEventListener('abort', onAbort);
    abort.abort();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (provider) {
      report.cleanup = (await closeCliProviders([provider], startups))[0];
      if (!['close-returned; child-exit-unverified', 'close-returned; child-exit-observed'].includes(report.cleanup)) report.outcome = 'failed';
    }

    if (cwd) {
      try { await rmdir(cwd); report.cwdCleanup = 'empty-directory-removed'; }
      catch { report.cwdCleanup = 'not-removed'; report.outcome = 'failed'; }
    }
  }
  report.callbackCount = receipts.length;
  if (report.outcome === 'passed' && !validateSelection(report.modelFinalJSON ?? '', receipts).ok) report.outcome = 'failed';
  writeSync(1, `${JSON.stringify({ ...report, callbackReceipts: summarizeLandmarkReceipts(receipts) }, null, 2)}\n`);
  return report.outcome === 'passed' ? 0 : 1;
}

export async function landmarksMain(args: string[], launch: () => Promise<number> = runAuthorized, print = (text: string) => { writeSync(1, text); }) {
  if (args.length === 1 && args[0] === '--authorize-cli') return launch();
  print('No CLI inference started. After separate approval only: node --experimental-strip-types experiments/codex-acp-ai-sdk7/src/landmarks-tool-loop-agent-smoke.ts --authorize-cli\n');
  return args.length === 0 || (args.length === 1 && args[0] === '--help') ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code = 1;
  try { code = await landmarksMain(process.argv.slice(2)); }
  catch (error) { writeSync(1, `${JSON.stringify({ outcome: 'failed', error: errorCode(error), cleanup: 'not-created' })}\n`); }
  process.exit(code); // Public cleanup supplies no child-exit receipt.
}
