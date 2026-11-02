import assert from 'node:assert/strict';
import test from 'node:test';
import { acpTools, ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME, getExecuteByName } from '@mcpc-tech/acp-ai-provider';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  createSyntheticTool, jsonParseOk, matchesReceipt, rebuildSmokeTools, smokeMain, smokePrompt, summarizeToolResult, type CallbackReceipt,
} from '../src/find-landmarks-acp-smoke.ts';

function fixture() {
  const receipts: CallbackReceipt[] = [];
  const abort = new AbortController();
  const registered = acpTools({ findLandmarks: createSyntheticTool(receipts, abort) });
  return { receipts, abort, registered };
}

test('installed MCP schema accepts plain candidates but creates empty standard content', () => {
  const plain = { candidates: [{ noteId: 'offline-note', marker: 'offline-marker', status: 'unverified' }] };
  const parsed = CallToolResultSchema.safeParse(plain);
  assert.ok(parsed.success);
  assert.deepEqual(parsed.data.content, []);
  assert.equal(parsed.data.structuredContent, undefined);
  assert.deepEqual(parsed.data.candidates, plain.candidates, 'Candidates survive only as an extension property');
  const roundTrip = CallToolResultSchema.parse(JSON.parse(JSON.stringify(parsed.data)));
  assert.deepEqual(roundTrip.content, []);
  assert.deepEqual(roundTrip.candidates, plain.candidates);
});

test('explicit MCP text envelope preserves candidate ID/marker through schema and JSON round-trip', () => {
  const candidates = [{ noteId: 'offline-note', marker: 'offline-marker', status: 'unverified' }];
  const envelope = { content: [{ type: 'text', text: JSON.stringify({ candidates }) }] };
  const parsed = CallToolResultSchema.safeParse(envelope);
  assert.ok(parsed.success);
  const roundTrip = CallToolResultSchema.parse(JSON.parse(JSON.stringify(parsed.data)));
  assert.equal(roundTrip.content.length, 1);
  const block = roundTrip.content[0];
  assert.ok(block.type === 'text');
  assert.deepEqual(JSON.parse(block.text), { candidates });
  assert.equal(roundTrip.candidates, undefined, 'Candidate data belongs in standard content');
});

test('entry refuses inference without exact authorization; imports do not launch ACP', async () => {
  let launches = 0;
  const launch = async () => { launches++; return 7; };
  const print = () => {};
  for (const args of [[], ['--help'], ['--authorize-acp', 'extra'], ['--live'], ['--authorize-acp=true']]) {
    assert.equal(await smokeMain(args, launch, print), args.length === 0 || args[0] === '--help' ? 0 : 2);
  }
  assert.equal(launches, 0);
  assert.equal(await smokeMain(['--authorize-acp'], launch, print), 7);
  assert.equal(launches, 1, 'Only an injected in-memory launch ran');
});

test('two-entry map preserves registered callback, dynamic metadata and JSON schema', async () => {
  const { registered, receipts } = fixture();
  const key = ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME;
  const tools = rebuildSmokeTools(registered);
  assert.deepEqual(Object.keys(tools).sort(), [key, 'findLandmarks'].sort());
  assert.equal(tools.findLandmarks, registered.findLandmarks);
  assert.equal(getExecuteByName('findLandmarks'), tools.findLandmarks.execute);
  const original = registered[key];
  assert.ok(original.type === 'provider');
  assert.equal(tools[key].id, original.id);
  assert.equal(tools[key].args, original.args);
  assert.equal(tools[key].type, 'provider');
  assert.equal(tools[key].isProviderExecuted, true);
  assert.ok(typeof original.inputSchema === 'object' && 'jsonSchema' in original.inputSchema);
  assert.deepEqual(await tools[key].inputSchema.jsonSchema, await original.inputSchema.jsonSchema);
  assert.equal(receipts.length, 0, 'Registration and rebuilding do not execute the callback');
});

test('unexpected generated ID or custom schema validator is refused', () => {
  const key = ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME;
  const wrong = fixture().registered;
  const dynamic = wrong[key];
  assert.equal(dynamic.type, 'provider');
  if (dynamic.type !== 'provider') throw new Error('Unexpected fixture');
  dynamic.id = 'unexpected.tool';
  assert.throws(() => rebuildSmokeTools(wrong), /UNEXPECTED_DYNAMIC_TOOL/);

  const custom = fixture().registered;
  const schema = custom[key].inputSchema;
  assert.ok(typeof schema === 'object' && 'jsonSchema' in schema);
  custom[key] = {
    ...custom[key],
    inputSchema: { ...schema, validate: () => ({ success: false, error: new Error('Unused validator') }) },
  };
  assert.throws(() => rebuildSmokeTools(custom), /UNEXPECTED_DYNAMIC_TOOL/);
});

test('local callback receipt supplies tool-only values; exact echo requires actual execution', async () => {
  const { registered, receipts } = fixture();
  assert.equal(matchesReceipt('{"status":"selected","noteId":"invented","marker":"invented"}', receipts), false);
  const envelope = await registered.findLandmarks.execute({});
  const result = receipts[0].result;
  assert.ok(result);
  assert.equal(receipts.length, 1);
  assert.deepEqual(receipts[0], { ordinal: 1, arguments: {}, result, returnedEnvelope: envelope, error: null });
  assert.notEqual(receipts[0].returnedEnvelope, envelope, 'Receipt captures a copy of the actual return');
  const normalized = CallToolResultSchema.parse(JSON.parse(JSON.stringify(envelope)));
  assert.equal(normalized.content.length, 1);
  const block = normalized.content[0];
  assert.ok(block.type === 'text');
  assert.deepEqual(JSON.parse(block.text), result);
  const candidate = result.candidates[0];
  assert.ok(!smokePrompt.includes(candidate.noteId) && !smokePrompt.includes(candidate.marker));
  const echo = { status: 'selected', noteId: candidate.noteId, marker: candidate.marker };
  assert.equal(matchesReceipt(JSON.stringify(echo), receipts), true);
  assert.equal(jsonParseOk(JSON.stringify(echo)), true);
  assert.equal(jsonParseOk(`Prose prefix${JSON.stringify(echo)}`), false);
  assert.equal(matchesReceipt(`Prose prefix${JSON.stringify(echo)}`, receipts), false);
  assert.equal(matchesReceipt(JSON.stringify({ ...echo, marker: 'invented' }), receipts), false);
  assert.equal(matchesReceipt(JSON.stringify({ ...echo, noteId: 'invented' }), receipts), false);
  assert.equal(matchesReceipt('{"status":"unavailable","reason":"no result"}', receipts), false);
  const downstream = summarizeToolResult({ result: normalized, error: null }, receipts);
  assert.deepEqual(downstream, { nestedResult: true, acpErrorPresent: false, isError: false,
    contentPresent: true, contentBlocks: 1, textBlocks: 1, truncated: false,
    noteIdMatches: true, markerMatches: true, candidateMatches: true });
  assert.equal(summarizeToolResult(normalized, receipts).candidateMatches, true);
  assert.equal(summarizeToolResult({ result: { content: [] }, error: null }, receipts).candidateMatches, false);
  assert.equal(summarizeToolResult({ result: null, error: { secret: 'must-not-be-logged' } }, receipts).acpErrorPresent, true);
  assert.equal(summarizeToolResult({ content: [], isError: true }, receipts).isError, true);
  assert.equal(JSON.stringify(summarizeToolResult({ result: null, error: { secret: 'must-not-be-logged' } }, receipts)).includes('must-not-be-logged'), false);
});

test('second callback is recorded, aborts and cannot satisfy the success predicate', async () => {
  const { registered, receipts, abort } = fixture();
  await registered.findLandmarks.execute({});
  const result = receipts[0].result;
  assert.ok(result);
  await assert.rejects(registered.findLandmarks.execute({}), /REPEATED_CALLBACK/);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].ordinal, 2);
  assert.equal(receipts[1].error, 'REPEATED_CALLBACK');
  assert.equal(receipts[1].result, null);
  assert.equal(abort.signal.aborted, true);
  assert.equal(matchesReceipt(JSON.stringify({ status: 'selected', noteId: result.candidates[0].noteId, marker: result.candidates[0].marker }), receipts), false);
});

test('model-supplied fields are rejected by the callback itself', async () => {
  const { registered, receipts, abort } = fixture();
  await assert.rejects(registered.findLandmarks.execute({ mapNamespace: 'model-supplied' }), /INVALID_ARGUMENTS/);
  assert.deepEqual(receipts, [{ ordinal: 1, arguments: null, result: null, returnedEnvelope: null, error: 'INVALID_ARGUMENTS' }]);
  assert.equal(abort.signal.aborted, true);
});
