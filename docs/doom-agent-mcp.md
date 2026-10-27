# Local Doom MCP gameplay tools

`$doom-decisions play` supervises one bounded foreground run through the eight
existing MCP tools. No mode modifier or CLI fallback is supported. The skill
requires all eight tools before attachment; missing, disabled, disconnected or
ambiguous tools end play without claiming or consuming a run. `doom_attach` is
the first Doom domain call, and all later Doom operations use MCP directly.

`app/agent-mcp.mjs` imports `runAgentCli` directly. It creates no HTTP listener,
controller, grant, lease cache or budget ledger. Initializing/listing/closing the
MCP connection calls no agent operation. The existing `dev:agent` broker and
browser/controller remain authoritative; neither an MCP restart nor reconnection
renews their process allowance. The human's **Stop Agent** browser button remains
the only Stop entry point. There is no MCP Stop/reset/rearm tool.

The app-local development dependencies pin MCP server/client **2.4.0** and Zod
**4.6.7**. SDK v2 requires Node >=20; the project uses Node **22.20.0**, ESM and
native TypeScript stripping for the existing CLI imports. The server uses the
official `serveStdio` entry, including its legacy-client handshake support.
There are no startup downloads. These dependencies are not imported by the web
application or bundled into its browser/Worker modules.

## Operation parity

Every gameplay input rejects unknown keys and invalid types. File paths are absolute,
IDs use the existing agent UUID validator and revision is a nonnegative safe
integer. There are no MCP duration/model/action defaults or overrides.

| MCP tool | Inputs | Existing operation / complete output |
| --- | --- | --- |
| `doom_attach` | `{}` | `attach`; `{ownerId,pageId,epoch,leaseFile}` |
| `doom_observe` | `leaseFile` | `observe --lease`; full verified observation/local `pngPath` plus configuration/revision/run |
| `doom_get_config` | `leaseFile,sessionId` | `get-config --lease --session`; full configuration/revision/run result |
| `doom_get_prompt` | `leaseFile,sessionId` | `get-prompt --lease --session`; full instructions/revision/run result |
| `doom_start_run` | `leaseFile,observationId,sessionId,revision` | `start-run --lease --observation --session --revision`; full initial configuration/run result |
| `doom_set_config` | `leaseFile,sessionId,runId,revision,configFile` | `set-config --lease --session --run --revision --config-file`; full updated configuration/run result |
| `doom_set_prompt` | `leaseFile,sessionId,runId,revision,instructionsFile` | `set-prompt --lease --session --run --revision --instructions-file`; full updated instructions/run result |
| `doom_decide` | `leaseFile,observationId` plus all-or-none `sessionId,runId,revision` | `decide --lease --observation [--session --run --revision]`; full decision receipt and resulting observation/PNG |

The play skill always supplies all three scope fields to `doom_decide`.
The shared implementation and its internal CLI/test utilities remain intact.

All non-attach gameplay outputs preserve `pageId,epoch,commandId`. Configuration/prompt
outputs preserve `sessionId,revision,configuration` or `instructions`, and `run`
with every counter. Observations retain every telemetry, native/Canvas hash,
PNG hash, facing probe and previous-action field. Decisions preserve outcome,
reason, input observation ID, SDK invocation, action, all requested/reported/
verified/cumulative tics, uncertainty, provider/model/usage metadata and the
complete after-action observation. No fields are summarized or removed.

Only standalone `doom_observe` adds top-level `revision`, `configuration` and
`run`; its existing `sessionId` scopes both evidence and settings. Configuration
contains exactly `instructionTemplate`, `tics`, `includeReadyWeapon`, `includeAmmo`,
`includeHealth`, `includeFacingProbe` and `includePreviousAction`. Run is null before
claim, otherwise `{runId,active,limit,reserved,sdkInvoked,remaining}`, with the same
validation and semantics as `doom_get_config`. The composite parser reuses the
strict observation and config validators. The broker checks the issued run ID and
frozen limit; PNG hash verification and local-path conversion remain unchanged.
`doom_decide` observations retain their existing shape, without these config fields.

Capture keeps the controller busy through passive native/Canvas/PNG verification.
After the existing cleanup restores ready, synchronous finalization rechecks the
lease, session, captured observation ID/tic/epoch and unchanged configuration
identity, reads through the existing ready-gated config path, and checks continuity
again before returning detached combined values. Changes during capture or
finalization reject publication. A valid snapshot never guarantees later admission;
`doom_decide` retains independent freshness/revision/run and dispatch fences.

The source of truth is [the shared CLI](../scripts/doom-agent.mjs),
[observation/decision DTOs](../app/src/agent-observation.ts) and
[configuration DTOs](../app/src/agent-control.ts).

MCP returns compact JSON text plus the same complete object as
`structuredContent`. `isError:false` means a valid receipt was delivered, matching
CLI exit 0; it does not turn `not-admitted`, `api-failure`, `stopped`, `retired` or
`terminal` into completed gameplay. Existing verification/termination rules apply.
CLI exceptions use the same exported sanitizer, with `{error}` in an MCP
`isError:true` result instead of CLI stderr/exit 1. SDK input-schema rejection
uses its own `isError:true` validation message before the CLI runs. Protocol or
connection failure can instead mean no tool result. None permits an automatic
retry. Diagnostics go to stderr; stdout is JSON-RPC only.

Temporary `configFile`/`instructionsFile` inputs remain required. PNG creation and
exclusive file writes are the CLI's existing implementation. `decide.pngPath`
contains the verified **after-action** image; `beforeObservationId` identifies
the input, even though the PNG filename uses that command/input ID.

## Advisory navigation memory (Milestone 1 storage)

The same stdio process also exposes exactly two independent notebook tools,
`doom_memory_find` and `doom_memory_record` (ten tools total). They do not attach,
read browser state, call the bridge/provider, claim a run or select an action.
They support explicit offline notebook work and the play skill's narrow advisory
notebook exception. With a namespace established from explicit current-session
context, play looks up the first region after post-start observation/config/image
checks, then opportunistically on new regions, landmark returns or looping. It
records only meaningful new findings at eligible pre-decision checkpoints; nearby
notes remain unverified leads. Unknown namespace skips memory. Isolated notebook
failures do not block otherwise eligible gameplay; Stop/terminal and gameplay
errors still take precedence, with no memory flush on exit. See the
[skill](../.agents/skills/doom-decisions/SKILL.md#advisory-navigation-memory) for the full policy.

Every note and appended assessment is **advisory and unverified**. A required
plain-text `source` attributes a claim; it does not authenticate telemetry,
screenshots, traversal or IWAD identity. Status is always `unverified`; status
inputs and other unknown fields are rejected. Text claiming success is still
unverified text. No live observation/receipt association is implemented.

Storage defaults to `<repository-root>/.local/doom-memory.sqlite`, resolved from
the module location, independent of cwd. An optional **absolute** `DOOM_MEMORY_DB`
environment override selects another file; relative/empty overrides fail on a
memory call without affecting ordinary gameplay tools. The host must permit
writing that location. No `.env` file is read. There is no implicit seed data.
Tests always select separate temporary files, never the normal notebook.

Lookup opens existing storage read-only. If absent, it returns no candidates
without creating a file/directory or loading SQLite. A valid create operation
initializes storage; append against absent storage fails. Built-in `node:sqlite`
loads lazily and can emit Node 22.20.0's experimental warning to stderr only when
used. Module import, tool listing and gameplay-only use do not load it.

There are two tables: `notes` stores the immutable original claim, namespace,
anchor, source, next question and creation date, plus its current revision;
`entries` stores ordered, dated source/assessment appends and request-id receipts.
Revision 1's receipt represents creation; subsequent revisions hold assessments.
Writes use short `BEGIN IMMEDIATE` transactions, a 100 ms busy timeout and DELETE
rollback journaling. One durable SQLite file may have a temporary `-journal`
during writes; no WAL/checkpoint service is used. Different processes can reopen
the same path. Busy storage fails without an automatic retry. Unsupported schema
versions or foreign databases are rejected; there is no migration framework.

Tool arguments (all objects reject unknown fields):

| Tool | Arguments | Result |
| --- | --- | --- |
| `doom_memory_find` | `mapNamespace, x, y, headingDeg, radius? = 64, limit? = 3` | `caution, candidates[]` with ID, revision, source, anchor, original hypothesis, next question, creation date, `unverified` status, distance, circular heading difference and all ordered assessment entries |
| `doom_memory_record` create | `operation: "create", requestId, mapNamespace, x, y, headingDeg, hypothesis, nextQuestion?, source` | `noteId, revision: 1, status: "unverified", replayed` |
| `doom_memory_record` append | `operation: "append", requestId, noteId, expectedRevision, assessment, source` | `noteId, revision, status: "unverified", replayed` |

Coordinates are Doom units in [-32768, 32768], heading is degrees in [0, 360),
radius is positive and at most 1024, and limit is an integer from 1 through 10.
Namespace/request IDs are nonblank text up to 128 characters; source/next
question up to 512; hypothesis/assessment up to 2000. Note IDs are UUIDs.
Namespace matching is exact after trimming surrounding whitespace. Lookup filters
by XY radius, sorts by distance then circular heading difference then stable ID,
and never excludes a candidate just because it faces another direction.

For example, call `doom_memory_find` offline with:

```json
{"mapNamespace":"unverified:shareware-doom1-e1m1","x":1095.593,"y":-2969.434,"headingDeg":319.921875}
```

To explicitly create a note, call `doom_memory_record` with:

```json
{"operation":"create","requestId":"pool-recess-1","mapNamespace":"unverified:shareware-doom1-e1m1","x":1095.593,"y":-2969.434,"headingDeg":319.921875,"hypothesis":"The apparent tan-column recess might continue beyond the pool room; traversal remains unestablished.","nextQuestion":"Does a clearer view show continuous player-width floor beyond the wall end?","source":"Run A, decision 22, tic 133; docs/navigation/doom1-e1m1-session-01a179df.md; archived Codex interpretation"}
```

Append using the returned `noteId`, its revision, a new request ID, required source
and `assessment`. Repeating the exact normalized request ID/payload returns its
original resulting revision with `replayed: true`, even if the note has since
advanced. Conflicting reuse returns `memory-request-conflict`; a stale new append
returns `memory-revision-conflict`. Neither changes the original or earlier entries.
Lookup includes all assessments so disagreement stays visible; long histories
can increase response size. Do not put credentials, prompts, auth data or complete
provider payloads in this notebook.

Proximity establishes neither the same viewpoint nor map identity, passability
or navigation success. `unverified:shareware-doom1-e1m1` is a caller-chosen label,
not an authenticated IWAD key. A lookup at Run D #14's pose `(1123.944, -2981.558)`
and `19.6875°` can return A's note about 30.8 units away with a 59.8° heading
difference. That is regional context, not recognition of the same view or proof
that A's recess is D's separate human-described continuation.

PNG storage/retrieval is deliberately unsupported in Milestone 1. The retained
[A note](navigation/doom1-e1m1-session-01a179df.md) links its historical PNG, which
Codex can explicitly open with `view_image`; notebook text alone does not display
or authenticate its pixels. No D screenshot is retained here.

`app/tests/doom-memory.test.ts` exercises actual stdio MCP child processes against
isolated temporary databases with fail-on-use fetch. It checks missing-storage
lookups, A/D regional retrieval, namespace/radius exclusions, three-process
persistence, attributed append/retrieval, idempotency, conflicts, unverified-only
schemas, locking and schema-version rejection. These are offline persistence
checks, not navigation improvement or live Doom/Decisions evidence.

## Project setup and foreground play

The tracked **worktree-local** `.codex/config.toml` already registers the
`doom_decisions` stdio server with all eight tool approval modes set to `approve`.
Keep those approval choices. `enabled = true` loads the server; `required = false`
allows Codex startup without it, while the skill still requires all eight tools
for gameplay. Do not change global `~/.codex` settings or add credentials here.

1. Open Codex from this trusted worktree. A restart/fresh session may be needed
   to discover project MCP registration; check `/mcp` for all eight tools.
   An unavailable server blocks play, with no alternate gameplay transport.
2. The human privately configures a positive safe-integer `AGENT_DECISION_BUDGET`
   in `app/.env.agent.local`, runs `npm --prefix app run dev:agent`, manually
   opens `http://127.0.0.1:5174/` and lets the game prepare to verified readiness.
   Gameplay can transmit screenshots and included game-state data to the selected
   Decisions provider and incur charges. Existing project execution approvals
   still apply.
3. Invoke **`$doom-decisions play`** once. Codex attaches, observes and views the
   initial PNG, reads configuration from that result, cross-checks prompt and claims
   the single allowance once. It observes/views afresh after starting, even at
   identical tic/pixels. Each fresh observation supplies configuration/revision/run
   before a decision or after CAS; no routine follow-on `doom_get_config` is needed.
   It chooses 1–35 tics (initial/default 6) with an observable
   rationale before every nondefault decision; the Decisions API chooses actions.
   CAS edits use temporary files and require fresh combined observations afterward.
4. Each healthy completed decision requires its verified after-action PNG to be
   viewed. There is no routine post-decision config read; final normal exhaustion
   requires one standalone `doom_get_config` accounting read showing
   `reserved === limit` and `remaining === 0`. Errors, conflicts, uncertain outcomes
   or disconnect end play without retry or recovery. Validated Stop permits only the exact Stop reply;
   verified terminal permits only its prescribed final PNG inspection and reply.

The [play skill](../.agents/skills/doom-decisions/SKILL.md) defines the complete
ordering, evidence and termination rules. Browser budget enforcement and **Stop
Agent** remain the actual authority limits; MCP adds no permission system. A new
allowance requires the human's full `dev:agent` process restart for a separate
invocation. Disabling or reconnecting MCP never enables CLI play or renews a run.
Actual Codex tool discovery/rendering remains a human acceptance check.

## Evidence and limits

Offline tests use the existing synthetic broker/controller, fake provider
transport and synthetic PNG fixture. The matrix replays actual validated broker
responses through CLI and MCP with identical generated IDs and file paths, then
compares the entire result and written PNG bytes. Other cases cover schema/file
errors, CAS conflicts, stale scope/observation, exhaustion, Stop, terminal prefixes,
uncertain retirement, lost responses and cancellation/restart without replay.
Combined-response cases also cover busy-to-ready invalidation, settings changes
while hashing, full seven-field CAS revalidation, malformed config/counters,
unissued run/limit, and maximum-length escaped/Unicode instructions through MCP.
Real child-process stdio tests exercise SDK legacy and automatic negotiation,
initialization/listing without bridge calls, complete result/error framing and
stdin EOF exit. This proves neither Chrome, real native Doom nor paid Decisions
correctness.

The SDK test client surfaces both compact text and structured output. The tested
wire includes **two copies** of a successful domain payload. The skill uses
`structuredContent` with JSON text fallback and does not add duplicate
model-facing serialization. The serialized eight-tool catalog measured
**3,128 UTF-8 bytes** in both tested negotiations; there are no server instructions.
No MCP performance superiority is claimed.

With synthetic PNGs, compact single-domain outputs measured 1,758 bytes for the
default instructions, 97,285 bytes for accepted 16,000-character escaped text and
49,290 bytes for 16,000 Unicode characters. Each combined output was 198 bytes
smaller than the sum of separate observation/config outputs, before MCP framing.
These fixtures prove field preservation, not universal host output capacity or
wall-clock/token savings; real gameplay PNGs and instructions vary.

Cancellation/connection close aborts the adapter's owned fetch through the SDK
request/lifetime signals, preserving the CLI's 15-second/35-second deadlines.
It does not prove a provider stopped processing/billing. A lost response after a
consumed action returns a sanitized unknown-completion error, never a fabricated
success or second attempt. The fake cancellation test demonstrates signal/close
propagation and retained controller reader ownership; real host cancellation and
transport delivery timing remain unverified. After idle MCP exit, the existing
browser lease is not proactively revoked by a new tool; the human uses Stop.

Reopen the startup PNG after `doom_start_run`: prior inspection outside the active
run cannot establish unchanged run ownership for post-start reuse. A small,
separately human-authorized browser smoke can check tool discovery, one bounded
run, image delivery and final accounting. Record sanitized identities, counters
and action/tic/frame receipts; it is not a transport benchmark. Stop and terminal
acceptance remain governed by the existing isolated trial procedures.
