import { createIncludedFreedoom } from './bundled-freedoom';
import { formatFacingProbe } from './facing-probe.ts';
import {
  defineDecisionHistory,
  type DecisionHistoryElement,
} from './decision-history';
import { deriveDecisionControls } from './decision-controls';
import {
  defaultDecisionConfiguration,
  defaultDecisionInstructionTemplate,
  formatDecisionState,
} from './decision-request';
import type { DecisionProviderFactory } from './decision-provider';
import { defineDoomButton, type DoomButtonElement } from './doom-button';
import { jevDecisionProviderFactory } from './jev-decision-provider';
import { projectLatestOutcome, projectSessionMetrics } from './latest-outcome';
import { openAiDecisionProviderFactory } from './openai-decision-provider';
import {
  createOpenRouterDecisionProviderFactory,
  defaultOpenRouterModel,
  isOpenRouterModel,
  openRouterModels,
  type OpenRouterModel,
} from './openrouter-decision-provider';
import { createOpenRouterOAuth } from './openrouter-oauth';
import {
  createSessionController,
  type LocalIwad,
  type SessionPresentation,
} from './session-controller';
import './style.css';

// Provider choice is fixed at startup/build time; Vite modes retain dev tooling.
const jevMode = import.meta.env.DEV && import.meta.env.MODE === 'jev';
const providerSetting = import.meta.env.VITE_DECISION_PROVIDER || 'openrouter';
const providerError =
  providerSetting !== 'openrouter' && providerSetting !== 'openai'
    ? 'VITE_DECISION_PROVIDER must be openrouter or openai.'
    : jevMode && providerSetting === 'openai'
      ? 'Jev development mode conflicts with VITE_DECISION_PROVIDER=openai.'
      : undefined;
if (providerError) {
  const status = document.querySelector('#status');
  if (status) status.textContent = `Startup failed: ${providerError}`;
  throw Error(providerError);
}
const openRouterMode = !jevMode && providerSetting === 'openrouter';
// Claim and scrub an owned callback before Canvas/DOM startup can fail.
// Other providers never construct the helper or access OAuth storage/callbacks.
const oauth = openRouterMode ? createOpenRouterOAuth(window) : undefined;
if (oauth) window.addEventListener('pagehide', () => oauth.close());
const jevPlaceholder = 'jev-vite-proxy-not-a-credential';
const jevKeyStatus =
  'TypeSafe key held by the local Vite server. Authentication unverified.';

type Elements = {
  '#screen': HTMLCanvasElement;
  '#game-model': HTMLSpanElement;
  '#iwad': HTMLInputElement;
  '#iwad-picker': DoomButtonElement;
  '#iwad-picker-label': HTMLSpanElement;
  '#iwad-picker-state': HTMLSpanElement;
  '#included-freedoom': DoomButtonElement;
  '#key': HTMLInputElement;
  '#key-label': HTMLLabelElement;
  '#key-note': HTMLParagraphElement;
  '#key-state': HTMLParagraphElement;
  '#manual-key': HTMLDivElement;
  '#openrouter-connect': HTMLDivElement;
  '#openrouter-signin': HTMLDivElement;
  '#openrouter-signin-button': DoomButtonElement;
  '#openrouter-signin-label': HTMLSpanElement;
  '#openrouter-manual': DoomButtonElement;
  '#openrouter-back': DoomButtonElement;
  '#openrouter-auth-status': HTMLParagraphElement;
  '#openrouter-key-settings': HTMLParagraphElement;
  '#openrouter-model': HTMLFieldSetElement;
  '#openrouter-model-gpt': HTMLInputElement;
  '#openrouter-model-jev': HTMLInputElement;
  '#openrouter-model-help': HTMLParagraphElement;
  '#setup': HTMLDetailsElement;
  '#setup-asset': HTMLSpanElement;
  '#prepared-asset': HTMLDivElement;
  '#prepared-asset-name': HTMLSpanElement;
  '#prepared-asset-detail': HTMLSpanElement;
  '#control-prerequisite': HTMLParagraphElement;
  '#tics': HTMLInputElement;
  '#next': DoomButtonElement;
  '#start': DoomButtonElement;
  '#stop': DoomButtonElement;
  '#budget': HTMLInputElement;
  '#view-prompt': DoomButtonElement;
  '#prompt-dialog': HTMLDialogElement;
  '#close-prompt': DoomButtonElement;
  '#save-prompt': DoomButtonElement;
  '#reset-prompt': DoomButtonElement;
  '#prompt-instructions': HTMLTextAreaElement;
  '#prompt-ready-weapon': HTMLInputElement;
  '#prompt-ammo': HTMLInputElement;
  '#prompt-health': HTMLInputElement;
  '#prompt-previous-action': HTMLInputElement;
  '#prompt-facing-probe': HTMLInputElement;
  '#prompt-state-preview-note': HTMLParagraphElement;
  '#prompt-state-preview-text': HTMLPreElement;
  '#prompt-error': HTMLParagraphElement;
  '#decision-history': DecisionHistoryElement;
  '#outcome-number': HTMLSpanElement;
  '#outcome-action': HTMLSpanElement;
  '#outcome-evidence': HTMLParagraphElement;
  '#session-input-tokens': HTMLSpanElement;
  '#session-input-partial': HTMLElement;
  '#session-api-latency': HTMLElement;
  '#sdk': HTMLParagraphElement;
  '#status': HTMLParagraphElement;
  '#frame': HTMLParagraphElement;
  '#evidence': HTMLPreElement;
  '#collision-evidence': HTMLPreElement;
  '#facing-evidence': HTMLPreElement;
};
// These elements are supplied by the static HTML entry; the Canvas is 640×400.
const $ = <S extends keyof Elements>(selector: S) => {
  const element = document.querySelector<Elements[S]>(selector);
  check(element, `Missing required element ${selector}.`);
  return element;
};
defineDoomButton();
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
if (jevMode) {
  $('#key').value = '';
  $('#key').hidden = true;
  $('#key').disabled = true;
  $('#key-label').hidden = true;
  $('#key-state').textContent = jevKeyStatus;
  $('#key-note').textContent =
    'Experimental Jev mode sends the current screenshot through the local Vite server to TypeSafe. Images are experimental. Configure TYPESAFE_API_KEY only in the Vite server process and restart that server to change it. Do not enter a TypeSafe key in this page.';
}
if (openRouterMode) {
  $('#openrouter-connect').hidden = false;
  $('#openrouter-back').hidden = false;
  $('#manual-key').hidden = true;
  $('#key').hidden = true;
  $('#key-label').textContent = 'Temporary OpenRouter API key';
  $('#openrouter-key-settings').hidden = false;
} else if (!jevMode) {
  $('#key-label').textContent = 'Temporary OpenAI API key (experimental)';
  $('#key-note').textContent =
    'Direct OpenAI was explicitly selected by the operator. Browser access may fail due to CORS; deployed access is unverified. Your key and model input go directly to OpenAI; Decisions can incur charges. Trust this page and its scripts. The field clears on capture; the client stays in memory. A blank field keeps it. Enter a replacement before a later click to correct it. Refresh clears local credentials. No automatic provider fallback.';
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
  const selected = doomLoaded && !!selectedAssetSource;
  $('#prepared-asset-name').textContent = selected
    ? selectedAssetSource === 'local'
      ? selectedAssetName
      : 'Freedoom Phase 1 v0.13.0'
    : '';
  $('#prepared-asset-detail').textContent = selected
    ? `${selectedAssetSource === 'local' ? 'Local IWAD' : 'Included game'}${run.prepared ? ' · Game ready' : ''}`
    : '';
  $('#setup-asset').textContent = selected
    ? 'Refresh to change the game file.'
    : selectedAssetName
      ? `${selectedAssetName} · selected`
      : '';
}
defineDecisionHistory();
const history = $('#decision-history');
type SessionRunPresentation = NonNullable<SessionPresentation['session']>;
let latestSession: SessionRunPresentation | undefined;
let latestVerifiedObservation: SessionPresentation['verifiedObservation'];
let setupAutoCollapseDone = false;
let keyCommitted = false;
let setupPointerActive = false;
let startupReady = false;
let wadSelected = false;
let selectedAssetName = '';
let selectedAssetSource: 'included' | 'local' | undefined;
let doomLoaded = false;
let manualKeyVisible = false;
let savedDecisionConfiguration = defaultDecisionConfiguration;
let selectedModel: OpenRouterModel = defaultOpenRouterModel;
let modelLocked = false;
let modelFactory = createOpenRouterDecisionProviderFactory(selectedModel);
let modelProbe: ReturnType<DecisionProviderFactory['probe']> | undefined;
function modelSelectionDisabled() {
  return (
    !oauth ||
    !startupReady ||
    oauth.busy ||
    oauth.closed ||
    modelLocked ||
    (!oauth.hasKey && !manualKeyVisible) ||
    latestSession?.phase === 'busy' ||
    latestSession?.phase === 'error' ||
    latestSession?.phase === 'terminal' ||
    !!latestSession?.waitingForSdk ||
    !!latestSession?.continuous?.active
  );
}
function displayModel() {
  if (!openRouterMode) return;
  $('#openrouter-model').disabled = modelSelectionDisabled();
  $('#openrouter-model-gpt').checked = selectedModel === defaultOpenRouterModel;
  $('#openrouter-model-jev').checked = selectedModel === 'typesafe/jev-1.14';
  $('#openrouter-model-help').textContent = modelLocked
    ? 'Model locked for this session. Refresh to choose again.'
    : '';
  if (modelProbe) $('#sdk').textContent = modelProbe.status;
  if (latestSession && modelProbe)
    $('#evidence').textContent = JSON.stringify(
      {
        ...latestSession.evidence,
        sdk: { ...latestSession.evidence.sdk, ...modelProbe.evidence },
      },
      null,
      2,
    );
}
function assetSelectionAllowed() {
  return (
    startupReady &&
    !oauth?.busy &&
    !oauth?.closed &&
    (!openRouterMode ||
      oauth?.hasKey ||
      /^[\x21-\x7e]+$/.test($('#key').value.trim())) &&
    (!latestSession || latestSession.controls.iwad)
  );
}
function localIwadPrepared() {
  // doomLoaded is set only by a session presentation with prepared === true.
  return selectedAssetSource === 'local' && doomLoaded;
}
function displayAssetControls() {
  const disabled = !assetSelectionAllowed();
  const loading = latestSession?.phase === 'preparing';
  const needsReload =
    latestSession?.phase === 'error' || latestSession?.phase === 'terminal';
  $('#iwad').disabled = disabled;
  const localLoading = selectedAssetSource === 'local' && loading;
  const localPrepared = localIwadPrepared();
  const picker = $('#iwad-picker');
  const selected = doomLoaded && !!selectedAssetSource;
  picker.hidden = selected;
  $('#included-freedoom').hidden = selected;
  $('#prepared-asset').hidden = !selected;
  picker.disabled = disabled;
  picker.setAttribute('aria-busy', String(localLoading));
  picker.title = localLoading || localPrepared ? selectedAssetName : '';
  $('#iwad-picker-label').textContent = localLoading
    ? `Preparing ${selectedAssetName}…`
    : localPrepared
      ? selectedAssetName
      : 'Choose local IWAD';
  $('#iwad-picker-state').textContent = localPrepared
    ? ' loaded.'
    : selectedAssetSource === 'local' && needsReload
      ? ' Preparation failed. Refresh to try again.'
      : '';
  const button = $('#included-freedoom');
  button.disabled = disabled;
  button.setAttribute('aria-busy', String(loading));
  const label = loading
    ? 'Loading Doom…'
    : doomLoaded
      ? 'Doom loaded'
      : needsReload
        ? 'Reload to retry'
        : 'Use included Freedoom';
  if (button.textContent !== label) button.textContent = label;
}
function displayOAuth() {
  displayAssetControls();
  if (!oauth) return;
  const preWad = !wadSelected && !latestSession;
  $('#openrouter-signin-button').disabled =
    !startupReady ||
    !preWad ||
    oauth.busy ||
    oauth.closed ||
    oauth.hasKey ||
    $('#key').value.trim().length > 0;
  $('#openrouter-signin-button').setAttribute('aria-busy', String(oauth.busy));
  $('#openrouter-signin-label').textContent = oauth.busy
    ? 'Connecting…'
    : oauth.hasKey
      ? 'OpenRouter sign-in complete'
      : 'Sign in with OpenRouter';
  $('#openrouter-manual').disabled = oauth.busy || oauth.closed;
  $('#openrouter-back').disabled = oauth.busy || oauth.closed;
  $('#openrouter-auth-status').textContent = latestSession?.hasClient
    ? 'OpenRouter client in memory.'
    : oauth.message;
  if (oauth.busy || oauth.closed) {
    $('#key').disabled = true;
  }
  displayModel();
}
function collapseCompletedSetup(
  focusTarget: Node | null = document.activeElement,
) {
  if (
    setupAutoCollapseDone ||
    setupPointerActive ||
    $('#setup').contains(focusTarget) ||
    !latestSession?.prepared ||
    !(
      jevMode ||
      oauth?.hasKey ||
      latestSession.hasClient ||
      (keyCommitted && $('#key').value.trim())
    )
  )
    return;
  setupAutoCollapseDone = true;
  $('#setup').open = false;
}
function updateControlAvailability(run: SessionRunPresentation | undefined) {
  const readiness = deriveDecisionControls(
    run,
    jevMode || !!oauth?.hasKey || $('#key').value.trim().length > 0,
    jevMode ? 'TypeSafe / Jev' : openRouterMode ? 'OpenRouter' : 'OpenAI',
  );
  const prerequisite = $('#control-prerequisite');
  prerequisite.textContent = readiness.bannerText ?? '';
  prerequisite.hidden = readiness.bannerText === null;
  $('#next').disabled = !readiness.buttonsEnabled;
  $('#start').disabled = !readiness.buttonsEnabled;
  const sessionReady = !!run?.controls.ready;
  const manualSetupReady =
    openRouterMode && startupReady && (!run || run.controls.iwad);
  $('#key').disabled = jevMode || !(sessionReady || manualSetupReady);
  if (!run) return;
  $('#budget').disabled = !sessionReady;
  $('#stop').disabled = !run.controls.stop;
  $('#tics').disabled = !run.controls.tics;
  $('#next').setAttribute('aria-busy', String(run.phase === 'busy'));
}
function recordedModelLabel(
  decisions: SessionRunPresentation['evidence']['decisions'],
): string {
  // Entries are chronological; action is recorded only after choice validation.
  for (let i = decisions.length - 1; i >= 0; i--) {
    const entry = decisions[i];
    const model = entry.requestIdentity?.requestedModel;
    if (!entry.action || !model?.trim()) continue;
    if (isOpenRouterModel(model)) return openRouterModels[model];
    if (model === 'gpt-6-luna') return 'GPT-6 Luna';
    if (model === 'jev-1.14.0') return 'Jev 1.14';
    return model;
  }
  return '';
}
function display(view: SessionPresentation) {
  if (view.verifiedObservation) {
    latestVerifiedObservation = view.verifiedObservation;
    updateStatePreview();
  }
  if (view.sdkStatus !== undefined) $('#sdk').textContent = view.sdkStatus;
  if (view.frameStatus !== undefined)
    $('#frame').textContent = view.frameStatus;
  if (view.iwadEnabled !== undefined) startupReady = view.iwadEnabled;
  const status = view.status;
  if (status)
    $('#status').textContent = jevMode
      ? status.replace(
          'Correct the key if needed, then click Next Decision to retry.',
          'Check TYPESAFE_API_KEY on the local Vite server before another manual attempt.',
        )
      : status;
  const run = view.session;
  if (run) {
    latestSession = run;
    // Successful loading remains true after later gameplay errors or retirement.
    doomLoaded ||= run.prepared;
  }
  updateControlAvailability(latestSession);
  displayOAuth();
  collapseCompletedSetup();
  if (!run) return;
  $('#status').dataset.phase = run.phase;
  const facing = latestVerifiedObservation?.facingProbe;
  $('#facing-evidence').textContent = latestVerifiedObservation
    ? `Last verified rendered tic ${latestVerifiedObservation.tic}: ${formatFacingProbe(latestVerifiedObservation.tic, facing)}\nRaw indices: ${facing ? `87 (sample tic)=${facing.tic} · 90 (kind)=${facing.kind} · 91 (door evidence)=${facing.door} · 92 (distance)=${facing.distance}` : 'unavailable'}`
    : 'No verified facing sample yet.';
  $('#collision-evidence').textContent =
    run.collisionEvidence ?? 'No verified action yet.';
  if (!openRouterMode)
    $('#evidence').textContent = JSON.stringify(run.evidence, null, 2);
  $('#key-state').textContent = jevMode
    ? jevKeyStatus
    : run.hasClient
      ? 'Client in memory; blank keeps it. Authentication unverified.'
      : 'Client in memory • Refresh clears it';
  history.display(run.evidence.decisions, run.inspectorRequests);
  const modelLabel = recordedModelLabel(run.evidence.decisions);
  $('#game-model').textContent = modelLabel;
  $('#game-model').hidden = !modelLabel;
  const outcome = projectLatestOutcome(
    run.evidence.decisions.at(-1),
    run.frame,
  );
  $('#outcome-number').textContent = outcome.number;
  $('#outcome-number').hidden = !outcome.number;
  $('#outcome-action').textContent = outcome.action;
  $('#outcome-evidence').textContent = outcome.evidence;
  $('#outcome-evidence').hidden = !outcome.evidence;
  const metrics = projectSessionMetrics(run.evidence.decisions);
  $('#session-input-tokens').textContent = metrics.inputTokens;
  $('#session-input-partial').hidden = !metrics.inputPartial;
  $('#session-api-latency').textContent = metrics.averageLatency;
  displaySetupStatus(run);
}
// The controller's startup probe precedes the user's choice. Keep its cached
// provenance model-neutral; presentation adds the current configured model.
// Each real client closes over its model, even when a later key replaces it.
const sessionOpenRouterFactory: DecisionProviderFactory = {
  probe() {
    modelProbe = modelFactory.probe();
    return {
      status: modelProbe.status,
      evidence: { provider: 'OpenRouter', version: '1.4.25' },
    };
  },
  create(key) {
    const client = modelFactory.create(key);
    modelLocked = true; // Only successful construction freezes the session.
    displayModel();
    return client;
  },
};
const controller = createSessionController(
  {
    localFetch,
    createWorker: () =>
      new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      }),
    readTics: () => $('#tics').valueAsNumber,
    readDecisionConfiguration: () => savedDecisionConfiguration,
    takeKey: () => {
      if (jevMode) {
        $('#key').value = '';
        return jevPlaceholder;
      }
      const key = $('#key').value.trim();
      if (key) $('#key').value = '';
      return oauth ? oauth.takeKey(key) : key;
    },
    clearKey: () => {
      $('#key').value = '';
      oauth?.clear();
      displayOAuth();
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
  jevMode
    ? jevDecisionProviderFactory
    : openRouterMode
      ? sessionOpenRouterFactory
      : openAiDecisionProviderFactory,
);
const syncCredentialReadiness = () => {
  updateControlAvailability(latestSession);
  displayOAuth();
};
if (oauth) {
  for (const selector of [
    '#openrouter-model-gpt',
    '#openrouter-model-jev',
  ] as const) {
    $(selector).addEventListener('change', () => {
      const value = $(selector).value;
      if (
        !modelSelectionDisabled() &&
        $(selector).checked &&
        isOpenRouterModel(value)
      ) {
        const factory = createOpenRouterDecisionProviderFactory(value);
        const probe = factory.probe();
        selectedModel = value;
        modelFactory = factory;
        modelProbe = probe;
      }
      displayModel();
    });
  }
  $('#openrouter-manual').addEventListener('click', () => {
    if (oauth.busy || oauth.closed) return;
    manualKeyVisible = true;
    $('#manual-key').hidden = false;
    $('#key').hidden = false;
    $('#openrouter-signin').hidden = true;
    $('#openrouter-manual').hidden = true;
    $('#openrouter-manual').setAttribute('aria-expanded', 'true');
    displayModel();
    ($('#key').disabled ? $('#openrouter-back') : $('#key')).focus();
  });
  $('#openrouter-back').addEventListener('click', () => {
    if (oauth.busy || oauth.closed) return;
    manualKeyVisible = false;
    if (!oauth.hasKey && !modelLocked) {
      // Sign-in starts a fresh page; the unavailable pre-auth choice is default.
      selectedModel = defaultOpenRouterModel;
      modelFactory = createOpenRouterDecisionProviderFactory(selectedModel);
      modelProbe = modelFactory.probe();
    }
    $('#key').value = ''; // Discard an unsubmitted edit rather than hide it.
    $('#manual-key').hidden = true;
    $('#key').hidden = true;
    $('#openrouter-signin').hidden = false;
    $('#openrouter-manual').hidden = false;
    $('#openrouter-manual').setAttribute('aria-expanded', 'false');
    syncCredentialReadiness();
    ($('#openrouter-signin-button').disabled
      ? $('#openrouter-manual')
      : $('#openrouter-signin-button')
    ).focus();
  });
  $('#openrouter-signin-button').addEventListener('click', async () => {
    // Enforce setup ownership independently of disabled-button presentation.
    if (
      !startupReady ||
      wadSelected ||
      latestSession ||
      manualKeyVisible ||
      oauth.busy ||
      oauth.closed ||
      oauth.hasKey ||
      $('#key').value.trim()
    )
      return;
    const connecting = oauth.begin();
    displayOAuth();
    await connecting;
    displayOAuth();
  });
  displayOAuth();
}
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
function clearPromptError() {
  $('#prompt-error').textContent = '';
  $('#prompt-error').hidden = true;
  $('#prompt-instructions').setAttribute('aria-invalid', 'false');
}
function updateStatePreview() {
  const observation = latestVerifiedObservation;
  $('#prompt-state-preview-note').textContent = observation
    ? `Preview based on last verified observation at tic ${observation.tic}.`
    : 'Preview available after a verified game observation.';
  if ($('#prompt-previous-action').checked)
    $('#prompt-state-preview-note').textContent +=
      ' Previous action outcome is omitted from this preview; requests include it only after an eligible action and its resulting frame are verified.';
  $('#prompt-state-preview-text').textContent = observation
    ? formatDecisionState(
        observation.tic,
        {
          includeReadyWeapon: $('#prompt-ready-weapon').checked,
          includeAmmo: $('#prompt-ammo').checked,
          includeHealth: $('#prompt-health').checked,
          includePreviousAction: $('#prompt-previous-action').checked,
          includeFacingProbe: $('#prompt-facing-probe').checked,
        },
        observation,
        undefined,
        observation.facingProbe,
      )
    : '';
}
function loadDecisionDraft() {
  $('#prompt-instructions').value =
    savedDecisionConfiguration.instructionTemplate;
  $('#prompt-ready-weapon').checked =
    savedDecisionConfiguration.includeReadyWeapon;
  $('#prompt-ammo').checked = savedDecisionConfiguration.includeAmmo;
  $('#prompt-health').checked = savedDecisionConfiguration.includeHealth;
  $('#prompt-previous-action').checked =
    savedDecisionConfiguration.includePreviousAction;
  $('#prompt-facing-probe').checked =
    savedDecisionConfiguration.includeFacingProbe;
  updateStatePreview();
  clearPromptError();
}
$('#view-prompt').addEventListener('click', () => {
  loadDecisionDraft();
  $('#prompt-dialog').showModal();
});
$('#save-prompt').addEventListener('click', () => {
  if (!$('#prompt-dialog').open) return;
  const draft = $('#prompt-instructions').value;
  if (!draft.trim()) {
    $('#prompt-error').hidden = false;
    $('#prompt-error').textContent =
      'Enter decision instructions before saving.';
    $('#prompt-instructions').setAttribute('aria-invalid', 'true');
    $('#prompt-instructions').focus();
    return;
  }
  savedDecisionConfiguration = Object.freeze({
    instructionTemplate: draft,
    includeReadyWeapon: $('#prompt-ready-weapon').checked,
    includeAmmo: $('#prompt-ammo').checked,
    includeHealth: $('#prompt-health').checked,
    includePreviousAction: $('#prompt-previous-action').checked,
    includeFacingProbe: $('#prompt-facing-probe').checked,
  });
  $('#prompt-dialog').close();
});
$('#reset-prompt').addEventListener('click', () => {
  $('#prompt-instructions').value = defaultDecisionInstructionTemplate;
  $('#prompt-ready-weapon').checked = false;
  $('#prompt-ammo').checked = false;
  $('#prompt-health').checked = false;
  $('#prompt-previous-action').checked = false;
  $('#prompt-facing-probe').checked = false;
  updateStatePreview();
  clearPromptError();
  $('#prompt-instructions').focus();
});
$('#prompt-instructions').addEventListener('input', clearPromptError);
$('#prompt-ready-weapon').addEventListener('change', updateStatePreview);
$('#prompt-ammo').addEventListener('change', updateStatePreview);
$('#prompt-health').addEventListener('change', updateStatePreview);
$('#prompt-previous-action').addEventListener('change', updateStatePreview);
$('#prompt-facing-probe').addEventListener('change', updateStatePreview);
$('#close-prompt').addEventListener('click', () => $('#prompt-dialog').close());
$('#prompt-dialog').addEventListener('close', () => {
  if ($('#prompt-dialog').open) return;
  loadDecisionDraft();
  $('#view-prompt').focus();
});
function selectIwad(
  file: LocalIwad,
  name: string,
  source: 'included' | 'local',
) {
  if (!assetSelectionAllowed()) return;
  wadSelected = true;
  selectedAssetName = name;
  selectedAssetSource = source;
  displayOAuth();
  void controller.prepare(file);
}
$('#included-freedoom').addEventListener('click', () => {
  if (!assetSelectionAllowed() || $('#included-freedoom').disabled) return;
  selectIwad(
    createIncludedFreedoom(import.meta.env.BASE_URL),
    'Included Freedoom Phase 1 v0.13.0',
    'included',
  );
});
$('#iwad-picker').addEventListener('click', () => {
  if (
    !assetSelectionAllowed() ||
    $('#iwad-picker').disabled ||
    $('#iwad').disabled
  )
    return;
  $('#iwad').click();
});
$('#iwad').addEventListener('change', () => {
  const file = $('#iwad').files?.[0];
  if (file) selectIwad(file, file.name, 'local');
});
window.addEventListener('pagehide', () => controller.close());
window.addEventListener('pageshow', (event) =>
  controller.restore(event.persisted),
);
if (oauth) {
  // Exchange errors are fixed helper messages, never controller exception text.
  // No WAD, Worker, provider client or Decisions request is started by auth.
  void (async () => {
    try {
      const exchanging = oauth.exchange();
      displayOAuth();
      await exchanging;
      if (oauth.closed) return;
      displayOAuth();
      await controller.initialize();
    } catch {
      // Unexpected bootstrap failures never expose auth exception details.
      startupReady = false;
      oauth.clear();
      $('#status').textContent = 'Startup failed. Reload to retry.';
    } finally {
      if (!startupReady && oauth.hasKey) oauth.clear();
      displayOAuth();
    }
  })();
} else {
  void controller.initialize();
}
