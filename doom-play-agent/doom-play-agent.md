# DoomPlayAgent execution flow

This is the implementation baseline for [`play()`](src/doom-play-agent.ts):
**up to N consecutive informed decisions in one broker-issued run**, with no retry
or replacement run. N is the issued positive safe-integer limit. Early failure or
declined admission can produce fewer decisions or no gameplay. Doom runs in the
browser; Responses reasoning models perceive/assess scenes and the browser's
Decisions API selects the low-level action. This describes implementation, not
proof of navigation improvement or live N>2 gameplay.

## Execution order

1. Zero-argument exported `main()` constructs the client, host-only memory tools and
   OAuth-backed provider, then attaches once. Attach preflight requires a positive
   safe-integer `configuredDecisionBudget` and `budgetUnclaimedAtAttach === true`.
   These snapshots do not claim or authorize a run. An acknowledged attach is
   detached in `finally`, including on preflight/playback failure.
2. `play()` obtains the initial observation and captures its canonical instruction
   template once from the fresh unmodified lease. It snapshots the observation and
   reads its materialized PNG once into an owned Buffer. The shared executor checks
   PNG header/hash before materialization; this reasoning read does not revalidate
   the file. Later file changes cannot change the owned inference bytes.
3. `findActiveLandmarks()` performs one map-wide `active-landmarks` lookup with the
   verified map key, limit 3 and no pose/radius restriction. Storage is read-only.
   Candidates must match the namespace and have unique IDs. The first candidate in
   creation-time/ID order becomes the target; otherwise the objective is free
   exploration. This selection remains unchanged throughout the run.
4. `prepareDecision()` calls `perceiveScene()` with the first owned image and compact
   current state. Perception receives no objective or historical note. When a target
   exists, `assessNavigation()` compares that perception with the selected target,
   text-only. Assessment failure stops without fallback.
5. Preparation composes guidance from the original canonical base, selection,
   current perception and optional assessment. First guidance is size-checked
   **before the nonrefundable run claim**.
6. `play()` calls `startRun()` once with the initial observation/session/revision.
   The broker chooses the run ID and limit. The executor checks correlation; local
   checks require a valid positive safe-integer issued limit, matching session and
   revision, active run, zero reservations/SDK invocations and remaining N.
   `main()` supplies the attach hint as `expectedDecisionBudget`; disagreement with
   the issued limit fails before CAS/dispatch, without refund or another claim.
   This argument is a consistency check, not desired N. Direct callers without
   attach metadata may omit it; the issued limit remains authoritative.
7. `executeOneDecision()` performs prompt CAS with live session/run/revision scope,
   records its acknowledgment and adopts that revision. CAS invalidates admission,
   so it observes again. This admission observation must have a distinct ID, ready
   phase, the reasoning session/map/tic, acknowledged revision and expected active
   run accounting. The admission PNG is not reread for inference.
8. The helper calls `decide()` once. Immediately before invocation it records the
   submitted input as unconfirmed. A returned receipt is detached and recorded;
   its resulting PNG, when present, gets one read and SHA-256 check for retention.
   Retention failure does not rewrite the receipt or trigger replay. The completed
   record is frozen and published.
9. For each ordinal k=2..N, continue only if the previous receipt is `completed`,
   certain, SDK-invoked, has null reason, non-null action and a ready ending
   observation. Otherwise return the exact last outcome without creating record k.
10. Before obtaining the next reasoning observation, create partial record k with
    the same selection and clear prior preparation. Obtain a fresh standalone
    observation and validate the ending-checkpoint/accounting contract below.
    Read its own PNG; never substitute the previous record's retained after-image.
11. Repeat fresh perception, optional assessment of the same target, composition
    from the original base, size check, CAS, admission recheck and one decision.
    Publish the record and carry the live receipt/scope. After ordinal N there is
    no extra observation, inference or active-run check; exhaustion legitimately
    makes the authorization inactive.
12. `main()` prints only the compact last-decision summary, excluding records and
    Buffers, then detaches. Playback and detach failures remain separate members
    of `AggregateError` when both fail.

Lookup statuses `empty`, `unavailable` (missing storage), and `lookup_failed` permit
perception-informed free exploration. Malformed evidence stops at `landmarks`.
`hasMore` stays diagnostic and never changes selection. Historical prose is
JSON-quoted in logs; the note label uses a short SHA-256 digest of its ID.

## Helpers, data and ownership

| Owner | Responsibility |
| --- | --- |
| `play()` | Initial observation/base, lookup/selection, first preparation and sole claim; continuation loop, live scope/receipt, ordered records and final summary. |
| `prepareDecision()` | Per-slot perception, optional assessment, canonical-base guidance and size check; stage-specific reasoning failures. |
| `executeOneDecision()` | CAS, fresh admission/checks, one `decide()`, after-image retention. Never claims a run. |
| `checkCheckpoint()` / `checkRun()` | Exposed checkpoint/scope/accounting checks; no independent native verifier or local authority ledger. |
| `newRecord()` | Partial passive evidence initializer for the current numeric ordinal. |
| `modelState()` / `composeGuidance()` | Compact current state and bounded advisory projections; no prior records or unselected notes enter reasoning. |
| `DoomClient` | Acknowledged lease lifecycle, serialized operations, no retries. Playback does not call `getConfig()`, `getPrompt()` or `setConfig()`. |
| Shared executor | Held-lease page/epoch/command correlation, DTO/settings/receipt parsing, PNG validation/materialization, exact prompt echo/revision increment, active start acknowledgment and decision observation correlation. |
| Browser/controller | Lease/session/run ownership, one-shot issuance, CAS/readiness, nonrefundable reservations, SDK reader cleanup, Stop fences, native dispatch and resulting-frame verification. |

## Continuation and admission contract

After k-1 completed, certain decisions, the fresh reasoning observation requires:

- Ready phase and a different observation ID from the previous receipt's ending
  observation; matching ending session, map key and tic.
- Session and revision matching the carried live scope.
- Same active run ID, `limit === N`, `reserved === k-1`, `sdkInvoked === k-1`,
  `remaining === N-(k-1)`.

After CAS, admission rechecks session/map/tic against this slot's reasoning
observation, requires a different ID, and checks the same run/accounting at the
acknowledged revision. First admission uses zero consumed slots. These equal
reservation/SDK counts apply only after completed receipts; admission may reserve a
slot before SDK creation fails, and that reservation is never refunded.

Standalone observations expose revision/configuration/run accounting. Decision
receipts expose only a base ending observation. The standalone reasoning capture
obtains missing accounting without another config read. Passive captures need not
have equal PNG bytes, hashes, telemetry or render/frame counters. Same
session/map/tic establishes the exposed simulation checkpoint; each capture's
native/Canvas linkage is verified by the controller.

All observations are snapshots. Stop during reasoning can leave that reasoning
call running, but later CAS/admission must fail closed. Stop after admission is
handled by controller fences and verification. The controller checks current
lease/epoch, exact unconsumed observation, configuration identity, revision and
readiness before dispatch; the coordinator cannot guarantee continued ownership.

## Results and passive records

`PlayResult.records` contains ordered records 1..k. `decisionOrdinal` identifies
the last returned decision. Flat perception/assessment, promptChanged, run ID,
outcome, reason, action, SDK invocation, uncertainty and tic fields describe that
last decision, not run totals. `cumulativeTics` is copied unchanged from its receipt.
A returned result need not represent completed gameplay.

A noncompleted, terminal, declined or uncertain return stops before any next
record/preparation. A failure throws `PlaybackError` containing all earlier
completed records plus the current partial record, failing ordinal/stage, original
cause and available objective/perception/assessment. `decisionMayHaveBeenSent`
concerns only that failing ordinal. Clearing preparation before each new
observation prevents stale perception/assessment in later errors.

Each record retains reasoning observation, owned `beforePng`, selection,
perception/optional assessment with usage, guidance, prompt acknowledgment,
admission observation and decision evidence. Only record 1 contains the original
lookup and start acknowledgment. Decision evidence distinguishes:

- `not-called`: no invocation; only stages reached so far are retained.
- `unconfirmed`: submitted scope/input retained, no trustworthy returned receipt;
  a thrown `decide()` is conservatively uncertain even if its message says failure
  occurred before dispatch. No fabricated receipt/image or retry.
- `returned`: detached receipt, nullable owned `afterPng`, and separate nullable
  `imageRetentionFailure` (`read-failed` or `digest-mismatch`). Without an ending
  observation there is no after-image or retention failure. Retention failure alone
  does not block a later independently verified reasoning capture.

Records are passive; live scope/receipt/selection drive control flow. DTOs are
cloned at capture, Buffers transfer ownership without another copy, and records
are shallow-frozen at publication. Callers must treat nested DTOs, arrays and
Buffers as immutable. Paths are ephemeral provenance; owned bytes survive file
changes/deletion/detach. Executor materialization failure before return remains
unconfirmed. Records provide no persistence or independent native proof.

Experiment A adds a passive `movement` result to each record. Before a receipt
returns it is unavailable (`decision-not-returned`). For each returned receipt,
`summarizeMovement()` checks completed/certain/SDK-invoked status, action and
positive matching requested/reported/verified tics, ready checkpoints, before-ID,
distinct admission/ending observation IDs,
session, canonical IWAD/map identity, and start + verified = ending tic (including
frame/gametic and cumulative-tic consistency). Native-range XY/angle checks guard
arithmetic: signed-int32 16.16 XY and uint32 binary angle. Other outcomes, including
terminal prefixes, or invalid/missing data yield an explicit unavailable reason.

Available results use the retained post-CAS admission pose and receipt ending pose
only: raw XY deltas, XY deltas/net magnitude in Doom units, minimal signed heading
delta in degrees [-180, 180) (half-turn tie -180), and independent exact position/
heading change flags. Ordinal/action/tic context remains in the enclosing record
and receipt. Each returned decision emits one best-effort net reported pose
diagnostic inside its decision boundaries. Diagnostic errors cannot affect receipt
retention or continuation. This adds no observations, inference, model inputs or
control state; existing previous-action feedback remains unchanged. Endpoint
deltas are browser-reported diagnostics, not independent native pose attestation,
path length, collision, exploration or landmark/exit progress. No motion threshold
or revisit heuristic is applied. Controller/executor execution and image proofs
remain authoritative; this helper does not repeat those proofs.

Memory grows O(N) because images and DTOs remain retained. Keep practical smoke
budgets small; the positive-safe-integer limit has no additional small memory cap.

## Navigation, inference and failure boundaries

The objective and full target stay fixed. Historical anchor/hypothesis/question
are unverified advice, not destinations or routes. All assessment verdicts may
proceed; current verified game evidence, base survival rules and controller
authority take priority. Advisory JSON excludes usage/full observations and labels
embedded text untrusted. Decisions alone chooses the low-level action.

Reasoning helpers retain their existing Responses configuration and schemas,
`DOOM_REASONING_MODEL ?? "gpt-6-luna"`, no retries, 60-second abort signal,
`store: false`, `reasoningEffort: "xhigh"`, and required finish reason `stop`.

The canonical template is captured once. `main()` supplies a fresh lease copied
from human instructions. Direct callers must also supply a fresh unmodified lease:
observations have no separate canonical-template field. Every amendment replaces
instructions from that original base, never accumulates prior amendments. There
is no prompt restoration mutation or automatic expiry of “next decision” wording.

The 16,000 JavaScript-character guidance check never truncates. First overflow
precedes claim; later overflow preserves earlier records and stops before that
slot's CAS/dispatch. Stage names remain `observation`, `landmarks`, `perception`,
`navigation-assessment`, `guidance`, `start-run`, `continuation-check`, `prompt-cas`,
`dispatch-observation` and `decision`. Lost acknowledgments are never replayed.
No config/duration change, refund, replacement run, objective switching, reflection,
planner, landmark retirement or memory write is introduced.

## Evidence and offline checks

The earlier two-decision milestone was reported to pass 179/179 offline tests and
an authorized live smoke (`turn_right`, then `forward`) with fresh perception and
assessment before decision 2 and clean detach. The nested advisory-JSON assertion
in `doom-tools.test.ts` is fixed. Root `AGENTS.md` still describes the older
one-decision milestone; it is unchanged in this package-only refactor.

Generalized N>2 has not been demonstrated live. Offline tests use synthetic PNGs,
fake transports/models/tools and isolated temporary SQLite fixtures, never the
historical DB. They do not establish browser/native rendering or paid API behavior.
The existing `two-decisions.test.ts` now includes N=1/2/3/5, later checkpoint and
accounting rejection, intermediate outcomes, later failures and retained evidence.
Main tests cover hint validation/consistency, cleanup and record-free output.
The 2026-11-10 offline verification passed 118/118 focused and 241/241 full tests,
typecheck, the documented Biome check (16 files), and diff whitespace checks. The
initial 179/179 baseline was also reproduced. See README for commands and details.
Next steps are focused static review,
then a separately authorized N=3 live experiment.
