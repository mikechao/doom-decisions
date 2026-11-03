import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { ToolLoopAgent, isStepCount, wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { hermesToolMiddleware } from '@ai-sdk-tool/parser';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';
import { decisionGuidance } from '../src/guarded-decision.ts';
import { consumeDoomStream, type Envelope } from '../src/agent-stream.ts';
import { nativeTool, hostResultMatches, domainResultMatches, type HostCall } from '../src/native-tools.ts';
import { cliSafetyMiddleware, cliFailureCode, rejectCliWarning } from '../src/cli-provider.ts';
import { fixtureStream, cliSettingsWarnings, textParts } from './native-fixture.ts';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Complete synthetic 1x1 RGBA PNGs, including chunk CRCs. No game assets/decoder.
function png(red: number) {
  const chunk = (name: string, bytes: Buffer) => {
    const data = Buffer.concat([Buffer.from(name), bytes]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 8);
    result.writeUInt32BE(bytes.length); data.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, red, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

test('post-decision PNG survives installed SDK → Hermes → CLI pure input conversion', async t => {
  for (const [name, version] of Object.entries({ ai: '7.0.159', '@ai-sdk-tool/parser': '5.1.6',
    'ai-sdk-provider-codex-cli': '2.4.0' })) {
    assert.equal(JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version, version);
  }
  const a = png(0), b = png(255), aHash = hash(a), bHash = hash(b);
  assert.notDeepEqual(a, b); assert.notEqual(aHash, bHash);
  t.diagnostic(`A: ${a.length} bytes, SHA-256 ${aHash}; B: ${b.length} bytes, SHA-256 ${bHash}`);

  for (const unsupported of [false, true]) await t.test(unsupported ? 'unsupported image reference is omitted and warning-fenced' : 'canonical image/png delivers A then exact B', async t => {
    const abort = new AbortController();
    // Only these installed pure methods are used. Never initialize, list models,
    // call the actual provider's doStream/doGenerate, or start an App Server.
    const provider = createCodexAppServer({ defaultSettings: { threadMode: 'stateless', logger: {
      debug() {}, info() {}, error() {}, warn: message => rejectCliWarning(abort, message),
    } } });
    const cli = provider('synthetic-no-inference');
    assert.ok('preparePrompt' in cli && typeof cli.preparePrompt === 'function');
    assert.ok('buildUserInput' in cli && typeof cli.buildUserInput === 'function');
    const preparePrompt = cli.preparePrompt.bind(cli), buildUserInput = cli.buildUserInput.bind(cli);
    const calls: HostCall[] = [];
    const guidance = { objective: 'Inspect the resulting synthetic frame.', uncertainty: 'Synthetic transport proof only.' };
    // Synthetic callback evidence, not a claim that Doom receipt checks ran.
    const feedback = { status: 'receipt', receipt: { outcome: 'completed', action: 'turn_right',
      requestedTics: 6, reportedTics: 6, verifiedTics: 6, cumulativeTics: 7, completionUncertain: false },
      state: { tic: 7, phase: 'ready', telemetry: { health: 100, angle: 123 } } };
    const envelope: Envelope = { content: [{ type: 'text', text: JSON.stringify(feedback) }] };
    let executed = 0, projected = 0, requests = 0, correlated = 0;
    const callback = nativeTool('executeGuardedDecision', {
      description: 'Return one synthetic completed receipt; no gameplay or API calls.', inputSchema: decisionGuidance,
      execute: async input => { assert.deepEqual(input, guidance); assert.equal(++executed, 1); return envelope; },
    }, calls, abort.signal);
    const tools = { executeGuardedDecision: { ...callback,
      toModelOutput: ({ toolCallId, input, output }: { toolCallId: string; input: unknown; output: unknown }) => {
        projected++;
        assert.equal(toolCallId, calls[0]?.toolCallId);
        assert.deepEqual(input, guidance); assert.deepEqual(output, feedback);
        return { type: 'content' as const, value: [
          { type: 'text' as const, text: JSON.stringify(output) },
          { type: 'file' as const, mediaType: 'image/png', data: unsupported
            ? { type: 'reference' as const, reference: { synthetic: 'post-decision-B' } }
            : { type: 'data' as const, data: b.toString('base64') } },
        ] };
      },
    } };
    // The fake endpoint supplies deterministic response text only. Both request
    // projections below are the installed CLI provider's own implementation.
    const endpoint = new MockLanguageModelV4({ doStream: async params => {
      const step = requests++;
      assert.ok(step < 2); assert.equal(params.tools, undefined);
      assert.deepEqual(cliSettingsWarnings(params), []);
      assert.ok(!params.prompt.some(message => message.role === 'tool'), 'Real Hermes must project tool results into user content');
      const mapped = preparePrompt(params.prompt, false);
      const built = await buildUserInput(mapped.promptText, mapped.images);
      t.after(async () => { for (const path of built.tempImagePaths) await rm(dirname(path), { recursive: true, force: true }); });
      const images = built.input.filter((part: { type: string }) => part.type === 'localImage');
      assert.deepEqual(images.map((part: { path: string }) => part.path), built.tempImagePaths);
      assert.deepEqual(built.input.map((part: { type: string }) => part.type),
        ['text', ...Array(step === 1 && !unsupported ? 2 : 1).fill('localImage')]);
      const bytes = await Promise.all(images.map((part: { path: string }) => readFile(part.path)));
      if (step === 0) {
        assert.equal(executed, 0); assert.equal(projected, 0);
        assert.deepEqual(bytes, [a]); assert.deepEqual(mapped.warnings, []);
      } else {
        assert.equal(executed, 1); assert.ok(projected >= 1);
        const response = params.prompt.findLast(message => message.role === 'user');
        assert.ok(response && Array.isArray(response.content));
        assert.deepEqual(response.content.map(part => part.type), ['text', 'file']);
        const text = response.content[0]; assert.equal(text.type, 'text');
        const match = text.text.match(/^<tool_response>(.*)<\/tool_response>$/s); assert.ok(match);
        assert.deepEqual(JSON.parse(match[1]), { name: 'executeGuardedDecision', content: JSON.stringify(feedback) });
        assert.ok(mapped.promptText.indexOf('Initial synthetic frame A at tic 1') < mapped.promptText.indexOf('<tool_response>'));
        const inputText = built.input[0]; assert.equal(inputText.type, 'text'); assert.equal(inputText.text, mapped.promptText);
        if (unsupported) {
          assert.deepEqual(bytes, [a]); assert.ok(!bytes.some(value => value.equals(b)));
          assert.throws(() => assert.deepEqual(bytes, [a, b]), 'The positive exact-byte assertion must fail on this projection');
          assert.equal(mapped.warnings.length, 1);
          assert.equal(mapped.warnings[0].details, 'File reference data is not supported for images.');
        } else {
          assert.deepEqual(mapped.warnings, []);
          assert.deepEqual(bytes, [a, b], 'Provider input must contain the actual A and B bytes in chronological order');
          assert.deepEqual(bytes.map(hash), [aHash, bHash]);
          assert.ok(!bytes[1].equals(a));
          t.diagnostic(`Continuation input: text, localImage(A), localImage(B); B SHA-256 ${hash(bytes[1])}`);
        }
      }
      return fixtureStream([{ type: 'stream-start', warnings: mapped.warnings }, ...textParts(step === 0
        ? `<tool_call>${JSON.stringify({ name: 'executeGuardedDecision', arguments: guidance })}</tool_call>`
        : 'Synthetic projection complete.')]);
    } });
    const parent = new ToolLoopAgent({
      model: wrapLanguageModel({ model: endpoint, middleware: [hermesToolMiddleware,
        cliSafetyMiddleware(abort, () => false, async () => {})] }),
      tools, maxRetries: 0, stopWhen: isStepCount(2),
      prepareStep: ({ stepNumber }) => ({ activeTools: stepNumber === 0 ? ['executeGuardedDecision'] : [],
        toolChoice: stepNumber === 0 ? 'auto' : 'none' }),
    });
    try {
      const stream = await parent.stream({ messages: [{ role: 'user', content: [
        { type: 'text', text: 'Initial synthetic frame A at tic 1. Return one synthetic guarded receipt, then finish.' },
        { type: 'file', mediaType: 'image/png', data: a },
      ] }], abortSignal: abort.signal });
      const consume = () => consumeDoomStream(stream, abort.signal, (output, name, ordinal, evidence) => {
        assert.ok(hostResultMatches(calls, output, name, ordinal, evidence));
        assert.ok(domainResultMatches(output, envelope)); correlated++; return true;
      }, ['executeGuardedDecision']);
      if (unsupported) {
        await assert.rejects(consume(), /STREAM_FAILURE|CLI_STREAM_WARNING/);
        assert.equal(cliFailureCode(abort.signal.reason), 'CLI_STREAM_WARNING');
      } else {
        const receipt = await consume();
        assert.equal(receipt.drained, true); assert.equal(receipt.steps, 2);
        assert.equal(receipt.toolCalls, 1); assert.equal(receipt.toolResults, 1);
        assert.equal(await stream.text, 'Synthetic projection complete.');
        assert.equal(abort.signal.aborted, false);
      }
      assert.equal(requests, 2); assert.equal(executed, 1); assert.equal(correlated, 1);
      assert.equal(calls.length, 1); assert.equal(calls[0].settled, true);
    } finally { await provider.close(); }
  });
});
