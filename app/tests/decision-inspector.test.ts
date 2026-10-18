// Native DOM behavior is simulated, as in setup-disclosure.test.ts. No new DOM
// dependency; layout, image decoding and real keyboard defaults need browser QA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { masks } from '../src/decision.ts';
import { defineDecisionHistory } from '../src/decision-history.ts';
import { buildDefaultDecisionRequest } from '../src/decision-request.ts';

let document, root, history, detail, list, nodes, frames, observers, registry;
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
  focus(options?) { document.activeElement = this; document.focusOptions = options; }
  getBoundingClientRect() {
    // Synthetic 100px row geometry exercises anchoring, not browser layout.
    const top = this.parentElement
      ? this.parentElement.getBoundingClientRect().top - this.parentElement.scrollTop +
        (this.parentElement.tagName === 'ol' ? this.parentElement.children.indexOf(this) * 100 : 0)
      : 0;
    return { top };
  }
  click() { this.dispatchEvent(new Event('click')); }
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
const assertInputTokens = expected => {
  assert.equal(text('inspector-summary-input-tokens'), expected);
  assert.equal(text('inspector-input-tokens'), expected);
};
const back = () => nodes.get('back-to-history').click();
const distribution = (selected = 'neutral') => Object.keys(masks).map(value => ({
  value, probability: value === selected ? 0.4 : value === 'fire' ? 0.6 : 0,
}));
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
  // Build the static element tree using real IDs and hidden attributes. Native
  // focus/keyboard behavior and CSS are deliberately outside this fake.
  const stack = [root];
  for (const token of markup.matchAll(/<\/?[a-z][^>]*>/g)) {
    const tag = token[0].match(/^<\/?([a-z0-9-]+)/)![1];
    if (token[0].startsWith('</')) { stack.pop(); continue; }
    const node = new Element(tag);
    const id = token[0].match(/\bid="([^"]+)"/)?.[1];
    if (id) { node.id = id; nodes.set(id, node); }
    node.hidden = /\shidden(?:\s|>)/.test(token[0]);
    stack.at(-1).append(node);
    if (!token[0].endsWith('/>') && !['img', 'input', 'br', 'hr'].includes(tag)) stack.push(node);
  }
  history = nodes.get('history'); detail = nodes.get('decision-detail'); list = nodes.get('history-list-view');
  root.connectedCallback(); flush();
});
afterEach(() => { root.disconnectedCallback(); vi.unstubAllGlobals(); });

it('browses a representative completed decision with probabilities, usage, request and evidence details', () => {
  const completed = entry(1, {
    stage: 'completed', status: 'Decision completed', action: 'neutral',
    latencyMs: 42, http: 200, requestId: 'request-1', result: { tic: 3 },
    execution: {
      complete: true, requestedTics: 2, reportedCompletedTics: 2,
      independentlyVerifiedTics: 2, completionUncertain: false,
    },
    cumulativeVerifiedTics: 3,
    requestIdentity: { provider: 'OpenAI', requestedModel: 'test-model' },
    responseMetadata: {
      reportedModel: 'test-model-response',
      usage: { input: 120, output: 8, total: 128 },
    },
    choice: { confidence: 0.4, probabilities: distribution() },
  });
  const newer = entry(2, {
    stage: 'ended', status: 'Request canceled', sdkInvoked: false,
    requestIdentity: undefined,
  });
  const decisions = [completed, newer];
  const request = {
    ...buildDefaultDecisionRequest(1, 2, 'data:image/png;base64,history-image'),
    instructions: 'Choose one permitted action.',
    context: 'Observed E1M1 state.',
  };
  const requests = Object.freeze({ 1: request });
  root.display(decisions, requests);
  assert.deepEqual(history.children.map(node => node.id), ['decision-2', 'decision-1']);
  assert.equal(nodes.get('history-empty').hidden, true);
  assert.equal(list.hidden, false); assert.equal(detail.hidden, true);
  assert.equal(root.querySelector('dialog'), null);
  const header = nodes.get('detail-header');
  const title = nodes.get('inspector-title');
  assert.equal(header.parentElement, detail);
  for (const id of ['back-to-history', 'inspector-title'])
    assert.equal(nodes.get(id).parentElement, header, `${id} stays outside the scrolling body`);
  assert.ok(nodes.get('back-to-history').querySelector('svg'));
  assert.equal(nodes.get('detail-scroll').querySelector('#inspector-title'), null, 'No duplicate title in the body');
  assert.equal(nodes.get('detail-scroll').children[0], nodes.get('inspector-state'));
  const trigger = inspect(1);
  assert.equal(row(1).querySelector('details'), null);
  assert.match(trigger.textContent, /Completed · verified and rendered/);
  assert.ok(trigger.textContent.includes('API 42 ms · Input 120 tokens'));
  trigger.focus(); trigger.click();
  assert.equal(list.hidden, true); assert.equal(detail.hidden, false);
  assert.equal(document.activeElement, nodes.get('inspector-title'));
  assert.equal(text('inspector-title'), '#1 · neutral');
  assert.equal(text('inspector-state'), 'Completed · 2 tics independently verified');
  assert.equal(nodes.get('inspector-execution').parentElement, nodes.get('inspector-technical'));
  assert.equal(nodes.get('inspector-input-tokens').parentElement.parentElement, nodes.get('inspector-technical'));
  assert.match(text('inspector-execution'), /Native requested: 2 · Worker-reported: 2 · Independently verified: 2/);
  assert.match(text('inspector-result'), /Historical resulting frame verified and rendered/);
  const probabilities = nodes.get('inspector-probabilities');
  assert.equal(probabilities.hidden, false);
  assert.equal(probabilities.children.length, 7);
  assert.match(probabilities.children[0].textContent, /^fire/);
  assert.equal(probabilities.children[0].children[1].textContent, '60%');
  const selected = probabilities.children.filter(node => node.dataset.selected === 'true');
  assert.equal(selected.length, 1);
  assert.match(selected[0].textContent, /neutralSelected/);
  assert.equal(nodes.get('inspector-request').open, false);
  assert.equal(nodes.get('inspector-technical').open, false);
  assert.equal(text('inspector-instructions'), request.instructions);
  assert.equal(text('inspector-context'), request.context);
  assert.equal(text('inspector-actions'), request.permittedActions.join('\n'));
  assert.equal(text('inspector-image-status'), 'Historical request screenshot · 640 × 400');
  assert.equal(nodes.get('inspector-image').attributes.get('src'), request.png);
  assert.equal(text('inspector-model'), 'test-model');
  assert.equal(text('inspector-reported-model'), 'test-model-response');
  assertInputTokens('120');
  assert.match(text('inspector-diagnostics'), /HTTP status: 200/);
  assert.equal(title.parentElement, header);
  root.display(decisions, requests);
  assert.equal(inspect(1), trigger);
  assert.equal(detail.hidden, false);
  assert.equal(nodes.get('inspector-title').parentElement, header);
  back();
  assert.equal(list.hidden, false); assert.equal(detail.hidden, true);
  assert.equal(document.activeElement, trigger);
  assert.equal(fetch.mock.calls.length, 0); assert.equal(Worker.mock.calls.length, 0);
});

it('keeps historical selection, focus, disclosures and scroll across updates, then restores the row anchor', () => {
  const first = entry();
  const request1 = buildDefaultDecisionRequest(1, 2, 'data:image/png;base64,first');
  root.display([first], Object.freeze({ 1: request1 }));
  const firstRow = row(1), trigger = inspect(1);
  const title = nodes.get('inspector-title');
  history.scrollTop = 40;
  trigger.focus(); trigger.click();
  assert.equal(trigger.type, 'button');
  assert.equal(trigger.attributes.get('aria-controls'), 'decision-detail');
  assert.equal(trigger.attributes.has('aria-haspopup'), false);
  assert.equal(nodes.get('inspector-image').attributes.get('src'), request1.png);
  nodes.get('inspector-request').open = true;
  nodes.get('inspector-context').focus();
  nodes.get('detail-scroll').scrollTop = 200;
  const completed = { ...first, stage: 'completed', action: 'neutral', latencyMs: 0, status: 'Complete', result: { tic: 3 },
    execution: { complete: true, requestedTics: 2, reportedCompletedTics: 2, independentlyVerifiedTics: 2, completionUncertain: false },
    responseMetadata: { reportedModel: 'different-response-model', usage: { input: 9, output: 0, total: null } },
    choice: { confidence: 0, probabilities: distribution() } };
  const second = entry(2, { requestIdentity: { provider: 'OpenAI', requestedModel: 'second-request-model' } });
  const request2 = buildDefaultDecisionRequest(3, 5, 'data:image/png;base64,second');
  root.display([completed, second], Object.freeze({ 1: request1, 2: request2 }));
  assert.deepEqual(history.children.map(node => node.id), ['decision-2', 'decision-1']);
  assert.equal(row(1), firstRow);
  assert.equal(detail.hidden, false);
  assert.equal(document.activeElement, nodes.get('inspector-context'));
  assert.equal(nodes.get('inspector-request').open, true);
  assert.equal(nodes.get('detail-scroll').scrollTop, 200);
  assert.equal(text('inspector-title'), '#1 · neutral', 'New entries do not steal selection');
  assert.equal(nodes.get('inspector-title'), title);
  assert.equal(title.parentElement, nodes.get('detail-header'), 'Updated identity stays in the persistent header');
  assert.equal(text('inspector-instructions'), request1.instructions);
  assert.equal(text('inspector-context'), request1.context);
  assert.equal(text('inspector-actions'), request1.permittedActions.join('\n'));
  assert.equal(text('inspector-model'), 'first-request-model');
  assert.equal(text('inspector-reported-model'), 'different-response-model');
  assert.equal(nodes.get('inspector-reported-model').hidden, false);
  assert.equal(nodes.get('inspector-reported-model-label').hidden, false);
  assert.equal(text('inspector-output-tokens'), '0');
  assertInputTokens('9');
  assert.ok(trigger.textContent.includes('Input 9 tokens'));
  assert.equal(text('inspector-state'), 'Completed · 2 tics independently verified');
  assert.match(text('inspector-result'), /may no longer be the displayed frame/);
  const probabilities = nodes.get('inspector-probabilities').children;
  assert.match(probabilities[0].textContent, /^fire/);
  assert.equal(probabilities[0].dataset.selected, 'false');
  assert.equal(probabilities[1].dataset.selected, 'true', 'Selection need not have the highest probability');
  assert.equal(probabilities[1].children[1].textContent, '40%');
  assert.match(text('inspector-confidence'), /separate from action probabilities.*0%/);
  history.scrollTop = 0; // A hidden list may lose its browser scroll offset.
  back();
  assert.equal(history.scrollTop, 140, 'Restore offset plus the prepended row height');
  assert.equal(document.activeElement, trigger);
  assert.deepEqual(document.focusOptions, { preventScroll: true });
  assert.equal(nodes.get('inspector-image').attributes.has('src'), false);
  inspect(2).click();
  assert.equal(text('inspector-title'), '#2 · Action pending');
  assert.equal(nodes.get('inspector-request').open, false);
  assert.equal(nodes.get('detail-scroll').scrollTop, 0);
  assert.equal(nodes.get('inspector-image').attributes.get('src'), request2.png);
  assert.equal(fetch.mock.calls.length, 0); assert.equal(Worker.mock.calls.length, 0);
});

it('distinguishes pending, prepared/uninvoked, canceled and unavailable evidence without executing anything', () => {
  const input = buildDefaultDecisionRequest(1, 2, 'data:image/png;base64,stored');
  root.display([entry(1, { stage: 'capturing', sdkInvoked: false, requestIdentity: undefined })], {});
  inspect(1).click();
  assert.match(text('inspector-request-state'), /not yet prepared/);
  assert.match(text('inspector-execution'), /No native action dispatched/);
  assert.equal(text('inspector-instructions'), 'Pending');
  assertInputTokens('Unavailable');
  assert.ok(inspect(1).textContent.includes('Input tokens unavailable'));
  assert.match(text('inspector-diagnostics'), /Requested model \(not invoked\): Unavailable/);
  root.display([entry(1, { sdkInvoked: false })], { 1: input });
  assert.match(text('inspector-request-state'), /Request prepared; SDK invocation not attempted/);
  assertInputTokens('Unavailable');
  root.display([entry()], { 1: input });
  assertInputTokens('Pending');
  assert.ok(inspect(1).textContent.includes('Input tokens pending'));
  root.display([entry(1, { responseMetadata: {
    reportedModel: 'first-request-model', usage: { input: 0, output: 0, total: 0 },
  } })], { 1: input });
  assertInputTokens('0');
  assert.ok(inspect(1).textContent.includes('Input 0 tokens'));
  assert.equal(nodes.get('inspector-reported-model').hidden, true);
  assert.equal(nodes.get('inspector-reported-model-label').hidden, true);
  assert.match(text('inspector-diagnostics'), /Provider-reported model: first-request-model/);
  root.display([entry(1, { latencyMs: 1119, responseMetadata: {
    reportedModel: 'first-request-model', usage: { input: 505, output: null, total: null },
  } })], { 1: input });
  assertInputTokens('505');
  assert.ok(inspect(1).textContent.includes('API 1119 ms · Input 505 tokens'));
  root.display([entry(1, { responseMetadata: {
    reportedModel: 'first-request-model', usage: { input: null, output: 8, total: 128 },
  } })], { 1: input });
  assertInputTokens('Unavailable');
  assert.ok(inspect(1).textContent.includes('Input tokens unavailable'), 'Reported total does not imply input tokens');
  root.display([entry(1, { stage: 'ended', status: 'Stopped by user', http: 429 })], { 1: input });
  assert.equal(text('inspector-state'), 'Stopped by user');
  assertInputTokens('Unavailable');
  assert.equal(nodes.get('inspector-probabilities').hidden, true);
  assert.equal(text('probabilities-unavailable'), 'Action probabilities unavailable.');
  assert.match(text('inspector-diagnostics'), /HTTP status: 429/);
  const longText = `<img src=bad> ${'long-unbroken-context'.repeat(500)}`;
  root.display([entry(1, { stage: 'ended', status: '<img src=bad>', sdkInvoked: false, requestIdentity: undefined })], {
    1: { ...input, instructions: longText, context: longText },
  });
  assert.equal(text('inspector-state'), '<img src=bad>');
  assert.equal(nodes.get('inspector-state').children.length, 0);
  assert.equal(text('inspector-context'), longText);
  assert.equal(nodes.get('inspector-context').children.length, 0, 'Request text stays text, even when long');
  nodes.get('inspector-image').dispatchEvent(new Event('error'));
  assert.equal(nodes.get('inspector-image').hidden, true);
  assert.match(text('inspector-image-status'), /could not be displayed/);
});

it('keeps action selection, execution verification and resulting frame evidence separate', () => {
  const chosen = entry(1, { stage: 'rendering', action: 'use', execution: {
    complete: true, requestedTics: 2, reportedCompletedTics: 2, independentlyVerifiedTics: 2, completionUncertain: false,
  } });
  root.display([chosen], {}); inspect(1).click();
  assert.match(text('inspector-execution'), /Native requested: 2 · Worker-reported: 2 · Independently verified: 2/);
  assert.match(text('inspector-result'), /Action verified; resulting frame not yet available/);
  assert.equal(text('inspector-state'), 'Action verified · resulting frame pending');
  root.display([{ ...chosen, stage: 'stepping', execution: { ...chosen.execution,
    complete: false, reportedCompletedTics: null, independentlyVerifiedTics: 0, completionUncertain: true,
  } }], {});
  assert.match(text('inspector-result'), /verification in progress/);
  assert.equal(text('inspector-state'), 'Native verification in progress');
  assert.doesNotMatch(text('inspector-result'), /Reload required/);
  root.display([{ ...chosen, stage: 'ended', execution: { ...chosen.execution,
    complete: false, reportedCompletedTics: null, independentlyVerifiedTics: 1, completionUncertain: true,
  } }], {});
  assert.match(text('inspector-execution'), /1 tics \(lower bound; completion uncertain\)/);
  assert.match(text('inspector-result'), /completion uncertain.*do not replay/);
  assert.match(text('inspector-state'), /Completion uncertain · at least 1 tic verified/);
  root.display([entry(1, { action: 'use' })], {});
  assert.equal(text('inspector-state'), 'Choice received · no native dispatch');
  assert.match(text('inspector-execution'), /No native action dispatched/);
  assert.doesNotMatch(text('inspector-result'), /Action verified;/);
  const terminalStatus = 'Player dead at tic 2; 1 of 2 tics verified; frame retained.';
  root.display([{ ...chosen, stage: 'ended', status: terminalStatus, result: { tic: 2 },
    execution: { ...chosen.execution, complete: false, independentlyVerifiedTics: 1 },
  }], {});
  assert.equal(text('inspector-state'), terminalStatus, 'Retain the controller-verified terminal prefix');
});

it('updates the list-only scroll cue and cleans up observers on disconnect', () => {
  root.display([entry()], {});
  history.scrollHeight = 250;
  observers[1].callback(); flush();
  assert.equal(root.dataset.historyMore, 'true');
  assert.equal(observers[0].observed.has(row(1)), true);
  history.scrollTop = 149; history.dispatchEvent(new Event('scroll')); flush();
  assert.equal(root.dataset.historyMore, 'false', 'One-pixel tolerance at bottom');
  history.scrollTop = 0;
  inspect(1).click(); observers[1].callback(); flush();
  assert.equal(root.dataset.historyMore, 'false', 'No list cue while inspecting');
  back(); observers[1].callback(); flush();
  assert.equal(root.dataset.historyMore, 'true');
  history.clientHeight = 0; observers[0].callback(); flush();
  assert.equal(root.dataset.historyMore, 'false');
  const oldRow = row(1); root.display([], {}); observers[1].callback(); flush();
  assert.equal(observers[0].observed.has(oldRow), false);
  assert.equal(history.children.length, 0);
  assert.equal(nodes.get('history-empty').hidden, false);
  root.disconnectedCallback();
  assert.ok(observers.every(observer => observer.disconnect.mock.calls.length));
  history.dispatchEvent(new Event('scroll'));
  assert.equal(frames.size, 0);
});

it('returns safely when the selection disappears and reconnects without duplicate handlers', () => {
  root.display([entry()], {}); inspect(1).click();
  root.display([], {});
  assert.equal(detail.hidden, true); assert.equal(list.hidden, false);
  assert.equal(document.activeElement, history, 'Removed trigger gets a focusable list fallback');
  assert.equal(nodes.get('inspector-image').attributes.has('src'), false);
  root.disconnectedCallback(); root.connectedCallback();
  root.display([entry()], {});
  assert.equal(history.children.length, 1);
  inspect(1).click(); back();
  assert.equal(document.activeElement, inspect(1));
});
