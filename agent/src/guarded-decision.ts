import { isDeepStrictEqual as same } from 'node:util';
import { z } from 'zod';
import type { ConsolaInstance } from 'consola/basic';
import type { AgentOperation, ConfigResult, MaterializedDecision, MaterializedObserve, PromptResult } from '../../scripts/doom-agent-client.ts';
import { maxAgentInstructions, parseAgentObserveResult, type AgentObserveResult, type AgentRunState } from '../../app/src/agent-control.ts';
import type { AgentDecisionResult } from '../../app/src/agent-observation.ts';
import type { Envelope } from './agent-stream.ts';
import { configResult, liveDecision, liveObserve, parseLease, promptResult, requireLive, type Lease, type ReadPng } from './live-observation.ts';
import { displayGuidance } from './operator-console.ts';

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
  receipt: ActionEvidence | null; accounting: 'not-read' | 'remaining' | 'exhausted' | 'unavailable' | 'mismatch';
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
function checkpoint(run: AgentRunState | null, limit: 1 | 2, used: number, runId?: string): asserts run is AgentRunState {
  requireLive(run && (!runId || run.runId === runId) && run.active === true &&
    run.limit === limit && run.reserved === used && run.sdkInvoked === used && run.remaining === limit - used);
}

// Only this callback dispatches gameplay protocol operations. No supervisor workflow.
export function createGuardedDecision(authorized: boolean, leaseInput: Lease, initial: AgentObserveResult,
  ports: DecisionPorts, ledger: DecisionLedger, signal: AbortSignal, log?: ConsolaInstance,
  slot?: { limit: 2; used: 0 | 1; runId?: string; base: string; seen: Set<string> }) {
  const lease = structuredClone(leaseInput), before = structuredClone(initial);
  // Private closure latches cannot be reset by mutable reporting data or SDK steps.
  let consumed = false, dispatched = false;
  const limit = slot?.limit ?? 1, used = slot?.used ?? 0;
  let verified: { observation: AgentObserveResult; image: Buffer; payload: NonNullable<Awaited<ReturnType<typeof liveDecision>>['payload']> } | null = null;
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
    verifiedCheckpoint: () => verified,
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
        const guidance = composeDecisionGuidance(slot?.base ?? before.configuration.instructionTemplate, input);
        stage = 'BOOTSTRAP_UNVERIFIED';
        parseLease(lease);
        requireLive(before.phase === 'ready' && before.configuration.tics === 6);
        if (used === 0) requireLive(before.run === null);
        else checkpoint(before.run, limit, used, slot?.runId);
        // Bootstrap has already passed liveObserve; validate again before claim.
        parseAgentObserveResult(before);
        signal.throwIfAborted();
        consumed = true; ledger.consumed = true; ledger.accepted++;
        fileCleanupSettled = new Promise<void>(resolve => { finishFileCleanup = resolve; });
        ledger.guidance = decisionGuidance.parse(input);
        log?.info('Guarded invocation admitted; navigation text validated');
        log?.info(`Current navigation objective:${displayGuidance(ledger.guidance.objective)}`);
        log?.info(`Proposed gameplay guidance (advisory):\n  Objective:${displayGuidance(ledger.guidance.objective)}\n  Uncertainty:${displayGuidance(ledger.guidance.uncertainty)}`);
        stage = 'CLAIM_UNVERIFIED';
        file = ports.instructions(guidance);
        ledger.fileCleanup = 'pending';
        signal.throwIfAborted();
        if (used === 0) ledger.claim = 'unknown'; // Lost claim is never replayed.
        const started = used === 0 ? configResult(await fenced(() => ports.startRun({ leaseFile: lease.leaseFile,
          observationId: before.observationId, sessionId: before.sessionId, revision: before.revision }, signal)), lease)
          : { sessionId: before.sessionId, revision: before.revision, configuration: before.configuration, run: before.run };
        requireLive(!('error' in started));
        requireLive(started.sessionId === before.sessionId && started.revision === before.revision && same(started.configuration, before.configuration));
        ledger.allowance = structuredClone(started.run);
        if (used === 0) ledger.claim = 'acknowledged';
        checkpoint(started.run, limit, used, slot?.runId);
        log?.info(`Decision ${started.run.reserved + 1} of ${started.run.limit}; run allowance acknowledged`);
        const runId = started.run.runId;
        stage = 'CAS_UNVERIFIED';
        ledger.promptCAS = 'unknown';
        const changed = promptResult(await fenced(() => ports.setPrompt({ leaseFile: lease.leaseFile,
          sessionId: before.sessionId, runId, revision: before.revision, instructionsFile: file!.path }, signal)), lease);
        requireLive(!('error' in changed));
        requireLive(changed.sessionId === before.sessionId && changed.revision === before.revision + 1 && changed.instructions === guidance);
        checkpoint(changed.run, limit, used, runId);
        ledger.promptCAS = 'acknowledged';
        log?.info(`Applied gameplay guidance (CAS revision ${changed.revision}; scoped advisory only):\n  Objective:${displayGuidance(ledger.guidance.objective)}\n  Uncertainty:${displayGuidance(ledger.guidance.uncertainty)}`);
        stage = 'OBSERVATION_UNVERIFIED';
        const raw = await fenced(() => ports.observe(lease.leaseFile, signal));
        const { observation: ready } = await fenced(() => liveObserve(raw, lease, ports.readPng, signal));
        requireLive(ready.observationId !== before.observationId && ready.sessionId === before.sessionId &&
          same(ready.mapIdentity, before.mapIdentity) && ready.tic === before.tic && same(ready.frame, before.frame) &&
          same(ready.telemetry, before.telemetry) && same(ready.facingProbe, before.facingProbe) && same(ready.previousAction, before.previousAction) &&
          ready.counters.gametic === before.counters.gametic && ready.counters.leveltime === before.counters.leveltime &&
          ready.revision === changed.revision && same(ready.configuration, { ...before.configuration, instructionTemplate: guidance }));
        checkpoint(ready.run, limit, used, runId);
        if (slot) { requireLive(!slot.seen.has(ready.observationId)); slot.seen.add(ready.observationId); }
        ledger.observation = ready.observationId;
        const scope = { sessionId: ready.sessionId, runId, revision: ready.revision };
        ledger.scope = scope;
        log?.info('Fresh observation verified after guidance CAS');
        stage = 'DECISION_UNVERIFIED';
        signal.throwIfAborted();
        requireLive(!dispatched);
        dispatched = true; ledger.dispatchConsumed = true; ledger.dispatch = 'unknown';
        log?.info('Submitting guarded controller decision request; provider dispatch not yet known');
        const decision = await fenced(() => ports.decide({ leaseFile: lease.leaseFile, observationId: ready.observationId, scope }, signal));
        const { receipt, image, payload } = await fenced(() => liveDecision(decision, lease, ready, ports.readPng, signal));
        // Receipt has no run/revision properties: correlate scope via the sent
        // command and independent accounting, never fabricate DTO fields.
        requireLive(receipt.requestedTics === null || receipt.requestedTics === ready.configuration.tics);
        requireLive(receipt.reportedTics === null || (receipt.requestedTics !== null && receipt.reportedTics <= receipt.requestedTics));
        requireLive(receipt.verifiedTics === null || (receipt.requestedTics !== null && receipt.verifiedTics <= receipt.requestedTics &&
          receipt.cumulativeTics === ready.tic + receipt.verifiedTics));
        if (receipt.outcome === 'completed' || receipt.outcome === 'terminal') requireLive(receipt.reason === null);
        if (receipt.observation) {
          requireLive(same(receipt.observation.mapIdentity, ready.mapIdentity));
          if (slot) { requireLive(!slot.seen.has(receipt.observation.observationId)); slot.seen.add(receipt.observation.observationId); }
        }
        const { observation: after, ...facts } = receipt;
        ledger.receipt = { ...facts, before: { observationId: ready.observationId, sessionId: ready.sessionId, mapKey: ready.mapIdentity.mapKey, tic: ready.tic }, after: after ? { observationId: after.observationId, sessionId: after.sessionId,
          mapKey: after.mapIdentity.mapKey, tic: after.tic, phase: after.phase } : null };
        ledger.dispatch = 'validated-receipt';
        log?.info(`Controller receipt validated: ${receipt.outcome}; SDK invoked: ${receipt.sdkInvoked}`);
        if ((receipt.outcome === 'completed' || receipt.outcome === 'terminal') && !receipt.completionUncertain &&
            receipt.action !== null && receipt.verifiedTics !== null && after)
          log?.info(`Verified action: ${receipt.action}, ${receipt.verifiedTics} tics (tic ${ready.tic} → ${after.tic})`);
        else log?.warn('No fully verified action completion; inspect receipt outcome and uncertainty');
        ledger.accounting = 'unavailable';
        if (receipt.outcome === 'completed') {
          stage = 'ACCOUNTING_UNAVAILABLE';
          const final = configResult(await fenced(() => ports.getConfig({ leaseFile: lease.leaseFile, sessionId: ready.sessionId }, signal)), lease);
          stage = 'ACCOUNTING_MISMATCH'; ledger.accounting = 'mismatch';
          requireLive(!('error' in final));
          ledger.finalRun = structuredClone(final.run);
          requireLive(final.run && final.sessionId === ready.sessionId && final.revision === ready.revision && same(final.configuration, ready.configuration) &&
            same(final.run, { runId, active: used + 1 < limit, limit, reserved: used + 1, sdkInvoked: used + 1, remaining: limit - used - 1 }));
          ledger.accounting = used + 1 === limit ? 'exhausted' : 'remaining';
          if (!receipt.completionUncertain && receipt.sdkInvoked && receipt.action !== null &&
              receipt.verifiedTics === ready.configuration.tics && after?.phase === 'ready' && image && payload)
            verified = { observation: { ...after, configuration: ready.configuration, revision: ready.revision, run: final.run }, image, payload };
          log?.info(`Budget verified: ${final.run.sdkInvoked} SDK attempt used / ${final.run.limit} total; reserved=${final.run.reserved}, remaining=${final.run.remaining}`);
        } else log?.warn('Final budget accounting unavailable for this receipt outcome');
        feedback = { status: 'receipt', error: null, consumed, receipt: ledger.receipt, accounting: ledger.accounting };
      } catch {
        if (!consumed || stage === 'ALREADY_CONSUMED') ledger.rejected++;
        feedback = { status: stage === 'ALREADY_CONSUMED' ? 'rejected' : ledger.receipt ? 'receipt' : consumed ? 'uncertain' : 'rejected',
          error: signal.aborted ? 'CANCELLED' : !authorized ? 'UNAUTHORIZED' : stage,
          consumed, receipt: ledger.receipt, accounting: ledger.accounting };
        log?.warn(`Guarded decision feedback: ${feedback.status}; ${feedback.error}`);
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

// Exactly two fixed slots. Slot 1's private latches are never reset or reused.
// Image/state stay private; the report retains only the original structured results.
export function createTwoGuardedDecisions(lease: Lease, initial: AgentObserveResult, ports: DecisionPorts,
  first: DecisionLedger, second: DecisionLedger, signal: AbortSignal, log?: ConsolaInstance) {
  const base = initial.configuration.instructionTemplate;
  const seen = new Set([initial.observationId]);
  const one = createGuardedDecision(true, lease, initial, ports, first, signal, log, { limit: 2, used: 0, base, seen });
  let two: ReturnType<typeof createGuardedDecision> | undefined;
  let invoked = false, secondInvoked = false, busy = false;
  const secondReady = () => !busy && !secondInvoked && !!two && !signal.aborted;
  return {
    description: 'Request the next of exactly two host-authorized guarded Doom decisions. Use the verified resulting image and state from decision 1 before requesting decision 2. Never retry a failure or request a third decision. Guidance is advisory; Decisions selects the action.',
    inputSchema: decisionGuidance,
    secondReady,
    settleFileCleanup: async () => { await one.settleFileCleanup(); await two?.settleFileCleanup(); },
    project: (output: unknown) => {
      const checkpoint = one.verifiedCheckpoint();
      if (two && checkpoint && same(output, first.calls[0]?.feedback)) return {
        type: 'content' as const, value: [
          { type: 'text' as const, text: JSON.stringify({ feedback: output, state: checkpoint.payload }) },
          { type: 'file' as const, mediaType: 'image/png', data: { type: 'data' as const, data: checkpoint.image.toString('base64') } },
        ],
      };
      return { type: 'json' as const, value: output as import('@ai-sdk/provider').JSONValue };
    },
    execute: async (input: unknown): Promise<Envelope> => {
      if (busy || (invoked && !secondReady())) throw new Error('REPEATED_OR_OVERLAPPING_HOST_CALL');
      busy = true;
      try {
        if (!invoked) {
          invoked = true;
          const result = await one.execute(input);
          const checkpoint = one.verifiedCheckpoint();
          if (checkpoint && first.calls[0]?.feedback.error === null && first.fileCleanup === 'removed') {
            two = createGuardedDecision(true, lease, checkpoint.observation, ports, second, signal, log,
              { limit: 2, used: 1, base, seen, runId: checkpoint.observation.run!.runId });
          }
          return result;
        }
        secondInvoked = true;
        return await two!.execute(input);
      } finally { busy = false; }
    },
  };
}
