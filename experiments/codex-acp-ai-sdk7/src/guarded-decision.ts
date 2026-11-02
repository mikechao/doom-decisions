import { isDeepStrictEqual as same } from 'node:util';
import { z } from 'zod';
import type { AgentOperation, ConfigResult, MaterializedDecision, MaterializedObserve, PromptResult } from '../../../scripts/doom-agent-client.ts';
import { maxAgentInstructions, parseAgentObserveResult, type AgentObserveResult, type AgentRunState } from '../../../app/src/agent-control.ts';
import type { AgentDecisionResult } from '../../../app/src/agent-observation.ts';
import type { Envelope } from './agent-stream.ts';
import { configResult, liveDecision, liveObserve, parseLease, promptResult, requireLive, type Lease, type ReadPng } from './live-observation.ts';

type Input<Op extends AgentOperation['op']> = Omit<Extract<AgentOperation, { op: Op }>, 'op'>;
export type DecisionPorts = {
  startRun(input: Input<'start-run'>, signal: AbortSignal): Promise<ConfigResult>;
  setPrompt(input: Input<'set-prompt'>, signal: AbortSignal): Promise<PromptResult>;
  observe(leaseFile: string, signal: AbortSignal): Promise<MaterializedObserve>;
  decide(input: Required<Input<'decide'>>, signal: AbortSignal): Promise<MaterializedDecision>;
  getConfig(input: { leaseFile: string; sessionId: string }, signal: AbortSignal): Promise<ConfigResult>;
  readPng: ReadPng;
  // Synchronous owned-file allocation avoids an unowned late file after cancellation.
  instructions(text: string): { path: string; remove(): void };
};
// Content is opaque advisory prompt data; gameplay authority stays in typed ports.
const advisoryText = z.string().trim().min(1).max(600);
export const decisionGuidance = z.strictObject({ objective: advisoryText, uncertainty: advisoryText });
export function composeDecisionGuidance(base: string, input: unknown) {
  const guidance = decisionGuidance.parse(input);
  requireLive(base.includes('{{tics}}'));
  // The controller interpolates literal markers globally. JSON Unicode escapes
  // preserve advisory values without exposing their markers to interpolation.
  const advisory = JSON.stringify(guidance).replace(/\{\{tics\}\}/g, '\\u007b\\u007btics\\u007d\\u007d');
  const text = `${base}\n\nAdvisory navigation interpretation (unverified): ${advisory}\nAssess this objective using current verified evidence. Decisions retains all low-level action selection. This advice proves no route or passability.`;
  requireLive(text.length <= maxAgentInstructions);
  return text;
}
export type ActionEvidence = Omit<AgentDecisionResult, 'observation'> & {
  before: { observationId: string; sessionId: string; mapKey: string; tic: number };
  after: { observationId: string; sessionId: string; mapKey: string; tic: number; phase: string } | null;
};
export type DecisionFeedback = {
  status: 'rejected' | 'uncertain' | 'receipt'; error: string | null; consumed: boolean;
  receipt: ActionEvidence | null; accounting: 'not-read' | 'exhausted' | 'unavailable' | 'mismatch';
};
export function decisionLedger() {
  return {
    attempted: 0, accepted: 0, rejected: 0, consumed: false, dispatchConsumed: false,
    guidance: null as z.infer<typeof decisionGuidance> | null,
    claim: 'not-attempted' as 'not-attempted' | 'unknown' | 'acknowledged',
    allowance: null as AgentRunState | null,
    promptCAS: 'not-attempted' as 'not-attempted' | 'unknown' | 'acknowledged',
    observation: null as string | null,
    scope: null as { sessionId: string; runId: string; revision: number } | null,
    dispatch: 'not-attempted' as 'not-attempted' | 'unknown' | 'validated-receipt',
    receipt: null as ActionEvidence | null,
    accounting: 'not-read' as DecisionFeedback['accounting'],
    finalRun: null as AgentRunState | null,
    fileCleanup: 'not-created' as 'not-created' | 'pending' | 'removed' | 'failed',
    calls: [] as { feedback: DecisionFeedback; envelope: Envelope }[],
  };
}
export type DecisionLedger = ReturnType<typeof decisionLedger>;
function unused(run: AgentRunState | null, runId?: string): asserts run is AgentRunState {
  requireLive(run && (!runId || run.runId === runId) && run.active === true &&
    run.limit === 1 && run.reserved === 0 && run.sdkInvoked === 0 && run.remaining === 1);
}

// Only this callback dispatches gameplay protocol operations. No supervisor workflow.
export function createGuardedDecision(authorized: boolean, leaseInput: Lease, initial: AgentObserveResult,
  ports: DecisionPorts, ledger: DecisionLedger, signal: AbortSignal) {
  const lease = structuredClone(leaseInput), before = structuredClone(initial);
  // Private closure latches cannot be reset by mutable reporting data or SDK steps.
  let consumed = false, dispatched = false;
  let fileCleanupSettled = Promise.resolve();
  async function fenced<T>(work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    let cancel = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(new Error('CANCELLED'));
      signal.addEventListener('abort', cancel, { once: true });
    });
    try { const value = await Promise.race([work(), cancelled]); signal.throwIfAborted(); return value; }
    finally { signal.removeEventListener('abort', cancel); }
  }
  return {
    // Host-only finalizer: fenced awaits reject on abort even if transport never settles.
    settleFileCleanup: () => fileCleanupSettled,
    description: 'Request the single host-authorized Doom decision with advisory objective and uncertainty text, including explicit action, direction, duration or tactic recommendations. Text cannot override Decisions API action selection or controller tics, budget or run admission. Never retry, including after an uncertain result.',
    inputSchema: decisionGuidance,
    execute: async (input: unknown): Promise<Envelope> => {
      ledger.attempted++;
      let stage = 'INPUT_REJECTED';
      let file: ReturnType<DecisionPorts['instructions']> | undefined;
      let finishFileCleanup = () => {};
      let feedback: DecisionFeedback;
      try {
        if (!authorized) throw new Error('UNAUTHORIZED');
        signal.throwIfAborted();
        if (consumed) { stage = 'ALREADY_CONSUMED'; throw new Error(stage); }
        const guidance = composeDecisionGuidance(before.configuration.instructionTemplate, input);
        stage = 'BOOTSTRAP_UNVERIFIED';
        parseLease(lease);
        requireLive(before.run === null && before.phase === 'ready' && before.configuration.tics === 6);
        // Bootstrap has already passed liveObserve; validate again before claim.
        parseAgentObserveResult(before);
        signal.throwIfAborted();
        consumed = true; ledger.consumed = true; ledger.accepted++;
        fileCleanupSettled = new Promise<void>(resolve => { finishFileCleanup = resolve; });
        ledger.guidance = decisionGuidance.parse(input);
        stage = 'CLAIM_UNVERIFIED';
        file = ports.instructions(guidance);
        ledger.fileCleanup = 'pending';
        signal.throwIfAborted();
        ledger.claim = 'unknown'; // Before transport; a lost response is never "no action".
        const started = configResult(await fenced(() => ports.startRun({ leaseFile: lease.leaseFile,
          observationId: before.observationId, sessionId: before.sessionId, revision: before.revision }, signal)), lease);
        requireLive(!('error' in started));
        requireLive(started.sessionId === before.sessionId && started.revision === before.revision && same(started.configuration, before.configuration));
        ledger.allowance = structuredClone(started.run);
        ledger.claim = 'acknowledged';
        unused(started.run);
        const runId = started.run.runId;
        stage = 'CAS_UNVERIFIED';
        ledger.promptCAS = 'unknown';
        const changed = promptResult(await fenced(() => ports.setPrompt({ leaseFile: lease.leaseFile,
          sessionId: before.sessionId, runId, revision: before.revision, instructionsFile: file!.path }, signal)), lease);
        requireLive(!('error' in changed));
        requireLive(changed.sessionId === before.sessionId && changed.revision === before.revision + 1 && changed.instructions === guidance);
        unused(changed.run, runId);
        ledger.promptCAS = 'acknowledged';
        stage = 'OBSERVATION_UNVERIFIED';
        const raw = await fenced(() => ports.observe(lease.leaseFile, signal));
        const { observation: ready } = await fenced(() => liveObserve(raw, lease, ports.readPng, signal));
        requireLive(ready.observationId !== before.observationId && ready.sessionId === before.sessionId &&
          same(ready.mapIdentity, before.mapIdentity) && ready.tic === before.tic && same(ready.frame, before.frame) &&
          same(ready.telemetry, before.telemetry) && same(ready.facingProbe, before.facingProbe) && same(ready.previousAction, before.previousAction) &&
          ready.counters.gametic === before.counters.gametic && ready.counters.leveltime === before.counters.leveltime &&
          ready.revision === changed.revision && same(ready.configuration, { ...before.configuration, instructionTemplate: guidance }));
        unused(ready.run, runId);
        ledger.observation = ready.observationId;
        const scope = { sessionId: ready.sessionId, runId, revision: ready.revision };
        ledger.scope = scope;
        stage = 'DECISION_UNVERIFIED';
        signal.throwIfAborted();
        requireLive(!dispatched);
        dispatched = true; ledger.dispatchConsumed = true; ledger.dispatch = 'unknown';
        const decision = await fenced(() => ports.decide({ leaseFile: lease.leaseFile, observationId: ready.observationId, scope }, signal));
        const { receipt } = await fenced(() => liveDecision(decision, lease, ready, ports.readPng, signal));
        // Receipt has no run/revision properties: correlate scope via the sent
        // command and independent accounting, never fabricate DTO fields.
        requireLive(receipt.requestedTics === null || receipt.requestedTics === ready.configuration.tics);
        requireLive(receipt.reportedTics === null || (receipt.requestedTics !== null && receipt.reportedTics <= receipt.requestedTics));
        requireLive(receipt.verifiedTics === null || (receipt.requestedTics !== null && receipt.verifiedTics <= receipt.requestedTics &&
          receipt.cumulativeTics === ready.tic + receipt.verifiedTics));
        if (receipt.outcome === 'completed' || receipt.outcome === 'terminal') requireLive(receipt.reason === null);
        if (receipt.observation) requireLive(same(receipt.observation.mapIdentity, ready.mapIdentity));
        const { observation: after, ...facts } = receipt;
        ledger.receipt = { ...facts, before: { observationId: ready.observationId, sessionId: ready.sessionId, mapKey: ready.mapIdentity.mapKey, tic: ready.tic }, after: after ? { observationId: after.observationId, sessionId: after.sessionId,
          mapKey: after.mapIdentity.mapKey, tic: after.tic, phase: after.phase } : null };
        ledger.dispatch = 'validated-receipt';
        ledger.accounting = 'unavailable';
        if (receipt.outcome === 'completed') {
          stage = 'ACCOUNTING_UNAVAILABLE';
          const final = configResult(await fenced(() => ports.getConfig({ leaseFile: lease.leaseFile, sessionId: ready.sessionId }, signal)), lease);
          stage = 'ACCOUNTING_MISMATCH'; ledger.accounting = 'mismatch';
          requireLive(!('error' in final));
          ledger.finalRun = structuredClone(final.run);
          requireLive(final.sessionId === ready.sessionId && final.revision === ready.revision && same(final.configuration, ready.configuration) &&
            same(final.run, { runId, active: false, limit: 1, reserved: 1, sdkInvoked: 1, remaining: 0 }));
          ledger.accounting = 'exhausted';
        }
        feedback = { status: 'receipt', error: null, consumed, receipt: ledger.receipt, accounting: ledger.accounting };
      } catch {
        if (!consumed || stage === 'ALREADY_CONSUMED') ledger.rejected++;
        feedback = { status: stage === 'ALREADY_CONSUMED' ? 'rejected' : ledger.receipt ? 'receipt' : consumed ? 'uncertain' : 'rejected',
          error: signal.aborted ? 'CANCELLED' : !authorized ? 'UNAUTHORIZED' : stage,
          consumed, receipt: ledger.receipt, accounting: ledger.accounting };
      } finally {
        if (file) { try { file.remove(); ledger.fileCleanup = 'removed'; } catch { ledger.fileCleanup = 'failed'; } }
        finishFileCleanup();
      }
      const envelope: Envelope = { content: [{ type: 'text', text: JSON.stringify(feedback) }] };
      ledger.calls.push(structuredClone({ feedback, envelope }));
      return envelope;
    },
  };
}
