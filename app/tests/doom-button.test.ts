// Tests the actual component against small fake DOM/native boundaries. No browser:
// native activation, composed propagation, focus, CSS and accessibility need Chrome QA.
// Slot assignments and slotchange delivery are explicit fixtures, not DOM distribution.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { defineDoomButton } from '../src/doom-button.ts';

// Vitest stubs CSS in Node. Verify link wiring with a URL fixture, not asset emission.
vi.mock('../src/doom-button.css?url&no-inline', () => ({
  default: '/assets/doom-button.css',
}));

let registry, targets, host, button, start, spinner;
class FakeElement extends EventTarget {
  nodeType = 1;
  attributes = new Map();
  children = [];
  assignments = [];
  assignedNodes = vi.fn(() => this.assignments);
  disabled = false;
  type = '';
  ariaExpanded = null;
  ariaHasPopup = null;
  shadowRoot;
  focus = vi.fn();
  click = vi.fn();
  private controls;
  private descriptions;

  constructor(public tagName = 'doom-button') { super(); }

  append(...children) { this.children.push(...children); }
  attachShadow(options) {
    this.shadowRoot = new FakeElement();
    this.shadowRoot.options = options;
    return this.shadowRoot;
  }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) {
    const previous = this.getAttribute(name);
    this.attributes.set(name, String(value));
    if (this.constructor.observedAttributes?.includes(name))
      this.attributeChangedCallback(name, previous, String(value));
  }
  removeAttribute(name) {
    const previous = this.getAttribute(name);
    if (!this.attributes.delete(name)) return;
    if (this.constructor.observedAttributes?.includes(name))
      this.attributeChangedCallback(name, previous, null);
  }
  toggleAttribute(name, force) {
    if (force) this.setAttribute(name, '');
    else this.removeAttribute(name);
  }
  get autofocus() { return this.hasAttribute('autofocus'); }
  set autofocus(value) { this.toggleAttribute('autofocus', value); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { this.toggleAttribute('hidden', value); }
  get ariaBusy() { return this.getAttribute('aria-busy'); }
  set ariaBusy(value) {
    if (value === null) this.removeAttribute('aria-busy');
    else this.setAttribute('aria-busy', value);
  }
  get ariaControlsElements() {
    return this.controls ?? this.resolve('aria-controls');
  }
  set ariaControlsElements(value) { this.controls = value; }
  get ariaDescribedByElements() {
    return this.descriptions ?? this.resolve('aria-describedby');
  }
  set ariaDescribedByElements(value) { this.descriptions = value; }
  private resolve(attribute) {
    return this.getAttribute(attribute)?.split(/\s+/).map(id => targets.get(id)).filter(Boolean) ?? null;
  }
}

beforeEach(() => {
  registry = new Map(); targets = new Map();
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('Node', { ELEMENT_NODE: 1, TEXT_NODE: 3 });
  vi.stubGlobal('document', { createElement: tag => new FakeElement(tag) });
  vi.stubGlobal('customElements', {
    get: name => registry.get(name),
    define: vi.fn((name, constructor) => registry.set(name, constructor)),
  });
  defineDoomButton();
  host = new (registry.get('doom-button'))();
  button = host.shadowRoot.children[1];
  [start, spinner] = button.children;
  // Class-field spies on the fake base would mask the real component's methods.
  delete host.focus; delete host.click; delete host.disabled;
  host.connectedCallback();
});
afterEach(() => vi.unstubAllGlobals());

it('registers once and creates one native action button, label slot, icon slot and external CSS link', () => {
  defineDoomButton();
  assert.equal(customElements.define.mock.calls.length, 1);
  assert.deepEqual(host.shadowRoot.options, { mode: 'open', delegatesFocus: true });
  assert.equal(button.tagName, 'button');
  assert.equal(button.type, 'button');
  assert.equal(button.children.length, 3);
  assert.equal(start.name, 'start');
  assert.equal(button.children[2].tagName, 'slot');
  assert.equal(button.children[2].name ?? '', ''); // Default label slot.
  const stylesheet = host.shadowRoot.children[0];
  assert.equal(stylesheet.rel, 'stylesheet');
  assert.match(stylesheet.href, /doom-button\.css/);
  assert.doesNotMatch(stylesheet.href, /^data:/);
  assert.equal(host.hasAttribute('tabindex'), false);
  assert.equal(host.hasAttribute('role'), false);
});

it('shows the decorative spinner only for aria-busy true with an empty start slot', () => {
  assert.equal(spinner.tagName, 'span');
  assert.equal(spinner.className, 'spinner');
  assert.equal(spinner.getAttribute('aria-hidden'), 'true');
  assert.equal(spinner.hasAttribute('tabindex'), false);
  assert.equal(spinner.hasAttribute('role'), false);
  assert.equal(spinner.hidden, true);
  host.setAttribute('aria-busy', 'true');
  assert.equal(spinner.hidden, false);
  host.setAttribute('aria-busy', 'false');
  assert.equal(spinner.hidden, true);
  host.setAttribute('aria-busy', '');
  assert.equal(spinner.hidden, true);
  host.setAttribute('aria-busy', 'true');
  assert.equal(spinner.hidden, false);
  host.removeAttribute('aria-busy');
  assert.equal(spinner.hidden, true);
  assert.deepEqual(host.constructor.observedAttributes, [
    'disabled', 'autofocus', 'aria-haspopup', 'aria-controls',
    'aria-describedby', 'aria-expanded', 'aria-busy',
  ]);
});

it('retains assigned logos/icons across busy transitions without a competing spinner', () => {
  const logo = new FakeElement('svg'); // SVG icons need not have text content.
  start.assignments = [logo];
  start.dispatchEvent(new Event('slotchange'));
  for (const busy of ['true', 'false', 'true']) {
    host.ariaBusy = busy;
    assert.equal(spinner.hidden, true);
    assert.deepEqual(start.assignments, [logo]);
    assert.equal(logo.hidden, false);
    assert.equal(logo.attributes.size, 0);
    assert.deepEqual(logo.children, []);
  }
  assert.deepEqual(start.assignedNodes.mock.lastCall, [{ flatten: true }]);
});

it('updates on slotchange while busy, ignoring whitespace and comments', () => {
  const whitespace = { nodeType: 3, textContent: ' \n\t ' };
  const comment = { nodeType: 8, textContent: 'incidental comment' };
  host.ariaBusy = 'true';
  for (const [assignments, hidden] of [
    [[whitespace, comment], false],
    [[whitespace, new FakeElement('svg')], true],
    [[], false],
    [[{ nodeType: 3, textContent: 'Leading content' }], true],
    [[whitespace], false],
  ]) {
    start.assignments = assignments;
    start.dispatchEvent(new Event('slotchange'));
    assert.equal(spinner.hidden, hidden);
  }
  host.ariaBusy = 'false';
  start.assignments = [];
  start.dispatchEvent(new Event('slotchange'));
  assert.equal(spinner.hidden, true);
});

it('refreshes slot presentation on connection without duplicating the native button', () => {
  host.ariaBusy = 'true';
  start.assignments = [new FakeElement('svg')];
  host.connectedCallback();
  assert.equal(spinner.hidden, true);
  start.assignments = [];
  host.connectedCallback();
  assert.equal(spinner.hidden, false);
  assert.equal(host.shadowRoot.children[1], button);
});

it('uses external CSS for the inherited-color spinner and disables its animation for reduced motion', () => {
  // Source assertions only: this harness cannot compute CSS or indicator geometry.
  const css = readFileSync(new URL('../src/doom-button.css', import.meta.url), 'utf8');
  assert.match(css, /\.spinner\s*\{[^}]*border: 2px solid currentColor;/);
  assert.match(css, /\.spinner:not\(\[hidden\]\)\s*\{\s*animation: busy-spin/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.spinner:not\(\[hidden\]\)\s*\{\s*animation: none;/);
  assert.equal(host.shadowRoot.children.some(child => child.tagName === 'style'), false);
});

it('requires both native element-reference properties rather than silently assigning expandos', () => {
  vi.stubGlobal('Element', class {});
  registry.clear();
  assert.throws(defineDoomButton, /ARIA element-reference support/);
  assert.equal(registry.size, 0);
});

it('reflects disabled synchronously and delegates enabled/disabled click handling to the native button', () => {
  const clicks = [];
  const delivered = new Event('click', { bubbles: true, composed: true });
  host.addEventListener('click', event => clicks.push(event));
  // Model delivery of one composed native click at the host boundary. Real DOM
  // propagation/retargeting and disabled activation are deliberately not simulated.
  button.click.mockImplementation(() => { if (!button.disabled) host.dispatchEvent(delivered); });
  host.ariaBusy = 'true';
  assert.equal(host.disabled, false);
  assert.equal(button.disabled, false);
  host.click();
  assert.deepEqual(clicks, [delivered]);
  clicks.length = 0;
  button.click.mockClear();
  host.disabled = true;
  assert.equal(host.hasAttribute('disabled'), true);
  assert.equal(button.disabled, true);
  host.click();
  assert.equal(clicks.length, 0);
  host.disabled = false;
  assert.equal(host.hasAttribute('disabled'), false);
  assert.equal(button.disabled, false);
  host.click();
  assert.deepEqual(clicks, [delivered]);
  assert.equal(clicks[0].bubbles, true);
  assert.equal(clicks[0].composed, true);
  assert.equal(button.click.mock.calls.length, 2);
  host.ariaBusy = 'false';
  assert.equal(host.disabled, false);
  assert.equal(button.disabled, false);
  host.setAttribute('disabled', 'false');
  assert.equal(host.disabled, true);
  assert.equal(button.disabled, true);
  host.removeAttribute('disabled');
  assert.equal(host.disabled, false);
  assert.equal(button.disabled, false);
});

it('forwards focus options and autofocus without adding a host tab stop', () => {
  host.focus({ preventScroll: true });
  assert.deepEqual(button.focus.mock.calls, [[{ preventScroll: true }]]);
  host.autofocus = true;
  assert.equal(button.autofocus, true);
  host.removeAttribute('autofocus');
  assert.equal(button.autofocus, false);
  assert.equal(host.hasAttribute('tabindex'), false);
});

it('forwards scalar ARIA state and keeps busy independent of disabled', () => {
  host.setAttribute('aria-haspopup', 'dialog');
  host.setAttribute('aria-expanded', 'false');
  host.ariaBusy = 'true';
  assert.equal(button.ariaHasPopup, 'dialog');
  assert.equal(button.ariaExpanded, 'false');
  assert.equal(button.ariaBusy, 'true');
  assert.equal(button.disabled, false);
  host.disabled = true;
  host.ariaBusy = 'false';
  assert.equal(button.disabled, true);
  assert.equal(button.ariaBusy, 'false');
  host.setAttribute('aria-expanded', 'true');
  assert.equal(button.ariaExpanded, 'true');
  host.removeAttribute('aria-haspopup');
  host.removeAttribute('aria-expanded');
  host.ariaBusy = null;
  assert.equal(button.ariaHasPopup, null);
  assert.equal(button.ariaExpanded, null);
  assert.equal(button.ariaBusy, null);
});

it('assigns controlled and describing element references and clears removed relationships', () => {
  const dialog = {}, note = {}, status = {};
  targets.set('dialog', dialog); targets.set('note', note); targets.set('status', status);
  host.setAttribute('aria-controls', 'dialog');
  host.setAttribute('aria-describedby', 'note status');
  assert.deepEqual(button.ariaControlsElements, [dialog]);
  assert.deepEqual(button.ariaDescribedByElements, [note, status]);
  assert.equal(button.getAttribute('aria-controls'), null);
  assert.equal(button.getAttribute('aria-describedby'), null);
  host.removeAttribute('aria-controls');
  host.removeAttribute('aria-describedby');
  assert.equal(button.ariaControlsElements, null);
  assert.equal(button.ariaDescribedByElements, null);
});

it('leaves hidden on the host, with an explicit shadow host visibility rule', () => {
  host.hidden = true;
  assert.equal(host.hasAttribute('hidden'), true);
  host.hidden = false;
  assert.equal(host.hasAttribute('hidden'), false);
  const css = readFileSync(new URL('../src/doom-button.css', import.meta.url), 'utf8');
  assert.match(css, /:host\(\[hidden\]\)\s*\{\s*display: none;/);
});

it('uses eleven static controls and retains native history-row creation and typed selectors', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const history = readFileSync(new URL('../src/decision-history.ts', import.meta.url), 'utf8');
  const expected = {
    'openrouter-signin-button': 'primary', 'openrouter-manual': 'text',
    'included-freedoom': 'neutral', 'iwad-picker': 'neutral', 'openrouter-back': 'text', next: 'primary',
    start: 'secondary', stop: 'outline', 'view-prompt': 'outline',
    'back-to-history': 'outline', 'close-prompt': 'outline',
  };
  const markup = [...html.matchAll(/<doom-button id="([^"]+)" appearance="([^"]+)"/g)];
  assert.deepEqual(Object.fromEntries(markup.map(match => [match[1], match[2]])), expected);
  assert.equal(markup.length, 11);
  assert.doesNotMatch(html, /<button\b/);
  for (const id of Object.keys(expected).filter(id => id !== 'back-to-history'))
    assert.ok(main.includes(`'#${id}': DoomButtonElement;`));
  assert.ok(main.indexOf('defineDoomButton();') < main.indexOf("const canvas = $('#screen')"));
  assert.match(history, /createElement\('button'\)/);
  assert.match(history, /private origin\?: HTMLButtonElement/);
  assert.match(history, /element<DoomButtonElement>\('#back-to-history'\)/);
});
