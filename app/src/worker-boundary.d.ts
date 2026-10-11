// Declaration-only view of the preserved JS verifier and its native receipts.
// Numeric fields cover the controller/verifier reads, not every native diagnostic.
export type Counters = Record<
  'wasiInit' | 'cInit' | 'engineCreate' | 'titlePrepare' | 'titleReady' | 'nativeBuild' |
  'playerEntry' | 'worldComplete' | 'outerComplete' | 'schedulerEntry' | 'netBody' |
  'netIntercept' | 'wipeEntry' | 'demoLoad' | 'render' | 'frame' | 'gametic' | 'leveltime' | 'virtualTicks', number>;

export type NativeWork = 'build' | 'install' | 'liveEntry' | 'world' | 'status' | 'automap' | 'hud' | 'menu' | 'outer';
type Command = Record<'forwardmove' | 'sidemove' | 'angleturn' | 'chatchar' | 'buttons' |
  'consistancy' | 'buttons2' | 'inventory' | 'lookfly' | 'arti', number>;
export type NativeObservation = Record<NativeWork |
  'ready' | 'loadComplete' | 'resources' | 'liveActor' | 'gameEligible' | 'contributorsValid' |
  'episode' | 'map' | 'skill' | 'playerstate' | 'health' | 'gamestate' | 'gameaction' | 'virtualMs' |
  'turnheld' | 'buildTick' | 'keyUp' | 'keyRight' | 'keyDown' | 'keyLeft' | 'keyFire' | 'keyUse' |
  'installEqual' | 'entryEqual' | 'actorEqual' | 'usedown' | 'dclicktime' | 'dclicktime2' |
  'dclickstate' | 'dclicks' | 'dclickstate2' | 'dclicks2', number> & {built: Command; entered: Command};

export interface Observation {
  counters: Counters;
  native: NativeObservation;
  logs?: {kind: 'info' | 'error'; text: string}[];
  logsTruncated?: boolean;
}

export function i11VerifyStep(mask: number, before: Observation,
  after: Observation & {status: number | null}): void;
