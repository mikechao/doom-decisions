import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireLive } from './live-observation.ts';
import { createACPPort } from './supervisor-acp.ts';
import { createCLIPorts } from './supervisor-cli.ts';
import { supervise, type SupervisorPorts } from './supervisor-workflow.ts';

export { composeGuidance, supervise, type SupervisorACP, type SupervisorPorts } from './supervisor-workflow.ts';

function installedVersions() {
  const local = (path: string) => new URL(path, import.meta.url);
  const pins = {
    ai: '7.0.159',
    '@mcpc-tech/acp-ai-provider': '0.3.9',
    '@agentclientprotocol/codex-acp': '2.5.0',
    '@openai/codex': '0.165.0',
    '@mcpc-tech/acp-ai-provider/node_modules/ai': '6.0.320',
  };
  const lock = JSON.parse(readFileSync(local('package-lock.json'), 'utf8'));
  for (const [name, version] of Object.entries(pins)) {
    const installed = JSON.parse(readFileSync(local(`node_modules/${name}/package.json`), 'utf8'));
    if (installed.version !== version || lock.packages[`node_modules/${name}`]?.version !== version)
      throw new Error('VERSION_MISMATCH');
  }
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('NODE_22_REQUIRED');
  return { ...pins, node: process.version };
}

const help =
  'Offline by default. After separate human approval only: node --experimental-strip-types supervisor.ts --live --authorize-decisions N --trial NEW_ID 2>/dev/null\nN must be a positive decimal safe integer. Legacy --authorize-one-decision / --authorize-two-decisions mean N=1 / N=2.\nRequires one visible prepared dev:agent page, matching AGENT_DECISION_BUDGET=N (restart server after configuration), and browser Stop Agent available. Allowance mismatch is detected AFTER the nonrefundable claim, before prompt CAS or decisions.\n';

// Entry and optional runtime are separate from the injectable offline workflow.
// Existing historical markers/runners are never invoked.
export async function supervisorMain(
  args: string[],
  launch = runLive,
  print: (text: string) => void = (text) => {
    writeSync(1, text);
  },
) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    print(help);
    return 0;
  }
  const numeric = args[1] === '--authorize-decisions';
  const decisions = numeric
    ? /^[1-9][0-9]*$/.test(args[2] ?? '')
      ? Number(args[2])
      : NaN
    : args[1] === '--authorize-one-decision'
      ? 1
      : args[1] === '--authorize-two-decisions'
        ? 2
        : NaN;
  const trialIndex = numeric ? 4 : 3;
  if (
    args.length !== trialIndex + 1 ||
    args[0] !== '--live' ||
    !Number.isSafeInteger(decisions) ||
    decisions <= 0 ||
    args[trialIndex - 1] !== '--trial' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(args[trialIndex])
  ) {
    print(help);
    return 2;
  }
  return launch(args[trialIndex], decisions);
}

async function runLive(trial: string, decisions: number) {
  const versions = installedVersions();
  // The provider can otherwise write raw transcript/debug artifacts on import.
  requireLive(!process.env.DEBUG?.trim() && !process.env.ACP_AI_PROVIDER_DEBUG?.trim());
  const local = new URL('.local/', import.meta.url);
  await mkdir(local, { recursive: true, mode: 0o700 });
  const root = fileURLToPath(new URL(`supervisor-${trial}/`, local));
  // Exclusive new namespace BEFORE attach/startup. Never removed or reused.
  await mkdir(root, { mode: 0o700 });
  await writeFile(join(root, 'started.json'), JSON.stringify({ startedAt: new Date().toISOString(), decisions }), {
    flag: 'wx',
    mode: 0o600,
  });
  const cwd = join(root, 'acp-cwd');
  await mkdir(cwd, { mode: 0o700 });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const { cleanup, ...cliPorts } = createCLIPorts(root, decisions);
  try {
    const ports: SupervisorPorts = { ...cliPorts, createACP: createACPPort(cwd) };
    const report = await supervise(ports, { signal: abort.signal, decisions });
    await writeFile(join(root, 'report.json'), `${JSON.stringify({ versions, ...report }, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    writeSync(1, `${JSON.stringify(report, null, 2)}\n`);
    if (report.humanStopRequired)
      writeSync(
        1,
        'Use the browser Stop Agent control now. Host exit does not revoke the lease or prove native/remote cancellation.\n',
      );
    return report.outcome === 'completed' ? 0 : 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    await cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code = 1;
  try {
    code = await supervisorMain(process.argv.slice(2));
  } catch {
    writeSync(
      1,
      'Supervisor setup/report failed; no retry. Check the local trial directory and use browser Stop Agent if attachment may have occurred.\n',
    );
  }
  // Public ACP cleanup has no exit receipt. Bound the standalone host's lifetime
  // without claiming that direct-child/descendant or remote processing stopped.
  process.exit(code);
}
