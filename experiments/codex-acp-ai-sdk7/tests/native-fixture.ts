import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Only the pinned provider's dependency-free warning mapper. No model method,
// transport, RPC client or process is executed. Bound the extraction explicitly.
const providerSource = readFileSync(new URL('../node_modules/ai-sdk-provider-codex-cli/dist/index.js', import.meta.url), 'utf8');
const warningStart = providerSource.indexOf('function mapUnsupportedSettingsWarnings(');
const warningEnd = providerSource.indexOf('function mcpServersToConfigOverrides(', warningStart);
assert.ok(warningStart > 0 && warningEnd > warningStart && warningEnd - warningStart < 2000);
const warningMapper: (options: object) => { type: 'unsupported'; feature: string; details: string }[] =
  runInNewContext(`${providerSource.slice(warningStart, warningEnd)}\nmapUnsupportedSettingsWarnings`);

export const cliSettingsWarnings = (options: object) => structuredClone(warningMapper(options));

export function cliFixtureStream(options: object, parts: LanguageModelV4StreamPart[], raw = 'completed') {
  return fixtureStream([{ type: 'stream-start', warnings: cliSettingsWarnings(options) }, ...parts], raw);
}

export function fixtureStream(parts: LanguageModelV4StreamPart[], raw = 'completed') {
  return { stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) {
    for (const part of parts) controller.enqueue(part);
    controller.enqueue({ type: 'finish', finishReason: { unified: parts.some(part => part.type === 'tool-call') ? 'tool-calls' : 'stop', raw }, usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    } });
    controller.close();
  } }) };
}
export function textParts(text: string, chunkSize = Math.max(1, text.length)): LanguageModelV4StreamPart[] {
  const parts: LanguageModelV4StreamPart[] = [{ type: 'text-start', id: 'final' }];
  for (let offset = 0; offset < text.length; offset += chunkSize)
    parts.push({ type: 'text-delta', id: 'final', delta: text.slice(offset, offset + chunkSize) });
  parts.push({ type: 'text-end', id: 'final' });
  return parts;
}

export function lastToolResult(prompt: readonly { role: string; content: unknown }[], name: string): unknown {
  for (const message of [...prompt].reverse()) if (message.role === 'tool' && Array.isArray(message.content))
    for (const part of message.content) if (part.type === 'tool-result' && part.toolName === name) {
      if (part.output.type !== 'json') throw new Error('Expected ordinary JSON tool result');
      return part.output.value;
    }
  throw new Error('Missing SDK-forwarded result');
}
