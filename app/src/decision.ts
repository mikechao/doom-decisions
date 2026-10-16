import type { E1M1Assessment, Observation } from './worker-shared.ts';
import { assessE1M1, i11MaskValid, i11VerifyStep } from './worker-shared.ts';

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
// Recoverable request failures carry only fixed, locally chosen categories.
export class DecisionFailure extends Error {}
export class DecisionStopped extends Error {}
export type Phase =
  | 'unprepared'
  | 'preparing'
  | 'ready'
  | 'busy'
  | 'terminal'
  | 'error';
export type Attempt = Readonly<{ tics: number; worker: object }>;
type Session = {
  valid: boolean;
  phase: Phase;
  worker?: object | null;
  attempt?: Attempt;
  terminal?: E1M1Assessment;
};

// Synchronous admission and identity fencing are shared with the offline cases.
export function admitDecision(run: Session, tics: number): Attempt | undefined {
  if (
    !run.valid ||
    run.phase !== 'ready' ||
    run.attempt ||
    run.terminal ||
    !run.worker ||
    !Number.isSafeInteger(tics) ||
    tics < 1
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
export function validateChoice(
  data: unknown,
  permittedActions: readonly ActionName[] = Object.keys(masks) as ActionName[],
) {
  const answer = record(data);
  if (answer.kind === 'refusal') throw Error('API refusal');
  if (
    answer.kind !== 'choice' ||
    typeof answer.action !== 'string' ||
    !Object.hasOwn(masks, answer.action) ||
    !permittedActions.includes(answer.action as ActionName)
  )
    throw Error('Invalid next_action choice');
  // Optional metrics never authorize an action. Keep only validated projections.
  const probabilities = answer.probabilities;
  return {
    action: answer.action as ActionName,
    confidence: probability(answer.confidence) ? answer.confidence : null,
    probabilities:
      Array.isArray(probabilities) &&
      probabilities.length === permittedActions.length &&
      permittedActions.every(
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
  terminal: boolean;
  assessment: E1M1Assessment | null;
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
    terminal: false,
    assessment: null,
  };
  if (!i11MaskValid(mask) || !Number.isSafeInteger(tics) || tics < 1)
    return evidence;
  let last = before;
  const steps = Array.isArray(result.steps) ? result.steps : [];
  // Evaluate the completed prefix BEFORE checking the outer outcome/diagnostics.
  // Refusal status -1 is passive in i11VerifyStep; it must never count as a tic.
  for (const step of steps) {
    try {
      if (
        evidence.independentlyVerifiedTics === tics ||
        assessE1M1(last).kind !== 'alive'
      )
        break;
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
      evidence.assessment = assessE1M1(last);
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
  evidence.complete = fullyApplied && evidence.assessment?.kind === 'alive';
  const knownBoundary =
    consistent &&
    result.status === 0 &&
    evidence.independentlyVerifiedTics > 0 &&
    ((result.outcome === 'TERMINAL' &&
      evidence.assessment?.kind === 'terminal') ||
      (result.outcome === 'INELIGIBLE' &&
        evidence.assessment?.kind === 'unsupported'));
  evidence.terminal = knownBoundary && result.outcome === 'TERMINAL';
  const knownRefusal =
    consistent &&
    result.outcome === 'REFUSED' &&
    result.status === -1 &&
    evidence.independentlyVerifiedTics < tics;
  evidence.completionUncertain = !(
    fullyApplied ||
    knownRefusal ||
    knownBoundary
  );
  return evidence;
}
