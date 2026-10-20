import { readPlayerTelemetry, readReadyWeapon } from './player-state.ts';
import type {
  Counters,
  Dimensions,
  NativeObservation,
  Observation,
  Operation,
  Reply,
  Request,
  Results,
  Success,
} from './worker-shared.ts';
import {
  assessE1M1,
  i11MaskValid,
  i11VerifyStep,
  IWAD_MAX_BYTES,
  IWAD_MIN_BYTES,
  IWAD_SIZE_ERROR,
} from './worker-shared.ts';

// The staged controlled-title ABI is checked before this typed boundary is used.
type NativeInstance = WebAssembly.Instance & {
  exports: {
    memory: WebAssembly.Memory;
    initControlled(): number;
    renderControlled(): number;
    prepareE1M1Controlled(): number;
    stepNeutralControlled(mask: number): number;
    a21ReadObservation(index: number): number;
    a1ReadCounter(index: number): number;
    a1WasiInitCount(): number;
  };
};

export function i11Action(
  mask: number,
  tics: number,
  step: (mask: number) => number,
  observe: () => Observation,
): Results['action'] {
  const action: Pick<
    Results['action'],
    'mask' | 'requestedTics' | 'completedTics' | 'outcome' | 'status' | 'steps'
  > = {
    mask,
    requestedTics: tics,
    completedTics: 0,
    outcome: 'REFUSED',
    status: -1,
    steps: [],
  };
  let last: Observation | undefined;
  try {
    last = observe();
    if (!i11MaskValid(mask) || !Number.isSafeInteger(tics) || tics < 1)
      return {
        ...last,
        ...action,
        reason: 'Invalid mask/duration; no native call',
      };
    if (
      assessE1M1(last).kind !== 'alive' ||
      (last.counters.gametic === 0 && mask !== 0)
    )
      return {
        ...last,
        ...action,
        reason: 'Native state/input ineligible; no native call',
      };
    for (let i = 0; i < tics; ++i) {
      const status = step(mask);
      const after = { status, ...observe() };
      i11VerifyStep(mask, last, after);
      if (status === -1) return { ...after, ...action };
      action.steps.push(after);
      action.completedTics++;
      last = after;
      const assessment = assessE1M1(after);
      if (assessment.kind !== 'alive')
        return {
          ...after,
          ...action,
          outcome: assessment.kind === 'terminal' ? 'TERMINAL' : 'INELIGIBLE',
          status: 0,
        }; // The entered tic completed; never dispatch a k+1 step or release tic.
    }
    // Expiration does not release via another tic. Next accepted action replaces all keys.
    return { ...last, ...action, outcome: 'APPLIED', status: 0 };
  } catch (error) {
    return {
      ...last,
      ...action,
      outcome: 'FAULT',
      status: null,
      currentTic: 'UNKNOWN',
      error: String(error),
    };
  }
}

// These arrays are the native numerical field indices, not alphabetical lists.
const counterNames = [
  'cInit',
  'engineCreate',
  'titlePrepare',
  'nativeBuild',
  'playerEntry',
  'worldComplete',
  'outerComplete',
  'schedulerEntry',
  'netBody',
  'netIntercept',
  'wipeEntry',
  'demoLoad',
  'render',
  'frame',
  'gametic',
  'leveltime',
  'virtualTicks',
  'titleReady',
] as const;
let instance: NativeInstance;
let memory: WebAssembly.Memory;
let wad: Uint8Array<ArrayBuffer>;
let dimensions: Dimensions | undefined;
let pendingFrame: Uint8ClampedArray<ArrayBuffer> | undefined;
const logs: NonNullable<Observation['logs']> = [];
let logsTruncated = false;
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
const hash = async (bytes: BufferSource) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
function span(pointer: number, length: number) {
  const start = pointer >>> 0;
  check(
    memory &&
      Number.isSafeInteger(length) &&
      length >= 0 &&
      start <= memory.buffer.byteLength &&
      length <= memory.buffer.byteLength - start,
    'Import memory span out of bounds',
  );
  return start;
}
function log(kind: 'info' | 'error', pointer: number, length: number) {
  const start = span(pointer, length);
  check(length <= 4096, 'Oversized console message');
  if (logs.length < 128)
    logs.push({
      kind,
      text: new TextDecoder().decode(
        new Uint8Array(memory.buffer, start, length),
      ),
    });
  else logsTruncated = true;
}
function readFields<const Names extends readonly string[]>(
  names: Names,
  read: (index: number) => number,
): Record<Names[number], number> {
  return Object.fromEntries(
    names.map((name, index) => [name, read(index)]),
  ) as Record<Names[number], number>;
}
function snapshot(): Counters {
  return {
    wasiInit: instance.exports.a1WasiInitCount(),
    ...readFields(counterNames, (index) =>
      instance.exports.a1ReadCounter(index),
    ),
  };
}
function a21Observation(): NativeObservation {
  const names = [
    'build',
    'install',
    'liveEntry',
    'world',
    'status',
    'automap',
    'hud',
    'menu',
    'outer',
    'ready',
    'loadComplete',
    'resources',
    'liveActor',
    'gameEligible',
    'gamestate',
    'gameaction',
    'episode',
    'map',
    'skill',
    'playerstate',
    'health',
    'installEqual',
    'entryEqual',
    'actorEqual',
    'virtualMs',
    'vertexes',
    'lines',
    'sectors',
    'segs',
    'subsectors',
    'nodes',
    'usedown',
  ] as const;
  const fields = [
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
  ] as const;
  const read = (index: number) => instance.exports.a21ReadObservation(index);
  const extra = [
    'x',
    'y',
    'angle',
    'momx',
    'momy',
    'turnheld',
    'dclicktime',
    'dclickstate',
    'dclicks',
    'dclicktime2',
    'dclickstate2',
    'dclicks2',
    'rndindex',
    'prndindex',
    'keyUp',
    'keyRight',
    'contributorsValid',
    'buildTick',
    'reactiontime',
    'flags',
    'keyDown',
    'keyLeft',
    'keyFire',
    'keyUse',
  ] as const;
  const base = readFields(names, read);
  const loaded = base.loadComplete === 1;
  const readyWeapon = loaded ? readReadyWeapon(read) : null;
  return {
    ...base,
    ...readFields(extra, (i) =>
      extra[i] === 'angle' ? read(52 + i) >>> 0 : read(52 + i),
    ),
    built: readFields(fields, (i) => read(32 + i)),
    entered: readFields(fields, (i) => read(42 + i)),
    ...(readyWeapon
      ? readPlayerTelemetry(read, readyWeapon)
      : { armorpoints: null, readyWeapon: null, ammo: null }),
    collisionSampleTic: read(87),
    movementFlags: read(88),
    rejectionMask: read(89),
    facingKind: read(90),
    facingDoor: read(91),
    facingDistance: read(92),
  };
}
function observations(): Observation {
  return { counters: snapshot(), native: a21Observation() };
}
const imports = {
  console: {
    onInfoMessage: (p: number, n: number) => log('info', p, n),
    onErrorMessage: (p: number, n: number) => log('error', p, n),
  },
  loading: {
    onGameInit: (width: number, height: number) => {
      check(
        width === 640 && height === 400,
        'Unexpected framebuffer dimensions',
      );
      dimensions = { width, height };
    },
    wadSizes: (count: number, total: number) => {
      const c = span(count, 4),
        t = span(total, 4);
      const view = new DataView(memory.buffer);
      view.setInt32(c, 1, true);
      view.setUint32(t, wad.byteLength, true);
    },
    readWads: (destination: number, lengths: number) => {
      const d = span(destination, wad.byteLength),
        l = span(lengths, 4);
      new Uint8Array(memory.buffer, d, wad.byteLength).set(wad);
      new DataView(memory.buffer).setInt32(l, wad.byteLength, true);
    },
  },
  ui: {
    drawFrame: (pointer: number) => {
      check(
        dimensions && !pendingFrame,
        'Unexpected or duplicate frame callback',
      );
      const start = span(pointer, 1024000);
      const bgra = new Uint8Array(memory.buffer, start, 1024000);
      pendingFrame = new Uint8ClampedArray(1024000);
      for (let i = 0; i < bgra.length; i += 4) {
        pendingFrame[i] = bgra[i + 2];
        pendingFrame[i + 1] = bgra[i + 1];
        pendingFrame[i + 2] = bgra[i];
        pendingFrame[i + 3] = 255;
      }
    },
  },
  gameSaving: {
    sizeOfSaveGame: () => 0,
    readSaveGame: () => 0,
    writeSaveGame: () => 0,
  },
};
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  const started = performance.now();
  let nativeExecuting = false;
  try {
    // Keep each operation/result pair correlated through the shared send path.
    let completion: {
      [O in Operation]: Pick<Success<O>, 'op' | 'result'>;
    }[Operation];
    let pixels: ArrayBuffer | undefined;
    if (data.op === 'load-i11') {
      check(!instance, 'Already loaded');
      check(data.wasm.byteLength <= 16 * 1024 * 1024, 'Oversized WASM');
      check(
        data.wad.byteLength >= IWAD_MIN_BYTES &&
          data.wad.byteLength <= IWAD_MAX_BYTES,
        IWAD_SIZE_ERROR,
      );
      const [wasmSha256, wadSha256] = await Promise.all([
        hash(data.wasm),
        hash(data.wad),
      ]);
      wad = new Uint8Array(data.wad);
      check(
        wasmSha256 === data.expectedWasmHash,
        'A2.1 final WASM hash mismatch',
      );
      const module = await WebAssembly.compile(data.wasm);
      const expected = [
        'initControlled',
        'renderControlled',
        'prepareE1M1Controlled',
        'stepNeutralControlled',
        'a21ReadObservation',
        'a1ReadCounter',
        'a1WasiInitCount',
      ];
      const functions = WebAssembly.Module.exports(module)
        .filter((x) => x.kind === 'function')
        .map((x) => x.name)
        .sort();
      check(
        JSON.stringify(functions) === JSON.stringify(expected.sort()),
        'A2.1 function exports mismatch',
      );
      check(
        WebAssembly.Module.imports(module).length === 9 &&
          !WebAssembly.Module.imports(module).some(
            (x) => x.module === 'runtimeControl' || x.module.startsWith('wasi'),
          ),
        'A2.1 imports mismatch',
      );
      instance = (await WebAssembly.instantiate(
        module,
        imports,
      )) as NativeInstance;
      memory = instance.exports.memory;
      completion = {
        op: data.op,
        result: {
          wasmSha256,
          wadSha256,
          imports: WebAssembly.Module.imports(module),
          exports: WebAssembly.Module.exports(module),
          ...observations(),
        },
      };
    } else if (data.op === 'init') {
      nativeExecuting = true;
      const status = instance.exports.initControlled();
      nativeExecuting = false;
      completion = {
        op: data.op,
        result: { status, ...observations(), dimensions, logs, logsTruncated },
      };
    } else if (data.op === 'action') {
      completion = {
        op: data.op,
        result: i11Action(
          data.mask,
          data.tics,
          (mask) => instance.exports.stepNeutralControlled(mask),
          () => ({ ...observations(), logs: [...logs], logsTruncated }),
        ),
      };
    } else if (data.op === 'prepare') {
      nativeExecuting = true;
      const status = instance.exports.prepareE1M1Controlled();
      nativeExecuting = false;
      check(status === 0 || status === -1, 'Unexpected native status');
      completion = {
        op: data.op,
        result: {
          status,
          outcome: status === 0 ? 'APPLIED' : 'REFUSED',
          ...observations(),
          logs,
          logsTruncated,
        },
      };
    } else if (data.op === 'render') {
      nativeExecuting = true;
      const status = instance.exports.renderControlled();
      nativeExecuting = false;
      const rendered: Results['render'] = {
        status,
        ...observations(),
        dimensions,
        logs,
        logsTruncated,
      };
      if (status === -1) {
        check(!pendingFrame, 'Refused render produced a frame');
        rendered.outcome = 'REFUSED';
      } else {
        check(status === 0 && pendingFrame, 'Render did not return one frame');
        const frame = pendingFrame;
        check(
          frame.some((value, i) => i % 4 !== 3 && value !== frame[i % 4]),
          'Rendered frame has only one color',
        );
        rendered.frameSha256 = await hash(frame);
        pixels = frame.buffer;
        pendingFrame = undefined;
      }
      completion = { op: data.op, result: rendered };
    } else if (data.op === 'snapshot') {
      // Read only; no init, display or tick call.
      completion = { op: data.op, result: observations() };
    } else throw Error('Unknown operation');
    self.postMessage(
      {
        ok: true,
        ...completion,
        elapsedMs: performance.now() - started,
        pixels,
      } satisfies Reply,
      pixels ? [pixels] : [],
    );
    if ('outcome' in completion.result && completion.result.outcome === 'FAULT')
      self.close();
  } catch (error) {
    self.postMessage({
      ok: false,
      op: data.op,
      error: String(error),
      logs,
      logsTruncated,
      outcome: nativeExecuting ? 'FAULT' : 'ERROR',
      retired: true,
      isWasmRuntimeError: error instanceof WebAssembly.RuntimeError,
      ...(instance ? observations() : {}),
    } satisfies Reply);
    self.close();
  }
};
