# DoomPlayAgent execution flow

This is the implementation baseline for [`play()`](src/doom-play-agent.ts):
**at most two consecutive informed decisions in one broker-authorized two-slot
run**, with no retry or replacement run. Early failure or declined admission can
produce fewer decisions or no gameplay. Doom runs in the browser. Responses
reasoning models perceive/assess scenes; the browser's Decisions API selects the
low-level action. This describes implementation, not live gameplay proof or
navigation improvement.

## Execution order

1. Zero-argument exported [`main()`](src/main.ts) constructs the client, host-only
   memory tools and OAuth-backed provider, then attaches once. The provider uses
   `openaiCredentials().getSession()` through `createOAuthProvider()`. Attach
   preflight requires `configuredDecisionBudget === 2` and
   `budgetUnclaimedAtAttach === true`. These are advisory snapshots, not a claim.
   An acknowledged attach is detached in `finally`, even if preflight fails.
2. `play()` observes once and captures the canonical base instructions immediately
   from that clean lease. It snapshots the reasoning observation and reads its
   materialized PNG once into an owned Buffer. The shared executor checks PNG
   header/hash before materialization; this reasoning read does not revalidate
   the file. Later file changes cannot change the owned inference bytes.
3. `findActiveLandmarks()` makes one map-wide `active-landmarks` lookup using the
   verified map key, limit 3, without pose/radius restriction. Existing storage is
   read-only. Bounded candidates must match the namespace and have unique IDs.
   `selectNavigationObjective()` chooses the first candidate in shared
   creation-time/ID order, or free exploration. This selection and its full target
   remain the same for both decisions. There is no ranking, re-selection or write.
   Lookup status/count, hashed note label/revision and JSON-quoted historical
   hypothesis/next question are logged once.
4. `prepareDecision()` calls `perceiveScene()` with this decision's own owned PNG
   and `modelState()` projection. Perception receives no objective or historical
   note. Compact state includes map slot, tic, phase, telemetry, facing probe and
   previous action's action/tics/end tic. For a selected landmark only,
   `assessNavigation()` compares this fresh perception with the same selected
   target, text-only. Assessment failure stops; there is no fallback assessment.
5. Preparation composes bounded guidance from the **original canonical base**,
   selection, current perception and optional assessment. Free exploration also
   receives scene guidance. First guidance is size-checked before any run claim.
6. `play()` calls `startRun()` exactly once, submitting decision #1's initial
   observation/session/revision. The executor checks claim correlation. Local
   checks require matching session/revision and an active run with limit **2**,
   reserved/SDK counts **0/0**, remaining **2**. The broker owns issuance and
   chooses the limit; the attach hint never replaces this nonrefundable claim.
7. `executeOneDecision()` performs prompt CAS with live session/run/revision scope,
   records the acknowledgment and adopts its revision. It then observes again
   for admission, requiring a distinct observation ID, ready phase, matching
   reasoning session/map/tic, acknowledged revision and expected active run
   accounting. It does not reread the admission PNG. Browser admission is final
   authority and can still reject a later change.
8. The helper calls `decide()` exactly once, records submitted input and the exact
   executor-validated receipt, and retains a resulting PNG when present. That
   image gets one read plus SHA-256 comparison. Retention failure stays separate
   from the receipt and never triggers replay. Record #1 is frozen/published.
9. Only a completed, certain first receipt with SDK invocation, selected action,
   null reason and a ready verified ending observation permits second preparation.
   Other returned outcomes are reported directly with one record and
   `decisionOrdinal: 1`. The executor/parser/controller own receipt consistency
   and native verification; this experiment does not recreate a native verifier.
10. Before another operation, `play()` creates partial record #2 with the same
    selection. A new standalone `observe()` supplies both the second reasoning
    image metadata and current configuration/run accounting. It must have a new
    ID and the same session/map key/tic as receipt #1's verified **ending**
    observation, ready phase and carried revision. Run ID must match the issued
    run, active, limit **2**, reserved **1**, SDK-invoked **1**, remaining **1**.
    This is an authoritative snapshot check, not a local budget ledger.
11. Read the second reasoning PNG once, repeat preparation with fresh perception
    and optional assessment of the same target, and compose from the original
    base. Repeat the CAS/admission/one-decision helper. Its admission observation
    rechecks checkpoint/revision and the same **1/1/1** remaining-slot accounting.
    There is no third decision, post-second inference or final accounting call.
12. `main()` prints the compact last-decision summary, excluding **all records
    and Buffers**, and detaches after playback settles. Playback and detach errors
    remain separate members of `AggregateError` when both fail.

`findActiveLandmarks()` distinguishes `found`, `empty`, `unavailable` (missing
storage), and `lookup_failed`. The latter three allow perception-informed free
exploration. Malformed evidence instead stops at `landmarks` before inference.
`hasMore` remains diagnostic; it never changes selection.

## Helpers, data and ownership

| Owner | Responsibility |
| --- | --- |
| `play()` | Once-only observation/base capture, lookup/selection and claim; explicit conditional second slot; live scope/receipt continuity; ordered record publication and final summary. |
| `prepareDecision()` | Per-decision perception, optional assessment, canonical-base composition and size preflight; stage-specific reasoning failures. |
| `executeOneDecision()` | Prompt CAS, fresh admission observation/checks, one `decide()`, result-image retention. It never claims a run. |
| `checkCheckpoint()` / `checkRun()` | Cross-operation simulation checkpoint and exposed scope/accounting checks. No native stepping or independent receipt verifier. |
| `newRecord()` | Nullable passive evidence initializer for ordinal 1 or 2. |
| `modelState()` / `composeGuidance()` | Compact current state and bounded advisory projections; no previous records or unselected notes enter reasoning/guidance. |
| [`DoomClient`](src/doom-client.ts) | Acknowledged lease lifecycle, serialized operations, no retries. `play()` does not use `getConfig()`, `getPrompt()` or `setConfig()`. |
| [Shared executor](../../scripts/doom-agent-client.ts) | Wire validation; held-lease page/epoch/command correlation; strict observation/settings/receipt parsing; PNG validation/materialization; settings session/run correlation, exact prompt echo/revision increment, active start acknowledgment and decision `beforeObservationId`. |
| [Browser/controller](../../app/src/session-controller.ts) | Lease/session/run ownership, one-shot issuance, CAS, readiness, nonrefundable reservations, SDK reader cleanup, Stop fences, native dispatch and resulting-frame verification. Shared code is unchanged. |

Standalone observations expose revision/configuration/run accounting. Decision
receipts expose a base ending observation, **not updated run accounting or
revision**. The fresh second reasoning observation obtains that missing state
without an extra `getConfig()`. A completed action alone does not prove a lease
is still valid. CAS and admission recheck after reasoning latency; Stop/revocation
can always invalidate an earlier snapshot.

Passive captures need not be byte-identical. Render/frame counters may advance;
full frames, PNG hashes, telemetry and entire DTO equality are not local continuity
requirements. Same session/map/tic ties the new capture to the verified simulation
checkpoint. The controller independently verifies passive operations and each
capture's native/Canvas linkage.

## Results and passive decision records

`PlayResult.records: DecisionRecord[]` is ordered, with ordinal **1** and, when
second preparation begins, **2**. `decisionOrdinal` identifies the last returned
decision. Existing flat perception/assessment, promptChanged, run ID, outcome,
reason, action, SDK invocation, uncertainty and tic fields describe **that decision**,
not aggregate totals. Cumulative tics retain the receipt's cumulative meaning.
A returned result is not necessarily completed gameplay.

`PlaybackError.records` retains all completed and current partial records.
`decisionOrdinal` and `stage` identify the failing slot. Its original `cause` and
available objective/perception/assessment remain accessible. The constructor
allows an empty array for errors constructed outside `play()`. The
`decisionMayHaveBeenSent` flag concerns only the failing decision: second
preparation failure does not imply the first decision was absent. Error wording
names the ordinal; the CLI does not print raw causes or records.

Each record contains its reasoning observation and owned `beforePng`, selection,
perception/optional assessment with usage, composed guidance, prompt acknowledgment,
admission observation, and decision evidence. Record #1 alone contains the lookup
and start acknowledgment; those fields remain null in record #2. Record #2 is
initialized before its observation, so even an observation failure retains
`[record1, partialRecord2]`. An observation rejected by local checks remains recorded.

`decision.kind` distinguishes:

- `not-called`: no invocation; earlier evidence and bounded stage/message survive.
- `unconfirmed`: submitted input/scope retained, no trustworthy receipt returned.
  No fabricated receipt/image and no retry.
- `returned`: exact submitted input, detached receipt, nullable owned `afterPng`,
  and independent nullable `imageRetentionFailure` (`read-failed` or
  `digest-mismatch`). Receipt return does not imply successful gameplay. No ending
  observation means no after-image or retention failure. Image retention failure
  leaves `record.failure` null and does not alter gameplay outcome.

Records are passive. Control flow uses live scope/receipt/selection variables,
never record fields. Record #1's retained after-image is never reused for second
reasoning. Its retention failure alone cannot block a fresh verified observation.
DTOs are detached with `structuredClone` at capture. Each reasoning Buffer is the
same owned Buffer sent to perception, without another copy/read/hash. Each result
image has one retained read plus hash comparison; mismatched bytes are not trusted.
Records are frozen at publication. Readonly/freeze are shallow: callers must treat
nested DTOs, the array and Buffers as immutable. There is no deep-freeze/copy layer.

PNG paths remain ephemeral provenance; only owned bytes survive source changes,
deletion and detach. Reasoning reads retain the pre-existing materialization-to-read
validation gap. Executor materialization failure before return is unconfirmed.
Records provide no persistence, archive, independent native proof or authority.

## Navigation, inference and prompt lifecycle

Historical hypothesis/next question and raw observer pose are unverified advice,
not verified destinations, geometry or arrival. All assessment verdicts may proceed.
Current verified game evidence, base survival rules and controller authority take
priority. Advisory JSON excludes usage/full observations and labels embedded text
untrusted. Decisions retains all low-level action selection and controller-owned
duration/authorization.

Both reasoning helpers are unchanged: `DOOM_REASONING_MODEL ?? "gpt-6-luna"`,
Responses, strict schemas, no retries, 60-second abort signal, `store: false`,
`reasoningEffort: "xhigh"`, and required finish reason `stop`. Perception remains
image/state-only; assessment remains perception/selected-target-only. No new
historical prompt input, reasoning step or reflection is introduced.

The canonical base is captured once from the initial observation. `main()` attaches
a fresh lease copied from human instructions; direct callers must likewise supply
a fresh unmodified lease, since observations have no separate canonical-base field.
Each amendment replaces lease instructions. Prompt #2 never appends to prompt #1.
There is no restoration mutation or automatic expiry of “next decision” wording.

The 16,000 JavaScript-character size check does not truncate. First overflow occurs
before claiming; second overflow occurs after the first decision but before second
CAS/dispatch, retaining both complete/partial records. The issued allowance is not
refunded or replaced. Agent admission reserves a slot even if SDK creation later
fails; `sdkInvoked` separately records an actual SDK start. No tics/config change
or budget replenishment occurs here.

## Failure boundaries and current limits

- Attach preflight rejects absent, claimed/closed or non-2 budget hints; acknowledged
  ownership is still detached. The authoritative claim may later fail independently.
- First observation/image, landmark, perception, assessment or guidance failure
  precedes claim. `start-run` includes wrong actual allowance/correlation failures.
- Each slot preserves `prompt-cas`, `dispatch-observation` and `decision` stages.
  Lost mutation acknowledgments may leave applied changes; never retry them.
- Second observation/image failures use `observation`; checkpoint/accounting
  rejection uses `continuation-check`. Later preparation failures retain record #1.
- A thrown `decide()` is conservatively unconfirmed regardless of textual client
  pre/post-dispatch messages. A returned receipt supplies explicit uncertainty.
  Neither permits retry. All noncompleted first outcomes stop before slot #2.
- Terminal prefixes, unsupported states, uncertainty, Stop and reader ownership
  remain controlled by the unchanged browser pipeline. A completed receipt followed
  by revocation does not authorize another decision.

`main()` retains its detach/error aggregation semantics. Unacknowledged attach
never initiates detach; failed detach closes the client without retry. There is
no arbitrary-N loop, objective-completion logic, memory transition/write, planner,
landmark retirement or persistence. Live two-decision gameplay remains unverified.

## Focused offline checks

`two-decisions.test.ts` covers stateful two-slot landmark/free-explore sequences,
fresh images/state, same selected target, original-base prompts, claim/accounting
checks, second-slot failure preservation, admission races and second overflow.
Existing playback tests retain schema, advisory isolation, first failures,
terminal/uncertain outcomes, DTO snapshots and image retention checks. Main tests
cover preflight, waiting through slot #2, retained bytes after detach, compact
output and combined failures. Provider/client/progress tests retain fake transport
and module mocks. These are offline synthetic evidence, not browser/native/API
proof. The observed pre-change suite had 133 passing and one outdated guidance-regex
failure in `doom-tools.test.ts`; that unrelated assertion remains unchanged.
