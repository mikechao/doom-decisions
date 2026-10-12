# Doom tic semantics

**35 Doom tics = 1 Doom second (of simulated game time).**
This does not mean the browser runs 35 tics per wall-clock second: our controller determines when simulation advances.

## What one tic does

A tic is one game logic update. The engine builds and consumes a player input
command, updates player movement and world logic, and advances game timers.
Monsters and other objects progress through their own timed states; this does
not mean every monster performs one AI action on every tic. Movement can also
include several collision-handling substeps within one tic.

A tic is not a displayed frame, a browser `requestAnimationFrame` callback, or an
API call. Rendering draws the current game state. API waits, idle periods,
snapshots, and renders do not intentionally advance simulation; the controller
checks that observed native state stays unchanged during passive operations.

## How a decision advances the game

The human selects **N = 1–20 tics**. The controller freezes that duration for the
admitted decision; the model selects the action, not N. The Worker makes up to N
synchronous controlled steps and verifies each completed step:

Selected N → controller/Worker batch → WASM `stepNeutralControlled` →
`G_A21Step` → `G_TickerContinuation` → `P_Ticker` → committed tic/virtual clock.

Each successfully completed native step advances exactly one logic tic. A normal
successful, nonterminal batch therefore advances exactly N tics. Controlled
actions do not use the legacy `tickGame`/`TryRunTics` scheduler.

The action's input applies throughout the entered tics. Expiration adds no
release tic; the next accepted action replaces the held key states.

## Converting tics to time

**Verified completed tics ÷ 35 = simulated Doom seconds.**

For fully completed batches:

| N | Simulated Doom time |
| --- | --- |
| 1 | ≈ 28.57 ms |
| 6 | ≈ 171.43 ms |
| 20 | ≈ 571.43 ms |

Requested tics, Worker-reported completion, and controller-verified completion
are separate counts. Use verified completion for this calculation. A supported
death or E1M1 exit-pending outcome can stop after k < N fully completed tics;
its duration is k/35 seconds. Exit pending does not prove intermission or E1M2.
A fault may leave additional execution beyond the verified prefix uncertain;
that prefix establishes only the known completed time.

Preparation adds **one verified neutral tic**, included in cumulative verified
tics. In this controlled session, `gametic`, `leveltime`, and `virtualTicks`
track completed simulation tics. Native `virtualMs` is
`floor(completed tics × 1000 / 35)`, an integer virtual-clock conversion, not
elapsed browser time.

## Source evidence

Paths are relative to this document. Line numbers were checked at source HEAD
`9c42a5c47d00aa9f93e0e3bda3e42358b8dceec4`.

| Claim | Source and symbols |
| --- | --- |
| Controlled browser build | [build.sh:20](../build.sh#L20); [engine/doom/Makefile:216–221](../engine/doom/Makefile#L216-L221): `controlled-title`, `DOOM_CONTROLLED_TITLE`. |
| 35 tics per simulated second | [engine/doom/doomgeneric/include/i_timer.h:22](../engine/doom/doomgeneric/include/i_timer.h#L22): `TICRATE`; [i_timer.c:35–80](../engine/doom/doomgeneric/src/i_timer.c#L35-L80): `I_A21CommitTic`, `I_GetTime`, `I_GetTimeMS`. |
| Frozen N; model chooses action | [app/src/decision.ts:31–46](../app/src/decision.ts#L31-L46): `admitDecision`; [app/src/main.ts:672–673](../app/src/main.ts#L672-L673): `decide`; [main.ts:902–909](../app/src/main.ts#L902-L909): `runOneDecision`. |
| Batch and actual WASM boundary | [app/src/worker.ts:61–79](../app/src/worker.ts#L61-L79): `i11Action`; [worker.ts:367–373](../app/src/worker.ts#L367-L373): action handler; [engine/doom/src/doom_wasm.c:138–143](../engine/doom/src/doom_wasm.c#L138-L143): `stepNeutralControlled`. |
| One step, one committed update | [engine/doom/doomgeneric/src/g_game.c:2228–2262](../engine/doom/doomgeneric/src/g_game.c#L2228-L2262): `G_A21Step`; [g_game.c:883–890](../engine/doom/doomgeneric/src/g_game.c#L883-L890): `G_TickerContinuation`. |
| World logic and timers | [engine/doom/doomgeneric/src/p_tick.c:110–121](../engine/doom/doomgeneric/src/p_tick.c#L110-L121): `P_Ticker`; [p_user.c:274–300](../engine/doom/doomgeneric/src/p_user.c#L274-L300): `P_PlayerThink`; [p_mobj.c:374–399](../engine/doom/doomgeneric/src/p_mobj.c#L374-L399): `P_MobjThinker`; [p_mobj.c:130–160](../engine/doom/doomgeneric/src/p_mobj.c#L130-L160): `P_XYMovement` substeps. |
| Verified counters and terminal prefixes | [app/src/worker-shared.ts:117–151](../app/src/worker-shared.ts#L117-L151): `assessE1M1`; [worker-shared.ts:243–272](../app/src/worker-shared.ts#L243-L272): `i11VerifyStep`; [app/src/decision.ts:140–213](../app/src/decision.ts#L140-L213): `verifyAction`. |
| Preparation and passive operations | [app/src/main.ts:1152–1155](../app/src/main.ts#L1152-L1155): neutral action; [main.ts:338–343](../app/src/main.ts#L338-L343): `passiveCheck`; [main.ts:886–891](../app/src/main.ts#L886-L891): API-wait check; [main.ts:1172–1185](../app/src/main.ts#L1172-L1185): idle check; [app/src/worker.ts:412–413](../app/src/worker.ts#L412-L413): snapshot; [engine/doom/src/doom_wasm.c:118–127](../engine/doom/src/doom_wasm.c#L118-L127): `renderControlled`. |

These conclusions come from source inspection; the durations are mathematical
deductions. This document does not report execution or independent verification
of the currently generated WASM, or measurements of browser wall time.
