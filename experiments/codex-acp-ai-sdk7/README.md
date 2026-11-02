# Bounded Doom supervisor

This directory contains one active prototype: Codex through ACP and Vercel AI
SDK 7 proposes high-level navigation guidance over browser Doom. The existing
Decisions API selects the low-level action; the application retains lease,
budget, Stop and native/frame verification authority. One bounded numeric loop
handles explicitly authorized N decisions in one persistent ACP session, with N
ACP turns and no final advisory-only turn. N=1 intentionally removes the historical
post-decision reassessment. Live execution still requires separate human approval.
Use `--live --authorize-decisions N --trial NEW_ID`; legacy one/two flags alias N=1/2.

| File | Responsibility |
| --- | --- |
| `supervisor.ts` | Gated live entry, installed/lock version admission, exclusive trial setup, signals, port composition, report publication and cleanup scheduling; stable workflow re-exports. |
| `supervisor-workflow.ts` | Injectable bounded N-decision loop, evidence/report ledger, ACP checkpoints, session checks, cancellation/deadlines and ACP cleanup ownership. |
| `supervisor-cli.ts` | Typed Doom operation ports, lease tracking, sanitized numbered receipts, PNG reads, temporary instruction-file creation and removal. |
| `supervisor-acp.ts` | Lazy AI SDK/ACP imports, provider/model configuration and session/generation/cleanup methods. |
| `live-observation.ts` | Strict live DTO, PNG and correlation validation. |
| `doom-proposal.ts` | Strict advisory proposal/reassessment schemas and validators. |
| `supervisor.test.ts` | Fake-only offline regressions, compatibility exports and guarded inert imports/entry paths. |

The entrypoint composes typed Doom ports with the ACP factory's `createACP` port and
passes them to `supervise()`. Adapters import only workflow types; the workflow
does not import adapters. `supervisor-cli.ts` calls the checked
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
`live-observation.ts` still independently checks the actual PNG bytes supplied to ACP.

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
node --experimental-strip-types --test experiments/codex-acp-ai-sdk7/supervisor.test.ts
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7
```

`npm test` from this directory discovers all `*.test.ts` files: the fake-only
supervisor and bridge suites plus the read-only landmark tests below. Only the
landmark integration test uses optional ignored snapshot/observation files;
missing files skip that test explicitly. No test uses a broker, browser, WAD,
network or model inference.
`node --experimental-strip-types supervisor.ts --help` is inert. There is no
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

`find-landmarks-acp-smoke.ts` is a separate, synthetic bridge experiment. It does
not import the supervisor, access Doom or SQLite, or assess navigation. Importing
it, running without arguments, or using `--help` starts no ACP process. The pinned
two-entry tool map keeps the registered callback and reconstructs the generated
dynamic descriptor for SDK 7; its runtime ACP/MCP path remains unproven.

Offline checks from the repository root:

```sh
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7
node --experimental-strip-types --test experiments/codex-acp-ai-sdk7/find-landmarks-acp-smoke.test.ts
```

Only after separate explicit approval for a metered ACP run, subprocesses and
the generated MCP loopback listener, run once from the repository root:

```sh
node --experimental-strip-types experiments/codex-acp-ai-sdk7/find-landmarks-acp-smoke.ts --authorize-acp 2>/dev/null
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

`landmarks-tool-loop-agent.ts` exposes `LandmarksToolLoopAgent`, independently of
the supervisor and typed Doom client. Its sole host callback accepts `{}` and
delegates retrieval to the existing `findMemory(input)` in
[`app/doom-memory.mjs`](../../app/doom-memory.mjs). That JavaScript function has no
TypeScript declaration; its input is validated by `memoryFindSchema`. Importing
it starts no MCP server, gameplay or database connection. Lookup opens SQLite
with `readOnly: true`, checks application ID/schema v2, uses a read transaction,
and closes the handle. Only `recordMemory` initializes schemas or writes notes;
the experiment never calls it. Tests use it solely to initialize throwaway fixtures.

The fixed snapshot is resolved from the module URL to the worktree's ignored
`.local/doom-memory.sqlite`, never the source worktree database. Missing storage,
failed integrity/schema checks, or `DOOM_MEMORY_DB` pointing elsewhere fail
closed; there is no database creation, copying, fallback, migration or journal-mode
change. The snapshot was already present, so no backup was needed for this task.
The existing lookup preserves its 100ms busy timeout and foreign-key setting.

`landmarks-tool.ts` loads the existing ignored
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
node --experimental-strip-types --test experiments/codex-acp-ai-sdk7/find-landmarks-acp-smoke.test.ts experiments/codex-acp-ai-sdk7/landmarks-tool-loop-agent.test.ts
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7
git diff --check
```

The isolated schema-derived fixtures prove lookup/ranking, namespace isolation,
empty results, read-only behavior, MCP schema/JSON round-trip, candidate selection
and rejection cases. The separate optional snapshot integration checks the real
saved pose, both historical note IDs, MCP evidence preservation, and unchanged
snapshot bytes, mtime and directory entries. It explicitly skips if the local
snapshot or saved capture files are missing. This is offline retrieval proof;
it does not prove ACP consumed or selected a historical landmark.

Only after separate explicit approval, the one optional metered ACP command is:

```sh
node --experimental-strip-types experiments/codex-acp-ai-sdk7/landmarks-tool-loop-agent.ts --authorize-acp 2>/dev/null
```

This command has **not been run as part of implementation**. Without the exact
flag (including on `--help`) no ACP process starts. It reuses the smoke runner's
host registration and two-entry SDK 6/7 tool-map reconstruction, GPT-6 Luna/xhigh,
read-only ACP mode, temporary empty cwd, one SDK request, at most two SDK steps,
one callback, no SDK retries and 120-second deadline. It does not read/change
credentials or fetch model packages. Callback receipts, SDK tool notifications,
selection validation, session continuity and public cleanup are reported as JSON
to stdout, with no report/transcript files. Existing smoke caveats about internal
tools, lazy-auth retry, generated MCP listener, subprocess exit, cancellation,
billing and cleanup still apply. Pending setup can outlive deadline reporting
and leave an empty temporary directory. No gameplay/agent MCP server is registered or
contacted, and no browser session is observed or advanced.
