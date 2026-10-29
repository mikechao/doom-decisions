import type { ActionName, Execution } from './decision.ts';
import { masks } from './decision.ts';
import type { Observation, Results } from './worker-shared.ts';
import { assessE1M1 } from './worker-shared.ts';

export type PreviousActionOutcome = Readonly<{
  action: ActionName;
  tics: number;
  endTic: number;
  x: number;
  y: number;
  text: string;
}>;

const coordinate = (value: number) =>
  Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

function eligible(observation: Observation) {
  return (
    assessE1M1(observation).kind === 'alive' &&
    observation.native.actorEqual === 1 &&
    coordinate(observation.native.x) &&
    coordinate(observation.native.y)
  );
}

// Called only with the same action's independently verified receipt. The caller
// must also verify its resulting frame before publishing this candidate.
export function createPreviousActionOutcome(
  action: ActionName,
  before: Observation,
  receipt: Results['action'],
  execution: Execution,
): PreviousActionOutcome | undefined {
  if (
    !execution.complete ||
    execution.terminal ||
    execution.completionUncertain ||
    execution.mask !== masks[action] ||
    execution.independentlyVerifiedTics !== receipt.steps.length ||
    !eligible(before) ||
    !receipt.steps.every(eligible)
  )
    return;
  const last = receipt.steps.at(-1);
  if (!last || last.counters.gametic !== execution.cumulativeVerifiedTics)
    return;
  const start = before.native;
  const end = last.native;
  const lines = [
    `Previous verified action: ${action} (${execution.independentlyVerifiedTics} tics).`,
  ];
  if (
    action === 'forward' ||
    action === 'backward' ||
    action === 'turn_left' ||
    action === 'turn_right'
  ) {
    const dx = (end.x - start.x) / 65536;
    const dy = (end.y - start.y) / 65536;
    const changed = receipt.steps.some(
      ({ native }) => native.x !== start.x || native.y !== start.y,
    );
    const detail =
      dx !== 0 || dy !== 0
        ? 'net translation observed'
        : changed
          ? 'endpoints equal; intermediate recorded positions changed'
          : 'unchanged at each recorded tic boundary';
    lines.push(
      `Player XY displacement: dx=${dx}, dy=${dy} Doom units; ${detail}.`,
    );
    if (dx === 0 && dy === 0)
      lines.push('No net displacement observed; cause unknown.');
  }
  return Object.freeze({
    action,
    tics: execution.independentlyVerifiedTics,
    endTic: last.counters.gametic,
    x: end.x,
    y: end.y,
    text: lines.join('\n'),
  });
}

export function previousActionAt(
  outcome: PreviousActionOutcome | undefined,
  observation: Observation,
): PreviousActionOutcome | undefined {
  return outcome &&
    eligible(observation) &&
    outcome.endTic === observation.counters.gametic &&
    outcome.x === observation.native.x &&
    outcome.y === observation.native.y
    ? outcome
    : undefined;
}
