---
name: doom-decisions
description: Start and supervise one process-budgeted Decisions API run in the foreground, viewing distinct verified Doom frames and every decision result, and adapting ephemeral instructions and Game State inclusion. No browser driving or unattended loop.
---

# Doom Decisions — bounded foreground play

Interpret `play` as a foreground conversation workflow using ONE single-use
process allowance from the human-configured `AGENT_DECISION_BUDGET`. Never start
a server/browser, prepare a game, click/drive/inspect Chrome or DevTools, read
`.env*`, the credential bootstrap module or browser credential storage. Never
create a daemon, unattended loop, persistent map or external memory service.
Attaching, observing and reading/writing agent settings never authorize charges.
Invoke `doom_start_run` once to claim the configured count of possibly billable
Decisions API attempts; there is no browser authorization or chat confirmation.
The existing Decisions provider selects EVERY low-level action; never inject an
action or routinely order a particular action identifier. Conditional tactical
intent is allowed. Codex chooses only the agent time horizon through the bounded
effective configuration before the provider chooses its action; never change
duration after seeing that choice.

**`$doom-decisions play` uses MCP only.** Discover all eight tools below from
the project's `doom_decisions` server and verify their availability before
attachment. If any tool is missing, disabled, disconnected or ambiguous, explain
the blocker and end without attaching or claiming a run. Never shell out to the
CLI for gameplay, recover a lost result through another transport or retry an
operation. `doom_attach` must be the first Doom domain call; all subsequent Doom
domain operations use these MCP tools directly. Local temporary-file writes and
`view_image` remain necessary evidence/settings operations.
The host-managed stdio adapter does not start `dev:agent`, prepare a game or issue
an allowance on startup. MCP is transport; the browser budget and Stop remain
the authority limits.

| MCP tool | Purpose | Arguments |
| --- | --- | --- |
| `doom_attach` | Acquire the existing lease; no provider usage | `{}` |
| `doom_observe` | Fresh verified observation/state/local PNG | `leaseFile` |
| `doom_get_config` | Effective configuration/revision/run accounting | `leaseFile, sessionId` |
| `doom_get_prompt` | Effective instructions | `leaseFile, sessionId` |
| `doom_start_run` | Claim the preconfigured finite allowance once | `leaseFile, observationId, sessionId, revision` |
| `doom_set_config` | CAS complete seven-field replacement from file | `leaseFile, sessionId, runId, revision, configFile` |
| `doom_set_prompt` | CAS prompt-only replacement from file | `leaseFile, sessionId, runId, revision, instructionsFile` |
| `doom_decide` | One provider-selected action/full receipt/after-action PNG | `leaseFile, observationId, sessionId, runId, revision` |

The model must immediately inspect each MCP result's `isError` and complete domain
payload before any other work, except for step 5's guarded read pair. Use complete
`structuredContent`; if unavailable, read the complete JSON text content as the
fallback. Do not serialize duplicate model-facing copies
of the same payload. Preserve every field: identities/revision, paths/hashes,
telemetry, provider usage, action, requested/reported/verified tics, accounting,
uncertainty and errors. `isError: true`, missing/truncated/inconsistent content or
a connection/tool failure ends play conservatively; preserve `agent-stopped` when
present. `isError: false` proves delivery only: non-completed outcomes still obey
all existing stop rules. A pending call is not a receipt; never repeat it.
MCP retains local `pngPath` output: use `view_image` and the same verified-hash
reuse rules below, never substitute JSON or a path for an inspected image.

**Termination takes priority throughout `play`:** immediately after EVERY MCP
call, inspect `isError` and the complete domain result before further reasoning,
planning, image viewing, settings changes or tool calls. Only step 5's guarded
read pair permits mechanical inspection before its second read; the model must
inspect both results on return. Stop/terminal/error priority is unchanged.
`{"error":"agent-stopped"}`
means the broker received a validated human **Stop Agent** request: reply exactly
`Agent stopped by user. Ending play.` and end this invocation immediately.
Make no further agent calls, discovery or recovery attempts.

After honoring `agent-stopped`, a successful, correlated `doom_decide` result with
`outcome: "terminal"`, `sdkInvoked: true`, `completionUncertain: false`,
`observation.phase: "terminal"` and matching session/tic/frame hashes plus a
verified local terminal `pngPath` ends gameplay immediately. Only after successful
viewing of that PNG, within this verified terminal contract,
`observation.telemetry.health === 0` means reply
`Doomguy died. Ending play.`; positive health means reply
`Level exit triggered (exit pending). Ending play.` Do not claim another map
loaded or the game was won. Raw health or a screenshot alone never proves death.
Terminal takes priority over exhaustion, including an early tic prefix or death
on the final reservation. Make no further Doom domain calls or discovery,
regardless of previous allowance. View only the already-returned local terminal
PNG once as the sole permitted final evidence tool call. If viewing succeeds, give the matching
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
For these failures, report useful sanitized diagnostics without exposing secrets
or claiming successful completion.
Report exhausted allowance as normal completion only when returned run counters
show `reserved === limit` and zero remaining; inactive authorization alone is
not proof of exhaustion. All other stop/conflict/uncertainty rules still apply.
This rule applies on every iteration of `doom_observe` → plan → `doom_decide` → verify.

Cancellation is cooperative at the next MCP tool-result boundary; this Markdown
skill cannot preempt an active Codex reasoning turn. Stop between calls may need
one next old-lease call to discover revocation; it must fail without another
gameplay action. Never make an extra discovery call after a terminal result.

The human configures a positive safe-integer `AGENT_DECISION_BUDGET` in
`app/.env.agent.local`, starts `npm --prefix app run dev:agent` and manually opens
`http://127.0.0.1:5174/`. Wait for their page to reach verified ready. Reuse that
server; a busy port is not permission to start another one. The tracked project
`.codex/config.toml` registers the MCP server; Codex may need a restart from this
worktree to discover it. `required = false` does not relax the eight-tool gameplay
prerequisite. Do not change global Codex settings. Gameplay can send screenshots
and included game-state data to the selected Decisions provider and incur charges;
retain the project's existing tool approval choices.

**Visual evidence reuse applies only to `doom_observe` image opening.** Always view
the initial PNG and every healthy completed or verified terminal `doom_decide` PNG
immediately, even if identical to an earlier image. Terminal/Stop/error precedence
above is unchanged; terminal viewing is mandatory and never waits for `doom_observe`.
During the same active run, a fresh `doom_observe` may reuse a successful earlier visual
inspection only with unchanged lease/page ID/epoch/session/run ownership and a
verified `pngSha256` equal to that of an image actually delivered to the model.
Immediately after each required PNG is successfully delivered and inspected by
the model, update the concise in-conversation viewed-baseline record, especially
after each healthy completed decision image. Record the exact viewed `pngPath`,
`pngSha256`, tic, native and Canvas frame hashes, `leaseFile`, owner/page/epoch/
session/run scope, and explicit successful image delivery and model inspection.
Use only returned evidence, including retained attachment/run results; mark any
unestablished scope as unavailable, never invent it. An incomplete baseline is
ineligible for pairing. Replace the baseline after each successful required view;
clear it across `doom_start_run` or lost scope continuity. Existing termination
rules still apply; terminal images never authorize another read, and recording
must not add narration or tools to exact Stop/terminal replies. Hashes alone do not
certify viewing; never persist an external cache. The MCP implementation verifies
PNG bytes against `pngSha256` before writing `pngPath`: use the correlated
`doom_observe` result's top-level hash, or `doom_decide`'s
`observation.pngSha256` for its resulting `pngPath`.
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

After tool discovery and human preparation:

1. Call `doom_attach` with `{}` once. Retain its absolute `leaseFile`, owner/page
   ID and epoch. Do not replace a stopped/stale lease or resume an existing run.
2. Call `doom_observe` with that `leaseFile`.
   Actually open its absolute `pngPath` with `view_image` and deliver the image
   content to the model. A filename, base64 or hash alone is not visual evidence.
   If viewing fails, stop before a decision. Retain `sessionId`, `observationId`,
   tic, matching native/Canvas hashes and verified telemetry.
3. Read the effective agent configuration (instructions, five inclusion flags and tics):
   call `doom_get_config` with `leaseFile, sessionId`.
   Require the same page/epoch/session as the fresh observation just viewed and
   `run: null`; an existing run is not permission to resume or replenish it.
   Call `doom_get_prompt` with `leaseFile, sessionId`; require matching ownership,
   session, revision, `run: null` and instructions equal to `instructionTemplate`.
   Use that observation ID, session ID and returned revision to invoke ONCE
   `doom_start_run` with `leaseFile, observationId, sessionId, revision`.
   Inspect the result immediately. Retain its actual run ID, revision and frozen
   limit; require an active run, zero reserved/SDK-invoked counts and remaining
   equal to that positive limit. Continue without another human message.
   On `budget-unavailable`, explain that the human must set a positive safe-integer
   `AGENT_DECISION_BUDGET` and fully stop/relaunch `dev:agent`. Invalid configuration
   can prevent startup; report that possibility without reading the private file.
   `budget-closed`, `claim-failed`, rejected or ambiguous claims end play: never
   retry `doom_start_run`, fall back to another grant, reattach or restart the server.
   Browser reload and Vite internal restart cannot replenish the allowance.
4. Keep a concise in-conversation record: goal; page/epoch/session/tic; last
   verified action/tics/outcome; visual interpretation and confidence; navigation
   hypothesis; progress/stall evidence; one next high-level objective; actual run
   counters. Also track attempts submitted/confirmed in this single run, starting
   at zero after `doom_start_run`, only to know when final accounting in step 8 is due.
   This local count never authorizes admission or proves exhaustion; the browser/
   controller and returned run counters remain authoritative.
   Separate hypotheses from verified native facts. XY endpoints or a
   screenshot do not prove a collision or door usability. Use the qualified
   `facingProbe` and existing `previousAction.text` with the limitations below;
   movement-event collision masks remain browser-only.
5. Before EACH decision, obtain a fresh `doom_observe` with `leaseFile` and exactly
   one `doom_get_config` through the ordering below. Fresh observations after
   `doom_start_run` and any `doom_set_prompt` or `doom_set_config` remain mandatory:
   NEVER use a pre-write observation.

   Startup follows separate steps 2–3. For the first post-`doom_start_run`
   observation, also use separate calls: return and inspect observe, open its PNG,
   update the viewed baseline, then get-config. Reopen the startup PNG after
   `doom_start_run`; the pre-run inspection cannot establish same-active-run
   ownership for reuse.
   Thereafter, with a recorded same-run viewed baseline and complete-output
   conditions permitting, you must attempt the guarded read pair below by default.
   Do not assume the fresh observation will match: only its returned evidence
   determines whether config may follow within that invocation. Separate calls
   are a fallback for a concrete eligibility or delivery constraint, not a
   discretionary alternative for an otherwise eligible, deliverable pair.

   On either path, check unchanged page/epoch/session, ready phase, current tic
   and image hashes; view the PNG or apply the visual evidence reuse rule above.
   The single `doom_get_config` with `leaseFile, sessionId` must confirm matching
   page/epoch/session/run, expected revision/configuration, the same frozen limit,
   an active run and remaining allowance. A matching PNG hash never skips this
   read or the fresh observation. If configuration/run identity changed
   unexpectedly, stop. Never repeat config after a successful pair.

   **Guarded read pair (the sole per-call model-inspection exception):** attempt
   one `functions.exec` invocation with sequential, conditional `await` calls to
   `tools.mcp__doom_decisions__doom_observe` and
   `tools.mcp__doom_decisions__doom_get_config`. This is one shot, never a loop,
   parallel dispatch or permission for a third tool call before model continuation.
   Never include `doom_decide`, `doom_set_*` or image viewing in the pair.

   Pair only with a reliable baseline PNG already delivered and successfully
   inspected by the model in a prior continuation within this same bounded run,
   with its provenance recorded above and no known ended/exhausted authorization.
   No pairing at attachment/startup or the first post-`doom_start_run` observation:
   open that PNG as required. Never carry a baseline across `doom_start_run`.

   Call observe exactly once with the retained `leaseFile`. Before any second
   call, mechanically inspect the complete MCP envelope and parsed canonical
   payload under the result rules above. Require `isError: false`, no domain error,
   the complete expected observation shape/types (including counters, telemetry,
   facing probe, `previousAction` and absolute `pngPath`), valid correlation IDs
   and a fresh, never-reused `observationId`. Require `phase: "ready"`, unchanged lease/owner context and
   matching returned page/epoch/session; require the baseline's tic, current
   `frame.tic === tic`, matching `pngSha256`, and native/Canvas hashes equal to
   each other and their respective viewed-baseline hashes. Rely on existing
   CLI/controller PNG/native verification; never compare filenames or recreate
   native-frame verification. Observation does not export run ID/revision:
   validate those through config, not invented observation fields.

   Only after every guard passes, call get-config once with that same lease and
   the fresh observation's `sessionId`, then return. Run activity, run ID, revision,
   configuration, frozen limit and allowance are checked by the model from this
   config before any write or decision; observe need not prove activity before
   this read-only lookup. Inactive/wrong run, changed revision/configuration,
   exhaustion or config failure never permits a write or decision. A failed or
   uncertain config read returns the observation and available failure information;
   stop without retry, reattachment or alternate transport.

   Return each complete canonical domain payload with its tool name and `isError`
   status, once (for example, `text({tool, isError, result: payload})`); do not also
   serialize its JSON fallback. Preserve every field, including telemetry,
   `previousAction`, hashes, configuration/revision, accounting and errors. Return
   control to the model, which honors termination first and inspects both complete
   results before planning or any further tool call. This supplies step 5's single
   config read; do not repeat it. Post-CAS boundaries follow this same default
   selection with a fresh post-write observation; pre-write IDs remain invalid.

   Select sufficient host output capacity before attempting the pair, and reassess
   after observe before taking the extra call. A small synthetic sample proves no
   universal size guarantee. If delivery of both complete results cannot be
   assured, use separate calls; if observe already succeeded, return it completely
   without calling config and continue separately after model inspection, never
   repeat observe. Never summarize, truncate or drop fields to fit. Any already
   uncertain/truncated delivery ends play conservatively, never counts as a
   successful pair or permits recovery/replay.

   A valid new/changed frame or unknown/unreliable viewed baseline returns the
   complete observation alone for mandatory model image inspection, then ordinary
   separate get-config. Stop, terminal observation, malformed/incomplete/error or
   uncertain observation, or lease/session mismatch also returns without config,
   but follows the existing termination rules instead of continuing. No retries.
   Exact human Stop and verified terminal behavior above take priority throughout.

   If pairing is not attempted despite a recorded baseline, or observe returns
   without config, record one short, concrete reason in the conversation record
   or permitted user-visible narration: e.g. unverified baseline, mandatory
   post-start view, changed hashes/tic, scope mismatch, error/Stop, or uncertain
   complete-output capacity. Honor exact Stop/terminal replies without extra
   narration or tool calls. A reason never overrides termination or the guard.

   When useful, prepare ONLY high-level instructions for a temporary absolute UTF-8
   text file (maximum 16000 characters), retaining useful effective instructions and
   `{{tics}}`. Include uncertainty explicitly, e.g. a possible opening rather
   than invented unseen geometry. Do not include credentials, unrelated secrets or
   command/action overrides. Revise only when verified evidence warrants it.
   Before EVERY `doom_set_prompt` request, send a user-visible Codex commentary message:

   - **Why change:** cite specific verified observations and explain how they
     motivate the new navigation guidance. Distinguish observations from hypotheses.
   - **New Decisions API prompt:** show the full replacement text verbatim in a
     fenced text block, never a summary, diff or placeholder. Tool arguments alone
     do not count as disclosure.

   Optionally add one sentence explaining the substantive change from the current
   prompt. Write exactly the displayed replacement text to the instructions file
   and submit it unchanged through:
   `doom_set_prompt` with `leaseFile, sessionId, runId, revision, instructionsFile`.
   After inspecting `isError` and the complete domain result, honor the
   termination rules above first; otherwise briefly report whether the replacement
   was applied. Call it active and use the returned revision only after a confirmed
   successful response. Explicitly report failure, conflict or uncertainty without
   claiming success, and follow the existing conservative termination rules.
   Do not repeat the full prompt on decisions when it has not changed.
   A stale revision, any open human editor or other conflict ends this workflow;
   never retry or overwrite a draft. There is no
   manual copy/paste relay. For inclusion edits use the full
   `doom_get_config`/`doom_set_config` read/edit/CAS contract below.
   Inclusion-only edits are not prompt revisions; changing `instructionTemplate`
   through `doom_set_config` requires the same disclosure and result confirmation.
   After each successful edit, repeat this step's fresh observation/image/config
   checks, confirming the returned revision/configuration and unchanged run
   counters before proceeding. Model and Manual/Continuous duration remain browser-owned.
6. Choose an integer duration from 1 through 35 inclusive before EACH decision,
   using the current verified screenshot/state, recent action outcome, threat and
   obstacle proximity, progress, and uncertainty about the provider's next action.
   Use 6 as the safe default when evidence does not support a change. Larger
   durations are not automatically better: long turns can overshoot, held fire
   can waste ammo, and held use does not prove repeated door activation. A clear
   facing probe alone does not prove clearance; uncertain or stalled movement
   and nearby threats/obstacles favor earlier re-observation.
   If the chosen duration differs from effective `tics`, use the complete-replacement
   `doom_set_config` contract below with current scope/revision. After confirming success,
   repeat step 5, including its guarded-pair default or justified fallback, with
   a fresh post-write observation and one config read to confirm the new revision,
   same active run/frozen limit and remaining allowance before deciding. Reassess
   the horizon against that fresh evidence. Never reuse the pre-write observation.
   If duration is unchanged, do not write configuration just to repeat the value.
   Before EVERY nondefault decision (chosen tics other than 6), state a concise,
   observable reason in a user-visible Codex message before issuing `doom_decide`.
   Ground the reason in verified facts, distinguish inferences explicitly, and
   acknowledge that the Decisions API's next low-level action is not yet known.
   This explanation is required even when retaining the same nondefault tics from
   the previous decision. No duration explanation is required for default 6.
7. Invoke exactly once using the latest fresh observation ID, whether its PNG
   was just viewed or its visual evidence safely reused:
   call `doom_decide` with `leaseFile, observationId, sessionId, runId, revision`.
   This requests one Decisions-selected action through the existing controller.
   Inspect structured outcome, SDK invocation and requested/reported/verified/end
   tics. Apply the terminal rule above first. For healthy `completed` results,
   actually open the resulting PNG and compare it with the preceding PNG.
   Immediately after successful delivery and model inspection, update the viewed
   baseline record above before the next observation.
   Verify session continuity and eligible `previousAction`. Terminal prefixes are
   distinct from completed N tics; other outcomes without PNGs are not new scenes.
8. Only a successfully delivered, correlated, healthy `completed` receipt with
   matching evidence AND its verified resulting PNG actually viewed permits
   proceeding to the next observation. Process the full receipt and update the
   navigation hypothesis. Do not routinely call `doom_get_config` immediately afterward.
   If the bounded run may continue, repeat steps 4–7 using step 5's guarded-pair
   default or justified fallback for the fresh observation and single config read
   to verify the SAME run and its allowance before another `doom_decide`.
   The completed receipt alone never authorizes another decision. Step 5's guarded
   read pair is the only exception to individual foreground reasoning between Doom
   domain calls; never use a script that loops independently of Codex.

   Final accounting exception: when locally confirmed completed decisions appear
   to consume the known frozen limit, after the final healthy receipt and required
   image inspection call `doom_get_config` once, without another `doom_observe`
   or `doom_decide`.
   Require matching page/epoch/session/run, expected revision/configuration and
   frozen limit, and valid returned run counters showing `reserved === limit`
   and `remaining === 0` before reporting normal exhaustion. Neither the local
   count nor `active: false` proves exhaustion. If accounting cannot be confirmed,
   stop conservatively; never retry `doom_decide`, reclaim allowance or resume the run.
   Stop, terminal and error rules above take priority over this exception: never
   add post-error accounting or a recovery probe, or any call after agent-stopped;
   a verified terminal result permits only its prescribed terminal PNG viewing.
9. Stop on exhausted/inactive authorization, Stop/lease revocation, terminal or
   retired state, session/observation mismatch, prompt conflict, failed/ambiguous
   result, uncertain consumption, unavailable image viewing or achieved goal.
   Except for the exact Stop/terminal replies above, tell the human to click
   **Stop Agent** when ending early. Exhaustion requires
   no further human input. Do not seek another run, invoke `doom_start_run` again or
   switch to manual mode to extend the cap. Manual controls resume only after
   safe settlement.

Never automatically retry ANY MCP operation or replace a stopped/stale lease.
Decision command IDs are tied to observation IDs and remain spent even on rejection. Run
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

`doom_get_config` returns `{sessionId, revision, configuration, run}`. `configuration`
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

`doom_set_config` with `leaseFile, sessionId, runId, revision, configFile`.

Writes require a ready, idle controller and the current active bounded run and
revision. `doom_set_config` fully replaces the seven fields. `doom_set_prompt` remains an
instructions-only adapter to the same ephemeral configuration and revision.
Successful edits preserve the run ID and every attempt counter, increment revision
and invalidate old observations. Repeat step 5's fresh observation/image/config
verification, including its guarded-pair default or justified fallback, for the new
revision/configuration and same active run/frozen limit/allowance before another
decision.
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
broker and MCP implementation use the same parser; output retains every evidence
field and replaces only PNG data with its verified local `pngPath`.

If the picker does not discover this project skill, start a fresh Codex
conversation from this worktree. Do not alter global Codex configuration.
