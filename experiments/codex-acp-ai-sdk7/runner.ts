import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ACPLanguageModel, ACPProvider, createACPProvider } from '@mcpc-tech/acp-ai-provider';
import type { generateText } from 'ai';

// Compile-time check of the real installed interfaces; no generation or model construction.
type Assert<T extends true> = T;
export type SDK7Compatibility = Assert<
  ACPLanguageModel extends Parameters<typeof generateText>[0]['model'] ? true : false
>;
export const plannedSettings = {
  command: new URL('node_modules/.bin/codex-acp', import.meta.url).pathname,
  env: { INITIAL_AGENT_MODE: 'read-only' },
  session: { cwd: new URL('.local/fixture-cwd/', import.meta.url).pathname, mcpServers: [] },
  persistSession: true,
} satisfies Parameters<typeof createACPProvider>[0];

// Both commands stop here until the documented provider boundary is fixed.
// In particular, never call connect/initSession: the latter can authenticate automatically.
const started = Date.now();
const mode = process.argv[2];
if (mode !== '--preflight' && mode !== '--trial') {
  throw new Error('Choose --preflight or --trial');
}
const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
try {
  const lock = JSON.parse(read('package-lock.json').toString());
  const version = (name: string): string => {
    const installed = JSON.parse(read(`node_modules/${name}/package.json`).toString()).version;
    if (installed !== lock.packages[`node_modules/${name}`].version) throw new Error('Version mismatch');
    return installed;
  };
  const methods = ['connect', 'initSession', 'getSessionId', 'cleanup'] as const;
  const source = read('node_modules/@mcpc-tech/acp-ai-provider/index.mjs');
  const report = {
    mode,
    outcome: 'BLOCKED',
    category: 'UNSUPPORTED_PERMISSION_BOUNDARY',
    versions: Object.fromEntries(['ai', '@mcpc-tech/acp-ai-provider', '@agentclientprotocol/codex-acp', '@openai/codex'].map(name => [name, version(name)])),
    interfaces: {
      factory: typeof createACPProvider === 'function',
      v3Generate: typeof ACPLanguageModel.prototype.doGenerate === 'function',
      methods: Object.fromEntries(methods.map(name => [name, typeof ACPProvider.prototype[name] === 'function'])),
    },
    providerSourceSha256: hash(source),
    firstBlockerConfirmed: source.toString().includes('optionId: params.options[0]?.optionId || "allow"'),
    fixtures: ['a', 'b'].map(name => {
      const bytes = read(`../codex-app-server/fixture-${name}.png`);
      return { name, bytes: bytes.length, sha256: hash(bytes) };
    }),
    processConnected: 'NOT_RUN',
    acpInitialized: 'NOT_RUN',
    sessionStarted: 'NOT_RUN',
    inferenceTurnsAdmitted: 0,
    trial: 'NOT_RUN',
    cleanup: 'NOT_NEEDED_NO_PROCESS',
    elapsedMs: Date.now() - started,
  };
  if (mode === '--preflight') {
    writeFileSync(new URL('preflight-evidence.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report));
} catch {
  console.log(JSON.stringify({ mode, outcome: 'BLOCKED', category: 'UNCLASSIFIED', inferenceTurnsAdmitted: 0, cleanup: 'NOT_NEEDED_NO_PROCESS', elapsedMs: Date.now() - started }));
}
process.exitCode = 1;
