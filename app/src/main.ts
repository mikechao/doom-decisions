import { createDecisionHistory } from './decision-history';
import { deriveDecisionControls } from './decision-controls';
import { formatDefaultDecisionInstructions } from './decision-request';
import { projectLatestOutcome } from './latest-outcome';
import { openAiDecisionProviderFactory } from './openai-decision-provider';
import {
  createSessionController,
  type SessionPresentation,
} from './session-controller';
import './style.css';

type Elements = {
  '#screen': HTMLCanvasElement;
  '#iwad': HTMLInputElement;
  '#key': HTMLInputElement;
  '#key-state': HTMLParagraphElement;
  '#setup': HTMLDetailsElement;
  '#setup-asset': HTMLSpanElement;
  '#control-prerequisite': HTMLParagraphElement;
  '#tics': HTMLInputElement;
  '#next': HTMLButtonElement;
  '#start': HTMLButtonElement;
  '#stop': HTMLButtonElement;
  '#budget': HTMLInputElement;
  '#view-prompt': HTMLButtonElement;
  '#prompt-dialog': HTMLDialogElement;
  '#close-prompt': HTMLButtonElement;
  '#prompt-text': HTMLParagraphElement;
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
function displaySetupStatus(run: NonNullable<SessionPresentation['session']>) {
  const prepared = run.prepared;
  const file = $('#iwad').files?.[0];
  $('#setup-asset').textContent = file
    ? `${file.name} · ${prepared ? 'prepared' : 'selected'}`
    : '';
}
const displayHistory = createDecisionHistory(
  $('#history'),
  $('#history-empty'),
);
type SessionRunPresentation = NonNullable<SessionPresentation['session']>;
let latestSession: SessionRunPresentation | undefined;
let setupAutoCollapseDone = false;
let keyCommitted = false;
let setupPointerActive = false;
function collapseCompletedSetup(
  focusTarget: Node | null = document.activeElement,
) {
  if (
    setupAutoCollapseDone ||
    setupPointerActive ||
    $('#setup').contains(focusTarget) ||
    !latestSession?.prepared ||
    !(latestSession.hasClient || (keyCommitted && $('#key').value.trim()))
  )
    return;
  setupAutoCollapseDone = true;
  $('#setup').open = false;
}
function updateControlAvailability(run: SessionRunPresentation | undefined) {
  const readiness = deriveDecisionControls(
    run,
    $('#key').value.trim().length > 0,
  );
  const prerequisite = $('#control-prerequisite');
  prerequisite.textContent = readiness.bannerText ?? '';
  prerequisite.hidden = readiness.bannerText === null;
  $('#next').disabled = !readiness.buttonsEnabled;
  $('#start').disabled = !readiness.buttonsEnabled;
  if (!run) return;
  const sessionReady = run.controls.ready;
  $('#budget').disabled = !sessionReady;
  $('#key').disabled = !sessionReady;
  $('#stop').disabled = !run.controls.stop;
  $('#tics').disabled = !run.controls.tics;
  $('#iwad').disabled = !run.controls.iwad;
  $('#next').setAttribute('aria-busy', String(run.phase === 'busy'));
}
function display(view: SessionPresentation) {
  if (view.sdkStatus !== undefined) $('#sdk').textContent = view.sdkStatus;
  if (view.frameStatus !== undefined)
    $('#frame').textContent = view.frameStatus;
  if (view.iwadEnabled !== undefined) $('#iwad').disabled = !view.iwadEnabled;
  const status = view.status;
  if (status) $('#status').textContent = status;
  const run = view.session;
  if (run) latestSession = run;
  updateControlAvailability(latestSession);
  collapseCompletedSetup();
  if (!run) return;
  $('#status').dataset.phase = run.phase;
  $('#evidence').textContent = JSON.stringify(run.evidence, null, 2);
  const continuous = run.continuous;
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
    `${continuousStatus}${continuous ? ` · API attempts ${continuous.used} / ${continuous.limit}` : ''} · verified tic ${run.verifiedTics}${run.waitingForSdk ? ' · waiting for API response cleanup' : ''}`;
  $('#key-state').textContent = run.hasClient
    ? 'Client in memory; blank keeps it. Authentication unverified.'
    : 'Client in memory • Refresh clears it';
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
const controller = createSessionController(
  {
    localFetch,
    createWorker: () =>
      new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      }),
    readTics: () => $('#tics').valueAsNumber,
    takeKey: () => {
      const key = $('#key').value.trim();
      if (key) $('#key').value = '';
      return key;
    },
    clearKey: () => {
      $('#key').value = '';
    },
    focusBudget: () => $('#budget').focus(),
    capture: () => ({
      png: canvas.toDataURL('image/png'),
      rgba: context.getImageData(0, 0, 640, 400).data,
    }),
    paintAndReadback: (rgba) => {
      context.putImageData(new ImageData(rgba, 640, 400), 0, 0);
      return context.getImageData(0, 0, 640, 400).data;
    },
    clearCanvas: () => context.clearRect(0, 0, 640, 400),
    present: display,
  },
  openAiDecisionProviderFactory,
);
const syncCredentialReadiness = () => {
  updateControlAvailability(latestSession);
};
$('#key').addEventListener('input', () => {
  keyCommitted = false;
  syncCredentialReadiness();
});
const commitKeyEdit = (event: Event) => {
  keyCommitted = $('#key').value.trim().length > 0;
  syncCredentialReadiness();
  // Keep setup open when focus moves into its credential-handling disclosure.
  // During focusout, activeElement can be body; relatedTarget is the destination.
  collapseCompletedSetup(
    event.type === 'focusout'
      ? ((event as FocusEvent).relatedTarget as Node | null)
      : document.activeElement,
  );
};
$('#key').addEventListener('change', commitKeyEdit);
$('#setup').addEventListener('focusout', commitKeyEdit);
// A summary click also covers native keyboard activation. Any deliberate toggle
// hands disclosure ownership to the user, including before setup is complete.
$('#setup')
  .querySelector('summary')
  ?.addEventListener('click', () => {
    setupAutoCollapseDone = true;
  });
// Blur/change can run between pointerdown and click. Keep the rail still until
// the click has reached its target (including Next/Start), then collapse once.
// A gesture without a click leaves it open until the next click or cancellation.
document.addEventListener(
  'pointerdown',
  () => {
    setupPointerActive = true;
  },
  true,
);
document.addEventListener('click', () => {
  setupPointerActive = false;
  collapseCompletedSetup();
});
document.addEventListener('pointercancel', () => {
  setupPointerActive = false;
  collapseCompletedSetup();
});
$('#next').addEventListener('click', () => controller.next());
$('#start').addEventListener('click', () =>
  controller.startContinuous($('#budget').valueAsNumber),
);
$('#stop').addEventListener('click', () => controller.stop());
function displayDecisionPrompt() {
  const tics = $('#tics').valueAsNumber;
  $('#prompt-text').textContent =
    Number.isSafeInteger(tics) && tics >= 1
      ? formatDefaultDecisionInstructions(tics)
      : 'Enter a positive JavaScript safe integer for tics to preview instructions.';
}
$('#view-prompt').addEventListener('click', () => {
  displayDecisionPrompt();
  $('#prompt-dialog').showModal();
});
$('#close-prompt').addEventListener('click', () => $('#prompt-dialog').close());
$('#prompt-dialog').addEventListener('close', () => {
  if (!$('#prompt-dialog').open) $('#view-prompt').focus();
});
const refreshOpenDecisionPrompt = () => {
  if ($('#prompt-dialog').open) displayDecisionPrompt();
};
$('#tics').addEventListener('input', refreshOpenDecisionPrompt);
$('#tics').addEventListener('change', refreshOpenDecisionPrompt);
$('#iwad').addEventListener(
  'change',
  () => void controller.prepare($('#iwad').files?.[0]),
);
window.addEventListener('pagehide', () => controller.close());
window.addEventListener('pageshow', (event) =>
  controller.restore(event.persisted),
);
void controller.initialize();
