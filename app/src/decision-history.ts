import type { ActionName, Execution } from './decision';
import { masks } from './decision';
import type { DecisionDiagnostics, DecisionRequest } from './decision-provider';
import { observeHistoryScroll } from './history-scroll';
import type { DecisionStage } from './session-controller';

// Presentation reads the controller's entries without owning or mutating evidence.
type HistoryEntry = Readonly<
  Partial<DecisionDiagnostics> & {
    number: number;
    selectedTics: number;
    stage: DecisionStage;
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
  }
>;

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
  if (entry.stage === 'completed') {
    return entry.execution?.complete && entry.result
      ? 'Completed · verified and rendered'
      : 'Completion evidence unavailable';
  }
  if (entry.action && entry.stage === 'requesting')
    return 'Choice received; checking unchanged game state';
  return entry.status;
}
export function projectDecisionHistorySummary(entry: HistoryEntry) {
  const pending = entry.stage === 'capturing' || entry.stage === 'requesting';
  return {
    action: entry.action ?? (pending ? 'Action pending' : 'Action unavailable'),
    latency: `API ${entry.latencyMs === null ? (pending ? 'latency pending' : 'latency unavailable') : `${entry.latencyMs} ms`}`,
    status: decisionStatus(entry),
  };
}
function createHistoryRow(number: number, inspect: (number: number) => void) {
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
  const inspectButton = document.createElement('button');
  inspectButton.type = 'button';
  inspectButton.className = 'inspect-decision';
  inspectButton.textContent = `Inspect decision #${number}`;
  inspectButton.setAttribute('aria-haspopup', 'dialog');
  inspectButton.setAttribute('aria-controls', 'decision-inspector');
  inspectButton.addEventListener('click', () => inspect(number));
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
  content.append(
    inspectButton,
    title,
    unavailable,
    probabilities,
    confidence,
    technical,
  );
  details.append(summary, content);
  item.append(details);
  return {
    item,
    inspectButton,
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
function createDecisionHistory(
  history: HTMLOListElement,
  empty: HTMLParagraphElement,
  inspect: (number: number) => void,
) {
  // Keep disclosure/focus-bearing nodes for the lifetime of each history entry.
  const historyRows = new Map<number, ReturnType<typeof createHistoryRow>>();
  function displayHistory(entries: readonly HistoryEntry[]) {
    empty.hidden = entries.length > 0;
    const numbers = new Set(entries.map((entry) => entry.number));
    for (const [number, row] of historyRows) {
      if (!numbers.has(number)) {
        row.item.remove();
        historyRows.delete(number);
      }
    }
    for (const entry of entries) {
      let view = historyRows.get(entry.number);
      if (!view) {
        view = createHistoryRow(entry.number, inspect);
        historyRows.set(entry.number, view);
        history.prepend(view.item);
      }
      const summary = projectDecisionHistorySummary(entry);
      view.action.textContent = summary.action;
      view.latency.textContent = summary.latency;
      view.status.textContent = summary.status;
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
  return { displayHistory, historyRows };
}

export interface DecisionHistoryElement extends HTMLElement {
  display(
    entries: readonly HistoryEntry[],
    requests: Readonly<Record<number, DecisionRequest>>,
  ): void;
}

// Registration is explicit so pure projections remain importable without a DOM.
export function defineDecisionHistory() {
  if (customElements.get('decision-history')) return;
  customElements.define(
    'decision-history',
    class extends HTMLElement implements DecisionHistoryElement {
      private entries: readonly HistoryEntry[] = [];
      private requests: Readonly<Record<number, DecisionRequest>> = {};
      private selected?: number;
      private origin?: HTMLButtonElement;
      private renderer?: ReturnType<typeof createDecisionHistory>;
      private stopObserving?: () => void;
      private imagePng?: string;

      private element<T extends HTMLElement>(selector: string): T {
        const node = this.querySelector<T>(selector);
        if (!node) throw Error(`Missing history element: ${selector}`);
        return node;
      }

      connectedCallback() {
        const history = this.element<HTMLOListElement>('#history');
        if (!this.renderer) {
          this.renderer = createDecisionHistory(
            history,
            this.element('#history-empty'),
            (number) => this.inspect(number),
          );
          const dialog = this.element<HTMLDialogElement>('#decision-inspector');
          this.element('#close-inspector').addEventListener('click', () =>
            dialog.close(),
          );
          dialog.addEventListener('close', () => {
            this.selected = undefined;
            this.imagePng = undefined;
            this.element('#inspector-image').removeAttribute('src');
            this.element('#inspector-image').hidden = true;
            if (this.origin?.isConnected)
              this.origin.focus({ preventScroll: true });
            this.origin = undefined;
          });
          this.element('#inspector-image').addEventListener('error', () => {
            this.element('#inspector-image').hidden = true;
            this.element('#inspector-image-status').textContent =
              'Historical screenshot could not be displayed.';
          });
        }
        this.stopObserving = observeHistoryScroll(this, history);
        this.display(this.entries, this.requests);
      }

      disconnectedCallback() {
        this.stopObserving?.();
        this.stopObserving = undefined;
        const dialog = this.element<HTMLDialogElement>('#decision-inspector');
        if (dialog.open) dialog.close();
      }

      display(
        entries: readonly HistoryEntry[],
        requests: Readonly<Record<number, DecisionRequest>>,
      ) {
        this.entries = entries;
        this.requests = requests;
        this.renderer?.displayHistory(entries);
        const dialog = this.element<HTMLDialogElement>('#decision-inspector');
        if (dialog.open) {
          if (entries.some((entry) => entry.number === this.selected))
            this.renderInspector();
          else dialog.close();
        }
      }

      private inspect(number: number) {
        if (!this.entries.some((entry) => entry.number === number)) return;
        this.selected = number;
        this.origin = this.renderer?.historyRows.get(number)?.inspectButton;
        this.renderInspector();
        const dialog = this.element<HTMLDialogElement>('#decision-inspector');
        if (!dialog.open) dialog.showModal();
        this.element('#close-inspector').focus();
      }

      private renderInspector() {
        const entry = this.entries.find(
          (entry) => entry.number === this.selected,
        );
        if (!entry) return;
        const request = this.requests[entry.number];
        const pending =
          entry.stage === 'capturing' || entry.stage === 'requesting';
        const missing = pending ? 'Pending' : 'Unavailable';
        const write = (id: string, text: string) => {
          this.element(id).textContent = text;
        };
        write('#inspector-title', `Decision #${entry.number}`);
        write(
          '#inspector-state',
          `${decisionStatus(entry)} · stage: ${entry.stage}`,
        );
        write(
          '#inspector-request-state',
          entry.sdkInvoked
            ? 'SDK invocation attempted.'
            : request
              ? 'Request prepared; SDK invocation not attempted.'
              : `Request ${pending ? 'not yet prepared' : 'unavailable'}; SDK invocation not attempted.`,
        );
        write('#inspector-instructions', request?.instructions ?? missing);
        write('#inspector-context', request?.context ?? missing);
        write(
          '#inspector-actions',
          request?.permittedActions.join('\n') ?? missing,
        );
        const png = request?.png;
        if (png !== this.imagePng) {
          this.imagePng = png;
          const image = this.element<HTMLImageElement>('#inspector-image');
          const valid = !!png?.startsWith('data:image/png;base64,');
          image.hidden = !valid;
          if (valid) image.setAttribute('src', png);
          else image.removeAttribute('src');
          write(
            '#inspector-image-status',
            valid
              ? 'Historical request screenshot · 640 × 400'
              : `Screenshot: ${missing}`,
          );
        } else if (!png)
          write('#inspector-image-status', `Screenshot: ${missing}`);
        const metadata = entry.responseMetadata;
        const usage = metadata?.usage;
        write(
          '#inspector-diagnostics',
          [
            `Provider: ${entry.requestIdentity?.provider ?? 'Unavailable'}`,
            `Requested model${entry.sdkInvoked ? '' : ' (not invoked)'}: ${entry.requestIdentity?.requestedModel ?? 'Unavailable'}`,
            `Provider-reported model: ${metadata?.reportedModel ?? 'Unavailable'}`,
            `API latency: ${entry.latencyMs === null ? missing : `${entry.latencyMs} ms`}`,
            `API request ID: ${entry.requestId ?? 'Unavailable'}`,
            `HTTP status: ${entry.http ?? 'Unavailable'}`,
            `Human-selected N: ${entry.selectedTics}`,
            `Observation tic: ${entry.observation?.tic ?? 'Unavailable'} · resulting tic: ${entry.result?.tic ?? 'Unavailable'}`,
          ].join('\n'),
        );
        write(
          '#inspector-usage',
          [
            !usage ||
            [usage.input, usage.output, usage.total].every(
              (count) => count === null,
            )
              ? pending && entry.sdkInvoked && !metadata
                ? 'Token usage pending'
                : 'Token usage unavailable'
              : 'Provider-reported token usage',
            `Input / prompt tokens: ${usage?.input ?? 'Unavailable'}`,
            `Output / completion tokens: ${usage?.output ?? 'Unavailable'}`,
            `Reported total tokens: ${usage?.total ?? 'Unavailable'}`,
          ].join('\n'),
        );
        write(
          '#inspector-answer',
          [
            `Chosen action: ${entry.action ?? missing}`,
            `API confidence: ${entry.choice?.confidence == null ? 'Unavailable' : probabilityText(entry.choice.confidence)}`,
            'Validated action probabilities:',
            ...(entry.choice?.probabilities?.map(
              (option) =>
                `${option.value}: ${probabilityText(option.probability)}${option.value === entry.action ? ' · Selected' : ''}`,
            ) ?? [missing]),
          ].join('\n'),
        );
      }
    },
  );
}
