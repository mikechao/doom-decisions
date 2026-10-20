import { type ActionName, type Execution, masks } from './decision';
import type { Results } from './worker-shared';
import {
  collisionObservationValid,
  movementFlags,
  rejectionReasons,
} from './worker-shared';

// Presentation only. The controller supplies the independently verified receipt
// and publishes this text only after its resulting native/Canvas frame verifies.
export function formatCollisionEvidence(
  action: ActionName,
  startTic: number,
  receipt: Results['action'],
  execution: Execution,
): string {
  const unavailable = 'Native collision telemetry unavailable.';
  const count = execution.independentlyVerifiedTics;
  if (
    execution.completionUncertain ||
    (!execution.complete && !execution.terminal) ||
    execution.mask !== masks[action] ||
    !Number.isSafeInteger(startTic) ||
    startTic < 1 ||
    count < 1 ||
    count !== receipt.steps.length ||
    startTic + count !== execution.cumulativeVerifiedTics ||
    !receipt.steps.every(
      (step, i) =>
        step.status === 0 &&
        step.counters.gametic === startTic + i + 1 &&
        collisionObservationValid(step),
    )
  )
    return unavailable;

  const totals = { trial: 0, success: 0, rejected: 0, slide: 0 };
  let reasons = 0;
  for (const { native } of receipt.steps) {
    for (const key of Object.keys(totals) as (keyof typeof totals)[])
      if (native.movementFlags & movementFlags[key]) totals[key]++;
    reasons |= native.rejectionMask;
  }
  const names = [
    [rejectionReasons.solidLine, 'solid line'],
    [rejectionReasons.solidThing, 'solid thing'],
    [rejectionReasons.clearance, 'clearance'],
    [rejectionReasons.unknown, 'unknown'],
  ] as const;
  const last = receipt.steps[receipt.steps.length - 1].native;
  return [
    `Last verified ${execution.terminal ? 'terminal prefix' : 'action'}: ${action}, ${count} tics (${startTic} → ${execution.cumulativeVerifiedTics})`,
    `Collision (per-tic counts; overlap): trial ${totals.trial} · success ${totals.success} · rejection ${totals.rejected} · slide ${totals.slide}`,
    `Rejection reasons (union): ${
      names
        .filter(([bit]) => reasons & bit)
        .map(([, name]) => name)
        .join(', ') || 'none observed'
    }`,
    `Last sample: collisionSampleTic (87)=${last.collisionSampleTic} · movementFlags (88)=${last.movementFlags} · rejectionMask (89)=${last.rejectionMask}`,
  ].join('\n');
}
