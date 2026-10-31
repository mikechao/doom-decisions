import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

// Deliberately small wire boundary, not a reusable RPC library. Payloads never logged.
// biome-ignore lint/suspicious/noExplicitAny: installed protocol inspected; dynamic JSON boundary
export type Wire = Record<string, any>;
export function terminalFor(message: Wire, threadId: string, turnId: string): boolean {
  return message.method === 'turn/completed' && message.params?.threadId === threadId && message.params?.turn?.id === turnId;
}
function safeError(value: unknown): string {
  if (typeof value !== 'string') return 'unavailable';
  return value.replace(/(?:Bearer\s+|sk-)[A-Za-z0-9_.-]+/gi, '[secret]').replace(/[A-Za-z0-9+/_=-]{40,}/g, '[redacted]').replace(/https?:\/\/\S+/g, '[url]').replace(/\/[A-Za-z0-9_.~/-]+/g, '[path]').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]').slice(0, 400);
}
export class Rpc {
  child;
  wake = new EventEmitter();
  events: Wire[] = [];
  ledger: Wire[] = [];
  pending = new Map<number, { resolve: (value: Wire) => void; reject: (error: Error) => void }>();
  serial = 0;
  fatal: Error | undefined;
  toolExecutions = 0;
  serverRequests = 0;
  stderrBytes = 0;
  stderrWarnings = 0;
  stderrErrors = 0;
  stderrDiagnostics: string[] = [];
  started = Date.now();
  exit: Promise<{ code: number | null; signal: string | null }>;
  constructor(args: string[], cwd: string) {
    this.child = spawn('codex', ['app-server', ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exit = new Promise(resolve => this.child.once('close', (code, signal) => resolve({ code, signal })));
    this.child.on('error', () => this.fail('App Server spawn failed'));
    this.child.stdin.on('error', () => this.fail('App Server stdin failed'));
    this.child.on('exit', () => this.fail('App Server exited'));
    this.child.stderr.on('data', (data: Buffer) => {
      this.stderrBytes += data.length;
      const line = data.toString();
      // Retain only short startup error lines, never arbitrary diagnostic payloads.
      for (const entry of line.split('\n')) {
        if (entry.trim() && entry.length <= 200 && !/token|secret|auth|key|Bearer|https?:|data:/i.test(entry)) {
          const safe = entry.replace(/(?:\/Users|\/private|\/home)\/\S+/g, '[path]').replace(/[`"']([A-Za-z_][A-Za-z0-9_.-]*)[`"']/g, '$1').replace(/[`"'][^`"']*[`"']/g, '[value]').replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]');
          this.stderrDiagnostics.push(safe);
        }
      }
      this.stderrWarnings += (line.match(/\bWARN(?:ING)?\b/g) ?? []).length;
      this.stderrErrors += (line.match(/\bERROR\b/g) ?? []).length;
    });
    createInterface({ input: this.child.stdout }).on('line', line => {
      try { this.receive(JSON.parse(line)); } catch { this.fail('Malformed App Server message'); }
    });
  }
  fail(reason: string) {
    this.fatal ??= new Error(reason);
    for (const entry of this.pending.values()) entry.reject(this.fatal);
    this.pending.clear();
    this.wake.emit('message');
  }
  receive(message: Wire) {
    const p = message.params ?? {};
    const method = message.method;
    if (!method && message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return this.fail('Uncorrelated RPC response');
      this.pending.delete(message.id);
      this.ledger.push({ event: 'response', id: message.id, errorCode: message.error?.code ?? null, errorSummary: message.error ? safeError(message.error.message) : null, ms: Date.now() - this.started });
      if (message.error) pending.reject(new Error(`RPC error code ${message.error.code}`));
      else pending.resolve(message.result);
      return;
    }
    // Never store userMessage content, image bytes, error text, raw config or stderr.
    this.ledger.push({ event: method, threadId: p.threadId ?? null, turnId: p.turnId ?? p.turn?.id ?? null, itemType: p.item?.type ?? null, status: p.turn?.status ?? null, ms: Date.now() - this.started });
    if (message.id !== undefined) {
      this.serverRequests++;
      this.child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: 'Fixture host denies all server requests' } })}\n`);
      return this.fail('Server requested approval/auth/tool/input; denied');
    }
    if (method === 'error') return this.fail('App Server turn error; no retry');
    if (method === 'item/started' && !['userMessage', 'agentMessage', 'reasoning'].includes(p.item?.type)) {
      this.toolExecutions++;
      return this.fail('Unexpected tool or non-message activity');
    }
    if (method === 'turn/completed' || (method === 'item/completed' && p.item?.type === 'agentMessage') || method === 'thread/tokenUsage/updated') this.events.push(message);
    this.wake.emit('message');
  }
  notify(method: string, params: Wire = {}) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }
  async request(method: string, params: Wire = {}, timeoutMs = 20000): Promise<Wire> {
    if (this.fatal && method !== 'turn/interrupt') throw this.fatal;
    const id = ++this.serial;
    this.ledger.push({ event: method, id, ms: Date.now() - this.started });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Wire>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`RPC timeout: ${method}; no retry`)); }, timeoutMs);
        this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    } finally { clearTimeout(timer); }
  }
  async terminal(threadId: string, turnId: string, timeoutMs: number): Promise<Wire> {
    return await new Promise((resolve, reject) => {
      const finish = () => {
        const event = this.events.find(message => terminalFor(message, threadId, turnId));
        if (!this.fatal && !event) return;
        clearTimeout(timer);
        this.wake.off('message', finish);
        if (this.fatal) reject(this.fatal); else resolve(event as Wire);
      };
      const timer = setTimeout(() => { this.wake.off('message', finish); reject(new Error('Turn timeout; completion uncertain; no retry')); }, timeoutMs);
      this.wake.on('message', finish);
      finish();
    });
  }
  async close() {
    this.child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = async (ms: number) => {
      try { return await Promise.race([this.exit, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); })]); }
      finally { clearTimeout(timer); }
    };
    let result = await wait(5000);
    if (result) return { ...result, shutdown: 'stdin EOF' };
    this.child.kill('SIGTERM');
    result = await wait(3000);
    if (result) return { ...result, shutdown: 'SIGTERM after EOF timeout' };
    this.child.kill('SIGKILL');
    result = await wait(3000);
    return { ...result, shutdown: 'forced SIGKILL', uncertain: !result };
  }
}
