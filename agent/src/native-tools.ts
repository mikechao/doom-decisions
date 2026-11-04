import type { ToolTrace } from './tool-trace.ts';
import { isDeepStrictEqual } from 'node:util';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Envelope } from './agent-stream.ts';

type Projection = { type: 'content'; value: ({ type: 'text'; text: string } | { type: 'file'; mediaType: string; data: { type: 'data'; data: string } })[] } | { type: 'json'; value: import('@ai-sdk/provider').JSONValue };

export type HostCall = { toolCallId: string; toolName: string; input: unknown; output?: unknown; settled: boolean; modelOutput?: Projection };

// Presentation conversion only: schemas and execution belong to SDK 7. The
// domain callbacks retain their independent validation, ledgers and latches.
export function nativeTool<S extends z.ZodType>(name: string, callback: {
  description: string; inputSchema: S; execute(input: unknown): Promise<Envelope>;
  secondReady?(): boolean; project?(output: unknown): Projection;
}, calls: HostCall[], signal: AbortSignal, trace?: ToolTrace) {
  return tool({
    ...(callback.project ? { toModelOutput: ({ toolCallId, input, output }: { toolCallId: string; input: unknown; output: unknown }) => {
      const call = calls.find(call => call.toolCallId === toolCallId && call.toolName === name);
      if (!call?.settled || !isDeepStrictEqual(call.input, input) || !isDeepStrictEqual(call.output, output)) throw new Error('INVALID_HOST_PROJECTION');
      const projected = callback.project!(output);
      if (call.modelOutput && !isDeepStrictEqual(call.modelOutput, projected)) throw new Error('CHANGED_HOST_PROJECTION');
      call.modelOutput = structuredClone(projected);
      return projected;
    } } : {}),
    description: callback.description, inputSchema: callback.inputSchema,
    execute: async (input, options) => {
      trace?.native('native-attempt', options.toolCallId, name);
      signal.throwIfAborted();
      const call: HostCall = { toolCallId: options.toolCallId, toolName: name,
        input: structuredClone(input), settled: false };
      calls.push(call);
      // More than one call per inference step is forbidden, including parallel
      // consult/action calls. Only the fixed image-bearing decision predecessor
      // permits a second call of the same tool; it cannot authorize another tool.
      const invalid = calls.some(previous => {
        if (previous === call) return false;
        const forwarded = options.messages.some(message => message.role === 'tool' && message.content.some(part =>
          part.type === 'tool-result' && part.toolCallId === previous.toolCallId &&
          part.toolName === previous.toolName && (previous.modelOutput
            ? isDeepStrictEqual(part.output, previous.modelOutput)
            : part.output.type === 'json' && isDeepStrictEqual(part.output.value, previous.output))));
        return !previous.settled ||
          (previous.toolName === 'executeGuardedDecision' && previous.modelOutput?.type === 'content' && name !== previous.toolName) ||
          (previous.toolName === name && !(name === 'executeGuardedDecision' && callback.secondReady?.() &&
          calls.filter(call => call.toolName === name).length === 2 && previous.modelOutput?.type === 'content')) || previous.toolCallId === call.toolCallId || !forwarded;
      });
      if (invalid) {
        trace?.native('native-rejected', call.toolCallId, name, calls.at(-2)?.toolCallId);
        throw new Error('REPEATED_OR_OVERLAPPING_HOST_CALL');
      }
      trace?.native('native-admitted', call.toolCallId, name, calls.at(-2)?.toolCallId);
      trace?.native('callback-begin', call.toolCallId, name);
      let envelope: Envelope;
      try {
        envelope = await callback.execute(input);
        trace?.native(signal.aborted ? 'callback-cancelled' : 'callback-returned', call.toolCallId, name);
      } catch (error) {
        trace?.native(signal.aborted ? 'callback-cancelled' : 'callback-threw', call.toolCallId, name);
        throw error;
      }
      signal.throwIfAborted();
      if (envelope.content.length !== 1 || envelope.content[0].type !== 'text') throw new Error('INVALID_HOST_RESULT');
      const output: unknown = JSON.parse(envelope.content[0].text);
      call.output = structuredClone(output);
      call.settled = true;
      return output;
    },
  });
}

export function hostResultMatches(calls: HostCall[], output: unknown, name: string, ordinal: number,
  evidence: { toolCallId: string; input: unknown }) {
  const call = calls.filter(call => call.toolName === name)[ordinal];
  return !!call?.settled && call.toolCallId === evidence.toolCallId &&
    isDeepStrictEqual(call.input, evidence.input) && isDeepStrictEqual(call.output, output);
}

export function domainResultMatches(output: unknown, envelope: Envelope | null) {
  if (!envelope || envelope.content.length !== 1) return false;
  try { return isDeepStrictEqual(output, JSON.parse(envelope.content[0].text)); } catch { return false; }
}

export function assertNativeTools(tools: ToolSet, allowed: readonly string[]) {
  if (Object.entries(tools).some(([name, value]) => !allowed.includes(name) ||
      value.type === 'provider' || typeof value.execute !== 'function')) throw new Error('NON_NATIVE_TOOL');
}
