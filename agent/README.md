# DoomPlayAgent: AI SDK 7 + Codex CLI + Hermes

`src/main.ts` is the primary composition root. Its original
`--authorize-live-observation-cli` mode remains passive: attach, one verified PNG,
parent/child advisory tools, final validation, cleanup and retained browser lease.
It cannot claim a run or dispatch gameplay. Default/help are inert: no attach,
SQLite open, CLI process or inference.

The separate **`--authorize-agent-one-decision`** flag enables a small agent-driven
experiment. It also requires `--authorize-live-observation-cli`. Only the parent
DoomPlayAgent receives `executeGuardedDecision({ objective, uncertainty })`.
The parent may consult the existing read-only LandmarksToolLoopAgent once, invokes
the guarded tool itself, receives an ordinary SDK JSON tool result, and continues
reasoning in the same parent agent run. `main.ts` never continues into a post-agent
`decide`.

The host callback in `src/guarded-decision.ts` rejects malformed, oversized,
control-like or unsafe advisory input before claiming anything. The two text
fields are advisory only; there is no action, button, mask, duration, run ID,
raw template or arbitrary control field. Conservative text rejection is **not**
semantic isolation of natural language. Host-held original settings are preserved,
including include flags, six tics and `{{tics}}`. Historical notes remain unverified;
final attribution is resolved from the existing validated consultation receipts,
never parent-restated provenance. Without consultation, attribution must be null.

A private invocation latch is consumed before the first mutating transport call.
A second independent latch guards decision dispatch. Neither can be reset by
model retries, SDK steps, failed transport, final-output repair or lost responses.
The typed callback sequence is exactly:

1. `start-run` with the initial observation/session/revision; require the same
   configuration and acknowledged `active=true, limit=1, reserved=0,
   sdkInvoked=0, remaining=1`. A larger allowance is refused, never repaired.
2. `set-prompt` with an owned private instructions file and scoped CAS; require
   the exact guidance and revision +1, same run and unused counters.
3. `observe` followed by `liveObserve`: different observation ID, correct
   lease/epoch/session/map, unchanged tic/native hashes/telemetry/probe/previous
   action and gameplay counters, new configuration/revision and unused run.
   Incidental render/frame counters may change. PNG bytes and hashes are validated.
4. `decide` with only lease, fresh observation ID and session/run/revision scope.
   Decisions selects the action; the controller applies and verifies actual tics.
   `liveDecision` checks the actual typed receipt and frame. No invented receipt
   run/revision fields are used.
5. For healthy completion only, one read-only `get-config` corroborates the same
   run/config/revision and `active=false, limit=1, reserved=1, sdkInvoked=1,
   remaining=0`. Terminal/retired accounting is marked unavailable; verified
   native prefixes remain distinct from a fully completed action.

The SDK result contains compact host receipt facts, including outcome, reason,
uncertainty, action, requested/reported/verified/cumulative tics, SDK invocation,
provider/model metadata and before/after identities. It contains no PNG, file
paths, private memory text or unrestricted error details. The authorized final
JSON extends the passive schema with `decision`, which must exactly match the
host-captured structured result. This proves structured receipt grounding, not
semantic truth of every sentence of model prose. A malformed/ungrounded final
response, accounting failure or cleanup failure cannot erase the report's
independently verified action. Nothing is replayed to obtain nicer prose.

### CLI output and diagnostics

An authorized `main.ts` invocation writes exactly one final JSON report to
**stdout**, including on failure; redirect stdout to retain machine evidence.
The existing inert default/help/invalid-argument paths print usage text instead.
Consola 3.4.2's BasicReporter has both output streams explicitly bound to
**stderr**. Info milestones, warnings and short diagnostics are enabled by default
at fixed level 3, with no colors, spinner, token/event logging or throttling.
`CONSOLA_LEVEL` does not override this console; existing provider debug flags
remain forbidden. Provider warnings fail closed without echoing arbitrary provider text. These
host milestones do not claim to filter all inherited Codex subprocess output.

Only validated scoped `objective` and `uncertainty` fields are displayed as
guidance, never the entire instruction template, private notes or transcript.
The objective becomes known at guarded invocation. Guidance is **proposed** until
exact prompt CAS acknowledgement; **applied** displays that admitted advisory
block. Display replaces control/format characters and newlines with spaces,
strips terminal escape sequences, redacts recognizable credential/location/ID
patterns, indents text and caps each field at 480 characters with `[truncated]`.
This display filtering does not rewrite admitted guidance or receipt evidence.
It is not a general detector of secrets embedded in natural-language advice.

Illustrative one-decision excerpt (not live acceptance evidence; milestones
appear only when reached, consultation is optional, values come from receipts):

```text
[info] [doom] Browser lease acknowledged
[info] [doom] Initial observation verified: E1M1, tic 1
[info] [agent] DoomPlayAgent request started (initial image supplied)
[info] [landmarks] Consultation complete: 2 candidates, 1 selected (historical, unverified)
[info] [decision] Current navigation objective:
    Can the opening ahead be reached?
[info] [decision] Proposed gameplay guidance (advisory):
  Objective:
    Can the opening ahead be reached?
  Uncertainty:
    Make a brief straight-ahead probe; passability remains unverified.
[info] [decision] Decision 1 of 1; run allowance acknowledged
[info] [decision] Applied gameplay guidance (CAS revision 2; scoped advisory only):
  Objective:
    Can the opening ahead be reached?
  Uncertainty:
    Make a brief straight-ahead probe; passability remains unverified.
[info] [decision] Fresh observation verified after guidance CAS
[info] [decision] Submitting guarded controller decision request; provider dispatch not yet known
[info] [decision] Controller receipt validated: completed; SDK invoked: true
[info] [decision] Verified action: forward, 6 tics (tic 1 → 7)
[info] [decision] Budget verified: 1 SDK attempt used / 1 total; reserved=1, remaining=0
[warn] [run] Run failed: MAIN_FAILED; stage=final_json, code=JSON_PARSE_INVALID
[info] [cleanup] CLI close attempts finished; child exit evidence is reported per owner
```

`failureDiagnostic` is null on success, otherwise `{stage, code}`. Stages locate
setup, attach, initial observation, provider initialization, parent stream,
callback correlation, completion awaiting/checks, provider invariants, final
JSON/schema/grounding or cleanup. Fixed codes distinguish `JSON_PARSE_INVALID`,
`OUTPUT_LIMIT`, `SCHEMA_INVALID`, `COMPLETION_METADATA_INVALID`,
`PROVIDER_INVARIANTS_INVALID`, `OBJECTIVE_MISMATCH`,
`RECEIPT_GROUNDING_MISMATCH`, `ATTRIBUTION_MISMATCH`, invalid consult/child
receipts, stream rejection, cancellation and cleanup failure. Other causes remain
`unknown`; no exception messages, rejected model text, schema messages or unknown
field names enter the diagnostic. Parent-finalization failure retains
`MAIN_FAILED`, nonzero exit, the independently verified controller receipt and
final accounting. These diagnostics do not establish the earlier live failure's
root cause. CLI provider cleanup still does not release the lease: press **Stop Agent**
in the browser before another attach. No retry or extra decision is added.

Both agents use independent CLI provider owners and native SDK 7 tools. Hermes
parses textual tool requests; the SDK executes the host callbacks and supplies
ordinary JSON results to the next model request. The parent permits at most three
SDK requests/steps (consultation, decision, final response); the child permits two
(lookup, final response). Direct action takes two parent requests. Both use
`maxRetries: 0`. Streams must fully drain and correlate every accepted tool call
ID/name/input/result with its host callback. Duplicate, orphan, foreign,
provider-executed and mismatched events fail closed. Reports distinguish SDK
requests/steps from host callback attempts, browser budget and verified actions.

The initial PNG is still the only image delivered to the parent. The internal
post-CAS `observe` is a host protocol step. Structured resulting-state feedback
does not demonstrate agent-controlled observation cadence or supply a second
image. An agent-visible `observeDoom` is deferred until its own image seam can be
proven. No generalized executor, continuous loop, automatic retry or reattach is
introduced.

**Operator-run examples only**, requiring separate live authorization:

```bash
# First fully stop any prior dev:agent process. Configure its ignored local file
# with AGENT_DECISION_BUDGET=1, then start a NEW broker/dev process:
npm --prefix app run dev:agent

# After browser preparation and credentials/readiness, in another terminal:
node --experimental-strip-types agent/src/main.ts --authorize-live-observation-cli --authorize-agent-one-decision

# Observation-only mode (no gameplay allowance consumed):
node --experimental-strip-types agent/src/main.ts --authorize-live-observation-cli
```

The operator prepares exactly one `http://127.0.0.1:5174/` dev:agent browser,
ensures no previous owner or active run, and presses **Stop Agent** to reset any
previous ownership before retrying. `AGENT_DECISION_BUDGET` is read from ignored
`app/.env.agent.local` and process-cached by the broker: editing it or changing an
environment variable without fully restarting the broker is insufficient. This
entry cannot supply/replenish the allowance. Budget is SDK attempts, not dollars.
Browser preparation may use local game assets and live requests can incur charges.
The browser needs usable provider credentials; Codex CLI needs its own credentials.
Do not enable provider debug logging. Optional historical consultation also needs
the existing valid read-only landmark snapshot; missing storage fails closed.

OpenRouter is the browser default; agent `AGENT_MODEL=gpt6` chooses
`openai/gpt-6-luna-decisions` **through OpenRouter**, while the default `jev`
chooses `typesafe/jev-1.14`. This does not select the experimental direct OpenAI
endpoint (`VITE_DECISION_PROVIDER=openai`). The CLI reasoning model is separate
from the browser Decisions model. No credential/model/provider files were changed.

**The browser lease is retained.** Successful attach reports `held`; lost/uncertain
attach reports `possibly-held`. CLI provider cleanup, process exit and deleting lease files
do not revoke browser ownership. Press **Stop Agent** before every retry. No
revoke/detach is implemented. Owned instructions files are removed; typed-client
lease/PNG files remain in their separate private directory. Reports preserve
unknown outbound delivery before claim/CAS/decide transport. Cancellation or the
120-second cooperative deadline fences all further mutations and late results;
neither proves remote processing or billing stopped. Public CLI provider cleanup never
proves subprocess exit, full tool isolation or successful network cancellation.

Offline verification (synthetic PNGs, fake typed HTTP transport without servers,
in-memory landmark data and deterministic provider streams; no historical DBs):

```bash
node --experimental-strip-types --test --test-skip-pattern='local snapshot integration' agent/tests/*.test.ts
node app/node_modules/typescript/bin/tsc -p agent --noEmit
git diff --check
```

The skip pattern excludes historical-snapshot integration. Synthetic throwaway
SQLite fixtures remain included; no historical database is read or mutated.
Success fixtures request ordinary tools from fake V4 models; the real SDK executes
callbacks and forwards their results to subsequent model steps. A separate Hermes
fixture emits textual requests and proves the full nested consultation/action/final
JSON sequence, including malformed final markup rejection without erasing a verified
synthetic receipt. Temporary SQLite fixtures are isolated; the historical-snapshot
integration test is explicitly excluded. Offline checks do not establish live
Codex, App Server, Decisions, browser or Doom correctness. This cleanup performs
no live inference or historical database access.

## Runtime and dependency map

The package now lives at the repository root in `agent/`. It remains
`doom-play-agent-cli-sdk7`; it no longer includes the ACP provider, codex-acp,
SDK 6, descriptor conversion, or the abandoned bounded-N supervisor. Their source,
tests and historical guidance remain available in Git history. Ignored private
artifacts are untouched. The independent
`../experiments/codex-cli-ai-sdk7-probe/` is reference material, with no runtime
or build dependency from this package.

Direct runtime dependencies are pinned to `ai@7.0.159`,
`ai-sdk-provider-codex-cli@2.4.0`, `@ai-sdk-tool/parser@5.1.6`,
`consola@3.4.2` and `zod@4.6.7`. Development dependencies are
`@ai-sdk/provider@4.0.35` (V4 offline model fixtures) and
`@types/node@22.20.0`. Node 22.20.0 and the app's TypeScript 7.0.2 are the
existing supported tools. The existing lockfile pins transitive dependencies.
The original `skipLibCheck` setting remains: removing it exposes a missing
`json-schema` declaration in the retained provider dependency. Strict checking
of experiment source and tests is unchanged.

| Retained module | Responsibility |
| --- | --- |
| `main.ts` | Inert authorization gate, verified bootstrap, agent/tool composition, bounded report publication and cleanup. |
| `doom-play-agent.ts` | Parent agent, optional child consultation, decision/final JSON grounding. |
| `landmarks-tool-loop-agent.ts` | Read-only child agent with one SDK-owned `findLandmarks` callback. |
| `guarded-decision.ts` | Unchanged one-shot claim/CAS/fresh-observation/decision callback and receipt/accounting validation. |
| `cli-provider.ts` | Independent provider owners, Hermes middleware and fail-closed warning/native-event fences. |
| `native-tools.ts` | SDK `tool({ inputSchema, execute })`, envelope-to-JSON presentation and callback correlation. |
| `agent-stream.ts` | Bounded stream consumption and ordinary SDK call/result correlation. |
| `agent-lifecycle.ts` | Asynchronous CLI initialization fences and owner cleanup, including late settlement. |
| `live-observation.ts` | Shared typed controller DTO, lease, PNG and resulting-state validation. |
| `landmarks-tool.ts` | Fixed read-only historical query, bounded unverified evidence and selection validation. |
| `landmarks-completion.ts` | Child completion metadata and grounded selection validation. |
| `operator-console.ts` | Stderr milestones and sanitized guidance display. |
| `doom-play-agent-smoke.ts`, `landmarks-tool-loop-agent-smoke.ts` | Existing CLI/Hermes archived-data runners; explicit `--authorize-cli` gate, no gameplay. |

The removed subsystem consists of `supervisor.ts`, `supervisor-workflow.ts`,
`supervisor-cli.ts`, `supervisor-acp.ts`, `doom-proposal.ts`,
`find-landmarks-acp-smoke.ts`, their two dedicated test files and
`SUPERVISOR.md`. Neither current agent imports that subsystem. Shared observation
and receipt validation stay; unused ACP lifecycle helpers and provider-event
nesting are removed.

### CLI and Hermes boundaries

`cli-provider.ts` uses the existing local Codex executable, `gpt-6.1-sol`,
stateless threads, read-only sandbox, on-request approvals and 15-second
connection/request limits. Construction is inert; authorized initialization
checks the first model-list page without fallback. Both agents replace their
instructions per step, and use `toolChoice: 'none'` for synthesis only after the
required callbacks settle. No tool results are fabricated in instructions.

The CLI fence omits Hermes's empty `tools: []` before provider invocation:
the pinned provider warns about any defined tools value, including an empty list.
Nonempty native tool declarations are rejected before invocation. Provider warnings,
native tool events and approval requests abort without retaining arbitrary provider
text. Cancellation keeps precedence; no fallback or retry is introduced.

Initialization and late `doStream` startup remain fenced; late settlements close
again. A returned `close()` does not prove subprocess exit. Exit is labeled observed
only when the provider's exit logger reports it. Read-only mode and filtered events
do not establish full internal-tool isolation or remote cancellation. A failed
provider image write may leave provider-owned temporary files. Neither cleanup nor
process exit releases the browser lease: use **Stop Agent**.

The archived-data smokes remain separate from `main.ts`. They access saved
observations and historical SQLite only after explicit live authorization; neither
supplies an image. The snapshot stays fixed to the worktree's ignored
`.local/doom-memory.sqlite`. Missing storage or a path override fails closed;
there is no creation, copying, migration, fallback or live memory write.

## Evidence and offline checks

The established live CLI baseline (reported before this cleanup) completed one
`turn_left` action: 6 requested/reported/verified tics, tic 1 → 7. It exercised
one parent SDK-owned `executeGuardedDecision` callback and two parent SDK
requests, with validated stream, guarded receipt, budget accounting, final JSON
and completion. It performed **no landmark consultation**. The child pathway is
covered offline but remains unproven in a real parent/child inference run.
Relocation does not require repeating that live run.

| Retained test file | Coverage |
| --- | --- |
| `main.test.ts` | Authorization, exact image input, guarded callbacks/receipts, budget/CAS/Stop/failure paths, final grounding and full nested Hermes/SDK sequence. |
| `doom-play-agent.test.ts` | SDK-owned parent/child callbacks, attribution, stream/callback correlation, duplication/overlap and cancellation failures. |
| `landmarks-tool-loop-agent.test.ts` | Synthetic SQLite read-only retrieval, native tools, selection and completion validation; optional historical integration. |
| `cli-boundary.test.ts` | Inert owners, image conversion, initialization/close races, native-event rejection and provider-warning/empty-tool-list fencing. |
| `native-fixture.ts` | Shared deterministic V4 streams and installed provider's pure settings-warning mapper; no inference. |

The ACP-only supervisor/bridge suites and ACP converter/authentication tests are
removed. Mixed callback/evidence tests now use native SDK tools and CLI owners.
Delayed initialization and failed-owner cleanup coverage remains in the CLI suite.

From the repository root, offline only:

```bash
npm --prefix agent ci
npm --prefix agent ls ai --all
node app/node_modules/typescript/bin/tsc -p agent --noEmit
node --experimental-strip-types --test --test-skip-pattern='local snapshot integration' agent/tests/*.test.ts
node --experimental-strip-types agent/src/main.ts --help
git diff --check
```

Keep the historical integration excluded when historical database access is not
authorized: the unchanged npm test script does not exclude it automatically.
The remaining tests use synthetic PNGs, fake transports, deterministic model
streams and isolated throwaway SQLite files. No broker, browser, App Server or
real model is started.
Package installation and any live invocation still require operator authorization.
