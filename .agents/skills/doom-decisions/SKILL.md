---
name: doom-decisions
description: Observe an already-open local Doom Decisions dev:agent page with a controller-verified screenshot and telemetry. Use for $doom-decisions play; this Slice A skill is observation-only and cannot submit gameplay decisions.
---

# Doom Decisions — observe only

Interpret `play` as attach and observe once. Do not start a server/browser, prepare
a game, submit a Decisions API request, click Next/Continuous, edit prompts, or
enter a gameplay/polling loop. Never read `.env*`, the credential bootstrap
module, or browser credential storage.

The human starts `npm --prefix app run dev:agent` and manually opens
`http://127.0.0.1:5174/`. Wait for their page to reach the existing verified ready
state. Reuse that server; a busy port is not permission to start another one.

From the repository root:

1. Run `node scripts/doom-agent.mjs attach` once. Retain its absolute `leaseFile`,
   page ID and epoch in this conversation. If this conversation already owns a
   live lease, use it instead of attaching again.
2. Run `node scripts/doom-agent.mjs observe --lease ABSOLUTE_LEASE_FILE`.
3. Open the returned absolute `pngPath` using the available local image-viewing
   tool (for example `view_image`). Ensure the tool actually delivers image
   content to the model. A path or base64 text alone is not visual evidence.
   If image viewing is unavailable, report that limit; do not claim to see Doom.
4. Give a concise description of visible game content and the reported tic,
   health, page/session identity, and matching native/Canvas hashes. Distinguish
   visible observations from guesses about unseen rooms or game objectives.
5. Leave the attachment active. Tell the human they can click **Stop Agent**;
   on their request, use the same lease for one observation to verify rejection.

Never automatically retry an attach/observe failure or replace a stopped/stale
lease. Report the fixed error. A stopped/disconnected page requires a human
reload and explicit new attachment. Stop Agent fences observations only; it does
not cancel manual/Continuous inference or establish Slice B Agent Stop behavior.

If the picker does not discover this new project skill, start a fresh Codex
conversation from this worktree. Do not alter global Codex configuration.
