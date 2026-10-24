---
name: doom-decisions
description: Start and supervise one process-budgeted Decisions API run in the foreground, viewing distinct verified Doom frames and every decision result, and adapting ephemeral instructions and Game State inclusion. No browser driving or unattended loop.
---

# Doom Decisions — bounded foreground play

Interpret `play` as a foreground conversation workflow using ONE single-use
process allowance from the human-configured `AGENT_DECISION_BUDGET`. Never start
a server/browser, prepare a game, click/drive/inspect Chrome or DevTools, read
`.env*`, the credential bootstrap module or browser credential storage. Never
create a daemon, autonomous CLI loop, persistent map or external memory service.
Attaching, observing and reading/writing agent settings never authorize charges.
Invoke `start-run` once to claim the configured count of possibly billable
Decisions API attempts; there is no browser authorization or chat confirmation.
The existing Decisions provider selects EVERY low-level action; never inject an
action or routinely order a particular action identifier. Conditional tactical
intent is allowed. Codex chooses only the agent time horizon through the bounded
effective configuration before the provider chooses its action; never change
duration after seeing that choice.

**Choose one transport at the beginning:** `$doom-decisions play` uses the CLI
by default. Only an explicit request such as `$doom-decisions play using MCP`
selects the optional local MCP adapter. For MCP, require all eight tools below
to be available before attaching; otherwise end without falling back to CLI.
Never switch transports during an invocation, recover a lost result through the
other transport, or retry an operation. The host-managed stdio adapter does not
start `dev:agent`, prepare a game or issue an allowance on startup.

For MCP, translate each CLI recipe below to its one corresponding tool, retaining
the same argument values, operation order and temporary settings files:

| CLI operation | MCP tool | Arguments |
| --- | --- | --- |
| `attach` | `doom_attach` | `{}` |
| `observe` | `doom_observe` | `leaseFile` |
| `get-config` | `doom_get_config` | `leaseFile, sessionId` |
| `get-prompt` | `doom_get_prompt` | `leaseFile, sessionId` |
| `start-run` | `doom_start_run` | `leaseFile, observationId, sessionId, revision` |
| `set-config` | `doom_set_config` | `leaseFile, sessionId, runId, revision, configFile` |
| `set-prompt` | `doom_set_prompt` | `leaseFile, sessionId, runId, revision, instructionsFile` |
| `decide` | `doom_decide` | `leaseFile, observationId, sessionId, runId, revision` |

Every termination, disclosure, configuration, duration and image-inspection rule
below applies identically to MCP calls. References to agent CLI calls include
their MCP equivalents, including the prohibition on calls after Stop/terminal.
Immediately inspect each MCP result's `isError` and complete domain payload before
any other work. Use `structuredContent` when available; its compact JSON text
content carries the same complete object. Do not reprint duplicate copies or
invent a CLI exit code. `isError: true`, missing/truncated/inconsistent content or
a connection/tool failure ends play conservatively; preserve `agent-stopped` when
present. `isError: false` proves delivery only: non-completed outcomes still obey
all existing stop rules. A pending call is not a receipt; never repeat it.
MCP retains local `pngPath` output: use `view_image` and the same verified-hash
reuse rules below, never substitute JSON or a path for an inspected image.

**Termination takes priority throughout `play`:** immediately after EVERY CLI
call, inspect its exit status and structured result before further reasoning,
planning, image viewing, settings changes or tool calls. `{"error":"agent-stopped"}`
means the broker received a validated human **Stop Agent** request: reply
`Agent stopped by user. Ending play.` and end this invocation immediately.
Make no further observe/decide/get/set/attach/retry calls and do not recover or
reattach.

After honoring `agent-stopped`, a successful, correlated `decide` result with
`outcome: "terminal"`, `sdkInvoked: true`, `completionUncertain: false`,
`observation.phase: "terminal"` and matching session/tic/frame hashes plus a
verified local terminal `pngPath` ends gameplay immediately. Only after successful
viewing of that PNG, within this verified terminal contract,
`observation.telemetry.health === 0` means reply
`Doomguy died. Ending play.`; positive health means reply
`Level exit triggered (exit pending). Ending play.` Do not claim another map
loaded or the game was won. Raw health or a screenshot alone never proves death.
Terminal takes priority over exhaustion, including an early tic prefix or death
on the final reservation. Make no further agent CLI calls: no observe,
decide, get/set-config, prompt edits, attach, retry or discovery, regardless of
previous allowance. View only the already-returned local terminal PNG once as the
sole permitted final evidence tool call. If viewing succeeds, give the matching
acknowledgment above and end this invocation. If the PNG is missing/unreadable or
the viewer fails, reply only
`Terminal image inspection failed. Ending play without confirming death or exit.`
Do not append a death, exit or human-Stop acknowledgment. End this invocation
without retrying image viewing, recovery or further tool calls. Never restart,
respawn, advance to another map or seek another grant or replacement lease.

`retired`, `not-admitted`, uncertain completion, missing/inconsistent/malformed
or unsupported terminal evidence, `lease-revoked`, disconnect, deadline/transport
failure or ambiguous output also ends this invocation conservatively, without
claiming confirmed death or that the human clicked Stop.
Report exhausted allowance as normal completion only when returned run counters
show `reserved === limit` and zero remaining; inactive authorization alone is
not proof of exhaustion. All other stop/conflict/uncertainty rules still apply.
This rule applies on every iteration of observe → plan → decide → verify.

Cancellation is cooperative at the next CLI/tool-result boundary; this Markdown
skill cannot preempt an active Codex reasoning turn. Stop between calls may need
one next old-lease call to discover revocation; it must fail without another
gameplay action. Never make an extra discovery call after a terminal result.

The human configures a positive safe-integer `AGENT_DECISION_BUDGET` in
`app/.env.agent.local`, starts `npm --prefix app run dev:agent` and manually opens
`http://127.0.0.1:5174/`. Wait for their page to reach verified ready. Reuse that
server; a busy port is not permission to start another one.

**Visual evidence reuse applies only to `observe` image opening.** Always view
the initial PNG and every healthy completed or verified terminal `decide` PNG
immediately, even if identical to an earlier image. Terminal/Stop/error precedence
above is unchanged; terminal viewing is mandatory and never waits for `observe`.
During the same active run, a fresh `observe` may reuse a successful earlier visual
inspection only with unchanged lease/page ID/epoch/session/run ownership and a
verified `pngSha256` equal to that of an image actually delivered to the model.
Retain that viewed path/hash/ownership and its native/Canvas frame hashes in the
concise conversation record, not an external cache. The CLI verifies PNG bytes
against `pngSha256` before writing `pngPath`: use the correlated `observe` result's
top-level hash, or `decide`'s `observation.pngSha256` for its resulting `pngPath`.
`beforeObservationId` identifies the input, not the resulting image. Never compare
filenames or equate PNG-byte hashes with native/Canvas RGBA hashes. Require the
current `frame.tic === tic`, matching native/Canvas hashes, and those RGBA hashes
to match the earlier inspected frame too. If hashes are absent, inconsistent or
cannot be mapped safely to the inspected image, open the current PNG instead;
existing invalid-evidence or ownership-mismatch rules still require stopping.
Open every newly distinct verified frame at least once; failed viewing stops play.
Reuse skips only image opening: process current telemetry, position, facing probe,
`previousAction`, execution receipts and navigation context every time. Always
acquire and validate a fresh observation ID and current configuration/revision
before deciding, including after settings writes; identical pixels never restore
an invalidated observation or authorize a stale revision. Settings writes may
reuse visual evidence under these same conditions, never pre-write observation IDs.

**CLI result presentation:** apply this to EVERY Doom CLI JSON operation,
especially `decide`, `observe` and `get-config`, without adding calls. Check the
actual orchestration tool schema first. With `functions.exec` and
`tools.exec_command`, a completed result has `exit_code` and `output`; `text()`
serializes objects compactly. For exit code 0 and complete, untruncated JSON
stdout, parse once and emit only the exit status and ENTIRE parsed response:

```js
// r is the completed tools.exec_command result; check completion and exit first.
text({ exit_code: r.exit_code, result: JSON.parse(r.output) });
```

Never emit the original shell wrapper, pretty stdout or a duplicate completed
result on this success path. Preserve every field without summaries/omissions:
observation IDs, page/epoch/session/run/revision identity, image paths/hashes,
telemetry, provider usage, action, requested/reported/verified tics, accounting,
uncertainty flags and error metadata. Exit 0 alone does not prove gameplay success;
inspect the full result under the termination and verification rules above.

A `session_id` without a final exit status is pending, NOT a decision result.
Poll that SAME process with `tools.write_stdin`, retaining and concatenating each
`output` chunk in order until completion; parse the assembled stdout only then
and emit the completed result once. If `functions.exec` itself yields a cell ID,
resume with `functions.wait`, not another CLI invocation. Allow enough output
capacity for the full response. Never parse partial/truncated output as success.
On nonzero exit, missing/invalid JSON, truncation or tool failure, preserve the
actual exit status (or unknown/pending status), relevant stdout/stderr diagnostics
and error information; do not emit a successful parsed decision. The CLI writes
sanitized error JSON to stderr and exits 1; keep errors such as `agent-stopped`
visible for immediate handling. Parsing/polling never authorizes another `decide`
or any retry. Ambiguous final output follows the existing conservative stop rule.

From the repository root:

1. Run `node scripts/doom-agent.mjs attach` once. Retain its absolute `leaseFile`,
   page ID and epoch. Reuse a live lease already owned in this conversation.
2. Run `node scripts/doom-agent.mjs observe --lease ABSOLUTE_LEASE_FILE`.
   Actually open its absolute `pngPath` with `view_image` and deliver the image
   content to the model. A filename, base64 or hash alone is not visual evidence.
   If viewing fails, stop before a decision. Retain `sessionId`, `observationId`,
   tic, matching native/Canvas hashes and verified telemetry.
3. Read the effective agent configuration (instructions, five inclusion flags and tics):
   `node scripts/doom-agent.mjs get-config --lease ABSOLUTE_LEASE_FILE --session SESSION_ID`.
   Require the same page/epoch/session as the fresh observation just viewed and
   `run: null`; an existing run is not permission to resume or replenish it.
   Use that observation ID, session ID and returned revision to invoke ONCE:
   `node scripts/doom-agent.mjs start-run --lease ABSOLUTE_LEASE_FILE --observation OBSERVATION_ID --session SESSION_ID --revision REVISION`.
   Inspect the result immediately. Retain its actual run ID, revision and frozen
   limit; require an active run, zero reserved/SDK-invoked counts and remaining
   equal to that positive limit. Continue without another human message.
   On `budget-unavailable`, explain that the human must set a positive safe-integer
   `AGENT_DECISION_BUDGET` and fully stop/relaunch `dev:agent`. Invalid configuration
   can prevent startup; report that possibility without reading the private file.
   `budget-closed`, `claim-failed`, rejected or ambiguous claims end play: never
   retry `start-run`, fall back to another grant, reattach or restart the server.
   Browser reload and Vite internal restart cannot replenish the allowance.
4. Keep a concise in-conversation record: goal; page/epoch/session/tic; last
   verified action/tics/outcome; visual interpretation and confidence; navigation
   hypothesis; progress/stall evidence; one next high-level objective; actual run
   counters. Also track attempts submitted/confirmed in this single run, starting
   at zero after start-run, only to know when final accounting in step 8 is due.
   This local count never authorizes admission or proves exhaustion; the browser/
   controller and returned run counters remain authoritative.
   Separate hypotheses from verified native facts. XY endpoints or a
   screenshot do not prove a collision or door usability. Use the qualified
   `facingProbe` and existing `previousAction.text` with the limitations below;
   movement-event collision masks remain browser-only.
5. When useful, write ONLY high-level instructions to a temporary absolute UTF-8
   text file (maximum 16000 characters), retaining useful effective instructions and
   `{{tics}}`. Include uncertainty explicitly, e.g. a possible opening rather
   than invented unseen geometry. Do not include credentials, unrelated secrets or
   command/action overrides. Revise only when verified evidence warrants it.
   Before EVERY `set-prompt` request, send a user-visible Codex commentary message:

   - **Why change:** cite specific verified observations and explain how they
     motivate the new navigation guidance. Distinguish observations from hypotheses.
   - **New Decisions API prompt:** show the full replacement text verbatim in a
     fenced text block, never a summary, diff or placeholder. Tool arguments alone
     do not count as disclosure.

   Optionally add one sentence explaining the substantive change from the current
   prompt. Write exactly the displayed replacement text to the instructions file
   and submit it unchanged through:
   `node scripts/doom-agent.mjs set-prompt --lease ABSOLUTE_LEASE_FILE --session SESSION_ID --run RUN_ID --revision REVISION --instructions-file ABSOLUTE_TEXT_FILE`.
   After inspecting the command's exit status and structured result, honor the
   termination rules above first; otherwise briefly report whether the replacement
   was applied. Call it active and use the returned revision only after a confirmed
   successful response. Explicitly report failure, conflict or uncertainty without
   claiming success, and follow the existing conservative termination rules.
   Do not repeat the full prompt on decisions when it has not changed.
   A stale revision, any open human editor or other conflict ends this workflow;
   never retry or overwrite a draft. There is no
   manual copy/paste relay. For inclusion edits use the full get/set-config
   read/edit/CAS contract below. Inclusion-only edits are not prompt revisions;
   changing `instructionTemplate` through `set-config` requires the same disclosure
   and result confirmation. Model and Manual/Continuous duration remain browser-owned.
6. Before EACH decision, obtain a fresh observation and view its PNG or apply the
   visual evidence reuse rule above. The first observation after start-run and
   after any set-prompt or set-config is mandatory: NEVER use a pre-write observation.
   Check unchanged page/epoch/session, ready phase, current tic and image hashes.
   Then get-config once to confirm matching page/epoch/session/run, expected
   revision/configuration, the same frozen limit, an active run and remaining
   allowance. A matching PNG hash never skips this read or the fresh observation.
   If configuration/run identity changed unexpectedly, stop.
   Choose an integer duration from 1 through 35 inclusive before EACH decision,
   using the current verified screenshot/state, recent action outcome, threat and
   obstacle proximity, progress, and uncertainty about the provider's next action.
   Use 6 as the safe default when evidence does not support a change. Larger
   durations are not automatically better: long turns can overshoot, held fire
   can waste ammo, and held use does not prove repeated door activation. A clear
   facing probe alone does not prove clearance; uncertain or stalled movement
   and nearby threats/obstacles favor earlier re-observation.
   If the chosen duration differs from effective `tics`, use the complete-replacement
   set-config contract below with current scope/revision. After confirming success,
   obtain a fresh observation, view or safely reuse its visual evidence, and
   get-config again to confirm the new revision,
   same active run/frozen limit and remaining allowance before deciding. Reassess
   the horizon against that fresh evidence. Never reuse the pre-write observation.
   If duration is unchanged, do not write configuration just to repeat the value.
   Before EVERY nondefault decision (chosen tics other than 6), state a concise,
   observable reason in a user-visible Codex message before issuing `decide`.
   Ground the reason in verified facts, distinguish inferences explicitly, and
   acknowledge that the Decisions API's next low-level action is not yet known.
   This explanation is required even when retaining the same nondefault tics from
   the previous decision. No duration explanation is required for default 6.
7. Invoke exactly once using the latest fresh observation ID, whether its PNG
   was just viewed or its visual evidence safely reused:
   `node scripts/doom-agent.mjs decide --lease ABSOLUTE_LEASE_FILE --observation OBSERVATION_ID --session SESSION_ID --run RUN_ID --revision REVISION`.
   This requests one Decisions-selected action through the existing controller.
   Inspect structured outcome, SDK invocation and requested/reported/verified/end
   tics. Apply the terminal rule above first. For healthy `completed` results,
   actually open the resulting PNG and compare it with the preceding PNG.
   Verify session continuity and eligible `previousAction`. Terminal prefixes are
   distinct from completed N tics; other outcomes without PNGs are not new scenes.
8. Only a successfully delivered, correlated, healthy `completed` receipt with
   matching evidence AND its verified resulting PNG actually viewed permits
   proceeding to the next observation. Process the full receipt and update the
   navigation hypothesis. Do not routinely call get-config immediately afterward.
   If the bounded run may continue, repeat steps 4–7: obtain the required fresh
   observation, then use step 6's single pre-decision get-config to verify the
   SAME run and its allowance before another decide. The completed receipt alone
   never authorizes another decision. This is individual foreground reasoning
   between tool calls, never a script that loops independently of Codex.

   Final accounting exception: when locally confirmed completed decisions appear
   to consume the known frozen limit, after the final healthy receipt and required
   image inspection call get-config once, without another observe or decide.
   Require matching page/epoch/session/run, expected revision/configuration and
   frozen limit, and valid returned run counters showing `reserved === limit`
   and `remaining === 0` before reporting normal exhaustion. Neither the local
   count nor `active: false` proves exhaustion. If accounting cannot be confirmed,
   stop conservatively; never retry decide, reclaim allowance or resume the run.
   Stop, terminal and error rules above take priority over this exception: never
   add post-error accounting or a recovery probe, or any call after agent-stopped;
   a verified terminal result permits only its prescribed terminal PNG viewing.
9. Stop on exhausted/inactive authorization, Stop/lease revocation, terminal or
   retired state, session/observation mismatch, prompt conflict, failed/ambiguous
   result, uncertain consumption, unavailable image viewing or achieved goal.
   Tell the human to click **Stop Agent** when ending early. Exhaustion requires
   no further human input. Do not seek another run, invoke `start-run` again or
   switch to manual mode to extend the cap. Manual controls resume only after
   safe settlement.

Never automatically retry ANY command or replace a stopped/stale lease. Decision
command IDs are tied to observation IDs and remain spent even on rejection. Run
reservations are never refunded, including pre-create failures. A lost response
or timeout can mean unknown action outcome or charge; stop and ask the human to
inspect the page. Abort never proves remote processing/billing stopped. Stop
revokes local admission synchronously; pending readers retain ownership through
safe cleanup, and dispatched work finishes verification. Result delivery may be
revoked even when an action was consumed. A fresh allowance requires the human to
fully stop and launch a new `dev:agent` process for a separate skill invocation;
never do this yourself. No reconnect, replay or rearming follows Stop/disconnect.

## Agent settings: read, edit, CAS

Attachment copies human saved instructions once and starts all five effective
inclusion flags true. Agent `tics` starts independently at 6, never copied from the
Manual/Continuous input. These settings belong only to that lease. They never write
human saved instructions, checkbox selections or drafts. Manual/Continuous
requests use human settings. Authorization and individual decisions do not reset
agent choices. Exhaustion retains settings for inspection without replenishing
permission; Stop/disconnect/page exit or actual retirement clears settings.

`get-config` returns `{sessionId, revision, configuration, run}`. `configuration`
has exactly these seven fields (example, not instructions to replace a useful goal):

```json
{
  "instructionTemplate": "Explore toward the visible opening for {{tics}} tics.",
  "tics": 6,
  "includeReadyWeapon": true,
  "includeAmmo": false,
  "includeHealth": true,
  "includeFacingProbe": true,
  "includePreviousAction": true
}
```

Read current config, edit only the fields you intend to change, and write the
complete configuration object to a temporary absolute JSON file. No credentials,
provider settings or extra fields. All five flags must be booleans; instructions
must be nonblank and at most 16000 characters. Required `tics` must be a number
and an integer from 1 through 35 inclusive, with no discrete presets. Then call:

`node scripts/doom-agent.mjs set-config --lease ABSOLUTE_LEASE_FILE --session SESSION_ID --run RUN_ID --revision REVISION --config-file ABSOLUTE_JSON_FILE`

Writes require a ready, idle controller and the current active bounded run and
revision. `set-config` fully replaces the seven fields. `set-prompt` remains an
instructions-only adapter to the same ephemeral configuration and revision.
Successful edits preserve the run ID and every attempt counter, increment revision
and invalidate old observations. Obtain a fresh observation and view its PNG or
apply the visual evidence reuse rule, then get-config to verify the new revision/
configuration and same active run/frozen limit/allowance before another decision.
Changes never affect an admitted request. Rejected stale/malformed,
busy or editor-open writes leave settings, revision and allowance unchanged;
stop this skill workflow on conflicts rather than retrying. Human configuration
changes still end the bounded run.

Duration edits never replenish authorization or change the process-owned attempt
limit, reserved count or SDK-invoked count. Every admitted attempt freezes its
duration for prompt interpolation, native execution and receipts. Saved/custom
instructions are copied unchanged: older text may still say the human selected
duration. Review that wording; any replacement requires the prompt disclosure
above, never a silent rewrite of user-authored text. Retain `{{tics}}` so the
provider sees the actual selected horizon while choosing only the action.

## Verified Game State observation contract

Every observation exports all five eligible signals regardless of agent inclusion
flags. Codex chooses which eligible facts enter subsequent Decisions request text
through agent settings. Enabled flags never fabricate evidence; the existing
formatter retains unavailable markers and previous-action eligibility/omissions.

- `telemetry.readyWeapon`: normalized `{id, name, ammoType}` or `null`. Ammo type
  is independently sampled; `none` and `unknown` are valid values. Legacy
  `weaponId` remains available.
- `telemetry.ammo`: `bullets`, `shells`, `cells`, `rockets`, each `{current, max}`,
  or `null`. Zero is a value. These are native quantities/capacities, without
  clamping, percentages or inferred firing counts. Legacy current-count fields
  remain available.
- `telemetry.health`: numeric native player health. Ready captures require
  living eligibility; terminal captures are not ready gameplay evidence.
- `facingProbe`: `{tic, kind, door, distance}` for the current verified frame,
  or `null` when unavailable (including kind 0), ineligible or terminal. Kind 1
  means no relevant line on the forward center ray within 64 Doom units; it has
  `door: 0, distance: -1` and is distinct from `null`. Kind 2 is a solid line,
  3 an opening/clearance restriction, 4 a recognized manual-door boundary,
  5 another special line with unknown physical meaning. For kinds 2–5, distance
  is approximate integer Doom units (0–64). Door 0 means no recognized manual-door
  metadata, 1 recognized metadata with unknown usability, 2 a front-side manual-door
  use candidate. This center ray does not prove full player clearance,
  traversability, keys, door activity or successful activation.
- `previousAction`: `{action, tics, endTic, text}` from the independently verified
  action receipt and matching resulting frame/tic/XY, or `null` initially,
  when ineligible or terminal. Read the existing text directly; do not rederive
  displacement or reverse-parse it. It can distinguish signed displacement,
  intermediate movement and unchanged sampled boundaries, but proves neither
  a hit nor door activation or the cause of no movement.

- **Timing and momentum:** 35 tics = 1 simulated Doom second; the usual 6-tic
  duration is ~0.171 simulated seconds, independent of API or wall-clock latency.
  `forward` accelerates existing momentum; `forwardmove = 25` is a command
  magnitude, not 25 map units/tic or a travel-distance multiplier. Consecutive
  forward actions can cover progressively more ground. Waiting between provider
  calls runs no simulation tics and does not dissipate momentum; a neutral action
  may still move the player while friction reduces existing momentum.
- **Measured references:** An unobstructed native Freedoom Phase 1 E1M1
  calibration measured ~14 and ~30 map units in the first and next consecutive
  6-tic forward intervals from rest; the first and next consecutive 35-tic
  intervals covered ~214 and ~289 units. No neutral tics intervened. These are
  scene-specific references, not guarantees when blocked, sliding, airborne,
  damaged, teleported or starting with different momentum.
- Favor verified x/y/angle/tic observations, `previousAction.text` (read directly
  as above) and screenshots over reference distances. Low displacement suggests
  limited progress; by itself it neither proves collision nor establishes wall
  contact.

Coordinates retain raw native fixed-point values and angle retains unsigned raw
bits. Observations are detached snapshots, never proof of future admission.
The strict DTO rejects extra or missing keys, including nested objects. The
broker and CLI use the same parser; CLI output retains every evidence field and
replaces only PNG data with its verified local `pngPath`.

If the picker does not discover this project skill, start a fresh Codex
conversation from this worktree. Do not alter global Codex configuration.
