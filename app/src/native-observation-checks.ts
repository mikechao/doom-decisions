import type {
  Counters,
  NativeWork,
  Observation,
  StatusObservation,
} from './worker-shared.ts';
import { collisionObservationValid } from './worker-shared.ts';

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const passive = [
  'wasiInit',
  'cInit',
  'engineCreate',
  'titlePrepare',
  'titleReady',
  'nativeBuild',
  'playerEntry',
  'worldComplete',
  'outerComplete',
  'schedulerEntry',
  'netBody',
  'wipeEntry',
  'demoLoad',
  'gametic',
  'leveltime',
  'virtualTicks',
] as const satisfies readonly (keyof Counters)[];
const work = [
  'build',
  'install',
  'liveEntry',
  'world',
  'status',
  'automap',
  'hud',
  'menu',
  'outer',
] as const satisfies readonly NativeWork[];

export function passiveCheck(before: Observation, after: Observation) {
  check(
    passive.every((k) => before.counters[k] === after.counters[k]) &&
      equal(before.native, after.native),
    'Passive operation changed native work, commands or time.',
  );
}
export function healthy(result: Pick<Observation, 'logs' | 'logsTruncated'>) {
  check(
    !result.logsTruncated && !result.logs?.some((log) => log.kind === 'error'),
    'Native diagnostics reported an error or truncation.',
  );
}
export function checkPrepared(
  op: 'init' | 'prepare',
  result: StatusObservation,
) {
  healthy(result);
  check(
    collisionObservationValid(result),
    'Invalid preparation collision sample.',
  );
  check(
    result.status === 0,
    `Native ${op} failed (status ${result.status}); this IWAD may be incompatible.`,
  );
  check(
    work.every((k) => result.native[k] === 0) &&
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
      ).every((k) => result.counters[k] === 0) &&
      result.native.virtualMs === 0,
    'Hidden init/preparation tic.',
  );
  check(
    (['wasiInit', 'cInit', 'engineCreate', 'titlePrepare'] as const).every(
      (k) => result.counters[k] === 1,
    ) && result.counters.titleReady === (op === 'init' ? 1 : 0),
    'One-shot init/title readiness mismatch.',
  );
  if (op === 'prepare')
    check(
      (
        [
          'ready',
          'loadComplete',
          'resources',
          'liveActor',
          'gameEligible',
          'contributorsValid',
        ] as const
      ).every((k) => result.native[k] === 1) &&
        result.native.episode === 1 &&
        result.native.map === 1 &&
        result.native.skill === 2 &&
        result.native.playerstate === 0 &&
        result.native.health > 0 &&
        result.native.gamestate === 0 &&
        result.native.gameaction === 0,
      'Genuine E1M1 READY failed.',
    );
}
