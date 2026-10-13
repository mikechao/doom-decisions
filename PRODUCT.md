# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary audience is developers and AI enthusiasts interested in seeing how
OpenAI's Decisions API can control a real game. Secondary users are Doom fans
curious about AI-driven gameplay.

Users want to watch and experiment with an AI playing Doom. Developers also need
access to technical evidence that explains what was requested and executed.

## Product Purpose

Doom Decisions lets people watch real Doom in their browser while OpenAI's
Decisions API selects gameplay actions.

A successful session lets someone easily load Doom, provide their own OpenAI API
key, and watch AI-selected actions visibly affect gameplay. They should understand
which action the AI selected, how many Doom tics executed, and what happened as a
result. The human controls decision duration; the AI selects the action.

The experience should emphasize watching and experimenting with AI gameplay.
Technical evidence remains available to developers without overwhelming the game.

## Positioning

The demo connects real Decisions API responses to bounded actions in a modified
native Doom engine compiled to WASM. Each decision admitted by **Next Decision**
or explicitly started **Continuous Mode** observes the current rendered game image
and continues the same game after verified execution and a verified resulting frame.
Action selection, human-selected duration, and verified native execution are
distinct parts of the experience.

## Operating Context

The owner-accepted v0.2.0 Continuous Mode MVP is a standalone static browser app.
The user selects their own local Doom IWAD, supplies an OpenAI API key, chooses a
duration, and clicks **Next Decision** for one action or **Start Continuous Mode**
for sequential decisions within a per-run API-attempt budget. **Stop** closes
admission and finishes cleanup or current-action verification. The IWAD stays
local and is never packaged with the app; the generated engine loads automatically.
IWAD compatibility is best-effort and requires the controlled engine's verified
Doom E1M1 preparation. Freedoom Phase 1 and the owner's shareware file have been
owner-tested; universal WAD compatibility and malicious-input safety are not established.

Browser-direct API calls use the official OpenAI SDK. Credentials stay in memory
for the session. This temporary BYOK architecture requires trust in the served
page and its scripts; it does not establish production credential security.
Refresh starts a fresh game and clears in-memory credentials.

Current setup, local IWAD limitations, credential behavior, and authorized
browser verification procedures are documented in [app/README.md](app/README.md).
Execution approval requirements remain in [AGENTS.md](AGENTS.md).

## Capabilities and Constraints

- IWAD selection automatically prepares real E1M1 in a fresh Worker/game and
  verifies exactly one mandatory neutral first tic without an API request.
- Each **Next Decision** click admits at most one Decisions request. **Start
  Continuous Mode** explicitly admits sequential decisions; play never starts
  without user admission. There are no automatic retries or restarts.
- Continuous Mode freezes a positive JavaScript safe integer API-attempt budget
  per run, default **2**, separate from decision duration. Each SDK invocation
  consumes one attempt, including failures and cancellations; preparation and
  pre-request failures consume none. There are no refunds.
- The human chooses any **positive JavaScript safe integer** of tics, initially
  **6**. Duration is captured per decision at admission, before asynchronous work.
  Changes during continuous play affect only later decisions.
- The model selects one of `neutral`, `forward`, `turn_right`, `backward`,
  `turn_left`, `fire`, or `use`. It never chooses duration or combined actions.
- Successful decisions retain the same Worker and native game state. Snapshots,
  screenshots, passive rendering, waits, and idle must advance zero gameplay tics.
- Only a verified action and resulting frame permit the next continuous decision.
  Manual admission stays locked while a continuous run owns admission or cleanup.
  SDK helpers and the underlying response reader must both settle before new work;
  a never-settling reader keeps admission locked, even after Stop or timeout.
- Stop before dispatch fences late choices and awaits cleanup and unchanged-state
  proof. After dispatch it finishes receipt/frame verification. Verified death or
  E1M1 exit pending retires the session; exit pending does not establish E1M2.
- Requested, reported, and independently verified native tic counts are separate
  evidence. Uncertain native completion must never be presented as success or
  automatically replayed. Fatal retirement requires reload to restart.
- Decision history and advanced evidence expose actions, duration, execution
  counts, checkpoints, frame hashes, and sanitized request information.
- The MVP has no visible Prepare, Reset, or New Game controls, no account
  system, backend, proxy, or persistent credential storage.
- The existing frontend uses vanilla TypeScript and DOM APIs, plain CSS, Vite,
  and an app-owned ES module Worker. Preserve the established engine/Worker
  contracts; React and Tailwind are outside the current stack.

## Brand Commitments

The product name is **Doom Decisions**. Product language should make AI gameplay
and the human's duration control understandable, with developer evidence available
without making the primary experience feel like operating a debugging tool.

## Evidence on Hand

- [README.md](README.md) and [app/README.md](app/README.md) describe the accepted
  MVP and current operating constraints.
- Owner reports cover real E1M1 preparation, neutral-first **1/1/1**, matching
  native/Canvas hashes and passive/idle checks; **14 successful manual API decisions**
  with five supplied receipt summaries; and later real Doom death detection at
  decision **#48**, **N=20**, cumulative **tic 961**. See
  [prototype evidence](app/README.md#prototype-acceptance-and-evidence) for limits.
  Exact Worker/frame linkage and independently instrumented exit-pending and
  early-prefix proof remain uncollected; prototype acceptance does not fill those gaps.
- Static checks and builds are distinct from browser/API runtime evidence.
  Owner-run observations must not be described as tests personally run by Codex.
- [Vendor provenance](docs/doom-vendor-provenance.md) documents source and license
  context. Public distribution still requires review of redistribution rights,
  corresponding-source/build obligations, notices, and unresolved asset rights.

## Product Principles

1. Keep watching and experimenting with AI gameplay central; make technical
   evidence available without overwhelming that experience.
2. Make control legible: the human chooses manual steps or explicitly starts/stops
   continuous play, owns the attempt budget and duration; the AI chooses the action.
3. Explain results honestly. Distinguish the selected action from verified native
   execution, and report uncertainty rather than implying success.
4. Preserve game continuity and passive observation. Idle time and inspection
   must not advance simulation.
5. Keep current capability, future ambition, owner reports, and independently
   collected evidence clearly distinguished.
