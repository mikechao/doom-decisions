import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createACPProvider } from '@mcpc-tech/acp-ai-provider';
import { generateText } from 'ai';
import { assess, outputSchema, type Proposal, validateProposal } from '../codex-app-server/proposal.ts';

const local = (path: string) => new URL(path, import.meta.url);
const read = (path: string) => readFileSync(local(path));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const nonce = 'm7Q-violet';
const instructions = `This is an explicitly synthetic, unverified fixture experiment, not gameplay.
Only inspect the attached image and reply with one JSON object, without Markdown or commentary.
Do not call tools, perform file operations, shell commands, browsing, approvals, authentication operations,
or gameplay actions. Do not write memory files. Remember information only within this conversation.
Choose one visible marker as a high-level investigation target. List ALL visible color/shape/quadrant markers.
Each marker has color, shape, horizontal (left/right), and vertical (top/bottom).
Report uncertainty honestly. recommendedTics must be an integer 1–35, advisory only.
recommendedInstruction should be null. Do not name any low-level actions anywhere in the JSON.
Match this shape (prompt guidance, not native schema enforcement): ${JSON.stringify(outputSchema)}`;

type Turn = {
  fixture: string; attempted: boolean; admitted: boolean; completed: boolean;
  finishReason: string | null; rawFinishReason: string | null; schemaValid: boolean;
  sessionUnchanged: boolean | null; proposal?: Proposal; assessment?: ReturnType<typeof assess>;
  nonceRecall?: boolean; targetRecall?: boolean; firstRecallNull?: boolean;
  usage?: unknown; toolCallsObserved?: number; elapsedMs?: number;
};

async function trial() {
  const started = Date.now();
  const report = {
    outcome: 'INCONCLUSIVE', versions: {} as Record<string, string>,
    fixtures: [] as { name: string; bytes: number; sha256: string }[],
    acpInitialized: false, sessionStarted: false, sessionId: null as string | null,
    sessionPersisted: null as boolean | null, inferenceTurnsAttempted: 0,
    inferenceTurnsAdmitted: 0, inferenceTurnsCompleted: 0, turns: [] as Turn[],
    admissionMeaning: 'AI SDK provider-call start; not an independent remote acceptance receipt',
    toolActivity: 'NOT_OBSERVABLE', permissionActivity: 'NOT_OBSERVABLE',
    evaluation: 'NOT_RUN', usage: null,
    cleanup: 'NOT_NEEDED', elapsedMs: 0, errorCategory: null as string | null,
  };
  let provider: ReturnType<typeof createACPProvider> | undefined;
  let markerCreated = false;
  let stage = 'LOCAL_SETUP';
  const abort = new AbortController();
  async function bounded<T>(operation: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new Error('TRIAL_TIMEOUT')); }, ms);
      })]);
    } finally { clearTimeout(timer); }
  }
  try {
    // Consume the local attempt even if startup fails; never automatically rerun.
    mkdirSync(local('.local/fixture-cwd/'), { recursive: true });
    writeFileSync(local('.local/trial-started'), new Date().toISOString(), { flag: 'wx' });
    markerCreated = true;
    const lock = JSON.parse(read('package-lock.json').toString());
    for (const name of ['ai', '@mcpc-tech/acp-ai-provider', '@agentclientprotocol/codex-acp', '@openai/codex']) {
      const version = JSON.parse(read(`node_modules/${name}/package.json`).toString()).version;
      if (version !== lock.packages[`node_modules/${name}`].version) throw new Error('VERSION_MISMATCH');
      report.versions[name] = version;
    }
    report.versions.providerNestedAI = JSON.parse(read('node_modules/@mcpc-tech/acp-ai-provider/node_modules/ai/package.json').toString()).version;
    report.versions.node = process.version;
    const images = ['a', 'b'].map(name => {
      const bytes = read(`../codex-app-server/fixture-${name}.png`);
      report.fixtures.push({ name, bytes: bytes.length, sha256: hash(bytes) });
      return bytes;
    });
    provider = createACPProvider({
      command: fileURLToPath(local('node_modules/.bin/codex-acp')),
      env: { INITIAL_AGENT_MODE: 'read-only' },
      session: { cwd: fileURLToPath(local('.local/fixture-cwd/')), mcpServers: [] },
      persistSession: true,
    });
    const model = provider.languageModel();
    stage = 'ACP_INITIALIZATION';
    await bounded(provider.connect(), 45_000);
    report.acpInitialized = true;
    stage = 'SESSION_SETUP';
    await bounded(provider.initSession(), 45_000);
    report.sessionId = provider.getSessionId();
    report.sessionStarted = !!report.sessionId;
    if (!report.sessionId) throw new Error('SESSION_MISSING');
    let firstTarget: string | undefined;
    for (const index of [0, 1]) {
      if (provider.getSessionId() !== report.sessionId) throw new Error('SESSION_CHANGED');
      const dto = { source: 'synthetic-fixture', verified: false, observationId: `fabricated-${index}`, revision: index, gameState: null };
      const request = index === 0
        ? `Fixture A. Remember nonce ${nonce} and the exact target string you choose for the next turn. Set visualEvidence.recalledNonce and recalledTarget to null now.`
        : 'Fixture B. Inspect only the NEW image for CURRENT markers. Recall the previous nonce exactly in visualEvidence.recalledNonce and your previous exact target string in recalledTarget. If unavailable, put null.';
      const turn: Turn = { fixture: index === 0 ? 'A' : 'B', attempted: true, admitted: false,
        completed: false, finishReason: null, rawFinishReason: null, schemaValid: false, sessionUnchanged: null };
      report.turns.push(turn);
      stage = 'INFERENCE';
      report.inferenceTurnsAttempted++;
      const turnStarted = Date.now();
      const result = await bounded(generateText({
        model, maxRetries: 0, abortSignal: abort.signal,
        messages: [{ role: 'user', content: [
          { type: 'text', text: `${instructions}\n${request}\nDTO=${JSON.stringify(dto)}` },
          { type: 'image', image: images[index], mediaType: 'image/png' },
        ] }],
        onLanguageModelCallStart: () => { turn.admitted = true; report.inferenceTurnsAdmitted++; },
      }), 120_000);
      turn.elapsedMs = Date.now() - turnStarted;
      turn.finishReason = result.finishReason;
      turn.rawFinishReason = result.rawFinishReason ?? null;
      turn.usage = Object.values(result.totalUsage).some(value => typeof value === 'number') ? result.totalUsage : null;
      turn.toolCallsObserved = result.steps.reduce((count, step) => count + step.toolCalls.length, 0);
      turn.completed = result.finishReason === 'stop' && result.rawFinishReason === 'end_turn';
      if (turn.completed) report.inferenceTurnsCompleted++;
      if (turn.toolCallsObserved) { report.toolActivity = 'OBSERVED'; throw new Error('UNEXPECTED_TOOL_ACTIVITY'); }
      if (!turn.completed) throw new Error('AMBIGUOUS_COMPLETION');
      turn.sessionUnchanged = provider.getSessionId() === report.sessionId;
      report.sessionPersisted = turn.sessionUnchanged;
      if (!turn.sessionUnchanged) throw new Error('SESSION_CHANGED');
      stage = 'PROPOSAL_VALIDATION';
      report.evaluation = 'SEE_TURNS';
      const proposal = validateProposal(result.text, 'completed');
      turn.schemaValid = true;
      turn.proposal = proposal;
      turn.assessment = assess(proposal, index, nonce, firstTarget);
      if (index === 0) {
        firstTarget = proposal.target;
        turn.firstRecallNull = proposal.visualEvidence.recalledNonce === null && proposal.visualEvidence.recalledTarget === null;
      } else {
        turn.nonceRecall = proposal.visualEvidence.recalledNonce === nonce;
        turn.targetRecall = proposal.visualEvidence.recalledTarget === firstTarget;
      }
      if (!turn.assessment.imageMatch || turn.firstRecallNull === false || (index === 1 && !turn.assessment.contextRetained)) {
        report.outcome = 'FAIL'; throw new Error('ASSESSMENT_FAILED');
      }
      console.log(`Fixture ${turn.fixture}: completed; JSON valid; markers match; session unchanged`);
    }
    report.outcome = 'PASS';
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const known = ['TRIAL_TIMEOUT', 'VERSION_MISMATCH', 'SESSION_MISSING', 'SESSION_CHANGED', 'UNEXPECTED_TOOL_ACTIVITY', 'AMBIGUOUS_COMPLETION', 'ASSESSMENT_FAILED'];
    report.errorCategory = !markerCreated ? 'LOCAL_SETUP_OR_ATTEMPT_MARKER_EXISTS'
      : known.includes(message) ? message
      : /failed to load workspace requirements: invalid data/.test(message) ? 'WORKSPACE_REQUIREMENTS_INVALID'
      : /auth|login|sign.in/i.test(message) ? 'AUTHENTICATION_REQUIRED_OR_FAILED' : `${stage}_FAILED`;
    process.exitCode = 1;
  } finally {
    try {
      provider?.cleanup();
      report.cleanup = provider ? (provider.getSessionId() === null ? 'PUBLIC_CLEANUP_RETURNED_SESSION_CLEARED_EXIT_UNVERIFIED' : 'SESSION_NOT_CLEARED') : 'NOT_NEEDED';
    } catch { report.cleanup = 'PUBLIC_CLEANUP_FAILED'; report.outcome = 'INCONCLUSIVE'; }
    report.elapsedMs = Date.now() - started;
    if (markerCreated) writeFileSync(local('trial-evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ outcome: report.outcome, attempted: report.inferenceTurnsAttempted,
      admitted: report.inferenceTurnsAdmitted, completed: report.inferenceTurnsCompleted,
      errorCategory: report.errorCategory, cleanup: report.cleanup, elapsedMs: report.elapsedMs }));
  }
}

if (process.argv[2] === '--preflight') await import('./preflight.ts');
else if (process.argv[2] === '--trial') await trial();
else throw new Error('Choose --preflight (historical static gate) or --trial (authorized runtime)');
