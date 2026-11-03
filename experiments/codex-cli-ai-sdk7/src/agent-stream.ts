import { isDeepStrictEqual } from 'node:util';

export type Envelope = { content: { type: 'text'; text: string }[] };

export function envelopeMatches(output: unknown, expected: Envelope | null) {
  if (!expected || typeof output !== 'object' || output === null) return false;
  if ('error' in output && output.error != null) return false;
  const value = 'result' in output ? output.result : output;
  return typeof value === 'object' && value !== null &&
    !('isError' in value && value.isError === true) && 'content' in value &&
    isDeepStrictEqual(value.content, expected.content);
}

// Consume the entire SDK stream, including terminal events; never retain a transcript.
export class DoomStreamError extends Error {
  readonly receipt: {
    drained: boolean; events: number; steps: number; finishes: number;
    toolCalls: number; toolResults: number; textCharacters: number;
    tools: Record<string, { calls: number; results: number }>;
  };
  constructor(code: string, receipt: DoomStreamError['receipt']) {
    super(code);
    this.receipt = receipt;
  }
}

export async function consumeDoomStream(
  result: { fullStream: AsyncIterable<{ type: string; text?: string; output?: unknown;
    toolCallId?: string; toolName?: string; input?: unknown; providerExecuted?: boolean }> },
  signal: AbortSignal,
  matchesToolResult: (output: unknown, name: string, ordinal: number, evidence: { toolCallId: string; input: unknown }) => boolean,
  expectedTool: 'consultLandmarks' | 'findLandmarks' | readonly string[],
  maxTextCharacters = 8192,
  maxEvents = 2000,
) {
  const tools: Record<string, { calls: number; results: number }> = {};
  const receipt = { drained: false, events: 0, steps: 0, finishes: 0, toolCalls: 0, toolResults: 0, textCharacters: 0, tools };
  const multiple = Array.isArray(expectedTool);
  const allowed: readonly string[] = typeof expectedTool === 'string' ? [expectedTool] : expectedTool;
  const calls = new Map<string, { name: string; ordinal: number; input: unknown; done: boolean }>();
  const ordinals = new Map<string, number>();
  const fail = (code: string): never => { throw new DoomStreamError(code, structuredClone(receipt)); };
  for await (const event of result.fullStream) {
    signal.throwIfAborted();
    if (receipt.finishes !== 0) fail('AFTER_FINISH');
    if (++receipt.events > maxEvents) throw new Error('STREAM_LIMIT');
    if (['error', 'abort', 'tool-error'].includes(event.type)) throw new Error('STREAM_FAILURE');
    if (event.type === 'text-delta') {
      receipt.textCharacters += event.text?.length ?? 0;
      if (receipt.textCharacters > maxTextCharacters) throw new Error('STREAM_LIMIT');
    }
    if (event.type === 'finish-step') receipt.steps++;
    if (event.type === 'finish') receipt.finishes++;
    if (event.type === 'tool-call') {
      receipt.toolCalls++;
      if ((!multiple && receipt.toolCalls !== 1) || receipt.toolCalls > 3 || (event.toolCallId && calls.has(event.toolCallId))) fail('DUPLICATE_TOOL_CALL');
      const name = event.toolName;
      if (!name || !allowed.includes(name) || !event.toolCallId || event.providerExecuted === true)
        return fail('TOOL_CALL_MISMATCH');
      receipt.tools[name] ??= { calls: 0, results: 0 };
      receipt.tools[name].calls++;
      const ordinal = ordinals.get(name) ?? 0;
      ordinals.set(name, ordinal + 1);
      calls.set(event.toolCallId, { name, ordinal, input: structuredClone(event.input), done: false });
    }
    if (event.type === 'tool-result') {
      receipt.toolResults++;
      const call = event.toolCallId ? calls.get(event.toolCallId) : undefined;
      if (call?.done) fail('DUPLICATE_TOOL_RESULT');
      if (!call || event.toolName !== call.name || event.providerExecuted === true)
        return fail('TOOL_RESULT_MISMATCH');
      if (!matchesToolResult(event.output, call.name, call.ordinal, { toolCallId: event.toolCallId!, input: call.input })) fail('TOOL_ENVELOPE_MISMATCH');
      call.done = true;
      receipt.tools[call.name].results++;
    }
  }
  signal.throwIfAborted();
  if (receipt.finishes !== 1 || receipt.steps < 1 || receipt.steps > (multiple ? 3 : 2) || receipt.toolCalls < 1 || receipt.toolCalls !== receipt.toolResults || [...calls.values()].some(call => !call.done))
    fail('INCOMPLETE_STREAM');
  receipt.drained = true;
  return receipt;
}
