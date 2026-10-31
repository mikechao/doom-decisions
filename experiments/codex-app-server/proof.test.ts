import assert from 'node:assert/strict';
import test from 'node:test';
import { expected, fixture, sha256 } from './fixtures.ts';
import { assess, validateProposal, type Proposal } from './proposal.ts';
import { Rpc, terminalFor } from './rpc.ts';
const valid: Proposal = { target: 'red circle', visualEvidence: { markers: expected[0], recalledNonce: null, recalledTarget: null }, uncertainty: 'Synthetic scene only', nextExperiment: 'Compare another synthetic frame', recommendedTics: 6 };
const validate = (value: unknown, status = 'completed') => validateProposal(JSON.stringify(value), status);
test('strict validation accepts advisory fields and boundary tics', () => {
  for (const recommendedTics of [1, 6, 35]) assert.equal(validate({ ...valid, recommendedTics }).recommendedTics, recommendedTics);
});
test('rejects missing/extra fields, wrong types, ranges, nested extras and low-level tokens', () => {
  for (const patch of [{ target: undefined }, { action: 'forward' }, { recommendedTics: '6' }, { recommendedTics: 0 }, { recommendedTics: 36 }, { recommendedTics: 1.5 }, { target: '' }, { target: 'x'.repeat(801) }, { recommendedInstruction: 'turn_left' }, { visualEvidence: { ...valid.visualEvidence, extra: true } }, { visualEvidence: { ...valid.visualEvidence, markers: [{ ...expected[0][0], extra: true }] } }]) assert.throws(() => validate({ ...valid, ...patch }));
  assert.throws(() => validateProposal('x'.repeat(8193), 'completed'));
  assert.throws(() => validateProposal('{', 'completed'));
});
test('only successful terminal status permits proposal acceptance', () => {
  for (const status of ['inProgress', 'failed', 'interrupted', '']) assert.throws(() => validate(valid, status));
});
test('terminal correlation rejects another turn/thread and acknowledgement', () => {
  const event = { method: 'turn/completed', params: { threadId: 'a', turn: { id: 'b', status: 'completed' } } };
  assert.equal(terminalFor(event, 'a', 'b'), true);
  assert.equal(terminalFor(event, 'x', 'b'), false);
  assert.equal(terminalFor(event, 'a', 'x'), false);
  assert.equal(terminalFor({ ...event, method: 'turn/started' }, 'a', 'b'), false);
});
test('RPC matches response IDs out of order; uncorrelated responses fail closed', () => {
  // Exercise response handler without constructing a child or making inference.
  const rpc = Object.create(Rpc.prototype) as Rpc;
  rpc.pending = new Map(); rpc.ledger = []; rpc.started = Date.now();
  rpc.wake = { emit: () => true } as unknown as Rpc['wake'];
  const received: string[] = [];
  rpc.pending.set(1, { resolve: value => received.push(value.label), reject: () => {} });
  rpc.pending.set(2, { resolve: value => received.push(value.label), reject: () => {} });
  rpc.receive({ id: 2, result: { label: 'second' } });
  rpc.receive({ id: 1, result: { label: 'first' } });
  assert.deepEqual(received, ['second', 'first']);
  rpc.receive({ id: 99, result: {} });
  assert.match(rpc.fatal?.message ?? '', /Uncorrelated/);
});
test('fixture assessment separates visual accuracy from retained context', () => {
  assert.equal(assess(valid, 0, 'nonce').imageMatch, true);
  assert.equal(assess(valid, 1, 'nonce', valid.target).imageMatch, false);
  const second = { ...valid, visualEvidence: { markers: expected[1], recalledNonce: 'nonce', recalledTarget: valid.target } };
  assert.equal(assess(second, 1, 'nonce', valid.target).contextRetained, true);
  assert.equal(assess(second, 1, 'other', valid.target).contextRetained, false);
  assert.equal(sha256(fixture(0)), sha256(fixture(0)));
  assert.notEqual(sha256(fixture(0)), sha256(fixture(1)));
  assert.equal(fixture(0).readUInt32BE(16), 640);
  assert.equal(fixture(0).readUInt32BE(20), 400);
});
