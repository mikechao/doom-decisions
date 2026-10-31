import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadFixture, prepareReplay } from './doom-observation.ts';
import { proposalShape, validateDoomProposal, type DoomProposal } from './doom-proposal.ts';

const local = (path: string) => new URL(path, import.meta.url);
const attemptRoot = local('.local/real-doom-once/');
const instructions = `Inspect this ONE authentic historical Doom PNG and its supplied state.
This is offline replay, advisory only, not live gameplay. Reply with exactly one JSON object,
without Markdown or commentary, matching: ${JSON.stringify(proposalShape)}
Choose one sensible high-level VISUAL NAVIGATION objective grounded in this perspective.
Separate visible pixel evidence from supplied telemetry evidence; do not invent observations.
Do not assert that a door/passage is traversable or a goal reached from one perspective alone.
State what cannot be established, and propose exactly one next observable question to test.
Numeric pose/angle and facingProbe are raw recorded engine values, not a supplied map or route.
Do not infer units or probe-enum meanings not supplied here.
Do not propose button actions, tic durations, game commands, instructions/settings changes,
or notebook writes. Do not call tools, access files, shell, network, authentication or Doom.
Only reason over this image and state; do not write memory files.`;

export function installedVersions() {
  const pins = {
    ai: '7.0.159', '@mcpc-tech/acp-ai-provider': '0.3.9',
    '@agentclientprotocol/codex-acp': '2.5.0', '@openai/codex': '0.165.0',
    '@mcpc-tech/acp-ai-provider/node_modules/ai': '6.0.320',
  };
  const lock = JSON.parse(readFileSync(local('package-lock.json'), 'utf8'));
  for (const [name, version] of Object.entries(pins)) {
    const installed = JSON.parse(readFileSync(local(`node_modules/${name}/package.json`), 'utf8'));
    if (installed.version !== version || lock.packages[`node_modules/${name}`]?.version !== version) throw new Error('VERSION_MISMATCH');
  }
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('NODE_22_REQUIRED');
  return { ...pins, node: process.version };
}

// Export only to test the exclusive local marker without starting a provider.
export function reserveAttempt(root = attemptRoot) {
  mkdirSync(root, { recursive: true });
  try {
    writeFileSync(new URL('started.json', root), JSON.stringify({ startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  } catch {
    throw new Error('ATTEMPT_ALREADY_STARTED_OR_UNWRITABLE');
  }
}

// Defense for saved model text, not proof of internal tool isolation. Never save
// raw responses, errors, session IDs or provider objects, even on failure.
function evidenceProposal(proposal: DoomProposal) {
  const raw = JSON.stringify(proposal);
  if (/data:|(?:https?|file):\/\/|\/(?:Users|home|private|tmp|var)\/|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|(?:sk|sess)-[\w-]+/i.test(raw)) throw new Error('UNSAFE_PROPOSAL_TEXT');
  return proposal;
}

async function infer(replay: ReturnType<typeof prepareReplay>, versions: ReturnType<typeof installedVersions>) {
  // Consumed BEFORE importing/starting ACP; any later failure consumes the slot.
  // This marker is never removed, including on timeout, cleanup failure or Ctrl+C.
  reserveAttempt();
  const started = Date.now();
  const report = {
    outcome: 'INCONCLUSIVE', snapshot: replay.summary, versions,
    acpInitialized: false, sessionStarted: false,
    generateTextInvocations: 0, providerCallStarts: 0, completed: false,
    finishReason: 'NOT_RETURNED', rawFinishReason: 'NOT_RETURNED',
    toolCallsObserved: null as number | null,
    internalToolActivity: 'NOT_OBSERVABLE',
    usage: null as null | Record<string, number | null>,
    structuralValidation: 'NOT_RUN', navigationQuality: 'REQUIRES_HUMAN_REVIEW',
    proposal: null as DoomProposal | null,
    cleanup: 'NOT_NEEDED', errorCategory: null as string | null, elapsedMs: 0,
  };
  let provider: ReturnType<typeof import('@mcpc-tech/acp-ai-provider')['createACPProvider']> | undefined;
  let stage = 'LOCAL_SETUP';
  const abort = new AbortController();
  async function bounded<T>(operation: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new Error('HOST_TIMEOUT')); }, ms);
      })]);
    } finally { clearTimeout(timer); }
  }
  try {
    // Runtime dependencies are deliberately unreachable from --validate.
    const { createACPProvider } = await import('@mcpc-tech/acp-ai-provider');
    const { generateText } = await import('ai');
    const cwd = new URL('fixture-cwd/', attemptRoot);
    mkdirSync(cwd); // Must be a fresh, empty cwd; never reuse a previous workspace.
    provider = createACPProvider({
      command: fileURLToPath(local('node_modules/.bin/codex-acp')),
      env: { INITIAL_AGENT_MODE: 'read-only' },
      session: { cwd: fileURLToPath(cwd), mcpServers: [] }, persistSession: true,
    });
    const model = provider.languageModel();
    stage = 'ACP_INITIALIZATION';
    await bounded(provider.connect(), 45_000);
    report.acpInitialized = true;
    stage = 'SESSION_SETUP';
    await bounded(provider.initSession(), 45_000);
    const sessionId = provider.getSessionId();
    if (!sessionId) throw new Error('SESSION_MISSING');
    report.sessionStarted = true;
    stage = 'INFERENCE';
    report.generateTextInvocations++;
    const result = await bounded(generateText({
      model, maxRetries: 0, abortSignal: abort.signal,
      messages: [{ role: 'user', content: [
        { type: 'text', text: `${instructions}\nSTATE=${JSON.stringify(replay.payload)}` },
        { type: 'image', image: replay.image, mediaType: 'image/png' },
      ] }],
      onLanguageModelCallStart: () => { report.providerCallStarts++; },
    }), 120_000);
    report.finishReason = result.finishReason === 'stop' ? 'stop' : 'OTHER';
    report.rawFinishReason = result.rawFinishReason === 'end_turn' ? 'end_turn' : 'OTHER';
    const usage = result.totalUsage;
    const count = (n: number | undefined) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
    const counts = { inputTokens: count(usage.inputTokens), outputTokens: count(usage.outputTokens), totalTokens: count(usage.totalTokens) };
    report.usage = Object.values(counts).some(n => n !== null) ? counts : null;
    report.toolCallsObserved = result.steps.reduce((n, step) => n + step.toolCalls.length, 0);
    if (report.toolCallsObserved !== 0) throw new Error('UNEXPECTED_TOOL_ACTIVITY');
    if (result.finishReason !== 'stop' || result.rawFinishReason !== 'end_turn' || report.providerCallStarts !== 1) throw new Error('AMBIGUOUS_COMPLETION');
    if (provider.getSessionId() !== sessionId) throw new Error('SESSION_CHANGED');
    report.completed = true;
    stage = 'PROPOSAL_VALIDATION';
    const proposal = validateDoomProposal(result.text);
    report.structuralValidation = 'PASS';
    report.proposal = evidenceProposal(proposal);
    report.outcome = 'AWAITING_HUMAN_REVIEW';
  } catch (error) {
    const known = ['HOST_TIMEOUT', 'SESSION_MISSING', 'SESSION_CHANGED', 'UNEXPECTED_TOOL_ACTIVITY', 'AMBIGUOUS_COMPLETION', 'INVALID_PROPOSAL', 'UNSAFE_PROPOSAL_TEXT'];
    report.errorCategory = error instanceof Error && known.includes(error.message) ? error.message : `${stage}_FAILED`;
    process.exitCode = 1;
  } finally {
    try {
      provider?.cleanup();
      report.cleanup = provider ? (provider.getSessionId() === null ? 'PUBLIC_CLEANUP_RETURNED_SESSION_CLEARED_EXIT_UNVERIFIED' : 'SESSION_NOT_CLEARED') : 'NOT_NEEDED';
      if (provider && provider.getSessionId() !== null) { report.outcome = 'INCONCLUSIVE'; process.exitCode = 1; }
    } catch { report.cleanup = 'PUBLIC_CLEANUP_FAILED'; report.outcome = 'INCONCLUSIVE'; process.exitCode = 1; }
    report.elapsedMs = Date.now() - started;
    writeFileSync(new URL('evidence.json', attemptRoot), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ outcome: report.outcome, completed: report.completed,
      structuralValidation: report.structuralValidation, errorCategory: report.errorCategory,
      cleanup: report.cleanup, evidence: '.local/real-doom-once/evidence.json' }));
  }
}

export async function main(args: string[]) {
  if (args.length !== 1 || !['--validate', '--infer'].includes(args[0])) throw new Error('CHOOSE_VALIDATE_OR_INFER');
  const replay = prepareReplay(loadFixture());
  const versions = installedVersions();
  if (args[0] === '--validate') {
    console.log(JSON.stringify({ mode: 'OFFLINE_VALIDATION', ...replay.summary, versions, inference: 'NOT_RUN' }));
  } else await infer(replay, versions);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    const safe = ['CHOOSE_VALIDATE_OR_INFER', 'LOCAL_FIXTURE_MISSING_OR_UNREADABLE', 'VERSION_MISMATCH', 'NODE_22_REQUIRED', 'ATTEMPT_ALREADY_STARTED_OR_UNWRITABLE'];
    console.log(JSON.stringify({ outcome: 'STOPPED', errorCategory: error instanceof Error && safe.includes(error.message) ? error.message : 'LOCAL_VALIDATION_OR_EVIDENCE_FAILED' }));
    process.exitCode = 1;
  }
}
