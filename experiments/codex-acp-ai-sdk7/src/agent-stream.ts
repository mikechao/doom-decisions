import { isDeepStrictEqual } from 'node:util';
import { ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME } from '@mcpc-tech/acp-ai-provider';

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
  };
  constructor(code: string, receipt: DoomStreamError['receipt']) {
    super(code);
    this.receipt = receipt;
  }
}

export async function consumeDoomStream(
  result: { fullStream: AsyncIterable<{ type: string; text?: string; output?: unknown;
    toolCallId?: string; toolName?: string; input?: unknown }> },
  signal: AbortSignal,
  matchesToolResult: (output: unknown) => boolean,
  expectedTool: 'consultLandmarks' | 'findLandmarks',
) {
  const receipt = { drained: false, events: 0, steps: 0, finishes: 0, toolCalls: 0, toolResults: 0, textCharacters: 0 };
  let callId: string | undefined;
  const fail = (code: string): never => { throw new DoomStreamError(code, { ...receipt }); };
  for await (const event of result.fullStream) {
    signal.throwIfAborted();
    if (++receipt.events > 2000) throw new Error('STREAM_LIMIT');
    if (['error', 'abort', 'tool-error'].includes(event.type)) throw new Error('STREAM_FAILURE');
    if (event.type === 'text-delta') {
      receipt.textCharacters += event.text?.length ?? 0;
      if (receipt.textCharacters > 8192) throw new Error('STREAM_LIMIT');
    }
    if (event.type === 'finish-step') receipt.steps++;
    if (event.type === 'finish') receipt.finishes++;
    if (event.type === 'tool-call') {
      if (++receipt.toolCalls !== 1) fail('DUPLICATE_TOOL_CALL');
      const input = event.input;
      // ACP exposes a dynamic descriptor; codex-acp's MCP title is serialized
      // inside its input. Correlate both that inner ID/name and the SDK ID/name.
      if (event.toolName !== ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME || !event.toolCallId ||
          typeof input !== 'object' || input === null || !('toolCallId' in input) ||
          input.toolCallId !== event.toolCallId || !('toolName' in input) ||
          (input.toolName !== expectedTool && input.toolName !== `mcp.acp-ai-sdk-tools.${expectedTool}`))
        fail('TOOL_CALL_MISMATCH');
      callId = event.toolCallId;
    }
    if (event.type === 'tool-result') {
      if (++receipt.toolResults !== 1) fail('DUPLICATE_TOOL_RESULT');
      if (!callId || event.toolCallId !== callId || event.toolName !== ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME)
        fail('TOOL_RESULT_MISMATCH');
      if (!matchesToolResult(event.output)) fail('TOOL_ENVELOPE_MISMATCH');
    }
  }
  signal.throwIfAborted();
  if (receipt.finishes !== 1 || receipt.steps < 1 || receipt.steps > 2 || receipt.toolCalls !== 1 || receipt.toolResults !== 1)
    fail('INCOMPLETE_STREAM');
  receipt.drained = true;
  return receipt;
}
