// Synthetic neutral-only Doom observations and Worker results; no WASM or assets.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Import the actual finite action helper without instantiating its native module.
const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
export let i11Action;
try {
  globalThis.self = {};
  ({ i11Action } = await import('../../src/worker.ts'));
} finally {
  if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
  else delete globalThis.self;
}

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
];
const ticks = [
  'nativeBuild',
  'playerEntry',
  'worldComplete',
  'outerComplete',
  'gametic',
  'leveltime',
  'virtualTicks',
];
export function observation(n) {
  const command = Object.fromEntries(
    [
      'forwardmove',
      'sidemove',
      'angleturn',
      'chatchar',
      'buttons',
      'consistancy',
      'buttons2',
      'inventory',
      'lookfly',
      'arti',
    ].map((key) => [key, 0]),
  );
  return {
    counters: {
      ...Object.fromEntries(ticks.map((key) => [key, n])),
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
    },
    native: {
      ...Object.fromEntries(work.map((key) => [key, n])),
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
      built: command,
      entered: { ...command },
    },
  };
}
// Preparation starts at zero gameplay tics and zero passive renders.
export function preparationResult(op) {
  const result = observation(0);
  Object.assign(result.counters, {
    render: 0,
    frame: 0,
    netIntercept: 0,
    titleReady: op === 'init' ? 1 : 0,
  });
  return {
    ...result,
    status: 0,
    ...(op === 'prepare' ? { outcome: 'APPLIED' } : {}),
  };
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
} = {}) {
  let current = base === 0 ? preparationResult('prepare') : observation(base),
    calls = 0;
  return {
    get calls() {
      return calls;
    },
    observe: () => structuredClone(current),
    step(mask) {
      assert.equal(
        mask,
        0,
        'This synthetic fixture implements only neutral input',
      );
      ++calls;
      if (calls === trapAt) throw Error('Synthetic trap; current tic unknown');
      const prior = current;
      current = observation(prior.counters.gametic + 1);
      for (const key of ['render', 'frame', 'netIntercept'])
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
export const execute = (native, n) =>
  i11Action(0, n, (mask) => native.step(mask), native.observe);

export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function pixels(tic) {
  const rgba = new Uint8ClampedArray(1024000);
  rgba[0] = tic;
  rgba[4] = tic + 1;
  return rgba;
}

// Build only the synthetic operation result. Each suite retains its own dispatch,
// hold controls, reply cloning, microtask delivery, and transport accounting.
export function workerResult(
  native,
  data,
  { corruptSnapshot = false, badReceipt = false, badFrame = false } = {},
) {
  let result, frame;
  if (data.op === 'load-i11') {
    result = {
      ...preparationResult('init'),
      counters: Object.fromEntries(
        Object.keys(observation(0).counters).map((key) => [key, 0]),
      ),
      wasmSha256: sha(new Uint8Array(data.wasm)),
      wadSha256: sha(new Uint8Array(data.wad)),
      imports: [],
      exports: [],
    };
  } else if (data.op === 'init' || data.op === 'prepare') {
    result = preparationResult(data.op);
  } else if (data.op === 'snapshot') {
    result = native.observe();
    if (corruptSnapshot) result.native.health--;
  } else if (data.op === 'action') {
    result = execute(native, data.tics);
    if (badReceipt) result.completedTics++;
  } else if (data.op === 'render') {
    result = native.render();
    frame = pixels(result.counters.gametic);
    result = {
      ...result,
      status: 0,
      dimensions: { width: 640, height: 400 },
      frameSha256: badFrame ? '0'.repeat(64) : sha(frame),
    };
  } else return;
  return { result, frame };
}
