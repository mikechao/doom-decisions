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
   `play(client, tools, provider)` and prints the returned result.
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
4. `perceiveScene()` receives only the owned PNG and `modelState(observation)`;
   it receives no objective or historical note. The compact state includes map
   slot, tic, phase, telemetry, facing probe and the previous action's action,
   tics and end tic. Perception is logged after it completes.
5. Only when a landmark is selected, `assessNavigation()` makes a second,
   text-only request comparing perception with that note's hypothesis, next
   question and observer pose. It receives no image or unselected notes.
   Free exploration skips assessment and retains `navigationAssessment: null`.
   Assessment failure stops playback; it does not fall back to free exploration.
6. `executeOneDecision()` synchronously calls `composeGuidance()` with the
   original observation's instruction template, selection, perception and
   optional assessment. It checks the composed prompt's size **before** calling
   the nonrefundable `startRun()`.
7. `startRun()` submits the original observation ID, session and revision.
   The broker chooses the budget; this helper requires `started.run.limit === 1`.
   It forms a session/run/revision scope, calls `setPrompt()` with the composed
   string for **both landmark and free-explore cases**, then adopts the
   acknowledged revision. No prompt file or `getPrompt()` call is used.
8. It calls `observe()` again for admission. Locally it requires a **different
   observation ID**, the **same session, map key and tic** as the original, and
   the **acknowledged revision**. It does not require full snapshot/frame/hash
   equality or reread this PNG for reasoning. Browser admission adds its own
   freshness/ownership checks.
9. It calls `decide()` exactly once with the fresh ID and scope, logs the receipt,
   and reports the executor-validated result. There is no final accounting call,
   resulting-PNG reread or second perception/decision. `main()` detaches in
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
| `modelState()` / `perceiveScene()` | Observation → compact state; provider plus image/state → `ScenePerception`: description, up to eight features, uncertainty and usage. Diagnostic scene text subsequently informs gameplay guidance. |
| `assessNavigation()` | Provider, perception and selected candidate → `NavigationAssessment`: verdict (`possible-match`, `no-visible-match`, `insufficient-evidence`), evidence, uncertainty and usage. Diagnostic comparison subsequently informs guidance. |
| `composeGuidance()` | Base template plus `DecisionGuidance` → bounded instruction string. Projects perception and, for a target, historical fields and assessment into untrusted advisory JSON; omits usage and full observations. |
| `executeOneDecision()` | Client, original observation and guidance → decision/result fields. Owns preflight, one-slot requirement, prompt CAS, cross-observation continuity and the single `decide()` call. |
| [`DoomClient`](src/doom-client.ts) | Owns the acknowledged lease and serializes operations by rejecting overlapping calls. Delegates protocol validation to the shared executor; makes no automatic retries. `play()` does not use its `getConfig()`, `getPrompt()` or `setConfig()` methods. |
| [`executeAgentOperation()`](../../scripts/doom-agent-client.ts) | Validates wire commands and page/epoch/command correlation, parses observations/settings/receipts, checks PNG bytes/hash, and materializes images. Checks setting session/run correlation, exact prompt echo and revision + 1; checks active start-run acknowledgment at the submitted revision and decision `beforeObservationId`. |
| [Browser controller](../../app/src/session-controller.ts) | `startAgentRun`, `agentPrompt`/`agentConfig`, and `agentNext` enforce lease/session/run ownership, one-shot claim, revision CAS, readiness, freshness and nonrefundable decision reservations. The existing gameplay pipeline owns Stop fences, native dispatch and receipt/frame verification. The experiment is not an independent native verifier. |

`PlayResult` combines the objective, memory status and returned candidate count,
perception/assessment (including usage), `promptChanged: true`, run ID and receipt
fields: outcome/reason/action, SDK invocation and completion uncertainty,
cumulative tics, and separate requested/reported/verified tics. A returned result
can describe declined admission, a terminal prefix or uncertainty; it is not
necessarily a completed action.

Both reasoning helpers use `DOOM_REASONING_MODEL ?? "gpt-6-luna"`, Responses,
strict structured-output schemas, `maxRetries: 0`, a 60-second abort signal,
`store: false` and `reasoningEffort: "xhigh"`. Both require finish reason `stop`.
Schema, transport or finish failures abort the flow. No reasoning tool selects
an action or mutates configuration.

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
perception and assessment, and `decisionMayHaveBeenSent`:

- **Before run admission:** `observation` (also PNG read), `landmarks`,
  `perception`, `navigation-assessment`, or `guidance` failures send no decision
  and never call `startRun()`.
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
[`doom-tools.test.ts`](tests/doom-tools.test.ts) covers lookup ordering, storage
statuses and malformed evidence; [`main.test.ts`](tests/main.test.ts) covers
attach/play/detach ordering and combined failures. These are offline fixtures,
not live navigation or native gameplay proof.
