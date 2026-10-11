// Copied verbatim from experiments/stage-a/harness.html for this isolated trial.
// i11MaskValid, i11VerifyStep, i11Action and titleWorker retain their existing behavior.
// Only the M3-E3 controller selects operations; unused acceptance modes stay dormant.
export {i11MaskValid, i11VerifyStep, i11Action, titleWorker};
function i11MaskValid(mask) {
  return Number.isInteger(mask) && mask >= 0 && mask <= 63 &&
    (mask & 5) !== 5 && (mask & 10) !== 10;
}
function i11VerifyStep(mask, before, after) {
  const require = (ok, message) => { if (!ok) throw Error(message); };
  if (after.status === -1) {
    require(JSON.stringify(before.counters) === JSON.stringify(after.counters) &&
      JSON.stringify(before.native) === JSON.stringify(after.native), 'Refusal mutated native state');
    return;
  }
  const n = before.counters.gametic, p = after.native, cmd = p.built;
  const held = (mask & 10) ? before.native.turnheld + 1 : 0;
  const turn = ((mask & 8) ? 1 : (mask & 2) ? -1 : 0) * (held < 6 ? 320 : 640);
  require(after.status === 0 && before.native.ready === 1 &&
    ['build', 'install', 'liveEntry', 'world', 'status', 'automap', 'hud', 'menu', 'outer']
      .every(k => before.native[k] === n && p[k] === n + 1) &&
    ['nativeBuild', 'playerEntry', 'worldComplete', 'outerComplete', 'gametic', 'leveltime', 'virtualTicks']
      .every(k => before.counters[k] === n && after.counters[k] === n + 1) &&
    p.virtualMs === Math.floor((n + 1) * 1000 / 35), 'Single-tic completion/clock mismatch');
  require(i11MaskValid(mask) && (n !== 0 || mask === 0) && p.buildTick === n && p.turnheld === held &&
    ['keyUp', 'keyRight', 'keyDown', 'keyLeft', 'keyFire', 'keyUse']
      .every((k, i) => p[k] === +Boolean(mask & (1 << i))) &&
    cmd.forwardmove === ((mask & 1) ? 25 : (mask & 4) ? -25 : 0) && cmd.angleturn === turn &&
    cmd.buttons === (((mask & 16) ? 1 : 0) | ((mask & 32) ? 2 : 0)) &&
    ['sidemove', 'chatchar', 'buttons2', 'inventory', 'lookfly', 'arti'].every(k => cmd[k] === 0) &&
    JSON.stringify(cmd) === JSON.stringify(p.entered) &&
    ['installEqual', 'entryEqual', 'actorEqual', 'contributorsValid'].every(k => p[k] === 1) &&
    p.usedown === +Boolean(mask & 32) && p.dclicktime === before.native.dclicktime + 1 &&
    p.dclicktime2 === before.native.dclicktime2 + 1 &&
    ['dclickstate', 'dclicks', 'dclickstate2', 'dclicks2'].every(k => p[k] === 0),
  'Native command/entry/input/history mismatch');
  // Final player angle is not a generic invariant: native weapon effects can
  // reorient after consumption. The prepared script proves isolated turns below.
  require(!after.logsTruncated && !after.logs?.some(log => log.kind === 'error') &&
    ['schedulerEntry', 'netBody', 'wipeEntry', 'demoLoad'].every(k => after.counters[k] === 0),
  'Unexpected diagnostic or scheduler work');
}

function i11Action(mask, tics, step, observe) {
  const action = {mask, requestedTics: tics, completedTics: 0, outcome: 'REFUSED', status: -1, steps: []};
  let last;
  try {
    last = observe();
    if (!i11MaskValid(mask) || !Number.isInteger(tics) || tics < 1 || tics > 20)
      return {...last, ...action, reason: 'Invalid mask/duration; no native call'};
    for (let i = 0; i < tics; ++i) {
      const status = step(mask);
      const after = {status, ...observe()};
      i11VerifyStep(mask, last, after);
      if (status === -1) return {...after, ...action};
      action.steps.push(after);
      action.completedTics++;
      last = after;
    }
    // Expiration does not release via another tic. Next accepted action replaces all keys.
    return {...last, ...action, outcome: 'APPLIED', status: 0};
  } catch (error) {
    return {...last, ...action, outcome: 'FAULT', status: null,
      currentTic: 'UNKNOWN', error: String(error)};
  }
}
function titleWorker() {
  const counterNames = ['cInit', 'engineCreate', 'titlePrepare', 'nativeBuild',
    'playerEntry', 'worldComplete', 'outerComplete', 'schedulerEntry', 'netBody',
    'netIntercept', 'wipeEntry', 'demoLoad', 'render', 'frame',
    'gametic', 'leveltime', 'virtualTicks', 'titleReady'];
  const wadHash = '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d';
  let instance, memory, wad, dimensions, pendingFrame;
  let missingIwad = false;
  let noFixtures = false;
  let a21 = false;
  let a22 = false;
  let i11 = false;
  const callbacks = {wadSizes: 0, readWads: 0, onGameInit: 0, drawFrame: 0};
  const logs = [];
  let logsTruncated = false;
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  function span(pointer, length) {
    const start = pointer >>> 0;
    check(memory && Number.isSafeInteger(length) && length >= 0 &&
      start <= memory.buffer.byteLength && length <= memory.buffer.byteLength - start,
    'Import memory span out of bounds');
    return start;
  }
  function log(kind, pointer, length) {
    const start = span(pointer, length);
    check(length <= 4096, 'Oversized console message');
    if (logs.length < 128) logs.push({kind, text: new TextDecoder().decode(
      new Uint8Array(memory.buffer, start, length))});
    else logsTruncated = true;
  }
  function snapshot() {
    return {wasiInit: instance.exports.a1WasiInitCount(), ...Object.fromEntries(
      counterNames.map((name, index) => [name, instance.exports.a1ReadCounter(index)]))};
  }
  function a21Observation() {
    const names = ['build', 'install', 'liveEntry', 'world', 'status', 'automap', 'hud', 'menu', 'outer',
      'ready', 'loadComplete', 'resources', 'liveActor', 'gameEligible', 'gamestate', 'gameaction',
      'episode', 'map', 'skill', 'playerstate', 'health', 'installEqual', 'entryEqual', 'actorEqual',
      'virtualMs', 'vertexes', 'lines', 'sectors', 'segs', 'subsectors', 'nodes', 'usedown'];
    const fields = ['forwardmove', 'sidemove', 'angleturn', 'chatchar', 'buttons', 'consistancy',
      'buttons2', 'inventory', 'lookfly', 'arti'];
    const read = index => instance.exports.a21ReadObservation(index);
    const extra = ['x', 'y', 'angle', 'momx', 'momy', 'turnheld', 'dclicktime',
      'dclickstate', 'dclicks', 'dclicktime2', 'dclickstate2', 'dclicks2', 'rndindex',
      'prndindex', 'keyUp', 'keyRight', 'contributorsValid', 'buildTick', 'reactiontime', 'flags',
      ...(i11 ? ['keyDown', 'keyLeft', 'keyFire', 'keyUse'] : [])];
    return {...Object.fromEntries(names.map((name, i) => [name, read(i)])),
      ...(a22 ? Object.fromEntries(extra.map((name, i) => [name, name === 'angle' ? read(52 + i) >>> 0 : read(52 + i)])) : {}),
      built: Object.fromEntries(fields.map((name, i) => [name, read(32 + i)])),
      entered: Object.fromEntries(fields.map((name, i) => [name, read(42 + i)]))};
  }
  function observations() {
    // Never call diagnostics in the fixture-disabled mode, including error reporting.
    return noFixtures ? {callbacks: {...callbacks}} : {counters: snapshot(), ...(a21 ? {native: a21Observation()} : {})};
  }
  function checkNoFixturesInterface(module) {
    const expectedImports = ['console.onErrorMessage', 'console.onInfoMessage',
      'gameSaving.writeSaveGame', 'gameSaving.readSaveGame', 'gameSaving.sizeOfSaveGame',
      'ui.drawFrame', 'loading.onGameInit', 'loading.readWads', 'loading.wadSizes']
      .map(name => name + ':function').sort();
    const keys = {KEY_LEFTARROW: 172, KEY_RIGHTARROW: 174, KEY_UPARROW: 173,
      KEY_DOWNARROW: 175, KEY_STRAFE_L: 160, KEY_STRAFE_R: 161, KEY_FIRE: 163,
      KEY_USE: 162, KEY_SHIFT: 182, KEY_TAB: 9, KEY_ESCAPE: 27, KEY_ENTER: 13,
      KEY_BACKSPACE: 127, KEY_ALT: 184};
    const expectedExports = ['initControlled:function', 'renderControlled:function', 'memory:memory',
      ...Object.keys(keys).map(name => name + ':global')].sort();
    check(JSON.stringify(WebAssembly.Module.imports(module)
      .map(item => item.module + '.' + item.name + ':' + item.kind).sort()) ===
      JSON.stringify(expectedImports), 'Fixture-disabled import interface mismatch');
    check(JSON.stringify(WebAssembly.Module.exports(module)
      .map(item => item.name + ':' + item.kind).sort()) === JSON.stringify(expectedExports),
    'Fixture-disabled export interface mismatch (diagnostic exports must be absent)');
    return keys;
  }
  const imports = {
    console: {
      onInfoMessage: (p, n) => log('info', p, n),
      onErrorMessage: (p, n) => log('error', p, n),
    },
    loading: {
      onGameInit: (width, height) => {
        if (noFixtures) callbacks.onGameInit++;
        if (missingIwad) {
          callbacks.onGameInit++;
          throw Error('Unexpected onGameInit during missing-IWAD test');
        }
        check(width === 640 && height === 400, 'Unexpected framebuffer dimensions');
        dimensions = {width, height};
      },
      wadSizes: (count, total) => {
        if (missingIwad || noFixtures) callbacks.wadSizes++;
        const c = span(count, 4), t = span(total, 4);
        const view = new DataView(memory.buffer);
        if (missingIwad) {
          view.setInt32(c, 0, true);
          view.setUint32(t, 0, true);
          callbacks.wadSizesResult = {count: view.getInt32(c, true), total: view.getUint32(t, true)};
          return;
        }
        view.setInt32(c, 1, true);
        view.setUint32(t, wad.byteLength, true);
      },
      readWads: (destination, lengths) => {
        if (noFixtures) callbacks.readWads++;
        if (missingIwad) {
          callbacks.readWads++;
          throw Error('Unexpected readWads during missing-IWAD test');
        }
        const d = span(destination, wad.byteLength), l = span(lengths, 4);
        new Uint8Array(memory.buffer, d, wad.byteLength).set(wad);
        new DataView(memory.buffer).setInt32(l, wad.byteLength, true);
      },
    },
    ui: {drawFrame: pointer => {
      if (noFixtures) callbacks.drawFrame++;
      if (missingIwad) {
        callbacks.drawFrame++;
        throw Error('Unexpected drawFrame during missing-IWAD test');
      }
      check(dimensions && !pendingFrame, 'Unexpected or duplicate frame callback');
      const start = span(pointer, 1024000);
      const bgra = new Uint8Array(memory.buffer, start, 1024000);
      pendingFrame = new Uint8ClampedArray(1024000);
      for (let i = 0; i < bgra.length; i += 4) {
        pendingFrame[i] = bgra[i + 2];
        pendingFrame[i + 1] = bgra[i + 1];
        pendingFrame[i + 2] = bgra[i];
        pendingFrame[i + 3] = 255;
      }
    }},
    runtimeControl: {timeInMilliseconds: () => 0n},
    gameSaving: {sizeOfSaveGame: () => 0, readSaveGame: () => 0, writeSaveGame: () => 0},
  };
  self.onmessage = async ({data}) => {
    const started = performance.now();
    let nativeExecuting = false;
    try {
      let result, pixels;
      if (data.op === 'load' || data.op === 'load-missing-iwad' || data.op === 'load-no-fixtures' || data.op === 'load-a21' || data.op === 'load-a22' || data.op === 'load-i11') {
        if (data.op === 'load-i11') i11 = a21 = a22 = true;
        if (data.op === 'load-a21' || data.op === 'load-a22') a21 = true;
        if (data.op === 'load-a22') a22 = true;
        if (data.op === 'load-no-fixtures') noFixtures = true;
        check(!instance, 'Already loaded');
        check(data.wasm.byteLength <= 16 * 1024 * 1024, 'Oversized WASM');
        missingIwad = data.op === 'load-missing-iwad';
        let wasmSha256, wadSha256;
        if (missingIwad) {
          wasmSha256 = await hash(data.wasm);
          check(wasmSha256 === 'bd4115cf78f9f2dc5e594206491398bd2b591a4e808d67f72265870051d3bb84',
            'Experiment 3 requires the proven final WASM');
        } else {
          check(data.wad.byteLength === 28795076, 'Unexpected Freedoom length');
          [wasmSha256, wadSha256] = await Promise.all([hash(data.wasm), hash(data.wad)]);
          check(wadSha256 === wadHash, 'Freedoom hash mismatch');
          wad = new Uint8Array(data.wad);
        }
        if (noFixtures) check(wasmSha256 ===
          '647ee4031a4067639a915aa2747f0613f3f0997bc1bcd6797a50256946cae1fd',
        'Fixture-disabled final WASM hash mismatch');
        if (a21) check(wasmSha256 === data.expectedWasmHash, 'A2.1 final WASM hash mismatch');
        const module = await WebAssembly.compile(data.wasm);
        if (a21) {
          const expected = ['initControlled', 'renderControlled', 'prepareE1M1Controlled',
            'stepNeutralControlled', 'a21ReadObservation', 'a1ReadCounter', 'a1WasiInitCount'];
          const functions = WebAssembly.Module.exports(module).filter(x => x.kind === 'function').map(x => x.name).sort();
          check(JSON.stringify(functions) === JSON.stringify(expected.sort()), 'A2.1 function exports mismatch');
          check(WebAssembly.Module.imports(module).length === 9 &&
            !WebAssembly.Module.imports(module).some(x => x.module === 'runtimeControl' || x.module.startsWith('wasi')),
          'A2.1 imports mismatch');
        }
        const keys = noFixtures ? checkNoFixturesInterface(module) : undefined;
        instance = await WebAssembly.instantiate(module, imports);
        memory = instance.exports.memory;
        if (noFixtures) {
          check(memory instanceof WebAssembly.Memory && memory.buffer.byteLength === 524288,
            'Fixture-disabled initial memory mismatch');
          check(instance.exports.initControlled.length === 0 && instance.exports.renderControlled.length === 0,
            'Fixture-disabled function arity mismatch');
          check(Object.entries(keys).every(([name, value]) =>
            instance.exports[name] instanceof WebAssembly.Global && instance.exports[name].value === value),
          'Fixture-disabled key globals mismatch');
        }
        result = {wasmSha256, wadSha256,
          imports: WebAssembly.Module.imports(module), exports: WebAssembly.Module.exports(module),
          ...observations()};
        // The exact pinned bytes were statically inspected as () -> i32 for both functions.
        // Browser reflection checks names/kinds/arity; it does not expose result types.
        if (noFixtures) result.interfaceCheck = {imports: 9, exports: 17, diagnosticsAbsent: true,
          functionSignatures: 'initControlled() -> i32; renderControlled() -> i32',
          signatureEvidence: 'Pinned SHA-256 of the statically typed-inspected final artifact'};
      } else if (data.op === 'init' || (noFixtures && data.op === 'init-again')) {
        nativeExecuting = true;
        const status = instance.exports.initControlled();
        nativeExecuting = false;
        result = {status, ...observations(), dimensions, logs, logsTruncated};
        if (noFixtures) result.expectedRefusal = data.op === 'init-again';
        // Negative-test modes transport actual native statuses for main-thread assertions.
        if (!missingIwad && !noFixtures && !a21)
          check(status === 0, 'Controlled initialization refused: ' + status);
      } else if (data.op === 'action') {
        check(i11, 'Finite action requires Issue #11 mode');
        result = i11Action(data.mask, data.tics,
          mask => instance.exports.stepNeutralControlled(mask),
          () => ({...observations(), logs: [...logs], logsTruncated}));
      } else if (data.op === 'prepare' || data.op === 'step' || data.op === 'step-invalid') {
        check(a21, 'A2.1 operation requires the A2.1 artifact');
        nativeExecuting = true;
        const status = data.op === 'prepare' ? instance.exports.prepareE1M1Controlled() :
          instance.exports.stepNeutralControlled(a22 ? data.input : data.op === 'step-invalid' ? 1 : 0);
        nativeExecuting = false;
        check(status === 0 || status === -1, 'Unexpected native status');
        result = {status, outcome: status === 0 ? 'APPLIED' : 'REFUSED', ...observations(), logs, logsTruncated};
      } else if (data.op === 'render') {
        nativeExecuting = true;
        const status = instance.exports.renderControlled();
        nativeExecuting = false;
        result = {status, ...observations(), dimensions, logs, logsTruncated};
        if (a21 && status === -1) {
          check(!pendingFrame, 'Refused render produced a frame');
          result.outcome = 'REFUSED';
        } else {
          check(status === 0 && pendingFrame, 'Render did not return one frame');
          check(pendingFrame.some((value, i) => i % 4 !== 3 && value !== pendingFrame[i % 4]),
            'Rendered frame has only one color');
          result.frameSha256 = await hash(pendingFrame);
          pixels = pendingFrame.buffer;
          pendingFrame = undefined;
        }
      } else if (data.op === 'snapshot') {
        check(!noFixtures, 'Native snapshot unavailable without fixtures');
        result = observations(); // Read only; no init, display or tick call.
      } else throw Error('Unknown operation');
      if (missingIwad) {
        result.callbacks = {...callbacks};
        result.frameProduced = Boolean(pendingFrame);
      }
      self.postMessage({ok: true, op: data.op, elapsedMs: performance.now() - started,
        result, pixels}, pixels ? [pixels] : []);
      if (result.outcome === 'FAULT') self.close();
    } catch (error) {
      self.postMessage({ok: false, op: data.op, error: String(error), logs, logsTruncated,
        ...(a21 ? {outcome: nativeExecuting ? 'FAULT' : 'ERROR', retired: true, isWasmRuntimeError: error instanceof WebAssembly.RuntimeError} : {}),
        ...(instance ? observations() : {}),
        ...(missingIwad ? {callbacks: {...callbacks}, frameProduced: Boolean(pendingFrame)} : {})});
      if (a21) self.close();
    }
  };
}
