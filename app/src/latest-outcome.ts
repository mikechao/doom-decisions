import type { ActionName, Execution } from './decision';

type Frame = Readonly<{
  tic: number;
  nativeSha256: string;
  canvasSha256: string;
}>;
type OutcomeEntry = Readonly<{
  number: number;
  selectedTics: number;
  status: string;
  action: ActionName | null;
  observation: Frame | null;
  result: Frame | null;
  execution: Readonly<Execution> | null;
  cumulativeVerifiedTics: number;
}>;

// Read only the latest controller entry. This does not verify native work or
// own readiness: the existing status regions retain all operational guidance.
export function projectLatestOutcome(
  entry: OutcomeEntry | undefined,
  frame: Frame | undefined,
) {
  if (!entry)
    return { number: '', action: 'No AI decisions yet.', evidence: '' };

  const execution = entry.execution;
  const verified = execution?.independentlyVerifiedTics ?? 0;
  const accounting =
    execution &&
    !execution.completionUncertain &&
    Number.isSafeInteger(entry.selectedTics) &&
    entry.selectedTics > 0 &&
    execution.requestedTics === entry.selectedTics &&
    Number.isSafeInteger(verified) &&
    verified > 0 &&
    verified <= entry.selectedTics &&
    execution.reportedCompletedTics === verified &&
    execution.cumulativeVerifiedTics === entry.cumulativeVerifiedTics &&
    entry.observation &&
    entry.observation.tic + verified === execution.cumulativeVerifiedTics &&
    execution.assessment?.tic === execution.cumulativeVerifiedTics;
  const result = entry.result;
  const verifiedResult =
    accounting &&
    result &&
    result.tic === execution.cumulativeVerifiedTics &&
    /^[a-f0-9]{64}$/.test(result.nativeSha256) &&
    result.nativeSha256 === result.canvasSha256;
  const frameEvidence =
    frame &&
    result &&
    frame.tic === result.tic &&
    frame.nativeSha256 === result.nativeSha256 &&
    frame.canvasSha256 === result.canvasSha256
      ? 'Current frame verified'
      : frame
        ? 'Resulting frame verified · Not the displayed frame'
        : 'Resulting frame verified · Displayed frame unavailable';

  let evidence =
    entry.status === 'Complete'
      ? 'Completion evidence unavailable'
      : entry.action && entry.status === 'Requesting one action'
        ? 'Choice received; checking unchanged game state'
        : entry.status;
  if (
    entry.status === 'Complete' &&
    entry.action &&
    execution?.complete &&
    !execution.terminal &&
    execution.assessment?.kind === 'alive' &&
    verified === entry.selectedTics &&
    verifiedResult
  ) {
    evidence = `${verified} ${verified === 1 ? 'tic' : 'tics'} completed · ${frameEvidence}`;
  } else if (
    entry.action &&
    accounting &&
    execution.terminal &&
    !execution.complete &&
    execution.assessment?.kind === 'terminal' &&
    (execution.assessment.dead || execution.assessment.exitPending)
  ) {
    const terminal = [
      execution.assessment.dead ? 'Player death verified' : '',
      execution.assessment.exitPending ? 'E1M1 exit pending' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const resultingFrame = verifiedResult
      ? frameEvidence
      : entry.status === 'Terminal tic verified; rendering'
        ? 'Verifying resulting frame'
        : 'Resulting frame unavailable';
    evidence = `${terminal} · ${verified} of ${entry.selectedTics} tics verified · ${resultingFrame}. Reload to restart.`;
  } else if (
    execution?.completionUncertain &&
    entry.status !== 'Stepping and verifying'
  ) {
    evidence += ` · At least ${verified} tics verified (lower bound; native completion uncertain)`;
  }

  return {
    number: `#${entry.number}`,
    action: entry.action
      ? entry.action[0].toUpperCase() +
        entry.action.slice(1).replaceAll('_', ' ')
      : entry.status === 'Capturing current frame' ||
          entry.status === 'Requesting one action'
        ? 'Action pending'
        : 'Action unavailable',
    evidence,
  };
}
