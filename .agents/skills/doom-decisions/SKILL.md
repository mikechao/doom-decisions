---
name: doom-decisions
description: Start and supervise one process-budgeted Decisions API run in the foreground, viewing every verified Doom PNG and adapting ephemeral instructions and Game State inclusion. No browser driving or unattended loop.
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
action or duration or ask the provider to choose a particular action identifier.

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

From the repository root:

1. Run `node scripts/doom-agent.mjs attach` once. Retain its absolute `leaseFile`,
   page ID and epoch. Reuse a live lease already owned in this conversation.
2. Run `node scripts/doom-agent.mjs observe --lease ABSOLUTE_LEASE_FILE`.
   Actually open its absolute `pngPath` with `view_image` and deliver the image
   content to the model. A filename, base64 or hash alone is not visual evidence.
   If viewing fails, stop before a decision. Retain `sessionId`, `observationId`,
   tic, matching native/Canvas hashes and verified telemetry.
3. Read the effective agent configuration (instructions and five inclusion flags):
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
   counters. Separate hypotheses from verified native facts. XY endpoints or a
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
   and result confirmation. Model and N remain browser-owned.
6. Before EACH decision, obtain a fresh observation and actually view its PNG.
   After set-prompt or set-config this is mandatory: NEVER use the pre-write observation.
   Check unchanged page/epoch/session, ready phase, current tic and image hashes.
   Get-config once to verify the same run ID/revision/frozen limit is active
   with allowance.
   If configuration/run identity changed unexpectedly, stop.
7. Invoke exactly once for the observation just viewed:
   `node scripts/doom-agent.mjs decide --lease ABSOLUTE_LEASE_FILE --observation OBSERVATION_ID --session SESSION_ID --run RUN_ID --revision REVISION`.
   This requests one Decisions-selected action through the existing controller.
   Inspect structured outcome, SDK invocation and requested/reported/verified/end
   tics. Apply the terminal rule above first. For healthy `completed` results,
   actually open the resulting PNG and compare it with the preceding PNG.
   Verify session continuity and eligible `previousAction`. Terminal prefixes are
   distinct from completed N tics; other outcomes without PNGs are not new scenes.
8. Only a healthy `completed` result with matching evidence AND an image actually
   viewed permits another iteration. Read actual counters with get-config. Update
   the navigation hypothesis, then repeat steps 4–7 while the SAME run remains
   active and has remaining allowance. This is individual foreground reasoning
   between tool calls, never a script that loops independently of Codex.
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
inclusion flags true. These settings belong only to that lease. They never write
human saved instructions, checkbox selections or drafts. Manual/Continuous
requests use human settings. Authorization and individual decisions do not reset
agent choices. Exhaustion retains settings for inspection without replenishing
permission; Stop/disconnect/page exit or actual retirement clears settings.

`get-config` returns `{sessionId, revision, configuration, run}`. `configuration`
has exactly these six fields (example, not instructions to replace a useful goal):

```json
{
  "instructionTemplate": "Explore toward the visible opening for {{tics}} tics.",
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
must be nonblank and at most 16000 characters. Then call:

`node scripts/doom-agent.mjs set-config --lease ABSOLUTE_LEASE_FILE --session SESSION_ID --run RUN_ID --revision REVISION --config-file ABSOLUTE_JSON_FILE`

Writes require a ready, idle controller and the current active bounded run and
revision. `set-config` fully replaces the six fields. `set-prompt` remains an
instructions-only adapter to the same ephemeral configuration and revision.
Successful edits preserve the run ID and every attempt counter, increment revision
and invalidate old observations. Obtain and view a fresh PNG before requesting
another decision. Changes never affect an admitted request. Rejected stale/malformed,
busy or editor-open writes leave settings, revision and allowance unchanged;
stop this skill workflow on conflicts rather than retrying. Human configuration
changes still end the bounded run.

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
