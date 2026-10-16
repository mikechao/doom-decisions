// Synthetic neutral-only Doom observations and Worker results; no WASM or assets.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type {
  Counters,
  NativeObservation,
  Observation,
  Operation,
  Request,
  Results,
} from '../../src/worker-shared.ts';

// Import the actual finite action helper without instantiating its native module.
const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
const workerGlobal: { self?: object } = globalThis;
export let i11Action: typeof import('../../src/worker.ts').i11Action;
try {
  workerGlobal.self = {};
  ({ i11Action } = await import('../../src/worker.ts'));
} finally {
  if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
  else delete workerGlobal.self;
}

export function observation(n: number): Observation {
  const command = {
    forwardmove: 0,
    sidemove: 0,
    angleturn: 0,
    chatchar: 0,
    buttons: 0,
    consistancy: 0,
    buttons2: 0,
    inventory: 0,
    lookfly: 0,
    arti: 0,
  } satisfies NativeObservation['built'];
  return {
    counters: {
      nativeBuild: n,
      playerEntry: n,
      worldComplete: n,
      outerComplete: n,
      gametic: n,
      leveltime: n,
      virtualTicks: n,
      wasiInit: 1,
      cInit: 1,
      engineCreate: 1,
      titlePrepare: 1,
      titleReady: 0,
      render: 2,
      frame: 2,
      netIntercept: 10,
      schedulerEntry: 0,
      netBody: 0,
      wipeEntry: 0,
      demoLoad: 0,
    } satisfies Counters,
    native: {
      build: n,
      install: n,
      liveEntry: n,
      world: n,
      status: n,
      automap: n,
      hud: n,
      menu: n,
      outer: n,
      ready: 1,
      loadComplete: 1,
      resources: 1,
      liveActor: 1,
      gameEligible: 1,
      gamestate: 0,
      gameaction: 0,
      episode: 1,
      map: 1,
      skill: 2,
      playerstate: 0,
      health: 100,
      armorpoints: 0,
      readyWeapon: { id: 1, name: 'pistol', ammoType: 'bullets' },
      ammo: {
        bullets: { current: 50, max: 200 },
        shells: { current: 0, max: 50 },
        cells: { current: 0, max: 300 },
        rockets: { current: 0, max: 50 },
      },
      virtualMs: Math.floor((n * 1000) / 35),
      buildTick: n - 1,
      turnheld: 0,
      keyUp: 0,
      keyRight: 0,
      keyDown: 0,
      keyLeft: 0,
      keyFire: 0,
      keyUse: 0,
      installEqual: 1,
      entryEqual: 1,
      actorEqual: 1,
      contributorsValid: 1,
      usedown: 0,
      dclicktime: n,
      dclicktime2: n,
      dclickstate: 0,
      dclicks: 0,
      dclickstate2: 0,
      dclicks2: 0,
      // Stable synthetic geometry/player state, not measured Doom values.
      vertexes: 1,
      lines: 1,
      sectors: 1,
      segs: 1,
      subsectors: 1,
      nodes: 1,
      x: 0,
      y: 0,
      angle: 0,
      momx: 0,
      momy: 0,
      rndindex: 0,
      prndindex: 0,
      reactiontime: 0,
      flags: 0,
      built: command,
      entered: { ...command },
    } satisfies NativeObservation,
  };
}
// Preparation starts at zero gameplay tics and zero passive renders.
export function preparationResult(op: 'init'): Results['init'];
export function preparationResult(op: 'prepare'): Results['prepare'];
export function preparationResult(
  op: 'init' | 'prepare',
): Results['init'] | Results['prepare'];
export function preparationResult(
  op: 'init' | 'prepare',
): Results['init'] | Results['prepare'] {
  const result = observation(0);
  Object.assign(result.counters, {
    render: 0,
    frame: 0,
    netIntercept: 0,
    titleReady: op === 'init' ? 1 : 0,
  });
  if (op === 'init') {
    result.native.loadComplete = 0;
    result.native.armorpoints = null;
    result.native.readyWeapon = null;
    result.native.ammo = null;
  }
  return op === 'prepare'
    ? ({ ...result, status: 0, outcome: 'APPLIED' } satisfies Results['prepare'])
    : ({ ...result, status: 0 } satisfies Results['init']);
}
export const death = {
  ready: 0,
  gameEligible: 0,
  playerstate: 1,
  health: 0,
  liveActor: 0,
};
export const exit = { ready: 0, gameEligible: 0, gameaction: 6 };
export function nativeFixture({
  base = 1,
  at = Infinity,
  signals = {},
  trapAt = Infinity,
}: {
  base?: number;
  at?: number;
  signals?: Partial<NativeObservation>;
  trapAt?: number;
} = {}) {
  let current = base === 0 ? preparationResult('prepare') : observation(base),
    calls = 0;
  return {
    get calls() {
      return calls;
    },
    observe: () => structuredClone(current),
    step(mask: number) {
      assert.equal(
        mask,
        0,
        'This synthetic fixture implements only neutral input',
      );
      ++calls;
      if (calls === trapAt) throw Error('Synthetic trap; current tic unknown');
      const prior = current;
      current = observation(prior.counters.gametic + 1);
      for (const key of ['render', 'frame', 'netIntercept'] as const)
        current.counters[key] = prior.counters[key];
      if (calls === at) Object.assign(current.native, signals);
      return 0;
    },
    render() {
      ++current.counters.render;
      ++current.counters.frame;
      current.counters.netIntercept += 5;
      return this.observe();
    },
  };
}
type NativeFixture = ReturnType<typeof nativeFixture>;
export const execute = (native: NativeFixture, n: number): Results['action'] =>
  i11Action(0, n, (mask) => native.step(mask), native.observe);

export const sha = (bytes: Uint8Array | Uint8ClampedArray): string =>
  createHash('sha256').update(bytes).digest('hex');
export function pixels(tic: number) {
  const rgba = new Uint8ClampedArray(1024000);
  rgba[0] = tic;
  rgba[4] = tic + 1;
  return rgba;
}

// Build only the synthetic operation result. Each suite retains its own dispatch,
// hold controls, reply cloning, microtask delivery, and transport accounting.
type Faults = {
  corruptSnapshot?: boolean;
  badReceipt?: boolean;
  badFrame?: boolean;
};
export function workerResult<O extends Operation>(
  native: NativeFixture,
  data: Request & { op: O },
  faults?: Faults,
): { result: Results[O]; frame?: Uint8ClampedArray } | undefined;
export function workerResult(
  native: NativeFixture,
  data: Request,
  { corruptSnapshot = false, badReceipt = false, badFrame = false } = {},
) {
  if (data.op === 'load-i11') {
    const counters = observation(0).counters;
    for (const key of Object.keys(counters) as (keyof Counters)[])
      counters[key] = 0;
    const result: Results['load-i11'] = {
      ...preparationResult('init'),
      counters,
      wasmSha256: sha(new Uint8Array(data.wasm)),
      wadSha256: sha(new Uint8Array(data.wad)),
      imports: [],
      exports: [],
    };
    return { result, frame: undefined };
  } else if (data.op === 'init' || data.op === 'prepare') {
    return { result: preparationResult(data.op), frame: undefined };
  } else if (data.op === 'snapshot') {
    const result: Results['snapshot'] = native.observe();
    if (corruptSnapshot) result.native.health--;
    return { result, frame: undefined };
  } else if (data.op === 'action') {
    const result: Results['action'] = execute(native, data.tics);
    if (badReceipt) result.completedTics++;
    return { result, frame: undefined };
  } else if (data.op === 'render') {
    const rendered = native.render();
    const frame = pixels(rendered.counters.gametic);
    const result: Results['render'] = {
      ...rendered,
      status: 0,
      dimensions: { width: 640, height: 400 },
      frameSha256: badFrame ? '0'.repeat(64) : sha(frame),
    };
    return { result, frame };
  } else return;
}
