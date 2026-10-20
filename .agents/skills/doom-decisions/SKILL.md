---
name: doom-decisions
description: Supervise a browser-authorized run of up to three Decisions API attempts in the foreground, viewing every verified Doom PNG and adapting saved high-level instructions. No browser driving or unattended loop.
---

# Doom Decisions — bounded foreground play

Interpret `play` as a foreground conversation workflow, capped by ONE browser
authorization for up to THREE possibly billable decision attempts. Never start
a server/browser, prepare a game, click/drive/inspect Chrome or DevTools, read
`.env*`, the credential bootstrap module or browser credential storage. Never
create a daemon, autonomous CLI loop, persistent map or external memory service.
Attaching, observing, reading/writing instructions and invoking this skill never
authorize charges. Only the human's browser click does. The existing Decisions
provider selects EVERY low-level action; never inject an action or duration or
ask the provider to choose a particular action identifier.

The human starts `npm --prefix app run dev:agent` and manually opens
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
3. Read saved effective instructions (not human editor drafts):
   `node scripts/doom-agent.mjs get-prompt --lease ABSOLUTE_LEASE_FILE --session SESSION_ID`.
   Ask the human to click **Allow up to 3 Agent Decisions** in the attached page
   and confirm in chat. Wait for that confirmation. Do not poll for consent or
   use `decide` to discover it. Then get-prompt once to read the controller's
   actual run ID, revision, active/remaining/reserved/SDK-invoked counts. Require
   an active run with positive remaining allowance; no grant means observe-only.
4. Keep a concise in-conversation record: goal; page/epoch/session/tic; last
   verified action/tics/outcome; visual interpretation and confidence; navigation
   hypothesis; progress/stall evidence; one next high-level objective; actual run
   counters. Separate hypotheses from verified native facts. XY endpoints or a
   screenshot do not prove a collision or door usability. Rich collision/facing
   metadata is browser-only and is NOT exported in the observation.
5. When useful, write ONLY high-level instructions to a temporary absolute UTF-8
   text file (maximum 16000 characters), retaining useful saved instructions and
   `{{tics}}`. Include uncertainty explicitly, e.g. a possible opening rather
   than invented unseen geometry. Do not include credentials or command/action
   overrides. Update through:
   `node scripts/doom-agent.mjs set-prompt --lease ABSOLUTE_LEASE_FILE --session SESSION_ID --run RUN_ID --revision REVISION --instructions-file ABSOLUTE_TEXT_FILE`.
   Use the returned revision. A stale revision, any open human editor or other
   conflict ends this workflow; never retry or overwrite a draft. There is no
   manual copy/paste relay. Model, N and telemetry settings remain browser-owned.
6. Before EACH decision, obtain a fresh observation and actually view its PNG.
   After set-prompt this is mandatory: NEVER use the pre-write observation.
   Check unchanged page/epoch/session, ready phase, current tic and image hashes.
   Get-prompt once to verify the same run ID/revision is active with allowance.
   If configuration/run identity changed unexpectedly, stop.
7. Invoke exactly once for the observation just viewed:
   `node scripts/doom-agent.mjs decide --lease ABSOLUTE_LEASE_FILE --observation OBSERVATION_ID --session SESSION_ID --run RUN_ID --revision REVISION`.
   This requests one Decisions-selected action through the existing controller.
   Inspect structured outcome, SDK invocation and requested/reported/verified/end
   tics. Actually open the resulting PNG and compare it with the preceding PNG.
   Verify session continuity and eligible `previousAction`. Terminal prefixes are
   distinct from completed N tics; other outcomes without PNGs are not new scenes.
8. Only a healthy `completed` result with matching evidence AND an image actually
   viewed permits another iteration. Read actual counters with get-prompt. Update
   the navigation hypothesis, then repeat steps 4–7 while the SAME run remains
   active and has remaining allowance. This is individual foreground reasoning
   between tool calls, never a script that loops independently of Codex.
9. Stop on exhausted/inactive authorization, Stop/lease revocation, terminal or
   retired state, session/observation mismatch, prompt conflict, failed/ambiguous
   result, uncertain consumption, unavailable image viewing or achieved goal.
   Tell the human to click **Stop Agent** when ending early or after exhaustion.
   Do not seek another run or switch to single-grant/manual mode to extend the
   cap. On explicit request, one non-billable get-prompt/observe with the old lease
   can verify rejection. Manual controls resume only after safe settlement.

Never automatically retry ANY command or replace a stopped/stale lease. Decision
command IDs are tied to observation IDs and remain spent even on rejection. Run
reservations are never refunded, including pre-create failures. A lost response
or timeout can mean unknown action outcome or charge; stop and ask the human to
inspect the page. Abort never proves remote processing/billing stopped. Stop
revokes local admission synchronously; pending readers retain ownership through
safe cleanup, and dispatched work finishes verification. Result delivery may be
revoked even when an action was consumed. Reload and explicit attachment/consent
are required after Stop/disconnect; no reconnect, replay or rearming.

The separate **Allow 1 Agent Decision** control retains Slice B semantics. It is
not a reusable run grant and is not a fallback to extend `play`.

If the picker does not discover this project skill, start a fresh Codex
conversation from this worktree. Do not alter global Codex configuration.
