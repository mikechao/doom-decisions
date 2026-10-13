// Pure presentation fixtures only: no DOM, Worker/WASM, SDK or network execution.
import assert from 'node:assert/strict';
import { projectLatestOutcome } from '../src/latest-outcome.ts';

const frame = (tic) => ({
  tic, nativeSha256: 'a'.repeat(64), canvasSha256: 'a'.repeat(64),
});
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function project(entry, visibleFrame) {
  // Any mutation of controller evidence fails in this strict ES module.
  return projectLatestOutcome(freeze(entry), freeze(visibleFrame));
}
const pending = {
  number: 27, selectedTics: 21, action: null,
  status: 'Capturing current frame', observation: frame(1),
  result: null, execution: null, cumulativeVerifiedTics: 1,
};
const completed = {
  ...pending, action: 'turn_left', status: 'Complete',
  result: frame(22), cumulativeVerifiedTics: 22,
  execution: {
    mask: 8, requestedTics: 21, reportedCompletedTics: 21,
    independentlyVerifiedTics: 21, cumulativeVerifiedTics: 22,
    complete: true, completionUncertain: false, terminal: false,
    assessment: { kind: 'alive', tic: 22, dead: false, exitPending: false },
  },
};
const execution = (changes) => ({ ...completed.execution, ...changes });
const noVerifiedOutcome = (outcome) => {
  assert.doesNotMatch(outcome.evidence, /tics? completed|frame verified/i);
};

// Loading, preparation and the neutral preparation tic all have no AI entry.
for (const visible of [undefined, frame(0), frame(1)]) {
  assert.deepEqual(project(undefined, visible), {
    number: '', action: 'No AI decisions yet.', evidence: '',
  });
}
assert.deepEqual(project(pending, frame(1)), {
  number: '#27', action: 'Action pending', evidence: 'Capturing current frame',
});
assert.equal(project({ ...pending, status: 'Requesting one action' }).action, 'Action pending');
assert.equal(project({ ...pending, status: 'Requesting one action', action: 'use' }).evidence,
  'Choice received; checking unchanged game state');

for (const status of [
  'Stepping and verifying',
  'Action verified; rendering',
  'Waiting for API response cleanup; no native action dispatched',
  'Checking unchanged native state',
  'Stopped by user; no native action dispatched',
  'authentication (401); no native action dispatched',
  'Game/observation verification failed; no native action dispatched. Reload to restart.',
]) {
  const outcome = project({ ...pending, status });
  assert.equal(outcome.number, '#27');
  assert.equal(outcome.evidence, status);
  noVerifiedOutcome(outcome);
}
// Even a fully verified action and a painted/matching frame cannot shortcut stage.
for (const status of ['Stepping and verifying', 'Action verified; rendering']) {
  noVerifiedOutcome(project({ ...completed, status }, completed.result));
}
assert.deepEqual(project(completed, completed.result), {
  number: '#27', action: 'Turn left',
  evidence: '21 tics completed · Current frame verified',
});

// Each independent completion/accounting/frame gate must hold.
for (const change of [
  { action: null }, { selectedTics: 20 }, { selectedTics: 0 },
  { execution: null }, { execution: execution({ complete: false }) },
  { execution: execution({ completionUncertain: true }) },
  { execution: execution({ terminal: true }) },
  { execution: execution({ requestedTics: 20 }) },
  { execution: execution({ reportedCompletedTics: null }) },
  { execution: execution({ reportedCompletedTics: 20 }) },
  { execution: execution({ independentlyVerifiedTics: 20 }) },
  { execution: execution({ cumulativeVerifiedTics: 23 }) },
  { execution: execution({ assessment: null }) },
  { execution: execution({ assessment: { kind: 'unsupported', tic: 22 } }) },
  { execution: execution({ assessment: { kind: 'alive', tic: 23 } }) },
  { observation: null }, { observation: frame(2) },
  { cumulativeVerifiedTics: 23 }, { result: null }, { result: frame(23) },
  { result: { ...frame(22), nativeSha256: '' } },
  { result: { ...frame(22), canvasSha256: 'b'.repeat(64) } },
]) noVerifiedOutcome(project({ ...completed, ...change }, completed.result));

// A once-verified result stays historical unless all three visible fields match.
for (const visible of [
  undefined, frame(23),
  { ...frame(22), nativeSha256: 'b'.repeat(64) },
  { ...frame(22), canvasSha256: 'b'.repeat(64) },
]) {
  const outcome = project(completed, visible);
  assert.match(outcome.evidence, /21 tics completed · Resulting frame verified/);
  assert.doesNotMatch(outcome.evidence, /Current frame verified/);
  assert.match(outcome.evidence, visible ? /Not the displayed frame/ : /Displayed frame unavailable/);
}

const terminal = {
  ...completed, status: 'Player dead at tic 3; frame retained.',
  result: frame(3), cumulativeVerifiedTics: 3,
  execution: execution({
    complete: false, terminal: true, reportedCompletedTics: 2,
    independentlyVerifiedTics: 2, cumulativeVerifiedTics: 3,
    assessment: { kind: 'terminal', tic: 3, dead: true, exitPending: false },
  }),
};
for (const signals of [
  { dead: true, exitPending: false },
  { dead: false, exitPending: true },
  { dead: true, exitPending: true },
]) {
  const entry = { ...terminal, execution: {
    ...terminal.execution, assessment: { kind: 'terminal', tic: 3, ...signals },
  } };
  const outcome = project(entry, entry.result);
  assert.match(outcome.evidence, /2 of 21 tics verified · Current frame verified/);
  assert.equal(outcome.evidence.includes('Player death verified'), signals.dead);
  assert.equal(outcome.evidence.includes('E1M1 exit pending'), signals.exitPending);
  assert.doesNotMatch(outcome.evidence, /completed|E1M2|intermission/i);
  assert.match(project(entry, frame(1)).evidence, /Not the displayed frame/);
}
for (const status of [
  'Terminal tic verified; rendering',
  'Player dead at tic 3; terminal frame unavailable. Reload to restart.',
]) {
  const outcome = project({ ...terminal, status, result: null }, frame(1));
  assert.match(outcome.evidence, /2 of 21 tics verified/);
  assert.match(outcome.evidence, status.includes('rendering')
    ? /Verifying resulting frame/ : /Resulting frame unavailable/);
  noVerifiedOutcome(outcome);
}
const uncertain = project({
  ...terminal, result: null,
  status: 'Native completion uncertain; verified prefix retained. Reload to restart.',
  execution: { ...terminal.execution, terminal: false, completionUncertain: true },
}, frame(1));
assert.match(uncertain.evidence, /At least 2 tics verified \(lower bound; native completion uncertain\)/);
assert.match(uncertain.evidence, /Reload/);
noVerifiedOutcome(uncertain);
console.log('Latest Outcome pure presentation truth gates passed (synthetic evidence only).');
