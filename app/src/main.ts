import { OpenAI } from 'openai/client';
import { VERSION } from 'openai/version';
import type { ActionName, Attempt, Execution, Phase } from './decision';
import {
  admitDecision,
  assertDecision,
  masks,
  validateChoice,
  verifyAction,
} from './decision';
import { createDecisionHistory } from './decision-history';
import { projectLatestOutcome } from './latest-outcome';
import type {
  Counters,
  E1M1Assessment,
  NativeObservation,
  NativeWork,
  Observation,
  Operation,
  Reply,
  RequestExtra,
  Results,
  StatusObservation,
  Success,
} from './worker-shared.ts';
import './style.css';

type Elements = {
  '#screen': HTMLCanvasElement;
  '#iwad': HTMLInputElement;
  '#key': HTMLInputElement;
  '#key-state': HTMLParagraphElement;
  '#setup': HTMLElement;
  '#setup-title': HTMLHeadingElement;
  '#setup-asset': HTMLSpanElement;
  '#setup-client': HTMLSpanElement;
  '#tics': HTMLInputElement;
  '#next': HTMLButtonElement;
  '#start': HTMLButtonElement;
  '#stop': HTMLButtonElement;
  '#budget': HTMLInputElement;
  '#continuous-state': HTMLParagraphElement;
  '#history': HTMLOListElement;
  '#history-empty': HTMLParagraphElement;
  '#outcome-number': HTMLSpanElement;
  '#outcome-action': HTMLSpanElement;
  '#outcome-evidence': HTMLParagraphElement;
  '#sdk': HTMLParagraphElement;
  '#status': HTMLParagraphElement;
  '#frame': HTMLParagraphElement;
  '#evidence': HTMLPreElement;
};
// These elements are supplied by the static HTML entry; the Canvas is 640×400.
const $ = <S extends keyof Elements>(selector: S) => {
  const element = document.querySelector<Elements[S]>(selector);
  check(element, `Missing required element ${selector}.`);
  return element;
};
const canvas = $('#screen'),
  context = canvasContext(canvas);
function canvasContext(screen: HTMLCanvasElement) {
  const result = screen.getContext('2d');
  check(result, 'Canvas 2D context unavailable.');
  return result;
}
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
const wadHash =
  '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d';
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

type EngineMetadata = {
  profile: 'controlled-title';
  a1Fixtures: true;
  embeddedIwad: false;
  bytes: number;
  sha256: string;
};
type SdkProbe = {
  version: string;
  decisionsCreateAvailable: true;
  requestsEnabled: true;
};
type Frame = { tic: number; nativeSha256: string; canvasSha256: string };
type DecisionEntry = {
  number: number;
  selectedTics: number;
  status: string;
  action: ActionName | null;
  observation: Frame | null;
  result: Frame | null;
  execution: Execution | null;
  cumulativeVerifiedTics: number;
  requestId: string | null;
  latencyMs: number | null;
  http: number | null;
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
  valid: boolean;
  phase: Phase;
  verifiedTics: number;
  frame?: Frame;
  attempt?: Attempt;
  client?: OpenAI;
  apiController?: AbortController;
  sdkRead?: Promise<void>;
  continuous?: ContinuousRun;
  evidence: Evidence;
  worker?: Worker | null;
  cancel?: ((error: Error) => void) | null;
  last?: Observation;
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
type DecisionOutcome =
  | 'completed'
  | 'not-admitted'
  | 'api-failure'
  | 'stopped'
  | 'terminal'
  | 'retired';
let engine: EngineMetadata | undefined,
  sdk: SdkProbe | undefined,
  current: Run | undefined;
let pageExited = false;

function localFetch(name: string, json: true): Promise<unknown>;
function localFetch(name: string, json?: false): Promise<ArrayBuffer>;
async function localFetch(name: string, json = false): Promise<unknown> {
  const response = await fetch(import.meta.env.BASE_URL + name, {
    credentials: 'omit',
    cache: 'no-store',
  });
  check(response.ok, `Cannot load bundled ${name} (HTTP ${response.status}).`);
  return json ? response.json() : response.arrayBuffer();
}
function assertCurrent(run: Run): asserts run is Run & { worker: Worker } {
  check(
    current === run && run.valid && run.worker,
    'Game retired; no further native calls.',
  );
}
function displaySetupStatus(run: Run) {
  const prepared =
    run.valid &&
    (run.phase === 'ready' || run.phase === 'busy') &&
    !!run.evidence.neutralFirst?.complete &&
    !!run.frame;
  const file = $('#iwad').files?.[0];
  $('#setup-title').textContent = prepared ? 'Setup & key' : 'Set up Doom';
  $('#setup-asset').textContent = file
    ? `${file.name} · ${prepared ? 'prepared' : 'selected'}`
    : '';
  $('#setup-client').textContent = run.client
    ? 'API client retained · authentication unverified'
    : 'Temporary OpenAI API key required';
}
const displayHistory = createDecisionHistory(
  $('#history'),
  $('#history-empty'),
);
function display(run: Run, status?: string) {
  if (current !== run) return;
  if (status) $('#status').textContent = status;
  $('#status').dataset.phase = run.phase;
  $('#evidence').textContent = JSON.stringify(run.evidence, null, 2);
  const continuous = run.continuous;
  const ready =
    run.valid &&
    run.phase === 'ready' &&
    !run.terminal &&
    !run.sdkRead &&
    !continuous?.active;
  $('#next').disabled = !ready;
  $('#start').disabled = !ready;
  $('#budget').disabled = !ready;
  $('#key').disabled = !ready;
  $('#stop').disabled = !continuous?.active || continuous.stopRequested;
  $('#tics').disabled = !(
    ready ||
    (run.valid && continuous?.active && !continuous.stopRequested)
  );
  const continuousStatus = continuous?.active
    ? continuous.stopRequested
      ? continuous.dispatched
        ? 'Stopping after current decision'
        : 'Stopping before native dispatch'
      : 'Running'
    : continuous
      ? `${run.phase === 'terminal' ? 'Terminal' : 'Stopped'}: ${continuous.reason}`
      : 'Continuous mode stopped';
  $('#continuous-state').textContent =
    `${continuousStatus}${continuous ? ` · API attempts ${continuous.used} / ${continuous.limit}` : ''} · verified tic ${run.verifiedTics}${run.sdkRead ? ' · waiting for API response cleanup' : ''}`;
  $('#iwad').disabled = run.phase !== 'unprepared';
  $('#next').setAttribute('aria-busy', String(run.phase === 'busy'));
  $('#key-state').textContent = run.client
    ? 'Client in memory; blank keeps it. Authentication unverified.'
    : 'No client in memory. Enter a key when the game is ready.';
  displayHistory(run.evidence.decisions);
  const outcome = projectLatestOutcome(
    run.evidence.decisions.at(-1),
    run.frame,
  );
  $('#outcome-number').textContent = outcome.number;
  $('#outcome-number').hidden = !outcome.number;
  $('#outcome-action').textContent = outcome.action;
  $('#outcome-evidence').textContent = outcome.evidence;
  $('#outcome-evidence').hidden = !outcome.evidence;
  displaySetupStatus(run);
}
function retire(run: Run, phase: 'error' | 'terminal' = 'error') {
  run.valid = false;
  run.phase = phase;
  run.attempt = undefined;
  run.apiController?.abort();
  run.apiController = undefined;
  run.client = undefined;
  $('#key').value = '';
  run.worker?.terminate();
  run.worker = null;
  run.cancel?.(Error('Worker retired; pending completion unknown.'));
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
function passiveCheck(before: Observation, after: Observation) {
  check(
    passive.every((k) => before.counters[k] === after.counters[k]) &&
      equal(before.native, after.native),
    'Passive operation changed native work, commands or time.',
  );
}
function healthy(result: Pick<Observation, 'logs' | 'logsTruncated'>) {
  check(
    !result.logsTruncated && !result.logs?.some((log) => log.kind === 'error'),
    'Native diagnostics reported an error or truncation.',
  );
}
function checkPrepared(op: 'init' | 'prepare', result: StatusObservation) {
  healthy(result);
  check(
    result.status === 0 &&
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
async function request<O extends Operation>(
  run: Run,
  op: O,
  ...args: O extends keyof RequestExtra
    ? [extra: RequestExtra[O], transfer?: Transferable[]]
    : [extra?: undefined, transfer?: Transferable[]]
): Promise<Success<O>> {
  const [extra = {}, transfer = []] = args;
  assertCurrent(run);
  check(
    op !== 'action' || !run.terminal,
    'Terminal game; no further native gameplay.',
  );
  check(!run.cancel, 'Overlapping Worker operation refused.');
  run.evidence.activeOperation = op;
  display(run);
  const worker = run.worker;
  return new Promise<Success<O>>((resolve, reject) => {
    let settled = false;
    const finish = (
      ...outcome: [error: unknown] | [error: null, data: Success<O>]
    ) => {
      const [error, data] = outcome;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      run.cancel = null;
      if (error) {
        retire(run);
        reject(error);
      } else if (data) resolve(data);
      else {
        retire(run);
        reject(Error('Missing Worker completion receipt.'));
      }
    };
    const timer = setTimeout(
      () =>
        finish(Error(`${op} watchdog expired (2000 ms); completion unknown.`)),
      2000,
    );
    run.cancel = (error) => finish(error);
    worker.onerror = () =>
      finish(Error(`${op} Worker fault; completion unknown.`));
    worker.onmessageerror = () =>
      finish(Error(`${op} Worker reply unreadable; completion unknown.`));
    worker.onmessage = ({ data: incoming }: MessageEvent<unknown>) => {
      try {
        assertCurrent(run);
        check(
          incoming !== null &&
            typeof incoming === 'object' &&
            'op' in incoming &&
            incoming.op === op,
          'Unexpected Worker reply; completion unknown.',
        );
        // The exact bundled Worker owns this receipt shape. This assertion is a
        // protocol contract, not payload validation; native checks below still run.
        const data = incoming as Reply<O>;
        if (!data.ok) {
          // The Worker has no credential; retain only its bounded diagnostic.
          run.evidence.workerError =
            typeof data.error === 'string'
              ? data.error.slice(0, 500)
              : 'Worker operation failed.';
          throw Error(run.evidence.workerError);
        }
        run.evidence.operations.push({
          op,
          elapsedMs: data.elapsedMs,
          result: data.result,
        });
        delete run.evidence.activeOperation;
        // An action fault can still contain independently verifiable completed
        // steps. The action verifier must evaluate those before rejecting it.
        if (op !== 'action') healthy(data.result);
        finish(null, data);
      } catch (error) {
        finish(error);
      }
    };
    try {
      worker.postMessage({ op, ...extra }, transfer);
    } catch {
      finish(Error(`${op} dispatch failed; completion unknown.`));
    }
  });
}
async function snapshot(run: Run) {
  const before = run.last;
  check(before, 'Snapshot requires a prior native observation.');
  const { result } = await request(run, 'snapshot');
  assertCurrent(run);
  passiveCheck(before, result);
  check(equal(before.counters, result.counters), 'Snapshot changed counters.');
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
  context.putImageData(new ImageData(rgba, 640, 400), 0, 0);
  const canvasSha256 = await digest(context.getImageData(0, 0, 640, 400).data);
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
  $('#frame').textContent =
    `E1M1 · tic ${run.verifiedTics} · 640×400 · RGBA SHA-256 ${canvasSha256}`;
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
  return evidence;
}

const deadlineMs = 10000;
class DecisionFailure extends Error {}
class DecisionStopped extends Error {}
const safeRequestId = (value: unknown) =>
  typeof value === 'string' && /^req_[A-Za-z0-9_-]{1,200}$/.test(value)
    ? value
    : null;
function createClient(apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.openai.com/v1',
    organization: null,
    project: null,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: deadlineMs,
    logLevel: 'off',
    fetchOptions: {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    },
  });
}
function fence(run: Run, attempt: Attempt) {
  assertCurrent(run);
  assertDecision(run, attempt);
}
async function decide(
  run: Run,
  attempt: Attempt,
  entry: DecisionEntry,
  png: string,
  continuous?: ContinuousRun,
) {
  fence(run, attempt);
  check(!run.terminal, 'Terminal game; no further Decisions requests.');
  check(run.client, 'A temporary API credential is required.');
  check(!run.sdkRead, 'Previous SDK response still pending.');
  const controller = new AbortController();
  run.apiController = controller;
  const started = performance.now();
  let timedOut = false;
  const abortError = () =>
    new DecisionFailure(
      timedOut ? 'API deadline exceeded (10 seconds)' : 'API request aborted',
    );
  let onAbort = () => {
    // Replaced synchronously by the Promise executor below.
  };
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError());
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  // A synchronous SDK failure can happen before the response race is installed.
  void cancelled.catch(() => {});
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadlineMs);
  const checkDeadline = () => {
    if (performance.now() - started >= deadlineMs) {
      timedOut = true;
      controller.abort();
    }
    if (controller.signal.aborted) throw abortError();
    fence(run, attempt);
  };
  try {
    checkDeadline();
    if (continuous) {
      if (continuous.stopRequested) throw new DecisionStopped();
      check(continuous.used < continuous.limit, 'Continuous budget exhausted.');
      continuous.used++;
    }
    // Both response helpers observe this ONE SDK promise; neither retries nor
    // another call is used to obtain a request ID or parsed body.
    const pending = run.client.decisions.create(
      {
        model: 'gpt-6-luna',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `This is the currently rendered Doom E1M1 frame at verified tic ${entry.observation?.tic}. You have only this image, not full game state.`,
              },
              { type: 'input_image', image_url: png },
            ],
          },
        ],
        questions: [
          {
            type: 'choice',
            name: 'next_action',
            instructions: `Explore the level and progress toward the exit while surviving. Choose one useful action from the screenshot; moving or turning to explore is generally preferable to standing still. Choose neutral when waiting has a tactical benefit. The human selected exactly ${attempt.tics} gameplay tics for this action. Choose only the action, never its duration. The game advances only through verified actions admitted by manual steps or explicitly started continuous mode; API waits do not advance gameplay. Do not assume unseen game state.`,
            choices: Object.keys(masks).map((value) => ({ value })),
          },
        ],
      },
      { signal: controller.signal, maxRetries: 0, timeout: deadlineMs },
    );
    // Observe the public raw Response BEFORE starting SDK parsing. In 7.32.0,
    // withResponse() can reject on Abort/timeout while response.text() still runs.
    // Delegate the exact read and all decoding/error/response selection to the SDK.
    let bodyRead: Promise<void> | undefined;
    let restoreText: (() => void) | undefined;
    const headers = Promise.resolve().then(async () => {
      const response = await pending.asResponse();
      const text = response.text;
      response.text = () => {
        const reading = text.call(response);
        bodyRead = reading.then(
          () => {},
          () => {},
        );
        return reading;
      };
      restoreText = () => {
        response.text = text;
      };
      return response;
    });
    const body = headers.then(() => pending.withResponse());
    const drained = Promise.allSettled([headers, body]).then(async () => {
      await bodyRead; // Settlement of the actual reader, including late rejection.
      restoreText?.();
      if (run.sdkRead === drained) run.sdkRead = undefined;
      display(run);
    });
    run.sdkRead = drained;
    display(run);
    const reading = (async () => {
      const response = await headers;
      checkDeadline();
      entry.requestId = safeRequestId(response.headers.get('x-request-id'));
      entry.http = response.status;
      const { data, request_id } = await body;
      checkDeadline();
      entry.requestId = safeRequestId(request_id) ?? entry.requestId;
      return data;
    })();
    return await Promise.race([reading, cancelled]);
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      if (
        status &&
        Number.isInteger(status) &&
        status >= 100 &&
        status <= 599
      ) {
        entry.http = status;
        entry.requestId = safeRequestId(error.requestID) ?? entry.requestId;
        const category =
          status === 401
            ? 'authentication'
            : status === 403
              ? 'permission/access'
              : status === 429
                ? 'rate limit/quota'
                : 'HTTP failure';
        throw new DecisionFailure(`${category} (${status})`);
      }
    }
    if (controller.signal.aborted) throw abortError();
    if (error instanceof DecisionFailure || error instanceof DecisionStopped)
      throw error;
    if (error instanceof SyntaxError)
      throw new DecisionFailure('Malformed API response JSON');
    if (error instanceof OpenAI.APIConnectionTimeoutError)
      throw new DecisionFailure('SDK timeout');
    if (error instanceof OpenAI.APIConnectionError)
      throw new DecisionFailure('API connection failure (network/CORS/access)');
    throw new DecisionFailure('SDK or response-body failure');
  } finally {
    clearTimeout(deadline);
    controller.signal.removeEventListener('abort', onAbort);
    if (run.apiController === controller) run.apiController = undefined;
    entry.latencyMs = Math.round(performance.now() - started);
  }
}

async function runOneDecision(
  run: Run,
  continuous?: ContinuousRun,
): Promise<DecisionOutcome> {
  if (
    current !== run ||
    pageExited ||
    !run.valid ||
    run.phase !== 'ready' ||
    run.attempt ||
    run.terminal ||
    run.sdkRead ||
    (run.continuous?.active && run.continuous !== continuous)
  )
    return 'not-admitted';
  if (
    continuous &&
    (run.continuous !== continuous ||
      !continuous.active ||
      continuous.stopRequested)
  )
    return 'stopped';
  const tics = $('#tics').valueAsNumber;
  if (!Number.isSafeInteger(tics) || tics < 1) {
    display(
      run,
      'Tics per decision must be a positive JavaScript safe integer.',
    );
    return 'not-admitted';
  }
  let key = $('#key').value.trim();
  if (key) {
    $('#key').value = '';
    if (!/^[\x21-\x7e]+$/.test(key)) {
      key = '';
      display(
        run,
        'Enter a usable temporary API key (no spaces or control characters).',
      );
      return 'not-admitted';
    }
    try {
      run.client = createClient(key); // Replacement drops the prior client; same Doom run.
    } catch {
      display(run, 'Could not create the API client. Enter a replacement key.');
      return 'not-admitted';
    } finally {
      key = '';
    }
  }
  if (!run.client) {
    display(
      run,
      'Enter a temporary OpenAI API key before requesting decisions.',
    );
    return 'not-admitted';
  }
  // Freeze duration and attempt identity before the first await. The handler
  // guard, rather than disabled styling alone, prevents overlapping admission.
  const attempt = admitDecision(run, tics);
  if (!attempt) return 'not-admitted';
  if (continuous) continuous.dispatched = false;
  const dispatchFence = () => {
    fence(run, attempt);
    if (continuous?.stopRequested) throw new DecisionStopped();
  };
  const entry: DecisionEntry = {
    number: run.evidence.decisions.length + 1,
    selectedTics: attempt.tics,
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
  };
  run.evidence.decisions.push(entry);
  display(run, `Decision ${entry.number}: capturing tic ${run.verifiedTics}…`);
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
    const png = canvas.toDataURL('image/png');
    const rgba = context.getImageData(0, 0, 640, 400).data;
    check(png.startsWith('data:image/png;base64,'), 'Canvas PNG unavailable.');
    const hash = await digest(rgba);
    fence(run, attempt);
    check(
      hash === run.frame.nativeSha256,
      'Observation Canvas/native hash mismatch.',
    );
    dispatchFence();
    entry.status = 'Requesting one action';
    display(
      run,
      `Decision ${entry.number}: requesting action for ${attempt.tics} tics…`,
    );
    canRecover = true;
    const data = await decide(run, attempt, entry, png, continuous);
    dispatchFence();
    try {
      entry.choice = validateChoice(data);
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
    entry.status = 'Stepping and verifying';
    display(
      run,
      `Decision ${entry.number}: verifying ${attempt.tics} native tics…`,
    );
    // No await between the final identity fence and the one native dispatch.
    dispatchFence();
    if (continuous) continuous.dispatched = true;
    const execution = await action(
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
    if (execution.terminal) {
      entry.status = `${terminalStatus(execution)}; frame retained.`;
      retire(run, 'terminal');
      display(run, `${entry.status} Reload to start a new session.`);
      return 'terminal';
    }
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
    if (current !== run || pageExited || (run.valid && run.attempt !== attempt))
      return 'retired';
    if (
      ((canRecover && error instanceof DecisionFailure) ||
        error instanceof DecisionStopped) &&
      run.valid &&
      observation
    ) {
      try {
        fence(run, attempt);
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
          error instanceof DecisionStopped || continuous?.stopRequested;
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
    entry.status = entry.execution?.terminal
      ? `${terminalStatus(entry.execution)}; terminal frame unavailable. Reload to restart.`
      : entry.execution?.complete
        ? 'Action verified; resulting frame unavailable. Reload to restart.'
        : entry.execution
          ? entry.execution.completionUncertain
            ? 'Native completion uncertain; verified prefix retained. Reload to restart.'
            : entry.execution.assessment?.kind === 'unsupported'
              ? 'Unsupported native state; verified prefix retained. Reload to restart.'
              : entry.execution.independentlyVerifiedTics === entry.selectedTics
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

async function startContinuous() {
  const run = current;
  if (
    !run?.valid ||
    pageExited ||
    run.phase !== 'ready' ||
    run.attempt ||
    run.terminal ||
    run.sdkRead ||
    run.continuous?.active
  )
    return;
  const limit = $('#budget').valueAsNumber;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    display(run, 'Max API attempts must be a positive safe integer.');
    $('#budget').focus();
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

$('#next').addEventListener('click', () => {
  if (current) return runOneDecision(current);
});
$('#start').addEventListener('click', startContinuous);
$('#stop').addEventListener('click', stopContinuous);

async function prepare() {
  // Selection is single-flight. Only asset validation failures allow correction.
  if (
    pageExited ||
    !engine ||
    !sdk ||
    (current && current.phase !== 'unprepared')
  )
    return;
  const file = $('#iwad').files?.[0];
  if (!file) {
    $('#status').textContent = 'Select your local Freedoom Phase 1 IWAD first.';
    return;
  }
  const run: Run = {
    valid: true,
    phase: 'preparing',
    verifiedTics: 0,
    evidence: { sdk, engine, operations: [], frames: [], decisions: [] },
  };
  current = run;
  context.clearRect(0, 0, 640, 400);
  $('#frame').textContent = 'No frame rendered for this preparation.';
  display(run, 'Preparing fresh E1M1…');
  let assetValidation = true;
  try {
    check(
      file.size === 28795076,
      'Require the known-good Freedoom 0.13.0 Phase 1 IWAD (28,795,076 bytes).',
    );
    const [wasm, wad] = await Promise.all([
      localFetch('doom.wasm'),
      file.arrayBuffer(),
    ]);
    check(
      current === run && run.valid,
      'Preparation invalidated during asset reading.',
    );
    check((await digest(wad)) === wadHash, 'Freedoom hash mismatch.');
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
    run.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    const { result: loaded } = await request(
      run,
      'load-i11',
      { wasm, wad, expectedWasmHash: engine.sha256 },
      [wasm, wad],
    );
    check(
      loaded.wasmSha256 === engine.sha256 &&
        loaded.wadSha256 === wadHash &&
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
    const neutral = await action(run, 0, 1, before, (evidence) => {
      run.evidence.neutralFirst = evidence;
    });
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
    display(
      run,
      'Ready at tic 1 — neutral 1/1/1; passive checks unchanged. Enter a temporary key, then Next Decision.',
    );
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
      `Preparation failed: ${run.evidence.error} ${assetValidation ? 'Select the correct local IWAD to try again.' : 'Reload to restart.'}`,
    );
  }
}
$('#iwad').addEventListener('change', () => void prepare());
window.addEventListener('pagehide', () => {
  pageExited = true;
  if (current) retire(current);
  $('#key').value = '';
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    $('#iwad').disabled = true;
    if (current)
      display(current, 'Game retired on page exit. Reload to restart.');
    else $('#status').textContent = 'Page exited. Reload to restart.';
  }
});

async function initialize() {
  try {
    check(VERSION === '7.32.0', 'Require official OpenAI SDK 7.32.0.');
    const client = new OpenAI({
      apiKey: 'sdk-probe-not-a-credential',
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
      logLevel: 'off',
      fetch: async () => {
        throw Error('SDK availability probe cannot send requests.');
      },
    });
    check(
      typeof client.decisions?.create === 'function',
      'Bundled SDK lacks decisions.create.',
    );
    sdk = {
      version: VERSION,
      decisionsCreateAvailable: true,
      requestsEnabled: true,
    };
    $('#sdk').textContent =
      `OpenAI SDK ${VERSION} loaded · decisions.create available · manual steps or explicitly started continuous mode`;
    const metadata = await localFetch('doom-build.json', true);
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
    $('#status').textContent =
      'Select your local Freedoom Phase 1 IWAD to prepare automatically.';
    $('#iwad').disabled = false;
  } catch (error) {
    $('#status').textContent =
      `Startup failed: ${error instanceof Error ? error.message.slice(0, 500) : 'SDK/engine loading failed.'}`;
  }
}
initialize();
