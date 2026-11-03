import { isDeepStrictEqual } from 'node:util';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Envelope } from './agent-stream.ts';

export type HostCall = { toolCallId: string; toolName: string; input: unknown; output?: unknown; settled: boolean };

// Presentation conversion only: schemas and execution belong to SDK 7. The
// domain callbacks retain their independent validation, ledgers and latches.
export function nativeTool<S extends z.ZodType>(name: string, callback: {
  description: string; inputSchema: S; execute(input: unknown): Promise<Envelope>;
}, calls: HostCall[], signal: AbortSignal) {
  return tool({
    description: callback.description, inputSchema: callback.inputSchema,
    execute: async (input, options) => {
      signal.throwIfAborted();
      const call: HostCall = { toolCallId: options.toolCallId, toolName: name,
        input: structuredClone(input), settled: false };
      calls.push(call);
      // More than one call per inference step is forbidden, including parallel
      // consult/action calls. A failed callback never permits another step.
      const invalid = calls.some(previous => {
        if (previous === call) return false;
        const forwarded = options.messages.some(message => message.role === 'tool' && message.content.some(part =>
          part.type === 'tool-result' && part.toolCallId === previous.toolCallId &&
          part.toolName === previous.toolName && part.output.type === 'json' && isDeepStrictEqual(part.output.value, previous.output)));
        return !previous.settled || previous.toolName === name || previous.toolCallId === call.toolCallId || !forwarded;
      });
      if (invalid)
        throw new Error('REPEATED_OR_OVERLAPPING_HOST_CALL');
      const envelope = await callback.execute(input);
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
