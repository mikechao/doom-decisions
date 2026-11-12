# DoomPlayAgent

Running `src/main.ts` with no arguments now authorizes **up to N** guarded gameplay
requests in one broker-authorized run, where N is its issued positive safe-integer
limit. Do not run it as a check.

From the repository root, start live gameplay with:

```sh
npm --prefix doom-play-agent run agent
```

This requires the normal broker/browser and credentials setup and may make paid API
calls. It is not an offline verification command.

The Decisions API chooses the actual action. TypeScript selects the navigation
objective once. The separate reasoning model independently perceives the
visible scene from the verified screenshot and compact state, returning a small
diagnostic description, features, uncertainty and usage. It receives no
navigation objective or historical landmark. The host combines perception and,
for a landmark, a text-only navigation assessment into advisory Decisions guidance.

DoomPlayAgent uses the installed AI SDK 7, official `@ai-sdk/openai` Responses
provider and existing local OAuth transport. `DOOM_REASONING_MODEL` selects the
reasoning model (default `gpt-6-luna`); this is separate from the browser's
Decisions provider/model. An earlier separately authorized two-decision smoke test
was reported successful;
this does not certify every model or account. There is no automatic fallback
or model retry.

`play()` coordinates a bounded sequential run. Its once-only work is the initial
observation/base capture, map-wide active-landmark lookup (limit 3), deterministic
first-active selection and nonrefundable run claim. Missing, failed and empty
storage results remain distinct and permit free exploration; malformed evidence
stops. Existing memory access remains read-only with no migration or writes.

For each decision, `prepareDecision()` perceives that decision's fresh owned PNG
and compact current state, optionally assesses the same selected target, and
composes guidance from the original canonical base. Perception receives no
objective/history; assessment is text-only. Historical and model text remain
untrusted advisory JSON. First guidance must fit before claim; every later amendment
must fit before its CAS/decision. No guidance accumulates across slots.

Approach B permits one optional, uncertain evidence-seeking suggestion in the
existing assessment when the fresh **reasoning observation** is within 256 Doom
units of the selected historical observer anchor. The gate uses unrounded raw
16.16 XY distance, valid poses, matching full map/IWAD key and a nonempty
`nextQuestion`; it recomputes every decision without arrival state. Assessment
receives only one extra host boolean, and returns nullable `investigationGuidance`
(1–240 trimmed characters when non-null). Inactive assessments require null;
active scenes may still provide no defensible suggestion. `no-visible-match`
does not exclude advice. No extra inference, action/duration authority, retry,
or completion evaluation is added.
Host activation and validated non-null advice are both required for one JSON-quoted
`landmarkInvestigation` advisory in Decisions guidance. It records the 256-unit
radius, remains subordinate to current verified evidence/controller authority,
and stays within the existing prompt preflight. Existing schema-v3 records retain
everything needed to audit activation, advice and acknowledgment; costing and
image/receipt persistence are unchanged. See the [execution baseline](doom-play-agent.md#navigation-inference-and-failure-boundaries).
Offline synthetic tests establish these contracts only. A separately authorized
live trial would measure clearer identified passage/threshold/approach views
relevant to `nextQuestion`, rather than proximity to the observer anchor alone.

Experiment C appends deterministic recent-history guidance in both landmark and
free-explore mode: at most four immediately preceding eligible completed
decisions, oldest first. Rows contain ordinal, action, verified tics, Euclidean
endpoint displacement (Doom units), signed heading delta (degrees), and the
pre-action admission solid center-ray distance. Movement/heading display two
decimal places without changing retained telemetry. A valid non-solid probe is
`"not-solid"` (not proof of passability); missing/invalid probes are `null`.
Decision 1 explicitly has `no-history`. Invalid movement/receipt evidence or a
checkpoint mismatch within the selected window (including its connection to the
current reasoning observation) produces `unavailable` with no rows; invalid
history is never skipped/backfilled.
History recovers when faulty evidence leaves the window and all required joins
are valid; Experiment B's whole-prefix diagnostics remain unchanged.
This suppresses advice only, without changing admission or continuation.

History uses published records, never the current attempt, and stays out of
perception/assessment inference. Current verified screenshot/state and controller
authority take precedence. Browser-reported endpoint diagnostics do not establish
path length, collision, loops, objective progress or landmark completion; probe
direction changes cannot identify the same wall. No stuck classifier, navigation
policy, extra inference or persistence is added. Existing schema-v2 guidance and
prompt acknowledgments already retain the amendment.

`main()` attaches once and requires an advisory positive safe-integer
`configuredDecisionBudget` and `budgetUnclaimedAtAttach === true`. It passes the
hint to `play()` for consistency checking only. `play()` prepares the first slot,
then claims once using its initial observation/session/revision. It derives N from
the issued `run.limit`; an invalid limit or disagreement with the hint stops before
CAS/dispatch, without refund or another claim. Direct callers may omit the hint
when they have no attach metadata; they still require a valid issued allowance.
There is no separate desired-N setting.

Each `executeOneDecision()` performs prompt CAS, takes a distinct admission
observation at the expected session/map/tic/revision/run, and invokes `decide()`
once. No prompt files, config mutation, replacement run or retry are used.

After decision 1, the coordinator loops over ordinals 2..N. Only a completed,
certain receipt with SDK invocation, null reason, a selected action and a ready
verified ending observation permits the next slot. A fresh standalone reasoning
observation must match that ending session/map/tic and carried revision, with the
same active run, `limit === N`, `reserved === sdkInvoked === k-1` and
`remaining === N-(k-1)`. CAS and fresh admission independently recheck continuity
and accounting after reasoning. No observation/inference follows the final slot;
exhaustion can legitimately make the run inactive. See [execution flow](doom-play-agent.md).

`PlayResult.records` contains ordered passive evidence for ordinals 1..k.
`decisionOrdinal` identifies the last returned decision; flat SDK/tic/outcome
fields describe that receipt, including its unchanged cumulative tic value.
Noncompleted or uncertain returns stop immediately with k records. Later failures
throw `PlaybackError` with all earlier completed records plus partial record k,
its ordinal/stage, original cause and a dispatch flag scoped to that failing slot.
A throwing decision is unconfirmed; no receipt is fabricated.

Records retain owned before/after image bytes independently of temporary paths.
Result-image read/hash failure is separate from gameplay and does not itself
block subsequent fresh reasoning. All records/Buffers are excluded from normal CLI
output. Errors print bounded ordinal-aware diagnostics, not raw transport causes.
Playback and detach failures remain separate `AggregateError` members.

There is no re-selection, completion planner, landmark retirement or
reflection. The lease prompt is not restored through another
mutation; `main()` detaches in `finally` after playback settles.

## Resolved-run artifacts

After the detach attempt, `main()` saves each resolved `PlayResult` once under
ignored `doom-play-agent/.local/runs/`, relative to the module rather than the
working directory. Each run gets a directory named from its UTC timestamp and
encoded broker run ID. Exclusive directory/file creation prevents overwrites;
new directories/files request private permissions (0700/0600 where supported).

```text
.local/runs/<UTC-timestamp>_<broker-run-id>/
  result.json
  decision-1-before.png
  decision-1-after.png
  decision-2-before.png
  decision-2-after.png
```

The two-space JSON envelope contains `schemaVersion: 3`, `recordedAt` (UTC),
`provenance`, `costSummary`, and `result`. Before attaching, `main()` takes one best-effort Git
snapshot from the module-relative repository root. `provenance.git.commit` is
the full HEAD SHA; `provenance.git.dirty` includes staged, unstaged and nonignored
untracked changes across the repository. Ignored files, including `.local/runs/`,
are excluded, respecting repository and user-level Git exclusions through `HOME`
and `XDG_CONFIG_HOME`. Each value is independently null if its Git command fails; Git
failure does not prevent gameplay or persistence. Standalone `persistRun()` calls
without a snapshot save both values as null and never invoke Git.
The snapshot is not refreshed after playback: edits during a run are not captured,
a dirty flag does not identify changed content, and a SHA is not a browser/WASM
runtime fingerprint. No Git output, filenames or errors are retained.

Just before serialization, `persistRun()` calculates `costSummary` from
`result.records[]` only; flat final-decision summaries are duplicates. The pure
`estimateRunCost()` uses the bundled offline `@opencode-ai/models@0.0.133` snapshot,
loaded inside an optional pricing boundary. No client, network request, credentials
or pricing updater is involved. Separately reviewed dependency updates refresh
prices for newly saved runs. SDK version, snapshot source and `generatedAt` are
saved; the SDK supplies no snapshot hash. This timestamp is not a historical
price-effective date.

The summary is an **estimated API-equivalent USD cost**, not actual OAuth charges
or an invoice. Each task bucket records calls, input/output totals, priced/unpriced
counts, unknown reasons, a covered subtotal and nullable complete task estimate.
`models[]` groups exact provider/requested/reported identities and the rates
actually used (USD per million tokens). Both reasoning tasks use their recorded
`modelId` on the source-verified OpenAI route. Decisions price the receipt's exact
requested OpenRouter or OpenAI offering; the reported version remains diagnostic
and is never treated as an alias. Unsupported providers have unknown cost.

Each invocation is priced before aggregation without rounding. Cache-read/write
partitions are subtracted from total input and priced separately when used;
reasoning is already in output and is priced once at the ordinary output rate.
Raw and total-token counters are not added. Decisions lack retained cache/reasoning
partitions: their explicit base-rate convention applies only when the offering
has no differentiated cache or reasoning prices. Standard mode and published
text/screenshot token rates are an estimation convention; no additional image
surcharge, priority service or experimental-mode charge is inferred. Separate
reasoning prices, unsupported model/modalities, missing/invalid required counters or rates,
and calls whose input plus output reaches a context-tier threshold are unknown.
The conservative threshold check may reject a call whose actual input alone
would still qualify for base pricing; this is intentionally not a tier engine.

`coveredSubtotal.isPartial` explicitly marks incomplete coverage, and full-run
`estimatedUsd` is null whenever any recorded call is unpriced. No priced calls
means a null covered subtotal; an explicitly priced free call may legitimately
cost zero. Skipped assessment and non-invoked Decisions create no calls and have
null task estimates. Unknown input/output totals are null, never invented zeros.
Only retained invocations can be estimated; missing failed-call usage cannot
reconstruct total spend. Snapshot failures produce unknown costs; lookup failures
can preserve partial coverage; an unexpected estimator failure saves an explicit
unknown summary with unavailable task details. Pricing failures never suppress a
valid run, while existing JSON/image write and serialization failures still fail
persistence normally. Neither `play()` nor `PlayResult` is changed for costing.

All non-image result evidence is retained, including ordered records,
receipts, raw poses, movement summaries, recent-pose comparisons, guidance and
usage. Only retained image fields change on disk: `records[i].beforePng` and
`records[i].decision.afterPng` become `{ "file": "decision-1-before.png" }` and
`{ "file": "decision-1-after.png" }`, respectively (using that record's ordinal).
Resolve each reference relative to the directory containing `result.json`.
Sidecars contain the exact retained Buffer bytes, with no re-encoding. Their
existing digests remain in `reasoningObservation.pngSha256` for before-images
and `decision.receipt.observation.pngSha256` for after-images. No extra production
hash pass is added. In-memory records and Buffer ownership are unchanged.
Null images remain null; absent/undefined fields are omitted as in ordinary JSON.
No file/reference is manufactured for a missing image or retention failure.

Historical v1 artifacts embed Node Buffer JSON byte arrays in a single file;
v2 artifacts use the same sidecar/result contract as v3 but lack `costSummary`.
They remain untouched and readable in their original JSON form; no reader,
compatibility layer or migration is provided.
Each successful reasoning output retains `modelId` alongside existing `usage`
and `durationMs`, at `result.records[i].perception.modelId` and, when assessed,
`result.records[i].navigationAssessment.modelId`. This is the exact selected ID
passed to the Responses provider for that call, including the default; it is not
a server-reported model version. Selection remains per invocation, so changing
the environment in-process can produce different IDs within one run. Model IDs
are local instrumentation, excluded from generated-output schemas and guidance.
Map/IWAD identity, run/budget, Decisions provider/model, prompts, selection and
tics/poses remain in existing records rather than duplicated in provenance.

Early, terminal, declined and uncertain returned outcomes are saved too; a saved
artifact does not imply completed gameplay or confirmed detach. A detach failure
remains primary even if saving also fails. Otherwise a persistence failure makes
the CLI exit nonzero with a bounded diagnostic. Images are written before the
final `result.json`; the saved-path message appears on stderr only after all
writes succeed and names `result.json`. Gameplay is never retried.

Thrown playback errors and interrupted runs are not persisted. Failed/interrupted
writes can leave a partial run directory, missing or incomplete `result.json`, or
incomplete sidecars; this is not crash-safe storage and no rollback is attempted.
Temporary PNG paths remain provenance only; durable image links use the relative
sidecar references. Artifacts contain potentially sensitive prompts, historical
prose and local paths, so keep them local. Provider credentials, SDK instances,
environment dumps and raw errors are not added.

Tagged progress milestones use `consola/basic` on stderr; the existing final
result stays on stdout. Progress includes lookup status and returned count (not
an active total), the host objective, perception status, acknowledged guidance,
the decision receipt and detach outcome. Landmark labels use the first 12 hex
characters of SHA-256 of the note ID; selected historical prose is JSON-quoted.
Perception and assessment diagnostics remain JSON-escaped when logged.
Missing receipt fields appear as `unknown`, and uncertain completion stays explicit.
Progress is best-effort: a synchronous write failure or stderr stream error disables
further progress for the process without interrupting gameplay or detach cleanup.

All decisions preserve the customized base template inherited from human settings.
The supported `main()` transaction attaches a fresh lease: controller
`attachAgent()` copies `ports.readDecisionConfiguration().instructionTemplate`,
while `agentPrompt()` changes only the lease configuration and `stopAgent()`
discards it ([controller](../app/src/session-controller.ts)). Thus its initial
observation supplies the canonical human template, not an earlier lease amendment.
`play()` alone cannot prove that a caller has not already changed the lease prompt;
the observation exposes only the current template, with no canonical-base field.
The smallest safe handling for direct callers is a fresh, unmodified lease for
each attach/play/detach transaction. Never reuse an augmented template as base.
Prompt wording about the next decision has no automatic expiry within a lease;
there is no restoration mutation or objective lifecycle. Several notes may remain
active; only the first is selected, even if the bounded lookup reports `hasMore`.

## Responsibility audit

DoomPlayAgent trusts the existing executor/browser stack; it is not an
independent native verifier. Shared protocol, broker, controller and root agent
code are unchanged. The executor owns held-lease envelope/DTO/image validation and
prompt acknowledgment checks; the controller owns lease/Stop/CAS/native authority.

`play()` owns one lookup/selection and canonical-base capture, first-slot
preflight, the sole claim, and the continuation loop. `prepareDecision()` repeats
perception, optional assessment and bounded prompt composition for every slot.
`executeOneDecision()` repeats CAS, admission observation/checks, one invocation
and image retention. Live scope/receipt variables drive continuation; published
records supply read-only recent-history advice. Full passive capture/frame/PNG
equality is not required.
Controller checks remain authoritative against Stop/revocation after any snapshot.

Records retain PNG buffers and cloned DTOs, so memory grows O(N). Keep practical
smoke budgets small (initially N=3); safe-integer validation is not a small memory
cap. A fresh unmodified lease is still required for direct `play()` callers.

Offline verification, from `doom-play-agent/` with Node
22.20.0 or newer and existing package and root app dependencies:

```sh
npm test
npm run check
```

`npm test` runs the full offline `node:test` suite (`tests/*.test.ts`), including
movement-summary tests. Prefer `npm run check` after changes: it runs `npm test`,
`npm run typecheck`, then the existing non-writing Biome check, including
`src/movement-summary.ts`, `src/run-persistence.ts` and `tests`. It stops on any
failed step and does not format or write source files. See `package.json` for the
exact commands; use `npm run typecheck` to investigate TypeScript failures on its own.

Tests use native Node module mocks (experimental on Node 22.20.0), registered
before dynamically importing the zero-argument `main()` entry point. Test files
retain process isolation and serial cases; cached ESM bindings use resettable
mock implementations, since restoration does not unload `main.ts`. Real playback
remains exercised with synthetic dependencies.

Tests use fake Doom clients/transports, fake model responses, fake tools for agent
tests, and isolated temporary SQLite databases for real memory lookup tests.
PNG fixtures exercise protocol header/hash checks, not decoding or native
rendering. These checks do not use OAuth credentials, the historical memory DB,
a browser, Doom/WASM or a paid API. The client tests verify string/file prompt
convergence and the shared executor through an injected fake HTTP transport.
Existing agent, CLI and MCP callers retain absolute-file prompt inputs and the
same validated wire command.

## Evidence and suggested live smoke, requiring separate operator authorization

The earlier two-decision implementation was reported to pass 179/179 offline tests
and a separately authorized live run (`turn_right`, then `forward`), with fresh
perception/assessment and clean detach. The advisory-JSON assertion in
`doom-tools.test.ts` is fixed. Root `AGENTS.md` still describes the older one-decision
milestone; this package documents current implementation. N>2 has not been
demonstrated live.

Offline verification on 2026-11-10 rechecked the initial baseline (179/179), then
passed the focused `tests/two-decisions.test.ts tests/main.test.ts` suite (118/118)
and full `tests/*.test.ts` suite (241/241), using
`node --experimental-strip-types --experimental-test-module-mocks --test`.
`npm run typecheck`, the then-documented non-writing Biome check (16 files), and
`git diff --check` passed. The full suite initially found two old CLI-label
assertions; both were corrected before the final passing run. No unrelated
failures remained. No live gameplay, servers, OAuth or paid calls were exercised.

1. Separately approve browser/game-asset use, OAuth/reasoning inference, read-only
   access to the intended memory DB, and at most three Decisions API attempts.
   The reasoning model must support images and structured output. No live proof
   has been collected for the generalized N>2 change.
2. Set `AGENT_DECISION_BUDGET=3` in the root app's ignored `app/.env.agent.local`.
   Start a fresh authorized `dev:agent` process and manually open its page at
   `http://127.0.0.1:5174`. Wait for verified E1M1 readiness. Do not grant a
   separate browser run or start Continuous Mode. Use existing local OAuth setup;
   never put credentials in prompts, output or artifacts.
3. From this directory, run once:
   `DOOM_REASONING_MODEL=<approved-model> node --experimental-strip-types src/main.ts`.
   Missing memory may use free exploration; malformed evidence or failed inference
   stops without fallback/retry. First preparation failure must not claim a run.
4. Inspect receipts and Console/Network: one claim, up to three sequential
   decisions only
   while previous receipts and fresh checkpoint/accounting permit continuation,
   a fresh reasoning image/pass for every slot, same objective/target, and prompt
   amendments from the original base. Normal CLI output excludes records; after
   detach, inspect `result.json` for ordered records and referenced PNG sidecars.
   Check final summary ordinal, exact tic/uncertainty outcomes and acknowledged
   detach. Do not call a terminal prefix
   a completed level transition.
5. On uncertainty, stop and inspect; use Stop Agent to release possible ownership.
   Never rerun automatically. Another attempt needs fresh operator authorization
   and deliberately renewed process budget.
