// Shared admission bounds and native receipts; importing this module starts no Worker.
// Match AdmitExternalWad() in engine/doom/src/doom_wasm.c.
export const IWAD_MIN_BYTES = 12;
export const IWAD_MAX_BYTES = 32 * 1024 * 1024;
export const IWAD_SIZE_ERROR =
  'Local IWAD must be 12–33,554,432 bytes (32 MiB maximum).';

export type Counters = Record<
  | 'wasiInit'
  | 'cInit'
  | 'engineCreate'
  | 'titlePrepare'
  | 'titleReady'
  | 'nativeBuild'
  | 'playerEntry'
  | 'worldComplete'
  | 'outerComplete'
  | 'schedulerEntry'
  | 'netBody'
  | 'netIntercept'
  | 'wipeEntry'
  | 'demoLoad'
  | 'render'
  | 'frame'
  | 'gametic'
  | 'leveltime'
  | 'virtualTicks',
  number
>;

export type NativeWork =
  | 'build'
  | 'install'
  | 'liveEntry'
  | 'world'
  | 'status'
  | 'automap'
  | 'hud'
  | 'menu'
  | 'outer';
type Command = Record<
  | 'forwardmove'
  | 'sidemove'
  | 'angleturn'
  | 'chatchar'
  | 'buttons'
  | 'consistancy'
  | 'buttons2'
  | 'inventory'
  | 'lookfly'
  | 'arti',
  number
>;
export type NativeObservation = Record<
  | NativeWork
  | 'ready'
  | 'loadComplete'
  | 'resources'
  | 'liveActor'
  | 'gameEligible'
  | 'contributorsValid'
  | 'episode'
  | 'map'
  | 'skill'
  | 'playerstate'
  | 'health'
  | 'gamestate'
  | 'gameaction'
  | 'virtualMs'
  | 'turnheld'
  | 'buildTick'
  | 'keyUp'
  | 'keyRight'
  | 'keyDown'
  | 'keyLeft'
  | 'keyFire'
  | 'keyUse'
  | 'installEqual'
  | 'entryEqual'
  | 'actorEqual'
  | 'usedown'
  | 'dclicktime'
  | 'dclicktime2'
  | 'dclickstate'
  | 'dclicks'
  | 'dclickstate2'
  | 'dclicks2'
  | 'vertexes'
  | 'lines'
  | 'sectors'
  | 'segs'
  | 'subsectors'
  | 'nodes'
  | 'x'
  | 'y'
  | 'angle'
  | 'momx'
  | 'momy'
  | 'rndindex'
  | 'prndindex'
  | 'reactiontime'
  | 'flags',
  number
> & { built: Command; entered: Command };

export interface Observation {
  counters: Counters;
  native: NativeObservation;
  logs?: { kind: 'info' | 'error'; text: string }[];
  logsTruncated?: boolean;
}

export type E1M1Assessment = {
  kind: 'alive' | 'terminal' | 'unsupported';
  tic: number;
  dead: boolean;
  exitPending: boolean;
};

// Modified-engine enums: GS_LEVEL=0, PST_LIVE=0, PST_DEAD=1,
// ga_nothing=0, ga_completed=6, sk_medium=2. This reads no native state itself.
// Callers establish the observation/step evidence before using it as an outcome.
export function assessE1M1(observation: Observation): E1M1Assessment {
  const p = observation.native;
  const assessment: E1M1Assessment = {
    kind: 'unsupported',
    tic: observation.counters.gametic,
    dead: p.playerstate === 1,
    exitPending: p.gameaction === 6,
  };
  const living =
    p.playerstate === 0 &&
    Number.isSafeInteger(p.health) &&
    p.health > 0 &&
    p.liveActor === 1;
  const dead = assessment.dead && p.health === 0 && p.liveActor === 0;
  if (
    !Number.isSafeInteger(assessment.tic) ||
    assessment.tic < 0 ||
    p.loadComplete !== 1 ||
    p.resources !== 1 ||
    p.contributorsValid !== 1 ||
    p.gamestate !== 0 ||
    p.episode !== 1 ||
    p.map !== 1 ||
    p.skill !== 2 ||
    (p.gameaction !== 0 && !assessment.exitPending) ||
    (!living && !dead)
  )
    return assessment;
  if (assessment.dead || assessment.exitPending) {
    if (p.ready === 0 && p.gameEligible === 0) assessment.kind = 'terminal';
  } else if (p.ready === 1 && p.gameEligible === 1) {
    assessment.kind = 'alive';
  }
  // Coexisting signals stay separate; contradictions retain raw flags as unsupported.
  return assessment;
}

export type StatusObservation = Observation & { status: number | null };
export type Results = {
  'load-i11': Observation & {
    wasmSha256: string;
    wadSha256: string;
    imports: WebAssembly.ModuleImportDescriptor[];
    exports: WebAssembly.ModuleExportDescriptor[];
  };
  init: StatusObservation & { dimensions?: Dimensions };
  prepare: StatusObservation & {
    outcome: 'APPLIED' | 'REFUSED';
    dimensions?: Dimensions;
  };
  snapshot: Observation;
  render: StatusObservation & {
    dimensions?: Dimensions;
    outcome?: 'REFUSED';
    frameSha256?: string;
  };
  action: Partial<Observation> & {
    status: number | null;
    mask: number;
    requestedTics: number;
    completedTics: number;
    outcome: 'APPLIED' | 'TERMINAL' | 'INELIGIBLE' | 'REFUSED' | 'FAULT';
    steps: StatusObservation[];
    reason?: string;
    currentTic?: 'UNKNOWN';
    error?: string;
  };
};
export type Operation = keyof Results;
export type RequestExtra = {
  'load-i11': { wasm: ArrayBuffer; wad: ArrayBuffer; expectedWasmHash: string };
  action: { mask: number; tics: number };
};
export type Success<O extends Operation = Operation> = {
  [K in O]: {
    ok: true;
    op: K;
    elapsedMs: number;
    result: Results[K];
    pixels?: ArrayBuffer;
  };
}[O];
export type Reply<O extends Operation = Operation> =
  | Success<O>
  | (Partial<Observation> & {
      ok: false;
      op: O;
      error?: unknown;
      outcome: 'FAULT' | 'ERROR';
      retired: true;
      isWasmRuntimeError: boolean;
    });
export type Dimensions = { width: number; height: number };
export type Request = {
  [O in Operation]: { op: O } & (O extends keyof RequestExtra
    ? RequestExtra[O]
    : object);
}[Operation];

export function i11MaskValid(mask: number) {
  return (
    Number.isInteger(mask) &&
    mask >= 0 &&
    mask <= 63 &&
    (mask & 5) !== 5 &&
    (mask & 10) !== 10
  );
}
export function i11VerifyStep(
  mask: number,
  before: Observation,
  after: StatusObservation,
) {
  const require = (ok: unknown, message: string) => {
    if (!ok) throw Error(message);
  };
  if (after.status === -1) {
    require(JSON.stringify(before.counters) ===
      JSON.stringify(after.counters) &&
      JSON.stringify(before.native) ===
        JSON.stringify(after.native), 'Refusal mutated native state');
    return;
  }
  const n = before.counters.gametic,
    p = after.native,
    cmd = p.built;
  const held = mask & 10 ? before.native.turnheld + 1 : 0;
  const turn = (mask & 8 ? 1 : mask & 2 ? -1 : 0) * (held < 6 ? 320 : 640);
  require(after.status === 0 &&
    before.native.ready === 1 &&
    (
      [
        'build',
        'install',
        'liveEntry',
        'world',
        'status',
        'automap',
        'hud',
        'menu',
        'outer',
      ] as const
    ).every((k) => before.native[k] === n && p[k] === n + 1) &&
    (
      [
        'nativeBuild',
        'playerEntry',
        'worldComplete',
        'outerComplete',
        'gametic',
        'leveltime',
        'virtualTicks',
      ] as const
    ).every((k) => before.counters[k] === n && after.counters[k] === n + 1) &&
    p.virtualMs ===
      Math.floor(
        ((n + 1) * 1000) / 35,
      ), 'Single-tic completion/clock mismatch');
  require(i11MaskValid(mask) &&
    (n !== 0 || mask === 0) &&
    p.buildTick === n &&
    p.turnheld === held &&
    (
      ['keyUp', 'keyRight', 'keyDown', 'keyLeft', 'keyFire', 'keyUse'] as const
    ).every((k, i) => p[k] === +Boolean(mask & (1 << i))) &&
    cmd.forwardmove === (mask & 1 ? 25 : mask & 4 ? -25 : 0) &&
    cmd.angleturn === turn &&
    cmd.buttons === ((mask & 16 ? 1 : 0) | (mask & 32 ? 2 : 0)) &&
    (
      [
        'sidemove',
        'chatchar',
        'buttons2',
        'inventory',
        'lookfly',
        'arti',
      ] as const
    ).every((k) => cmd[k] === 0) &&
    JSON.stringify(cmd) === JSON.stringify(p.entered) &&
    (
      ['installEqual', 'entryEqual', 'actorEqual', 'contributorsValid'] as const
    ).every((k) => p[k] === 1) &&
    p.usedown === +Boolean(mask & 32) &&
    p.dclicktime === before.native.dclicktime + 1 &&
    p.dclicktime2 === before.native.dclicktime2 + 1 &&
    (['dclickstate', 'dclicks', 'dclickstate2', 'dclicks2'] as const).every(
      (k) => p[k] === 0,
    ), 'Native command/entry/input/history mismatch');
  // Final player angle is not a generic invariant: native weapon effects can
  // reorient after consumption. Isolated-turn proofs remain in the historical experiments.
  require(!after.logsTruncated &&
    !after.logs?.some((log) => log.kind === 'error') &&
    (['schedulerEntry', 'netBody', 'wipeEntry', 'demoLoad'] as const).every(
      (k) => after.counters[k] === 0,
    ), 'Unexpected diagnostic or scheduler work');
}
