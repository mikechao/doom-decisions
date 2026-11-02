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

`npm test` from this directory runs the same fake-only suite. It requires no
ignored real-Doom fixture, broker, browser, WAD, network or model inference.
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
