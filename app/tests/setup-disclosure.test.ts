// Imported presentation with synthetic DOM events; no browser, SDK or native game.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { buildDefaultDecisionRequest, defaultDecisionConfiguration, defaultDecisionInstructionTemplate, formatDecisionState } from '../src/decision-request.ts';
import { observation } from './fixtures/synthetic-doom.ts';

const session = vi.hoisted(() => ({
  ports: undefined,
  controller: {
    initialize: vi.fn(),
    next: vi.fn(),
    startContinuous: vi.fn(),
    stop: vi.fn(),
    prepare: vi.fn(),
    close: vi.fn(),
    restore: vi.fn(),
  },
}));
vi.mock('../src/session-controller', () => ({
  createSessionController: (ports) => {
    session.ports = ports;
    return session.controller;
  },
}));
vi.mock('../src/decision-history', () => ({
  defineDecisionHistory: () => {},
}));
// These presentation fixtures do not exercise the real shadow button or its focus.
vi.mock('../src/doom-button', () => ({ defineDoomButton: () => {} }));

class Element extends EventTarget {
  display = vi.fn();
  click = vi.fn();
  value = '';
  valueAsNumber = 2;
  disabled = false;
  hidden = false;
  open = true;
  textContent = '';
  dataset = {};
  files = [];
  attributes = new Map();
  summary = undefined;
  children = [];
  getContext() {
    return {};
  }
  querySelector() {
    return this.summary;
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  focus() {
    document.activeElement = this;
  }
  contains(node) {
    return node === this || this.children.includes(node);
  }
}

// Only native dialog state/focus and dismissal are simulated here.
class Dialog extends Element {
  open = false;
  showModal = vi.fn(() => {
    this.open = true;
    element('#prompt-instructions').focus();
  });
  close() {
    this.open = false;
    emit(this, 'close');
  }
  escape() {
    const cancel = new Event('cancel', { cancelable: true });
    if (this.dispatchEvent(cancel)) this.close();
  }
}

let elements, document;
const element = (id) => elements.get(id);
const emit = (target, type, properties = {}) =>
  target.dispatchEvent(Object.assign(new Event(type), properties));
const show = (overrides = {}, status = undefined) => session.ports.present({
  status,
  session: {
    phase: 'ready',
    prepared: true,
    hasClient: false,
    controls: { ready: true, stop: false, tics: true, iwad: false },
    evidence: { decisions: [] },
    verifiedTics: 1,
    ...overrides,
  },
});
function editKey(value = 'synthetic-key') {
  document.activeElement = element('#key');
  element('#key').value = value;
  emit(element('#key'), 'input');
}
function blurKey() {
  // Text change is committed while still focused; focusout follows focus moving.
  emit(element('#key'), 'change');
  document.activeElement = element('#next');
  emit(element('#setup'), 'focusout', { relatedTarget: element('#next') });
}
function toggleSetup() {
  // Native summary activation sends click before its default open-state toggle.
  emit(element('#setup').summary, 'click');
  emit(document, 'click');
  element('#setup').open = !element('#setup').open;
}

async function mount(mode = 'test', dev = true) {
  vi.stubEnv('MODE', mode);
  vi.stubEnv('DEV', dev);
  // Keep generic manual-key/disclosure cases on the explicit OpenAI path.
  // Default OpenRouter and its browser ports are covered in openrouter-mode.
  vi.stubEnv('VITE_DECISION_PROVIDER', dev && mode === 'jev' ? undefined : 'openai');
  vi.resetModules();
  vi.resetAllMocks();
  elements = new Map();
  document = new EventTarget();
  document.activeElement = null;
  document.querySelector = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return element(id);
  };
  const setup = document.querySelector('#setup');
  setup.summary = new Element();
  setup.children = [
    setup.summary,
    document.querySelector('#key'),
    document.querySelector('#iwad'),
    new Element(), // Nested credential-handling summary.
  ];
  const tics = document.querySelector('#tics');
  tics.value = '6';
  tics.valueAsNumber = 6;
  document.querySelector('#game-model').hidden = true;
  elements.set('#prompt-dialog', new Dialog());
  document.querySelector('#prompt-state-preview').open = false;
  const promptButton = document.querySelector('#view-prompt');
  promptButton.textContent = 'Configure AI Decision';
  promptButton.setAttribute('aria-haspopup', 'dialog');
  promptButton.setAttribute('aria-controls', 'prompt-dialog');
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', new EventTarget());
  await import('../src/main.ts');
}
beforeEach(() => mount());
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Latest Outcome status and session metrics', () => {
  it('places two initially unknown readouts directly after the only status in the right column', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const panel = html.match(/<section class="latest-outcome"[\s\S]*?<\/section>/)[0];
    assert.equal((panel.match(/role="status"/g) ?? []).length, 1);
    assert.equal((panel.match(/aria-live=/g) ?? []).length, 1);
    assert.match(panel, /<div class="game-status">\s*<p id="status" role="status" aria-live="polite">Loading engine identity…<\/p>\s*<dl class="outcome-session-metrics"[\s\S]*?<\/dl>\s*<\/div>/);
    assert.doesNotMatch(panel, /continuous-state|continuous-status/);
    assert.match(panel, /<dt>Reported input tokens<\/dt>\s*<dd><span id="session-input-tokens">—<\/span>/);
    assert.match(panel, /id="session-input-partial"[^>]* hidden>Partial<\/small>/);
    assert.match(panel, /<dt>Avg API latency<\/dt>\s*<dd id="session-api-latency">—<\/dd>/);
    show(); // Preparation's neutral tic and model selection supply no decisions.
    assert.equal(element('#session-input-tokens').textContent, '—');
    assert.equal(element('#session-api-latency').textContent, '—');
    assert.equal(element('#session-input-partial').hidden, true);
  });

  it('preserves the primary message across preparation, running, stopped, failure and terminal states', () => {
    session.ports.present({ status: 'Loading engine identity…' });
    assert.equal(element('#status').textContent, 'Loading engine identity…');
    for (const [phase, status, continuous, waitingForSdk] of [
      ['ready', 'Ready at tic 1 — neutral 1/1/1; passive checks unchanged.'],
      ['busy', 'Requesting one action', { active: true, used: 1, limit: 5 }],
      ['busy', 'Waiting for API cleanup', { active: true, stopRequested: true, dispatched: false, used: 4, limit: 5 }, true],
      ['busy', 'Verifying resulting frame', { active: true, stopRequested: true, dispatched: true, used: 4, limit: 5 }],
      ['ready', 'Stopped by user; no native action dispatched. Ready at tic 25.', { active: false, reason: 'Stopped by user; no native action dispatched', used: 4, limit: 5 }],
      ['error', 'Resulting frame unavailable. Reload to restart.'],
      ['terminal', 'Player death verified; frame retained. Reload to restart.', { active: false, reason: 'Player death verified', used: 4, limit: 5 }],
      ['terminal', 'E1M1 exit pending; frame retained. Reload to restart.'],
    ]) {
      show({ phase, continuous, waitingForSdk }, status);
      assert.equal(element('#status').textContent, status);
      assert.equal(element('#status').dataset.phase, phase);
      assert.equal(elements.has('#continuous-state'), false);
      // A session-only refresh must retain the primary message too.
      show({ phase, continuous, waitingForSdk });
      assert.equal(element('#status').textContent, status);
    }
  });

  it('refreshes during continuous lifecycle updates and retains metrics on status-only updates', () => {
    const entry = {
      number: 1, selectedTics: 6, stage: 'completed', status: 'Complete',
      action: 'forward', observation: null, result: null, execution: null,
      cumulativeVerifiedTics: 1, sdkInvoked: true, latencyMs: 200,
      responseMetadata: { reportedModel: null, usage: { input: 1000, output: null, total: null } },
    };
    const later = { ...entry, number: 2, stage: 'requesting', action: null,
      latencyMs: null, responseMetadata: undefined };
    const present = (decisions, overrides = {}, status = 'Requesting one action') => show({
      phase: 'busy', evidence: { decisions },
      continuous: { active: true, used: decisions.length, limit: 3 },
      ...overrides,
    }, status);
    present([entry]);
    assert.equal(element('#session-input-tokens').textContent, '1,000');
    assert.equal(element('#session-api-latency').textContent, '200 ms');
    assert.equal(element('#session-input-partial').hidden, true);
    present([entry, later]);
    assert.equal(element('#session-input-tokens').textContent, '1,000');
    assert.equal(element('#session-api-latency').textContent, '200 ms');
    assert.equal(element('#session-input-partial').hidden, false);
    const updated = { ...later, latencyMs: 566,
      responseMetadata: { reportedModel: null, usage: { input: 166, output: null, total: null } } };
    for (const stage of ['requesting', 'stepping', 'rendering', 'completed']) {
      present([entry, { ...updated, stage }]);
      assert.equal(element('#session-input-tokens').textContent, '1,166');
      assert.equal(element('#session-api-latency').textContent, '383 ms');
      assert.equal(element('#session-input-partial').hidden, true);
      assert.match(element('#outcome-number').textContent, /#2/);
      assert.equal(element('#status').textContent, 'Requesting one action');
      assert.equal(elements.has('#continuous-state'), false);
    }
    present([entry, { ...updated, stage: 'completed' }], {
      phase: 'ready',
      continuous: { active: false, reason: 'Stopped by user', used: 2, limit: 3 },
    }, 'Stopped by user. Ready at tic 13.');
    assert.equal(element('#status').textContent, 'Stopped by user. Ready at tic 13.');
    assert.equal(element('#session-input-tokens').textContent, '1,166');
    assert.equal(element('#session-api-latency').textContent, '383 ms');
    assert.equal(element('#session-input-partial').hidden, true);
    assert.equal(elements.has('#continuous-state'), false);
    session.ports.present({ status: 'Cleanup finished' });
    assert.equal(element('#status').textContent, 'Cleanup finished');
    assert.equal(element('#session-input-tokens').textContent, '1,166');
    assert.equal(element('#session-api-latency').textContent, '383 ms');
  });
});

describe('Recorded model beside Game view', () => {
  const identity = (requestedModel) => ({ provider: 'OpenRouter', requestedModel });
  const entry = (overrides = {}) => ({
    number: 1, selectedTics: 6, stage: 'requesting', status: 'Requesting decision',
    action: null, requestIdentity: identity('typesafe/jev-1.14'),
    observation: null, result: null, execution: null, cumulativeVerifiedTics: 1,
    ...overrides,
  });
  const displayDecisions = (decisions, overrides = {}) => show({
    evidence: { decisions }, ...overrides,
  });
  const assertLabel = (expected = '') => {
    assert.equal(element('#game-model').textContent, expected);
    assert.equal(element('#game-model').hidden, !expected);
  };

  it('starts hidden beside the semantic heading without a live announcement', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<section class="game" aria-labelledby="game-title">\s*<div class="game-heading">\s*<h2 id="game-title">Game view<\/h2>\s*<span id="game-model" hidden><\/span>\s*<\/div>/);
    assertLabel();
    displayDecisions([], { phase: 'unprepared', prepared: false, verifiedTics: 0 });
    assertLabel();
  });

  it('keeps the mandatory neutral preparation tic hidden', () => {
    show({ evidence: { decisions: [], neutralFirst: {
      mask: 0, requestedTics: 1, reportedCompletedTics: 1, independentlyVerifiedTics: 1,
    } } });
    assertLabel();
  });

  it('keeps a merely admitted or pending first request hidden, even with model metadata', () => {
    for (const stage of ['capturing', 'requesting', 'ended']) {
      displayDecisions([entry({ stage, sdkInvoked: stage !== 'capturing',
        responseMetadata: { reportedModel: 'unproven-reported-model' } })]);
      assertLabel();
    }
  });

  for (const [requestedModel, label] of [
    ['typesafe/jev-1.14', 'Jev 1.14'],
    ['openai/gpt-6-luna-decisions', 'GPT-6 Luna Decisions'],
    ['gpt-6-luna', 'GPT-6 Luna'],
    ['jev-1.14.0', 'Jev 1.14'],
    ['other/model-version', 'other/model-version'],
  ]) {
    it(`reveals the requested ${requestedModel} after a validated action`, () => {
      displayDecisions([entry({ action: 'forward', requestIdentity: identity(requestedModel),
        responseMetadata: { reportedModel: 'different-reported-model' } })]);
      assertLabel(label);
    });
  }

  it('also reveals a model-selected neutral action', () => {
    displayDecisions([entry({ action: 'neutral' })]);
    assertLabel('Jev 1.14');
  });

  it('retains the most recent selected model through later pending or failed attempts', () => {
    const first = entry({ action: 'forward' });
    const later = entry({ number: 2, requestIdentity: identity('openai/gpt-6-luna-decisions') });
    displayDecisions([first]);
    assertLabel('Jev 1.14');
    for (const stage of ['capturing', 'requesting', 'cleanup', 'ended']) {
      displayDecisions([first, { ...later, stage }]);
      assertLabel('Jev 1.14');
    }
    const selected = { ...later, action: 'turn_right' };
    displayDecisions([first, selected]);
    assertLabel('GPT-6 Luna Decisions');
    displayDecisions([first, selected, entry({ number: 3 })]);
    assertLabel('GPT-6 Luna Decisions');
  });

  it('does not invent a model for selected actions missing usable request identity', () => {
    const proven = entry({ action: 'fire' });
    for (const requestIdentity of [undefined, {}, identity(''), identity('   ')]) {
      const unidentified = entry({ number: 2, action: 'use', requestIdentity,
        responseMetadata: { reportedModel: 'openai/gpt-6-luna-decisions' } });
      displayDecisions([unidentified]);
      assertLabel();
      displayDecisions([proven, unidentified]);
      assertLabel('Jev 1.14');
    }
    displayDecisions([]);
    assertLabel();
  });

  it('retains the recorded model on Stop, terminal outcomes, errors and partial updates', () => {
    for (const phase of ['ready', 'terminal', 'error']) {
      displayDecisions([entry({ action: 'backward', stage: 'ended' })], {
        phase, continuous: { active: false, stopRequested: true, reason: 'Stopped', used: 1, limit: 2 },
      });
      assertLabel('Jev 1.14');
      session.ports.present({ status: 'Cleanup finished' });
      assertLabel('Jev 1.14');
    }
  });
});

it('Jev uses a placeholder, hides and clears browser key input, and explains server configuration', async () => {
  await mount('jev');
  assert.equal(element('#key').hidden, true);
  assert.equal(element('#key').disabled, true);
  assert.equal(element('#key').value, '');
  assert.equal(element('#key-label').hidden, true);
  assert.match(element('#key-note').textContent, /TYPESAFE_API_KEY only in the Vite server process/);
  assert.match(element('#key-state').textContent, /local Vite server/);
  show({ phase: 'preparing', prepared: false });
  assert.equal(element('#next').disabled, true);
  show();
  assert.equal(element('#next').disabled, false);
  assert.equal(element('#start').disabled, false);
  assert.equal(element('#key').disabled, true);
  assert.equal(element('#setup').open, false);
  element('#key').value = 'ignored-synthetic-browser-input';
  assert.equal(session.ports.takeKey(), 'jev-vite-proxy-not-a-credential');
  assert.equal(element('#key').value, '');
  session.ports.present({ status: 'HTTP failure (502); no native action dispatched. Correct the key if needed, then click Next Decision to retry.' });
  assert.match(element('#status').textContent, /Check TYPESAFE_API_KEY on the local Vite server/);
  assert.doesNotMatch(element('#status').textContent, /Correct the key/);
  show({ hasClient: true });
  assert.match(element('#key-state').textContent, /Authentication unverified/);
  emit(element('#view-prompt'), 'click');
  assert.equal(element('#prompt-dialog').open, true);
});

it('production with Jev mode honors the explicit OpenAI key opt-in', async () => {
  await mount('jev', false);
  assert.equal(element('#key').hidden, false);
  show();
  assert.equal(element('#next').disabled, true);
  editKey('synthetic-openai-key');
  assert.equal(session.ports.takeKey(), 'synthetic-openai-key');
  assert.equal(element('#key').value, '');
});

describe('Decision instructions editor', () => {
  it('keeps previous-action drafts separate and explains the preview without inventing an outcome', () => {
    emit(element('#view-prompt'), 'click');
    const checkbox = element('#prompt-previous-action');
    assert.equal(checkbox.checked, false);
    assert.equal(session.ports.readDecisionConfiguration().includePreviousAction, false);
    checkbox.checked = true;
    emit(checkbox, 'change');
    assert.equal(session.ports.readDecisionConfiguration().includePreviousAction, false);
    assert.match(element('#prompt-state-preview-note').textContent, /omitted from this preview.*only after an eligible action and its resulting frame are verified/);
    assert.doesNotMatch(element('#prompt-state-preview-text').textContent, /Previous verified action/);
    emit(element('#save-prompt'), 'click');
    assert.equal(session.ports.readDecisionConfiguration().includePreviousAction, true);
    emit(element('#view-prompt'), 'click');
    emit(element('#reset-prompt'), 'click');
    assert.equal(checkbox.checked, false);
    assert.equal(session.ports.readDecisionConfiguration().includePreviousAction, true);
    emit(element('#close-prompt'), 'click');
    emit(element('#view-prompt'), 'click');
    assert.equal(checkbox.checked, true);
  });
  it('uses a closed native state disclosure and an explicit empty preview without starting work', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const disclosure = html.match(/<details id="prompt-state-preview">[\s\S]*?<\/details>/)?.[0];
    assert.ok(disclosure, 'No open attribute: closed by default');
    assert.match(disclosure, /<summary>State preview<\/summary>/);
    assert.match(disclosure, /<pre id="prompt-state-preview-text"><\/pre>/);
    assert.match(disclosure, /The screenshot is included separately\. Future decisions obtain their own verified observation\./);
    assert.doesNotMatch(disclosure, /textarea|input|contenteditable/);
    assert.ok(html.indexOf('id="prompt-telemetry-note" class=') < html.indexOf(disclosure));
    assert.ok(html.indexOf(disclosure) < html.indexOf('for="prompt-instructions"'));
    const calls = Object.values(session.controller).map(method => method.mock.calls.length);
    const transport = vi.fn(() => assert.fail('Preview must not use transport'));
    vi.stubGlobal('fetch', transport);
    const saved = session.ports.readDecisionConfiguration();
    emit(element('#view-prompt'), 'click');
    assert.equal(element('#prompt-state-preview').open, false);
    element('#prompt-state-preview').open = true; // Simulate native summary activation.
    emit(element('#prompt-state-preview'), 'toggle');
    element('#prompt-ammo').checked = true;
    emit(element('#prompt-ammo'), 'change');
    element('#prompt-health').checked = true;
    emit(element('#prompt-health'), 'change');
    assert.equal(element('#prompt-state-preview-note').textContent, 'Preview available after a verified game observation.');
    assert.equal(element('#prompt-state-preview-text').textContent, '');
    assert.equal(session.ports.readDecisionConfiguration(), saved);
    assert.deepEqual(Object.values(session.controller).map(method => method.mock.calls.length), calls);
    assert.equal(transport.mock.calls.length, 0);
  });

  it('formats verified data with every draft selection and refreshes passively while preserving saved config and history', () => {
    const native = observation(73).native;
    const verified = { tic: 73, readyWeapon: native.readyWeapon, ammo: native.ammo, health: native.health };
    const historical = buildDefaultDecisionRequest(1, 6, 'data:image/png;base64,historical');
    const requests = Object.freeze({ 1: historical });
    show({ inspectorRequests: requests });
    session.ports.present({ verifiedObservation: verified });
    const calls = Object.values(session.controller).map(method => method.mock.calls.length);
    const saved = session.ports.readDecisionConfiguration();
    const originalRequest = JSON.stringify(historical);
    emit(element('#view-prompt'), 'click');
    element('#prompt-state-preview').open = true;
    const assertPreview = (options, source = verified) => {
      const expected = formatDecisionState(source.tic, options, source);
      assert.equal(element('#prompt-state-preview-text').textContent, expected);
      assert.equal(expected, buildDefaultDecisionRequest(source.tic, 6, historical.png, undefined, { ...saved, ...options }, source).context);
      assert.equal(element('#prompt-state-preview-note').textContent, `Preview based on last verified observation at tic ${source.tic}.`);
    };
    for (const [includeReadyWeapon, includeAmmo] of [[false, false], [true, false], [false, true], [true, true]]) {
      element('#prompt-ready-weapon').checked = includeReadyWeapon;
      emit(element('#prompt-ready-weapon'), 'change');
      element('#prompt-ammo').checked = includeAmmo;
      emit(element('#prompt-ammo'), 'change');
      for (const includeHealth of [false, true]) {
        element('#prompt-health').checked = includeHealth;
        emit(element('#prompt-health'), 'change');
        assertPreview({ includeReadyWeapon, includeAmmo, includeHealth });
      }
      assert.equal(session.ports.readDecisionConfiguration(), saved);
    }
    // A new verified render during continuous play updates the draft preview.
    const later = { ...verified, tic: 79, readyWeapon: null, ammo: null, health: 0 };
    session.ports.present({ verifiedObservation: later });
    assertPreview({ includeReadyWeapon: true, includeAmmo: true, includeHealth: true }, later);
    assert.match(element('#prompt-state-preview-text').textContent, /\nHealth: 0$/);
    emit(element('#reset-prompt'), 'click');
    assertPreview(defaultDecisionConfiguration, later);
    assert.equal(element('#prompt-state-preview').open, true, 'Reset leaves native disclosure state alone');
    assert.equal(session.ports.readDecisionConfiguration(), saved);
    for (const dismiss of [() => emit(element('#close-prompt'), 'click'), () => element('#prompt-dialog').escape()]) {
      element('#prompt-ammo').checked = true;
      emit(element('#prompt-ammo'), 'change');
      element('#prompt-health').checked = true;
      emit(element('#prompt-health'), 'change');
      dismiss();
      assert.equal(session.ports.readDecisionConfiguration(), saved);
      assert.equal(document.activeElement, element('#view-prompt'));
      emit(element('#view-prompt'), 'click');
      assertPreview(saved, later);
      assert.equal(element('#prompt-state-preview').open, true);
    }
    emit(element('#save-prompt'), 'click');
    assert.deepEqual(session.ports.readDecisionConfiguration(), saved);
    assert.equal(element('#prompt-state-preview').open, true);
    assert.equal(JSON.stringify(historical), originalRequest);
    assert.equal(element('#decision-history').display.mock.calls.at(-1)[1], requests);
    assert.deepEqual(Object.values(session.controller).map(method => method.mock.calls.length), calls);
  });

  it('labels the native dialog, textarea, validation and explicit actions without a form', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dialog = html.match(/<dialog id="prompt-dialog"[\s\S]*?<\/dialog>/)[0];
    assert.match(html, /<doom-button id="view-prompt" appearance="outline" aria-haspopup="dialog" aria-controls="prompt-dialog">Configure AI Decision<\/doom-button>/);
    assert.match(dialog, /aria-labelledby="prompt-title" aria-describedby="prompt-description"/);
    assert.match(dialog, /<h2 id="prompt-title">Configure AI Decision<\/h2>/);
    assert.match(dialog, /<label for="prompt-instructions">Decision instructions<\/label>/);
    assert.match(dialog, /<textarea id="prompt-instructions"[^>]*aria-describedby="prompt-instructions-note prompt-error"[^>]*autofocus/);
    assert.match(dialog, /<p id="prompt-error"[^>]*role="alert" hidden>/);
    assert.match(dialog, /id="save-prompt"[^>]*>Save</);
    assert.match(dialog, /id="close-prompt"[^>]*>Cancel</);
    assert.match(dialog, /id="reset-prompt"[^>]*>Reset to Default</);
    assert.match(dialog, /Tell the AI how to play\. This text is sent as <code>next_action\.instructions<\/code>, with <code>\{\{tics\}\}<\/code> replaced by the selected tic count\. Nothing else is added\./);
    assert.match(dialog, /The game still controls valid actions and actual duration\./);
    assert.match(dialog, /role="group" aria-label="Optional game state" aria-describedby="prompt-telemetry-note"/);
    assert.match(dialog, /<label><input id="prompt-ready-weapon" type="checkbox"> Ready weapon<\/label>/);
    assert.match(dialog, /<label><input id="prompt-ammo" type="checkbox"> Ammo<\/label>/);
    assert.match(dialog, /<label><input id="prompt-previous-action" type="checkbox"> Previous action outcome<\/label>/);
    assert.match(dialog, /Choose what the AI sees and how it plays\./);
    assert.match(dialog, /The current screenshot and verified tic are always included\./);
    assert.match(dialog, /Selected details update with each decision and are sent as <code>state<\/code>\./);
    assert.ok(dialog.indexOf('Game state</h3>') < dialog.indexOf('Decision instructions</label>'));
    assert.doesNotMatch(dialog, /readyWeapon|\{\{ammo\}\}|add or remove/);
    assert.match(dialog, /Changes apply to future decisions\. Continuous Mode keeps running while this dialog is open\./);
    assert.doesNotMatch(dialog, /<form|contenteditable/);
  });

  it('discards drafts on Cancel, Escape and native close, then restores saved text and focus', () => {
    const button = element('#view-prompt');
    const dialog = element('#prompt-dialog');
    const field = element('#prompt-instructions');
    const calls = Object.values(session.controller).map(method => method.mock.calls.length);
    assert.equal(button.disabled, false, 'Available before preparation');
    for (const dismiss of [
      () => emit(element('#close-prompt'), 'click'),
      () => dialog.escape(),
      () => dialog.close(),
    ]) {
      emit(button, 'click');
      assert.equal(dialog.open, true);
      assert.equal(document.activeElement, field);
      assert.equal(field.value, defaultDecisionInstructionTemplate);
      assert.ok(field.value.includes('{{tics}}'));
      assert.ok(field.value.endsWith('Do not assume unseen game state.'));
      field.value = 'Unsaved draft';
      emit(field, 'input');
      assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, defaultDecisionInstructionTemplate);
      dismiss();
      assert.equal(dialog.open, false);
      assert.equal(document.activeElement, button);
      assert.equal(field.value, defaultDecisionInstructionTemplate);
      assert.equal(element('#prompt-error').hidden, true);
    }
    assert.deepEqual(Object.values(session.controller).map(method => method.mock.calls.length), calls);
  });

  it('saves exact multiline text before preparation without controller or transport work', () => {
    const calls = Object.values(session.controller).map(method => method.mock.calls.length);
    const transport = vi.fn(() => { throw Error('Unexpected transport'); });
    vi.stubGlobal('fetch', transport);
    const template = '  Fire for {{tics}} tics.\nUse fire. {{tics}}  ';
    emit(element('#view-prompt'), 'click');
    element('#prompt-instructions').value = template;
    emit(element('#save-prompt'), 'click');
    assert.equal(element('#prompt-dialog').open, false);
    assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, template);
    assert.equal(document.activeElement, element('#view-prompt'));
    emit(element('#view-prompt'), 'click');
    assert.equal(element('#prompt-instructions').value, template);
    element('#prompt-instructions').value = 'Another unsaved draft';
    element('#prompt-dialog').escape();
    emit(element('#view-prompt'), 'click');
    assert.equal(element('#prompt-instructions').value, template);
    assert.deepEqual(Object.values(session.controller).map(method => method.mock.calls.length), calls);
    assert.equal(transport.mock.calls.length, 0);
  });

  it('requires Save after Reset to Default and lets Cancel preserve saved instructions', () => {
    const field = element('#prompt-instructions');
    emit(element('#view-prompt'), 'click');
    field.value = 'Use fire.';
    emit(element('#save-prompt'), 'click');
    for (const save of [false, true]) {
      emit(element('#view-prompt'), 'click');
      emit(element('#reset-prompt'), 'click');
      assert.equal(field.value, defaultDecisionInstructionTemplate);
      assert.equal(document.activeElement, field);
      assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, 'Use fire.');
      emit(element(save ? '#save-prompt' : '#close-prompt'), 'click');
      assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, save ? defaultDecisionInstructionTemplate : 'Use fire.');
    }
  });

  it('rejects blank drafts accessibly and clears validation on editing, Reset and dismissal', () => {
    const field = element('#prompt-instructions');
    const button = element('#view-prompt');
    emit(button, 'click');
    const error = element('#prompt-error');
    element('#prompt-ammo').checked = true;
    for (const value of ['', ' \n\t ']) {
      field.value = value;
      emit(element('#save-prompt'), 'click');
      assert.equal(element('#prompt-dialog').open, true);
      assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, defaultDecisionInstructionTemplate);
      assert.equal(field.attributes.get('aria-invalid'), 'true');
      assert.deepEqual(session.ports.readDecisionConfiguration(), defaultDecisionConfiguration);
      assert.equal(error.hidden, false);
      assert.equal(error.textContent, 'Enter decision instructions before saving.');
      assert.equal(document.activeElement, field);
    }
    field.value = 'Corrected instructions';
    emit(field, 'input');
    assert.equal(error.hidden, true);
    assert.equal(field.attributes.get('aria-invalid'), 'false');
    field.value = '';
    emit(element('#save-prompt'), 'click');
    emit(element('#reset-prompt'), 'click');
    assert.equal(error.hidden, true);
    field.value = '';
    emit(element('#save-prompt'), 'click');
    element('#prompt-dialog').escape();
    assert.equal(error.hidden, true);
    assert.equal(error.textContent, '');
    assert.equal(field.attributes.get('aria-invalid'), 'false');
    emit(button, 'click');
    assert.equal(field.value, defaultDecisionInstructionTemplate);
  });

  it('allows saving during continuous play without changing tics or invoking controls', () => {
    show({ phase: 'busy', continuous: { active: true }, controls: { ready: false, stop: true, tics: true, iwad: false } });
    const calls = Object.values(session.controller).map(method => method.mock.calls.length);
    emit(element('#view-prompt'), 'click');
    element('#prompt-instructions').value = 'Explore carefully';
    element('#tics').valueAsNumber = 35;
    emit(element('#tics'), 'input');
    assert.equal(element('#prompt-instructions').value, 'Explore carefully');
    assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, defaultDecisionInstructionTemplate);
    emit(element('#save-prompt'), 'click');
    assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, 'Explore carefully');
    assert.equal(session.ports.readTics(), 35);
    assert.deepEqual(Object.values(session.controller).map(method => method.mock.calls.length), calls);
  });

  it('toggles optional state independently without editing instructions or invoking controller/transport work', () => {
    const calls = Object.values(session.controller).map(method => method.mock.calls.length);
    const transport = vi.fn(() => { throw Error('Unexpected transport'); });
    vi.stubGlobal('fetch', transport);
    emit(element('#view-prompt'), 'click');
    const field = element('#prompt-instructions');
    field.value = 'Use fire\n';
    emit(field, 'input');
    for (const id of ['#prompt-ready-weapon', '#prompt-ammo', '#prompt-health', '#prompt-previous-action']) {
      const checkbox = element(id);
      assert.equal(checkbox.checked, false);
      checkbox.checked = true;
      emit(checkbox, 'change');
      emit(checkbox, 'change');
      assert.equal(field.value, 'Use fire\n', 'Toggles never edit instructions');
      assert.equal(checkbox.disabled, false);
      assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, defaultDecisionInstructionTemplate);
    }
    for (const id of ['#prompt-ready-weapon', '#prompt-ammo', '#prompt-health', '#prompt-previous-action']) {
      element(id).checked = false;
      emit(element(id), 'change');
    }
    assert.equal(field.value, 'Use fire\n', 'Unrelated text and trailing newline survive toggling');
    emit(element('#save-prompt'), 'click');
    assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, 'Use fire\n');
    assert.deepEqual(Object.values(session.controller).map(method => method.mock.calls.length), calls);
    assert.equal(transport.mock.calls.length, 0);
  });

  it('saves checkbox edits but discards unsaved toggles on Cancel/Escape and resets only the draft', () => {
    emit(element('#view-prompt'), 'click');
    const field = element('#prompt-instructions');
    const readyWeapon = element('#prompt-ready-weapon');
    const ammo = element('#prompt-ammo');
    const health = element('#prompt-health');
    const previousAction = element('#prompt-previous-action');
    for (const checkbox of [readyWeapon, ammo, health, previousAction]) {
      checkbox.checked = true;
      emit(checkbox, 'change');
    }
    field.value = 'Saved instructions for {{tics}}';
    const saved = field.value;
    emit(element('#save-prompt'), 'click');
    const savedConfiguration = session.ports.readDecisionConfiguration();
    assert.deepEqual(savedConfiguration, { instructionTemplate: saved, includeReadyWeapon: true, includeAmmo: true, includeHealth: true, includePreviousAction: true, includeFacingProbe: false });
    assert.equal(Object.isFrozen(savedConfiguration), true);
    assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, saved);
    for (const dismiss of [
      () => emit(element('#close-prompt'), 'click'),
      () => element('#prompt-dialog').escape(),
    ]) {
      emit(element('#view-prompt'), 'click');
      assert.equal(readyWeapon.checked, true);
      assert.equal(ammo.checked, true);
      assert.equal(health.checked, true);
      assert.equal(previousAction.checked, true);
      for (const checkbox of [readyWeapon, ammo, health, previousAction]) {
        checkbox.checked = false;
        emit(checkbox, 'change');
      }
      field.value = 'Discard these instructions too';
      dismiss();
      assert.equal(session.ports.readDecisionConfiguration(), savedConfiguration);
      assert.equal(document.activeElement, element('#view-prompt'));
      emit(element('#view-prompt'), 'click');
      assert.equal(field.value, saved);
      assert.equal(readyWeapon.checked, true);
      assert.equal(ammo.checked, true);
      assert.equal(health.checked, true);
      assert.equal(previousAction.checked, true);
      emit(element('#close-prompt'), 'click');
    }
    emit(element('#view-prompt'), 'click');
    emit(element('#reset-prompt'), 'click');
    assert.equal(field.value, defaultDecisionInstructionTemplate);
    assert.equal(readyWeapon.checked, false);
    assert.equal(ammo.checked, false);
    assert.equal(health.checked, false);
    assert.equal(previousAction.checked, false);
    assert.equal(session.ports.readDecisionConfiguration(), savedConfiguration);
    emit(element('#close-prompt'), 'click');
    assert.equal(session.ports.readDecisionConfiguration(), savedConfiguration);
    emit(element('#view-prompt'), 'click');
    assert.equal(readyWeapon.checked, true);
    assert.equal(ammo.checked, true);
    assert.equal(health.checked, true);
    assert.equal(previousAction.checked, true);
    emit(element('#reset-prompt'), 'click');
    emit(element('#save-prompt'), 'click');
    assert.deepEqual(session.ports.readDecisionConfiguration(), defaultDecisionConfiguration);
    assert.equal(session.ports.readDecisionConfiguration().instructionTemplate, defaultDecisionInstructionTemplate);
  });

  it('leaves obsolete telemetry tokens literal and independent from checkboxes', () => {
    emit(element('#view-prompt'), 'click');
    const field = element('#prompt-instructions');
    field.value = 'Choose with {{readyWeapon}} and {{ammo}}. Keep this text.';
    emit(field, 'input');
    for (const id of ['#prompt-ready-weapon', '#prompt-ammo', '#prompt-health', '#prompt-previous-action']) {
      const checkbox = element(id);
      assert.equal(checkbox.checked, false);
      assert.equal(checkbox.disabled, false);
      checkbox.checked = true;
      emit(checkbox, 'change');
    }
    assert.equal(field.value, 'Choose with {{readyWeapon}} and {{ammo}}. Keep this text.');
    emit(element('#save-prompt'), 'click');
    assert.deepEqual(session.ports.readDecisionConfiguration(), {
      instructionTemplate: field.value, includeReadyWeapon: true, includeAmmo: true, includeHealth: true, includePreviousAction: true, includeFacingProbe: false,
    });
  });
});

describe('Setup disclosure', () => {
  it('starts with three ordered Setup groups, nested key guidance and controls immediately after it', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<details id="setup"[^>]* open[^>]*>/);
    assert.match(html, /<summary><h2 id="setup-title">Setup<\/h2><\/summary>/);
    assert.match(html, /<doom-button id="iwad-picker" appearance="neutral" class="iwad-picker" secondary-label="File stays in your browser" disabled>\s*<svg class="iwad-folder-icon" slot="start"[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>\s*<span id="iwad-picker-label">Choose local IWAD<\/span>\s*<span id="iwad-picker-state"><\/span>\s*<\/doom-button>\s*<input id="iwad" type="file" accept="\.wad" aria-label="Choose local IWAD" hidden disabled>/);
    assert.match(html, /<doom-button id="included-freedoom" appearance="neutral" secondary-label="~9\.83 MiB download" disabled>Use included Freedoom<\/doom-button>/);
    assert.doesNotMatch(html, /asset-note|Refresh to change the game file/);
    assert.equal((html.match(/ secondary-label=/g) ?? []).length, 2);
    assert.match(html, /<div id="prepared-asset" role="status" aria-live="polite" aria-atomic="true" hidden>\s*<span id="prepared-asset-name"><\/span>\s*<span id="prepared-asset-detail"><\/span>\s*<\/div>\s*<span id="setup-asset"/);
    assert.match(html, /<details class="setup-details">\s*<summary>Privacy &amp; API Keys<\/summary>/);
    const details = html.match(/<details class="setup-details">([\s\S]*?)<\/details>/)![1];
    assert.match(details, /<p id="openrouter-key-settings" class="help" hidden>Manage or revoke keys in <a href="https:\/\/openrouter.ai\/settings\/keys" target="_blank" rel="noopener noreferrer">OpenRouter key settings<\/a>\.<\/p>/);
    assert.equal((html.match(/https:\/\/openrouter.ai\/settings\/keys/g) ?? []).length, 1);
    const groups = html.match(/<div class="setup-content">\s*<div class="setup-group setup-inference">([\s\S]*?)<\/div>\s*<div class="setup-group setup-model">([\s\S]*?)<\/div>\s*<div class="setup-file setup-group">([\s\S]*?)<\/div>\s*<\/div>\s*<\/details>\s*<section class="control-bar /);
    assert.ok(groups, 'All three groups stay inside Setup, before Decision controls');
    const [, inference, model, file] = groups;
    assert.match(inference, /^\s*<h3>1 Inference<\/h3>/);
    assert.match(inference, /<div id="manual-key">[\s\S]*?<\/div>\s*<details class="setup-details">/);
    assert.ok(inference.includes(details), 'Privacy remains with credentials');
    assert.doesNotMatch(inference, /id="openrouter-model"|id="iwad"/);
    assert.match(model, /^\s*<fieldset id="openrouter-model"/);
    assert.match(model, /id="openrouter-model-help"/);
    assert.match(file, /^\s*<h3>3 Game Data<\/h3>/);
    for (const id of ['included-freedoom', 'iwad-picker', 'iwad', 'prepared-asset', 'setup-asset'])
      assert.ok(file.includes(`id="${id}"`), `${id} stays in Game Data`);
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    assert.match(css, /\.setup-content\s*\{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/);
    assert.equal((css.match(/\.setup-content\s*\{/g) ?? []).length, 1, 'Setup stays stacked at intermediate widths too');
    assert.equal(element('#setup').open, true);
  });

  it('waits for preparation and a committed trimmed key without interrupting entry', () => {
    session.ports.present({ iwadEnabled: true });
    show({ phase: 'unprepared', prepared: false, controls: { ready: false, stop: false, tics: false, iwad: true } });
    assert.equal(element('#next').disabled, true);
    element('#iwad').files = [{ name: 'synthetic.wad' }];
    emit(element('#iwad'), 'change');
    show({ phase: 'preparing', prepared: false });
    assert.equal(element('#setup').open, true);
    assert.match(element('#setup-asset').textContent, /selected/);
    show();
    assert.equal(element('#setup').open, true);
    assert.match(element('#control-prerequisite').textContent, /Enter a temporary/);
    assert.equal(element('#next').disabled, true);
    editKey('   ');
    blurKey();
    assert.equal(element('#setup').open, true);
    editKey();
    assert.equal(element('#next').disabled, false);
    assert.equal(element('#start').disabled, false);
    show();
    emit(element('#key'), 'change');
    show();
    assert.equal(element('#setup').open, true);
    blurKey();
    assert.equal(element('#setup').open, false);
    assert.equal(element('#control-prerequisite').hidden, true);
  });

  it('remembers key completion before preparation, but respects resumed editing', () => {
    show({ phase: 'preparing', prepared: false });
    editKey();
    blurKey();
    assert.equal(element('#setup').open, true);
    editKey('synthetic-replacement');
    show();
    assert.equal(element('#setup').open, true);
    blurKey();
    assert.equal(element('#setup').open, false);
  });

  it('collapses on preparation if the key was already committed', () => {
    editKey();
    blurKey();
    assert.equal(element('#setup').open, true);
    show();
    assert.equal(element('#setup').open, false);
    assert.match(element('#setup-asset').textContent, /^$/);
  });

  for (const [button, method] of [['#next', 'next'], ['#start', 'startContinuous']]) {
    it(`keeps ${button} in place through pointerdown, blur, updates and target click`, () => {
      show();
      editKey();
      emit(document, 'pointerdown');
      blurKey();
      show();
      assert.equal(element('#setup').open, true);
      session.controller[method].mockImplementationOnce(() => {
        assert.equal(element('#setup').open, true, 'Target receives click before collapse');
        assert.equal(session.ports.takeKey(), 'synthetic-key');
        show({ hasClient: true, phase: 'busy', controls: { ready: false } });
        assert.equal(element('#setup').open, true, 'Synchronous presentation cannot move target');
      });
      emit(element(button), 'click');
      assert.equal(session.controller[method].mock.calls.length, 1);
      assert.equal(element('#setup').open, true);
      emit(document, 'click');
      assert.equal(element('#setup').open, false);
      assert.equal(element('#key').value, '');
      show({ hasClient: true });
      assert.equal(element('#next').disabled, false);
      assert.equal(element('#setup').open, false);
      emit(element('#stop'), 'click');
      assert.equal(session.controller.stop.mock.calls.length, 1);
    });
  }

  it('releases a canceled pointer gesture without dispatching a decision', () => {
    show();
    editKey();
    emit(document, 'pointerdown');
    blurKey();
    emit(document, 'pointercancel');
    assert.equal(element('#setup').open, false);
    assert.equal(session.controller.next.mock.calls.length, 0);
  });

  it('honors manual reopening, editing, key consumption and continuous/Stop updates', () => {
    show({ hasClient: true });
    assert.equal(element('#setup').open, false);
    toggleSetup();
    assert.equal(element('#setup').open, true);
    editKey('synthetic-replacement');
    blurKey();
    assert.equal(element('#setup').open, true);
    assert.equal(session.ports.takeKey(), 'synthetic-replacement');
    for (const continuous of [undefined, { active: true }, { active: true, stopRequested: true }, { active: false }]) {
      show({ hasClient: true, continuous });
      assert.equal(element('#setup').open, true);
    }
    toggleSetup();
    assert.equal(element('#setup').open, false);
    show({ hasClient: true });
    assert.equal(element('#setup').open, false);
  });

  it('honors deliberate toggles before completion and ignores nested disclosure clicks', () => {
    // Nested native details clicks bubble through document, never the outer summary.
    emit(document, 'click');
    toggleSetup();
    toggleSetup();
    show({ hasClient: true });
    assert.equal(element('#setup').open, true);
  });

  it('keeps an uncommitted key open after typing away from focus', () => {
    show();
    element('#key').value = 'synthetic-key';
    emit(element('#key'), 'input');
    show();
    emit(document, 'click');
    assert.equal(element('#setup').open, true);
    emit(element('#key'), 'change');
    assert.equal(element('#setup').open, false);
  });

  it('allows keyboard inspection of key handling before collapsing on leaving setup', () => {
    show();
    editKey();
    emit(element('#key'), 'change');
    const trustSummary = element('#setup').children.at(-1);
    document.activeElement = null; // Browser focusout can temporarily report body.
    emit(element('#setup'), 'focusout', { relatedTarget: trustSummary });
    document.activeElement = trustSummary;
    emit(document, 'click');
    show({ hasClient: true });
    assert.equal(element('#setup').open, true);
    document.activeElement = null;
    emit(element('#setup'), 'focusout', { relatedTarget: element('#next') });
    assert.equal(element('#setup').open, false);
  });
});

describe('Local IWAD picker presentation and delegation', () => {
  const unprepared = () => show({ phase: 'unprepared', prepared: false,
    controls: { ready: false, stop: false, tics: false, iwad: true } });
  const preparing = () => show({ phase: 'preparing', prepared: false });

  it('delegates synchronously once to the native input and respects all selection locks', () => {
    const picker = element('#iwad-picker'), input = element('#iwad');
    emit(picker, 'click');
    assert.equal(input.click.mock.calls.length, 0, 'Startup is not ready');
    session.ports.present({ iwadEnabled: true });
    unprepared();
    emit(picker, 'click');
    assert.equal(input.click.mock.calls.length, 1, 'No async boundary before opening the picker');
    assert.equal(session.controller.prepare.mock.calls.length, 0);
    picker.disabled = true;
    emit(picker, 'click');
    picker.disabled = false;
    input.disabled = true;
    emit(picker, 'click');
    assert.equal(input.click.mock.calls.length, 1, 'Both disabled states are respected');
    preparing();
    emit(picker, 'click');
    assert.equal(input.click.mock.calls.length, 1);
    show();
    emit(picker, 'click');
    assert.equal(input.click.mock.calls.length, 1, 'A prepared game cannot be replaced');
  });

  it('leaves cancellation inert without clearing an existing selection or claiming preparation', () => {
    session.ports.present({ iwadEnabled: true });
    const input = element('#iwad');
    emit(input, 'cancel');
    emit(input, 'change'); // Defensive empty selection; real cancel need not emit change.
    assert.equal(session.controller.prepare.mock.calls.length, 0);
    assert.equal(element('#iwad-picker-label').textContent, 'Choose local IWAD');
    assert.equal(element('#iwad-picker').attributes.get('aria-busy'), 'false');
    input.files = [{ name: 'previous.wad' }];
    emit(input, 'change');
    unprepared(); // Recoverable validation failure permits another choice.
    const status = element('#setup-asset').textContent;
    emit(input, 'cancel');
    assert.equal(input.files[0].name, 'previous.wad', 'Native file selection is not cleared');
    assert.equal(element('#setup-asset').textContent, status);
    assert.equal(session.controller.prepare.mock.calls.length, 1);
    assert.equal(element('#iwad-picker-label').textContent, 'Choose local IWAD');
  });

  it('shows preparation before success, retains the full filename, and shows refresh guidance only after preparation', () => {
    session.ports.present({ iwadEnabled: true });
    const name = `${'LONG_FILENAME_'.repeat(30)}<DOOM>&.WAD`;
    const file = { name };
    const input = element('#iwad'), picker = element('#iwad-picker');
    input.value = 'C:\\fakepath\\different.wad';
    input.files = [file];
    session.controller.prepare.mockImplementationOnce(() => { preparing(); return Promise.resolve(); });
    emit(input, 'change');
    assert.deepEqual(session.controller.prepare.mock.calls, [[file]]);
    assert.equal(element('#iwad-picker-label').textContent, `Preparing ${name}…`);
    assert.equal(picker.attributes.get('aria-busy'), 'true');
    assert.equal(picker.disabled, true);
    assert.equal(input.disabled, true);
    assert.equal(element('#iwad-picker-state').textContent, '');
    assert.equal(element('#setup-asset').textContent, `${name} · selected`);
    assert.doesNotMatch(element('#setup-asset').textContent, /Refresh/);
    assert.equal(element('#prepared-asset').hidden, true);
    assert.equal(element('#prepared-asset-detail').textContent, '');
    assert.equal(picker.hidden, false);
    assert.equal(element('#included-freedoom').hidden, false);
    show({ prepared: false });
    assert.equal(element('#iwad-picker-label').textContent, 'Choose local IWAD', 'Phase alone cannot prove preparation');
    assert.equal(element('#prepared-asset').hidden, true, 'Phase alone cannot show a ready status');
    show();
    assert.equal(element('#prepared-asset').hidden, false);
    assert.equal(element('#prepared-asset-name').textContent, name, 'Full chosen filename is rendered as text');
    assert.equal(element('#prepared-asset-detail').textContent, 'Local IWAD · Game ready');
    assert.equal(picker.hidden, true);
    assert.equal(element('#included-freedoom').hidden, true);
    assert.equal(element('#iwad-picker-label').textContent, name);
    assert.equal(element('#iwad-picker-state').textContent, ' loaded.');
    assert.equal(picker.title, name);
    assert.equal(picker.attributes.get('aria-busy'), 'false');
    assert.equal(picker.disabled, true);
    assert.equal(element('#setup-asset').textContent, 'Refresh to change the game file.');
    assert.equal(input.value, 'C:\\fakepath\\different.wad', 'The input value is neither used as a label nor reset');
    for (const phase of ['busy', 'error', 'terminal']) {
      show({ phase, prepared: phase === 'busy' });
      assert.equal(element('#iwad-picker-label').textContent, name);
      assert.equal(element('#setup-asset').textContent, 'Refresh to change the game file.');
      assert.equal(picker.disabled, true);
      assert.equal(picker.hidden, true);
      assert.equal(element('#included-freedoom').hidden, true);
      assert.equal(element('#prepared-asset').hidden, false);
      assert.equal(element('#prepared-asset-name').textContent, name);
      assert.equal(element('#prepared-asset-detail').textContent, phase === 'busy' ? 'Local IWAD · Game ready' : 'Local IWAD');
    }
  });

  it('preserves retryable and reload-required failures without a prepared-file label', () => {
    session.ports.present({ iwadEnabled: true });
    const input = element('#iwad'), picker = element('#iwad-picker');
    input.files = [{ name: 'invalid.wad' }];
    emit(input, 'change');
    preparing();
    session.ports.present({ status: 'Preparation failed: invalid WAD. Choose an IWAD again to retry preparation.' });
    unprepared();
    assert.equal(picker.disabled, false);
    assert.equal(picker.attributes.get('aria-busy'), 'false');
    assert.equal(element('#iwad-picker-label').textContent, 'Choose local IWAD');
    assert.equal(element('#iwad-picker-state').textContent, '');
    assert.match(element('#status').textContent, /invalid WAD/);
    assert.equal(element('#setup-asset').textContent, 'invalid.wad · selected');
    assert.equal(element('#prepared-asset').hidden, true);
    assert.equal(element('#prepared-asset-detail').textContent, '');
    assert.equal(picker.hidden, false);
    assert.equal(element('#included-freedoom').hidden, false);
    input.files = [{ name: 'another.wad' }];
    emit(input, 'change');
    preparing();
    session.ports.present({ status: 'Preparation failed: verification failed. Reload to restart.' });
    show({ phase: 'error', prepared: false });
    assert.equal(picker.disabled, true);
    assert.equal(picker.attributes.get('aria-busy'), 'false');
    assert.equal(element('#iwad-picker-label').textContent, 'Choose local IWAD');
    assert.match(element('#iwad-picker-state').textContent, /Preparation failed\. Refresh/);
    assert.match(element('#status').textContent, /verification failed/);
    assert.equal(element('#prepared-asset').hidden, true);
    assert.equal(element('#prepared-asset-detail').textContent, '');
    assert.equal(picker.hidden, false);
    assert.equal(element('#included-freedoom').hidden, false);
    input.files = [{ name: 'blocked.wad' }];
    emit(input, 'change');
    assert.equal(session.controller.prepare.mock.calls.length, 2);
    assert.equal(element('#setup-asset').textContent, 'another.wad · selected');
  });

  it('keeps included Freedoom status without attributing it to a previous local filename', () => {
    session.ports.present({ iwadEnabled: true });
    element('#iwad').files = [{ name: 'failed-local.wad' }];
    emit(element('#iwad'), 'change');
    unprepared();
    session.controller.prepare.mockImplementationOnce(() => { preparing(); return Promise.resolve(); });
    emit(element('#included-freedoom'), 'click');
    assert.equal(element('#iwad-picker-label').textContent, 'Choose local IWAD');
    assert.equal(element('#iwad-picker').title, '');
    assert.equal(element('#iwad-picker').attributes.get('aria-busy'), 'false');
    assert.equal(element('#iwad-picker').disabled, true);
    assert.equal(element('#prepared-asset').hidden, true);
    assert.equal(element('#included-freedoom').hidden, false);
    assert.equal(element('#included-freedoom').textContent, 'Loading Doom…');
    show();
    assert.equal(element('#iwad-picker-label').textContent, 'Choose local IWAD');
    assert.equal(element('#iwad-picker-state').textContent, '');
    assert.equal(element('#setup-asset').textContent, 'Refresh to change the game file.');
    assert.equal(element('#prepared-asset').hidden, false);
    assert.equal(element('#prepared-asset-name').textContent, 'Freedoom Phase 1 v0.13.0');
    assert.equal(element('#prepared-asset-detail').textContent, 'Included game · Game ready');
    assert.equal(element('#iwad-picker').hidden, true);
    assert.equal(element('#included-freedoom').hidden, true);
    assert.equal(element('#included-freedoom').textContent, 'Doom loaded');
  });
});

it('puts one labeled facing section first inside the closed Advanced evidence disclosure', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const disclosure = html.match(/<details class="advanced">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(disclosure, 'The native disclosure remains closed by default');
  assert.match(disclosure, /^\s*<summary>Advanced evidence: preparation, decisions and frame hashes<\/summary>\s*<section aria-labelledby="facing-evidence-label">/);
  const section = disclosure.match(/<section aria-labelledby="facing-evidence-label">([\s\S]*?)<\/section>/)?.[0];
  assert.ok(section);
  assert.match(section, /<h3 id="facing-evidence-label">Facing wall \/ door \(Experiment 2\)<\/h3>/);
  assert.match(section, /<pre id="facing-evidence" aria-labelledby="facing-evidence-label">No verified facing sample yet\.<\/pre>/);
  assert.match(section, /Native facing classifications await gameplay validation/);
  for (const id of ['facing-evidence', 'facing-evidence-label'])
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1);
  const remaining = disclosure.slice(disclosure.indexOf(section) + section.length);
  assert.match(remaining, /id="sdk" role="status"/);
  assert.match(remaining, /id="frame">No frame rendered/);
  assert.match(remaining, /Native collision telemetry \(Experiment 1\)/);
  assert.match(remaining, /id="collision-evidence"/);
  assert.match(remaining, /counts overlap; zero does not establish a clear path/);
  assert.match(remaining, /id="evidence">Not prepared/);
});

it('shows pending facing evidence until a verified sample, then preserves readable and raw ownership evidence', () => {
  const configuration = session.ports.readDecisionConfiguration();
  const calls = Object.values(session.controller).map(method => method.mock.calls.length);
  show({ phase: 'preparing', prepared: false, collisionEvidence: 'No verified action yet.' });
  assert.equal(element('#facing-evidence').textContent, 'No verified facing sample yet.');
  const verified = { tic: 2, health: 100, readyWeapon: null, ammo: null,
    facingProbe: { tic: 2, kind: 3, door: 2, distance: 24 } };
  session.ports.present({ verifiedObservation: verified });
  show({ collisionEvidence: 'Existing collision evidence.' });
  const text = element('#facing-evidence').textContent;
  assert.match(text, /^Last verified rendered tic 2: Facing probe .*clearance restriction about 24 units ahead/);
  assert.match(text, /Front-side manual-door use candidate; use may be possible, keys and door activity unknown/);
  assert.match(text, /Center ray only; full player clearance unknown/);
  assert.match(text, /\nRaw indices: 87 \(sample tic\)=2 · 90 \(kind\)=3 · 91 \(door evidence\)=2 · 92 \(distance\)=24$/);
  assert.equal(element('#collision-evidence').textContent, 'Existing collision evidence.');
  // A later unverified operation cannot relabel the prior sample as current.
  show({ phase: 'busy', verifiedTics: 3 });
  assert.equal(element('#facing-evidence').textContent, text);
  session.ports.present({ verifiedObservation: { ...verified, tic: 3,
    facingProbe: { tic: 3, kind: 0, door: 0, distance: -1 } } });
  show();
  assert.match(element('#facing-evidence').textContent, /unavailable at this verified frame/);
  assert.doesNotMatch(element('#facing-evidence').textContent, /24 units ahead/);
  assert.match(element('#facing-evidence').textContent, /87 \(sample tic\)=3 · 90 \(kind\)=0 · 91 \(door evidence\)=0 · 92 \(distance\)=-1/);
  assert.equal(session.ports.readDecisionConfiguration(), configuration);
  assert.deepEqual(Object.values(session.controller).map(method => method.mock.calls.length), calls);
});

it('keeps Nearby wall / door off by default and supports draft preview, Cancel, Save and Reset independently', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<input id="prompt-facing-probe" type="checkbox"> Nearby wall \/ door/);
  const verified = { tic: 2, health: 100, readyWeapon: null, ammo: null,
    facingProbe: { tic: 2, kind: 3, door: 2, distance: 24 } };
  session.ports.present({ verifiedObservation: verified });
  emit(element('#view-prompt'), 'click');
  const checkbox = element('#prompt-facing-probe');
  const original = session.ports.readDecisionConfiguration();
  assert.equal(checkbox.checked, false);
  assert.equal(original.includeFacingProbe, false);
  const instructions = element('#prompt-instructions').value;
  checkbox.checked = true; emit(checkbox, 'change');
  assert.match(element('#prompt-state-preview-text').textContent, /clearance restriction.*Front-side manual-door use candidate/);
  assert.equal(element('#prompt-instructions').value, instructions);
  assert.equal(session.ports.readDecisionConfiguration(), original);
  emit(element('#close-prompt'), 'click');
  emit(element('#view-prompt'), 'click');
  assert.equal(checkbox.checked, false);
  checkbox.checked = true; emit(element('#save-prompt'), 'click');
  assert.equal(session.ports.readDecisionConfiguration().includeFacingProbe, true);
  assert.equal(session.ports.readDecisionConfiguration().includePreviousAction, false);
  emit(element('#view-prompt'), 'click'); emit(element('#reset-prompt'), 'click');
  assert.equal(checkbox.checked, false);
  assert.equal(session.ports.readDecisionConfiguration().includeFacingProbe, true);
  element('#prompt-dialog').escape(); emit(element('#view-prompt'), 'click');
  assert.equal(checkbox.checked, true);
  session.ports.present({ verifiedObservation: { ...verified, tic: 3, facingProbe: { tic: 3, kind: 0, door: 0, distance: -1 } } });
  assert.match(element('#prompt-state-preview-text').textContent, /unavailable at this verified frame/);
  emit(element('#reset-prompt'), 'click'); emit(element('#save-prompt'), 'click');
  assert.deepEqual(session.ports.readDecisionConfiguration(), defaultDecisionConfiguration);
});
