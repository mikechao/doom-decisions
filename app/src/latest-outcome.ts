import type { ActionName, Execution } from './decision';
import type { DecisionDiagnostics } from './decision-provider';
import type { DecisionStage } from './session-controller';

const integer = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

// Recompute from current records so lifecycle updates never accumulate twice.
export function projectSessionMetrics(
  entries: readonly Readonly<
    Partial<
      Pick<DecisionDiagnostics, 'responseMetadata' | 'latencyMs' | 'sdkInvoked'>
    >
  >[],
) {
  let inputTotal: number | null = null;
  let missingInput = false;
  let latencyTotal = 0;
  let latencyCount = 0;
  for (const entry of entries) {
    const input = entry.responseMetadata?.usage?.input;
    if (
      typeof input === 'number' &&
      Number.isSafeInteger(input) &&
      input >= 0
    ) {
      inputTotal = (inputTotal ?? 0) + input;
    } else if (entry.sdkInvoked === true) {
      missingInput = true;
    }
    const latency = entry.latencyMs;
    if (
      typeof latency === 'number' &&
      Number.isFinite(latency) &&
      latency >= 0
    ) {
      latencyTotal += latency;
      latencyCount++;
    }
  }
  return {
    inputTokens: inputTotal === null ? '—' : integer.format(inputTotal),
    inputPartial: inputTotal !== null && missingInput,
    averageLatency: latencyCount
      ? `${integer.format(Math.round(latencyTotal / latencyCount))} ms`
      : '—',
  };
}

type Frame = Readonly<{
  tic: number;
  nativeSha256: string;
  canvasSha256: string;
}>;
type OutcomeEntry = Readonly<{
  number: number;
  selectedTics: number;
  stage: DecisionStage;
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
    entry.stage === 'completed'
      ? 'Completion evidence unavailable'
      : entry.action && entry.stage === 'requesting'
        ? 'Choice received; checking unchanged game state'
        : entry.status;
  if (
    entry.stage === 'completed' &&
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
      : entry.stage === 'rendering'
        ? 'Verifying resulting frame'
        : 'Resulting frame unavailable';
    evidence = `${terminal} · ${verified} of ${entry.selectedTics} tics verified · ${resultingFrame}. Reload to restart.`;
  } else if (execution?.completionUncertain && entry.stage !== 'stepping') {
    evidence += ` · At least ${verified} tics verified (lower bound; native completion uncertain)`;
  }

  return {
    number: `#${entry.number}`,
    action: entry.action
      ? entry.action[0].toUpperCase() +
        entry.action.slice(1).replaceAll('_', ' ')
      : entry.stage === 'capturing' || entry.stage === 'requesting'
        ? 'Action pending'
        : 'Action unavailable',
    evidence,
  };
}
