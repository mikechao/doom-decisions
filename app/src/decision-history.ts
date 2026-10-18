import type { ActionName, Execution } from './decision';
import { masks } from './decision';
import type { DecisionDiagnostics, DecisionRequest } from './decision-provider';
import type { DoomButtonElement } from './doom-button';
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
const tokenCount = new Intl.NumberFormat('en');
function tokensPending(entry: HistoryEntry) {
  return (
    entry.stage === 'requesting' &&
    entry.sdkInvoked === true &&
    !entry.responseMetadata &&
    !entry.action &&
    entry.latencyMs === null &&
    entry.http == null
  );
}
export function projectDecisionHistorySummary(entry: HistoryEntry) {
  const pending = entry.stage === 'capturing' || entry.stage === 'requesting';
  const input = entry.responseMetadata?.usage.input;
  return {
    action: entry.action ?? (pending ? 'Action pending' : 'Action unavailable'),
    latency: `API ${entry.latencyMs === null ? (pending ? 'latency pending' : 'latency unavailable') : `${entry.latencyMs} ms`}`,
    tokens:
      input != null
        ? `Input ${tokenCount.format(input)} tokens`
        : tokensPending(entry)
          ? 'Input tokens pending'
          : 'Input tokens unavailable',
    status: decisionStatus(entry),
  };
}
function createHistoryRow(number: number, inspect: (number: number) => void) {
  const item = document.createElement('li');
  item.id = `decision-${number}`;
  item.value = number;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'decision-row';
  button.setAttribute('aria-controls', 'decision-detail');
  button.addEventListener('click', () => inspect(number));
  const heading = document.createElement('span');
  heading.className = 'decision-heading';
  const decisionNumber = document.createElement('span');
  decisionNumber.className = 'decision-number';
  decisionNumber.textContent = `#${number}`;
  const action = document.createElement('span');
  action.className = 'decision-action';
  heading.append(decisionNumber, action);
  const metrics = document.createElement('span');
  metrics.className = 'decision-metrics';
  const status = document.createElement('span');
  status.className = 'decision-status';
  button.append(heading, status, metrics);
  item.append(button);
  return { item, button, action, metrics, status };
}
function createProbabilities(probabilities: HTMLUListElement) {
  return actionNames.map((action) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'probability-label';
    const name = document.createElement('span');
    name.textContent = action;
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
    return { action, row, selected, value, bar };
  });
}
function createDecisionHistory(
  history: HTMLOListElement,
  empty: HTMLParagraphElement,
  inspect: (number: number) => void,
) {
  // Keep focus-bearing nodes for the lifetime of each history entry.
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
      view.metrics.textContent = `${summary.latency} · ${summary.tokens}`;
      view.status.textContent = summary.status;
    }
  }
  return { displayHistory, historyRows };
}
function detailStatus(entry: HistoryEntry) {
  const execution = entry.execution;
  const verified = execution?.independentlyVerifiedTics ?? 0;
  const verifiedTics = `${verified} ${verified === 1 ? 'tic' : 'tics'}`;
  if (entry.stage === 'stepping') return 'Native verification in progress';
  if (execution?.completionUncertain)
    return `Completion uncertain · at least ${verifiedTics} verified · reload required`;
  if (entry.stage === 'completed')
    return execution?.complete &&
      entry.result &&
      execution.requestedTics === entry.selectedTics &&
      execution.reportedCompletedTics === entry.selectedTics &&
      execution.independentlyVerifiedTics === entry.selectedTics
      ? `Completed · ${verifiedTics} independently verified`
      : 'Completion evidence unavailable';
  if (execution?.complete && !entry.result)
    return `Action verified · resulting frame ${entry.stage === 'rendering' ? 'pending' : 'unavailable'}`;
  if (!execution && entry.stage === 'requesting')
    return `${entry.action ? 'Choice received' : 'Request pending'} · no native dispatch`;
  if (!execution && entry.stage === 'capturing')
    return 'Capturing request input · no native dispatch';
  // Retain controller-owned failure and terminal-prefix wording, including
  // death/exit-pending signals and frame availability, rather than infer an outcome.
  return decisionStatus(entry);
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
      private listScroll = 0;
      private rowOffset = 0;
      private renderer?: ReturnType<typeof createDecisionHistory>;
      private options?: ReturnType<typeof createProbabilities>;
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
          this.options = createProbabilities(
            this.element('#inspector-probabilities'),
          );
          this.element<DoomButtonElement>('#back-to-history').addEventListener(
            'click',
            () => this.showHistory(),
          );
          this.element('#inspector-image').addEventListener('error', () => {
            this.element('#inspector-image').hidden = true;
            this.element('#inspector-image-status').textContent =
              'Historical screenshot could not be displayed.';
          });
        }
        this.dataset.historyView = 'list';
        this.stopObserving = observeHistoryScroll(this, history);
        this.display(this.entries, this.requests);
      }

      disconnectedCallback() {
        this.stopObserving?.();
        this.stopObserving = undefined;
        this.showHistory(false);
      }

      display(
        entries: readonly HistoryEntry[],
        requests: Readonly<Record<number, DecisionRequest>>,
      ) {
        this.entries = entries;
        this.requests = requests;
        this.renderer?.displayHistory(entries);
        if (this.selected !== undefined) {
          if (entries.some((entry) => entry.number === this.selected))
            this.renderInspector();
          else this.showHistory();
        }
      }

      private inspect(number: number) {
        if (!this.entries.some((entry) => entry.number === number)) return;
        const history = this.element<HTMLOListElement>('#history');
        this.selected = number;
        this.origin = this.renderer?.historyRows.get(number)?.button;
        this.listScroll = history.scrollTop;
        this.rowOffset = this.origin
          ? this.origin.getBoundingClientRect().top -
            history.getBoundingClientRect().top
          : 0;
        for (const [key, row] of this.renderer?.historyRows ?? [])
          row.item.dataset.selected = String(key === number);
        this.element<HTMLDetailsElement>('#inspector-request').open = false;
        this.element<HTMLDetailsElement>('#inspector-technical').open = false;
        this.renderInspector();
        this.element('#history-list-view').hidden = true;
        this.element('#decision-detail').hidden = false;
        this.dataset.historyView = 'detail';
        this.dataset.historyMore = 'false';
        this.element('#detail-scroll').scrollTop = 0;
        this.element('#inspector-title').focus();
      }

      private showHistory(restoreFocus = true) {
        const wasInspecting = this.selected !== undefined;
        this.selected = undefined;
        this.element('#decision-detail').hidden = true;
        this.element('#history-list-view').hidden = false;
        this.dataset.historyView = 'list';
        this.imagePng = undefined;
        this.element('#inspector-image').removeAttribute('src');
        this.element('#inspector-image').hidden = true;
        if (wasInspecting && restoreFocus) {
          const history = this.element<HTMLOListElement>('#history');
          history.scrollTop = this.listScroll;
          if (this.origin?.isConnected) {
            // Restore the row's visual offset even after newer rows were prepended.
            history.scrollTop +=
              this.origin.getBoundingClientRect().top -
              history.getBoundingClientRect().top -
              this.rowOffset;
            this.origin.focus({ preventScroll: true });
          } else history.focus({ preventScroll: true });
        }
        this.origin = undefined;
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
          const node = this.element(id);
          // Keep text selection intact when presentation updates repeat a request.
          if (node.textContent !== text) node.textContent = text;
        };
        const summary = projectDecisionHistorySummary(entry);
        write('#inspector-title', `#${entry.number} · ${summary.action}`);
        write('#inspector-state', detailStatus(entry));
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
        const execution = entry.execution;
        write(
          '#inspector-duration',
          `Human-selected duration: ${entry.selectedTics} tics`,
        );
        write(
          '#inspector-execution',
          execution
            ? `Native requested: ${execution.requestedTics} · Worker-reported: ${execution.reportedCompletedTics ?? 'unknown'} · Independently verified: ${execution.independentlyVerifiedTics} tics${execution.completionUncertain ? ' (lower bound; completion uncertain)' : ''}.`
            : entry.stage === 'stepping'
              ? 'Awaiting native execution evidence.'
              : 'No native action dispatched.',
        );
        write(
          '#inspector-result',
          entry.stage === 'stepping'
            ? 'Native verification in progress; completion is not yet established.'
            : execution?.completionUncertain
              ? 'Native completion uncertain. Reload required; do not replay this action.'
              : entry.result
                ? 'Historical resulting frame verified and rendered; it may no longer be the displayed frame.'
                : execution?.complete
                  ? entry.stage === 'ended'
                    ? 'Action verified; resulting frame unavailable. Reload required.'
                    : 'Action verified; resulting frame not yet available.'
                  : 'Verified resulting frame unavailable. A returned action alone does not prove execution.',
        );
        const probabilities = this.element<HTMLUListElement>(
          '#inspector-probabilities',
        );
        // Metrics come from controller validation. Never display a partial distribution.
        const values = entry.choice?.probabilities;
        const available = values?.length === actionNames.length;
        probabilities.hidden = !available;
        this.element('#probabilities-unavailable').hidden = available;
        write(
          '#probabilities-unavailable',
          pending && !entry.choice
            ? 'Action probabilities pending.'
            : 'Action probabilities unavailable.',
        );
        if (values && available) {
          const sorted = [...values].sort(
            (a, b) =>
              b.probability - a.probability ||
              actionNames.indexOf(a.value) - actionNames.indexOf(b.value),
          );
          for (const [index, option] of sorted.entries()) {
            const node = this.options?.find(
              (item) => item.action === option.value,
            );
            if (!node) continue;
            const selected = option.value === entry.action;
            node.selected.hidden = !selected;
            node.value.textContent = probabilityText(option.probability);
            node.bar.value = option.probability;
            node.row.dataset.selected = String(selected);
            if (probabilities.children[index] !== node.row)
              probabilities.insertBefore(
                node.row,
                probabilities.children[index] ?? null,
              );
          }
        }
        const metadata = entry.responseMetadata;
        const usage = metadata?.usage;
        const usageMissing = tokensPending(entry) ? 'Pending' : 'Unavailable';
        write(
          '#inspector-provider',
          entry.requestIdentity?.provider ?? 'Unavailable',
        );
        write(
          '#inspector-model',
          entry.requestIdentity?.requestedModel ?? 'Unavailable',
        );
        write('#inspector-reported-model', metadata?.reportedModel ?? missing);
        const distinctModel =
          metadata?.reportedModel != null &&
          metadata.reportedModel !== entry.requestIdentity?.requestedModel;
        this.element('#inspector-reported-model-label').hidden = !distinctModel;
        this.element('#inspector-reported-model').hidden = !distinctModel;
        write(
          '#inspector-latency',
          entry.latencyMs === null ? missing : `${entry.latencyMs} ms`,
        );
        const inputTokens =
          usage?.input == null ? usageMissing : tokenCount.format(usage.input);
        write('#inspector-summary-input-tokens', inputTokens);
        write('#inspector-input-tokens', inputTokens);
        write(
          '#inspector-output-tokens',
          usage?.output == null
            ? usageMissing
            : tokenCount.format(usage.output),
        );
        write(
          '#inspector-confidence',
          `API confidence (separate from action probabilities): ${entry.choice?.confidence == null ? 'Unavailable' : probabilityText(entry.choice.confidence)}`,
        );
        write(
          '#inspector-diagnostics',
          [
            `Decision ${entry.number}: ${entry.status}`,
            `Stage: ${entry.stage}`,
            `Requested model${entry.sdkInvoked ? '' : ' (not invoked)'}: ${entry.requestIdentity?.requestedModel ?? 'Unavailable'}`,
            `Provider-reported model: ${metadata?.reportedModel ?? missing}`,
            `API request ID: ${entry.requestId ?? 'Unavailable'}`,
            `HTTP status: ${entry.http ?? 'Unavailable'}`,
            `Human-selected N: ${entry.selectedTics}`,
            `Native requested / reported / independently verified: ${execution?.requestedTics ?? 'not dispatched'} / ${execution?.reportedCompletedTics ?? 'unknown'} / ${execution?.independentlyVerifiedTics ?? 0}`,
            `Cumulative verified tic: ${entry.cumulativeVerifiedTics}${execution?.completionUncertain ? ' (lower bound; completion uncertain)' : ''}`,
            `Observation tic: ${entry.observation?.tic ?? 'Unavailable'} · resulting tic: ${entry.result?.tic ?? 'Unavailable'}`,
          ].join('\n'),
        );
      }
    },
  );
}
