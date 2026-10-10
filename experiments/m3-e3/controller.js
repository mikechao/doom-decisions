import {i11MaskValid, i11VerifyStep, i11Action, titleWorker} from './worker-boundary.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#screen');
const controls = [$('#run'), $('#wasm'), $('#wad'), $('#key')];
const masks = Object.freeze({neutral: 0, forward: 1, turn_right: 2, backward: 4, turn_left: 8, fire: 16, use: 32});
const wasmHash = 'cc86ed8884ec04dbace3c541e8528a9f91839b79816cc79ce988af939d42dcb8';
const wadHash = '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d';
const deadlineMs = 10000;
const work = ['build', 'install', 'liveEntry', 'world', 'status', 'automap', 'hud', 'menu', 'outer'];
const passive = ['wasiInit', 'cInit', 'engineCreate', 'titlePrepare', 'titleReady', 'nativeBuild',
  'playerEntry', 'worldComplete', 'outerComplete', 'schedulerEntry', 'netBody', 'wipeEntry',
  'demoLoad', 'gametic', 'leveltime', 'virtualTicks'];
let current = null;
let runNumber = 0;

// Only local diagnostics and fixed SDK error classifications reach the UI.
// Never display arbitrary SDK messages, error bodies, headers or response strings.
class TrialError extends Error {}
function check(ok, message) { if (!ok) throw new TrialError(message); }
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  b => b.toString(16).padStart(2, '0')).join('');
const safeRequestId = value => typeof value === 'string' && /^req_[A-Za-z0-9_-]{1,200}$/.test(value)
  ? value : 'Unavailable / not exposed';
const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const safeNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : '[missing/invalid]';
const safeChoice = value => typeof value === 'string' && Object.hasOwn(masks, value) ? value : '[missing/unexpected]';
const safeType = value => ['choice', 'refusal', 'predicate', 'score'].includes(value) ? value : '[missing/unexpected]';

function sanitizedResponse(data) {
  // A projection, not raw JSON: unrecognized strings/keys are never echoed.
  return {
    model: data?.model === 'gpt-6-luna' ? data.model : '[missing/unexpected]',
    answerCount: Array.isArray(data?.answers) ? data.answers.length : '[missing/invalid]',
    answers: Array.isArray(data?.answers) ? data.answers.slice(0, 8).map(answer => ({
      type: safeType(answer?.type), name: answer?.name === 'next_action' ? 'next_action' : '[missing/unexpected]',
      ...(answer?.type === 'choice' ? {
        choice: safeChoice(answer.choice), confidence: safeNumber(answer.confidence),
        probabilities: Array.isArray(answer.probabilities) ? answer.probabilities.slice(0, 8).map(p => ({
          value: safeChoice(p?.value), probability: safeNumber(p?.probability),
        })) : '[missing/invalid]',
      } : {}),
    })) : [],
    usage: Object.fromEntries(['input_tokens', 'output_tokens', 'total_tokens'].map(k => [k, safeNumber(data?.usage?.[k])])),
    sanitization: 'Only documented expected fields/values retained; other fields omitted or redacted.',
  };
}

function validateChoice(data) {
  check(Array.isArray(data?.answers) && data.answers.length === 1, 'Invalid answer count; no action dispatched.');
  const answer = data.answers[0];
  check(!(answer?.type === 'refusal'), 'API refusal received; no action dispatched.');
  check(answer?.type === 'choice' && answer.name === 'next_action' &&
    typeof answer.choice === 'string' && Object.hasOwn(masks, answer.choice),
  'Invalid next_action choice; no action dispatched.');
  check(probability(answer.confidence) && Array.isArray(answer.probabilities) &&
    answer.probabilities.length === 7 && Object.keys(masks).every(value =>
      answer.probabilities.filter(p => p?.value === value && probability(p.probability)).length === 1),
  'Malformed choice confidence/probabilities; no action dispatched.');
  return answer.choice;
}

function assertCurrent(run, worker = run.worker) {
  check(current === run && run.valid && worker && run.worker === worker, 'Trial invalidated; no future native calls.');
}
function passiveCheck(before, after) {
  check(passive.every(k => before.counters[k] === after.counters[k]) && equal(before.native, after.native),
    'Passive operation changed native work, commands or time.');
}
function nativeEvidence(state) {
  return state ? {status: state.status, counters: state.counters, native: state.native} : null;
}

function drawEvidence(run) {
  $('#progress').textContent = `${run.completed}/2 completed; ${run.total} verified native tics${run.uncertain ? ' (lower bound; completion uncertain)' : ''}; ${run.calls} SDK create calls.`;
  $('#evidence').textContent = JSON.stringify({run: run.id, started: run.started, origin: location.origin,
    userAgent: navigator.userAgent, sdk: run.sdk || 'Not loaded', assets: run.assets || 'Not admitted',
    neutralFirst: run.neutral || 'Not completed', renderedFrame: run.frame || null,
    verifiedTics: run.total, completionUncertain: run.uncertain, workerRetired: !run.worker}, null, 2);
  for (const entry of run.entries) {
    entry.summary.textContent = [
      `Decision ${entry.number}/2 — ${entry.status}`,
      `Response received: ${entry.responseReceived ? 'yes' : 'no'}; complete parsed body: ${entry.body ? 'yes' : 'no'}; action executed: ${entry.actionExecuted ? 'yes, six verified tics' : 'no complete verified action'}`,
      `Observed rendered frame: tic ${entry.observation.tic}, RGBA SHA-256 ${entry.observation.sha256}`,
      `Selected action: ${entry.choice || 'unavailable'}; mask: ${entry.mask ?? 'not admitted'}; fixed duration: 6 tics`,
      `HTTP: ${entry.http ?? 'unavailable'}; SDK request ID: ${entry.requestId || 'unavailable'}; latency: ${entry.latencyMs ?? 'pending'} ms`,
      `Native requested / reported completed / independently verified: ${entry.execution?.requestedTics ?? 'not dispatched'} / ${entry.execution?.reportedCompletedTics ?? 'unavailable'} / ${entry.execution?.verifiedCompletedTics ?? 0}`,
      `Cumulative verified tics: ${entry.execution?.cumulativeTics ?? entry.observation.tic}; wait state unchanged: ${entry.waitUnchanged ?? 'not checked'}`,
      `Resulting frame rendered: ${entry.rendered ? `tic ${entry.rendered.tic}, SHA-256 ${entry.rendered.sha256}` : 'no'}`,
      `Error/refusal: ${entry.error || 'none'}`,
    ].join('\n');
    entry.responseOutput.textContent = entry.response ? JSON.stringify(entry.response, null, 2) : 'No returned response to display.';
    entry.nativeOutput.textContent = JSON.stringify(entry.execution || {status: 'No action dispatched'}, null, 2);
  }
}
function setStatus(run, status) {
  if (current !== run) return;
  run.status = status;
  $('#status').textContent = status;
  drawEvidence(run);
}
function addEntry(run, number, observation, png) {
  const li = document.createElement('li');
  const summary = document.createElement('pre');
  li.append(summary);
  function detail(title) {
    const details = document.createElement('details'), label = document.createElement('summary'), output = document.createElement('pre');
    label.textContent = title; details.append(label, output); li.append(details); return output;
  }
  const entry = {number, observation, summary, responseOutput: detail('Sanitized API response JSON (confidence/probabilities included)'),
    nativeOutput: detail('Native execution evidence (every verified player-consumed tic)'), status: 'Requesting',
    responseReceived: false, body: false, actionExecuted: false};
  const imageDetails = document.createElement('details'), imageLabel = document.createElement('summary'), image = document.createElement('img');
  imageLabel.textContent = `Observed Canvas PNG sent with decision ${number} (tic ${observation.tic})`;
  image.src = png; image.width = 640; image.height = 400;
  image.alt = `Rendered E1M1 observation for decision ${number} at tic ${observation.tic}`;
  imageDetails.append(imageLabel, image); li.append(imageDetails);
  run.entries.push(entry); $('#decisions').append(li); drawEvidence(run); return entry;
}

function retire(run) {
  const pending = run.pendingWorker;
  run.pendingWorker = null;
  if (run.worker) {
    run.worker.onmessage = run.worker.onerror = run.worker.onmessageerror = null;
    run.worker.terminate(); run.worker = null;
  }
  if (run.workerUrl) { URL.revokeObjectURL(run.workerUrl); run.workerUrl = null; }
  pending?.cancel(new TrialError('Worker retired; pending operation completion unknown.'));
}
function stop(run) {
  if (current !== run || !run.valid) return;
  run.valid = false; run.stopped = true;
  run.apiController?.abort();
  run.pendingKey = '';
  if (run.client) run.client.apiKey = '';
  $('#key').value = '';
  retire(run);
  const entry = run.entries.at(-1);
  if (entry && !entry.rendered) entry.status = 'Stopped';
  setStatus(run, 'Stopped — trial invalidated; Worker retired.');
  $('#stop').disabled = true;
}

async function workerRequest(run, op, extra = {}) {
  const worker = run.worker;
  assertCurrent(run, worker);
  check(!run.pendingWorker, 'Overlapping Worker operation refused.');
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      run.pendingWorker = null;
      if (error) reject(error); else resolve(data);
    };
    const timer = setTimeout(() => {
      finish(new TrialError(`${op} Worker watchdog expired (2000 ms); completion unknown.`));
      retire(run);
    }, 2000);
    run.pendingWorker = {op, cancel: error => finish(error)};
    worker.onerror = () => finish(new TrialError(`${op} Worker fault; completion unknown.`));
    worker.onmessageerror = () => finish(new TrialError(`${op} Worker reply unreadable; completion unknown.`));
    worker.onmessage = ({data}) => {
      try {
        assertCurrent(run, worker);
        check(data?.op === op, 'Unexpected Worker reply; completion unknown.');
        // Worker has no credential. Its own bounded native diagnostic is safe to report.
        check(data.ok, typeof data.error === 'string' ? data.error.slice(0, 500) : 'Worker operation failed.');
        finish(null, data);
      } catch (error) { finish(error); }
    };
    try { worker.postMessage({op, ...extra}); } catch { finish(new TrialError(`${op} Worker dispatch failed; completion unknown.`)); }
  });
}

async function snapshot(run) {
  const before = run.last;
  const {result} = await workerRequest(run, 'snapshot');
  assertCurrent(run);
  passiveCheck(before, result);
  check(equal(before.counters, result.counters), 'Snapshot changed counters.');
  run.last = result; return result;
}
async function render(run) {
  const before = run.last;
  const {result, pixels} = await workerRequest(run, 'render');
  assertCurrent(run);
  passiveCheck(before, result);
  check(result.status === 0 && pixels?.byteLength === 1024000 && result.dimensions?.width === 640 &&
    result.dimensions?.height === 400 && /^[a-f0-9]{64}$/.test(result.frameSha256), 'Missing real Doom frame.');
  check(result.counters.render === before.counters.render + 1 && result.counters.frame === before.counters.frame + 1 &&
    result.counters.netIntercept === before.counters.netIntercept + (before.counters.gametic ? 5 : 1),
  'Passive render cadence mismatch.');
  check(result.counters.gametic === run.total, 'Render tic checkpoint mismatch.');
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), 640, 400), 0, 0);
  run.last = result;
  run.frame = {tic: result.counters.gametic, sha256: result.frameSha256};
  $('#frame').textContent = `Rendered E1M1 at tic ${run.frame.tic}; RGBA SHA-256 ${run.frame.sha256}`;
  drawEvidence(run);
}

async function action(run, mask, tics, execution) {
  const before = run.last, base = run.total;
  Object.assign(execution, {mask, requestedTics: tics, reportedCompletedTics: null, verifiedCompletedTics: 0,
    cumulativeTics: base, outcome: 'IN_FLIGHT', completionUncertain: true, before: nativeEvidence(before), steps: []});
  drawEvidence(run);
  try {
    const {result} = await workerRequest(run, 'action', {mask, tics});
    assertCurrent(run);
    execution.reportedCompletedTics = Number.isInteger(result.completedTics) ? result.completedTics : null;
    execution.outcome = ['APPLIED', 'REFUSED', 'FAULT'].includes(result.outcome) ? result.outcome : 'UNKNOWN';
    execution.workerError = typeof result.error === 'string' ? result.error.slice(0, 500) : null;
    execution.after = nativeEvidence(result);
    // Re-verify the Worker's prefix independently, even on partial refusal/fault.
    let last = before;
    for (const step of (Array.isArray(result.steps) ? result.steps : []).slice(0, tics)) {
      check(step.status === 0, 'Noncompleted step in action prefix.');
      i11VerifyStep(mask, last, step);
      execution.steps.push(nativeEvidence(step)); execution.verifiedCompletedTics++;
      run.total = execution.cumulativeTics = base + execution.verifiedCompletedTics;
      last = step;
    }
    check(result.mask === mask && result.requestedTics === tics && Array.isArray(result.steps) &&
      result.steps.length === execution.verifiedCompletedTics && result.completedTics === execution.verifiedCompletedTics &&
      equal(last.counters, result.counters) && equal(last.native, result.native), 'Action completion/prefix mismatch.');
    execution.completionUncertain = !((result.outcome === 'APPLIED' && result.status === 0) ||
      (result.outcome === 'REFUSED' && result.status === -1)) || result.currentTic === 'UNKNOWN';
    check(!execution.completionUncertain && result.outcome === 'APPLIED' && result.status === 0 && result.completedTics === tics &&
      result.native.ready === 1 && result.counters.gametic === base + tics,
    `Native action ${execution.outcome}: ${execution.workerError || 'refused or incomplete'}; verified prefix retained; no retry.`);
    execution.completionUncertain = false;
    run.last = result;
  } catch (error) {
    if (execution.outcome === 'IN_FLIGHT') execution.outcome = 'UNKNOWN';
    run.uncertain ||= execution.completionUncertain;
    // Verification diagnostics originate in the copied local verifier, never the SDK.
    execution.error = error instanceof Error ? error.message.slice(0, 500) : 'Native action failed.';
    throw new TrialError(execution.error);
  } finally { drawEvidence(run); }
}

function checkPrepared(op, result) {
  check(result.status === 0 && work.every(k => result.native[k] === 0) &&
    ['nativeBuild', 'playerEntry', 'worldComplete', 'outerComplete', 'gametic', 'leveltime', 'virtualTicks']
      .every(k => result.counters[k] === 0) && result.native.virtualMs === 0, 'Hidden init/preparation tic.');
  check(['wasiInit', 'cInit', 'engineCreate', 'titlePrepare'].every(k => result.counters[k] === 1) &&
    result.counters.titleReady === (op === 'init' ? 1 : 0), 'One-shot init/title readiness mismatch.');
  if (op === 'prepare') check(['ready', 'loadComplete', 'resources', 'liveActor', 'gameEligible', 'contributorsValid']
    .every(k => result.native[k] === 1) && result.native.episode === 1 && result.native.map === 1 &&
    result.native.skill === 2 && result.native.playerstate === 0 && result.native.health > 0 &&
    result.native.gamestate === 0 && result.native.gameaction === 0, 'Genuine E1M1 READY failed.');
}

async function decide(run, entry, imageUrl, OpenAI) {
  const controller = new AbortController();
  run.apiController = controller;
  const started = performance.now();
  let timedOut = false, cspBlocked = false;
  const abortError = () => new TrialError(run.stopped ? 'Owner stopped the API wait.' :
    timedOut ? 'Decision deadline exceeded (10000 ms, including body reading).' : 'API request aborted.');
  const onCsp = event => { if (event.effectiveDirective === 'connect-src' && event.disposition === 'enforce') cspBlocked = true; };
  document.addEventListener('securitypolicyviolation', onCsp);
  let onAbort;
  const cancelled = new Promise((resolve, reject) => {
    onAbort = () => reject(abortError());
    controller.signal.addEventListener('abort', onAbort, {once: true});
  });
  const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, deadlineMs);
  function checkDeadline() {
    if (performance.now() - started >= deadlineMs) { timedOut = true; controller.abort(); }
    if (controller.signal.aborted) throw abortError();
    assertCurrent(run);
  }
  try {
    checkDeadline();
    const payload = {model: 'gpt-6-luna', input: [{role: 'user', content: [
      {type: 'input_text', text: 'This is the currently rendered first-person Doom E1M1 frame. You only have this image, not full game state.'},
      {type: 'input_image', image_url: imageUrl},
    ]}], questions: [{type: 'choice', name: 'next_action',
      instructions: 'Choose the next action to explore E1M1 and survive based on the visible frame. The action will persist for exactly six native gameplay tics (about 171 ms), then a new frame is observed. neutral releases all six keys. Do not assume unseen game state.',
      choices: Object.keys(masks).map(value => ({value})),
    }]};
    // Same pinned client mechanics as M3-E2. Both helpers observe ONE APIPromise.
    const request = run.client.decisions.create(payload, {signal: controller.signal, maxRetries: 0, timeout: deadlineMs});
    run.calls++; drawEvidence(run);
    const reading = (async () => {
      const raw = await request.asResponse();
      checkDeadline();
      entry.responseReceived = true; entry.http = raw.status;
      entry.requestId = safeRequestId(raw.headers.get('x-request-id'));
      entry.status = 'Response received; reading body'; drawEvidence(run);
      const {data, request_id} = await request.withResponse();
      checkDeadline();
      entry.body = true; entry.response = sanitizedResponse(data);
      entry.requestId = safeRequestId(request_id);
      entry.status = 'Response received; action not dispatched';
      check(raw.ok, `HTTP rejection (${raw.status}); no action dispatched.`);
      return data;
    })();
    return await Promise.race([reading, cancelled]);
  } catch (error) {
    if (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) {
      entry.responseReceived = true; entry.http = error.status; entry.requestId = safeRequestId(error.requestID);
      const category = {401: 'authentication', 403: 'permission/access', 429: 'rate limit/quota'}[error.status] || 'other HTTP';
      entry.response = {httpStatus: error.status, category, requestId: entry.requestId,
        errorBody: 'Omitted for credential safety; SDK error-body completeness unverified.'};
      throw new TrialError(`HTTP failure: ${category} (${error.status}); no action dispatched.`);
    }
    if (run.stopped || timedOut || controller.signal.aborted) throw abortError();
    if (error instanceof TrialError) throw error;
    if (error instanceof OpenAI.APIConnectionTimeoutError) throw new TrialError('SDK decision timeout; no action dispatched.');
    if (cspBlocked) throw new TrialError('CSP blocked API connection; inspect Console.');
    if (error instanceof SyntaxError) throw new TrialError('Malformed SDK response JSON; no action dispatched.');
    if (error instanceof OpenAI.APIConnectionError) throw new TrialError('SDK connection failure; preflight/CORS/network cause unknown. Inspect Console/Network.');
    throw new TrialError('SDK/body failure; no action dispatched. Inspect Console/Network without exporting secrets.');
  } finally {
    clearTimeout(deadline);
    controller.signal.removeEventListener('abort', onAbort);
    document.removeEventListener('securitypolicyviolation', onCsp);
    if (run.apiController === controller) run.apiController = null;
    entry.latencyMs = Math.round(performance.now() - started);
    drawEvidence(run);
  }
}

$('#run').addEventListener('click', async event => {
  if (!event.isTrusted || current) return;
  const wasmFile = $('#wasm').files[0], wadFile = $('#wad').files[0];
  let key = $('#key').value.trim();
  $('#key').value = '';
  if (!key || !wasmFile || !wadFile) {
    key = ''; $('#status').textContent = 'Ready — select both assets and enter a temporary key. No request sent.'; return;
  }
  const run = {id: ++runNumber, valid: true, stopped: false, started: new Date().toISOString(),
    entries: [], completed: 0, total: 0, calls: 0, uncertain: false, pendingKey: key};
  key = '';
  current = run;
  controls.forEach(control => { control.disabled = true; }); $('#stop').disabled = false;
  $('#decisions').replaceChildren();
  if (run.id > 1) $('#frame').textContent = 'Previous trial frame retained while fresh E1M1 prepares.';
  setStatus(run, 'Preparing — loading pinned SDK and fresh Doom Worker.');
  try {
    check(wasmFile.size === 360156 && wadFile.size === 28795076, 'Unexpected asset lengths; use the proven Issue #11 artifacts.');
    const [sdk, version] = await Promise.all([
      import('../m3-e2/node_modules/openai/client.mjs'), import('../m3-e2/node_modules/openai/version.mjs'),
    ]);
    check(current === run && run.valid, 'Stopped during SDK import.');
    check(version.VERSION === '7.32.0', 'SDK version mismatch; require official 7.32.0.');
    run.sdk = version.VERSION;
    run.client = new sdk.OpenAI({apiKey: run.pendingKey, baseURL: 'https://api.openai.com/v1', dangerouslyAllowBrowser: true,
      maxRetries: 0, timeout: deadlineMs, logLevel: 'off', fetchOptions: {
        mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      }});
    run.pendingKey = '';
    check(typeof run.client.decisions?.create === 'function', 'Pinned SDK lacks decisions.create.');
    const [wasm, wad] = await Promise.all([wasmFile.arrayBuffer(), wadFile.arrayBuffer()]);
    check(current === run && run.valid, 'Stopped during local asset reading.');
    run.workerUrl = URL.createObjectURL(new Blob([i11MaskValid.toString(), i11VerifyStep.toString(),
      i11Action.toString(), '(' + titleWorker.toString() + ')()'], {type: 'text/javascript'}));
    run.worker = new Worker(run.workerUrl);
    const loaded = await workerRequest(run, 'load-i11', {wasm, wad, expectedWasmHash: wasmHash});
    assertCurrent(run);
    check(loaded.result.wasmSha256 === wasmHash && loaded.result.wadSha256 === wadHash &&
      Object.values(loaded.result.counters).every(v => v === 0), 'Asset hash/pre-init work mismatch.');
    run.assets = {wasm: {bytes: wasm.byteLength, sha256: loaded.result.wasmSha256},
      iwad: {bytes: wad.byteLength, sha256: loaded.result.wadSha256}};
    run.last = loaded.result;
    for (const op of ['init', 'prepare']) {
      const {result} = await workerRequest(run, op); assertCurrent(run); checkPrepared(op, result); run.last = result;
    }
    await snapshot(run);
    run.neutral = {};
    await action(run, 0, 1, run.neutral);
    await render(run);
    check(run.total === 1, 'Neutral-first baseline must be exactly one completed tic.');
    for (let number = 1; number <= 2; number++) {
      assertCurrent(run);
      const worker = run.worker;
      const observationState = await snapshot(run);
      check(observationState.counters.gametic === run.frame.tic, 'Canvas/observation tic mismatch.');
      const observation = {...run.frame};
      // Capture actual painted Canvas pixels, and match them to the native render hash.
      const png = canvas.toDataURL('image/png');
      const rgbaHash = await digest(canvas.getContext('2d').getImageData(0, 0, 640, 400).data);
      assertCurrent(run, worker);
      check(rgbaHash === observation.sha256, 'Rendered Canvas pixels differ from native frame.');
      const entry = addEntry(run, number, observation, png);
      setStatus(run, `Requesting decision ${number}/2 — Doom remains at tic ${run.total}.`);
      const data = await decide(run, entry, png, sdk.OpenAI);
      assertCurrent(run, worker);
      // Preserve an allowed returned selection even if other answer fields fail validation.
      if (data?.answers?.length === 1 && safeChoice(data.answers[0]?.choice) !== '[missing/unexpected]')
        entry.choice = data.answers[0].choice;
      entry.choice = validateChoice(data); entry.mask = masks[entry.choice];
      const afterWait = await snapshot(run);
      assertCurrent(run, worker);
      check(equal(observationState.counters, afterWait.counters) && equal(observationState.native, afterWait.native) &&
        equal(run.frame, observation), 'Stale observation after API wait; no action dispatched.');
      entry.waitUnchanged = true; entry.status = 'Executing admitted choice';
      setStatus(run, `Executing decision ${number}/2 — six native tics.`);
      entry.execution = {};
      await action(run, entry.mask, 6, entry.execution);
      entry.actionExecuted = true; entry.status = 'Action verified; rendering'; drawEvidence(run);
      await render(run);
      check(run.total === 1 + 6 * number, 'Cumulative tic checkpoint mismatch.');
      entry.rendered = {...run.frame}; entry.status = 'Completed — action verified and resulting frame rendered';
      run.completed++; drawEvidence(run);
    }
    setStatus(run, 'Completed — 2/2 Decisions, 13 verified native tics.');
  } catch (error) {
    const message = error instanceof TrialError ? error.message : 'Local preparation/render/SDK import failed; inspect Console/Network and required assets.';
    const entry = run.entries.at(-1);
    if (entry && !entry.rendered) { entry.error = message; entry.status = run.stopped ? 'Stopped' : 'Failed'; }
    setStatus(run, run.stopped ? 'Stopped — Worker retired; no further actions or requests.' : `Failed — ${message}`);
  } finally {
    run.valid = false; key = run.pendingKey = ''; $('#key').value = '';
    run.apiController?.abort();
    if (run.client) run.client.apiKey = '';
    run.client = null;
    retire(run); drawEvidence(run);
    if (current === run) {
      current = null; controls.forEach(control => { control.disabled = false; }); $('#stop').disabled = true;
    }
  }
});
$('#stop').addEventListener('click', event => { if (event.isTrusted && current) stop(current); });
window.addEventListener('pagehide', () => { $('#key').value = ''; if (current) stop(current); });
