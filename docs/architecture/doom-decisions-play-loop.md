# `$doom-decisions play`: current foreground architecture

## Purpose and provenance

This note describes the implemented transport/execution pipeline and the
skill-directed supervision loop, especially where navigation reassessment fits.
It describes no prospective objective-completion behavior.

Inspected checkout: branch `main`, HEAD
`3415264d1e0f35db50f4133a715ca553771db319`. The working tree, including all
relevant source and skill files, was clean before this document was added.
Claims were checked by bounded source inspection: the current skill and native
tool adapter, CLI/broker contracts, browser command handling, controller/provider
invocation, Worker/native stepping and notebook implementation. No gameplay,
provider request, browser/server, database operation or tests were run.

Here, **code-enforced** means a located implementation guard or transformation;
**skill-directed** means Codex must follow the procedure. Neither means this
investigation exercised the behavior at runtime. The secondary
[MCP guide](../doom-agent-mcp.md) describes synthetic tests and owner-reported
smokes; those are not checks performed here. The historical
[supervision-overhead investigation](../investigations/agent-supervision-overhead.md)
is not authority for the current loop.

## Roles and control boundaries

| Role | Responsibility and authority |
| --- | --- |
| Human and browser | Human configures the process allowance, starts `dev:agent`, opens the page, waits for preparation and can click **Stop Agent**. The page displays verified frames and owns the live controller/Worker. |
| Codex following the skill | Selects one testable high-level navigation question from current evidence and any warranted historical leads; communicates actionable intent through effective instructions; chooses tics before action selection; inspects every receipt and required native image. These reasoning duties are procedural. |
| Native MCP adapter | Registers eight gameplay/configuration tools plus two independent memory tools. Adapts tool inputs to `runAgentCli` and delivers complete JSON text plus native PNG content. It owns no gameplay allowance or controller. |
| Shared CLI | Reads the lease/settings files, constructs correlated commands, validates responses/settings acknowledgments and PNG hashes, and writes verified PNG bytes to temporary files for the adapter. Codex does not shell-drive this CLI during play. |
| Vite bridge/broker | Owns one page/lease and one pending command, issues the single process allowance, routes commands over SSE, and fences result acceptance against revocation and correlation. |
| Browser adapter/controller | Validates incoming commands, owns session/readiness/settings/admission, reserves attempts, counts SDK invocations, fences dispatch on Stop, and verifies native execution and resulting frames. |
| Decisions provider | Selects each low-level action through the application's provider pipeline. The exposed action set is `neutral`, `forward`, `turn_right`, `backward`, `turn_left`, `fire`, `use`; duration is already frozen. |
| Worker and Doom WASM | Worker executes controlled native steps and samples observations. Controller independently checks the returned per-tic evidence and frame/Canvas linkage. Native state supplies pose, health, map and probe facts, not navigation-objective judgments. |
| Advisory SQLite notebook | Stores original hypotheses/observer anchors and appended assessments. It neither chooses the run objective nor validates live lease, map identity, Stop or gameplay success. |

The skill assigns navigation intent and horizon to Codex, and every low-level
action to the provider ([skill, opening and foreground procedure](../../.agents/skills/doom-decisions/SKILL.md#foreground-procedure)).
Concrete wiring is in
[`main.ts`, bridge ports](../../app/src/main.ts#L424-L459),
[`createAgentMcpServer`](../../app/agent-mcp.mjs#L86-L196),
[`agentNext`](../../app/src/session-controller.ts#L1317-L1423), and
[`masks` / `validateChoice`](../../app/src/decision.ts#L4-L103).
The notebook is a separate tool path directly from MCP to
[`findMemory` / `recordMemory`](../../app/doom-memory.mjs#L214-L361).

## Startup, attachment and claim

The human supplies a positive safe-integer `AGENT_DECISION_BUDGET`, starts
`npm --prefix app run dev:agent` and manually opens
`http://127.0.0.1:5174/`. This is human startup, not a skill instruction to launch
anything. In agent mode the page selects a configured local IWAD when supplied,
otherwise included Freedoom. Preparation constructs a fresh Worker, matches
asset digests, initializes/prepares E1M1, verifies exactly one neutral tic, passive
captures/renders and a five-second unchanged idle check before readiness. It
makes no Decisions request. Only then is the browser bridge registered
([`initialize`](../../app/src/main.ts#L903-L918),
[preparation closeout](../../app/src/session-controller.ts#L1530-L1618),
[bridge readiness gate](../../app/src/main.ts#L424-L459)).

The skill first requires all eight native gameplay/configuration tools and checks
whether both optional memory tools are available. Missing a required tool ends
play before attachment; missing either memory tool disables memory only. It calls
`doom_attach` exactly once as its first Doom-domain operation, then one standalone
`doom_observe`, inspecting both the complete receipt and directly delivered image.
It requires `run: null`, reads the combined effective configuration/revision/run,
and does not routinely add get-config/get-prompt calls. These ordering and image
inspection duties are [skill-directed](../../.agents/skills/doom-decisions/SKILL.md#native-calls-and-receipt-provenance).
Attachment copies saved human instructions once into lease-owned settings, with
all five inclusion flags true and independent `tics: 6`. Agent edits do not write
human saved settings or drafts ([`attachAgent`](../../app/src/session-controller.ts#L311-L328)).

The identifiers have distinct jobs:

| Identifier | Meaning and enforcement |
| --- | --- |
| Lease / `leaseFile` | CLI stores `{pageId, ownerId, epoch}` in an exclusive temporary file. Page identifies the browser instance; owner identifies the attached caller; epoch identifies this attachment. Broker/browser compare these values; the file is a local carrier, not an allowance. |
| `sessionId` | Controller-generated identity for the prepared game session, retained across healthy decisions. Broker and controller reject changed session correlation. It is distinct from the bounded run ID. |
| `runId` | Broker-generated identity for the one issued process allowance, bound to page/owner/epoch/session. Controller retains its frozen limit and mutable accounting. |
| `observationId` | A new ID for each verified capture. Claim/decision reference the current controller checkpoint, tied to session, epoch, tic and configuration identity. A decision consumes its input checkpoint. |
| `revision` | Controller configuration CAS revision, separate from notebook note revisions. Settings writes require the current value, increment it on success and invalidate old observations. |
| `commandId` | Transport correlation/deduplication. CLI uses the input observation ID for a decision command; other commands receive a fresh UUID. It cannot grant replay permission. |

See [CLI lease/command construction](../../scripts/doom-agent.mjs#L15-L101),
[broker ownership/issuance](../../app/agent-bridge.mjs#L135-L145),
[`startAgentRun`](../../app/src/session-controller.ts#L381-L408), and
[`captureAgentObservation`](../../app/src/session-controller.ts#L826-L914).

`doom_start_run` is called once with the inspected standalone observation's
session, observation ID and revision. The broker marks issuance nonrefundable
**before** page dispatch, generates `runId` and attaches the process-frozen limit.
The controller also marks the claim used before preflight, validates readiness,
scope and checkpoint, then initializes `reserved = sdkInvoked = 0` and
`remaining = limit`. Attachment/observations/settings grant no attempts.
Missing budget, rejected/ambiguous claim or a closed allowance ends the skill;
no reattachment or retry replenishes it. Process issuance survives Vite internal
restart via a process registry; a separate allowance needs the human's full
process restart ([`processAgentAllowance`](../../app/agent-bridge.mjs#L18-L69),
[issuance routing](../../app/agent-bridge.mjs#L285-L337),
[`beginAgentRun`](../../app/src/session-controller.ts#L363-L408)).

After claim, the skill mandates another standalone observation and image
inspection, even at the same tic/pixels. Claim acknowledgment is not decision
input. At this first healthy active checkpoint Codex announces **Run objective**,
**Basis**, and **Success or reconsideration evidence**, after eligible startup
memory reads. That is a conversational navigation question, not a new application
DTO ([skill steps 1–3](../../.agents/skills/doom-decisions/SKILL.md#foreground-procedure)).

## One healthy iteration

1. **Observe and inspect.** Codex calls standalone `doom_observe`; controller
   `observe` requires a ready, idle, nonterminal game with neutral-first proof.
   It takes passive snapshots/renders and hashes the captured Canvas against the
   verified native frame, checking unchanged native state around capture. After
   returning to ready it synchronously rechecks continuity and combines the
   detached observation with configuration/revision/run. Codex must inspect the
   text and actual native image, and require active run/remaining allowance.
   The observation exports eligible telemetry regardless of provider inclusion
   flags ([`observe` / `captureAgentObservation`](../../app/src/session-controller.ts#L739-L914)).
2. **Assess intent and optional history.** At eligible checkpoints Codex may
   retrieve/record advisory history under the restrictions below. It compares the
   current navigation question and inspected evidence with the entire effective
   `instructionTemplate`. Commentary and notebook text do not automatically enter
   provider requests ([skill steps 3–5](../../.agents/skills/doom-decisions/SKILL.md#foreground-procedure)).
3. **Conditionally update settings.** Materially stale target, bearing, phase or
   next-test guidance requires a disclosed prompt replacement. Before every prompt
   replacement, Codex shows **Why change** and the complete **New Decisions API
   prompt** verbatim, retaining useful uncertainty and `{{tics}}`, writes that exact
   text to an absolute UTF-8 file and calls `doom_set_prompt`. Tics/flag edits use
   a complete seven-field JSON replacement via `doom_set_config`; a prompt change
   through it still requires disclosure. Controller checks ready/idle state,
   active run/session, run ID, revision, editor closure and DTO validity. Prompt
   writes adapt to the same configuration mechanism. Success increments revision,
   invalidates observations and preserves counters/run ID; CLI checks the exact
   submitted snapshot and revision increment. Any failed/conflicted/uncertain
   gameplay settings operation ends the skill. Success requires another standalone
   observation/image before deciding ([`agentConfig` / `agentPrompt`](../../app/src/session-controller.ts#L410-L508),
   [`changeConfiguration`](../../app/src/session-controller.ts#L296-L308),
   [CLI acknowledgment check](../../scripts/doom-agent.mjs#L78-L90)).
4. **Choose horizon, then admit.** Codex chooses integer tics 1–35 before every
   decision, initially/default 6; it edits only when the value changes and observes
   afresh after success. Every nondefault decision, even with repeated tics,
   requires a current observable reason and acknowledgment that the next action
   is unknown. It calls one scoped `doom_decide` with lease and latest standalone
   observation's ID/session/run/revision. `agentNext` checks scope, configuration
   identity and checkpoint freshness, synchronously increments `reserved`, reduces
   `remaining`, consumes the checkpoint and owns admission through cleanup and
   verification. Pre-create failures do not refund that reservation
   ([skill step 6](../../.agents/skills/doom-decisions/SKILL.md#foreground-procedure),
   [`agentNext`](../../app/src/session-controller.ts#L1317-L1423)).
5. **Application requests one action.** `runOneDecision` freezes duration and
   settings before asynchronous work, captures the current verified Canvas,
   and builds instructions with `{{tics}}` interpolation plus selected Game State
   text and PNG. The controller invokes its configured provider, not Codex.
   Immediately before SDK create, the hook increments `sdkInvoked` once without
   refund. OpenRouter is the default startup provider; its adapter calls
   `client.alpha.decisions.create` with choice criteria and retries disabled.
   Experimental direct OpenAI uses the same controller interface when explicitly
   selected. Provider output remains untrusted until `validateChoice` accepts one
   permitted action; no duration or combined action is selected by the provider
   ([request builder](../../app/src/decision-request.ts#L61-L128),
   [controller `decide`](../../app/src/session-controller.ts#L932-L994),
   [provider selection](../../app/src/main.ts#L45-L62),
   [`openrouter-decision-provider.ts`, `request`](../../app/src/openrouter-decision-provider.ts),
   [`validateChoice`](../../app/src/decision.ts#L70-L103)).
6. **Step and prove the result.** After the provider wait, controller verifies
   native state/counters stayed unchanged and applies the final Stop/identity
   fence immediately before native dispatch. Its `action` sends the selected mask
   and frozen tics to the persistent Worker. Worker `i11Action` calls WASM
   `stepNeutralControlled` once per tic, samples observations and checks each step,
   stopping at a terminal/unsupported prefix without an extra release tic.
   Native `G_A21Step` installs held input, builds/verifies a stock tic command,
   runs the ticker continuation and commits the tic. The main thread independently
   rechecks receipt steps with `verifyAction`, retaining verified prefixes and
   uncertainty. It then renders, verifies native pixel/Canvas hashes and captures
   the after-action PNG/telemetry. Only verified execution **and** resulting-frame
   capture yield `completed` (or verified `terminal` followed by retirement)
   ([execution ordering](../../app/src/session-controller.ts#L1149-L1243),
   [`action` / `render`](../../app/src/session-controller.ts#L655-L736),
   [`i11Action`](../../app/src/worker.ts#L36-L100),
   [`G_A21Step`](../../engine/doom/doomgeneric/src/g_game.c#L2372-L2439),
   [`verifyAction`](../../app/src/decision.ts#L117-L217)).
7. **Inspect, terminate first, then reassess.** The return path preserves outcome,
   input observation correlation, action, requested/reported/verified/cumulative
   tics, uncertainty, provider/model/usage and resulting observation. Broker/CLI
   validate DTOs/correlation and PNG hashes; CLI writes PNG bytes, then MCP delivers
   complete JSON text and a separate `image/png`, deliberately without
   `structuredContent` for image-bearing success. Codex inspects the full receipt
   and pixels and applies termination before any next call. A healthy completed
   result triggers target/guidance/next-experiment reassessment. Any warranted
   prompt edit waits for the next eligible standalone-observe checkpoint
   ([broker result fence](../../app/agent-bridge.mjs#L340-L468),
   [CLI result handling](../../scripts/doom-agent.mjs#L91-L110),
   [MCP response adaptation](../../app/agent-mcp.mjs#L120-L161),
   [skill step 7](../../.agents/skills/doom-decisions/SKILL.md#foreground-procedure)).

The after-action observation **must not supply the next decision's scope**.
The next iteration starts with standalone `doom_observe`, including after claim
and every successful settings write. This exact sequence and actual image viewing
are skill discipline: code tracks freshness, but `captureAgentObservation` also
sets the current checkpoint on the after-action path; it does not distinguish
that checkpoint by a standalone-only admission tag
([checkpoint assignment](../../app/src/session-controller.ts#L907-L914),
[admission check](../../app/src/session-controller.ts#L1375-L1388)).

```mermaid
sequenceDiagram
    actor C as Codex following skill
    participant M as MCP adapter and CLI
    participant B as Vite broker
    participant A as Browser controller
    participant P as Decisions provider
    participant W as Worker and Doom WASM
    C->>M: doom_observe(leaseFile)
    M->>B: Correlated HTTP command
    B->>A: SSE observe
    A->>W: Passive snapshots and render
    W-->>A: Native evidence and pixels
    A-->>B: Verified observation with config and run
    B-->>M: Fenced result
    M-->>C: JSON text and native PNG
    Note over C: Inspect pixels; assess objective, history, prompt and tics
    opt Material settings change
        C->>M: Scoped doom_set_prompt or doom_set_config from file
        M->>B: CAS command
        B->>A: Validate and replace settings
        A-->>B: New revision, unchanged counters
        B-->>M: Settings acknowledgment
        M-->>C: Checked acknowledgment
        Note over C,A: Repeat standalone observe and image inspection before deciding
    end
    C->>M: doom_decide with standalone observation scope
    M->>B: Correlated decision command
    B->>A: SSE decide
    A->>A: Validate and reserve; freeze tics and settings
    A->>P: Request one action with PNG and instructions
    P-->>A: Selected action
    A->>A: Validate choice, unchanged state and Stop fence
    A->>W: Action for frozen tics, then render and snapshots
    W-->>A: Per-tic receipt, native evidence and pixels
    A->>A: Independently verify action and resulting frame
    A-->>B: Decision receipt and after-action observation
    B-->>M: Fenced result
    M-->>C: JSON text and native PNG
    Note over C: Inspect; apply termination; reassess target, guidance and next test
```

## Navigation supervision and advisory history

The selected question belongs to Codex's current conversation context, with at
most one question and influential note ID/revision retained. It can come entirely
from the current scene. Multiple historical landmarks may remain active; an active
note is eligible unfinished exploration, not selection or ownership by this run.
The effective prompt must communicate the selected actionable intent before the
next decision; neither user-facing commentary nor a saved assessment substitutes
for that prompt. Material changes must be disclosed, but no ceremonial edit is
required when effective instructions already express the intent
([skill objective selection and memory policy](../../.agents/skills/doom-decisions/SKILL.md#advisory-navigation-memory)).

If both memory tools were available at startup and remain enabled, the first
healthy post-claim checkpoint requires two separately inspected reads: active
landmarks (`limit: 3`, no pose), then nearby notes (`radius: 128`, `limit: 3`).
Later lookups are event-driven, at most one per eligible checkpoint. Codex uses
only the current verified observation's `mapIdentity.mapKey` as namespace; it
converts raw observer pose as `x/65536`, `y/65536`,
`angle * 360 / 4294967296`. The canonical E1M1 key combines accepted raw IWAD
SHA-256 and slot, excludes session ID and can retrieve previous-session history
after a fresh lookup. DTOs verify key derivation; the notebook itself only accepts
a bounded caller-supplied namespace string. Namespace/session/ownership matching
and discarding stale candidates remain Codex duties
([map identity construction/parser](../../app/src/agent-observation.ts#L73-L158),
[skill namespace and lookup rules](../../.agents/skills/doom-decisions/SKILL.md#advisory-navigation-memory),
[notebook query schemas](../../app/doom-memory.mjs#L18-L57)).

The notebook's data model separates these meanings:

| Field or structure | Current use and limit |
| --- | --- |
| `hypothesis`, original `source`, `nextQuestion` | Immutable original claim, attribution and optional falsifiable question. Append cannot replace them. Latest suggested experiment belongs in assessment text. Source is attribution, never authenticated proof. |
| Observer `anchor` | Creation-time verified player pose under the skill, not coordinates of the target opening/stairs. Nearby distance and heading difference compare observer anchors, not target locations. |
| `isLandmark`, `isActiveExploration` | Mutable boolean pair; active requires landmark. Several notes may be active. Omitted append flags preserve both; provided flags replace the complete pair. |
| `entries` | Assessments ordered by note revision, each with source/time and flag snapshot. Storage also holds a revision-1 creation/request receipt; returned assessment history filters out its null assessment. Disagreements remain visible. |
| Note `revision`, `requestId` | Append CAS against the note head; request hash supports identical-payload replay returning the original revision, which may no longer be current. This idempotency does not authorize a skill retry. |

These semantics are implemented in
[`noteFromRow` / `withEntries`](../../app/doom-memory.mjs#L183-L211) and
[`recordMemory`](../../app/doom-memory.mjs#L271-L361).
`findMemory` selects active notes by both flags, creation time then ID, with
`hasMore` for truncation; nearby queries sort by distance, circular heading
difference, then ID. Neither ordering is navigational priority or recognition
([`findMemory`](../../app/doom-memory.mjs#L214-L269)).

Codex compares original hypotheses/questions and ordered assessments with current
images; proximity alone cannot identify an opening. Material historical influence
must be attributed contemporaneously by note ID/revision, specific advisory claim
and the guidance it influenced, separate from current verified facts. For the same
hypothesis, eligible records prefer append; genuinely different hypotheses can
create another note anchored at the observer. During play, at most one meaningful
record is permitted at a healthy pre-decision checkpoint. Inconclusive tests/local
abandonment keep exploration active; deactivation needs an evidence-grounded
resolution or justified retirement rationale. These judgments are skill rules,
not SQL validation of their truth. All returned notes remain `unverified`.

Target identity and bearing are maintained through reasoning: use stable visible
anchors and current screen-relative direction; reassess after movement/turns.
If lost/occluded/ambiguous, acknowledge that and seek reacquisition or a bounded
disambiguating view rather than silently substituting another opening.
Distinguish alignment/reacquisition, approach and access/traversability testing.
Update materially stale provider guidance at the next eligible checkpoint; no
fixed edit frequency or stationary-turn threshold exists
([skill steps 4–7](../../.agents/skills/doom-decisions/SKILL.md#foreground-procedure)).

**Current objective-completion gap:** the initial announcement defines observable
success or reconsideration evidence, and each healthy after-action inspection
explicitly requires reassessing target identifiability, guidance currency and the
next useful experiment. It does **not explicitly mandate a per-decision
classification against that objective's predefined success criterion**. The
explicit achieved/partially advanced/disproven/inconclusive classification occurs
at normal-exhaustion final assessment. This is a gap in prescribed intermediate
assessment, not evidence that it caused a gameplay failure. The inspected
configuration/run/decision DTOs contain no objective-completion field or evaluator
([skill steps 3 and 7 / final assessment](../../.agents/skills/doom-decisions/SKILL.md#final-assessment-after-normal-exhaustion),
[control contracts](../../app/src/agent-control.ts#L8-L71),
[decision contract](../../app/src/agent-observation.ts#L282-L317)).

## Termination and final accounting

Termination is considered before any next call, including notebook or accounting.
Delivery (`isError: false`), a settled provider request or zero remaining is not
proof of successful gameplay or navigation. The following branches are distinct
([skill termination rules](../../.agents/skills/doom-decisions/SKILL.md#result-and-termination-rules)):

- **Validated human Stop:** `{error: "agent-stopped"}` requires exactly
  `Agent stopped by user. Ending play.` and no image/further calls. Browser Stop
  synchronously revokes local admission and invokes controller Stop before network
  cleanup; it sends the intentional reason to the broker. Broker retains the
  closed lease's reason so a subsequent old-lease call can report Stop without
  authorizing action. Reason-delivery failure can remain generic revocation.
  Stop before dispatch aborts the API path, waits for owned SDK cleanup and proves
  unchanged state before readiness; after dispatch it drains execution/frame
  verification. Transfers/result acceptance can be revoked after consumption;
  lost delivery is never a replay/refund grant
  ([browser `stop` / `revoke`](../../app/src/agent-browser.ts#L74-L115),
  [broker revoke and old-lease response](../../app/agent-bridge.mjs#L229-L282),
  [controller Stop](../../app/src/session-controller.ts#L509-L525),
  [cleanup path](../../app/src/session-controller.ts#L1244-L1311)).
- **Verified terminal:** `doom_decide.outcome: "terminal"` overrides exhaustion,
  even at an early tic prefix or final attempt. After inspecting its directly
  delivered image, zero health requires exactly `Doomguy died. Ending play.`;
  positive health requires `Level exit triggered (exit pending). Ending play.`.
  Missing/malformed/uninspectable terminal image requires only
  `Terminal image inspection failed. Ending play without confirming death or exit.`.
  No further calls occur. Native terminal assessment checks more than health;
  the verified prefix and resulting-frame proof precede retirement. Exit pending
  remains E1M1 and does not establish intermission or a loaded next map
  ([`assessE1M1`](../../app/src/worker-shared.ts#L169-L203),
  [terminal closeout](../../app/src/session-controller.ts#L1206-L1230)).
- **Error, uncertainty or lost receipt:** gameplay/configuration denial, conflict,
  malformed/truncated/ambiguous receipt, transport loss, unexpected state,
  `not-admitted`, `api-failure`, `stopped` or `retired` ends the whole skill attempt.
  Except for prescribed Stop/terminal paths, Codex reports sanitized diagnostics
  and asks the human to click Stop Agent; no retry, accounting retrospective or
  final memory append. Application recovery to ready after a safely cleaned API
  failure does not authorize skill continuation. Isolated notebook failure can
  leave eligible gameplay intact; memory is disabled except the skill's deferred
  revision-conflict lookup/reassessment provision.
- **Healthy normal exhaustion:** only when all admitted decisions, including the
  last, have unambiguous nonterminal `completed` receipts and actually inspected
  resulting images does Codex call `doom_get_config` once, using the attachment's
  lease and final decision observation's session. No intervening observe/decide.
  It requires the original session/run, expected configuration revision, coherent
  positive safe-integer frozen `limit`, **`reserved === limit`,
  `sdkInvoked === reserved`, `remaining === 0`, `active === false`**. Any earlier
  uncertainty/pending reply, identity/ownership change or immediate-stop signal
  takes precedence; failed/ambiguous accounting is reported without retry
  ([complete final gate](../../.agents/skills/doom-decisions/SKILL.md#final-assessment-after-normal-exhaustion)).

Accounting has two distinct nonrefundable events: controller valid admission
increments `reserved`; SDK create start increments `sdkInvoked`. `endBounded`
also sets `remaining = 0` for early termination, explaining why zero alone is
insufficient. A healthy last decision ends the bounded run while preserving
ready-state settings for the final read; actual retirement clears settings and
terminates the Worker ([`endBounded`](../../app/src/session-controller.ts#L285-L295),
[`agentNext` closeout](../../app/src/session-controller.ts#L1385-L1423),
[`retire`](../../app/src/session-controller.ts#L577-L601)).

After the final gate, Codex compares the initial objective, any disclosed revision
and reason, and final inspected evidence, classifying **achieved / partially
advanced / disproven / inconclusive** with limits, unresolved connectivity and one
next-run experiment. Revising the question does not retroactively achieve the
original. Early ending/achieved goal instead requires the human to click Stop
Agent; it is not a second programmatic completion mechanism.

Before that normal retrospective, at most one optional notebook **append** may be
made: memory remained enabled, a directly relevant note was already found in the
same verified namespace/session/ownership context, a usable latest note revision
is retained, meaningful new information exists and no immediate-stop signal is
known. Use the final observation's map key and existing note; no lookup/create is
allowed after exhaustion. Assessment can save objectives/reasons, outcome,
evidence/limits, uncertainty and next experiment; immutable `nextQuestion` stays
unchanged. Inspect acknowledgment and report persistence as confirmed, skipped,
failed or unknown, with acknowledged ID/revision where available. A rejected or
ambiguous append gets no retry/read/write; an isolated failure does not invalidate
healthy gameplay. After final accounting, this append is the only permitted tool
call, then no more calls
([final append policy](../../.agents/skills/doom-decisions/SKILL.md#final-assessment-after-normal-exhaustion)).

This finalization is procedural. `doom_get_config` is a snapshot, not an atomic
permission token; notebook tools do not check lease/Stop, so an unobserved Stop
can precede an advisory append. Neither a note nor counters independently prove
achievement ([independent memory dispatch](../../app/agent-mcp.mjs#L155-L195),
[notebook write input](../../app/doom-memory.mjs#L32-L57)).

## Evidence and trust limits

Code checks strict command/DTO keys and types, scope/correlation, lease ownership,
observation/configuration freshness, CAS, bounded admission, SDK invocation,
per-tic execution and native/Canvas/PNG integrity. Broker checks result acceptance
again synchronously after validation. Native observations are sampled through
indexed `a21ReadObservation`/`G_A21Observe`, combined with counters in Worker
`observations`, then checked by the controller; hashes establish byte/frame
agreement, not semantic understanding
([DTO parsers](../../app/src/agent-observation.ts#L117-L411),
[command validator](../../app/src/agent-control.ts#L174-L235),
[native getter](../../engine/doom/src/doom_wasm.c#L138-L150),
[Worker sampling](../../app/src/worker.ts#L178-L274)).

Codex must actually view every required native image, copy scope from inspected
receipts, maintain the selected question/target, truthfully interpret evidence,
attribute history and reason about achievement. Code cannot prove those acts.
Tool schemas accept no action override, but do not check whether prompt text
stays at high-level intent; avoiding routine commands for a particular action
also relies on the skill.
No file/viewer fallback, cached image, path/hash or reported image marker satisfies
the skill's direct image requirement. Notebook `source` authenticates nothing,
and its schema cannot enforce that supplied coordinates were an observed pose.

Images, XY displacement, previous-action text and a clear center ray do not alone
prove traversal, route connectivity, full body clearance, successful door use or
the cause of stalled motion. The facing probe concerns only the current forward
center ray within 64 Doom units, with limited line/door metadata; historical
observer proximity cannot fix target identity. Native/receipt verification proves
bounded execution facts, not the navigation interpretation
([skill observation limits](../../.agents/skills/doom-decisions/SKILL.md#verified-game-state-observation-contract)).
API waits and passive snapshots/rendering do not advance simulation tics; they
also do not dissipate existing momentum. Stop/abort is not proof that remote
processing or billing ceased. The provider adapters retain SDK reader ownership
independently of outward cancellation, including the direct OpenAI helper/reader
case ([controller unchanged-state checks](../../app/src/session-controller.ts#L1160-L1167),
[`openrouter-decision-provider.ts`, `request`](../../app/src/openrouter-decision-provider.ts),
[`decisions-api.ts`, `requestDecision`](../../app/src/decisions-api.ts)).

## Source reference map

Links target repo-relative files; line anchors and named symbols refer to the
inspected HEAD above, not a future moving revision.

| Loop step | Primary source locator |
| --- | --- |
| Human procedure, one-call discipline, objective and termination policy | [Skill: Foreground procedure; Result and termination rules; Final assessment](../../.agents/skills/doom-decisions/SKILL.md) |
| Tool registration, cancellation and JSON/image envelope | [`createAgentMcpServer`](../../app/agent-mcp.mjs#L86-L196) |
| Lease file, scope, exact settings acknowledgment, PNG handling | [`runAgentCli`](../../scripts/doom-agent.mjs#L24-L113) |
| Process issuance, command routing, result fencing | [`processAgentAllowance`; `createAgentBridge.route`](../../app/agent-bridge.mjs#L18-L480) |
| Browser registration, SSE dispatch, Stop | [`startAgentObservationBridge`](../../app/src/agent-browser.ts#L59-L294) |
| Main-thread ports and provider selection | [`main.ts` bridge wiring](../../app/src/main.ts#L424-L459); [controller construction](../../app/src/main.ts#L559-L609) |
| Settings, claim, passive observe and accounting | [`attachAgent` through `agentPrompt`](../../app/src/session-controller.ts#L311-L508); [`observe`](../../app/src/session-controller.ts#L739-L824); [`agentNext`](../../app/src/session-controller.ts#L1317-L1423) |
| Provider request and after-action proof | [`decide` / `runOneDecision`](../../app/src/session-controller.ts#L932-L1315); [`buildDefaultDecisionRequest`](../../app/src/decision-request.ts); [OpenRouter `request`](../../app/src/openrouter-decision-provider.ts) |
| Worker/native action and sampling | [`i11Action`](../../app/src/worker.ts#L36-L100); [`observations`](../../app/src/worker.ts#L273-L274); [operation handler](../../app/src/worker.ts#L400-L453); [`stepNeutralControlled` / `a21ReadObservation`](../../engine/doom/src/doom_wasm.c#L138-L150); [`G_A21Step` / `G_A21Observe`](../../engine/doom/doomgeneric/src/g_game.c#L2372-L2478) |
| Independent receipt/frame/terminal checks | [`verifyAction`](../../app/src/decision.ts#L117-L217); [`assessE1M1`](../../app/src/worker-shared.ts#L169-L203); [controller `render` / `action`](../../app/src/session-controller.ts#L655-L736) |
| Strict observation/config/run/command contracts | [`agent-observation.ts`](../../app/src/agent-observation.ts); [`agent-control.ts`](../../app/src/agent-control.ts) |
| Advisory retrieval, immutable claim and append CAS | [`findMemory` / `recordMemory`; `withEntries`](../../app/doom-memory.mjs#L183-L361); [skill: Advisory navigation memory](../../.agents/skills/doom-decisions/SKILL.md#advisory-navigation-memory) |

Secondary context: [MCP setup/contracts/evidence](../doom-agent-mcp.md) and
[game-state pipeline](../doom-game-state-pipeline.md).

## Existing gaps and open questions

- **Objective completion:** when should an intermediate decision explicitly
  classify the announced success criterion? Current skill text mandates guidance,
  target and next-test reassessment; explicit outcome classification is at normal
  exhaustion. No application evaluator answers the navigation question.
- **Target versus observer coordinates:** note anchors are observer poses; no
  dedicated target-coordinate field was found in these contracts. What constitutes
  sufficient evidence to locate or reach the intended target remains interpretive.
- **Identity across viewpoints:** stable anchors/reacquisition are prescribed,
  but no implemented target identifier or cross-view recognition check establishes
  that two openings are the same target.
- **Durable changes/closure:** the selected question and its changes are session
  context and ephemeral provider instructions. Optional assessments and flag
  updates can durably record conclusions/recommendations, but are not guaranteed
  on every change/closure; original `nextQuestion` is immutable and no persistent
  selected-run-objective record exists in the inspected contracts. Whether that
  advisory record sufficiently expresses objective revision/closure is unresolved.

These are scope/semantics questions, not accepted recommendations or proven
causes of gameplay failure. Live image inspectability, navigation success and
real provider/native behavior were not independently verified in this investigation.
