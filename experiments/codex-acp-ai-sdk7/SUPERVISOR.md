# Bounded Doom supervisor prototype

Codex through ACP and AI SDK 7 supplies advisory high-level navigation guidance;
the browser Decisions API selects each low-level action. One numeric loop handles
explicitly authorized N decisions. N=3 and N=5 are offline regression cases, not
separate modes. A live trial always requires fresh human approval; this document
does not authorize browser/server launch, attachment or inference.

## Evidence baseline

The owner reported Trial 001 executing `turn_right` for six verified tics to
cumulative tic 7, followed by a final advisory validation failure. Trial 002
completed the historical one-action flow: two ACP checkpoints in the same observed
session, one verified Decisions action, accepted advisory reassessment and exhausted
limit 1. The owner also reports a live two-decision same-ACP-session reassessment
cycle in the implementation task context. These are owner-supplied reports;
private trial evidence was not read or rerun for this change.

The generalized loop is verified offline with synthetic N=1,2,3,5 cases. This is
not generalized-N live browser, WASM, ACP or Decisions evidence. The historical
34-supervisor/107-focused-test results predate this change and do not validate it.

## Human invocation, after separate approval

Use Node 22.20.0 and existing pinned packages: AI SDK 7.0.159, ACP provider 0.3.9,
codex-acp 2.5.0 (nested AI SDK 6.0.320). No installation, upgrade, authentication
repair or global configuration change is included. Existing Codex authentication
is inherited; nonempty `DEBUG` or `ACP_AI_PROVIDER_DEBUG` fails before attachment
to avoid provider transcript/debug logging.

For a separately approved trial the human configures `AGENT_DECISION_BUDGET=N` in
`app/.env.agent.local` and fully stops/relaunches `npm --prefix app run dev:agent`:
the allowance is process-owned. The human manually opens exactly one visible
Agent Mode page at `http://127.0.0.1:5174/`, provides browser credentials as needed,
waits for verified preparation, and keeps **Stop Agent** available. Reuse that
server. The supervisor never reads the private agent env file, opens the browser,
prepares a game or owns Decisions credentials/provider selection.

From this experiment directory, invoke once with a new trial ID:

```sh
node --experimental-strip-types supervisor.ts \
  --live --authorize-decisions N --trial NEW_ID 2>/dev/null
```

N must be a positive decimal JavaScript safe integer. Zero, signs, fractions,
exponents, overflow, missing arguments and mixed authorizations fail closed.
`--authorize-one-decision` and `--authorize-two-decisions` remain aliases for N=1
and N=2; there is no three-decision flag or default live execution. No arguments
or `--help` performs no Doom/ACP I/O. Stderr suppression follows the existing
experiment pattern because the provider forwards arbitrary adapter stderr.

Healthy completion uses **N ACP turns and N browser Decisions invocations** in
one persistent ACP session. **N=1 now has one initial proposal and one decision,
with no final advisory-only reassessment.** This intentionally changes the
historical one-decision behavior, including through its legacy flag.

Preclaim `observe`/`get-config` expose `run:null`, not the numeric allowance.
`start-run` claims the entire configured allowance atomically and nonrefundably;
it accepts no requested limit. Immediately after validating its acknowledgement,
the supervisor records actual `claimAccounting`, then requires **claimed limit=N**.
Both smaller and larger allowances produce `ALLOWANCE_MISMATCH`, an acknowledged
claim and failed outcome before any prompt CAS or decision. Initial ACP inference
has already occurred and can incur charges. No clamp, refund, second claim or
retry follows; use browser Stop Agent. Preclaim mismatch rejection would require
a protocol change and is not provided here. A live N>2 trial separately requires
human approval for configuration/restart, gameplay and metered calls.

## Boundary and sequence

`supervisor-workflow.ts` owns the loop, injected typed ports, evidence ledger,
checkpoint/session checks, deadlines and ACP cleanup. `supervisor.ts` owns the
gated live entry, version admission, trial files, signals, composition and report.
`supervisor-cli.ts` implements attach/observe/startRun/setPrompt/decide/getConfig
through the shared checked `scripts/doom-agent-client.ts` executor. No argument-array
port, new RPC operation or controller/bridge/provider change is introduced.
`supervisor-acp.ts` retains lazy startup, GPT-6 Luna, xhigh, read-only ACP,
`persistSession:true`, empty MCP servers and AI SDK `maxRetries:0`.

1. Attach and independently observe. Validate lease/correlation, PNG bytes,
   `run:null`, ready state, six tics and the original template's `{{tics}}`.
2. Create/connect/init exactly one ACP session. The initial proposal uses the
   initial image and allowlisted state; validate the existing advisory schema.
3. Iterate at most N times. First guidance uses that proposal; later guidance
   uses a validated reassessment of the preceding decision's receipt image and
   its preceding **BEFORE/AFTER** state. Retain the original objective throughout.
4. Compose each replacement from the **original template**, never the prior
   appended guidance. Reject identical consecutive guidance. Write a distinct
   exclusive 0600 instruction file. Only on the first iteration, claim the run
   after complete guidance exists and enforce the exact-match rule above.
5. Apply scoped prompt CAS. Independently observe the incremented revision,
   unchanged native state, fresh unique observation ID, exact configuration and
   expected run/reserved/SDK/remaining counters.
6. Issue exactly one scoped `decide`, without an action or duration override.
   Validate correlation, receipt, returned PNG and fully verified healthy
   requested/reported/verified **6/6/6** completion. Browser admission and native
   verification remain authoritative.
7. If verified actions equal N, read final `get-config` and require the original
   session/run, current revision/configuration and **N/N/N/0 inactive** accounting.
   Exit without an interim observation or another ACP turn.
8. Otherwise perform the existing interim independent observation: match the
   receipt's native frame/state and unchanged revision/configuration; require
   limit N, reserved=SDK=completed, remaining=N-completed and active=true. Then
   reassess in the same ACP session on the next iteration. Continue/revise require
   defensible `nextGuidance`; achieved/uncertain require null and stop early.

The interim image is not substituted for the decision receipt's visual evidence.
The receipt already supplies the next ACP image; the interim observation checks
current run/configuration/native continuity, and the post-CAS observation remains
mandatory. No additional image round-trip is added just to feed ACP.

All standalone and receipt observation IDs are checked for reuse; decide IDs are
reserved before dispatch. Guidance validation rejects explicit action/duration
language, unsafe references, malformed schemas, session changes and model tool
calls. These conservative text guards can reject benign wording and do not
provide semantic isolation. Valid advice or `achieved` never proves navigation
success.

`live-observation.ts` rereads/hashes the actual PNG bytes supplied to ACP and
reuses strict DTO parsers. PNG byte hashes differ from native/Canvas RGBA hashes;
the host trusts the browser's native/Canvas proof and does not independently
recertify capture or fully decode PNGs. ACP input excludes paths, lease/session
IDs, instructions, frame hashes, WAD data and arbitrary previous-action text.

## Failure, Stop, accounting and cleanup

Limits are one run-claim attempt, at most N decide attempts, at most N ACP turns
and one ACP session setup. There are no host retries/fallbacks. Existing operation
bounds remain: connect/session 45 seconds, ACP turn 120 seconds, Doom operations
15 seconds (decide 35), overall workflow eight minutes. The broker can revoke
sooner (10/30 seconds). Large N can hit the unchanged deadline before exhaustion;
N authorizes a maximum, not guaranteed completion.

SIGINT/SIGTERM abort scheduling and owned HTTP transfers. Late results cannot
resume the loop. Known Stop, terminal, noncompleted/partial receipts, bad/stale
evidence, CAS rejection, cancellation/deadline or invalid advice prevent dependent
iterations. Terminal/uncertain native prefixes stay in their receipt ledger entry
without becoming completed actions. A Stop during ACP reasoning is learned at a
subsequent bridge operation: the host has no Stop subscription, and an in-flight
advisory may finish. Existing bridge/controller fences still own admission and
native dispatch.

There is no CLI Stop. Host exit/Ctrl+C does not revoke the lease or prove remote
cancellation. Use browser **Stop Agent** after failure or unused authorization;
a dispatched action must drain its existing verification. Early achieved/uncertain
reports `partial`, retains active unused authority and requires human Stop. No
replay, automatic revocation, restoration or rearm is attempted.

The report replaces string `mode` with numeric `requestedDecisions`.
`claimAccounting` records validated initial allowance/counters even on mismatch;
`interimAccounting` is the latest validated continuation checkpoint; `accounting`
is final exhausted-run evidence only. Earlier counts cannot resolve a later lost
mutation. `reassessment` retains the latest validated advisory; rejection diagnostics
contain only allowlisted bounded metadata, never raw output or parser errors.
`sameACPSession` indicates checked continuity across ACP turns; it is false for
N=1 because no second turn occurs, not because another session was created.

Mutation attempts are recorded inside the scheduling/deadline fence before typed
port dispatch. Thrown, timed-out or lost dispatches retain unknown delivery until
validated acknowledgement/receipt and are never retried. `decisions` is bounded
by N; `decideCalls` derives from it. Each entry distinguishes delivery, SDK
invocation, outcome, action, requested/reported/verified tics, cumulative tic,
completion uncertainty and usage. `verifiedActions` counts healthy completed
actions only. Missing receipt data stays null; unavailable usage/cost stays
unavailable, not zero. AI SDK zero retries does not prevent the ACP provider's
internal lazy-auth retry behavior.

Successful exhaustion retains lease-local guidance: inactive runs cannot restore
it through prompt CAS. Human preferences remain unchanged. Browser Stop clears
lease settings; refresh creates a new game session and clears in-memory credentials.
Read-only ACP and empty MCP servers do not fully isolate internal Codex tools.
Public ACP cleanup clears its session and requests child termination without a
descendant-exit receipt or proof of remote cancellation/billing cessation.

Each opt-in exclusively creates a new ignored `.local/supervisor-ID/` namespace
before attachment; never remove/reuse one to retry. Private runtime lease/PNGs,
numbered receipts and sanitized report are not for upload/commit. Instruction-file
capacity equals authorized N. Ownership is registered after exclusive creation
and before writing, so cleanup handles partial writes without deleting preexisting
files after EEXIST. The entrypoint cleans owned instructions in `finally` after
report publication/failure; hard interruption may leave them. Historical private
artifacts remain untouched.

## Offline verification

From the repository root with installed tools:

```sh
node --experimental-strip-types --test experiments/codex-acp-ai-sdk7/supervisor.test.ts
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7
npm --prefix app test -- tests/agent-bridge.test.ts tests/agent-mcp.test.ts tests/agent-decision.test.ts
```

The supervisor suite has **40 top-level tests**, including parameterized healthy
N=1,2,3,5, exact-match failures, authorization aliases/denials, third-iteration
Stop/terminal/partial/advice/evidence/CAS failures, lost/thrown/timed-out mutations,
and instruction capacity/ownership/cleanup beyond two files. Distinct synthetic
step images/state/guidance prove preceding receipt evidence, replacement rather
than accumulation, fresh IDs/revisions and exact counts with no post-bound ACP.
Every fixture captures actual pinned OpenRouter SDK Request serialization through
fake fetch; the broker/controller/native and ACP are fake. Existing diagnostic,
redaction, cancellation/deadline, inert import and default/help guards remain.

Focused Biome lint and non-writing format checks use space indentation, width 2,
single quotes and line width 120. Tests use synthetic PNGs, fake responses and
temporary directories, without network, WAD, browser or real inference. These
checks do not independently verify owner-reported live outcomes or generalized-N
live correctness.
