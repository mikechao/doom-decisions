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

There is no re-selection, completion planner, landmark retirement,
reflection or persistence. The lease prompt is not restored through another
mutation; `main()` detaches in `finally` after playback settles.

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
and image retention. Live scope/receipt variables drive continuation; records are
passive snapshots. Full passive capture/frame/PNG equality is not required.
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
`src/movement-summary.ts` and `tests`. It stops on any failed step and does not
format or write source files. See `package.json` for the exact commands; use
`npm run typecheck` to investigate TypeScript failures on its own.

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
   amendments from the original base. Retain programmatic records if inspecting
   images; normal CLI output excludes them. Check final summary ordinal, exact
   tic/uncertainty outcomes and acknowledged detach. Do not call a terminal prefix
   a completed level transition.
5. On uncertainty, stop and inspect; use Stop Agent to release possible ownership.
   Never rerun automatically. Another attempt needs fresh operator authorization
   and deliberately renewed process budget.
