import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLocalMcpServer, tool } from 'ai-sdk-provider-codex-cli';
import { z } from 'zod';

test('one validated host callback returns an exact domain payload over local MCP', { timeout: 10_000 }, async t => {
  const parameters = z.strictObject({
    observationId: z.string().trim().min(1).max(64),
    limit: z.number().int().min(1).max(3),
  });
  const calls: z.output<typeof parameters>[] = [];
  const marker = `probe-${randomUUID()}`;
  const noteId = randomUUID();
  const payload = {
    observationId: 'synthetic-observation',
    candidates: [{ noteId, marker, summary: 'Synthetic historical lead; unverified and unrelated to Doom state.' }],
  };
  const findLandmarks = tool({
    name: 'findLandmarks',
    description: 'Return one synthetic landmark for an offline MCP transport probe.',
    parameters,
    execute: async input => {
      calls.push(structuredClone(input));
      return payload;
    },
  });
  const server = await createLocalMcpServer({
    name: 'offline-landmarks-probe',
    tools: [findLandmarks],
    host: '127.0.0.1',
    port: 0,
  });
  async function rpc(id: number, method: string, params: Record<string, unknown> = {}) {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.config.bearerToken}`,
        Connection: 'close',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(2_000),
    });
    assert.equal(response.status, 200);
    return z.object({
      jsonrpc: z.literal('2.0'),
      id: z.literal(id),
      result: z.unknown(),
    }).parse(await response.json());
  }
  try {
    assert.equal(new URL(server.url).hostname, '127.0.0.1');
    assert.ok(server.port > 0);
    assert.equal(typeof server.config.bearerToken, 'string');
    assert.ok(server.config.bearerToken);
    const listed = z.object({
      tools: z.array(z.object({
        name: z.string(),
        inputSchema: z.record(z.string(), z.unknown()),
      })),
    }).parse((await rpc(1, 'tools/list')).result);
    assert.deepEqual(listed.tools.map(entry => entry.name), ['findLandmarks']);
    assert.deepEqual(listed.tools[0].inputSchema, findLandmarks.inputSchema);
    assert.equal(calls.length, 0);

    const returned = z.strictObject({
      content: z.array(z.strictObject({ type: z.literal('text'), text: z.string() })).length(1),
    }).parse((await rpc(2, 'tools/call', {
      name: 'findLandmarks',
      arguments: { observationId: '  synthetic-observation  ', limit: 1 },
    })).result);
    assert.deepEqual(calls, [{ observationId: 'synthetic-observation', limit: 1 }]);
    // Compare actual wire text and its entire decoded object, not a predicted envelope.
    assert.equal(returned.content[0].text, JSON.stringify(payload));
    const decoded: unknown = JSON.parse(returned.content[0].text);
    assert.deepEqual(decoded, payload);
  } finally {
    await server.stop();
    // Only a refused connection passes: an HTTP error or timeout is insufficient.
    await assert.rejects(() => rpc(3, 'tools/list'), error =>
      error instanceof TypeError && error.cause instanceof Error &&
      'code' in error.cause && error.cause.code === 'ECONNREFUSED');
  }
  assert.equal(calls.length, 1);
  t.diagnostic(JSON.stringify({
    tool: 'findLandmarks', callbacks: calls.length, parsedInput: calls[0],
    marker, noteId, exactPayload: true, shutdown: 'ECONNREFUSED after awaited stop',
  }));
});
