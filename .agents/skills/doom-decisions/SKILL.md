---
name: doom-decisions
description: Attach to an already-open local Doom Decisions dev:agent page, view a verified observation, and request exactly one Decisions-selected action only after the human grants one billable attempt in the browser. Never loop.
---

# Doom Decisions — one cycle

Interpret `play` as one bounded cycle. Never start a server/browser, prepare a
game, click browser controls, select a Doom action, rewrite prompts, or enter a
gameplay/polling loop. Never read `.env*`, the credential bootstrap module, or
browser credential storage. The browser's existing provider selects the action.
Attaching, observing and invoking this skill never authorize charges.

The human starts `npm --prefix app run dev:agent` and manually opens
`http://127.0.0.1:5174/`. Wait for their page to reach verified ready. Reuse that
server; a busy port is not permission to start another one.

From the repository root:

1. Run `node scripts/doom-agent.mjs attach` once. Retain its absolute `leaseFile`,
   page ID and epoch in this conversation. Reuse a live lease already owned here.
2. Run `node scripts/doom-agent.mjs observe --lease ABSOLUTE_LEASE_FILE` once.
3. Actually open the returned absolute `pngPath` using `view_image` (or the local
   image-viewing tool) and deliver its image content to the model. A path or
   base64 text alone is not visual evidence. If viewing is unavailable, report
   that limit and stop before requesting a decision.
4. Describe visible content, verified tic/health, page/session identity and matching
   native/Canvas hashes. Distinguish visible observations from unseen-room guesses.
   Retain the returned `observationId`.
5. Explain that the human must click **Allow 1 Agent Decision** in this attached
   browser page to permit exactly one possibly billable provider attempt. Wait
   for their confirmation of that click before executing the next step. Do not
   poll for consent, mint it programmatically, or treat this skill invocation as
   permission. No grant means observe-only. The controller independently enforces
   the browser grant even after human chat confirmation.
6. Only after that confirmation, invoke exactly once:
   `node scripts/doom-agent.mjs decide --lease ABSOLUTE_LEASE_FILE --observation OBSERVATION_ID`.
   Use the identity from the PNG just viewed. The controller freezes the browser's
   saved prompt and tics. It rejects changed observation/configuration/lease state.
7. Inspect the structured outcome and requested/reported/verified tics. For a
   verified resulting `pngPath`, actually open it and compare the visible scene
   with the preceding PNG. A terminal prefix is distinct from completed N tics.
   Stopped/retired/error results without a PNG are not verified new scenes.
8. Stop this cycle. Do not issue another decision or obtain another grant. Tell
   the human they can click **Stop Agent** to revoke the attachment. On their
   explicit request, one observation with that lease can verify rejection.

Never automatically retry a command or replace a stopped/stale lease. A decision
ID is reserved even on rejection; a lost response/timeout can leave the action's
outcome unknown. Do not replay it or infer that Abort undid execution or billing.
Report the fixed error and ask the human to inspect the page. Stop Agent revokes
local admission synchronously; pending readers keep manual controls locked until
safe cleanup, while dispatched work finishes verification. Revocation may prevent
result delivery even when an action was consumed. Reload plus explicit attachment
is required after Stop/disconnect; no automatic reconnect or rearming.

If the picker does not discover this project skill, start a fresh Codex
conversation from this worktree. Do not alter global Codex configuration.
