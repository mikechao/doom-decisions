import { readFileSync, writeSync } from 'node:fs';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acpTools, createACPProvider } from '@mcpc-tech/acp-ai-provider';
import { createLandmarksAgent } from './landmarks-tool-loop-agent.ts';
import { rebuildSmokeTools } from './find-landmarks-acp-smoke.ts';
import {
  createLandmarksTool, loadSavedContext, snapshotPath, summarizeLandmarkEvent, validateSelection, verifySnapshot,
  type LandmarkReceipt,
} from './landmarks-tool.ts';

function installedVersions() {
  const pins = {
    ai: '7.0.159', '@mcpc-tech/acp-ai-provider': '0.3.9',
    '@mcpc-tech/acp-ai-provider/node_modules/ai': '6.0.320',
    '@agentclientprotocol/codex-acp': '2.5.0', '@openai/codex': '0.165.0',
  };
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
    'SNAPSHOT_PATH_MISMATCH', 'SNAPSHOT_MISSING', 'SNAPSHOT_NOT_FILE', 'SNAPSHOT_INTEGRITY', 'SNAPSHOT_SCHEMA', 'UNEXPECTED_DYNAMIC_TOOL'];
  return error instanceof Error && known.includes(error.message) ? error.message : 'ACP_OR_LOOKUP_FAILURE';
}

// Inspect settled SDK output before acting on validation. Return no raw text or
// provider errors, even when JSON parsing or schema/evidence validation fails.
export async function inspectLandmarksCompletion(
  result: Awaited<ReturnType<ReturnType<typeof createLandmarksAgent>['stream']>>,
  receipts: LandmarkReceipt[],
) {
  const [text, steps, finish, rawFinish] = await Promise.allSettled([
    result.text, result.steps, result.finishReason, result.rawFinishReason,
  ]);
  const validation = text.status === 'fulfilled' ? validateSelection(text.value, receipts) : null;
  return {
    output: { nonempty: text.status === 'fulfilled' && text.value.trim().length > 0,
      characters: text.status === 'fulfilled' ? text.value.length : null },
    sdkSteps: steps.status === 'fulfilled' ? steps.value.length : 0,
    finishReason: finish.status === 'fulfilled' ? finish.value : null,
    // Raw provider reasons are arbitrary strings; retain only known safe enums.
    rawFinishReason: rawFinish.status === 'fulfilled' &&
      ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'].includes(rawFinish.value ?? '') ? rawFinish.value ?? null : null,
    metadataUnavailable: [text, steps, finish, rawFinish].flatMap((value, index) =>
      value.status === 'rejected' ? [['text', 'steps', 'finishReason', 'rawFinishReason'][index]] : []),
    validation,
    modelFinalJSON: validation?.ok ? JSON.stringify(validation.selection) : null,
    error: text.status === 'rejected' ? 'TEXT_UNAVAILABLE' : validation && !validation.ok ? validation.error :
      [steps, finish, rawFinish].some(value => value.status === 'rejected') ? 'SDK_METADATA_UNAVAILABLE' : null,
  };
}

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
  verifySnapshot(); // Fail before starting ACP if storage is absent/invalid/redirected.
  const context = loadSavedContext();
  const abort = new AbortController();
  const receipts: LandmarkReceipt[] = [];
  const report = {
    versions, snapshotPath, context, outcome: 'failed', stage: 'setup', callbackCount: 0,
    sdkRequests: 0, sdkSteps: 0, acpSessionId: null as string | null,
    output: { nonempty: false, characters: null as number | null }, metadataUnavailable: [] as string[],
    stream: { drained: false, finishEvents: 0, errorEvents: 0, abortEvents: 0, toolErrorEvents: 0 },
    modelFinalJSON: null as string | null, validation: null as ReturnType<typeof validateSelection> | null,
    finishReason: null as string | null, rawFinishReason: null as string | null,
    events: [] as { type: string; toolCallId: string; toolName: string; result?: ReturnType<typeof summarizeLandmarkEvent> }[],
    error: null as string | null, cleanup: 'not-created', cwdCleanup: 'not-created',
    limits: 'One SDK request, two SDK steps, one callback, 120s; internal ACP work/lazy-auth retry not bounded by SDK steps.',
  };
  let provider: ReturnType<typeof createACPProvider> | undefined;
  let cwd: string | undefined;
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
      cwd = await mkdtemp(join(tmpdir(), 'doom-landmarks-acp-'));
      abort.signal.throwIfAborted();
      const registered = acpTools({ findLandmarks: createLandmarksTool(context, receipts, abort) });
      const tools = rebuildSmokeTools(registered); // Same two-entry SDK 6/7 bridge, no assertions.
      provider = createACPProvider({
        command: fileURLToPath(new URL('../node_modules/.bin/codex-acp', import.meta.url)),
        env: { INITIAL_AGENT_MODE: 'read-only', CODEX_CONFIG: JSON.stringify({ model: 'gpt-6-luna', model_reasoning_effort: 'xhigh' }) },
        session: { cwd, mcpServers: [] }, persistSession: true,
      });
      const model = provider.languageModel();
      report.stage = 'init-session';
      await provider.initSession(registered); // Original SDK 6 callback registration before any prompt.
      abort.signal.throwIfAborted();
      report.acpSessionId = provider.getSessionId();
      const agent = createLandmarksAgent(model, tools, () => {
        if (++report.sdkRequests !== 1) throw new Error('SECOND_SDK_REQUEST');
      });
      report.stage = 'stream';
      const result = await agent.stream({ prompt: 'Retrieve and select one historical Doom landmark using findLandmarks.', abortSignal: abort.signal });
      for await (const event of result.fullStream) {
        if (event.type === 'error') { report.stream.errorEvents++; throw new Error('STREAM_ERROR'); }
        if (event.type === 'abort') { report.stream.abortEvents++; throw new Error('STREAM_ABORTED'); }
        if (event.type === 'finish-step') report.sdkSteps++;
        if (event.type === 'finish') report.stream.finishEvents++;
        if (event.type === 'tool-error') report.stream.toolErrorEvents++;
        if (event.type === 'tool-call' || event.type === 'tool-result' || event.type === 'tool-error') {
          if (report.events.length >= 20) throw new Error('TOO_MANY_EVENTS');
          report.events.push({ type: event.type, toolCallId: event.toolCallId, toolName: event.toolName,
            ...(event.type === 'tool-result' ? { result: summarizeLandmarkEvent(event.output, receipts) } : {}),
          });
        }
      }
      report.stream.drained = true;
      report.stage = 'verify';
      const completion = await inspectLandmarksCompletion(result, receipts);
      Object.assign(report, completion);
      if (completion.error) throw new Error(completion.error);
      if (!completion.validation?.ok) throw new Error('EVIDENCE_MISMATCH');
      if (report.sdkRequests !== 1 || report.sdkSteps < 1 || report.sdkSteps > 2 ||
        report.finishReason !== 'stop' || report.rawFinishReason !== 'end_turn' ||
        !report.acpSessionId || provider.getSessionId() !== report.acpSessionId) throw new Error('EVIDENCE_MISMATCH');
      report.outcome = completion.validation.selection.status === 'selected' ? 'passed' : 'empty';
    };
    await Promise.race([work(), cancelled]);
  } catch (error) {
    report.error = receipts.some(receipt => receipt.error !== null) ? 'CALLBACK_FAILURE' : errorCode(error);
  } finally {
    clearTimeout(timer);
    abort.signal.removeEventListener('abort', onAbort);
    abort.abort();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (provider) {
      try {
        report.acpSessionId ??= provider.getSessionId();
        provider.cleanup();
        report.cleanup = provider.getSessionId() === null ? 'returned-session-cleared; child-exit-unverified' : 'session-not-cleared';
      } catch { report.cleanup = 'failed; child-exit-unverified'; }
      if (report.cleanup !== 'returned-session-cleared; child-exit-unverified') report.outcome = 'failed';
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
  if (args.length === 1 && args[0] === '--authorize-acp') return launch();
  print('No ACP started. After separate approval only: node --experimental-strip-types experiments/codex-acp-ai-sdk7/src/landmarks-tool-loop-agent-smoke.ts --authorize-acp\n');
  return args.length === 0 || (args.length === 1 && args[0] === '--help') ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code = 1;
  try { code = await landmarksMain(process.argv.slice(2)); }
  catch (error) { writeSync(1, `${JSON.stringify({ outcome: 'failed', error: errorCode(error), cleanup: 'not-created' })}\n`); }
  process.exit(code); // Public cleanup supplies no child-exit receipt.
}
