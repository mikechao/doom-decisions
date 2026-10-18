// Imported presentation with synthetic DOM events; no browser, SDK or native game.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { formatDefaultDecisionInstructions } from '../src/decision-request.ts';

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
    element('#close-prompt').focus();
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
const show = (overrides = {}) => session.ports.present({
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
  elements.set('#prompt-dialog', new Dialog());
  const promptButton = document.querySelector('#view-prompt');
  promptButton.textContent = 'View Prompt';
  promptButton.setAttribute('aria-haspopup', 'dialog');
  promptButton.setAttribute('aria-controls', 'prompt-dialog');
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', new EventTarget());
  await import('../src/main.ts');
}
beforeEach(() => mount());
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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

describe('Read-only decision prompt preview', () => {
  it('keeps the custom trigger after limits guidance and labels the native read-only dialog', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<p id="stop-note"[^>]*>[^<]*<\/p>\s*<\/details>\s*<div class="prompt-group">\s*<hr>\s*<doom-button id="view-prompt" appearance="outline" aria-haspopup="dialog" aria-controls="prompt-dialog">View Prompt<\/doom-button>/);
    assert.match(html, /<dialog id="prompt-dialog" class="decision-prompt" aria-labelledby="prompt-title" aria-describedby="prompt-description">/);
    assert.match(html, /<h2 id="prompt-title">Decision Prompt<\/h2>/);
    assert.match(html, /<doom-button id="close-prompt" appearance="outline" autofocus>Close<\/doom-button>/);
    assert.match(html, /<p id="prompt-description" class="help">/);
    assert.match(html, /<p id="prompt-text"><\/p>/);
    assert.doesNotMatch(html, /prompt-panel|contenteditable/);
    assert.match(html, /Preview of the default next_action instructions using the current tic selection\./);
    assert.match(html, /In-flight decisions retain their captured duration\./);
  });

  it('opens before setup and closes by button, Escape or native close without controller actions', () => {
    const button = element('#view-prompt');
    const dialog = element('#prompt-dialog');
    const calls = Object.values(session.controller).map((method) => method.mock.calls.length);
    document.activeElement = button;
    assert.equal(button.disabled, false);
    assert.equal(dialog.open, false);
    assert.equal(button.textContent, 'View Prompt');
    assert.equal(button.attributes.get('aria-haspopup'), 'dialog');
    assert.equal(button.attributes.get('aria-controls'), 'prompt-dialog');
    for (const dismiss of [
      () => emit(element('#close-prompt'), 'click'),
      () => dialog.escape(),
      () => dialog.close(),
    ]) {
      emit(button, 'click');
      emit(document, 'click');
      assert.equal(dialog.open, true);
      assert.equal(button.textContent, 'View Prompt');
      assert.equal(document.activeElement, element('#close-prompt'));
      assert.equal(element('#prompt-text').textContent, formatDefaultDecisionInstructions(6));
      dismiss();
      assert.equal(dialog.open, false);
      assert.equal(button.textContent, 'View Prompt');
      assert.equal(document.activeElement, button);
    }
    assert.equal(dialog.showModal.mock.calls.length, 3);
    assert.deepEqual(Object.values(session.controller).map((method) => method.mock.calls.length), calls);
  });

  it('previews the current selection during play and refreshes when reopened', () => {
    show({ phase: 'busy', continuous: { active: true }, controls: { ready: false, stop: true, tics: true, iwad: false } });
    const button = element('#view-prompt');
    const tics = element('#tics');
    const calls = Object.values(session.controller).map((method) => method.mock.calls.length);
    assert.equal(button.disabled, false);
    emit(button, 'click');
    for (const [n, event] of [[1, 'input'], [6, 'change'], [35, 'input']]) {
      tics.value = String(n);
      tics.valueAsNumber = n;
      emit(tics, event);
      assert.equal(element('#prompt-text').textContent, formatDefaultDecisionInstructions(n));
      assert.equal(session.ports.readTics(), n, 'Preview leaves the selected duration intact');
    }
    emit(element('#close-prompt'), 'click');
    tics.value = '21';
    tics.valueAsNumber = 21;
    emit(tics, 'input');
    assert.equal(element('#prompt-text').textContent, formatDefaultDecisionInstructions(35));
    emit(button, 'click');
    assert.equal(element('#prompt-text').textContent, formatDefaultDecisionInstructions(21));
    assert.deepEqual(Object.values(session.controller).map((method) => method.mock.calls.length), calls);
  });

  it('replaces stale instructions for empty or invalid tics and recovers on valid input', () => {
    const calls = Object.values(session.controller).map((method) => method.mock.calls.length);
    emit(element('#view-prompt'), 'click');
    const tics = element('#tics');
    for (const n of [NaN, 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      tics.value = Number.isNaN(n) ? '' : String(n);
      tics.valueAsNumber = n;
      emit(tics, 'input');
      assert.equal(element('#prompt-text').textContent, 'Enter a positive JavaScript safe integer for tics to preview instructions.');
    }
    tics.value = '35';
    tics.valueAsNumber = 35;
    emit(tics, 'change');
    assert.equal(element('#prompt-text').textContent, formatDefaultDecisionInstructions(35));
    emit(element('#close-prompt'), 'click');
    tics.value = '';
    tics.valueAsNumber = NaN;
    emit(element('#view-prompt'), 'click');
    assert.equal(element('#prompt-text').textContent, 'Enter a positive JavaScript safe integer for tics to preview instructions.');
    assert.deepEqual(Object.values(session.controller).map((method) => method.mock.calls.length), calls);
  });
});

describe('Setup disclosure', () => {
  it('starts with a native open disclosure, nested key guidance and controls immediately after it', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<details id="setup"[^>]* open[^>]*>/);
    assert.match(html, /<summary><h2 id="setup-title">Setup<\/h2><\/summary>/);
    assert.match(html, /<label class="iwad-picker[^\"]*" for="iwad">[\s\S]*?<svg class="iwad-folder-icon"[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>\s*<span>Choose local IWAD<\/span>[\s\S]*?<input id="iwad" type="file" accept="\.wad" aria-describedby="asset-note" disabled>\s*<\/label>/);
    assert.match(html, /<doom-button id="included-freedoom" appearance="neutral"[^>]* disabled>Use included Freedoom<\/doom-button>/);
    assert.match(html, /<p id="asset-note" class="help asset-note">Freedoom download: ~9\.83 MiB\. Local files stay in your browser\. Refresh to change the game file\.<\/p>/);
    assert.match(html, /<details class="setup-details">\s*<summary>Privacy &amp; API key details<\/summary>/);
    const details = html.match(/<details class="setup-details">([\s\S]*?)<\/details>/)![1];
    assert.match(details, /<p id="openrouter-key-settings" class="help" hidden>Manage or revoke keys in <a href="https:\/\/openrouter.ai\/settings\/keys" target="_blank" rel="noopener noreferrer">OpenRouter key settings<\/a>\.<\/p>/);
    assert.equal((html.match(/https:\/\/openrouter.ai\/settings\/keys/g) ?? []).length, 1);
    assert.match(html, /<\/details>\s*<\/div>\s*<\/details>\s*<section class="control-bar /);
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
