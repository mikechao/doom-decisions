import type { ActionName, Attempt, Execution, Phase } from './decision';
import {
  agentRunLimit,
  parseAgentConfiguration,
  validAgentInstructions,
  validAgentLimit,
  validAgentTics,
  type AgentConfiguration,
  type AgentConfigResult,
  type AgentObserveResult,
  type AgentRunState,
  type AgentScope,
  type AgentPromptResult,
} from './agent-control.ts';
import {
  agentPngBytes,
  isAgentId,
  type AgentDecisionResult,
  type AgentObservation,
} from './agent-observation.ts';
import {
  admitDecision,
  assertDecision,
  DecisionFailure,
  DecisionStopped,
  masks,
  validateChoice,
  verifyAction,
} from './decision';
import {
  buildDefaultDecisionRequest,
  type DecisionConfiguration,
} from './decision-request.ts';
import { type FacingProbe, facingProbeAt } from './facing-probe.ts';
import { formatCollisionEvidence } from './collision-evidence';
import type {
  DecisionDiagnostics,
  DecisionProvider,
  DecisionProviderFactory,
  DecisionRequest,
} from './decision-provider.ts';
import { checkPrepared, passiveCheck } from './native-observation-checks.ts';
import {
  createPreviousActionOutcome,
  type PreviousActionOutcome,
  previousActionAt,
} from './previous-action.ts';
import type {
  Counters,
  E1M1Assessment,
  NativeObservation,
  Observation,
  Operation,
  RequestExtra,
  Results,
  Success,
} from './worker-shared.ts';
import {
  IWAD_MAX_BYTES,
  IWAD_MIN_BYTES,
  IWAD_SIZE_ERROR,
} from './worker-shared.ts';
import { requestWorker } from './worker-request.ts';
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const digest = async (bytes: BufferSource) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
type EngineMetadata = {
  profile: 'controlled-title';
  a1Fixtures: true;
  embeddedIwad: false;
  bytes: number;
  sha256: string;
};
type SdkProbe = ReturnType<DecisionProviderFactory['probe']>['evidence'];
type Frame = { tic: number; nativeSha256: string; canvasSha256: string };
// Presentation progress only; never proof of execution, cleanup or readiness.
export type DecisionStage =
  | 'capturing'
  | 'requesting'
  | 'stepping'
  | 'rendering'
  | 'completed'
  | 'cleanup'
  | 'ended';
type DecisionEntry = DecisionDiagnostics & {
  number: number;
  selectedTics: number;
  stage: DecisionStage;
  status: string;
  action: ActionName | null;
  observation: Frame | null;
  result: Frame | null;
  execution: Execution | null;
  cumulativeVerifiedTics: number;
  waitUnchanged: boolean | null;
  choice?: ReturnType<typeof validateChoice>;
};
type Evidence = {
  sdk: SdkProbe;
  engine: EngineMetadata;
  operations: {
    op: Operation;
    elapsedMs: number;
    result: Results[Operation];
  }[];
  frames: Frame[];
  decisions: DecisionEntry[];
  activeOperation?: Operation;
  workerError?: string;
  error?: string;
  assets?: {
    wasm: { bytes: number; sha256: string };
    iwad: { bytes: number; sha256: string };
  };
  beforeNeutral?: { counters: Counters; native: NativeObservation };
  neutralFirst?: Execution;
  idle?: {
    minimumMs: number;
    observedMs: number;
    unchanged: boolean;
    before: Observation;
    after: Observation;
  };
};
type Run = {
  sessionId?: string;
  valid: boolean;
  phase: Phase;
  verifiedTics: number;
  frame?: Frame;
  attempt?: Attempt;
  client?: DecisionProvider;
  apiController?: AbortController;
  sdkRead?: Promise<void>;
  continuous?: ContinuousRun;
  agent?: AgentRun;
  evidence: Evidence;
  // Immutable request objects are shared with presentation, never cloned/serialized
  // with evidence. No historical RGBA buffers or provider credentials live here.
  inspectorRequests: Readonly<Record<number, DecisionRequest>>;
  worker?: Worker | null;
  cancel?: ((error: Error) => void) | null;
  last?: Observation;
  previousAction?: PreviousActionOutcome;
  collisionEvidence?: string;
  terminal?: E1M1Assessment;
};
type ContinuousRun = {
  active: boolean;
  stopRequested: boolean;
  dispatched: boolean;
  readonly limit: number;
  used: number;
  reason: string;
};
type AgentRun = {
  epoch: string;
  stopRequested: boolean;
  dispatched: boolean;
  used: boolean;
  observation?: AgentObservation;
  bounded?: BoundedAgentRun;
};
type BoundedAgentRun = {
  state: AgentRunState;
  run: Run;
  configuration: string;
};
type DecisionOutcome =
  | 'completed'
  | 'not-admitted'
  | 'api-failure'
  | 'stopped'
  | 'terminal'
  | 'retired';
export interface LocalIwad {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
type ReadonlyData<T> = T extends object
  ? { readonly [K in keyof T]: ReadonlyData<T[K]> }
  : T;
export type SessionPresentation = Readonly<{
  status?: string;
  sdkStatus?: string;
  frameStatus?: string;
  // Published only after the existing render/native/Canvas verification succeeds.
  verifiedObservation?: ReadonlyData<{
    tic: number;
    readyWeapon: NativeObservation['readyWeapon'];
    ammo: NativeObservation['ammo'];
    health: NativeObservation['health'];
    facingProbe?: FacingProbe;
  }>;
  iwadEnabled?: boolean;
  session?: ReadonlyData<{
    phase: Phase;
    verifiedTics: number;
    collisionEvidence?: string;
    frame?: Frame;
    evidence: Evidence;
    inspectorRequests: Readonly<Record<number, DecisionRequest>>;
    continuous?: ContinuousRun;
    agentBusy: boolean;
    agentAuthorization?: AgentRunState;
    waitingForSdk: boolean;
    hasClient: boolean;
    prepared: boolean;
    controls: { ready: boolean; stop: boolean; tics: boolean; iwad: boolean };
  }>;
}>;
export interface SessionBrowserPorts {
  localFetch(name: string, json: true): Promise<unknown>;
  localFetch(name: string, json?: false): Promise<ArrayBuffer>;
  createWorker(): Worker;
  readTics(): number;
  readDecisionConfiguration(): DecisionConfiguration;
  readAgentIdentity?(): string;
  agentGrantRevoked?(): void;
  promptEditorOpen?(): boolean;
  takeKey(): string;
  clearKey(): void;
  focusBudget(): void;
  capture(): { png: string; rgba: Uint8ClampedArray<ArrayBuffer> };
  paintAndReadback(
    rgba: Uint8ClampedArray<ArrayBuffer>,
  ): Uint8ClampedArray<ArrayBuffer>;
  clearCanvas(): void;
  present(view: SessionPresentation): void;
}

// Import and construction are inert. Only explicit commands start work.
export function createSessionController(
  ports: SessionBrowserPorts,
  providerFactory: DecisionProviderFactory,
) {
  let engine: EngineMetadata | undefined,
    sdk: SdkProbe | undefined,
    current: Run | undefined;
  let pageExited = false;
  let configurationRevision = 0;
  let observed:
    | {
        id: string;
        epoch?: string;
        run: Run;
        tic: number;
        configuration: string;
      }
    | undefined;
  let agentLease:
    | {
        epoch: string;
        budgetMode: boolean;
        startClaimed?: boolean;
        configuration?: AgentConfiguration;
        grant?: NonNullable<typeof observed>;
        bounded?: BoundedAgentRun;
      }
    | undefined;
  const configurationIdentity = () =>
    JSON.stringify([
      ports.readDecisionConfiguration(),
      agentLease?.configuration,
      ports.readTics(),
      ports.readAgentIdentity?.(),
      configurationRevision,
    ]);
  function invalidateAgentObservation() {
    observed = undefined;
    if (agentLease?.grant) {
      agentLease.grant = undefined;
      ports.agentGrantRevoked?.();
    }
  }
  function endBounded() {
    const bounded = agentLease?.bounded;
    if (!bounded) return;
    bounded.state.active = false;
    bounded.state.remaining = 0;
    const agent = current?.agent;
    if (agent?.bounded === bounded) {
      agent.stopRequested = true;
      if (!agent.dispatched) current?.apiController?.abort();
    }
  }
  function changeConfiguration(change: () => void, agentWrite = false) {
    if (!agentWrite) endBounded();
    if (current?.agent) {
      display(current);
      return false;
    }
    invalidateAgentObservation();
    change();
    configurationRevision++;
    if (agentWrite && agentLease?.bounded)
      agentLease.bounded.configuration = configurationIdentity();
    if (current) display(current);
    return true;
  }
  const configure = (change: () => void) => changeConfiguration(change);
  function attachAgent(epoch: string, budgetMode = false) {
    check(!agentLease && !pageExited, 'Agent already attached or page exited.');
    agentLease = {
      epoch,
      budgetMode,
      configuration: Object.freeze({
        tics: 6,
        instructionTemplate:
          ports.readDecisionConfiguration().instructionTemplate,
        includeReadyWeapon: true,
        includeAmmo: true,
        includeHealth: true,
        includeFacingProbe: true,
        includePreviousAction: true,
      }),
    };
    observed = undefined;
  }
  function grantAgentCheckpoint(epoch: string) {
    const run = current;
    if (
      !agentLease ||
      agentLease.epoch !== epoch ||
      agentLease.grant ||
      agentLease.bounded ||
      !run?.valid ||
      run.phase !== 'ready' ||
      run.agent ||
      run.sdkRead ||
      run.continuous?.active ||
      run.terminal ||
      pageExited ||
      !observed ||
      observed.run !== run ||
      observed.epoch !== epoch ||
      observed.tic !== run.verifiedTics ||
      observed.configuration !== configurationIdentity()
    )
      return false;
    agentLease.grant = observed; // Authorize this exact verified checkpoint only.
    return true;
  }
  function allowAgent(epoch: string) {
    return !agentLease?.budgetMode && grantAgentCheckpoint(epoch);
  }
  function allowAgentRun(epoch: string) {
    // Reuse the exact ready-checkpoint admission, then replace only the newly
    // created single grant. A lease can never replenish a bounded authorization.
    if (!allowAgent(epoch)) return false;
    beginAgentRun(crypto.randomUUID(), agentRunLimit);
    return true;
  }
  function beginAgentRun(runId: string, limit: number) {
    const run = current;
    check(run && agentLease, 'Agent unavailable.');
    agentLease.grant = undefined;
    agentLease.bounded = {
      run,
      configuration: configurationIdentity(),
      state: {
        runId,
        active: true,
        limit,
        reserved: 0,
        sdkInvoked: 0,
        remaining: limit,
      },
    };
    display(run);
  }
  function startAgentRun(
    epoch: string,
    observationId: string,
    scope: AgentScope & { limit: number },
    assertLease: () => void,
  ): AgentConfigResult {
    try {
      assertLease();
    } catch {
      return { error: 'lease-revoked' };
    }
    if (!agentLease || agentLease.epoch !== epoch)
      return { error: 'lease-revoked' };
    if (!agentLease.budgetMode) return { error: 'budget-unavailable' };
    if (agentLease.startClaimed) return { error: 'budget-closed' };
    agentLease.startClaimed = true; // Broker issuance is never refunded locally either.
    if (!validAgentLimit(scope.limit) || !isAgentId(scope.runId))
      return { error: 'claim-failed' };
    const config = agentConfig(epoch, scope.sessionId, assertLease);
    if ('error' in config) return config;
    if (scope.revision !== configurationRevision)
      return { error: 'revision-conflict' };
    if (ports.promptEditorOpen?.()) return { error: 'editor-open' };
    if (!observed || observed.id !== observationId)
      return { error: 'stale-observation' };
    if (!grantAgentCheckpoint(epoch)) return { error: 'not-ready' };
    beginAgentRun(scope.runId, scope.limit);
    return agentConfig(epoch, scope.sessionId, assertLease);
  }
  function agentConfig(
    epoch: string,
    sessionId: string,
    assertLease: () => void,
    update?: AgentScope & { configuration: AgentConfiguration },
  ): AgentConfigResult {
    try {
      assertLease();
    } catch {
      return { error: 'lease-revoked' };
    }
    const lease = agentLease;
    if (!lease || lease.epoch !== epoch || !lease.configuration)
      return { error: 'lease-revoked' };
    const run = current;
    if (!run?.sessionId || run.sessionId !== sessionId)
      return { error: 'session-mismatch' };
    if (
      !run.valid ||
      pageExited ||
      run.phase !== 'ready' ||
      run.agent ||
      run.attempt ||
      run.sdkRead ||
      run.cancel ||
      run.terminal ||
      run.continuous?.active
    )
      return { error: 'not-ready' };
    const bounded = lease.bounded;
    if (update) {
      // Reject bad CAS writes without touching configuration, grants or counters.
      if (
        !bounded?.state.active ||
        bounded.run !== run ||
        update.sessionId !== sessionId ||
        update.runId !== bounded.state.runId
      )
        return { error: 'run-unavailable' };
      if (update.revision !== configurationRevision)
        return { error: 'revision-conflict' };
      if (ports.promptEditorOpen?.()) return { error: 'editor-open' };
      try {
        parseAgentConfiguration(update.configuration);
      } catch {
        return { error: 'invalid-configuration' };
      }
    }
    if (
      bounded?.state.active &&
      (bounded.run !== run || bounded.configuration !== configurationIdentity())
    ) {
      endBounded();
      display(run);
    }
    if (update) {
      if (!bounded?.state.active) return { error: 'run-unavailable' };
      changeConfiguration(() => {
        // All fields are scalar; detach the caller's replacement before owning it.
        lease.configuration = Object.freeze({ ...update.configuration });
      }, true);
    }
    return {
      sessionId,
      revision: configurationRevision,
      configuration: { ...lease.configuration },
      run: bounded ? { ...bounded.state } : null,
    };
  }
  function agentPrompt(
    epoch: string,
    sessionId: string,
    assertLease: () => void,
    update?: AgentScope & { instructions: string },
  ): AgentPromptResult {
    if (update && !validAgentInstructions(update.instructions))
      return { error: 'invalid-instructions' };
    const result = agentConfig(
      epoch,
      sessionId,
      assertLease,
      update && agentLease?.configuration
        ? {
            ...update,
            configuration: {
              ...agentLease.configuration,
              instructionTemplate: update.instructions,
            },
          }
        : undefined,
    );
    if ('error' in result) return result;
    return {
      sessionId: result.sessionId,
      revision: result.revision,
      instructions: result.configuration.instructionTemplate,
      run: result.run,
    };
  }
  function stopAgent() {
    endBounded();
    agentLease = undefined;
    observed = undefined;
    const run = current;
    if (!run?.agent) {
      if (run) display(run);
      return;
    }
    run.agent.stopRequested = true;
    if (!run.agent.dispatched) run.apiController?.abort();
    display(
      run,
      run.agent.dispatched
        ? 'Agent stopping after current decision verification.'
        : 'Agent stopping before native dispatch; awaiting safe cleanup.',
    );
  }

  function assertCurrent(run: Run): asserts run is Run & { worker: Worker } {
    check(
      current === run && run.valid && run.worker,
      'Game retired; no further native calls.',
    );
  }
  function display(run: Run, status?: string) {
    if (current !== run) return;
    const continuous = run.continuous;
    const ready =
      run.valid &&
      run.phase === 'ready' &&
      !run.terminal &&
      !run.sdkRead &&
      !continuous?.active &&
      !run.agent;
    ports.present({
      status,
      session: {
        phase: run.phase,
        verifiedTics: run.verifiedTics,
        collisionEvidence: run.collisionEvidence ?? 'No verified action yet.',
        frame: run.frame ? { ...run.frame } : undefined,
        // Presentation receives detached data, never the mutable lifecycle owner.
        evidence: structuredClone(run.evidence),
        inspectorRequests: run.inspectorRequests,
        continuous: continuous ? { ...continuous } : undefined,
        agentBusy: !!run.agent,
        agentAuthorization: agentLease?.bounded
          ? { ...agentLease.bounded.state }
          : undefined,
        waitingForSdk: !!run.sdkRead,
        hasClient: !!run.client,
        prepared:
          run.valid &&
          (run.phase === 'ready' || run.phase === 'busy') &&
          !!run.evidence.neutralFirst?.complete &&
          !!run.frame,
        controls: {
          ready,
          stop: !!continuous?.active && !continuous.stopRequested,
          tics:
            ready ||
            !!(run.valid && continuous?.active && !continuous.stopRequested),
          iwad: run.phase === 'unprepared',
        },
      },
    });
  }
  function retire(run: Run, phase: 'error' | 'terminal' = 'error') {
    endBounded();
    invalidateAgentObservation();
    // Retain the ended authorization as a tombstone/evidence, without settings.
    if (agentLease) agentLease.configuration = undefined;
    run.previousAction = undefined;
    if (phase !== 'terminal')
      run.collisionEvidence =
        'Native collision telemetry unavailable: session retired.';
    run.valid = false;
    run.phase = phase;
    run.attempt = undefined;
    run.apiController?.abort();
    run.apiController = undefined;
    run.client = undefined;
    ports.clearKey();
    run.worker?.terminate();
    run.worker = null;
    run.cancel?.(Error('Worker retired; pending completion unknown.'));
    const entry = run.evidence.decisions.at(-1);
    // Retirement can bypass attempt finalization (for example, page exit).
    // Completed historical results remain completed after their session retires.
    if (entry && entry.stage !== 'completed' && entry.stage !== 'ended')
      entry.stage = 'ended';
  }
  function terminalStatus(execution: Execution) {
    const assessment = execution.assessment;
    check(
      execution.terminal && assessment?.kind === 'terminal',
      'Missing verified terminal boundary.',
    );
    const signals = [
      assessment.dead ? 'Player dead' : '',
      assessment.exitPending ? 'Level exit triggered (exit pending)' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return `${signals} at tic ${assessment.tic}; ${execution.independentlyVerifiedTics} of ${execution.requestedTics} tics verified`;
  }
  async function request<O extends Operation>(
    run: Run,
    op: O,
    ...args: O extends keyof RequestExtra
      ? [extra: RequestExtra[O], transfer?: Transferable[]]
      : [extra?: undefined, transfer?: Transferable[]]
  ): Promise<Success<O>> {
    assertCurrent(run);
    check(
      op !== 'action' || !run.terminal,
      'Terminal game; no further native gameplay.',
    );
    check(!run.cancel, 'Overlapping Worker operation refused.');
    run.evidence.activeOperation = op;
    display(run);
    return requestWorker(
      run.worker,
      run,
      op,
      {
        assertCurrent: () => assertCurrent(run),
        retire: () => retire(run),
      },
      ...args,
    );
  }
  async function snapshot(run: Run) {
    const before = run.last;
    check(before, 'Snapshot requires a prior native observation.');
    const { result } = await request(run, 'snapshot');
    assertCurrent(run);
    passiveCheck(before, result);
    check(
      equal(before.counters, result.counters),
      'Snapshot changed counters.',
    );
    run.last = result;
    return result;
  }
  async function render(run: Run) {
    const before = run.last;
    check(before, 'Render requires a prior native observation.');
    const { result, pixels } = await request(run, 'render');
    assertCurrent(run);
    passiveCheck(before, result);
    check(
      result.status === 0 &&
        pixels?.byteLength === 1024000 &&
        result.dimensions?.width === 640 &&
        result.dimensions?.height === 400 &&
        typeof result.frameSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(result.frameSha256),
      'Missing real 640×400 Doom frame.',
    );
    check(
      result.counters.render === before.counters.render + 1 &&
        result.counters.frame === before.counters.frame + 1 &&
        result.counters.netIntercept === before.counters.netIntercept + 5 &&
        result.counters.gametic === run.verifiedTics,
      'Passive render cadence/tic mismatch.',
    );
    const rgba = new Uint8ClampedArray(pixels);
    const pixelSha256 = await digest(rgba);
    assertCurrent(run);
    check(
      pixelSha256 === result.frameSha256,
      'Returned pixels differ from native frame.',
    );
    const canvasSha256 = await digest(ports.paintAndReadback(rgba));
    assertCurrent(run);
    check(
      canvasSha256 === result.frameSha256,
      'Canvas pixels differ from native frame.',
    );
    run.last = result;
    run.frame = {
      tic: run.verifiedTics,
      nativeSha256: result.frameSha256,
      canvasSha256,
    };
    run.evidence.frames.push(run.frame);
    ports.present({
      frameStatus: `E1M1 · tic ${run.verifiedTics} · 640×400 · RGBA SHA-256 ${canvasSha256}`,
      verifiedObservation: structuredClone({
        tic: run.verifiedTics,
        readyWeapon: result.native.readyWeapon,
        ammo: result.native.ammo,
        health: result.native.health,
        facingProbe: facingProbeAt(result),
      }),
    });
  }

  async function action(
    run: Run,
    mask: number,
    tics: number,
    before: Observation,
    record: (evidence: Execution) => void,
  ) {
    // Record uncertainty BEFORE dispatch: a watchdog/missing reply is never zero
    // executed tics. Successful prefix evidence is retained even on final failure.
    record(verifyAction(before, mask, tics));
    const { result } = await request(run, 'action', { mask, tics });
    const evidence = verifyAction(before, mask, tics, result);
    record(evidence);
    run.verifiedTics = evidence.cumulativeVerifiedTics;
    check(
      evidence.complete || evidence.terminal,
      evidence.completionUncertain
        ? 'Native action completion uncertain; reload to restart.'
        : 'Native action incomplete or game no longer ready; reload to restart.',
    );
    assertCurrent(run);
    // Verification established this boundary, including a known terminal prefix.
    run.last = result as Observation;
    if (evidence.terminal) {
      check(evidence.assessment, 'Missing terminal assessment.');
      run.terminal = evidence.assessment;
    }
    return { execution: evidence, receipt: result };
  }

  // Observation owns the same ready/busy gate as decisions, but takes no key,
  // constructs no provider and dispatches only passive snapshot/render operations.
  async function observe(assertLease: () => void): Promise<AgentObserveResult> {
    const run = current;
    check(
      run?.valid &&
        !pageExited &&
        run.phase === 'ready' &&
        !run.attempt &&
        !run.sdkRead &&
        !run.terminal &&
        !run.continuous?.active &&
        !run.agent &&
        !run.cancel &&
        run.frame?.tic === run.verifiedTics &&
        run.evidence.neutralFirst?.complete,
      'Observation unavailable: game not ready.',
    );
    class Revoked extends Error {}
    const fresh = () => {
      assertCurrent(run);
      try {
        assertLease();
      } catch {
        throw new Revoked('Agent lease revoked.');
      }
    };
    fresh();
    const lease = agentLease;
    check(lease?.configuration, 'Agent lease revoked.');
    const identity = configurationIdentity();
    invalidateAgentObservation();
    run.sessionId ??= crypto.randomUUID();
    run.phase = 'busy';
    display(run);
    let result: AgentObservation;
    try {
      const before = await snapshot(run);
      fresh();
      check(
        before.counters.gametic === run.verifiedTics,
        'Observation tic mismatch.',
      );
      await render(run); // Reuse native pixels, passive proof and Canvas readback.
      fresh();
      result = await captureAgentObservation(run, fresh);
    } catch (error) {
      if (!(error instanceof Revoked)) retire(run);
      throw Error(
        error instanceof Revoked
          ? 'Agent lease revoked.'
          : 'Observation verification failed; reload to restart.',
      );
    } finally {
      if (current === run && run.valid && run.phase === 'busy')
        run.phase = 'ready';
      display(run);
    }
    // Capture has drained and finally restored ready. Reuse the authoritative
    // config gate, without an await between continuity checks and publication.
    const coherent = () => {
      fresh();
      check(
        agentLease === lease &&
          run.sessionId === result.sessionId &&
          observed?.id === result.observationId &&
          observed.run === run &&
          observed.epoch === lease.epoch &&
          observed.tic === result.tic &&
          result.tic === run.verifiedTics &&
          observed.configuration === identity &&
          configurationIdentity() === identity,
        'Observation unavailable: agent state changed.',
      );
    };
    try {
      coherent();
      const config = agentConfig(lease.epoch, result.sessionId, assertLease);
      check(!('error' in config), 'Observation unavailable: agent not ready.');
      coherent();
      return structuredClone({ ...result, ...config });
    } catch (error) {
      invalidateAgentObservation();
      throw error;
    }
  }

  async function captureAgentObservation(
    run: Run,
    fresh = () => assertCurrent(run),
    previousAction = run.previousAction,
  ) {
    const checkpoint = await snapshot(run);
    fresh();
    const frame = run.frame;
    check(
      frame?.tic === checkpoint.counters.gametic,
      'Observation frame mismatch.',
    );
    const { png, rgba } = ports.capture();
    const canvasHash = await digest(rgba);
    fresh();
    check(
      canvasHash === frame.nativeSha256 && canvasHash === frame.canvasSha256,
      'Observation Canvas/native hash mismatch.',
    );
    const pngSha256 = await digest(agentPngBytes(png));
    fresh();
    const after = await snapshot(run);
    fresh();
    check(
      equal(checkpoint.counters, after.counters) &&
        equal(checkpoint.native, after.native),
      'Observation changed while capturing.',
    );
    const p = after.native;
    const previous = previousActionAt(previousAction, after);
    const probe = run.terminal ? undefined : facingProbeAt(after);
    run.sessionId ??= crypto.randomUUID();
    const result: AgentObservation = structuredClone({
      observationId: crypto.randomUUID(),
      sessionId: run.sessionId,
      tic: run.verifiedTics,
      phase: run.terminal ? 'terminal' : 'ready',
      frame: { ...frame },
      counters: {
        gametic: after.counters.gametic,
        leveltime: after.counters.leveltime,
        render: after.counters.render,
        frame: after.counters.frame,
      },
      telemetry: {
        health: p.health,
        weaponId: p.readyWeapon?.id ?? null,
        bullets: p.ammo?.bullets.current ?? null,
        shells: p.ammo?.shells.current ?? null,
        cells: p.ammo?.cells.current ?? null,
        rockets: p.ammo?.rockets.current ?? null,
        readyWeapon: p.readyWeapon,
        ammo: p.ammo,
        x: p.x,
        y: p.y,
        angle: p.angle,
      },
      facingProbe: probe && probe.kind !== 0 ? probe : null,
      previousAction: previous
        ? {
            action: previous.action,
            tics: previous.tics,
            endTic: previous.endTic,
            text: previous.text,
          }
        : null,
      png,
      pngSha256,
    });
    observed = {
      id: result.observationId,
      epoch: agentLease?.epoch,
      run,
      tic: run.verifiedTics,
      configuration: configurationIdentity(),
    };
    return result;
  }

  function fence(run: Run, attempt: Attempt) {
    assertCurrent(run);
    assertDecision(run, attempt);
  }
  function agentFence(agent: AgentRun) {
    if (
      agent.stopRequested ||
      agentLease?.epoch !== agent.epoch ||
      (agent.bounded &&
        (!agent.bounded.state.active ||
          agentLease.bounded !== agent.bounded ||
          agent.bounded.configuration !== configurationIdentity()))
    )
      throw new DecisionStopped();
  }
  async function decide(
    run: Run,
    attempt: Attempt,
    entry: DecisionEntry,
    png: string,
    permittedActions: readonly ActionName[],
    configuration: DecisionConfiguration,
    observation: Observation,
    continuous?: ContinuousRun,
    agent?: AgentRun,
  ) {
    fence(run, attempt);
    check(!run.terminal, 'Terminal game; no further Decisions requests.');
    check(run.client, 'A temporary API credential is required.');
    check(!run.sdkRead, 'Previous SDK response still pending.');
    check(entry.observation, 'Verified observation required.');
    // Preserve the latency/deadline origin before synchronous request construction.
    const startedAt = performance.now();
    const preparedRequest = buildDefaultDecisionRequest(
      entry.observation.tic,
      attempt.tics,
      png,
      permittedActions,
      configuration,
      observation.native,
      previousActionAt(run.previousAction, observation),
      facingProbeAt(observation),
    );
    run.inspectorRequests = Object.freeze({
      ...run.inspectorRequests,
      [entry.number]: preparedRequest,
    });
    return run.client.request(
      preparedRequest,
      run,
      entry,
      {
        assertFresh: () => fence(run, attempt),
        beforeCreate: () => {
          fence(run, attempt);
          if (agent) {
            agentFence(agent);
            check(
              run.agent === agent && !agent.used,
              'Agent attempt exhausted.',
            );
            agent.used = true; // Synchronous, immediately before SDK create; never refunded.
            if (agent.bounded) agent.bounded.state.sdkInvoked++;
          }
          if (continuous) {
            if (continuous.stopRequested) throw new DecisionStopped();
            check(
              continuous.used < continuous.limit,
              'Continuous budget exhausted.',
            );
            continuous.used++;
          }
          entry.sdkInvoked = true;
        },
        onReadStateChange: () => display(run),
      },
      startedAt,
    );
  }

  async function runOneDecision(
    run: Run,
    continuous?: ContinuousRun,
    agent?: AgentRun,
  ): Promise<DecisionOutcome> {
    if (
      current !== run ||
      pageExited ||
      !run.valid ||
      run.phase !== 'ready' ||
      run.attempt ||
      run.terminal ||
      run.sdkRead ||
      (run.agent && run.agent !== agent) ||
      (run.continuous?.active && run.continuous !== continuous)
    )
      return 'not-admitted';
    if (!agent) endBounded(); // Manual gameplay ends any authorization between cycles.
    if (
      continuous &&
      (run.continuous !== continuous ||
        !continuous.active ||
        continuous.stopRequested)
    )
      return 'stopped';
    const agentConfiguration = agent ? agentLease?.configuration : undefined;
    if (agent && !agentConfiguration) return 'stopped';
    const tics = agentConfiguration
      ? agentConfiguration.tics
      : ports.readTics();
    if (
      agent ? !validAgentTics(tics) : !Number.isSafeInteger(tics) || tics < 1
    ) {
      display(
        run,
        agent
          ? 'Agent tics per decision must be an integer from 1 through 35.'
          : 'Tics per decision must be a positive JavaScript safe integer.',
      );
      return 'not-admitted';
    }
    let key = ports.takeKey().trim();
    if (key) {
      if (!/^[\x21-\x7e]+$/.test(key)) {
        key = '';
        display(
          run,
          'Enter a usable temporary API key (no spaces or control characters).',
        );
        return 'not-admitted';
      }
      try {
        run.client = providerFactory.create(key); // Same Doom run; drop the prior client.
      } catch {
        display(
          run,
          'Could not create the API client. Enter a replacement key.',
        );
        return 'not-admitted';
      } finally {
        key = '';
      }
    }
    if (!run.client) {
      display(run, 'Enter a temporary API key before requesting decisions.');
      return 'not-admitted';
    }
    // Freeze duration and attempt identity before the first await. The handler
    // guard, rather than disabled styling alone, prevents overlapping admission.
    const attempt = admitDecision(run, tics);
    if (!attempt) return 'not-admitted';
    invalidateAgentObservation();
    // Snapshot instructions and state options together before presentation or any await.
    const configuration = Object.freeze({
      ...(agentConfiguration ?? ports.readDecisionConfiguration()),
    });
    const permittedActions = Object.freeze(Object.keys(masks) as ActionName[]);
    if (continuous) continuous.dispatched = false;
    const dispatchFence = () => {
      fence(run, attempt);
      if (agent) agentFence(agent);
      if (
        continuous?.stopRequested ||
        agent?.stopRequested ||
        (agent && agentLease?.epoch !== agent.epoch)
      )
        throw new DecisionStopped();
    };
    const entry: DecisionEntry = {
      number: run.evidence.decisions.length + 1,
      selectedTics: attempt.tics,
      stage: 'capturing',
      status: 'Capturing current frame',
      action: null,
      observation: null,
      result: null,
      execution: null,
      cumulativeVerifiedTics: run.verifiedTics,
      requestId: null,
      latencyMs: null,
      http: null,
      waitUnchanged: null,
      sdkInvoked: false,
    };
    run.evidence.decisions.push(entry);
    display(
      run,
      `Decision ${entry.number}: capturing tic ${run.verifiedTics}…`,
    );
    let observation: Observation | undefined;
    let canRecover = false;
    try {
      observation = await snapshot(run);
      fence(run, attempt);
      check(
        run.frame?.tic === run.verifiedTics &&
          observation.counters.gametic === run.verifiedTics,
        'Current rendered/native checkpoint mismatch.',
      );
      dispatchFence();
      entry.observation = { ...run.frame };
      // PNG and RGBA are captured synchronously from the same visible Canvas.
      const { png, rgba } = ports.capture();
      check(
        png.startsWith('data:image/png;base64,'),
        'Canvas PNG unavailable.',
      );
      const hash = await digest(rgba);
      fence(run, attempt);
      check(
        hash === run.frame.nativeSha256,
        'Observation Canvas/native hash mismatch.',
      );
      dispatchFence();
      entry.stage = 'requesting';
      entry.status = 'Requesting one action';
      display(
        run,
        `Decision ${entry.number}: requesting action for ${attempt.tics} tics…`,
      );
      canRecover = true;
      const data = await decide(
        run,
        attempt,
        entry,
        png,
        permittedActions,
        configuration,
        observation,
        continuous,
        agent,
      );
      dispatchFence();
      try {
        entry.choice = validateChoice(data, permittedActions);
      } catch (error) {
        // validateChoice emits only fixed local categories, never response values.
        throw new DecisionFailure(
          error instanceof Error ? error.message : 'Invalid choice',
        );
      }
      entry.action = entry.choice.action;
      canRecover = false;
      const afterWait = await snapshot(run);
      fence(run, attempt);
      check(
        equal(observation.counters, afterWait.counters) &&
          equal(observation.native, afterWait.native),
        'Native state advanced during API wait.',
      );
      entry.waitUnchanged = true;
      entry.stage = 'stepping';
      entry.status = 'Stepping and verifying';
      display(
        run,
        `Decision ${entry.number}: verifying ${attempt.tics} native tics…`,
      );
      // No await between the final identity fence and the one native dispatch.
      dispatchFence();
      if (continuous) continuous.dispatched = true;
      if (agent) agent.dispatched = true;
      run.previousAction = undefined;
      run.collisionEvidence =
        'Native collision telemetry unavailable: action/frame verification pending.';
      const { execution, receipt } = await action(
        run,
        masks[entry.action],
        attempt.tics,
        afterWait,
        (evidence) => {
          entry.execution = evidence;
          entry.cumulativeVerifiedTics = evidence.cumulativeVerifiedTics;
        },
      );
      fence(run, attempt);
      const previousAction = createPreviousActionOutcome(
        entry.action,
        afterWait,
        receipt,
        execution,
      );
      entry.stage = 'rendering';
      entry.status = execution.terminal
        ? 'Terminal tic verified; rendering'
        : 'Action verified; rendering';
      display(
        run,
        `Decision ${entry.number}: rendering tic ${run.verifiedTics}…`,
      );
      await render(run);
      fence(run, attempt);
      check(run.frame, 'Verified frame unavailable.');
      entry.result = { ...run.frame };
      if (agent) {
        // Dispatch has settled. Even Stop must drain the resulting-frame proof.
        agent.observation = await captureAgentObservation(
          run,
          () => assertCurrent(run),
          previousAction,
        );
        fence(run, attempt);
      }
      run.collisionEvidence = formatCollisionEvidence(
        entry.action,
        afterWait.counters.gametic,
        receipt,
        execution,
      );
      if (execution.terminal) {
        entry.stage = 'ended';
        entry.status = `${terminalStatus(execution)}; frame retained.`;
        retire(run, 'terminal');
        display(run, `${entry.status} Reload to start a new session.`);
        return 'terminal';
      }
      entry.stage = 'completed';
      run.previousAction = previousAction;
      entry.status = 'Complete';
      run.attempt = undefined;
      run.phase = 'ready';
      display(
        run,
        continuous
          ? `Decision verified and rendered at tic ${run.verifiedTics}.`
          : `Ready at tic ${run.verifiedTics} — click Next Decision for another action.`,
      );
      return 'completed';
    } catch (error) {
      if (
        current !== run ||
        pageExited ||
        (run.valid && run.attempt !== attempt)
      )
        return 'retired';
      if (
        ((canRecover && error instanceof DecisionFailure) ||
          error instanceof DecisionStopped) &&
        run.valid &&
        observation
      ) {
        try {
          fence(run, attempt);
          entry.stage = 'cleanup';
          entry.status = run.sdkRead
            ? 'Waiting for API response cleanup; no native action dispatched'
            : 'Checking unchanged native state';
          display(run, entry.status);
          await run.sdkRead;
          fence(run, attempt);
          const unchanged = await snapshot(run);
          fence(run, attempt);
          check(
            equal(observation.counters, unchanged.counters) &&
              equal(observation.native, unchanged.native),
            'Native state changed during failed API request.',
          );
          entry.waitUnchanged = true;
          const stopped =
            error instanceof DecisionStopped ||
            continuous?.stopRequested ||
            agent?.stopRequested;
          entry.stage = 'ended';
          entry.status = `${stopped ? 'Stopped by user' : error.message}; no native action dispatched`;
          run.attempt = undefined;
          run.phase = 'ready';
          display(
            run,
            stopped
              ? `${entry.status}. Ready at tic ${run.verifiedTics}.`
              : `${entry.status}. Correct the key if needed, then click Next Decision to retry.`,
          );
          return stopped ? 'stopped' : 'api-failure';
        } catch {
          // Failed passive proof means the game cannot be safely reused.
        }
      }
      entry.stage = 'ended';
      entry.status = entry.execution?.terminal
        ? `${terminalStatus(entry.execution)}; terminal frame unavailable. Reload to restart.`
        : entry.execution?.complete
          ? 'Action verified; resulting frame unavailable. Reload to restart.'
          : entry.execution
            ? entry.execution.completionUncertain
              ? 'Native completion uncertain; verified prefix retained. Reload to restart.'
              : entry.execution.assessment?.kind === 'unsupported'
                ? 'Unsupported native state; verified prefix retained. Reload to restart.'
                : entry.execution.independentlyVerifiedTics ===
                    entry.selectedTics
                  ? 'All requested tics consumed; game no longer ready. Reload to restart.'
                  : `Native action refused after ${entry.execution.independentlyVerifiedTics} verified tics. Reload to restart.`
            : 'Game/observation verification failed; no native action dispatched. Reload to restart.';
      retire(run);
      run.evidence.error = entry.status;
      display(run, entry.status);
      return 'retired';
    } finally {
      if (continuous) continuous.dispatched = false;
    }
  }

  async function agentNext(
    epoch: string,
    observationId: string,
    assertLease: () => void,
    scope?: AgentScope,
  ): Promise<AgentDecisionResult> {
    const run = current;
    const rejected = (
      reason: AgentDecisionResult['reason'],
    ): AgentDecisionResult => ({
      outcome: 'not-admitted',
      reason,
      beforeObservationId: observationId,
      sdkInvoked: false,
      action: null,
      requestedTics: null,
      reportedTics: null,
      verifiedTics: null,
      cumulativeTics: null,
      completionUncertain: false,
      requestIdentity: null,
      responseMetadata: null,
      observation: null,
    });
    try {
      assertLease();
    } catch {
      return rejected('lease-revoked');
    }
    if (!agentLease || agentLease.epoch !== epoch)
      return rejected('lease-revoked');
    const bounded = agentLease.bounded;
    if (bounded) {
      if (
        !bounded.state.active ||
        bounded.state.remaining === 0 ||
        !scope ||
        scope.runId !== bounded.state.runId ||
        scope.sessionId !== run?.sessionId ||
        scope.revision !== configurationRevision ||
        bounded.run !== run ||
        bounded.configuration !== configurationIdentity()
      )
        return rejected('no-grant');
    } else if (scope || !agentLease.grant) return rejected('no-grant');
    const grant = agentLease.grant;
    agentLease.grant = undefined; // One command reserves it, including rejected preflight.
    if (
      !run?.valid ||
      run.phase !== 'ready' ||
      run.agent ||
      run.attempt ||
      run.sdkRead ||
      run.continuous?.active ||
      run.terminal ||
      pageExited
    )
      return rejected('not-ready');
    if (
      !observed ||
      (!bounded && grant !== observed) ||
      observed.run !== run ||
      observed.epoch !== epoch ||
      observed.id !== observationId ||
      observed.tic !== run.verifiedTics ||
      observed.configuration !== configurationIdentity()
    )
      return rejected('stale-observation');
    if (bounded) {
      bounded.state.reserved++; // Synchronous valid admission; never refunded.
      bounded.state.remaining = bounded.state.limit - bounded.state.reserved;
      observed = undefined; // Exact observation is consumed even on pre-create failure.
    }
    const agent: AgentRun = {
      epoch,
      stopRequested: false,
      dispatched: false,
      used: false,
      bounded,
    };
    run.agent = agent; // Own admission through SDK cleanup AND output verification.
    const number = run.evidence.decisions.length;
    display(run);
    try {
      const outcome = await runOneDecision(run, undefined, agent);
      if (bounded && (outcome !== 'completed' || bounded.state.remaining === 0))
        endBounded();
      const entry = run.evidence.decisions[number];
      return structuredClone({
        outcome,
        reason: null,
        beforeObservationId: observationId,
        sdkInvoked: agent.used,
        action: entry?.action ?? null,
        requestedTics: entry?.selectedTics ?? null,
        reportedTics: entry?.execution?.reportedCompletedTics ?? null,
        verifiedTics: entry?.execution?.independentlyVerifiedTics ?? null,
        cumulativeTics: entry?.execution?.cumulativeVerifiedTics ?? null,
        completionUncertain: entry?.execution?.completionUncertain ?? false,
        requestIdentity: entry?.requestIdentity ?? null,
        responseMetadata: entry?.responseMetadata ?? null,
        observation: agent.observation ?? null,
      });
    } finally {
      run.agent = undefined;
      display(run);
    }
  }

  async function startContinuous(limit: number) {
    const run = current;
    if (
      !run?.valid ||
      pageExited ||
      run.phase !== 'ready' ||
      run.attempt ||
      run.terminal ||
      run.sdkRead ||
      run.continuous?.active ||
      run.agent
    )
      return;
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      display(run, 'Max API attempts must be a positive safe integer.');
      ports.focusBudget();
      return;
    }
    const continuous: ContinuousRun = {
      active: true,
      stopRequested: false,
      dispatched: false,
      limit,
      used: 0,
      reason: '',
    };
    run.continuous = continuous; // Ownership is acquired before the first await.
    display(run);
    try {
      while (continuous.used < continuous.limit && !continuous.stopRequested) {
        const outcome = await runOneDecision(run, continuous);
        if (outcome !== 'completed') {
          continuous.reason =
            outcome === 'not-admitted'
              ? 'Admission failed; correct the inputs before starting again'
              : (run.evidence.decisions.at(-1)?.status ?? outcome);
          return;
        }
        if (continuous.used < continuous.limit && !continuous.stopRequested)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      continuous.reason = continuous.stopRequested
        ? 'Stopped by user'
        : 'Budget exhausted';
    } finally {
      continuous.active = false;
      display(run);
    }
  }

  function stopContinuous() {
    const run = current;
    const continuous = run?.continuous;
    if (!run || !continuous?.active || continuous.stopRequested) return;
    continuous.stopRequested = true;
    if (!continuous.dispatched) run.apiController?.abort();
    display(
      run,
      continuous.dispatched
        ? 'Stopping after current decision.'
        : 'Stopping before native dispatch; checking unchanged game state.',
    );
  }

  async function prepare(file?: LocalIwad) {
    // Selection is single-flight. Only asset validation failures allow correction.
    if (
      pageExited ||
      !engine ||
      !sdk ||
      (current && current.phase !== 'unprepared')
    )
      return;
    if (!file) {
      ports.present({
        status: 'Use included Freedoom or choose a local IWAD first.',
      });
      return;
    }
    const run: Run = {
      valid: true,
      phase: 'preparing',
      verifiedTics: 0,
      evidence: { sdk, engine, operations: [], frames: [], decisions: [] },
      inspectorRequests: Object.freeze({}),
    };
    current = run;
    ports.clearCanvas();
    ports.present({ frameStatus: 'No frame rendered for this preparation.' });
    display(run, 'Preparing fresh E1M1…');
    let assetValidation = true;
    try {
      check(
        file.size >= IWAD_MIN_BYTES && file.size <= IWAD_MAX_BYTES,
        IWAD_SIZE_ERROR,
      );
      const [wasm, wad] = await Promise.all([
        ports.localFetch('doom.wasm'),
        file.arrayBuffer(),
      ]);
      check(
        current === run && run.valid,
        'Preparation invalidated during asset reading.',
      );
      const selectedWadHash = await digest(wad);
      assetValidation = false;
      check(
        wasm.byteLength === engine.bytes &&
          (await digest(wasm)) === engine.sha256,
        'Bundled WASM length/hash mismatch.',
      );
      check(
        current === run && run.valid,
        'Preparation invalidated during asset verification.',
      );
      run.worker = ports.createWorker();
      const { result: loaded } = await request(
        run,
        'load-i11',
        { wasm, wad, expectedWasmHash: engine.sha256 },
        [wasm, wad],
      );
      check(
        loaded.wasmSha256 === engine.sha256 &&
          loaded.wadSha256 === selectedWadHash &&
          Object.values(loaded.counters).every((value) => value === 0),
        'Asset identity/pre-init counters mismatch.',
      );
      run.evidence.assets = {
        wasm: { bytes: engine.bytes, sha256: loaded.wasmSha256 },
        iwad: { bytes: file.size, sha256: loaded.wadSha256 },
      };
      run.last = loaded;
      for (const op of ['init', 'prepare'] as const) {
        const { result } = await request(run, op);
        checkPrepared(op, result);
        run.last = result;
      }
      const before = await snapshot(run);
      run.evidence.beforeNeutral = {
        counters: before.counters,
        native: before.native,
      };
      const { execution: neutral } = await action(
        run,
        0,
        1,
        before,
        (evidence) => {
          run.evidence.neutralFirst = evidence;
        },
      );
      await render(run);
      if (neutral.terminal) {
        retire(run, 'terminal');
        display(
          run,
          `${terminalStatus(neutral)}; frame retained. Reload to start a new session.`,
        );
        return;
      }
      await snapshot(run);
      await snapshot(run);
      await render(run); // One passive render demonstrates isolation, never another action.
      check(
        run.evidence.frames[0].nativeSha256 ===
          run.evidence.frames[1].nativeSha256,
        'Passive render changed the frame.',
      );
      const beforeIdle = await snapshot(run),
        started = performance.now();
      display(
        run,
        'One neutral tic verified (1/1/1). Checking five seconds of idle…',
      );
      await new Promise((resolve) => setTimeout(resolve, 5000)); // One diagnostic wait; no simulation loop.
      assertCurrent(run);
      const afterIdle = await snapshot(run);
      check(
        equal(beforeIdle.counters, afterIdle.counters) &&
          equal(beforeIdle.native, afterIdle.native) &&
          afterIdle.counters.gametic === 1,
        'Idle advanced native state.',
      );
      run.evidence.idle = {
        minimumMs: 5000,
        observedMs: Math.round(performance.now() - started),
        unchanged: true,
        before: beforeIdle,
        after: afterIdle,
      };
      run.phase = 'ready';
      display(run, 'Ready at tic 1 — neutral 1/1/1; passive checks unchanged.');
    } catch (error) {
      if (pageExited || current !== run) return;
      retire(run);
      run.evidence.error =
        error instanceof Error
          ? error.message.slice(0, 500)
          : 'Preparation failed.';
      if (assetValidation) run.phase = 'unprepared';
      display(
        run,
        `Preparation failed: ${run.evidence.error} ${assetValidation ? 'Choose an IWAD again to retry preparation.' : 'Reload to restart.'}`,
      );
    }
  }
  async function initialize() {
    try {
      const probe = providerFactory.probe();
      sdk = probe.evidence;
      ports.present({ sdkStatus: probe.status });
      const metadata = await ports.localFetch('doom-build.json', true);
      check(
        metadata !== null &&
          typeof metadata === 'object' &&
          'profile' in metadata &&
          metadata.profile === 'controlled-title' &&
          'a1Fixtures' in metadata &&
          metadata.a1Fixtures === true &&
          'embeddedIwad' in metadata &&
          metadata.embeddedIwad === false &&
          'bytes' in metadata &&
          typeof metadata.bytes === 'number' &&
          Number.isInteger(metadata.bytes) &&
          metadata.bytes > 0 &&
          metadata.bytes <= 16 * 1024 * 1024 &&
          'sha256' in metadata &&
          typeof metadata.sha256 === 'string' &&
          /^[a-f0-9]{64}$/.test(metadata.sha256),
        'Invalid generated engine identity. Run ./build.sh.',
      );
      engine = metadata as EngineMetadata;
      if (pageExited) return;
      ports.present({
        status: 'Use included Freedoom or choose a local IWAD to prepare Doom.',
        iwadEnabled: true,
      });
    } catch (error) {
      ports.present({
        status: `Startup failed: ${error instanceof Error ? error.message.slice(0, 500) : 'SDK/engine loading failed.'}`,
      });
    }
  }
  function close() {
    pageExited = true;
    stopAgent();
    if (current) retire(current);
    ports.clearKey();
  }
  function restore(persisted: boolean) {
    if (persisted) {
      ports.present({ iwadEnabled: false });
      if (current)
        display(current, 'Game retired on page exit. Reload to restart.');
      else ports.present({ status: 'Page exited. Reload to restart.' });
    }
  }
  return {
    initialize,
    prepare,
    observe,
    attachAgent,
    allowAgent,
    allowAgentRun,
    startAgentRun,
    agentPrompt,
    agentConfig,
    stopAgent,
    agentNext,
    configure,
    next: () =>
      current
        ? runOneDecision(current)
        : Promise.resolve('not-admitted' as const),
    startContinuous,
    stop: stopContinuous,
    close,
    restore,
  };
}
