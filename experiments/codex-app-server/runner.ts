import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, sha256 } from './fixtures.ts';
import { assess, outputSchema, validateProposal } from './proposal.ts';
import { Rpc, type Wire } from './rpc.ts';

const root = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
if (!['--preflight', '--trial'].includes(mode)) throw new Error('Choose --preflight (zero inference) or --trial (at most two turns)');
const local = join(root, '.local');
const cwd = join(local, 'fixture-cwd');
mkdirSync(cwd, { recursive: true });
const disabled = ['shell_tool', 'unified_exec', 'shell_snapshot', 'apps', 'plugins', 'remote_plugin', 'hooks', 'multi_agent', 'multi_agent_v2', 'goals', 'memories', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation', 'in_app_browser', 'code_mode_host', 'skill_search', 'skill_mcp_dependency_install', 'sleep_tool', 'daemon_auto_start', 'unbounded_connection_retries', 'view_image'];
const settings = [
  ...disabled.map(name => `features.${name}=false`),
  'features.code_mode.enabled=false', 'features.code_mode.direct_only_tool_namespaces=[]', 'features.skip_host_skill_discovery=true', 'web_search="disabled"',
  'sandbox_mode="read-only"', 'approval_policy="never"', 'approvals_reviewer="user"',
  'project_doc_max_bytes=0', 'developer_instructions=""', 'history.persistence="none"',
  `log_dir=${JSON.stringify(join(local, 'logs'))}`, `sqlite_home=${JSON.stringify(join(local, 'state'))}`,
  'model_provider="fixture-openai"', 'model_providers.fixture-openai.name="OpenAI fixture"', 'model_providers.fixture-openai.wire_api="responses"', 'model_providers.fixture-openai.requires_openai_auth=true', 'model_providers.fixture-openai.request_max_retries=0', 'model_providers.fixture-openai.stream_max_retries=0',
];
const configArgs = (values: string[]) => values.flatMap(value => ['-c', value]);
// CLI inventory does not initialize MCP transports. Project cwd matches the child.
// Parse only names; never print/persist server commands, env, URLs, or auth fields.
let inventory: Wire[];
try { inventory = JSON.parse(execFileSync('codex', ['mcp', 'list', '--json', ...configArgs(settings)], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 })); } catch { throw new Error('MCP inventory/bootstrap failed; no inference; child output withheld'); }
for (const server of inventory) {
  if (typeof server.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(server.name)) throw new Error('Invalid MCP inventory');
  settings.push(`mcp_servers.${server.name}.enabled=false`);
}
const rpc = new Rpc(configArgs(settings), cwd);
const report: Wire = { mode, cli: execFileSync('codex', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), startedAt: new Date().toISOString(), hostTurnTimeoutMs: 120000, inferenceTurnsAdmitted: 0, inheritedMcpCount: inventory.length, turns: [], outcome: 'INCONCLUSIVE' };
let threadId: string | undefined;
let activeTurnId: string | undefined;
const nonce = 'm7Q-violet';
const dto = { synthetic: true, verified: false, sessionId: 'fixture-only', observationId: 'fabricated', revision: 0, telemetry: { x: 0, y: 0, angle: 0, health: 100, tic: 1 }, configuration: { tics: 6, includeHealth: true }, run: null };
const baseInstructions = 'You are a fixture-only visual navigation adviser. Inspect only the supplied inline image and synthetic DTO. No tools, shell, files, MCP, browsing, execution, approvals or subagents. Return a high-level proposal only. Never select or name any Doom low-level action. No authority to execute or change anything. Report uncertainty honestly. recommendedTics is advisory only. recommendedInstruction may be null. Describe each visible marker using color, shape, horizontal (left/right), vertical (top/bottom). Do not infer traversal from synthetic data.';
try {
  await rpc.request('initialize', { clientInfo: { name: 'doom_fixture_phase1', title: 'Synthetic fixture proof', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  rpc.notify('initialized');
  const { config } = await rpc.request('config/read', { cwd, includeLayers: false });
  const mcp = config.mcp_servers ?? {};
  const features = Object.fromEntries(disabled.map(name => [name, config.features?.[name]]));
  features.code_mode = config.features?.code_mode?.enabled;
  report.configuredIsolation = { sandbox: config.sandbox_mode, approvalPolicy: config.approval_policy, approvalsReviewer: config.approvals_reviewer, webSearch: config.web_search, disabledFeatures: features, inheritedMcpDisabled: Object.values(mcp).every(server => (server as Wire).enabled === false), mcpCount: Object.keys(mcp).length, projectDocMaxBytes: config.project_doc_max_bytes, localLogDir: config.log_dir === join(local, 'logs'), localSqliteHome: config.sqlite_home === join(local, 'state'), requestRetries: config.model_providers?.['fixture-openai']?.request_max_retries, streamRetries: config.model_providers?.['fixture-openai']?.stream_max_retries };
  if (config.sandbox_mode !== 'read-only' || config.approval_policy !== 'never' || config.approvals_reviewer !== 'user' || config.web_search !== 'disabled' || Object.values(features).some(value => value !== false) || !report.configuredIsolation.inheritedMcpDisabled || config.project_doc_max_bytes !== 0 || report.configuredIsolation.requestRetries !== 0 || report.configuredIsolation.streamRetries !== 0) throw new Error('Effective configuration failed isolation/retry checks');
  const providerUrl = config.model_providers?.['fixture-openai']?.base_url;
  if (providerUrl && providerUrl !== 'https://api.openai.com/v1') throw new Error('Unexpected provider endpoint');
  const account = await rpc.request('account/read', { refreshToken: false });
  report.authAvailable = !!account.account;
  if (!account.account) throw new Error('Existing authentication unavailable; no login attempted');
  const thread = await rpc.request('thread/start', { cwd, runtimeWorkspaceRoots: [cwd], sandbox: 'read-only', approvalPolicy: 'never', approvalsReviewer: 'user', ephemeral: true, environments: [], dynamicTools: [], selectedCapabilityRoots: [], baseInstructions, developerInstructions: 'This host accepts two advisory fixture responses only. Do not call any tools.' });
  threadId = thread.thread.id;
  report.threadId = threadId;
  report.model = thread.model;
  report.verifiedThread = { cwdMatches: thread.cwd === cwd, rootsMatch: JSON.stringify(thread.runtimeWorkspaceRoots) === JSON.stringify([cwd]), sandbox: thread.sandbox, approvalPolicy: thread.approvalPolicy, approvalsReviewer: thread.approvalsReviewer, instructionSourceCount: thread.instructionSources.length, ephemeral: thread.thread.ephemeral };
  if (!report.verifiedThread.cwdMatches || !report.verifiedThread.rootsMatch || thread.sandbox.type !== 'readOnly' || thread.sandbox.networkAccess !== false || thread.approvalPolicy !== 'never' || thread.approvalsReviewer !== 'user' || thread.instructionSources.length !== 0) throw new Error('Thread authority differs from requested restrictions');
  const status = await rpc.request('mcpServerStatus/list', { threadId, detail: 'toolsAndAuthOnly', limit: 100 });
  report.verifiedMcp = { serverCount: status.data.length, nextCursor: status.nextCursor, toolCount: status.data.reduce((n: number, server: Wire) => n + Object.keys(server.tools).length, 0) };
  if (status.data.length || status.nextCursor) throw new Error('Nonempty/incomplete runtime MCP inventory');
  if (rpc.fatal) throw rpc.fatal;
  report.preflight = 'passed';
  if (mode === '--trial') {
    // Exclusive durable marker: this worktree never automatically repeats a trial.
    writeFileSync(join(local, 'trial-started'), new Date().toISOString(), { flag: 'wx' });
    let firstTarget: string | undefined;
    for (let index = 0; index < 2; index++) {
      const png = fixture(index);
      writeFileSync(join(root, `fixture-${index === 0 ? 'a' : 'b'}.png`), png);
      const text = index === 0
        ? `Fixture A. Retain nonce ${nonce} and your selected target for the next turn. Select one visible marker as a high-level investigation target; identify its color, shape and location. List all visible markers. Set recalledNonce/recalledTarget to null on this turn. DTO=${JSON.stringify(dto)}`
        : `Fixture B. Inspect the NEW image; identify a high-level target and list all markers at their CURRENT positions. In visualEvidence.recalledNonce recall the first turn's nonce exactly; in recalledTarget reproduce your first proposal's target string exactly. Do not substitute current details for remembered ones. If unavailable put null. DTO=${JSON.stringify({ ...dto, observationId: 'fabricated-b', revision: 1 })}`;
      const record: Wire = { fixture: index === 0 ? 'A' : 'B', imageSha256: sha256(png), imageBytes: png.length, transport: 'inline data:image/png;base64', status: 'admission pending', schemaValid: false };
      report.turns.push(record);
      report.inferenceTurnsAdmitted++;
      const start = await rpc.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }, { type: 'image', url: `data:image/png;base64,${png.toString('base64')}` }], approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false }, environments: [], outputSchema });
      activeTurnId = start.turn.id;
      record.turnId = activeTurnId;
      record.status = start.turn.status;
      const terminal = await rpc.terminal(threadId as string, activeTurnId as string, 120000);
      record.status = terminal.params.turn.status;
      record.durationMs = terminal.params.turn.durationMs;
      activeTurnId = undefined;
      const messages = rpc.events.filter(event => event.method === 'item/completed' && event.params.threadId === threadId && event.params.turnId === record.turnId && (event.params.item.phase === 'final_answer' || event.params.item.phase === null));
      if (messages.length !== 1) throw new Error('Missing/ambiguous completed final output');
      const proposal = validateProposal(messages[0].params.item.text, record.status);
      record.schemaValid = true;
      record.proposal = proposal;
      record.assessment = assess(proposal, index, nonce, firstTarget);
      if (index === 0) firstTarget = proposal.target;
      const usage = rpc.events.findLast(event => event.method === 'thread/tokenUsage/updated' && event.params.turnId === record.turnId);
      record.usage = usage?.params.tokenUsage ?? null;
      console.log(`Fixture ${record.fixture}: ${record.status}; schema valid; image match=${record.assessment.imageMatch}; context=${record.assessment.contextRetained}`);
    }
    report.outcome = report.turns.every((turn: Wire) => turn.assessment.imageMatch) && report.turns[1].assessment.contextRetained ? 'PASS' : 'FAIL';
  }
} catch (error) {
  // All errors created by this runner contain only bounded, nonsecret descriptions.
  report.preflight ??= 'failed';
  report.blocker = error instanceof Error && /^(RPC |Turn |App Server|Unexpected|Effective|Existing|Thread |Nonempty|Server |Missing|Low-level|Invalid|Unsuccessful|Oversize|Expected|Malformed)/.test(error.message) ? error.message : 'Local/proposal validation failed; no automatic retry';
  process.exitCode = 1;
  if (activeTurnId && threadId) {
    try { await rpc.request('turn/interrupt', { threadId, turnId: activeTurnId }, 5000); report.interrupt = 'acknowledged'; }
    catch { report.interrupt = 'uncertain'; }
  }
} finally {
  report.cleanup = await rpc.close();
  report.toolExecutions = rpc.toolExecutions;
  report.deniedServerRequests = rpc.serverRequests;
  report.stderr = { bytes: rpc.stderrBytes, warnings: rpc.stderrWarnings, errors: rpc.stderrErrors, contentPersisted: false, safeStartupErrors: rpc.stderrDiagnostics };
  report.elapsedMs = Date.now() - rpc.started;
  report.ledger = rpc.ledger;
  if (report.cleanup.uncertain || report.cleanup.code !== 0 || report.toolExecutions || report.deniedServerRequests) report.outcome = 'INCONCLUSIVE';
  writeFileSync(join(root, mode === '--trial' ? 'trial-evidence.json' : 'preflight-evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ mode, preflight: report.preflight, outcome: report.outcome, admitted: report.inferenceTurnsAdmitted, blocker: report.blocker, cleanup: report.cleanup, elapsedMs: report.elapsedMs }));
}
