// Imported presentation with synthetic DOM events; no browser, SDK or native game.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

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
  createDecisionHistory: () => () => {},
}));

class Element extends EventTarget {
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
  contains(node) {
    return node === this || this.children.includes(node);
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

beforeEach(async () => {
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
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', new EventTarget());
  await import('../src/main.ts');
});
afterEach(() => vi.unstubAllGlobals());

describe('Setup & Key disclosure', () => {
  it('starts with a native open disclosure, nested key guidance and controls immediately after it', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<details id="setup"[^>]* open[^>]*>/);
    assert.match(html, /<summary><h2 id="setup-title">Setup &amp; Key<\/h2><\/summary>/);
    assert.match(html, /<details class="setup-details">/);
    assert.match(html, /<\/details>\s*<\/div>\s*<\/details>\s*<section class="control-bar /);
    assert.equal(element('#setup').open, true);
  });

  it('waits for preparation and a committed trimmed key without interrupting entry', () => {
    show({ phase: 'unprepared', prepared: false });
    assert.equal(element('#next').disabled, true);
    element('#iwad').files = [{ name: 'synthetic.wad' }];
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
