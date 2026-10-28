// Actual stdio processes with preloaded fake fetch. No listener, browser, asset,
// native Worker/WASM or provider. Policy coverage stays in agent-bridge.test.ts.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { it } from 'vitest';
import { agentObservation, agentObserveResult } from './fixtures/agent.ts';
import { agentCliError } from '../../scripts/doom-agent.mjs';

const serverPath = fileURLToPath(new URL('../agent-mcp.mjs', import.meta.url));
const cliUrl = new URL('../../scripts/doom-agent.mjs', import.meta.url).href;
const names = ['doom_attach', 'doom_observe', 'doom_get_config', 'doom_get_prompt',
  'doom_start_run', 'doom_set_config', 'doom_set_prompt', 'doom_decide',
  'doom_memory_find', 'doom_memory_record'].sort();

it('CLI and MCP imports are silent and do not call fetch or execute an entrypoint', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.fetch = () => { throw Error('Import attempted network I/O'); };
    await import(${JSON.stringify(cliUrl)});
    await import(${JSON.stringify(new URL('../agent-mcp.mjs', import.meta.url).href)});
  `], { encoding: 'utf8', timeout: 5000, env: {} });
  assert.equal(child.error, undefined); assert.equal(child.status, 0);
  assert.equal(child.stdout, ''); assert.equal(child.stderr, '');
});

it.each(['legacy', 'auto'])('serves initialize/list/call over real stdio (%s), with full safe results and no startup bridge requests', async mode => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-mcp-stdio-'));
  const preload = join(directory, 'transport.mjs');
  const log = join(directory, 'calls.txt');
  const leaseFile = join(directory, 'lease.json');
  const lease = { pageId: '11111111-1111-1111-1111-111111111111',
    ownerId: '22222222-2222-2222-2222-222222222222', epoch: '33333333-3333-3333-3333-333333333333' };
  const observation = agentObserveResult();
  const decision = {
    outcome: 'completed', reason: null, beforeObservationId: observation.observationId,
    sdkInvoked: true, action: 'neutral', requestedTics: 6, reportedTics: 6,
    verifiedTics: 6, cumulativeTics: observation.tic, completionUncertain: false,
    requestIdentity: { provider: 'OpenRouter', requestedModel: 'offline-model' },
    responseMetadata: { reportedModel: 'offline-model', usage: { input: 2, output: 1, total: 3 } },
    observation: agentObservation(),
  };
  await writeFile(leaseFile, JSON.stringify(lease));
  await writeFile(preload, `
    import assert from 'node:assert/strict';
    import { appendFileSync } from 'node:fs';
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const readFile = fs.readFile;
    let observations = 0;
    let decisions = 0, failPngRead = false;
    fs.readFile = async (path, options) => {
      if (String(path).endsWith('.png') && failPngRead)
        throw Error('offline-private-unsanitized');
      return readFile(path, options);
    };
    syncBuiltinESMExports();
    globalThis.fetch = async (url, options) => {
      const op = new URL(url).pathname.split('/').at(-1);
      assert.equal(new URL(url).origin, 'http://127.0.0.1:5174');
      appendFileSync(${JSON.stringify(log)}, op + '\\n');
      const data = JSON.parse(options.body);
      if (op === 'observe') {
        observations++;
        failPngRead = observations > 1;
        return new Response(JSON.stringify({ pageId: data.pageId,
          epoch: data.epoch, commandId: data.commandId, observation: ${JSON.stringify(observation)} }));
      }
      if (op === 'decide') {
        decisions++;
        if (decisions === 3) return new Response('{"error":"agent-stopped"}', {status:409});
        if (decisions === 4) throw Error('offline-private-unsanitized');
        failPngRead = decisions === 5;
        const decision = { ...${JSON.stringify(decision)}, beforeObservationId: data.observationId };
        if (decisions === 2) Object.assign(decision, { outcome: 'stopped', action: null,
          reportedTics: null, verifiedTics: null, cumulativeTics: null, observation: null });
        return new Response(JSON.stringify({ pageId: data.pageId,
          epoch: data.epoch, commandId: data.commandId, decision }));
      }
      if (op === 'get-config') return new Response(' {"error":"agent-stopped"}', {status:409});
      throw Error('offline-private-unsanitized');
    };
  `);
  const child = spawn(process.execPath, ['--import', preload, serverPath], {
    cwd: dirname(serverPath), env: {}, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit');
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  // The SDK's stdio transport accepts explicit streams. This preserves raw
  // stdout for wire assertions while the real SDK Client speaks the protocol.
  const client = new Client({ name: 'offline-stdio', version: '1' }, { versionNegotiation: { mode } });
  const errors = [];
  client.onerror = error => errors.push(error);
  try {
    await client.connect(new StdioServerTransport(child.stdout, child.stdin));
    const catalog = await client.listTools();
    assert.deepEqual(catalog.tools.map(tool => tool.name).sort(), names);
    await assert.rejects(readFile(log), { code: 'ENOENT' });
    const bytes = Buffer.byteLength(JSON.stringify(catalog.tools));
    console.info(`Doom MCP ${mode}: catalog=${bytes} UTF-8 bytes; tools=10; server instructions=0`);
    const result = await client.callTool({ name: 'doom_observe', arguments: { leaseFile } });
    assert.equal(result.isError, false);
    const data = result.structuredContent;
    const { png, ...metadata } = observation;
    assert.deepEqual(data, { pageId: lease.pageId, epoch: lease.epoch, commandId: data.commandId,
      pngPath: join(directory, `${data.commandId}.png`), ...metadata });
    assert.deepEqual(result.content.map(block => block.type), ['text', 'image']);
    assert.equal(result.content[0].text, JSON.stringify(data));
    assert.equal(result.content[1].mimeType, 'image/png');
    const pngBytes = Buffer.from(png.slice(22), 'base64');
    assert.deepEqual(Buffer.from(result.content[1].data, 'base64'), pngBytes);
    assert.deepEqual(await readFile(data.pngPath), pngBytes);
    assert.equal('png' in data, false);
    assert.equal(JSON.stringify(data).includes(png.slice(22)), false);
    const decided = await client.callTool({ name: 'doom_decide', arguments: { leaseFile, observationId: observation.observationId } });
    const { png: resultingPng, ...resultingMetadata } = decision.observation;
    assert.equal(decided.isError, false);
    assert.deepEqual(decided.structuredContent, { pageId: lease.pageId, epoch: lease.epoch,
      commandId: observation.observationId, pngPath: join(directory, `${observation.observationId}.png`),
      ...decision, observation: resultingMetadata });
    assert.deepEqual(decided.content.map(block => block.type), ['text', 'image']);
    assert.equal(decided.content[0].text, JSON.stringify(decided.structuredContent));
    assert.equal(decided.content[1].mimeType, 'image/png');
    assert.deepEqual(Buffer.from(decided.content[1].data, 'base64'), await readFile(decided.structuredContent.pngPath));
    assert.deepEqual(Buffer.from(decided.content[1].data, 'base64'), Buffer.from(resultingPng.slice(22), 'base64'));
    assert.equal(JSON.stringify(decided.structuredContent).includes(resultingPng.slice(22)), false);
    const noFrame = await client.callTool({ name: 'doom_decide', arguments: { leaseFile, observationId: observation.observationId } });
    assert.equal(noFrame.isError, false);
    assert.deepEqual(noFrame.structuredContent, { ...decided.structuredContent, pngPath: null,
      outcome: 'stopped', action: null, reportedTics: null, verifiedTics: null,
      cumulativeTics: null, observation: null });
    assert.deepEqual(noFrame.content, [{ type: 'text', text: JSON.stringify(noFrame.structuredContent) }]);
    const decisionStopped = await client.callTool({ name: 'doom_decide', arguments: { leaseFile, observationId: observation.observationId } });
    assert.equal(decisionStopped.isError, true);
    assert.deepEqual(decisionStopped.structuredContent, { error: 'agent-stopped' });
    assert.deepEqual(decisionStopped.content, [{ type: 'text', text: JSON.stringify(decisionStopped.structuredContent) }]);
    const stopped = await client.callTool({ name: 'doom_get_config', arguments: { leaseFile, sessionId: observation.sessionId } });
    assert.equal(stopped.isError, true); assert.deepEqual(stopped.structuredContent, { error: 'agent-stopped' });
    assert.deepEqual(stopped.content, [{ type: 'text', text: JSON.stringify(stopped.structuredContent) }]);
    const unknown = await client.callTool({ name: 'doom_decide', arguments: { leaseFile, observationId: observation.observationId } });
    assert.equal(unknown.isError, true); assert.deepEqual(unknown.structuredContent, agentCliError(Error('unknown')));
    assert.deepEqual(unknown.content, [{ type: 'text', text: JSON.stringify(unknown.structuredContent) }]);
    assert.doesNotMatch(JSON.stringify(unknown), /offline-private-unsanitized/);
    const unreadableDecision = await client.callTool({ name: 'doom_decide', arguments: { leaseFile, observationId: decision.observation.observationId } });
    assert.equal(unreadableDecision.isError, true);
    assert.deepEqual(unreadableDecision.structuredContent, agentCliError(Error('unreadable')));
    assert.deepEqual(unreadableDecision.content, [{ type: 'text', text: JSON.stringify(unreadableDecision.structuredContent) }]);
    assert.doesNotMatch(JSON.stringify(unreadableDecision), /offline-private-unsanitized|doom-mcp-stdio-|pngPath/);
    const unreadable = await client.callTool({ name: 'doom_observe', arguments: { leaseFile } });
    assert.equal(unreadable.isError, true);
    assert.deepEqual(unreadable.structuredContent, agentCliError(Error('unreadable')));
    assert.deepEqual(unreadable.content, [{ type: 'text', text: JSON.stringify(unreadable.structuredContent) }]);
    assert.doesNotMatch(JSON.stringify(unreadable), /offline-private-unsanitized/);
    assert.equal(await readFile(log, 'utf8'), 'observe\ndecide\ndecide\ndecide\nget-config\ndecide\ndecide\nobserve\n');
    assert.deepEqual(errors, []);
    await client.close(); child.stdin.end();
    const [code] = await exit;
    assert.equal(code, 0); assert.equal(stderr, '');
    const lines = stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(lines.length >= 5);
    for (const message of lines) assert.equal(message.jsonrpc, '2.0');
    const matches = lines.filter(message => JSON.stringify(message).includes(observation.pngSha256));
    assert.equal(matches.length, 2);
    for (const match of matches)
      assert.equal(JSON.stringify(match).split(observation.pngSha256).length - 1, 2,
        'Full receipt is present in JSON text and structured output on the wire');
    console.info(`Doom MCP ${mode}: observe/decide surface content + structuredContent; wire payload copies=2 each`);
  } finally {
    await client.close().catch(() => {});
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exit;
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
