# DoomPlayAgent execution flow

This is the implementation baseline for [`play()`](src/doom-play-agent.ts):
one authorized Doom decision per call, with at most one `decide()` invocation.
A declined admission or earlier failure can produce no gameplay. Doom runs in
the browser; TypeScript orchestrates observation, historical navigation evidence,
reasoning and admission. Responses reasoning models perceive/assess evidence;
the browser's Decisions API selects the low-level action. This document describes
code behavior, not evidence of navigation improvement or landmark arrival.

## Execution order

1. [`main()`](src/main.ts) rejects arguments, constructs the client, host-only
   memory tools and OAuth-backed OpenAI provider, then attaches once. The provider
   uses `openaiCredentials().getSession()` through
   [`createOAuthProvider()`](src/provider.ts). After acknowledged attach it awaits
   a broker-budget preflight before calling `play(client, tools, provider)`. The
   current CLI proceeds only when the configured budget is exactly 1 and the broker
   reported it unclaimed at attach. This is an informational snapshot, not a run
   claim; an acknowledged attach is still detached in `finally` if preflight fails.
   It then prints its compact summary, excluding the programmatic `record` and its
   image Buffers.
2. `play()` calls `observe()`, then reads the executor-materialized `pngPath`
   into an owned Buffer. The shared executor has parsed the observation and
   checked PNG header/hash before materializing it; `play()` does not revalidate
   the file at read time. Later file changes cannot alter the Buffer sent to inference.
3. [`findActiveLandmarks()`](src/doom-tools.ts) performs a host-selected,
   map-wide `active-landmarks` query using the verified `mapIdentity.mapKey`,
   limit 3, without a pose/radius restriction. Existing storage is opened
   read-only. It validates bounded candidate evidence, matching namespaces and
   unique note IDs. `selectNavigationObjective()` chooses the first candidate in
   shared creation-time/ID order, without ranking distance or usefulness.
   It logs lookup status/count, the selected note's hashed label/revision and
   JSON-quoted `hypothesis`/`nextQuestion`, or the free-explore objective.
4. `play()` projects the verified observation through `modelState()` in
   [`doom-play-agent.ts`](src/doom-play-agent.ts), then calls
   [`perceiveScene()`](src/scene-perception.ts) with only the owned PNG and that
   compact state; perception receives no objective or historical note. The
   compact state includes map slot, tic, phase, telemetry, facing probe and the
   previous action's action, tics and end tic. Perception is logged after it
   completes. The scene module owns its strict output schema, input/result types
   and Responses request.
5. Only when a landmark is selected, [`assessNavigation()`](src/navigation-assessment.ts)
   makes a second, text-only request comparing perception with that note's
   hypothesis, next question and observer pose. It receives no image or
   unselected notes. The assessment module owns this request, its strict schema
   and result type; `play()` decides whether to call it.
   Free exploration skips assessment and retains `navigationAssessment: null`.
   Assessment failure stops playback; it does not fall back to free exploration.
6. `executeOneDecision()` synchronously calls `composeGuidance()` with the
   original observation's instruction template, selection, perception and
   optional assessment. It checks the composed prompt's size **before** calling
   the nonrefundable `startRun()`.
7. `startRun()` submits the original observation ID, session and revision.
   The broker chooses the budget; this helper requires `started.run.limit === 1`.
   The attach snapshot does not replace this nonrefundable broker claim or its
   actual-run-limit check; the snapshot may become stale after attach.
   It forms a session/run/revision scope, calls `setPrompt()` with the composed
   string for **both landmark and free-explore cases**, then adopts the
   acknowledged revision. No prompt file or `getPrompt()` call is used.
8. It calls `observe()` again for admission. Locally it requires a **different
   observation ID**, the **same session, map key and tic** as the original, and
   the **acknowledged revision**. It does not require full snapshot/frame/hash
   equality or reread this PNG for reasoning. Browser admission adds its own
   freshness/ownership checks.
9. It calls `decide()` exactly once with the fresh ID and scope, retains the full
   executor-validated receipt, and, only when a resulting observation exists,
   reads its materialized PNG once. It checks these newly read bytes against the
   resulting observation's `pngSha256` before retaining the Buffer. A read or
   digest failure is recorded separately and leaves the returned receipt intact.
   It logs/reports the receipt outcome. There is no final accounting call or
   second perception/decision. `main()` detaches in
   `finally` after playback settles, including on failure, if attach was acknowledged.

`findActiveLandmarks()` distinguishes `found`, `empty`, `unavailable` (missing
storage), and `lookup_failed` (storage/lookup throws). The latter three return no
candidates and allow perception-informed free exploration. Malformed returned
evidence throws instead and stops at `landmarks` before inference or admission.
`hasMore` is diagnostic; selection still uses only the first returned candidate.

## Helpers, data and ownership

| Owner / helper | Inputs, outputs and effect |
| --- | --- |
| `selectNavigationObjective()` | Memory result → `NavigationSelection`: a `NavigationObjective` (`free-explore` or landmark note ID/revision) plus the full selected `target` or null. Host selection affects guidance, not the action directly. |
| [`modelState()`](src/doom-play-agent.ts) | Verified observation → compact perception state. It stays in the orchestrator and is called before the perception request. |
| [`perceiveScene()` and perception types/schema](src/scene-perception.ts) | Provider plus image/state → `ScenePerception`: description, up to eight features, uncertainty and usage. Diagnostic scene text subsequently informs gameplay guidance. |
| [`assessNavigation()` and `NavigationAssessment`](src/navigation-assessment.ts) | Provider, `ScenePerception` and selected `DoomMemoryCandidate` → verdict (`possible-match`, `no-visible-match`, `insufficient-evidence`), evidence, uncertainty and usage. Owns its text-only request and private strict schema; the diagnostic comparison subsequently informs guidance. |
| `composeGuidance()` | Base template plus `DecisionGuidance` → bounded instruction string. Projects perception and, for a target, historical fields and assessment into untrusted advisory JSON; omits usage and full observations. |
| `executeOneDecision()` | Client, original observation and guidance → decision/result fields. Owns preflight, one-slot requirement, prompt CAS, cross-observation continuity and the single `decide()` call. |
| [`DoomClient`](src/doom-client.ts) | Owns the acknowledged lease and serializes operations by rejecting overlapping calls. `attach()` returns broker-reported configured budget and unclaimed-at-attach metadata separately from identity; neither is persisted to `lease.json` or authorizes gameplay. Missing metadata is an unconfirmed attach, not a zero/false report. Delegates protocol validation to the shared executor; makes no automatic retries. `play()` does not use its `getConfig()`, `getPrompt()` or `setConfig()` methods. |
| [`executeAgentOperation()`](../../scripts/doom-agent-client.ts) | Validates wire commands and page/epoch/command correlation, parses observations/settings/receipts, checks PNG bytes/hash, and materializes images. Checks setting session/run correlation, exact prompt echo and revision + 1; checks active start-run acknowledgment at the submitted revision and decision `beforeObservationId`. |
| [Browser controller](../../app/src/session-controller.ts) | `startAgentRun`, `agentPrompt`/`agentConfig`, and `agentNext` enforce lease/session/run ownership, one-shot claim, revision CAS, readiness, freshness and nonrefundable decision reservations. The existing gameplay pipeline owns Stop fences, native dispatch and receipt/frame verification. The experiment is not an independent native verifier. |

`PlayResult` combines the objective, memory status and returned candidate count,
perception/assessment (including usage), `promptChanged: true`, run ID and receipt
fields: outcome/reason/action, SDK invocation and completion uncertainty,
cumulative tics, and separate requested/reported/verified tics. A returned result
can describe declined admission, a terminal prefix or uncertainty; it is not
necessarily a completed action.

## Passive decision record

`PlayResult.record` exposes a `DecisionRecord`; failures produced by `play()`
expose the collected partial record as `PlaybackError.record`. The constructor
still permits a null record for errors constructed outside `play()`. `main()`
returns the programmatic result after detach, but excludes the record from normal
CLI output. Its error output continues to use bounded existing diagnostics.

The record contains ordinal **1**, the reasoning observation and its owned
`beforePng`, bounded landmark lookup and selected objective/target evidence,
perception and optional assessment with usage, composed guidance, start-run and
prompt acknowledgments, and the distinct admission observation. Stage values are
null until available; an admission observation is recorded even when the local
continuity check rejects it. Identity, revision and accounting remain in the
existing DTOs; no new lease parameter, counters or authorization are introduced.

`decision` distinguishes:

- `not-called`: no `decide()` invocation; earlier evidence and a bounded
  `failure` stage/message survive.
- `unconfirmed`: the submitted input/scope is retained, but no trustworthy receipt
  returned. No receipt or resulting image is fabricated and no retry occurs.
- `returned`: the exact submitted input, complete receipt, nullable owned
  `afterPng`, and a separate nullable `imageRetentionFailure` (`read-failed` or
  `digest-mismatch`). This means a receipt returned, not that gameplay completed.
  Terminal prefixes, retirement, declined admission, API failure and Stop retain
  their original receipt semantics. No resulting observation means no after-image
  and no retention failure. An image-retention failure leaves `record.failure`
  null and does not change the receipt outcome or reject otherwise returned play.

Collection is passive: control flow, guidance and model inputs never read from
the record. Guidance is an execution snapshot, not a canonical base for a later
decision. No after-image is sent to a reasoning model.

Each plain DTO is detached with `structuredClone` when its stage returns, before
later asynchronous work or publication. This isolates history from client/tool
aliases and mutable legacy result/error diagnostics. The initial PNG is the
**same Buffer already sent to perception**, without another read, copy or hash.
The resulting image has one read plus SHA-256 comparison; mismatching bytes are
not retained as trusted image evidence. The top-level record is frozen when
published. `Readonly` and that freeze are shallow: callers must treat nested DTOs
and Buffers as immutable. There is no deep-freeze or defensive Buffer-copy layer.

All `pngPath` values remain ephemeral source-path provenance. The shared executor
creates PNGs in a temporary lease directory and does not intentionally delete
them on detach; this is not a lifetime guarantee. Owned bytes survive subsequent
source-file changes/deletion and detach. Initial bytes are not revalidated at read
time, so the pre-existing materialization-to-read gap remains. If executor
materialization itself throws before `decide()` returns, the attempt remains
unconfirmed at this boundary. Records do not supply independent native proofs,
updated post-decision run accounting, persistence, deduplication or an archive;
callers retain the image memory for as long as they retain the record. Raw error
causes remain on `PlaybackError`, outside the bounded record diagnostic.

Both reasoning helpers use `DOOM_REASONING_MODEL ?? "gpt-6-luna"`, Responses,
strict structured-output schemas, `maxRetries: 0`, a 60-second abort signal,
`store: false` and `reasoningEffort: "xhigh"`. The perception request and its
schema are owned by [`scene-perception.ts`](src/scene-perception.ts); navigation
assessment request, schema and result type are owned by
[`navigation-assessment.ts`](src/navigation-assessment.ts). Both require finish
reason `stop`. Schema, transport or finish failures abort the flow. No reasoning
tool selects an action or mutates configuration.

## Navigation and prompt lifecycle

Historical `hypothesis`, `nextQuestion` and anchor are unverified advisory data.
The anchor is the observer's raw pose (signed 16.16 XY and unsigned 32-bit angle),
not a verified destination. `possible-match` does not verify identity or arrival;
`no-visible-match` does not establish a wrong location or unreachability.
All three assessment verdicts can proceed to the same decision handoff.

`composeGuidance()` preserves the base template and appends the objective and
advisory JSON. It prioritizes base survival rules/controller authorization and
the current verified screenshot/state over historical and model text. Reasoning
output **informs guidance**; Decisions chooses the action, while the controller
owns duration/authorization. Free exploration also gets the perception amendment.

The canonical base comes from the **original observation**, never from a prior
amendment in this transaction. This relies on a fresh, unmodified lease:
`attachAgent()` copies the human instruction template into lease configuration;
`agentPrompt()` changes that lease configuration; `stopAgent()` discards the
lease. A direct caller of `play()` must uphold this assumption: the observation
has only the current template, no separate canonical-base field.

The local preflight checks JavaScript string `.length <= maxAgentInstructions`
(16,000); oversize prompts fail without truncation before claiming a run.
The shared [prompt validation](../../app/src/agent-control.ts) also requires a
nonblank string, and the controller validates the resulting configuration.
Prompt mutation uses session/run/revision compare-and-swap; the executor checks
the exact acknowledged text and revision increment. Run claiming establishes
authorization, and prompt CAS invalidates prior observation admission, hence
the fresh observation before `decide()`. No prompt restoration occurs here.
“Next decision” wording has no automatic expiry within a lease.

Run issuance and decision admission are separate: `agentNext()` reserves a slot
on valid admission without refund, even if SDK creation later fails. The receipt's
`sdkInvoked` records whether an SDK call actually started. `play()` neither
replenishes the budget nor changes lease-owned tics.

## Failure boundaries and current limits

`PlaybackError` carries `stage`, original `cause`, the available objective,
perception and assessment, `decisionMayHaveBeenSent`, and the partial record:

- **Before run admission:** `observation` (also PNG read), `landmarks`,
  `perception`, `navigation-assessment`, or `guidance` failures send no decision
  and never call `startRun()`.
- **Attach preflight:** `main()` stops before `play()` when the broker reports no
  configured budget, a non-unclaimed snapshot, or a limit other than 1. The
  snapshot is advisory; `startRun()` remains authoritative for any run that
  proceeds, and can still fail if the broker state changes after attach.
- **Claim/admitted run before decision:** `start-run` (including wrong budget),
  `prompt-cas`, or `dispatch-observation` failure sends no decision. A lost claim
  or prompt acknowledgment can still leave that mutation applied. The claim
  cannot be refunded/replayed; no replacement run is attempted.
- **Decision call:** the flag becomes true immediately before invoking
  `decide()`. Any thrown error is conservatively unconfirmed, even if the client
  text says it failed before transport dispatch. `play()` does not parse that
  text to infer certainty. A returned receipt instead supplies its explicit
  `completionUncertain` and outcome. Neither path triggers a retry.

`main()` preserves playback and detach failures together in an `AggregateError`,
or throws the single failure. Failed/unconfirmed attach does not call detach
without an acknowledged lease. The CLI prints bounded host errors and available
diagnostics rather than raw model/transport exceptions; original causes remain
accessible programmatically. Detach failure closes the client without a retry.

There is one decision, with objective selection anew on each `play()` call.
There is no objective-completion detection, automatic memory transition, memory
write, persisted in-loop objective, second action slot or general multi-decision
prompt lifecycle. No post-decision image is sent to a reasoning model.

**Future work note:** A two-decision loop is outside this baseline; this document
does not specify its behavior or architecture.

## Focused source checks

[`doom-play-agent.test.ts`](tests/doom-play-agent.test.ts) covers call order,
objective-independent perception, free-explore amendments, all assessment
verdicts, failed assessment, oversize preflight, lost acknowledgments, continuity
mismatches and terminal/uncertain receipt reporting.
It also covers stage snapshots and alias isolation, exact before-image ownership,
result-image retention/digest failure, and honest absent/unconfirmed evidence.
[`doom-tools.test.ts`](tests/doom-tools.test.ts) covers lookup ordering, storage
statuses and malformed evidence; [`main.test.ts`](tests/main.test.ts) covers
attach/play/detach ordering, combined failures, retained bytes after source cleanup
and exclusion of records from CLI output. These are offline fixtures,
not live navigation or native gameplay proof.
