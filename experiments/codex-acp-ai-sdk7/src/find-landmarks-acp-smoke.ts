import { randomUUID } from 'node:crypto';
import { readFileSync, writeSync } from 'node:fs';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acpTools, ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME, createACPProvider } from '@mcpc-tech/acp-ai-provider';
import { ToolLoopAgent, isStepCount, jsonSchema, type ToolSet } from 'ai';
import { z } from 'zod';

const empty = z.strictObject({});
type SyntheticResult = { candidates: { noteId: string; marker: string; status: 'unverified' }[] };
type TextEnvelope = { content: { type: 'text'; text: string }[] };
export type CallbackReceipt = {
  ordinal: number;
  arguments: Record<string, never> | null;
  result: SyntheticResult | null;
  returnedEnvelope: TextEnvelope | null;
  error: string | null;
};

export const smokePrompt = `This is a synthetic bridge smoke test, not Doom navigation.
Call findLandmarks exactly once with {}. Then return only JSON:
{"status":"selected","noteId":"ID from the tool result","marker":"marker from the tool result"}.
If the result is unavailable, return {"status":"unavailable","reason":"short explanation"}.
Use only the tool result. Do not use files, shell, network, other tools or memory writes.`;

export function createSyntheticTool(receipts: CallbackReceipt[], abort: AbortController) {
  return {
    description: 'Return one synthetic, advisory landmark for a bridge smoke test.',
    inputSchema: empty,
    execute: async (input: unknown) => {
      const receipt: CallbackReceipt = { ordinal: receipts.length + 1, arguments: null, result: null, returnedEnvelope: null, error: null };
      receipts.push(receipt);
      try {
        if (receipt.ordinal !== 1) throw new Error('REPEATED_CALLBACK');
        abort.signal.throwIfAborted();
        receipt.arguments = empty.parse(input);
        // Neither identifier exists before the callback, including in the prompt.
        const result: SyntheticResult = {
          candidates: [{ noteId: randomUUID(), marker: randomUUID(), status: 'unverified' }],
        };
        receipt.result = structuredClone(result);
        const envelope: TextEnvelope = { content: [{ type: 'text', text: JSON.stringify(result) }] };
        receipt.returnedEnvelope = structuredClone(envelope);
        return envelope;
      } catch (error) {
        receipt.error = error instanceof z.ZodError ? 'INVALID_ARGUMENTS' : errorCode(error);
        abort.abort(new Error(receipt.error));
        throw new Error(receipt.error);
      }
    },
  };
}

type Registration = ReturnType<typeof acpTools<{ findLandmarks: ReturnType<typeof createSyntheticTool> }>>;

// Pinned 0.3.9 / SDK 7 bridge: preserve callback registration and generated metadata.
export function rebuildSmokeTools(registered: Registration) {
  const key = ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME;
  const dynamic = registered[key];
  const schema = dynamic.inputSchema;
  if (
    dynamic.type !== 'provider' || dynamic.id !== key ||
    typeof schema !== 'object' || schema === null || !('jsonSchema' in schema) ||
    schema.validate !== undefined
  ) throw new Error('UNEXPECTED_DYNAMIC_TOOL');
  const tools = {
    findLandmarks: registered.findLandmarks,
    [key]: {
      type: dynamic.type,
      id: dynamic.id,
      args: dynamic.args,
      inputSchema: jsonSchema<unknown>(schema.jsonSchema),
      isProviderExecuted: true,
    },
  } satisfies ToolSet;
  return tools;
}

const echo = z.strictObject({ status: z.literal('selected'), noteId: z.string(), marker: z.string() });
export function jsonParseOk(text: string) {
  try { JSON.parse(text); return true; } catch { return false; }
}

// Summary of actual SDK event.output, not a prediction of the MCP wire result.
export function summarizeToolResult(output: unknown, receipts: CallbackReceipt[]) {
  const nestedResult = typeof output === 'object' && output !== null && 'result' in output;
  const result = nestedResult ? output.result : output;
  const contentValue = typeof result === 'object' && result !== null && 'content' in result ? result.content : undefined;
  const contentPresent = Array.isArray(contentValue);
  const content: unknown[] = Array.isArray(contentValue) ? contentValue : [];
  const summary = {
    nestedResult, acpErrorPresent: nestedResult && 'error' in output && output.error != null,
    isError: typeof result === 'object' && result !== null && 'isError' in result && result.isError === true,
    contentPresent, contentBlocks: content.length, textBlocks: 0, truncated: content.length > 10,
    noteIdMatches: false, markerMatches: false, candidateMatches: false,
  };
  const expected = receipts.length === 1 && receipts[0].error === null ? receipts[0].result?.candidates[0] : undefined;
  for (const block of content.slice(0, 10)) {
    if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'text' || !('text' in block) || typeof block.text !== 'string') continue;
    summary.textBlocks++;
    if (block.text.length > 2048) { summary.truncated = true; continue; }
    try {
      const payload = z.object({ candidates: z.array(z.object({ noteId: z.string(), marker: z.string() })).max(3) }).safeParse(JSON.parse(block.text));
      if (payload.success && expected) for (const candidate of payload.data.candidates) {
        summary.noteIdMatches ||= candidate.noteId === expected.noteId;
        summary.markerMatches ||= candidate.marker === expected.marker;
        summary.candidateMatches ||= candidate.noteId === expected.noteId && candidate.marker === expected.marker;
      }
    } catch { /* Do not retain arbitrary text or provider errors. */ }
  }
  return summary;
}

export function matchesReceipt(text: string, receipts: CallbackReceipt[]) {
  if (text.length > 2048 || receipts.length !== 1) return false;
  try {
    const parsed = echo.safeParse(JSON.parse(text));
    const receipt = receipts[0];
    const candidate = receipt.result?.candidates[0];
    return parsed.success && receipt.arguments !== null && receipt.returnedEnvelope !== null && receipt.error === null && candidate !== undefined &&
      parsed.data.noteId === candidate.noteId && parsed.data.marker === candidate.marker;
  } catch { return false; }
}

function errorCode(error: unknown) {
  const known = ['REPEATED_CALLBACK', 'INVALID_ARGUMENTS', 'UNEXPECTED_DYNAMIC_TOOL', 'DEADLINE',
    'INTERRUPTED', 'SECOND_SDK_REQUEST', 'STREAM_ERROR', 'EVIDENCE_MISMATCH', 'OVERSIZED_OUTPUT', 'TOO_MANY_EVENTS',
    'VERSION_MISMATCH', 'NODE_VERSION_MISMATCH', 'DEBUG_MUST_BE_DISABLED'];
  return error instanceof Error && known.includes(error.message) ? error.message : 'ACP_OR_SDK_FAILURE';
}

function installedVersions() {
  const pins = {
    ai: '7.0.159', '@mcpc-tech/acp-ai-provider': '0.3.9',
    '@mcpc-tech/acp-ai-provider/node_modules/ai': '6.0.320',
    '@agentclientprotocol/codex-acp': '2.5.0', '@openai/codex': '0.165.0',
  };
  for (const [name, expected] of Object.entries(pins)) {
    const installed = JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'));
    if (installed.version !== expected) throw new Error('VERSION_MISMATCH');
  }
  const typescript = JSON.parse(readFileSync(new URL('../../../app/node_modules/typescript/package.json', import.meta.url), 'utf8')).version;
  if (typescript !== '7.0.2') throw new Error('VERSION_MISMATCH');
  if (process.versions.node !== '22.20.0') throw new Error('NODE_VERSION_MISMATCH');
  return { ...pins, typescript, node: process.version };
}

// Only smokeMain's exact authorization branch reaches this function.
async function runAuthorized() {
  const versions = installedVersions();
  if (process.env.DEBUG?.trim() || process.env.ACP_AI_PROVIDER_DEBUG?.trim()) throw new Error('DEBUG_MUST_BE_DISABLED');
  const abort = new AbortController();
  const receipts: CallbackReceipt[] = [];
  const report = {
    versions, outcome: 'failed', stage: 'setup', callbackReceipts: receipts, callbackCount: 0, sdkRequests: 0, sdkSteps: 0,
    acpSessionId: null as string | null, modelFinalJSON: null as string | null, echoMatches: false, jsonParseOk: false,
    finishReason: null as string | null, rawFinishReason: null as string | null,
    events: [] as { type: string; toolCallId: string; toolName: string; result?: ReturnType<typeof summarizeToolResult> }[],
    error: null as string | null, cleanup: 'not-created', cwdCleanup: 'not-created',
    limits: 'One SDK request, two SDK steps, 120s; internal ACP work/lazy-auth retry not bounded by SDK steps.',
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
      cwd = await mkdtemp(join(tmpdir(), 'doom-acp-tool-smoke-'));
      abort.signal.throwIfAborted();
      const registered = acpTools({ findLandmarks: createSyntheticTool(receipts, abort) });
      const tools = rebuildSmokeTools(registered);
      provider = createACPProvider({
        command: fileURLToPath(new URL('../node_modules/.bin/codex-acp', import.meta.url)),
        env: { INITIAL_AGENT_MODE: 'read-only', CODEX_CONFIG: JSON.stringify({ model: 'gpt-6-luna', model_reasoning_effort: 'xhigh' }) },
        session: { cwd, mcpServers: [] }, persistSession: true,
      });
      const model = provider.languageModel();
      // Use the original registration for SDK 6 session setup, before any prompt.
      report.stage = 'init-session';
      await provider.initSession(registered);
      abort.signal.throwIfAborted();
      report.acpSessionId = provider.getSessionId();
      const agent = new ToolLoopAgent({
        model, tools, maxRetries: 0, stopWhen: isStepCount(2),
        onLanguageModelCallStart() {
          if (++report.sdkRequests !== 1) throw new Error('SECOND_SDK_REQUEST');
        },
      });
      report.stage = 'stream';
      const result = await agent.stream({ prompt: smokePrompt, abortSignal: abort.signal });
      for await (const event of result.fullStream) {
        if (event.type === 'error') throw new Error('STREAM_ERROR');
        if (event.type === 'tool-call' || event.type === 'tool-result' || event.type === 'tool-error') {
          if (report.events.length >= 20) throw new Error('TOO_MANY_EVENTS');
          report.events.push({ type: event.type, toolCallId: event.toolCallId, toolName: event.toolName,
            ...(event.type === 'tool-result' ? { result: summarizeToolResult(event.output, receipts) } : {}),
          });
        }
      }
      const text = await result.text;
      if (text.length > 2048) throw new Error('OVERSIZED_OUTPUT');
      report.modelFinalJSON = text;
      report.jsonParseOk = jsonParseOk(text);
      report.stage = 'verify';
      report.sdkSteps = (await result.steps).length;
      report.finishReason = await result.finishReason;
      report.rawFinishReason = await result.rawFinishReason ?? null;
      report.echoMatches = matchesReceipt(text, receipts);
      if (!report.echoMatches || report.sdkRequests !== 1 || report.sdkSteps < 1 || report.sdkSteps > 2 ||
        report.finishReason !== 'stop' || report.rawFinishReason !== 'end_turn' ||
        !report.acpSessionId || provider.getSessionId() !== report.acpSessionId) throw new Error('EVIDENCE_MISMATCH');
      report.outcome = 'passed';
    };
    await Promise.race([work(), cancelled]);
  } catch (error) {
    report.error = errorCode(error);
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
  if (report.outcome === 'passed' && !matchesReceipt(report.modelFinalJSON ?? '', receipts)) report.outcome = 'failed';
  writeSync(1, `${JSON.stringify(report, null, 2)}\n`);
  return report.outcome === 'passed' ? 0 : 1;
}

export async function smokeMain(args: string[], launch: () => Promise<number> = runAuthorized, print = (text: string) => { writeSync(1, text); }) {
  if (args.length === 1 && args[0] === '--authorize-acp') return launch();
  print('No ACP started. After separate approval only: node --experimental-strip-types experiments/codex-acp-ai-sdk7/src/find-landmarks-acp-smoke.ts --authorize-acp\n');
  return args.length === 0 || (args.length === 1 && args[0] === '--help') ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code = 1;
  try { code = await smokeMain(process.argv.slice(2)); }
  catch (error) { writeSync(1, `${JSON.stringify({ outcome: 'failed', error: errorCode(error), cleanup: 'not-created' })}\n`); }
  // Match the standalone supervisor: public cleanup has no child-exit receipt.
  process.exit(code);
}
