# Bounded Doom supervisor prototype

One active prototype: Codex through ACP and AI SDK 7 supplies high-level navigation
guidance; the existing browser Decisions API selects each low-level action.
The owner reports a completed live cycle in Trial 002 (details below). Another
trial requires fresh human approval; this document does not authorize an agent
to launch a browser/server, attach, or run inference. Milestone 1 adds an offline-proved,
explicitly gated two-decision path; no two-decision live result is claimed.

## Owner-reported live outcomes

Trial 001 executed `turn_right` with six verified tics, reaching cumulative tic 7.
It failed only at final advisory reassessment validation, after the verified action.
Trial 002 reported `outcome: completed`: two ACP checkpoints in the same observed
session ID, one verified Decisions action, an accepted advisory reassessment and
an exhausted limit of 1. These are owner-supplied live reports, not independent
verification by this cleanup; neither trial was rerun or its private evidence read.

Reassessment rejection diagnostics now distinguish JSON parsing, strict shape
validation and unsafe advisory text from checkpoint/session failures. Rejection
metadata includes only allowlisted types, bounded byte counts, expected-key
presence, unexpected-key counts and status/limit flags. It retains no raw model
text, arbitrary key names/values or parser errors, and does not relax validation.

## Human invocation, after separate approval

Use Node 22.20.0 and the already installed pinned packages: AI SDK 7.0.159,
ACP provider 0.3.9, codex-acp 2.5.0 (nested AI SDK 6.0.320). No installation,
upgrade, global configuration change, build, or authentication repair is included.
Existing Codex authentication/configuration is inherited; do not log it.
Nonempty `DEBUG` or `ACP_AI_PROVIDER_DEBUG` is rejected before attachment to avoid
the provider's debug/transcript logging.

For one-action mode the human configures **`AGENT_DECISION_BUDGET=1` in
`app/.env.agent.local`**, starts
`npm --prefix app run dev:agent`, manually opens exactly one visible page at
`http://127.0.0.1:5174/`, supplies the existing browser Decisions credentials as
needed, and waits for verified preparation. Keep **Stop Agent** visible and
available. Reuse that server; neither this program nor its tests open the browser
or prepare a game. The host never reads the private agent environment file or
takes ownership of Decisions credentials/provider selection.

From this experiment directory, the human may then run **once**, using a new ID:

```sh
node --experimental-strip-types supervisor.ts \
  --live --authorize-one-decision --trial NEW_ID 2>/dev/null
```

This can incur **two Codex supervisor calls plus one browser Decisions request**.

For a separately approved **two-decision** trial, the human sets
**`AGENT_DECISION_BUDGET=2`**, fully stops and restarts the dev:agent server (the
allowance is process-owned), prepares exactly one visible Agent Mode page, and
keeps **Stop Agent** available. Use a fresh trial ID and invoke once:

```sh
node --experimental-strip-types supervisor.ts \
  --live --authorize-two-decisions --trial NEW_ID 2>/dev/null
```

This admits at most **two Codex checkpoints and two Decisions invocations**. There
is no third final Codex call. The old one-decision flag always requires allowance 1
and cannot admit two actions; mismatched allowances fail after the nonrefundable
claim. Neither command above is authorization to run it.

The stderr redirect follows the existing experiment pattern: the provider forwards
arbitrary adapter stderr. Do not collect raw stderr or private transcripts.
With no arguments or `--help`, the command prints help and performs no I/O to
Doom/ACP. Partial/extra opt-in arguments fail closed.

## Boundary and sequence

`supervisor-workflow.ts` owns `supervise`, its injected port contracts, workflow
evidence/report ledger, checkpoint protocol, cancellation/deadlines and ACP cleanup.
`supervisor.ts` retains the gated CLI entry, `runLive`, port composition, trial files,
signals and report publication, and re-exports the existing workflow APIs for
compatibility. `supervise` requires injected ports; real I/O exists only behind
`supervisorMain`'s explicit gate. `supervisor-cli.ts` imports the existing `runAgentCli`
directly and reuses it in process; `supervisor-acp.ts` lazily initializes the provider
and AI SDK. The preserved **one-action** sequence is:

1. `attach`, then `observe`; validate the materialized DTO/lease/correlation,
   `run:null`, ready state, six tics, and a base template containing `{{tics}}`.
2. One ACP provider/model with `persistSession:true`, `INITIAL_AGENT_MODE=read-only`,
   a fresh empty cwd and `mcpServers:[]`; `connect`, `initSession`, then checkpoint 1.
3. Validate the existing five-field advisory proposal. Preserve the complete base
   template and flags; append only objective/question/uncertainty. Prepare a private
   instructions file. `start-run` must acknowledge **limit 1**, zero counters and
   the same session/revision/configuration; an incorrect allowance is not refunded.
4. CAS `set-prompt`, preserving other settings, followed by a **new standalone
   `observe`**. Require incremented revision, changed observation ID, unchanged
   native frame/state and the acknowledged run/configuration.
5. Exactly one scoped `decide`. No action field is supplied. Existing browser
   `agentNext` → `runOneDecision` → provider request → native verification remains
   authoritative. The host accepts only a correlated, fully verified completion
   at requested/reported/verified **6/6/6** for the healthy path.
6. Reuse the decision's resulting observation/PNG; no redundant capture. Read
   `get-config` once and require the original run/session, expected revision,
   `limit=reserved=sdkInvoked=1`, `remaining=0`, `active=false`.
7. Checkpoint 2 uses the **same ACP session ID**, original objective, before/after
   allowlisted state and the post-action PNG. Validate advisory
   `continue|revise|achieved|uncertain`, visual/telemetry evidence, uncertainty and
   required nullable `nextGuidance`. Continue/revise require bounded target/question;
   achieved/uncertain require null. In one-action mode this remains advisory.
   There is no second decision or retry path. Cleanup and report.

The fixed **two-decision** sequence changes only the feedback boundary:

1. Initial O0/r0 + PNG, checkpoint 1, proposal, one claim with limit 2.
2. Compose guidance #1 from O0 original template, CAS r0→r1, independent O1/r1.
3. Decision #1 must complete at requested/reported/verified 6/6/6.
4. Independent O2/r1 must match R1 session/map/native frame/state and unchanged
   configuration, with limit/reserved/sdkInvoked/remaining **2/1/1/1 active**.
5. Checkpoint 2 in the same ACP session uses ORIGINAL objective, actual before/after
   state and R1 PNG. Continue/revise require a defensible next observable objective
   and question. Uncertain means none can be offered; achieved/uncertain end early.
6. Compose guidance #2 from **O0 original template**, never the appended #1 template.
   Reject byte-identical composition. CAS using O2/r1→r2, then independent O3/r2
   proving unchanged native state and matching new configuration.
7. Decision #2 must complete at 6/6/6; final get-config must prove **2/2/2/0 inactive**.
   Report and cleanup, with no third checkpoint.

Both boundaries reject stale revisions, reused observations, conflicting state,
unsafe/malformed guidance, changed ACP session and model tool use without retry.
Guidance-bearing text conservatively rejects explicit action identifiers and
duration language. This can reject benign wording and cannot guarantee semantic
isolation of arbitrary natural language. Provider action selection and browser
duration authority are unchanged.

`live-observation.ts` reconstructs inline PNG only in memory through the existing
strict DTO parsers. It rereads/hashes the actual file bytes sent to ACP. PNG byte
hashes are distinct from native/Canvas RGBA hashes. The host trusts the existing
browser's verification; it does not independently execute/recertify native capture
or fully decode PNGs. Model input excludes paths, lease/session/correlation IDs,
instructions, frame hashes, WAD data, transcripts and arbitrary previous-action
text. Raw pose/probe values are not decoded map knowledge. Neither schema validity
nor `achieved` verifies navigation success; human visual review is still needed.

## Failure, Stop, accounting and cleanup

Limits are one `start-run` invocation, at most one or two distinct `decide`
operations according to the explicit mode, two `generateText` invocations
and one ACP session setup. AI SDK `maxRetries:0`; no host retries or fallbacks.
Connect/session waits are 45 seconds, each checkpoint 120 seconds, CLI operations
15 seconds (decision 35), and the workflow deadline eight minutes. The existing
broker can revoke sooner (10/30 seconds). SIGINT/SIGTERM abort host scheduling and
owned HTTP transfers. Timeouts and late results cannot resume the workflow.

**There is no CLI Stop.** On failure/unknown consumption use browser **Stop Agent**;
Ctrl+C/host exit is not lease revocation. Pending HTTP cancellation normally
revokes through the existing broker, but delivery/native consumption can remain
unknown. A dispatched action must finish its existing verification. The host makes
no further broker/model calls after known Stop or a terminal receipt. Terminal
prefix evidence is retained, with no normal-exhaustion accounting/reassessment.
A Stop occurring during ACP reasoning is learned only at a subsequent broker
operation; the host has no independent browser Stop subscription.

The report has a bounded `decisions` array (maximum two), with attempted commands
recorded before transport. Each entry separates validated receipt delivery, SDK
invocation, outcome, action, requested/reported/verified tics, cumulative tic,
completion uncertainty and usage. `verifiedActions` counts fully verified completed
actions only; terminal or uncertain prefixes stay in their entry. Missing evidence
is null, not zero. `decideCalls` is derived from the array. `interimAccounting`
and final `accounting` are separate; earlier counts never resolve a later lost
CAS/decision response. Guidance application states are bounded per write, without
full templates, paths or HTTP bodies. Reassessment is final advisory in one mode
and interim feedback in two mode; no final reassessment is requested in two mode.
Unavailable usage/cost stays unavailable; hooks do not measure remote billing.
Internal lazy-auth retry can still occur below AI SDK's retry setting.

Achieved/uncertain in two mode reports **partial**, never completed/exhausted.
Malformed, unsafe or unchanged guidance also cannot complete the trial. After
interim accounting, one allowance may remain **unreserved and active**. All such
paths set **humanStopRequired** and the entrypoint explicitly instructs browser
**Stop Agent**. A lost second CAS/decision reply reports uncertain even when
interim counts were valid. There is no replay or automatic revocation/rearm.

Read-only mode, empty MCP servers and absent SDK tools **do not isolate all internal
Codex tools/permissions**. Public cleanup requests direct-child termination and
clears the local session, without a descendant-exit receipt. It is not awaited
indefinitely; the standalone entry exits after reporting. Remote cancellation and
billing cessation are unverified.

Successful exhaustion leaves the acknowledged **lease-local guidance in effect**;
saved human preferences remain unchanged. `set-prompt` requires an active run, so
the exhausted run cannot safely restore it. No restoration/rearm is attempted.
After reviewing results, use browser Stop Agent to clear the lease-owned settings;
refresh creates a new game session and clears in-memory credentials. Failure after
a prompt write reports its last acknowledgment or unknown application state.

Each opt-in consumes a new ignored `.local/supervisor-<ID>/` directory exclusively
before attachment. Never remove/reuse it to retry. It contains a started marker,
fresh ACP cwd, private CLI lease/PNGs, numbered receipts with full instruction text
removed, and a bounded sanitized `report.json`. The CLI adapter owns only successfully
created temporary instructions files; the entrypoint invokes cleanup in `finally`
after reporting or failure, preserving cleanup on partial write failure. Hard
interruption may leave files. Runtime files are private local evidence,
**never commit/upload them**, especially DOOM1 captures.
Historical one-shot namespaces and evidence remain untouched. Another trial needs
fresh human approval and an independently configured browser allowance/process.

## Offline checks performed

From the repository root, using already installed local tools:

```sh
node --experimental-strip-types --test experiments/codex-acp-ai-sdk7/supervisor.test.ts
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7
```

Biome lint and non-writing format checks also cover `supervisor.ts`, `supervisor-cli.ts`,
`supervisor-acp.ts`, `supervisor-workflow.ts`,
`live-observation.ts`, `supervisor.test.ts`, and `doom-proposal.ts`. For formatting,
pass `--indent-style=space --indent-width=2 --javascript-formatter-quote-style=single
--line-width=120` without `--write` to match the existing style. `allowJs` enables
typing the existing imported `.mjs` transport without editing it.

**33 top-level offline tests** cover the complete healthy sequence, real CLI over
fake transport, stale checkpoint denial, wrong scope/revision/limit, Stop,
unsettled/late ACP results, cancellation after claim, lost mutating replies without
replay, corrupt/missing PNGs and strict DTOs, accounting, terminal precedence,
advisory reassessment/unknown usage, rejection diagnostics and redaction,
cleanup failure, compatibility exports, inert imports, and guarded standalone
default/help/malformed-argument exit paths.
The two-decision cases capture both SDK-serialized Request bodies with fake fetch,
through the real builder, OpenRouter provider and installed SDK 1.4.25. They assert
GUIDANCE_ONE_ALPHA then GUIDANCE_TWO_BETA, original-base preservation, resolved 6-tic
text, no retained first block, criteria/state/PNG and snake-case serialization.
Additional cases cover interim/native/CAS freshness, strict guidance, early exits,
unknown second mutations, exclusive file ownership/partial writes and both gates.
Existing app controller/provider tests cover bounded CAS/admission; no additional
controller companion or production app change was needed.
The fake controller is deliberately small; it is not live browser/WASM evidence.
Tests use temporary synthetic flat-color PNGs and fake model/provider responses;
no real broker, network, Codex, Decisions API, WAD, private capture or consumed
one-shot marker is needed. These checks do not independently verify the
owner-reported live outcomes or broader live correctness.
