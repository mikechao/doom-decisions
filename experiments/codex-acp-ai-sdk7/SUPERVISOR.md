# One-action Doom supervisor prototype

One active prototype: Codex through ACP and AI SDK 7 supplies high-level navigation
guidance; the existing browser Decisions API selects the single low-level action.
The owner reports a completed live cycle in Trial 002 (details below). Another
trial requires fresh human approval; this document does not authorize an agent
to launch a browser/server, attach, or run inference. The two-decision experiment
is on hold.

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

The human configures **`AGENT_DECISION_BUDGET=1` in `app/.env.agent.local`**, starts
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
The stderr redirect follows the existing experiment pattern: the provider forwards
arbitrary adapter stderr. Do not collect raw stderr or private transcripts.
With no arguments or `--help`, the command prints help and performs no I/O to
Doom/ACP. Partial/extra opt-in arguments fail closed.

## Boundary and sequence

`supervise` requires injected ports; real I/O exists only behind `supervisorMain`'s
explicit gate. `runLive` imports the existing `runAgentCli` directly. The sequence is:

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
   `continue|revise|achieved|uncertain`, visual/telemetry evidence and uncertainty.
   There is no second decision or retry path. Cleanup and report.

`live-observation.ts` reconstructs inline PNG only in memory through the existing
strict DTO parsers. It rereads/hashes the actual file bytes sent to ACP. PNG byte
hashes are distinct from native/Canvas RGBA hashes. The host trusts the existing
browser's verification; it does not independently execute/recertify native capture
or fully decode PNGs. Model input excludes paths, lease/session/correlation IDs,
instructions, frame hashes, WAD data, transcripts and arbitrary previous-action
text. Raw pose/probe values are not decoded map knowledge. Neither schema validity
nor `achieved` verifies navigation success; human visual review is still needed.

## Failure, Stop, accounting and cleanup

Limits are one `start-run` invocation, one `decide`, two `generateText` invocations
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

The report distinguishes host invocations, validated receipt delivery/domain
outcome, reported SDK invocation, independently verified action/tics, and the final
authoritative reservation counters. Missing receipts leave invocation/consumption
unknown; `verifiedActions:0` then means no accepted proof, not proof of zero action.
Retired/uncertain receipts retain any reported independently verified native prefix;
missing tic evidence and `accounting:null` are not zero. Unavailable usage/cost stays `unavailable`; ACP
provider-call hooks do not measure remote billing. Internal lazy-auth retry can
still occur below AI SDK's retry setting.

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
removed, and a bounded sanitized `report.json`. The temporary instructions file is
removed in `finally` when possible; hard interruption may leave it. Runtime files
are private local evidence, **never commit/upload them**, especially DOOM1 captures.
Historical one-shot namespaces and evidence remain untouched. Another trial needs
fresh human approval and an independently configured browser allowance/process.

## Offline checks performed

From the repository root, using already installed local tools:

```sh
node --experimental-strip-types --test experiments/codex-acp-ai-sdk7/supervisor.test.ts
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7
```

Biome lint and non-writing format checks also cover `supervisor.ts`,
`live-observation.ts`, `supervisor.test.ts`, and `doom-proposal.ts`. For formatting,
pass `--indent-style=space --indent-width=2 --javascript-formatter-quote-style=single
--line-width=120` without `--write` to match the existing style. `allowJs` enables
typing the existing imported `.mjs` transport without editing it.

**24 top-level tests passed**, covering the complete healthy sequence, real CLI over
fake transport, stale checkpoint denial, wrong scope/revision/limit, Stop,
unsettled/late ACP results, cancellation after claim, lost mutating replies without
replay, corrupt/missing PNGs and strict DTOs, accounting, terminal precedence,
advisory reassessment/unknown usage, rejection diagnostics and redaction,
cleanup failure, and the inert default/import.
The fake controller is deliberately small; it is not live browser/WASM evidence.
Tests use temporary synthetic flat-color PNGs and fake model/provider responses;
no real broker, network, Codex, Decisions API, WAD, private capture or consumed
one-shot marker is needed. These checks do not independently verify the
owner-reported live outcomes or broader live correctness.
