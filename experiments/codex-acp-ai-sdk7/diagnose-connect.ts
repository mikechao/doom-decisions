import { accessSync, constants, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createACPProvider } from '@mcpc-tech/acp-ai-provider';

const local = (path: string) => new URL(path, import.meta.url);
const executable = local('node_modules/.bin/codex-acp');
const cwd = local('.local/fixture-cwd/');

// Only fixed phrases and allowlisted codes escape the caught error. The provider
// appends child stderr to it; the npm script suppresses its raw stderr forwarding.
function classify(error: unknown) {
  const messages: string[] = [];
  const codes: (string | number)[] = [];
  for (let current = error, depth = 0; current && depth < 4; depth++) {
    if (typeof current !== 'object') break;
    if ('message' in current && typeof current.message === 'string') messages.push(current.message);
    if ('code' in current) {
      const code = current.code;
      if ((typeof code === 'number' && Number.isSafeInteger(code)) ||
        (typeof code === 'string' && /^(ENOENT|EACCES|EPERM|ENOTDIR|EPIPE|ECONNRESET|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)$/.test(code))) codes.push(code);
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  const text = messages.join('\n');
  const patterns: [string, RegExp, string][] = [
    ['TIMEOUT', /CONNECT_DIAGNOSTIC_TIMEOUT/, 'provider.connect exceeded the 45-second host wait'],
    ['WORKSPACE_REQUIREMENTS', /failed to load workspace requirements: invalid data/i, 'failed to load workspace requirements: invalid data'],
    ['MODULE_RESOLUTION', /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i, 'Cannot find module or package'],
    ['SPAWN_NOT_FOUND', /spawn[^\n]*ENOENT|No such file or directory/i, 'Executable or required file not found'],
    ['APP_SERVER_EXIT', /Codex process has exited with code/i, 'Codex process has exited'],
    ['APP_SERVER_EXIT', /app.server[^\n]*(?:exited|terminated|crashed|died)/i, 'App Server exited or terminated'],
    ['SPAWN_PERMISSION', /EACCES|EPERM|Permission denied|Operation not permitted/i, 'Permission denied or operation not permitted'],
    ['APP_SERVER_CONFIG', /(?:failed|error|unable) (?:to )?(?:load|read|parse) (?:the )?config/i, 'Failed to load, read, or parse configuration'],
    ['ACP_HANDSHAKE', /Invalid params/i, 'Invalid params'],
    ['ACP_HANDSHAKE', /Method not found/i, 'Method not found'],
    ['ACP_HANDSHAKE', /unsupported protocol version/i, 'Unsupported protocol version'],
    ['ACP_HANDSHAKE', /connection (?:is )?closed|connection reset/i, 'Connection closed or reset during initialization'],
    ['AUTH', /authentication required|not authenticated|login required|sign.in required/i, 'Authentication or interactive sign-in required'],
  ];
  const matches = patterns.filter(([, pattern]) => pattern.test(text));
  const fallback = codes.includes('ENOENT') ? 'SPAWN_NOT_FOUND'
    : codes.includes('EACCES') || codes.includes('EPERM') ? 'SPAWN_PERMISSION'
    : codes.includes('ENOTDIR') ? 'INVALID_CWD' : 'UNKNOWN';
  const exit = text.match(/Codex process has exited with code (-?\d{1,10})/i);
  return { category: matches[0]?.[0] ?? fallback,
    detail: matches.length ? matches.map(([, , phrase]) => phrase).join('; ')
      : 'No allowlisted error phrase matched; raw message and stderr discarded',
    codes, appServerExitCode: exit ? Number(exit[1]) : null };
}

const started = Date.now();
const report = {
  mode: '--diagnose-connect', attemptId: 'connect-diagnostic-1', versions: {} as Record<string, string>,
  setup: { executable: 'node_modules/.bin/codex-acp', cwd: '.local/fixture-cwd/', args: [],
    executableAccessible: false, resolvesToInstalledAdapter: false, cwdDirectory: false, versionsMatchLock: false },
  connectInvoked: false, connectReturned: false, initializeHandshake: 'NOT_ATTEMPTED', outcome: 'INCONCLUSIVE',
  error: null as ReturnType<typeof classify> | null, sessionCreated: false, inferenceTurns: 0,
  cleanupReturned: false, localSessionCleared: null as boolean | null, elapsedMs: 0,
  unverified: ['Exact operation or resource denied by the permission error', 'Child/descendant exit', 'Inherited tool authority and permission requests', 'Session creation, vision, SDK 7 generation, and context retention'],
};
let provider: ReturnType<typeof createACPProvider> | undefined;
let markerCreated = false;
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  // A separate authorization: never touch trial-started or the previous evidence.
  writeFileSync(local('.local/connect-diagnostic-1-started'), new Date().toISOString(), { flag: 'wx' });
  markerCreated = true;
  const lock = JSON.parse(readFileSync(local('package-lock.json'), 'utf8'));
  for (const name of ['ai', '@mcpc-tech/acp-ai-provider', '@agentclientprotocol/codex-acp', '@openai/codex']) {
    const version = JSON.parse(readFileSync(local(`node_modules/${name}/package.json`), 'utf8')).version;
    report.versions[name] = version;
    if (version !== lock.packages[`node_modules/${name}`].version) throw new Error('Version differs from lock');
  }
  report.versions.node = process.version;
  report.setup.versionsMatchLock = true;
  accessSync(executable, constants.R_OK | constants.X_OK);
  report.setup.executableAccessible = true;
  report.setup.resolvesToInstalledAdapter = realpathSync(executable) === realpathSync(local('node_modules/@agentclientprotocol/codex-acp/dist/index.js'));
  report.setup.cwdDirectory = statSync(cwd).isDirectory();
  if (!report.setup.cwdDirectory) throw Object.assign(new Error('Invalid cwd'), { code: 'ENOTDIR' });
  provider = createACPProvider({ command: fileURLToPath(executable), args: [],
    env: { INITIAL_AGENT_MODE: 'read-only' },
    session: { cwd: fileURLToPath(cwd), mcpServers: [] }, persistSession: true });
  report.connectInvoked = true;
  report.initializeHandshake = 'NOT_CONFIRMED';
  await Promise.race([provider.connect(), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('CONNECT_DIAGNOSTIC_TIMEOUT')), 45_000);
  })]);
  report.connectReturned = true;
  report.initializeHandshake = 'SUCCEEDED_PUBLIC_CONNECT_RETURNED';
  report.outcome = 'CONNECTED';
} catch (error) {
  report.error = classify(error);
  report.outcome = report.error.category === 'TIMEOUT' ? 'INCONCLUSIVE' : 'FAILED';
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  try {
    provider?.cleanup();
    report.cleanupReturned = !!provider;
    report.localSessionCleared = provider ? provider.getSessionId() === null : null;
  } catch { report.outcome = 'INCONCLUSIVE'; }
  report.elapsedMs = Date.now() - started;
  if (markerCreated) writeFileSync(local('connect-diagnostic-evidence.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(report));
}
