import type { ActionName, Execution } from './decision';
import { masks } from './decision';

// Presentation reads the controller's entries without owning or mutating evidence.
type HistoryEntry = Readonly<{
  number: number;
  selectedTics: number;
  status: string;
  action: ActionName | null;
  observation: Readonly<{ tic: number }> | null;
  result: Readonly<{ tic: number }> | null;
  execution: Readonly<
    Pick<
      Execution,
      | 'complete'
      | 'requestedTics'
      | 'reportedCompletedTics'
      | 'independentlyVerifiedTics'
      | 'completionUncertain'
    >
  > | null;
  cumulativeVerifiedTics: number;
  requestId: string | null;
  latencyMs: number | null;
  choice?: Readonly<{
    confidence: number | null;
    probabilities:
      | readonly Readonly<{
          value: ActionName;
          probability: number;
        }>[]
      | null;
  }>;
}>;

const actionNames: readonly ActionName[] = Object.keys(masks) as ActionName[];
const percentage = new Intl.NumberFormat('en', {
  style: 'percent',
  maximumSignificantDigits: 4,
});
function probabilityText(value: number) {
  // Scientific notation keeps tiny positive values visible instead of showing 0%.
  return value > 0 && value < 0.000001
    ? `${(value * 100).toExponential(2)}%`
    : percentage.format(value);
}
function decisionStatus(entry: HistoryEntry) {
  if (entry.status === 'Complete') {
    return entry.execution?.complete && entry.result
      ? 'Completed · verified and rendered'
      : 'Completion evidence unavailable';
  }
  if (entry.action && entry.status === 'Requesting one action')
    return 'Choice received; checking unchanged game state';
  return entry.status;
}
function choicePending(entry: HistoryEntry) {
  return (
    entry.status === 'Capturing current frame' ||
    entry.status === 'Requesting one action'
  );
}
function createHistoryRow(number: number) {
  const item = document.createElement('li');
  item.id = `decision-${number}`;
  item.value = number;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const heading = document.createElement('span');
  heading.className = 'decision-heading';
  const decisionNumber = document.createElement('span');
  decisionNumber.className = 'decision-number';
  decisionNumber.textContent = `#${number}`;
  const action = document.createElement('span');
  action.className = 'decision-action';
  heading.append(decisionNumber, action);
  const latency = document.createElement('span');
  latency.className = 'decision-latency';
  const status = document.createElement('span');
  status.className = 'decision-status';
  summary.append(heading, latency, status);
  const content = document.createElement('div');
  content.className = 'probability-content';
  const title = document.createElement('p');
  title.className = 'probability-title';
  title.textContent = 'Action probabilities';
  const unavailable = document.createElement('p');
  unavailable.textContent = 'Action probabilities unavailable.';
  const probabilities = document.createElement('ul');
  probabilities.className = 'probabilities';
  const options = actionNames.map((action) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'probability-label';
    const name = document.createElement('span');
    const selected = document.createElement('span');
    selected.className = 'probability-selected';
    selected.textContent = 'Selected';
    selected.hidden = true;
    label.append(name, selected);
    const value = document.createElement('span');
    value.className = 'probability-value';
    const bar = document.createElement('meter');
    bar.className = 'probability-bar';
    bar.min = 0;
    bar.max = 1;
    bar.setAttribute('aria-hidden', 'true');
    row.append(label, value, bar);
    probabilities.append(row);
    return { action, row, name, selected, value, bar };
  });
  const confidence = document.createElement('p');
  confidence.className = 'decision-confidence';
  confidence.hidden = true;
  const technical = document.createElement('details');
  technical.className = 'receipt';
  const technicalSummary = document.createElement('summary');
  technicalSummary.textContent = 'Technical receipt';
  const receipt = document.createElement('pre');
  technical.append(technicalSummary, receipt);
  content.append(title, unavailable, probabilities, confidence, technical);
  details.append(summary, content);
  item.append(details);
  return {
    item,
    action,
    latency,
    status,
    unavailable,
    probabilities,
    options,
    confidence,
    receipt,
  };
}
export function createDecisionHistory(
  history: HTMLOListElement,
  empty: HTMLParagraphElement,
) {
  // Keep disclosure/focus-bearing nodes for the lifetime of each history entry.
  const historyRows = new Map<number, ReturnType<typeof createHistoryRow>>();
  function displayHistory(entries: readonly HistoryEntry[]) {
    empty.hidden = entries.length > 0;
    for (const entry of entries) {
      let view = historyRows.get(entry.number);
      if (!view) {
        view = createHistoryRow(entry.number);
        historyRows.set(entry.number, view);
        history.prepend(view.item);
      }
      const pending = choicePending(entry);
      view.action.textContent =
        entry.action ?? (pending ? 'Action pending' : 'Action unavailable');
      view.latency.textContent = `API ${entry.latencyMs === null ? (pending ? 'latency pending' : 'latency unavailable') : `${entry.latencyMs} ms`}`;
      view.status.textContent = decisionStatus(entry);
      const values = entry.choice?.probabilities;
      view.unavailable.hidden = !!values;
      view.probabilities.hidden = !values;
      if (values) {
        const sorted = [...values].sort(
          (a, b) =>
            b.probability - a.probability ||
            actionNames.indexOf(a.value) - actionNames.indexOf(b.value),
        );
        for (const [index, option] of sorted.entries()) {
          const node = view.options.find(
            (item) => item.action === option.value,
          );
          if (!node) continue;
          const selected = option.value === entry.action;
          node.name.textContent = option.value;
          node.selected.hidden = !selected;
          node.value.textContent = probabilityText(option.probability);
          node.bar.value = option.probability;
          node.row.dataset.selected = String(selected);
          if (view.probabilities.children[index] !== node.row)
            view.probabilities.insertBefore(
              node.row,
              view.probabilities.children[index] ?? null,
            );
        }
      }
      const confidence = entry.choice?.confidence;
      view.confidence.hidden = confidence === null || confidence === undefined;
      view.confidence.textContent =
        confidence === null || confidence === undefined
          ? ''
          : `API confidence: ${probabilityText(confidence)}`;
      const execution = entry.execution;
      view.receipt.textContent = [
        `Decision ${entry.number}: ${entry.status}`,
        `Action: ${entry.action ?? 'unavailable'} · human-selected N: ${entry.selectedTics}`,
        `Native requested / reported / independently verified: ${execution?.requestedTics ?? 'not dispatched'} / ${execution?.reportedCompletedTics ?? 'unknown'} / ${execution?.independentlyVerifiedTics ?? 0}`,
        `Cumulative verified tic: ${entry.cumulativeVerifiedTics}${execution?.completionUncertain ? ' (lower bound; completion uncertain)' : ''}`,
        `Observed tic: ${entry.observation?.tic ?? 'unavailable'} · resulting tic: ${entry.result?.tic ?? 'frame unavailable'}`,
        `API request ID: ${entry.requestId ?? 'unavailable'} · API latency: ${entry.latencyMs === null ? 'unavailable' : `${entry.latencyMs} ms`}`,
      ].join('\n');
    }
  }
  return displayHistory;
}
