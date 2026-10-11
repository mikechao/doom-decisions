import type { Observation } from './worker-shared.ts';
import { i11VerifyStep } from './worker-shared.ts';

export const masks = Object.freeze({
  neutral: 0,
  forward: 1,
  turn_right: 2,
  backward: 4,
  turn_left: 8,
  fire: 16,
  use: 32,
});
export type ActionName = keyof typeof masks;
export type Phase = 'unprepared' | 'preparing' | 'ready' | 'busy' | 'error';
export type Attempt = Readonly<{ tics: number; worker: object }>;
type Session = {
  valid: boolean;
  phase: Phase;
  worker?: object | null;
  attempt?: Attempt;
};

// Synchronous admission and identity fencing are shared with the offline cases.
export function admitDecision(run: Session, tics: number): Attempt | undefined {
  if (
    !run.valid ||
    run.phase !== 'ready' ||
    run.attempt ||
    !run.worker ||
    !Number.isInteger(tics) ||
    tics < 1 ||
    tics > 20
  )
    return;
  const attempt = Object.freeze({ tics, worker: run.worker });
  run.phase = 'busy';
  run.attempt = attempt;
  return attempt;
}
export function assertDecision(run: Session, attempt: Attempt) {
  if (
    !run.valid ||
    run.phase !== 'busy' ||
    run.attempt !== attempt ||
    run.worker !== attempt.worker
  )
    throw Error('Decision invalidated; no further native dispatch.');
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
const probability = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;
export function validateChoice(data: unknown) {
  const answers = record(data).answers;
  if (!Array.isArray(answers) || answers.length !== 1)
    throw Error('Invalid answer count');
  const answer = record(answers[0]);
  if (answer.type === 'refusal') throw Error('API refusal');
  if (
    answer.type !== 'choice' ||
    answer.name !== 'next_action' ||
    typeof answer.choice !== 'string' ||
    !Object.hasOwn(masks, answer.choice)
  )
    throw Error('Invalid next_action choice');
  // Optional metrics never authorize an action. Keep only validated projections.
  const probabilities = answer.probabilities;
  return {
    action: answer.choice as ActionName,
    confidence: probability(answer.confidence) ? answer.confidence : null,
    probabilities:
      Array.isArray(probabilities) &&
      probabilities.length === 7 &&
      Object.keys(masks).every(
        (value) =>
          probabilities.filter(
            (p) =>
              record(p).value === value && probability(record(p).probability),
          ).length === 1,
      )
        ? probabilities.map((p) => ({
            value: record(p).value as ActionName,
            probability: record(p).probability as number,
          }))
        : null,
  };
}

export type Execution = {
  mask: number;
  requestedTics: number;
  reportedCompletedTics: number | null;
  independentlyVerifiedTics: number;
  cumulativeVerifiedTics: number;
  completionUncertain: boolean;
  complete: boolean;
};
export function verifyAction(
  before: Observation,
  mask: number,
  tics: number,
  receipt?: unknown,
): Execution {
  const result = record(receipt);
  const evidence: Execution = {
    mask,
    requestedTics: tics,
    reportedCompletedTics:
      typeof result.completedTics === 'number' &&
      Number.isSafeInteger(result.completedTics) &&
      result.completedTics >= 0
        ? result.completedTics
        : null,
    independentlyVerifiedTics: 0,
    cumulativeVerifiedTics: before.counters.gametic,
    completionUncertain: true,
    complete: false,
  };
  let last = before;
  const steps = Array.isArray(result.steps) ? result.steps : [];
  // Evaluate the completed prefix BEFORE checking the outer outcome/diagnostics.
  // Refusal status -1 is passive in i11VerifyStep; it must never count as a tic.
  for (const step of steps) {
    try {
      if (record(step).status !== 0) break;
      i11VerifyStep(mask, last, step);
      if (
        !(
          [
            'wasiInit',
            'cInit',
            'engineCreate',
            'titlePrepare',
            'titleReady',
            'render',
            'frame',
            'netIntercept',
          ] as const
        ).every((key) => last.counters[key] === step.counters[key])
      )
        break;
      last = step;
      evidence.independentlyVerifiedTics++;
      evidence.cumulativeVerifiedTics++;
    } catch {
      break;
    }
  }
  const equal = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const consistent =
    Array.isArray(result.steps) &&
    result.mask === mask &&
    result.requestedTics === tics &&
    steps.length === evidence.independentlyVerifiedTics &&
    result.completedTics === evidence.independentlyVerifiedTics &&
    equal(last.counters, result.counters) &&
    equal(last.native, result.native) &&
    !result.logsTruncated &&
    (!Array.isArray(result.logs) ||
      !result.logs.some((log) => record(log).kind === 'error'));
  const fullyApplied =
    consistent &&
    result.outcome === 'APPLIED' &&
    result.status === 0 &&
    evidence.independentlyVerifiedTics === tics;
  evidence.complete = fullyApplied && record(result.native).ready === 1;
  const knownRefusal =
    consistent &&
    result.outcome === 'REFUSED' &&
    result.status === -1 &&
    evidence.independentlyVerifiedTics < tics;
  evidence.completionUncertain = !(fullyApplied || knownRefusal);
  return evidence;
}
