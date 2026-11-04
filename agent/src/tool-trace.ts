import type { LanguageModelMiddleware } from 'ai';

type ToolName = 'executeGuardedDecision' | 'consultLandmarks' | 'findLandmarks' | 'other';
type NativeStage = 'native-attempt' | 'native-admitted' | 'native-rejected' | 'callback-begin' |
  'callback-returned' | 'callback-threw' | 'callback-cancelled';
type Kind = NativeStage | 'prepare-step' | 'host-abort' | 'provider-delta' | 'provider-completed' | 'provider-other' |
  'stream-call' | 'stream-result' | 'tool-error' | 'error' | 'abort' | 'iterator-failure' | 'start-step' |
  'finish-step' | 'finish' | 'model-request' | 'forwarded-result' | 'parsed-call' | 'model-response-end';
type Event = { seq: number; kind: Kind; step: number; request: number; call?: number; item?: number;
  tool?: ToolName; prior?: number; ordinal?: number; seen?: boolean; code?: 'OVERLAP_OR_DUPLICATE' | 'OTHER'; outstanding?: number };
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
const toolName = (name: unknown): ToolName => name === 'executeGuardedDecision' || name === 'consultLandmarks' || name === 'findLandmarks' ? name : 'other';

// Opt-in, per-run, parent-only. No payload objects enter the event store. Alias
// lookup keys are ephemeral and bounded along with events; never serialized.
export class ToolTrace {
  private events: Event[] = [];
  private calls = new Map<string, number>();
  private items = new Map<string, number>();
  private seenNotifications = new Set<string>();
  private pending = new Set<number>();
  private step = 0;
  private request = 0;
  private parsed = 0;
  private firstError: 'tool-error' | 'error' | 'abort' | 'iterator-failure' | null = null;
  private truncated = false;
  private closed = false;
  private readonly limit = 128;
  private sequence = 0;
  private add(kind: Kind, fields: Omit<Partial<Event>, 'seq' | 'kind' | 'step' | 'request'> = {}) {
    if (this.closed) return;
    if (this.events.length >= this.limit) { this.truncated = true; this.events.shift(); }
    this.events.push({ seq: ++this.sequence, kind, step: this.step, request: this.request, ...fields });
  }
  private alias(map: Map<string, number>, id: unknown) {
    if (typeof id !== 'string' || this.closed) return undefined;
    const existing = map.get(id);
    if (existing) return existing;
    if (map.size >= this.limit) { this.truncated = true; return undefined; }
    const next = map.size + 1; map.set(id, next); return next;
  }
  prepare(stepNumber: number) { this.step = stepNumber + 1; this.add('prepare-step'); }
  native(kind: NativeStage, id: string, name: string, prior?: string) {
    this.add(kind, { call: this.alias(this.calls, id), tool: toolName(name),
      ...(prior ? { prior: this.alias(this.calls, prior) } : {}) });
  }
  abort() { this.add('host-abort', { outstanding: this.pending.size }); }
  providerRaw(value: unknown) {
    const raw = record(value), params = record(raw?.params);
    let kind: 'provider-delta' | 'provider-completed' | 'provider-other';
    let id: unknown;
    if (raw?.method === 'item/agentMessage/delta') { kind = 'provider-delta'; id = params?.itemId; }
    else if (raw?.method === 'item/completed' && record(params?.item)?.type === 'agentMessage') {
      kind = 'provider-completed'; id = record(params?.item)?.id;
    } else { this.add('provider-other'); return; }
    const item = this.alias(this.items, id);
    const key = item === undefined ? undefined : `${this.request}:${kind}:${item}`;
    const seen = key !== undefined && this.seenNotifications.has(key);
    if (key && this.seenNotifications.size < this.limit) this.seenNotifications.add(key);
    this.add(kind, { item, seen });
  }
  stream(type: string, id?: string, name?: string, error?: unknown) {
    if (type === 'tool-call') {
      const call = this.alias(this.calls, id); if (call) this.pending.add(call);
      this.add('stream-call', { call, tool: toolName(name) });
    } else if (type === 'tool-result') {
      const call = this.alias(this.calls, id); if (call) this.pending.delete(call);
      this.add('stream-result', { call, tool: toolName(name) });
    } else if (type === 'tool-error' || type === 'error' || type === 'abort' || type === 'iterator-failure') {
      this.firstError ??= type;
      // Compare to fixed codes; never save error names/messages or arbitrary codes.
      const code = error instanceof Error && error.message === 'REPEATED_OR_OVERLAPPING_HOST_CALL' ? 'OVERLAP_OR_DUPLICATE' : 'OTHER';
      this.add(type, { call: this.alias(this.calls, id), code, outstanding: this.pending.size });
    } else if (type === 'start-step' || type === 'finish-step' || type === 'finish') this.add(type);
  }
  parsedMiddleware(): LanguageModelMiddleware {
    return { specificationVersion: 'v4', wrapStream: async ({ doStream, params }) => {
      this.request++; this.parsed = 0; this.add('model-request');
      for (const message of params.prompt) if (message.role === 'tool') for (const part of message.content)
        if (part.type === 'tool-result') this.add('forwarded-result', { call: this.alias(this.calls, part.toolCallId), tool: toolName(part.toolName) });
      const result = await doStream();
      return { ...result, stream: result.stream.pipeThrough(new TransformStream({ transform: (part, controller) => {
        if (part.type === 'tool-call') this.add('parsed-call', { call: this.alias(this.calls, part.toolCallId), tool: toolName(part.toolName), ordinal: ++this.parsed });
        if (part.type === 'finish') this.add('model-response-end', { ordinal: this.parsed });
        controller.enqueue(part); // All model/tool events pass unchanged.
      } })) };
    } };
  }
  finish() {
    this.closed = true;
    this.calls.clear(); this.items.clear(); this.seenNotifications.clear();
    return { version: 1 as const, scope: 'parent' as const, limit: this.limit, truncated: this.truncated,
      firstError: this.firstError, outstanding: this.pending.size, events: structuredClone(this.events) };
  }
}
