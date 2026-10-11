import {OpenAI} from 'openai/client';
import {VERSION} from 'openai/version';
import rawWorker from './worker-boundary.js?raw';
import {i11VerifyStep} from './worker-boundary.js';
import type {Counters, NativeObservation, NativeWork, Observation} from './worker-boundary.js';
import {classicWorkerSource} from './worker-source.js';
import './style.css';

type Elements = {
  '#screen': HTMLCanvasElement;
  '#iwad': HTMLInputElement;
  '#prepare': HTMLButtonElement;
  '#sdk': HTMLParagraphElement;
  '#status': HTMLParagraphElement;
  '#frame': HTMLParagraphElement;
  '#evidence': HTMLPreElement;
};
// These elements are supplied by the static HTML entry; the Canvas is 640×400.
const $ = <S extends keyof Elements>(selector: S) => document.querySelector<Elements[S]>(selector)!;
const canvas = $('#screen'), context = canvas.getContext('2d')!;
function check(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message); }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const digest = async (bytes: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
const wadHash = '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d';
const passive = ['wasiInit', 'cInit', 'engineCreate', 'titlePrepare', 'titleReady', 'nativeBuild',
  'playerEntry', 'worldComplete', 'outerComplete', 'schedulerEntry', 'netBody', 'wipeEntry',
  'demoLoad', 'gametic', 'leveltime', 'virtualTicks'] as const satisfies readonly (keyof Counters)[];
const work = ['build', 'install', 'liveEntry', 'world', 'status', 'automap', 'hud', 'menu', 'outer'] as const satisfies readonly NativeWork[];

type EngineMetadata = {
  profile: 'controlled-title'; a1Fixtures: true; embeddedIwad: false; bytes: number; sha256: string;
};
type SdkProbe = {version: string; decisionsCreateAvailable: true; requestsEnabled: false};
type StatusObservation = Observation & {status: number | null};
type Results = {
  'load-i11': Observation & {wasmSha256: string; wadSha256: string};
  init: StatusObservation;
  prepare: StatusObservation;
  snapshot: Observation;
  render: StatusObservation & {dimensions?: {width: number; height: number}; frameSha256?: string};
  action: StatusObservation & {
    mask: number; requestedTics: number; completedTics: number;
    outcome: 'APPLIED' | 'REFUSED' | 'FAULT'; steps: StatusObservation[];
  };
};
type Operation = keyof Results;
type RequestExtra = {
  'load-i11': {wasm: ArrayBuffer; wad: ArrayBuffer; expectedWasmHash: string};
  action: {mask: number; tics: number};
};
type Success<O extends Operation> = {ok: true; op: O; elapsedMs: number; result: Results[O]; pixels?: ArrayBuffer};
type Reply<O extends Operation> = Success<O> | {ok: false; op: O; error?: unknown};
type NeutralEvidence = {
  mask: number; requestedTics: number; reportedCompletedTics: number | null;
  independentlyVerifiedTics: number; completionUncertain: boolean;
};
type Evidence = {
  sdk: SdkProbe; engine: EngineMetadata;
  operations: {op: Operation; elapsedMs: number; result: Results[Operation]}[];
  frames: {tic: number; nativeSha256: string; canvasSha256: string}[];
  activeOperation?: Operation; workerError?: string; error?: string;
  assets?: {wasm: {bytes: number; sha256: string}; iwad: {bytes: number; sha256: string}};
  beforeNeutral?: {counters: Counters; native: NativeObservation};
  neutralFirst?: NeutralEvidence;
  idle?: {minimumMs: number; observedMs: number; unchanged: boolean; before: Observation; after: Observation};
};
type Run = {
  valid: boolean; evidence: Evidence; worker?: Worker | null; url?: string | null;
  cancel?: ((error: Error) => void) | null; last?: Observation;
};
let engine: EngineMetadata | undefined, sdk: SdkProbe | undefined, current: Run | undefined;

function localFetch(name: string, json: true): Promise<unknown>;
function localFetch(name: string, json?: false): Promise<ArrayBuffer>;
async function localFetch(name: string, json = false): Promise<unknown> {
  const response = await fetch(import.meta.env.BASE_URL + name, {credentials: 'omit', cache: 'no-store'});
  check(response.ok, `Cannot load bundled ${name} (HTTP ${response.status}).`);
  return json ? response.json() : response.arrayBuffer();
}
function assertCurrent(run: Run): asserts run is Run & {worker: Worker} {
  check(current === run && run.valid && run.worker, 'Preparation retired; no further native calls.');
}
function display(run: Run, status?: string) {
  if (current !== run) return;
  if (status) $('#status').textContent = status;
  $('#evidence').textContent = JSON.stringify(run.evidence, null, 2);
}
function retire(run: Run) {
  run.valid = false;
  run.worker?.terminate();
  run.worker = null;
  if (run.url) URL.revokeObjectURL(run.url);
  run.url = null;
  run.cancel?.(Error('Worker retired; pending completion unknown.'));
}
function passiveCheck(before: Observation, after: Observation) {
  check(passive.every(k => before.counters[k] === after.counters[k]) && equal(before.native, after.native),
    'Passive operation changed native work, commands or time.');
}
function healthy(result: Observation) {
  check(!result.logsTruncated && !result.logs?.some(log => log.kind === 'error'),
    'Native diagnostics reported an error or truncation.');
}
function checkPrepared(op: 'init' | 'prepare', result: StatusObservation) {
  healthy(result);
  check(result.status === 0 && work.every(k => result.native[k] === 0) &&
    (['nativeBuild', 'playerEntry', 'worldComplete', 'outerComplete', 'gametic', 'leveltime', 'virtualTicks'] as const)
      .every(k => result.counters[k] === 0) && result.native.virtualMs === 0, 'Hidden init/preparation tic.');
  check((['wasiInit', 'cInit', 'engineCreate', 'titlePrepare'] as const).every(k => result.counters[k] === 1) &&
    result.counters.titleReady === (op === 'init' ? 1 : 0), 'One-shot init/title readiness mismatch.');
  if (op === 'prepare') check((['ready', 'loadComplete', 'resources', 'liveActor', 'gameEligible', 'contributorsValid'] as const)
    .every(k => result.native[k] === 1) && result.native.episode === 1 && result.native.map === 1 &&
    result.native.skill === 2 && result.native.playerstate === 0 && result.native.health > 0 &&
    result.native.gamestate === 0 && result.native.gameaction === 0, 'Genuine E1M1 READY failed.');
}
async function request<O extends Operation>(run: Run, op: O,
  ...args: O extends keyof RequestExtra ? [extra: RequestExtra[O], transfer?: Transferable[]] : [extra?: undefined, transfer?: Transferable[]]
): Promise<Success<O>> {
  const [extra = {}, transfer = []] = args;
  assertCurrent(run);
  check(!run.cancel, 'Overlapping Worker operation refused.');
  run.evidence.activeOperation = op;
  display(run);
  const worker = run.worker;
  return new Promise<Success<O>>((resolve, reject) => {
    let settled = false;
    const finish = (...outcome: [error: unknown] | [error: null, data: Success<O>]) => {
      const [error, data] = outcome;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      run.cancel = null;
      if (error) { retire(run); reject(error); } else resolve(data!);
    };
    const timer = setTimeout(() => finish(Error(`${op} watchdog expired (2000 ms); completion unknown.`)), 2000);
    run.cancel = error => finish(error);
    worker.onerror = () => finish(Error(`${op} Worker fault; completion unknown.`));
    worker.onmessageerror = () => finish(Error(`${op} Worker reply unreadable; completion unknown.`));
    worker.onmessage = ({data: incoming}: MessageEvent<unknown>) => {
      try {
        assertCurrent(run);
        check(incoming !== null && typeof incoming === 'object' && 'op' in incoming && incoming.op === op,
          'Unexpected Worker reply; completion unknown.');
        // The exact bundled Worker owns this receipt shape. This assertion is a
        // protocol contract, not payload validation; native checks below still run.
        const data = incoming as Reply<O>;
        if (!data.ok) {
          // The Worker has no credential; retain only its bounded diagnostic.
          run.evidence.workerError = typeof data.error === 'string' ? data.error.slice(0, 500) : 'Worker operation failed.';
          throw Error(run.evidence.workerError);
        }
        run.evidence.operations.push({op, elapsedMs: data.elapsedMs, result: data.result});
        delete run.evidence.activeOperation;
        healthy(data.result);
        finish(null, data);
      } catch (error) { finish(error); }
    };
    try { worker.postMessage({op, ...extra}, transfer); }
    catch { finish(Error(`${op} dispatch failed; completion unknown.`)); }
  });
}
async function snapshot(run: Run) {
  const before = run.last;
  check(before, 'Snapshot requires a prior native observation.');
  const {result} = await request(run, 'snapshot');
  assertCurrent(run);
  passiveCheck(before, result);
  check(equal(before.counters, result.counters), 'Snapshot changed counters.');
  run.last = result;
  return result;
}
async function render(run: Run) {
  const before = run.last;
  check(before, 'Render requires a prior native observation.');
  const {result, pixels} = await request(run, 'render');
  assertCurrent(run);
  passiveCheck(before, result);
  check(result.status === 0 && pixels?.byteLength === 1024000 &&
    result.dimensions?.width === 640 && result.dimensions?.height === 400 &&
    typeof result.frameSha256 === 'string' && /^[a-f0-9]{64}$/.test(result.frameSha256), 'Missing real 640×400 Doom frame.');
  check(result.counters.render === before.counters.render + 1 && result.counters.frame === before.counters.frame + 1 &&
    result.counters.netIntercept === before.counters.netIntercept + 5 && result.counters.gametic === 1,
    'Passive render cadence/tic mismatch.');
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), 640, 400), 0, 0);
  const canvasSha256 = await digest(context.getImageData(0, 0, 640, 400).data);
  assertCurrent(run);
  check(canvasSha256 === result.frameSha256, 'Canvas pixels differ from native frame.');
  run.last = result;
  run.evidence.frames.push({tic: 1, nativeSha256: result.frameSha256, canvasSha256});
  $('#frame').textContent = `E1M1 · tic 1 · 640×400 · RGBA SHA-256 ${canvasSha256}`;
}

$('#prepare').addEventListener('click', async () => {
  // Busy/successful runs cannot prepare again. A failed attempt gets a fresh Worker.
  if (!engine || !sdk || current?.valid) return;
  const file = $('#iwad').files?.[0];
  if (!file) { $('#status').textContent = 'Select your local Freedoom Phase 1 IWAD first.'; return; }
  const run: Run = {valid: true, evidence: {sdk, engine, operations: [], frames: []}};
  current = run;
  $('#prepare').disabled = $('#iwad').disabled = true;
  context.clearRect(0, 0, 640, 400);
  $('#frame').textContent = 'No frame rendered for this preparation.';
  display(run, 'Preparing fresh E1M1…');
  try {
    check(file.size === 28795076, 'Require the known-good Freedoom 0.13.0 Phase 1 IWAD (28,795,076 bytes).');
    const [wasm, wad] = await Promise.all([localFetch('doom.wasm'), file.arrayBuffer()]);
    check(current === run && run.valid, 'Preparation invalidated during asset reading.');
    check(wasm.byteLength === engine.bytes && await digest(wasm) === engine.sha256, 'Bundled WASM length/hash mismatch.');
    check(current === run && run.valid, 'Preparation invalidated during asset verification.');
    run.url = URL.createObjectURL(new Blob([classicWorkerSource(rawWorker)], {type: 'text/javascript'}));
    run.worker = new Worker(run.url); // Classic Worker; raw function names stay intact.
    const {result: loaded} = await request(run, 'load-i11', {wasm, wad, expectedWasmHash: engine.sha256}, [wasm, wad]);
    check(loaded.wasmSha256 === engine.sha256 && loaded.wadSha256 === wadHash &&
      Object.values(loaded.counters).every(value => value === 0), 'Asset identity/pre-init counters mismatch.');
    run.evidence.assets = {wasm: {bytes: engine.bytes, sha256: loaded.wasmSha256},
      iwad: {bytes: file.size, sha256: loaded.wadSha256}};
    run.last = loaded;
    for (const op of ['init', 'prepare'] as const) {
      const {result} = await request(run, op);
      checkPrepared(op, result);
      run.last = result;
    }
    const before = await snapshot(run);
    run.evidence.beforeNeutral = {counters: before.counters, native: before.native};
    const neutral: NeutralEvidence = run.evidence.neutralFirst = {mask: 0, requestedTics: 1,
      reportedCompletedTics: null, independentlyVerifiedTics: 0, completionUncertain: true};
    // The only action dispatch in M4-B. Never retry it on this Worker.
    const {result} = await request(run, 'action', {mask: 0, tics: 1});
    neutral.reportedCompletedTics = result.completedTics;
    check(result.mask === 0 && result.requestedTics === 1 && result.completedTics === 1 &&
      result.steps?.length === 1 && result.outcome === 'APPLIED' && result.status === 0,
      'Neutral action incomplete; retire without retry.');
    i11VerifyStep(0, before, result.steps[0]);
    neutral.independentlyVerifiedTics = 1;
    check(equal(result.steps[0].counters, result.counters) && equal(result.steps[0].native, result.native) &&
      result.native.ready === 1 && result.counters.gametic === 1, 'Neutral action completion mismatch.');
    neutral.completionUncertain = false;
    run.last = result;
    await render(run);
    await snapshot(run);
    await snapshot(run);
    await render(run); // One passive render demonstrates isolation, never another action.
    check(run.evidence.frames[0].nativeSha256 === run.evidence.frames[1].nativeSha256,
      'Passive render changed the frame.');
    const beforeIdle = await snapshot(run), started = performance.now();
    display(run, 'One neutral tic verified (1/1/1). Checking five seconds of idle…');
    await new Promise(resolve => setTimeout(resolve, 5000)); // One diagnostic wait; no simulation loop.
    assertCurrent(run);
    const afterIdle = await snapshot(run);
    check(equal(beforeIdle.counters, afterIdle.counters) && equal(beforeIdle.native, afterIdle.native) &&
      afterIdle.counters.gametic === 1, 'Idle advanced native state.');
    run.evidence.idle = {minimumMs: 5000, observedMs: Math.round(performance.now() - started),
      unchanged: true, before: beforeIdle, after: afterIdle};
    display(run, 'Prepared E1M1 — neutral tic 1/1/1; snapshots, passive render and five-second idle unchanged.');
  } catch (error) {
    retire(run);
    run.evidence.error = error instanceof Error ? error.message.slice(0, 500) : 'Preparation failed.';
    display(run, `Preparation failed: ${run.evidence.error} Select the correct IWAD and retry with a fresh Worker.`);
    $('#prepare').disabled = $('#iwad').disabled = false;
  }
});
window.addEventListener('pagehide', () => { if (current) retire(current); });

async function initialize() {
  try {
    check(VERSION === '7.32.0', 'Require official OpenAI SDK 7.32.0.');
    const client = new OpenAI({apiKey: 'm4b-placeholder-not-a-credential', dangerouslyAllowBrowser: true,
      maxRetries: 0, logLevel: 'off', fetch: async () => { throw Error('M4-B SDK requests are disabled.'); }});
    check(typeof client.decisions?.create === 'function', 'Bundled SDK lacks decisions.create.');
    sdk = {version: VERSION, decisionsCreateAvailable: true, requestsEnabled: false};
    $('#sdk').textContent = `OpenAI SDK ${VERSION} loaded · decisions.create available · requests disabled`;
    const metadata = await localFetch('doom-build.json', true);
    check(metadata !== null && typeof metadata === 'object' &&
      'profile' in metadata && metadata.profile === 'controlled-title' &&
      'a1Fixtures' in metadata && metadata.a1Fixtures === true &&
      'embeddedIwad' in metadata && metadata.embeddedIwad === false &&
      'bytes' in metadata && typeof metadata.bytes === 'number' && Number.isInteger(metadata.bytes) &&
      metadata.bytes > 0 && metadata.bytes <= 16 * 1024 * 1024 &&
      'sha256' in metadata && typeof metadata.sha256 === 'string' && /^[a-f0-9]{64}$/.test(metadata.sha256),
      'Invalid generated engine identity. Run ./build.sh.');
    engine = metadata as EngineMetadata;
    $('#status').textContent = 'Ready — select your local IWAD, then Prepare Doom.';
    $('#prepare').disabled = false;
  } catch (error) {
    $('#status').textContent = `Startup failed: ${error instanceof Error ? error.message.slice(0, 500) : 'SDK/engine loading failed.'}`;
  }
}
initialize();
