// Native DOM behavior is simulated, as in setup-disclosure.test.ts. No new DOM
// dependency; layout, image decoding and real keyboard defaults need browser QA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { defineDecisionHistory } from '../src/decision-history.ts';
import { buildDefaultDecisionRequest } from '../src/decision-request.ts';

let document, root, history, dialog, nodes, frames, observers, registry;
class Element extends EventTarget {
  children: Element[] = [];
  parentElement: Element | null = null;
  id = ''; className = ''; hidden = false; open = false; type = '';
  dataset = {}; attributes = new Map();
  clientHeight = 100; scrollHeight = 100; scrollTop = 0;
  private text = '';
  constructor(public tagName = 'decision-history') { super(); }
  get isConnected() { return this === root || !!this.parentElement?.isConnected; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(text) {
    this.text = text;
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }
  append(...children) { for (const child of children) this.insertBefore(child, null); }
  prepend(child) { this.insertBefore(child, this.children[0] ?? null); }
  insertBefore(child, before) {
    child.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, child); child.parentElement = this;
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector === `#${child.id}` || selector === child.tagName) return child;
      const descendant = child.querySelector(selector);
      if (descendant) return descendant;
    }
    return null;
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { document.activeElement = this; }
  click() {
    if (this.tagName === 'summary' && this.parentElement) this.parentElement.open = !this.parentElement.open;
    this.dispatchEvent(new Event('click'));
  }
}
class Dialog extends Element {
  constructor() { super('dialog'); }
  showModal = vi.fn(() => { this.open = true; });
  close() { if (this.open) { this.open = false; this.dispatchEvent(new Event('close')); } }
  escape() { if (this.dispatchEvent(new Event('cancel', { cancelable: true }))) this.close(); }
}
class Observer {
  observed = new Set();
  observe = vi.fn(node => this.observed.add(node));
  unobserve = vi.fn(node => this.observed.delete(node));
  disconnect = vi.fn(() => this.observed.clear());
  constructor(public callback) { observers.push(this); }
}
const flush = () => {
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback();
};
const entry = (number = 1, changes = {}) => ({
  number, selectedTics: 2, stage: 'requesting', status: 'Requesting one action', action: null,
  observation: { tic: 1 }, result: null, execution: null, cumulativeVerifiedTics: 1,
  requestId: null, latencyMs: null, http: null, sdkInvoked: true,
  requestIdentity: { provider: 'OpenAI', requestedModel: 'first-request-model' }, ...changes,
});
const row = number => history.children.find(node => node.id === `decision-${number}`);
const inspect = number => row(number).querySelector('button');
const text = id => nodes.get(id).textContent;
beforeEach(() => {
  frames = new Map(); observers = []; registry = new Map(); nodes = new Map();
  document = { activeElement: null, createElement: tag => new Element(tag) };
  vi.stubGlobal('document', document); vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('customElements', { get: name => registry.get(name), define: (name, constructor) => registry.set(name, constructor) });
  vi.stubGlobal('ResizeObserver', Observer); vi.stubGlobal('MutationObserver', Observer);
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.stubGlobal('fetch', vi.fn(() => assert.fail('Inspection must not send requests')));
  vi.stubGlobal('Worker', vi.fn(() => assert.fail('Inspection must not create Workers')));
  defineDecisionHistory(); defineDecisionHistory();
  root = new (registry.get('decision-history'))();
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const markup = html.match(/<decision-history\b[^>]*>([\s\S]*?)<\/decision-history>/)![1];
  // Build only the static element tree needed by the component, using real IDs
  // from the shipped markup. Text/CSS/native-browser behavior is outside this fake.
  const stack = [root];
  for (const token of markup.matchAll(/<\/?[a-z][^>]*>/g)) {
    const tag = token[0].match(/^<\/?([a-z0-9-]+)/)![1];
    if (token[0].startsWith('</')) { stack.pop(); continue; }
    const node = tag === 'dialog' ? new Dialog() : new Element(tag);
    const id = token[0].match(/\bid="([^"]+)"/)?.[1];
    if (id) { node.id = id; nodes.set(id, node); }
    stack.at(-1).append(node);
    if (!['img', 'input', 'br', 'hr'].includes(tag)) stack.push(node);
  }
  history = nodes.get('history'); dialog = nodes.get('decision-inspector');
  root.connectedCallback(); flush();
});
afterEach(() => { root.disconnectedCallback(); vi.unstubAllGlobals(); });

it('keeps newest-first row nodes/disclosures/focus while inspecting the original historical request', () => {
  const first = entry();
  const request1 = buildDefaultDecisionRequest(1, 2, 'data:image/png;base64,first');
  root.display([first], Object.freeze({ 1: request1 }));
  const firstRow = row(1), details = firstRow.querySelector('details'), trigger = inspect(1);
  details.querySelector('summary').click(); trigger.focus(); trigger.click();
  assert.equal(details.open, true); assert.equal(dialog.open, true);
  assert.equal(document.activeElement, nodes.get('close-inspector'));
  assert.equal(trigger.type, 'button');
  assert.equal(trigger.textContent, 'Inspect decision #1');
  assert.equal(trigger.attributes.get('aria-haspopup'), 'dialog');
  assert.equal(trigger.attributes.get('aria-controls'), 'decision-inspector');
  assert.equal(nodes.get('inspector-image').attributes.get('src'), request1.png);
  const completed = { ...first, stage: 'completed', action: 'neutral', latencyMs: 0, status: 'Complete', result: { tic: 3 }, execution: { complete: true },
    responseMetadata: { reportedModel: 'different-response-model', usage: { input: 9, output: 0, total: null } },
    choice: { confidence: 0, probabilities: [{ value: 'neutral', probability: 1 }, { value: 'fire', probability: 0 }] } };
  const second = entry(2, { selectedTics: 5, observation: { tic: 3 }, requestIdentity: { provider: 'OpenAI', requestedModel: 'second-request-model' } });
  const request2 = buildDefaultDecisionRequest(3, 5, 'data:image/png;base64,second');
  root.display([completed, second], Object.freeze({ 1: request1, 2: request2 }));
  assert.deepEqual(history.children.map(node => node.id), ['decision-2', 'decision-1']);
  assert.equal(row(1), firstRow); assert.equal(details.open, true);
  assert.equal(document.activeElement, nodes.get('close-inspector'));
  assert.equal(text('inspector-title'), 'Decision #1', 'New entries do not steal selection');
  assert.equal(text('inspector-instructions'), request1.instructions);
  assert.equal(text('inspector-context'), request1.context);
  assert.equal(text('inspector-actions'), request1.permittedActions.join('\n'));
  assert.match(text('inspector-diagnostics'), /first-request-model/);
  assert.match(text('inspector-diagnostics'), /different-response-model/);
  assert.doesNotMatch(text('inspector-diagnostics'), /second-request-model/);
  assert.match(text('inspector-usage'), /Output \/ completion tokens: 0/);
  assert.match(text('inspector-usage'), /Reported total tokens: Unavailable/);
  assert.match(text('inspector-answer'), /neutral: 100% · Selected/);
  assert.match(text('inspector-answer'), /API confidence: 0%/);
  for (const dismiss of [() => dialog.escape(), () => nodes.get('close-inspector').click()]) {
    dismiss(); assert.equal(dialog.open, false); assert.equal(document.activeElement, trigger);
    assert.equal(nodes.get('inspector-image').attributes.has('src'), false, 'Release the selected decoded image on close');
    trigger.click(); assert.equal(nodes.get('inspector-image').attributes.get('src'), request1.png);
  }
  dialog.close(); inspect(2).click();
  assert.equal(text('inspector-title'), 'Decision #2');
  assert.equal(nodes.get('inspector-image').attributes.get('src'), request2.png);
  assert.equal(text('inspector-context'), request2.context);
  assert.equal(fetch.mock.calls.length, 0); assert.equal(Worker.mock.calls.length, 0);
});

it('distinguishes capturing, prepared/uninvoked, pending, canceled and unavailable fields safely', () => {
  const input = buildDefaultDecisionRequest(1, 2, 'data:image/png;base64,stored');
  root.display([entry(1, { stage: 'capturing', sdkInvoked: false, requestIdentity: undefined })], {});
  inspect(1).click();
  assert.match(text('inspector-request-state'), /not yet prepared/);
  assert.equal(nodes.get('inspector-image').attributes.has('src'), false);
  assert.equal(text('inspector-instructions'), 'Pending');
  assert.match(text('inspector-diagnostics'), /Requested model \(not invoked\): Unavailable/);
  root.display([entry(1, { sdkInvoked: false })], { 1: input });
  assert.match(text('inspector-request-state'), /Request prepared; SDK invocation not attempted/);
  root.display([entry()], { 1: input });
  assert.match(text('inspector-usage'), /Token usage pending/);
  root.display([entry(1, { stage: 'ended', status: 'Stopped by user', http: 429 })], { 1: input });
  assert.match(text('inspector-state'), /Stopped by user · stage: ended/);
  assert.match(text('inspector-usage'), /Token usage unavailable/);
  assert.match(text('inspector-answer'), /Chosen action: Unavailable/);
  assert.match(text('inspector-diagnostics'), /HTTP status: 429/);
  root.display([entry(1, { stage: 'ended', status: '<img src=bad>', sdkInvoked: false, requestIdentity: undefined })], {});
  assert.match(text('inspector-state'), /<img src=bad>/);
  assert.equal(nodes.get('inspector-state').children.length, 0, 'Untrusted strings remain text');
  assert.equal(text('inspector-instructions'), 'Unavailable');
  assert.equal(nodes.get('inspector-image').attributes.has('src'), false);
});

it('updates the scroll cue after rows/disclosure/resize/scroll and cleans up on disconnect', () => {
  root.display([entry()], {});
  history.scrollHeight = 250;
  observers[1].callback(); flush();
  assert.equal(root.dataset.historyMore, 'true');
  assert.equal(observers[0].observed.has(row(1)), true);
  history.scrollTop = 149; history.dispatchEvent(new Event('scroll')); flush();
  assert.equal(root.dataset.historyMore, 'false', 'One-pixel tolerance at bottom');
  history.scrollTop = 0; history.clientHeight = 0; observers[0].callback(); flush();
  assert.equal(root.dataset.historyMore, 'false');
  history.clientHeight = 100; observers[0].callback(); flush();
  assert.equal(root.dataset.historyMore, 'true');
  const oldRow = row(1); root.display([], {}); observers[1].callback(); flush();
  assert.equal(observers[0].observed.has(oldRow), false);
  assert.equal(history.children.length, 0);
  assert.equal(nodes.get('history-empty').hidden, false);
  root.disconnectedCallback();
  assert.ok(observers.every(observer => observer.disconnect.mock.calls.length));
  history.dispatchEvent(new Event('scroll'));
  assert.equal(frames.size, 0);
});

it('clears removed selections and reconnects without duplicate rows or event handlers', () => {
  root.display([entry()], {}); inspect(1).click();
  const oldTrigger = inspect(1);
  root.display([], {});
  assert.equal(dialog.open, false);
  assert.notEqual(document.activeElement, oldTrigger, 'Do not restore focus to a removed trigger');
  root.disconnectedCallback(); root.connectedCallback();
  root.display([entry()], {});
  assert.equal(history.children.length, 1);
  inspect(1).click(); dialog.escape();
  assert.equal(document.activeElement, inspect(1));
});
