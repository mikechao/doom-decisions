# Two informed Doom decisions experiment

Running `src/main.ts` with no arguments now authorizes **up to two** guarded gameplay
requests in one broker-authorized run. Do not run it as a check.
The Decisions API chooses the actual action. TypeScript selects the navigation
objective once. The separate reasoning model independently perceives the
visible scene from the verified screenshot and compact state, returning a small
diagnostic description, features, uncertainty and usage. It receives no
navigation objective or historical landmark. The host combines perception and,
for a landmark, a text-only navigation assessment into advisory Decisions guidance.

The experiment uses the installed AI SDK 7, official `@ai-sdk/openai` Responses
provider and existing local OAuth transport. `DOOM_REASONING_MODEL` selects the
reasoning model (default `gpt-6-luna`); this is separate from the browser's
Decisions provider/model. OAuth model availability and structured-output/image
support remain unverified against a live account. There is no automatic fallback
or model retry.

`play()` coordinates a fixed two-slot run. Its once-only work is the initial
observation/base capture, map-wide active-landmark lookup (limit 3), deterministic
first-active selection and nonrefundable run claim. Missing, failed and empty
storage results remain distinct and permit free exploration; malformed evidence
stops. Existing memory access remains read-only with no migration or writes.

For each decision, `prepareDecision()` perceives that decision's fresh owned PNG
and compact current state, optionally assesses the same selected target, and
composes guidance from the original canonical base. Perception receives no
objective/history; assessment is text-only. Historical and model text remain
untrusted advisory JSON. First guidance must fit before claim; second guidance
must fit before its CAS/decision. No guidance accumulates across slots.

`main()` attaches once and requires advisory attach metadata reporting exactly
budget 2 and unclaimed status. `play()` then claims once using the first verified
observation/session/revision and verifies the actual active two-slot allowance.
Each `executeOneDecision()` performs prompt CAS, takes a distinct admission
observation at the expected session/map/tic/revision/run, and invokes `decide()`
once. No prompt files, config mutation, replacement run or retry are used.

Only a completed, certain first receipt with a ready verified ending observation
permits a fresh standalone reasoning observation for slot #2. It supplies current
accounting as well as a new image; it must match the ending checkpoint and show
one remaining slot in the same active run. After fresh reasoning, CAS/admission
recheck scope and continuity before the second invocation. There is no third
slot or post-second inference. See [execution flow](doom-play-agent.md).

`PlayResult.records` contains ordered passive evidence for ordinals 1 and 2.
`decisionOrdinal` identifies which returned decision the flat summary describes;
SDK/tic/outcome fields are not run aggregates. A noncontinuable first receipt
returns one record and ordinal 1. Second observation/preparation/dispatch failure
throws `PlaybackError` with the completed first record plus a partial second,
its ordinal/stage, original cause and a dispatch flag scoped to that failing slot.
A throwing decision is unconfirmed; no receipt is fabricated.

Records retain owned before/after image bytes independently of temporary paths.
Result-image read/hash failure is separate from gameplay and does not itself
block fresh second reasoning. All records/Buffers are excluded from normal CLI
output. Errors print bounded ordinal-aware diagnostics, not raw transport causes.
Playback and detach failures remain separate `AggregateError` members.

There is no arbitrary-N loop, re-selection, completion planner, landmark retirement,
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

Both decisions preserve the customized base template inherited from human settings.
The supported `main()` transaction attaches a fresh lease: controller
`attachAgent()` copies `ports.readDecisionConfiguration().instructionTemplate`,
while `agentPrompt()` changes only the lease configuration and `stopAgent()`
discards it ([controller](../../app/src/session-controller.ts)). Thus its initial
observation supplies the canonical human template, not an earlier lease amendment.
`play()` alone cannot prove that a caller has not already changed the lease prompt;
the observation exposes only the current template, with no canonical-base field.
The smallest safe handling for direct callers is a fresh, unmodified lease for
each attach/play/detach transaction. Never reuse an augmented template as base.
Prompt wording about the next decision has no automatic expiry within a lease;
there is no restoration mutation or objective lifecycle. Several notes may remain
active; only the first is selected, even if the bounded lookup reports `hasMore`.

## Responsibility audit

This experiment trusts the existing executor/browser stack; it is not an
independent native verifier. Shared protocol, broker, controller and root agent
code are unchanged. The executor owns held-lease envelope/DTO/image validation and
prompt acknowledgment checks; the controller owns lease/Stop/CAS/native authority.

`play()` owns one lookup/selection and canonical-base capture, the sole two-slot
claim, and explicit conditional second preparation. `prepareDecision()` repeats
perception, optional assessment and bounded prompt composition.
`executeOneDecision()` repeats CAS, admission observation/checks, one invocation
and image retention. Live scope/receipt variables drive continuation; records are
passive snapshots. Full passive capture/frame/PNG equality is not required.

The second reasoning observation must match receipt #1's ending session/map/tic
and carried revision, and expose the same active run with limit 2, reserved 1,
SDK-invoked 1, remaining 1. The post-CAS admission observation rechecks those
conditions at the acknowledged revision. These snapshots never replace final
browser admission. A completed action alone does not establish current lease
validity. No extra config read or native receipt arithmetic is added.

Offline verification, from this directory with existing dependencies:

```sh
npm run typecheck
node --experimental-strip-types --experimental-test-module-mocks --test tests/*.test.ts
../../app/node_modules/.bin/biome check src/main.ts src/provider.ts src/doom-play-agent.ts src/navigation-assessment.ts src/doom-tools.ts src/progress.ts tests
```

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

## Suggested live smoke, requiring separate operator authorization

1. Separately approve browser/game-asset use, OAuth/reasoning inference, read-only
   access to the intended memory DB, and at most two Decisions API attempts.
   The reasoning model must support images and structured output. No live proof
   has been collected for this two-decision change.
2. Set `AGENT_DECISION_BUDGET=2` in the root app's ignored `app/.env.agent.local`.
   Start a fresh authorized `dev:agent` process and manually open its page at
   `http://127.0.0.1:5174`. Wait for verified E1M1 readiness. Do not grant a
   separate browser run or start Continuous Mode. Use existing local OAuth setup;
   never put credentials in prompts, output or artifacts.
3. From this directory, run once:
   `DOOM_REASONING_MODEL=<approved-model> node --experimental-strip-types src/main.ts`.
   Missing memory may use free exploration; malformed evidence or failed inference
   stops without fallback/retry. First preparation failure must not claim a run.
4. Inspect receipts and Console/Network: one claim, two sequential decisions only
   when the first is completed and the fresh checkpoint/accounting permit it,
   a fresh reasoning image/pass between them, same objective/target, and two prompt
   amendments from the original base. Retain programmatic records if inspecting
   images; normal CLI output excludes them. Check final summary ordinal, exact
   tic/uncertainty outcomes and acknowledged detach. Do not call a terminal prefix
   a completed level transition.
5. On uncertainty, stop and inspect; use Stop Agent to release possible ownership.
   Never rerun automatically. Another attempt needs fresh operator authorization
   and deliberately renewed process budget.
