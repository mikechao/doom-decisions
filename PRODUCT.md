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
native Doom engine compiled to WASM. Each human-triggered decision observes the
current rendered game image and continues the same game after successful execution.
Action selection, human-selected duration, and verified native execution are
distinct parts of the experience.

## Operating Context

The owner-accepted v0.1.0 MVP is a standalone static browser app. The user selects
their own local Freedoom 0.13.0 Phase 1 IWAD, supplies an OpenAI API key, chooses a
duration, and clicks **Next Decision** for each action. The IWAD stays local and is
never packaged with the app; the generated engine loads automatically.

Browser-direct API calls use the official OpenAI SDK. Credentials stay in memory
for the session. This temporary BYOK architecture requires trust in the served
page and its scripts; it does not establish production credential security.
Refresh starts a fresh game and clears in-memory credentials.

Current setup, supported asset identity, credential behavior, and authorized
browser verification procedures are documented in [app/README.md](app/README.md).
Execution approval requirements remain in [AGENTS.md](AGENTS.md).

## Capabilities and Constraints

- IWAD selection automatically prepares real E1M1 in a fresh Worker/game and
  verifies exactly one mandatory neutral first tic without an API request.
- Each **Next Decision** click admits at most one Decisions request. There is no
  autoplay or automatic retry. The deliberately step-by-step MVP waits between
  clicks and during API requests.
- The human chooses an integer duration of **1–20 tics**, initially **6**. Duration
  is captured at click admission, before asynchronous work.
- The model selects one of `neutral`, `forward`, `turn_right`, `backward`,
  `turn_left`, `fire`, or `use`. It never chooses duration or combined actions.
- Successful decisions retain the same Worker and native game state. Snapshots,
  screenshots, passive rendering, waits, and idle must advance zero gameplay tics.
- Requested, reported, and independently verified native tic counts are separate
  evidence. Uncertain native completion must never be presented as success or
  automatically replayed. Fatal retirement requires reload to restart.
- Decision history and advanced evidence expose actions, duration, execution
  counts, checkpoints, frame hashes, and sanitized request information.
- The MVP has no visible Prepare, Stop, Reset, or New Game controls, no account
  system, backend, proxy, or persistent credential storage.
- The existing frontend uses vanilla TypeScript and DOM APIs, plain CSS, Vite,
  and an app-owned ES module Worker. Preserve the established engine/Worker
  contracts; React and Tailwind are outside the current stack.
- Continuous autonomous gameplay is a **future goal**, not a current capability.
  Its interaction model and implementation are undecided.

## Brand Commitments

The product name is **Doom Decisions**. Product language should make AI gameplay
and the human's duration control understandable, with developer evidence available
without making the primary experience feel like operating a debugging tool.

## Evidence on Hand

- [README.md](README.md) and [app/README.md](app/README.md) describe the accepted
  MVP and current operating constraints.
- [M4-B verification](docs/doom-m4b-verification.md) records owner-run Chrome
  rendering, neutral-first 1/1/1 counts, and passive-render/snapshot/five-second
  idle evidence. Its historical controls and paths do not define the current UI.
- [M4-C verification](docs/doom-m4c-verification.md) records the owner's report of
  14 successful real Decisions API decisions, with five supplied receipt summaries
  and a duration change from 6 to 2 while gameplay continued. Full Worker-instance
  continuity evidence, frame/payload proof, exact network accounting, instrumented
  post-decision idle equality, and full browser failure-path verification were not
  supplied. Acceptance of the reduced MVP does not fill those gaps.
- Static checks and builds are distinct from browser/API runtime evidence.
  Owner-run observations must not be described as tests personally run by Codex.
- [Vendor provenance](docs/doom-vendor-provenance.md) documents source and license
  context. Public distribution still requires review of redistribution rights,
  corresponding-source/build obligations, notices, and unresolved asset rights.

## Product Principles

1. Keep watching and experimenting with AI gameplay central; make technical
   evidence available without overwhelming that experience.
2. Make control legible: the human chooses when and how long; the AI chooses the
   action. Preserve explicit clicks throughout the current MVP.
3. Explain results honestly. Distinguish the selected action from verified native
   execution, and report uncertainty rather than implying success.
4. Preserve game continuity and passive observation. Idle time and inspection
   must not advance simulation.
5. Keep current capability, future ambition, owner reports, and independently
   collected evidence clearly distinguished.
