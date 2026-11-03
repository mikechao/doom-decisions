# DoomPlayAgent and bounded Doom supervisor

`src/main.ts` is the primary composition root. Its original
`--authorize-live-observation-cli` mode remains passive: attach, one verified PNG,
parent/child advisory tools, final validation, cleanup and retained browser lease.
It cannot claim a run or dispatch gameplay. Default/help are inert: no attach,
SQLite open, CLI process or inference.

The separate **`--authorize-agent-one-decision`** flag enables a small agent-driven
experiment. It also requires `--authorize-live-observation-cli`. Only the parent
DoomPlayAgent receives `executeGuardedDecision({ objective, uncertainty })`.
The parent may consult the existing read-only LandmarksToolLoopAgent once, invokes
the guarded tool itself, receives an ordinary SDK JSON tool result, and continues
reasoning in the same parent agent run. `main.ts` never continues into a post-agent
`decide`. The independent supervisor below is reference material, not imported
or used by this path.

The host callback in `src/guarded-decision.ts` rejects malformed, oversized,
control-like or unsafe advisory input before claiming anything. The two text
fields are advisory only; there is no action, button, mask, duration, run ID,
raw template or arbitrary control field. Conservative text rejection is **not**
semantic isolation of natural language. Host-held original settings are preserved,
including include flags, six tics and `{{tics}}`. Historical notes remain unverified;
final attribution is resolved from the existing validated consultation receipts,
never parent-restated provenance. Without consultation, attribution must be null.

A private invocation latch is consumed before the first mutating transport call.
A second independent latch guards decision dispatch. Neither can be reset by
model retries, SDK steps, failed transport, final-output repair or lost responses.
The typed callback sequence is exactly:

1. `start-run` with the initial observation/session/revision; require the same
   configuration and acknowledged `active=true, limit=1, reserved=0,
   sdkInvoked=0, remaining=1`. A larger allowance is refused, never repaired.
2. `set-prompt` with an owned private instructions file and scoped CAS; require
   the exact guidance and revision +1, same run and unused counters.
3. `observe` followed by `liveObserve`: different observation ID, correct
   lease/epoch/session/map, unchanged tic/native hashes/telemetry/probe/previous
   action and gameplay counters, new configuration/revision and unused run.
   Incidental render/frame counters may change. PNG bytes and hashes are validated.
4. `decide` with only lease, fresh observation ID and session/run/revision scope.
   Decisions selects the action; the controller applies and verifies actual tics.
   `liveDecision` checks the actual typed receipt and frame. No invented receipt
   run/revision fields are used.
5. For healthy completion only, one read-only `get-config` corroborates the same
   run/config/revision and `active=false, limit=1, reserved=1, sdkInvoked=1,
   remaining=0`. Terminal/retired accounting is marked unavailable; verified
   native prefixes remain distinct from a fully completed action.

The SDK result contains compact host receipt facts, including outcome, reason,
uncertainty, action, requested/reported/verified/cumulative tics, SDK invocation,
provider/model metadata and before/after identities. It contains no PNG, file
paths, private memory text or unrestricted error details. The authorized final
JSON extends the passive schema with `decision`, which must exactly match the
host-captured structured result. This proves structured receipt grounding, not
semantic truth of every sentence of model prose. A malformed/ungrounded final
response, accounting failure or cleanup failure cannot erase the report's
independently verified action. Nothing is replayed to obtain nicer prose.

### CLI output and diagnostics

An authorized `main.ts` invocation writes exactly one final JSON report to
**stdout**, including on failure; redirect stdout to retain machine evidence.
The existing inert default/help/invalid-argument paths print usage text instead.
Consola 3.4.2's BasicReporter has both output streams explicitly bound to
**stderr**. Info milestones, warnings and short diagnostics are enabled by default
at fixed level 3, with no colors, spinner, token/event logging or throttling.
`CONSOLA_LEVEL` does not override this console; existing provider debug flags
remain forbidden. Provider warnings fail closed without echoing arbitrary provider text. These
host milestones do not claim to filter all inherited Codex subprocess output.

Only validated scoped `objective` and `uncertainty` fields are displayed as
guidance, never the entire instruction template, private notes or transcript.
The objective becomes known at guarded invocation. Guidance is **proposed** until
exact prompt CAS acknowledgement; **applied** displays that admitted advisory
block. Display replaces control/format characters and newlines with spaces,
strips terminal escape sequences, redacts recognizable credential/location/ID
patterns, indents text and caps each field at 480 characters with `[truncated]`.
This display filtering does not rewrite admitted guidance or receipt evidence.
It is not a general detector of secrets embedded in natural-language advice.

Illustrative one-decision excerpt (not live acceptance evidence; milestones
appear only when reached, consultation is optional, values come from receipts):

```text
[info] [doom] Browser lease acknowledged
[info] [doom] Initial observation verified: E1M1, tic 1
[info] [agent] DoomPlayAgent request started (initial image supplied)
[info] [landmarks] Consultation complete: 2 candidates, 1 selected (historical, unverified)
[info] [decision] Current navigation objective:
    Can the opening ahead be reached?
[info] [decision] Proposed gameplay guidance (advisory):
  Objective:
    Can the opening ahead be reached?
  Uncertainty:
    Make a brief straight-ahead probe; passability remains unverified.
[info] [decision] Decision 1 of 1; run allowance acknowledged
[info] [decision] Applied gameplay guidance (CAS revision 2; scoped advisory only):
  Objective:
    Can the opening ahead be reached?
  Uncertainty:
    Make a brief straight-ahead probe; passability remains unverified.
[info] [decision] Fresh observation verified after guidance CAS
[info] [decision] Submitting guarded controller decision request; provider dispatch not yet known
[info] [decision] Controller receipt validated: completed; SDK invoked: true
[info] [decision] Verified action: forward, 6 tics (tic 1 → 7)
[info] [decision] Budget verified: 1 SDK attempt used / 1 total; reserved=1, remaining=0
[warn] [run] Run failed: MAIN_FAILED; stage=final_json, code=JSON_PARSE_INVALID
[info] [cleanup] CLI close attempts finished; child exit evidence is reported per owner
```

`failureDiagnostic` is null on success, otherwise `{stage, code}`. Stages locate
setup, attach, initial observation, provider initialization, parent stream,
callback correlation, completion awaiting/checks, session invariants, final
JSON/schema/grounding or cleanup. Fixed codes distinguish `JSON_PARSE_INVALID`,
`OUTPUT_LIMIT`, `SCHEMA_INVALID`, `COMPLETION_METADATA_INVALID`,
`SESSION_INVARIANTS_INVALID`, `OBJECTIVE_MISMATCH`,
`RECEIPT_GROUNDING_MISMATCH`, `ATTRIBUTION_MISMATCH`, invalid consult/child
receipts, stream rejection, cancellation and cleanup failure. Other causes remain
`unknown`; no exception messages, rejected model text, schema messages or unknown
field names enter the diagnostic. Parent-finalization failure retains
`MAIN_FAILED`, nonzero exit, the independently verified controller receipt and
final accounting. These diagnostics do not establish the earlier live failure's
root cause. CLI provider cleanup still does not release the lease: press **Stop Agent**
in the browser before another attach. No retry or extra decision is added.

Both agents retain separate ACP model/provider/session owners and the pinned
SDK 6/7 structural bridge, without new casts or dependency changes. The installed
AI SDK 7.0.159 `ToolLoopAgent` supports `stopWhen: isStepCount(3)` for optional
consultation, decision, final response; `maxRetries: 0` remains. ACP's own tool
loop can deliver consultation, decision and final text within **one** SDK request
and step. The SDK step bound does not bound ACP-internal work. Streams must fully
finish, retain stable session identities, and correlate every accepted tool call
ID/name/result; duplicate, orphan, foreign and mismatched results fail closed.
Reports separate parent/child SDK requests, steps and tool counts from host tool
attempts/rejections/consumption, claim, allowance, CAS, fresh observation,
dispatch delivery, reservation/accounting and actual provider SDK invocation.

The initial PNG is still the only image delivered to the parent. The internal
post-CAS `observe` is a host protocol step. Structured resulting-state feedback
does not demonstrate agent-controlled observation cadence or supply a second
image. An agent-visible `observeDoom` is deferred until its own image seam can be
proven. No generalized executor, continuous loop, automatic retry or reattach is
introduced.

Future **operator-run examples only**, requiring separate live authorization;
these commands have not been executed for this implementation:

```bash
# First fully stop any prior dev:agent process. Configure its ignored local file
# with AGENT_DECISION_BUDGET=1, then start a NEW broker/dev process:
npm --prefix app run dev:agent

# After browser preparation and credentials/readiness, in another terminal:
node --experimental-strip-types experiments/codex-acp-ai-sdk7/src/main.ts --authorize-live-observation-cli --authorize-agent-one-decision

# Observation-only mode (no gameplay allowance consumed):
node --experimental-strip-types experiments/codex-acp-ai-sdk7/src/main.ts --authorize-live-observation-cli
```

The operator prepares exactly one `http://127.0.0.1:5174/` dev:agent browser,
ensures no previous owner or active run, and presses **Stop Agent** to reset any
previous ownership before retrying. `AGENT_DECISION_BUDGET` is read from ignored
`app/.env.agent.local` and process-cached by the broker: editing it or changing an
environment variable without fully restarting the broker is insufficient. This
entry cannot supply/replenish the allowance. Budget is SDK attempts, not dollars.
Browser preparation may use local game assets and live requests can incur charges.
The browser needs usable provider credentials; Codex ACP needs its own credentials.
Do not enable provider debug logging. Optional historical consultation also needs
the existing valid read-only landmark snapshot; missing storage fails closed.

OpenRouter is the browser default; agent `AGENT_MODEL=gpt6` chooses
`openai/gpt-6-luna-decisions` **through OpenRouter**, while the default `jev`
chooses `typesafe/jev-1.14`. This does not select the experimental direct OpenAI
endpoint (`VITE_DECISION_PROVIDER=openai`). The ACP reasoning model is separate
from the browser Decisions model. No credential/model/provider files were changed.

**The browser lease is retained.** Successful attach reports `held`; lost/uncertain
attach reports `possibly-held`. CLI provider cleanup, process exit and deleting lease files
do not revoke browser ownership. Press **Stop Agent** before every retry. No
revoke/detach is implemented. Owned instructions files are removed; typed-client
lease/PNG files remain in their separate private directory. Reports preserve
unknown outbound delivery before claim/CAS/decide transport. Cancellation or the
120-second cooperative deadline fences all further mutations and late results;
neither proves remote processing or billing stopped. Public CLI provider cleanup never
proves subprocess exit, full tool isolation or successful network cancellation.

Offline verification (synthetic PNGs, fake typed HTTP transport without servers,
in-memory landmark data and deterministic provider streams; no historical DBs):

```bash
node --experimental-strip-types --test --test-skip-pattern='local snapshot integration' experiments/codex-acp-ai-sdk7/tests/*.test.ts
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7 --noEmit
git diff --check
```

The skip pattern excludes historical-snapshot integration. Synthetic throwaway
SQLite fixtures remain included; no historical database is read or mutated.
Success fixtures request ordinary tools from fake V4 models; the real SDK executes
callbacks and forwards their results to subsequent model steps. A separate Hermes
fixture emits textual requests and proves the full nested consultation/action/final
JSON sequence, including malformed final markup rejection without erasing a verified
synthetic receipt. Temporary SQLite fixtures are isolated; the historical-snapshot
integration test is explicitly excluded. No live Codex, App Server, Decisions,
browser, Doom or live memory database was used for this migration.

## Native CLI migration and review boundary

Baseline: `dc8ccf62ecaa4156520c965dc83e31a79a45eb4d` on
`experiment/codex-cli-ai-sdk7`; the directory name is intentionally retained.
The active `main.ts` dependency path and both agent smokes now use
`ai@7.0.159`, `ai-sdk-provider-codex-cli@2.4.0`,
`@ai-sdk-tool/parser@5.1.6` and direct `zod@4.6.7`. Provider interface v4
is directly declared for offline model fixtures. Lockfile resolution keeps
provider-utils v5.0.72 on this path and v4.0.63 on the retained ACP path.

- `cli-provider.ts` owns independent parent/child clients, wrapping the native V4
  model in Hermes plus a warning/native-event fence. It reuses the probe's local
  Codex executable, `gpt-6.1-sol`, stateless threads, read-only sandbox, on-request
  approvals (no auto-approval), and 15-second connection/request limits. Construction
  is inert; authorized initialization checks the first model-list page without fallback.
- `native-tools.ts` uses SDK `tool({ inputSchema, execute })` with the existing
  Zod schemas. Its sole presentation conversion unwraps one MCP text block into an
  ordinary JSON result. Domain callbacks and their ledgers retain existing envelopes
  internally. Host evidence binds SDK IDs/names/inputs/outputs to callbacks and rejects
  repetition, overlap, or same-step consultation/action dispatch.
- `doom-play-agent.ts` and `landmarks-tool-loop-agent.ts` replace instructions per
  step. The parent may consult then act, or act directly when authorized. Only after
  the relevant callbacks settle does synthesis use `toolChoice: 'none'`. No tool
  results are fabricated in instructions. Child completion needs two SDK requests;
  the parent needs two (direct action/passive consultation) or three (consult then act).
- `agent-stream.ts` consumes ordinary SDK call/result events and rejects duplicate,
  orphaned, swapped, provider-executed or ungrounded results. Completion requires
  unified `stop` plus raw `completed`, drained steps and matching callback counts.
  `landmarks-completion.ts` keeps completion inspection separate from any runner.
- `agent-lifecycle.ts` adds asynchronous native-owner cleanup alongside the retained
  legacy ACP helpers. Both initialization and late `doStream` startup are fenced;
  late settlements close again. `close()` returning does not prove child exit. A
  child exit is labeled observed only when the provider's exit logger reports it.
  The browser **Stop Agent** control still releases the browser lease.

`guarded-decision.ts`, typed controller adapters, app/engine code and the proven
probe are unchanged. A validated game receipt and validated final model JSON remain
separate evidence; malformed synthesis fails the run while preserving the action.
The diagnostic stage formerly named `session_invariants` is now `provider_invariants`:
stateless model threads replace the ACP persistent-session-ID invariant. This is an
explicit transport/lifecycle change, not a persistent-session parity claim. SDK
request counts now include each host-tool continuation, rather than one ACP turn
containing provider-owned tool execution. All request limits remain finite; they
are not a bound on internal Codex/network work or a billing guarantee.

Image tests prove exact bytes enter the SDK and the installed provider's pure
conversion creates a local-image input with matching bytes. A failed temp write
throws through the provider warning logger, aborting the run; mapping warnings
also fail closed. Actual App Server receipt/reading of that image and model visual
understanding remain unverified. A write failure after the provider creates its
temporary directory may leave provider-owned files; close reports do not certify
their deletion. Normalized native tool events are rejected below
Hermes and approval requests abort, but inherited configuration, read-only mode and
filtered provider events do **not** establish that native tools are disabled or
exhaustively observable. No global Codex configuration is changed.

The CLI boundary omits Hermes's empty `tools: []` before calling the provider:
the pinned provider warns about any defined tools value, including an empty list.
That warning previously tripped the fail-closed stream fence on the first request.
Nonempty native declarations are rejected before provider invocation. Offline
Hermes fixtures now include the installed provider's pure settings-warning mapper,
with an empty-list negative control; they do not execute App Server or inference.

Failure diagnostics retain fixed host codes for image-write/provider/stream warnings,
native-tool events/declarations, server approval requests and closed/missing-model
owners. Deadline expiry reports `DEADLINE`; earlier external cancellation keeps
precedence. No arbitrary warning text, provider errors, credentials or paths are
retained. Older reports containing only `CANCELLED` cannot identify which underlying
cause triggered the abort. This correction has offline proof only, without a live retry.

The active path is SDK 6/ACP-free. **The whole package is not**: the independent
`supervisor-acp.ts` / `supervisor.ts` workflow and
`find-landmarks-acp-smoke.ts` still need ACP 0.3.9, codex-acp 2.5.0 and nested
SDK 6.0.320. Their bridge and tests remain intact. The smallest dependency-removal
follow-up is to isolate those legacy scripts into their own package, or explicitly
retire them; porting that supervisor is outside this migration.

The two archived agent smokes now require `--authorize-cli` (their old ACP flag
is rejected). They still access archived observations/SQLite only after explicit
live authorization, and were not run. `main.ts` now uses
`--authorize-live-observation-cli`; no old ACP flag starts the migrated runner.
No live authorization is implied by offline test success.

Review-ready offline verdict: **READY FOR SYNTHETIC LIVE INFERENCE** only. The next
separately authorized experiment should use synthetic parent/child tools and PNG,
one consultation then one harmless synthetic guarded-result callback, and exact
final JSON. Do not use `main.ts` or the archived smokes for that experiment: they
attach to the browser or read historical memory. No live inference was run here.

## Existing bounded supervisor

This separate prototype uses Codex through ACP and Vercel AI
SDK 7 proposes high-level navigation guidance over browser Doom. The existing
Decisions API selects the low-level action; the application retains lease,
budget, Stop and native/frame verification authority. One bounded numeric loop
handles explicitly authorized N decisions in one persistent ACP session, with N
ACP turns and no final advisory-only turn. N=1 intentionally removes the historical
post-decision reassessment. Live execution still requires separate human approval.
Use `--live --authorize-decisions N --trial NEW_ID`; legacy one/two flags alias N=1/2.

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Native CLI/Hermes DoomPlayAgent composition root; verified bootstrap, optional guarded tool, stream/report validation and native-owner cleanup. |
| `src/guarded-decision.ts` | Advisory input boundary, one-shot typed controller callback, CAS/freshness/receipt guards and action evidence. |
| `src/agent-stream.ts` | Bounded ordinary SDK call/result and host-callback correlation. |
| `src/agent-lifecycle.ts` | Native asynchronous owner fences/cleanup and retained legacy ACP lifecycle helpers. |
| `src/supervisor.ts` | Gated live entry, installed/lock version admission, exclusive trial setup, signals, port composition, report publication and cleanup scheduling; stable workflow re-exports. |
| `src/supervisor-workflow.ts` | Injectable bounded N-decision loop, evidence/report ledger, ACP checkpoints, session checks, cancellation/deadlines and ACP cleanup ownership. |
| `src/supervisor-cli.ts` | Typed Doom operation ports, lease tracking, sanitized numbered receipts, PNG reads, temporary instruction-file creation and removal. |
| `src/supervisor-acp.ts` | Lazy AI SDK/ACP imports, provider/model configuration and session/generation/cleanup methods. |
| `src/live-observation.ts` | Strict live DTO, PNG and correlation validation. |
| `src/doom-proposal.ts` | Strict advisory proposal/reassessment schemas and validators. |
| `tests/supervisor.test.ts` | Fake-only offline regressions, compatibility exports and guarded inert imports/entry paths. |

The entrypoint composes typed Doom ports with the ACP factory's `createACP` port and
passes them to `supervise()`. Adapters import only workflow types; the workflow
does not import adapters. `src/supervisor-cli.ts` calls the checked
`scripts/doom-agent-client.ts` executor directly for attach, observe, startRun,
setPrompt, decide and getConfig. The supervisor has no CLI argument-array port;
it adds no unused getPrompt/setConfig ports. The public CLI and MCP still use
`scripts/doom-agent.mjs`, which delegates to that same executor in process.
The browser
remains authoritative for gameplay; Codex ACP supplies advisory navigation guidance
only. Both adapter factories are inert until their ports are invoked.

Node 22.20.0 executes the executor's erasable TypeScript directly, as it already
does for the CLI's app DTO imports. Plain `node scripts/doom-agent.mjs` and the
configured `node app/agent-mcp.mjs` need no compilation or generated JavaScript.
The experiment no-emit check follows the executor import and checks its implementation,
typed inputs and materialized results. The executor owns file-backed lease/settings
reads, transport, correlation, shared runtime parsers and exclusive PNG writes;
`src/live-observation.ts` still independently checks the actual PNG bytes supplied to ACP.

Mutation attempts are recorded once inside the bounded scheduling/deadline fence,
before the typed port is invoked. Claim/decision attempt counters, unknown guidance
application and pending mutation state retain the existing no-retry behavior;
only validated acknowledgments/results clear pending delivery uncertainty.

The CLI adapter exclusively creates at most authorized N distinct 0600 instructions files.
It registers ownership after creation and before writing, so partial-write cleanup
cannot delete an existing file after EEXIST. The entrypoint calls
its cleanup in `finally` after report publication (or failure), after removing signal
listeners. Cleanup failures propagate as before; hard interruption may leave the
file. The workflow separately owns ACP cleanup before returning its report.

`package.json`, `package-lock.json`, `tsconfig.json` and `.gitignore` retain pinned
dependencies, offline test/typecheck setup and ignored artifacts. See
[SUPERVISOR.md](SUPERVISOR.md) for live invocation, accounting, Stop and evidence limits.

From the repository root, with existing installed tools, safe offline checks are:

```sh
node --experimental-strip-types --test experiments/codex-acp-ai-sdk7/tests/supervisor.test.ts
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7
```

`npm test` from this directory discovers `tests/*.test.ts`: the fake-only
supervisor and bridge suites plus the read-only landmark tests below. Only the
landmark integration test uses optional ignored snapshot/observation files;
missing files skip that test explicitly. No test uses a broker, browser, WAD,
network or model inference.
`node --experimental-strip-types src/supervisor.ts --help` is inert. There is no
npm live-run script; use only the explicit gated invocation in
[SUPERVISOR.md](SUPERVISOR.md#human-invocation-after-separate-approval), with fresh
human approval, a new trial ID and stderr suppressed as documented.

The owner reports that Trial 001 executed `turn_right` for six verified tics
(cumulative tic 7), then failed only at final reassessment validation. Trial 002
completed the one-action cycle: two ACP checkpoints in the same observed session
ID, one verified Decisions action, accepted advisory reassessment and exhausted
limit 1. These are owner-supplied live reports, not independent verification by
this cleanup. Private trial evidence and consumed markers remain untouched under
ignored `.local/`; never reuse a consumed ID or commit/upload that evidence.

Earlier startup diagnostics, the successful synthetic two-image session/recall
proof, and a one-shot historical Doom observation established narrower integration
and visual-grounding evidence. The owner found the single-frame visual grounding
substantially accurate, with shallow telemetry grounding and no gameplay progress
tested. Their superseded runners, replay-specific tests and tracked reports are
available in Git history; they are no longer supported entry points here.

The owner also reports a live two-decision same-session reassessment cycle in the
implementation task context. Generalized-N correctness is verified only offline.
The N=1,2,3,5 regressions capture actual pinned OpenRouter SDK Request bodies through
fake fetch, the real request builder and provider. Each step has distinct synthetic
image/state/guidance; guidance replaces the prior advisory while preserving the
original template and six-tic horizon. ACP, controller and native gameplay are fake.

The browser allowance remains authoritative. Preclaim reads expose `run:null`, so
its numeric limit is learned only after the single nonrefundable `startRun` claim.
The validated claim/counters are recorded before requiring exact equality with N;
both mismatch directions fail before prompt CAS or decide, without retry/refund.
The report replaces string `mode` with `requestedDecisions` and adds
`claimAccounting`; interim and final accounting remain separate. The host never
reads the private env file. No bridge/controller/protocol change is included.

This remains a prototype. Valid JSON and advisory status do not prove navigation
success. Read-only mode and empty MCP configuration do not establish full Codex
internal-tool isolation. Public cleanup does not guarantee descendant termination
or remote cancellation/billing cessation; missing usage is unavailable, not zero.
Offline tests do not independently establish live browser/WASM correctness.

## Isolated host-tool bridge smoke

`src/find-landmarks-acp-smoke.ts` is a separate, synthetic bridge experiment. It does
not import the supervisor, access Doom or SQLite, or assess navigation. Importing
it, running without arguments, or using `--help` starts no ACP process. The pinned
two-entry tool map keeps the registered callback and reconstructs the generated
dynamic descriptor for SDK 7; its runtime ACP/MCP path remains unproven.

Offline checks from the repository root:

```sh
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7
node --experimental-strip-types --test experiments/codex-acp-ai-sdk7/tests/find-landmarks-acp-smoke.test.ts
```

Only after separate explicit approval for a metered ACP run, subprocesses and
the generated MCP loopback listener, run once from the repository root:

```sh
node --experimental-strip-types experiments/codex-acp-ai-sdk7/src/find-landmarks-acp-smoke.ts --authorize-acp 2>/dev/null
```

The runner uses GPT-6 Luna/xhigh, read-only mode, one SDK request, at most two SDK
steps, no SDK retries and a 120-second deadline. It registers tools before session
creation. The MCP proxy adds an effective server despite configured `mcpServers: []`.
Neither SDK bounds nor read-only mode isolate all internal Codex tools/work;
provider lazy authentication may retry internally. Existing sign-in is required;
this runner does not configure credentials. Debug flags must be disabled.

Success requires exactly one completed host callback and an exact final JSON echo
of the ID/marker generated only inside that callback. Repeated/invalid callbacks
are recorded and abort the run. SDK tool events are notifications, not callback
receipts. The JSON report goes to stdout; no transcript/report files are created.
Only a fresh temporary cwd is created, and only an empty cwd is removed. Cleanup
requests cancellation and calls public provider cleanup; cleared session state is
not proof of child/descendant exit or stopped remote processing/billing. The CLI
then exits. A timeout or failed run must not be automatically retried.

The offline tests exercise registration, descriptor guards, synthetic callbacks,
echo validation and the authorization gate locally. They do not launch ACP, bind
a listener, establish real tool-result consumption or demonstrate bridge success.

## Read-only historical landmark experiment

`src/landmarks-tool-loop-agent.ts` defines the native SDK 7 child agent, with only
`findLandmarks`, two SDK requests/steps and one host lookup. Its instructions select
one unverified historical candidate, then a separate completion step validates exact
ID, namespace, source and summary. It imports no runtime runner, provider, SQLite
or filesystem module. `src/landmarks-tool.ts` retains the existing bounded read-only
retrieval and attribution validation, including internally recorded MCP envelopes;
`native-tools.ts` unwraps those envelopes for ordinary SDK results.

`src/landmarks-tool-loop-agent-smoke.ts` and `src/doom-play-agent-smoke.ts` retain
archived observation/snapshot preflight and explicit `--authorize-cli` gates. They
now use independent native CLI owners, Hermes, native SDK callbacks, correlated
streams, `stop`/`completed` completion and truthful asynchronous close reports.
The parent smoke performs no gameplay; neither smoke supplies an image. These
historical-data runners must not be used for a synthetic live-inference trial.

The historical snapshot remains fixed to the worktree's ignored
`.local/doom-memory.sqlite`; no migration, copying, fallback, creation or live
memory write is added. The optional `local snapshot integration` test must remain
excluded under the current task authorization. Offline checks use in-memory data
and isolated throwaway SQLite fixtures only. Prior owner-reported ACP retrieval
and gameplay evidence remains historical evidence for the former transport, not
live acceptance evidence for this CLI migration. The separate standalone
`find-landmarks-acp-smoke.ts` bridge still uses ACP and is unchanged.

<details>
<summary>Preserved pre-migration ACP notes and historical evidence</summary>

These notes describe the prior implementation. Its tool ownership, session,
prompt-placement discussion and live commands are historical; they are not
current invocation instructions or CLI parity evidence. Use the native migration
section above for the current contract. No historical artifacts were removed.

### Historical ACP implementation notes (superseded)

`src/landmarks-tool-loop-agent.ts` is the side-effect-free agent definition:
`createLandmarksAgent(model, tools, onLanguageModelCallStart)` shows the model,
landmark-advisor instructions, supplied `findLandmarks` tool map, and unchanged
SDK limits. It imports no runtime runner, provider, filesystem or SQLite module.

`src/landmarks-tool-loop-agent-smoke.ts` owns the guarded CLI, ACP provider/session
setup, host callback registration, SDK 6/7 tool-map reconstruction, timeout,
receipts/events, validation, reporting and cleanup. `src/landmarks-tool.ts` retains
read-only retrieval and attribution validation. The advisor text is unchanged and
now supplied through the agent's `instructions`; the runner supplies only the
request to retrieve and select one landmark. These files are independent of the
supervisor and typed Doom client. The sole host callback accepts `{}` and
delegates retrieval to the existing `findMemory(input)` in
[`app/doom-memory.mjs`](../../app/doom-memory.mjs). That JavaScript function has no
TypeScript declaration; its input is validated by `memoryFindSchema`. Importing
it starts no MCP server, gameplay or database connection. Lookup opens SQLite
with `readOnly: true`, checks application ID/schema v2, uses a read transaction,
and closes the handle. Only `recordMemory` initializes schemas or writes notes;
the experiment never calls it. Tests use it solely to initialize throwaway fixtures.

Prompt placement is behavioral: SDK 7 supplies `instructions` as a system
message, while the old runner sent the complete contract as one user message.
The pinned ACP provider turns the system message into a `System: ` text block
for a fresh session; codex-acp forwards those blocks as turn input, not native
developer instructions. Subsequent provider turns send only the latest user
message. The owner reports a post-refactor `INVALID_SELECTION` after successful
retrieval/envelope delivery. Without the rejected output's schema diagnostics,
the offending field and prompt-placement causality remain unresolved. Offline
message tests prove different serialization, not model behavior or live parity.
The current instruction/prompt split remains unchanged pending evidence. The
smallest baseline-restoration trial would omit agent `instructions` and pass the
unchanged full contract as the invocation `prompt`, retaining the small factory.

The fixed snapshot is resolved from the module URL to the worktree's ignored
`.local/doom-memory.sqlite`, never the source worktree database. Missing storage,
failed integrity/schema checks, or `DOOM_MEMORY_DB` pointing elsewhere fail
closed; there is no database creation, copying, fallback, migration or journal-mode
change. The snapshot was already present, so no backup was needed for this task.
The existing lookup preserves its 100ms busy timeout and foreign-key setting.

`src/landmarks-tool.ts` loads the existing ignored
`.local/real-doom/observation.{json,png}` relative to this experiment. It validates
the saved observation with the shared parser (including canonical IWAD digest,
E1M1 map key and native/Canvas frame receipt agreement) and checks the saved PNG
SHA-256. This validates archived capture evidence, not the current browser or a
new native execution. Source prose inside notes does not verify map identity.
The current saved observation is `d4ba38e3-6e53-474e-b77d-0053a43e0dd8`, tic 1,
with namespace
`doom-map:v1:iwad-sha256:1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771:E1M1`.
Native 16.16 coordinates and binary angle convert to `(1056, -3616)`, heading 90°.
The fixed nearby query uses radius 1024 (the existing maximum) and limit 3;
`findMemory` ranks by distance, circular heading difference, then ID. Landmark
filtering happens after that cap, so this is not an exhaustive map search.

The tool retains real IDs, namespace, anchor, spatial deltas, revision, flags,
source, creation time and `unverified` status. It caps the hypothesis summary at
400 characters, question at 200, and latest assessment at 400; earlier assessment
history stays out of the tool response. Its JSON is bounded to 12,000 characters
and travels in the explicit MCP `content: [{type: 'text', text: JSON.stringify(result)}]`
envelope. All note text remains untrusted advisory data. The model chooses one
candidate and explains why; strict validation requires its ID and evidence ID,
namespace, advisory status, source and summary to match a callback candidate.
It distinguishes invalid JSON, invalid selection shape, callback failure and
evidence mismatch. Empty retrieval has a separate validated JSON result.
Only a selected landmark yields `outcome: "passed"` and exit 0; valid empty
retrieval yields `outcome: "empty"` and exit 1 because it proves no selection.
An explanation's factual correctness is not machine-proven by these checks.

Unmetered checks from the repository root (dependencies already installed):

```sh
node --experimental-strip-types --test experiments/codex-acp-ai-sdk7/tests/find-landmarks-acp-smoke.test.ts experiments/codex-acp-ai-sdk7/tests/landmarks-tool-loop-agent.test.ts
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7
git diff --check
```

The isolated schema-derived fixtures prove lookup/ranking, namespace isolation,
empty results, read-only behavior, MCP schema/JSON round-trip, candidate selection
and rejection cases. The separate optional snapshot integration checks the real
saved pose, both historical note IDs, MCP evidence preservation, and unchanged
snapshot bytes, mtime and directory entries. It explicitly skips if the local
snapshot or saved capture files are missing. This is offline retrieval proof;
these tests alone do not prove ACP consumed or selected a historical landmark.
The owner reports a successful real ACP run before this organization-only
refactor: one callback, two historical E1M1 notes, MCP text delivery and validated
selection. No metered inference was run during the refactor.

Only after separate explicit approval, the one optional metered ACP command is:

```sh
node --experimental-strip-types experiments/codex-acp-ai-sdk7/src/landmarks-tool-loop-agent-smoke.ts --authorize-acp 2>/dev/null
```

This moved command has **not been run as part of this refactor**. Without the exact
flag (including on `--help`) no ACP process starts. It reuses the smoke runner's
host registration and two-entry SDK 6/7 tool-map reconstruction, GPT-6 Luna/xhigh,
read-only ACP mode, temporary empty cwd, one SDK request, at most two SDK steps,
one callback, no SDK retries and 120-second deadline. It does not read/change
credentials or fetch model packages. Callback receipts, SDK tool notifications,
selection validation, session continuity and public cleanup are reported as JSON
to stdout, with no report/transcript files. Failed selections retain bounded
schema branch/path/code diagnostics, output presence/character count, settled SDK
step/finish metadata, and stream completion/error/abort/tool-error counts. No raw
rejected text, Zod messages, unknown key names or provider errors are printed.
Callback receipts in stdout contain only IDs/status/revision and envelope
metadata; full results/envelopes remain internal to validation. Only validated
final selections retain the existing attributed JSON output. Existing smoke caveats about internal
tools, lazy-auth retry, generated MCP listener, subprocess exit, cancellation,
billing and cleanup still apply. Pending setup can outlive deadline reporting
and leave an empty temporary directory. No gameplay/agent MCP server is registered or
contacted, and no browser session is observed or advanced.

</details>
