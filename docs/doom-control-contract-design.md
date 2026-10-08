# Doom/WASM Control Contract Design

## 1. Purpose and Baseline

**Recommendation:** add an atomic, synchronous `stepOneTic(controlEpoch, commandSequence, heldMask)` for single-player controlled mode. Synchronize private engine input, retain `G_BuildTiccmd`, remove the scheduler's command backlog from this mode, and acknowledge at `P_PlayerThink` entry. A separate bounded phase operation handles menus, death/rebirth, and intermission without silently executing a playable tic. Rendering is separate. This is a proposal for review, not implementation authorization.

Starting point: the committed [feasibility investigation](doom-wasm-feasibility-investigation.md), read in full. On 2026-10-08, root HEAD is `a48a26c68d4be445973256d59b223cc48c212888`; HEAD gitlink, index gitlink, and submodule HEAD all equal **`31cc1af9656a8184830090c4e9f268383f5d7e15`**. Root and submodule status were clean before this document. No gitlink change is proposed in this task.

**Evidence convention:** statements describing existing functions below are source-verified against that local pinned checkout. Proposed behavior, pseudocode, signatures, assertions, and statuses are design requirements; their feasibility is not runtime-proven. There is still no `references/doom.wasm/build/` directory or browser WASM artifact. No build, installation, gameplay execution, or Decisions request was performed. The only repository change is this document.

The earlier verdict, **SUITABLE WITH SMALL EXTENSIONS, subject to runtime validation**, remains reasonable. “Small” must include a localized change to command/lifecycle ordering, not just setters and getters. If that ordering cannot be isolated as described, revise the verdict before expanding implementation scope. Decisions integration is out of scope.

All source paths are repository-relative. Throughout this document, `E/` abbreviates `references/doom.wasm/doomgeneric/`, and `A/` abbreviates `references/doom.wasm/`. Line numbers refer to the pinned revision. Source permalinks are provided alongside the major findings.

## 2. Current Control Path and Failure Modes

### Four different kinds of input evidence

```text
JS requested keys
  -> reportKeyDown/Up: adapter isKeyPressed
  -> DG_GetKey: statePreviouslyCommunicated (emitted edges)
  -> I_GetEvent / D_PostEvent
  -> D_ProcessEvents: M_Responder first, then G_Responder
  -> private gamekeydown (responder-effective held state)
  -> G_BuildTiccmd (built command)
  -> ticdata[maketic % BACKUPTICS].cmds
  -> RunTic: netcmds = cmds
  -> G_Ticker: rebirth/actions, THEN copy to players[i].cmd
  -> P_Ticker: pause/menu gates
  -> P_PlayerThink (player command consumption)
```

| Boundary | Verified source | What it establishes / fails to establish |
| --- | --- | --- |
| Requested state | `A/src/doom_wasm.c:29–67`, `reportKeyDown/Up` | Sets persistent adapter booleans; no engine acceptance. |
| Emitted events | Same file `DG_GetKey:123–142` | Updates a function-local communication cache before responders run; scans only keys 0–254. It is not a cache of responder acceptance. |
| Input scan | `E/src/i_video.c:I_StartTic:229`; `E/src/i_input.c:I_GetEvent:264–301` | Posts all encountered downs but breaks after one up. Multiple releases need not precede the next build. |
| Responder-effective keys | `E/src/d_main.c:D_ProcessEvents:127–138`; `E/src/g_game.c:G_Responder:631–727`, `gamekeydown:181` | Menus, HUD, status, automap, and finale responders can intercept events. A held arrow can be communicated to a menu without updating gameplay state. |
| Built command | `E/src/d_loop.c:BuildNewTic:132–184`; `E/src/g_game.c:G_BuildTiccmd:291–517` | Events and `M_Ticker` run before build; commands enter a ring. Builder mutates turn acceleration, clears mouse deltas/weapon-cycle request, and dequeues chat. Building twice is not a harmless verification technique. |
| Installed command | `E/src/d_net.c:RunTic:68–89`; `E/src/g_game.c:G_Ticker:733–855` | `RunTic` can advance the demo first. `G_Ticker` processes rebirth and game actions before copying `netcmds` to player commands; demo playback can overwrite them. Installation does not prove `P_Ticker` passed its gates. |
| Consumed command | `E/src/p_tick.c:P_Ticker:95–117`; `E/src/p_user.c:P_PlayerThink:190–270` | Player thinking happens only after pause/menu checks. Its entry is the delivery boundary; subsequent game rules govern use, weapon change, movement, and firing. |

Primary pinned sources: [adapter](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/src/doom_wasm.c), [scheduler](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/d_loop.c), [builder/lifecycle dispatch](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/g_game.c), [world ticker](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/p_tick.c).

### Why complete keys alone do not close the contract

1. `{forward, fire} -> {}` can leave forward held at the next build because one release ends the scan. `{forward, fire} -> {backward}` can likewise delay both release and press. A JS transaction only makes the adapter cache atomic.
2. `G_DoLoadLevel:573–578` clears engine keys and mouse/joystick state, but neither adapter cache. Repeating a down need not emit another edge. It also does not reset every builder accumulator, notably `turnheld`.
3. The command can already be built before `G_DoLoadLevel` runs inside `G_Ticker`; the newly spawned player can receive that old command after keys were cleared. Same-map identity comparison cannot detect this.
4. `G_Ticker` can install commands in a menu, intermission, or finale. `P_Ticker` can return without consuming one. `gametic` advancement alone is not playable simulation proof; dead-player world tics also advance `leveltime`.
5. Equal held masks do not determine equal commands without builder history/configuration and exclusive input ownership. Mouse/joystick state, `next_weapon`, double-click use, autorun configuration, special pause/save buttons, chat, and demo overwrite are other sources. The controlled mode must exclude these contributors and retain normal keyboard history within an uninterrupted gameplay interval.

An additional detail matters for acknowledgment: `P_PlayerThink:201–207` edits angle/forward/side for `MF_JUSTATTACKED` (chainsaw lunge). At lines 230–231 it can clear special buttons. Therefore “consumed command” means **the exact command delivered at player-think entry**, with a separately recorded command after the initial chainsaw adjustment, before movement. It does not promise that every command field stays unchanged for the entire thinker. Do not remove this game rule to make an equality assertion pass. [Player consumption source](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/p_user.c).

### Other build/processing paths

- `tickGame -> doomgeneric_Tick -> TryRunTics` also updates sound and calls `D_Display` (`A/src/doom_wasm.c:45`, `E/src/d_main.c:369–381`). `TryRunTics:636–737` queries time, builds ahead, waits, and can run multiple engine tics.
- `D_Display:270` calls `NetUpdate`; **`R_RenderPlayerView` also calls it four times** (`E/src/r_main.c:723,729,734,739`). Render-only must suppress all of these, not merely avoid `tickGame`. [Renderer source](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/r_main.c#L713-L739).
- Initialization is active: `D_DoomLoop:399` calls `TryRunTics`, then line 416 calls `doomgeneric_Tick`. `D_DoomMain:1606–1613` can start a load or title. The zero-argument adapter selects title by default; a new controlled initializer must stop before implicit simulation.
- `RunTic` checks `advancedemo` before `G_Ticker`. `D_DoAdvanceDemo:452–519` changes usergame/phase and can defer demo playback; `G_DoPlayDemo` calls `G_InitNew` (`g_game.c:1890`), and `G_ReadDemoTiccmd` replaces installed input (`790–791`). Controlled gameplay rejects demos and demo recording.
- Menu skill selection defers a new game and clears menus during responder processing (`E/src/m_menu.c:M_ChooseSkill:717–725`). A call that starts in a menu can load within that call.
- `G_DoReborn:1091–1125`, `G_DoNewGame:1454–1465`, `G_DoWorldDone:1320–1325`, and `G_DoLoadGame:1344–1385` reach load/new-player work. Save loading restores players after base-level load; the barrier must cover the **whole** load action, not just base-map setup.
- Intermission and finale read `players[].cmd` directly (`E/src/wi_stuff.c:WI_checkForAccelerate:1252–1273`, `E/src/f_finale.c:F_Ticker:156–175`). They require deliberate phase controls; old fire/use must not continue them accidentally.

## 3. Proposed Invariants

### Eligibility and a successful tic

P0 supports one local player, no netgame/drone/demo playback/demo recording, `ticdup == 1`, keyboard controls only. Eligible means initialized, `GS_LEVEL`, `usergame`, valid local player/actor, `PST_LIVE`, no menu/pause/advancedemo, `gameaction == ga_nothing`, and no unfinished transition barrier. Enforce this predicate even though stock `P_Ticker` allows an initial-view exception to its menu pause check.

For an operation with request `(e, s, M)`, let `T` and `L` be `gametic` and `leveltime` at the eligible boundary, `K` the controlled engine key mask, and `B` the one freshly built `ticcmd`. A successful playable step requires:

```text
at acceptance:       currentEpoch == e; sequence s is fresh; M is valid
immediately prebuild: K == M; no unowned input contributor is active
build:                exactly one G_BuildTiccmd(B, T) in this operation
at player entry:      still eligible; epoch == e; tag == (e, s, T); K == M
                      players[consoleplayer].cmd == B, field by field
simulation:           exactly one local P_PlayerThink entry, initially live
                      exactly one completed P_Ticker world tick
completion:           gametic == T + 1; same-map leveltime == L + 1
                      no second command or new-map simulation in the call
```

Equality is over named fields, not C padding or a checksum. `ticcmd_t` includes `forwardmove`, `sidemove`, `angleturn`, `buttons`, `chatchar`, `consistancy` (a **byte** in this port), `buttons2`, `inventory`, `lookfly`, and `arti` (`E/include/d_ticcmd.h:30–49`). Copy them to the public record as integer scalars. Gameplay controls use the first four; retain native consistency bookkeeping, ensure chat/other-game fields are zero, and report all fields so an unexplained contributor cannot hide. Exclusive controlled initialization and restricted menu taps prevent chat enqueue; a nonzero dequeued chat character is an invariant fault, not silently accepted extra input.

**Enforced by construction:** complete-state overwrite, single owner, one build/dispatch without a scheduler queue, generation barriers, and no simulation from rendering. **Independently checked in C:** read back `K` before build and at entry; compare actual player command to the saved build; validate its tag/current epoch; count player entries/world-ticker completions; verify tic deltas. The debug proof harness adds an independent expected keyboard-command oracle for simple movements/buttons and turn acceleration. A field copy from the request is not an effective-input acknowledgment.

Place acknowledgment at the beginning of `P_PlayerThink`, before command edits or death/live branching, after `P_Ticker` passed its gates. A live entry records delivery, not successful completion; mark the operation successful only when the world ticker finishes and the outer single-step increments `gametic`. Record `cmdAfterInitialRules` and a `CHAINSAW_OVERRIDE` bit before `P_MovePlayer`/death dispatch. Keep the original entry record immutable. No externally supplied command may contain `BT_SPECIAL`.

The invariant does not claim movement through walls, zero momentum after release, a fired shot without ammunition, immediate weapon readiness, or successful use of a nonexistent target. Live `usedown`/weapon state remain Doom-owned.

### Outcomes must distinguish transition timing

| Result | Accepted / consumed request? | Engine / world / playable tics | Meaning |
| --- | --- | --- | --- |
| `APPLIED` | Yes / yes | 1 / 1 / 1 | One eligible command delivered and one world tic completed. |
| `APPLIED_TRANSITION` | Yes / yes | 1 / 1 / 1 | Death or pending exit arose during that tic. Entry identity remains the old epoch; result reports the new epoch and reason. No new-map tic occurs. |
| `TRANSITION` | No / no | 0 / 0 / 0 | Lifecycle preparation changed epoch/phase before build or consumption. It may load a map/reset `leveltime`, without simulation. |
| `INELIGIBLE` | No / no | 0 / 0 / 0 | Menu, pause, title/demo, dead/reborn, intermission/finale, or missing player. No automatic phase advance. |
| `NEUTRAL_REQUIRED` | No / no | 0 / 0 / 0 | First playable command after a load must be `M == 0`. |
| `STALE_EPOCH`, `BAD_SEQUENCE`, `BAD_MASK`, `NOT_INITIALIZED` | No / no | 0 / 0 / 0 | Rejected before gameplay mutation. |
| `FAULT` | Never claim successful completion | Actual counters reported if returnable | Internal invariant failure; poison controlled mode and discard the instance. A trap/hang can produce no C result; Worker containment applies. |

`TRANSITION` cannot be inferred from a zero `leveltime` delta: load may reset/restore `leveltime`. Report actual before/after counters plus explicit engine/world/playable counts and before/after identity. “Playable tic” is an initially-live controlled player entry plus completed world tick, not every `GS_LEVEL`/dead/demo tick. Phase calls can advance a dead world by one, reporting world=1, playable=0.

A death/exit after entry invalidates **future** commands. It does not retroactively revoke the consumed command or undo the current world tic. Finish that tic with its original command, latch the transition, then clear controls. Clearing `players[].cmd` midway through an already-consuming thinker would change game semantics. A transition before entry invalidates any built command and aborts before `P_Ticker`, with zero gameplay and no tic increment. Prebuild validation only provisionally admits the request; `accepted=true` in a returned result commits at verified live player entry. Thus a built-but-invalidated request returns `TRANSITION`, `accepted=false`, `builtValid=true`, and `consumedValid=false`. A later completion failure is `FAULT`, with delivery evidence retained.

## 4. Lifecycle and Command Identity

Use three identities; do not collapse them into map number or one sequence counter.

| Identity | Owner / rules | Invariant protected |
| --- | --- | --- |
| `runId` | TS opaque unique token for each Worker/WASM instance. Never reuse after termination; init only once per instance. C is bound to its instance and need not receive this token. | An old Worker result or remote response cannot target a new instance that happens to have the same epoch/sequence. |
| `controlEpoch` | C uint32, starts at 1. Changes on every load, same-map reload, player rebirth boundary, death, pending level exit, and control eligibility interruption/resumption such as menu/pause. | Old input cannot cross a lifecycle/control boundary, including boundaries that preserve map identity. |
| `commandSequence` | TS issues nonzero uint32 values, strictly increasing for the whole run; C tracks a high-water mark. | Identifies a complete input request and prevents duplicate/out-of-order replay. |

Choose the name **controlEpoch**, rather than `loadEpoch`: death, menu interruption, and exit must invalidate intent even before a load happens. One such epoch is sufficient for P0; no separate load counter is needed. Map/episode are diagnostic values, not freshness tokens. A logical transition may increment the epoch several times (death, rebirth, load); require monotonicity and documented reasons, not “exactly +1 per restart.” Wrap of epoch/sequence/tic counters requires retiring the instance before overflow; do not silently wrap.

**Consumed sequence is a recorded identity, not a fourth independent counter.** The step result contains a validity flag and the actual consumed `(epoch, sequence, gametic, playerIndex)`. The last-consumed record may lag the request high-water mark; stale/rejected requests must never update it. Within one atomic single-player operation, a separate acknowledgment counter protects nothing further. Phase commands use source=`PHASE`, sequence=0, and cannot impersonate host gameplay consumption.

For every initialized, structurally valid gameplay request with `s > highWater`, record `highWater=s` before epoch/phase checks; rejected attempts also spend their sequence. Bad masks and `s==0` do not spend it. Resubmission always uses a new sequence. This avoids a previously rejected command later becoming acceptable after menu dismissal. High-water bookkeeping is the only allowed change on a stale-epoch rejection; no events, time advance, input change, or lifecycle processing. TS validates integer/range before the WASM i32 conversion, and C validates bit patterns and sequence/epoch rules again.

### Where invalidation occurs

- **Actual load entry:** hook `G_DoLoadLevel` before replacing the map/player; increment epoch and mark neutral-required even if map/episode are unchanged. Clear all future-command validity. The outer lifecycle action barrier remains active through save-game unarchive. Failure is a fault, not a successful loaded state.
- **Death:** hook the local player's `PST_DEAD` assignment in `P_KillMobj` (`E/src/p_inter.c:617`). Latch reason/epoch immediately, defer clearing the active consumed command until that world tick finishes.
- **Rebirth:** recognize local `PST_REBORN` before `G_DoReborn`; in P0 single player it requests `ga_loadlevel`. Recognize a dead phase operation setting reborn after its tick. No multiplayer respawn support is promised.
- **Exit:** hook `G_ExitLevel` and `G_SecretExitLevel` when `ga_completed` is requested, not only when intermission begins. `G_DoCompleted`/`G_WorldDone`/finale dispatch keep the phase barrier active. End-of-operation checks catch other pending actions and phase changes.
- **Menu/pause eligibility changes:** compare flags before/after bounded event processing and every operation. Increment epoch and neutralize on each eligibility edge; a menu close in a phase call stops before playable simulation. Opening a menu cancels prior gameplay intent. Menu closure without a load clears builder history but need not force an extra neutral playable tic; the next accepted full set is fresh.
- **Fresh restart:** dispose the Worker/WASM and obtain a new `runId`; never call the old initializer again. Menu new-game in the same instance still goes through load invalidation.

Invalidation resets adapter `isKeyPressed` and a promoted resettable `statePreviouslyCommunicated`, drains pending events, zeros engine keyboard/mouse/joystick controls, `next_weapon`, turn/double-click accumulators, mouse deltas, and pause/save sends. Reset input translation's shift state as part of input reset (`i_input.c:shiftdown`). Clear `ticdata`, align `maketic`/`recvtic` to current `gametic`, invalidate the active command tag, clear borrowed `netcmds`, and zero installed player commands **outside an executing world tick**. Even though controlled mode bypasses the ring, make the dormant backlog invalid and forbid switching back to the legacy scheduler in this instance.

After a load, leave controls neutral, with **no hidden first-player tic**. Return the load/phase result. The next gameplay request must use the new epoch, a new sequence, and mask 0; consume and acknowledge that one neutral tic, then lift neutral-required. This naturally lets Doom clear new-player `usedown/attackdown` (`G_PlayerReborn:947`). Do not manually reset those live player flags on each input request or override flags restored from a save before normal consumption.

TS owns rejection of stale remote responses using run identity, epoch, and the observation/request context it already owns. A same-epoch response to an obsolete observation is a TS policy failure that a load epoch alone cannot detect. C owns engine-side command invalidation, including transitions inside synchronous calls; cancellation in JS cannot substitute for it.

## 5. Chosen Minimal API

### Illustrative exports and wire representation

```c
// Proposed signatures, not patches. Pointer results are wasm32 i32 values.
void initControlledGame(void); // WAT: WASI _initialize, then controlled C init
const uint32_t *stepOneTic(uint32_t expectedEpoch,
                           uint32_t sequence, uint32_t heldMask);
const uint32_t *advancePhase(uint32_t expectedEpoch, uint32_t operation);
const uint32_t *getControlSnapshot(void);
void renderControlledFrame(void);
```

Five exports, no input queue, callbacks for acknowledgment, allocator protocol, JSON, or private engine offsets. Keep legacy exports for legacy hosts, but `tickGame`/key setters must be gated against use after controlled initialization. Mode is immutable and established **before** engine initialization, not by toggling a runtime flag after buffered work exists. Imported callbacks may copy/log frames/assets; reentrant engine operations are prohibited and checked by a busy guard.

Results and snapshots use an adapter-owned, explicitly indexed **uint32 word record**, little-endian, headed by `abiVersion` and `byteLength`. Signed fields are encoded as two's-complement i32 words. This is a public ABI schema, not `player_t`/`ticcmd_t` memory exposure. Assign indices and numeric enums in the implementation header/wrapper together, with compile-time size checks. All fields below are required; avoid optional heap objects:

- Status, source (`HOST`/`PHASE`/`NONE`), acceptance/build/consumption validity flags; transition reason bits; `neutralRequired` and sequence high-water mark.
- Expected epoch, epoch before/after, requested sequence/mask, actual prebuild mask, entry mask, built tag, and consumed tag. A rejected call reports absent build/consumption via flags, not fabricated zeros interpreted as a valid command.
- `gametic` and `leveltime` before/after; explicit counts of engine tics, world-ticker completions, playable tics, builds, and local player entries in this operation.
- Phase/flags before/after, pending `gameaction`, player validity/state/index, mission/episode/map before/after. Include menu, pause, usergame, demo flags so normalized phase is inspectable.
- Named built command fields, named player-entry command fields, `cmdAfterInitialRules` movement/button fields and override flag; last consumed identity with its own validity flag; invalidated-command count/reason for this operation.

The scratch record lives until the next bridge operation. TS immediately copies/decodes it before invoking another export, verifies version/length/pointer bounds, and recreates its view if `memory.buffer` changed. `getControlSnapshot` is read-only with respect to engine/input/time and reports zero operation counts; its last-consumed identity remains available. Render does not replace acknowledgment. No raw player/actor pointers escape. `runId` is attached by the Worker wrapper, not stored in C memory.

Minimal normalized phases: `UNINITIALIZED`, `TITLE_OR_DEMO`, `MENU`, `PAUSED`, `PLAYABLE`, `DEAD`, `REBORN_OR_ACTION_PENDING`, `INTERMISSION`, `FINALE`, `FAULT`. Overlays and pending-action flags accompany the phase; phase alone is not eligibility proof. Health is unnecessary: local player state/actor validity and the latched death reason suffice for P0. This avoids a general observation SDK.

### Complete gameplay mask

Use bits 0–8 for `Forward`, `Backward`, `TurnLeft`, `TurnRight`, `StrafeLeft`, `StrafeRight`, `Fire`, `Use`, `Run`; bits 9–16 for held weapon slots 1–8. No Alt strafe modifier, pause, save, menu, chat, cheats, weapon-cycle events, mouse, or joystick. Dedicated strafe keys plus turning cover compound strafe+turn without alternate-arrow meaning. Mask 0 is neutral.

Reject unknown bits, forward+backward, turn-left+turn-right, strafe-left+strafe-right, and multiple weapon slots. All other combinations are valid, including movement+turn+strafe+fire. Held weapon slot requests remain subject to Doom ownership/shareware/shared-slot rules. No model output is converted to arbitrary key codes.

The engine helper maps bits to supported `key_*` bindings in `g_game.c`, overwrites the entire keyboard array in exclusive mode, and reads it back. Validate/fix controlled-mode bindings at initialization: distinct, in-range defaults; disable autorun sentinel settings (`key_speed >= NUMKEYS` or `joybspeed >= MAX_JOY_BUTTONS` in `G_BuildTiccmd:310–311`), low-res demo turning, and other input devices. Do not reset `turnheld` between accepted live steps; only at invalidation. Every accepted call replaces the whole set, so unrequested keys cannot persist. The builder retains Doom's normal keyboard behavior.

### Bounded phase operation

`advancePhase` is necessary to get out of an ineligible state without allowing gameplay controls to navigate menus or continue intermission. Its uint32 operation is a small enum: `NONE`, menu taps `ESCAPE/UP/DOWN/LEFT/RIGHT/ENTER/CONFIRM`, `CONTINUE_DOWN`, `CONTINUE_UP`, `RESPAWN`. Validate operation for the current phase; stale epoch rejects before event processing. Serialize these with gameplay requests in the same Worker.

- Menu taps are bounded down/up events processed through the existing responders, with no held UI state carried forward. At most two events per call; do not replay a whole keyboard into the 64-slot ring (`E/src/d_event.c:25–57`). Gate them to title/menu/paused management. `ESCAPE` may explicitly open a menu from playable state, but that call performs no world tick.
- `NONE` runs at most one non-playable phase tic: menu ticker/title page, dead world, intermission, or finale. It never runs a live player tic, including stock menu's initial-view exception. A fully playable state returns `READY` with zero tics.
- Intermission/finale continuation uses a phase-owned zeroed `ticcmd` with only `BT_USE` for that one `CONTINUE_DOWN` tic, or no buttons for `CONTINUE_UP`/`NONE`; report phase source and actual command. No phase held-input cache is needed. Caller sends a consumed up interval between downs. This uses stock continuation logic rather than skipping statistics/finale state by fiat.
- `RESPAWN` is allowed only for a dead local player: one dead world tic with a phase-owned neutral movement command plus `BT_USE`, through `P_DeathThink`. It reports playable=0, world=1, reborn/epoch change. A later call processes reload and stops before live simulation. `NONE` dead tics cannot carry an earlier live use/fire.
- P0 **suspends attract-demo gameplay**, rather than executing demo `P_PlayerThink`. Title/menu responders still allow new game. A pending demo-start action returns a suspended demo phase; a later menu new-game action replaces it. Demo timing/playback is outside this contract. No phase operation may accidentally consume a demo or a new live player's command.

Phase results use the same record with `PHASE_ADVANCED` (engine tics 0 or 1 as explicitly reported), `READY`, `TRANSITION`, or rejection/fault. An unsupported operation/phase pairing returns `BAD_PHASE_OPERATION` with zero tics; a reentrant/mixed-mode invocation is a contract fault before further simulation. Phase processing can load/reset counters but stops at a live-player barrier. At a load barrier engine/world/playable counts are all zero. No loop runs “until playable.” Doom's paused bit is not used for host waits; P0 can leave an externally restored pause suspended and require new-game/restart rather than adding a pause-toggle command.

### TypeScript calling semantics

```ts
type StepInput = {
  expectedControlEpoch: number;
  commandSequence: number;
  heldControls: number;
};

// Wrapper methods are synchronous INSIDE the single engine Worker.
// Main-thread message delivery is asynchronous and includes runId.
let state = doom.snapshot();
if (state.neutralRequired) {
  const neutral = doom.step({ expectedControlEpoch: state.controlEpoch,
    commandSequence: nextSequence(), heldControls: 0 });
  if (neutral.status !== "APPLIED") return handlePhaseOrFault(neutral);
  assert(neutral.playableTics === 1);
  state = neutral.after;
}
const result = doom.step({ expectedControlEpoch: state.controlEpoch,
  commandSequence: nextSequence(),
  heldControls: Control.Forward | Control.Fire });
if (result.status === "APPLIED" || result.status === "APPLIED_TRANSITION") {
  assert(result.consumed.sequence === result.request.sequence);
  doom.render();
}
// Any transition ends the action batch. Reobserve before another command.
// During an external wait, call no simulation/phase exports.
```

Sequence identifies **one tic request**, not a multi-tic action. To hold for N eligible tics, issue N fresh atomic requests, checking each acknowledgment and stopping at the first transition/rejection. Pausing means no step/phase invocation; the next step must still provide a complete mask. Neutral input while advancing is different from freezing simulation.

## 6. Rejected Alternatives and Tradeoffs

| Alternative | Benefit | Why rejected / retained detail |
| --- | --- | --- |
| `setControls(mask)` + `stepOneTic()` + `getSnapshot()` | Familiar, simple setters | Leaves mutable pending state, lifetime/epoch ambiguity, and a gap between submission and consumption. Could be made safe with generation tagging and strict serialization, but adds state without reducing engine changes. Read-only snapshots remain useful. |
| Drain all keyboard events and repair release loop | Small input-pump fix; useful for manual hosts | Does not handle responder interception, load resets, prebuilt commands, exact timing, or actual consumption. Atomic gameplay masks bypass events entirely. Manual key-up-loop cleanup can be deferred because P0 menu taps are tightly bounded. |
| Atomic step with direct host-built `ticcmd` | Removes keyboard cache/command conversion | Would give TS a second movement/turn/weapon encoder and skip builder turn acceleration, key-speed/slot mapping, and builder history. It still needs lifecycle barriers and an actual consumer acknowledgment. Player `usedown` semantics would survive only with correctly consumed release tics; injection does not inherently skip them. It would skip menus intentionally, but supplies no menu/start policy. |
| Engine builds from a mask, immediately installs command | Retains native builder and eliminates backlog | **Chosen.** Bypass key-event delivery and scheduler buffering, not `G_BuildTiccmd` or player rules. Require exclusive input and a small engine helper because `gamekeydown` is private. |
| Existing `singletics` alone | Existing one-build seam; `NetUpdate` suppression | Still clock queries/waits/backlog, lifecycle-after-build ordering, and display wipes. Use its lessons, not its timedemo promise as an API contract. |
| One queue with future tic commands and cancellation | Could amortize host calls | Unnecessary for one synchronous owner; makes transitions and validity harder. No queue in P0. |
| Run a hidden neutral tic immediately after load | Could prime view/use flags | Violates zero-tic transition reporting and hides a first player command. Require an explicit accepted neutral request instead. |

The chosen path changes when input is built only in controlled mode, after lifecycle preparation; legacy game behavior stays on the original path. The cost is an intentional split in `G_Ticker` preparation versus command installation/simulation. That split is the minimum unavoidable engine change for an honest boundary.

## 7. Exact Stepping and Timing

### Why `singletics` is insufficient

`TryRunTics` samples `I_GetTime` before its single-tic branch. It builds a command, then computes availability/counts and can enter a time-polled wait (`636–705`); existing backlog can expand counts. The no-multiplayer configuration actually sets `new_sync=0`, `ticdup=1` (`d_loop.c:404–414`), so do not assume new-sync's availability calculation is the only path. It increments `gametic` around `RunTic`, even if the world ticker is paused or in intermission. `NetUpdate` returns for singletics (`201–202`), but that does not move lifecycle work ahead of build. `D_Display` still runs its synchronous melt (`278–295`).

Use a dedicated bounded single-player controlled entry in `d_loop.c`, leaving `TryRunTics` for legacy operation. Set controlled mode before init; make `NetUpdate` an explicit no-op in this mode, covering renderer calls as well. Do not rely on `singletics` remaining true when demo routines alter flags. No scheduler clock query, lowtic polling, command-ring read, `TicdupSquash`, or catch-up loop belongs in a controlled step.

### Required ordering (proposed pseudocode)

```text
step(e, s, mask):
  guard initialized/exclusive/not reentrant; validate mask/sequence
  spend valid fresh sequence; reject stale epoch BEFORE any engine work
  capture before-state; reconcile eligibility edge
  prepare pending demo/lifecycle/rebirth work, with action-dispatch budget
  if preparation changed identity/phase: reset future input; return TRANSITION
  if not eligible: return INELIGIBLE
  if load neutral required and mask != 0: return NEUTRAL_REQUIRED
  provisionally admit request in current epoch
  overwrite engine controls; assert effective mask == mask
  build once with G_BuildTiccmd(..., gametic); save field values + tag
  install current command through controlled G_Ticker continuation
  recheck full eligibility/epoch/tag immediately before simulation
  if a lifecycle action appeared after build:
    invalidate build; bounded preparation only; return TRANSITION with zero tics
  P_Ticker -> P_PlayerThink entry: verify keys/tag/command, commit/record consumption
  finish this ONE world tick; increment gametic once
  verify counts/deltas; finish deferred transition invalidation
  return APPLIED or APPLIED_TRANSITION
```

Split/reuse `G_Ticker`'s action preparation (`738–778`) and continuation rather than processing actions twice on the normal path. The controlled `RunTic` seam must report whether a tic actually ran so `d_loop.c` does not increment `gametic` for a preparation-only load. Use a private callback/helper extension as needed; do not force a void legacy `RunTic` result into successful acknowledgment. Revalidate after any preparation that can replace the player. The final guard includes `gameaction == ga_nothing`, player identity/state, menu/pause/demo flags, not just epoch: a deferred load request can exist before its load hook increments the epoch. A newly pending action after build invokes preparation only, spending the same per-operation dispatch budget, and stops before simulation. No import callback or event pump occurs between build and entry in normal controlled execution.

Each public operation processes at most eight pending action dispatches (including chained `ga_completed -> ga_victory`, for example). If more remain, return a poisoned `FAULT`; do not spin until an arbitrary WAD becomes playable. Ordinary map setup remains synchronous and can itself hang/trap; watchdog containment bounds host exposure, not C instruction count. Suspended demos are excluded from this dispatch budget. Normal supported assets/action chains must prove they fit the budget in the POC.

`advancePhase` runs bounded responder/menu work and lifecycle preparation, then at most one permitted non-playable ticker. It has the same stop-before-live rule. The initial controller-owned title setup (`D_DoAdvanceDemo` for the first title page) may occur in controlled initialization, but does not run a player/world tic. Disable the two implicit init simulation calls in `D_DoomLoop` only for controlled mode; initialize graphics/view normally and publish snapshot. Initialization never claims an accepted gameplay command.

### Virtual time and render separation

35 tics/s is simulation time (`E/include/i_timer.h:22`), not a real-time requirement. In controlled mode `I_GetTime` returns a controller-owned integer virtual engine-tic count; `I_GetTimeMS`/`DG_GetTicksMs` derive `floor(1000 * virtualTics / 35)` using wide arithmetic. Initialize/reset the timer baseline explicitly rather than depending on the legacy zero-basetime sentinel. Increment virtual time exactly once per reported engine tic, including non-playable phase tics, never on queries, rejection, rendering, network waits, or map setup without a ticker. Enforce this in timer/adapter seams; leave legacy timing unchanged.

`renderControlledFrame` draws current completed state once, calls the existing draw import, suppresses `NetUpdate`, and bypasses **both wipe preparation and the melt loop** in controlled mode. Maintain destination display state/background redraw bookkeeping. It performs no input scan, builder, phase advance, or world/player ticker. Assert these counts/tic identities unchanged across render. Renderer bookkeeping/palette/frame contents can change; render is not promised to be bitwise pure. Avoid accepting draw callback counts as simulation proof. No sound/music work is necessary for this POC.

With no polling loops entered, virtual time can remain constant while synchronous code reads it. A wall-clock frozen inside the unmodified scheduler/wipe would deadlock; an increment-on-read clock would change simulation with query count. Both are rejected. The host can wait 2s or 10s between requests without catch-up because neither elapsed host time nor a pending ring determines the next command.

## 8. Prospective Source Changes

**No patches in this task.** These are future minimum responsibilities, all restricted to controlled-mode input/timing/lifecycle plumbing. Existing C structs remain private.

| Repository-relative file(s) | Symbols / proposed responsibility |
| --- | --- |
| `references/doom.wasm/src/doom_wasm.c`, `src/doom_wasm.h` | Controlled initializer/export wrappers; mask/sequence validation; resettable adapter caches; immutable mode and reentrancy guard; stable word-record ABI and C-owned acknowledgment storage; virtual `DG_GetTicksMs`; gate legacy keys/tick in controlled mode. |
| `references/doom.wasm/doomgeneric/src/g_game.c`, `doomgeneric/include/g_game.h` | Private key overwrite/readback helper; clear builder contributors; split `G_Ticker` prepare/continue for controlled dispatch; one native build and tagged installation; load/death-rebirth/exit generation coordination; `G_DoLoadLevel`, `G_DoLoadGame`, `G_DoReborn`, exits/newgame/worlddone barriers. Own normal builder history. |
| `references/doom.wasm/doomgeneric/src/d_loop.c`, `doomgeneric/include/d_loop.h` | Bounded exact controlled operation, engine-tic accounting, command-ring clear/index alignment, explicit controlled `NetUpdate` no-op, forbid scheduler-mode mixing. One active command tag, not per-ring-entry metadata or a new queue. |
| `references/doom.wasm/doomgeneric/src/d_net.c` | `RunTic`/loop callback wiring: separate controlled preparation/demo handling and propagate zero/one-tic outcome. Keep legacy callback behavior; allow a small private callback extension in `d_loop.h` rather than duplicating the entire dispatcher. |
| `references/doom.wasm/doomgeneric/src/p_tick.c` | `P_Ticker` controlled pre-simulation guard and world-ticker completion count. Phase mode explicitly prevents a live tick despite menu initial-view exception. |
| `references/doom.wasm/doomgeneric/src/p_user.c` | `P_PlayerThink` entry assertion/authoritative command copy; capture documented chainsaw adjustment before movement; trace use-release/edge behavior in test builds. No rewriting of movement/use/weapon rules. |
| `references/doom.wasm/doomgeneric/src/p_inter.c` | `P_KillMobj` local-death hook/latch at `PST_DEAD`, deferred reset if command is already consuming. Health getter is unnecessary. |
| `references/doom.wasm/doomgeneric/src/d_main.c`, `doomgeneric/doomgeneric.h` | Controlled init without implicit `TryRunTics`/`doomgeneric_Tick`; bounded title/menu processing ownership; render-only entry; controlled wipe bypass and correct redraw bookkeeping. |
| `references/doom.wasm/doomgeneric/src/i_input.c`, `doomgeneric/include/i_video.h` | Minimal reset helper for translation/shift state, declared through the existing video/input platform interface (there is no current `i_input.h`); controlled mode excludes legacy gameplay key pump. Removing key-up break for manual hosts is optional later, not the core proof. |
| `references/doom.wasm/doomgeneric/src/i_timer.c`, `doomgeneric/include/i_timer.h` | Integer virtual-time branch and explicit baseline setup; legacy host timing preserved. |
| `references/doom.wasm/src/wat/merge-two-initialization-functions-into-one.wat` | Add `initControlledGame` wrapper that calls WASI initialization before controlled C initialization; prohibit both initializers in one instance. No WAT control constants required: mask values are public schema constants. |
| `references/doom.wasm/src/reachability_graph_for_wasm-metadce.json`, `Makefile`, `doom.wasm.interface.txt` | Preserve new exports in allowlist; include engine headers for adapter compile (`Makefile:240–245` currently lacks `doomgeneric/include`); verify merge ordering and regenerate final interface description. No dependency upgrade. Licensed embedded-asset replacement, if selected, is a separately explicit build requirement. |
| Future root TS Worker wrapper and small browser test harness (paths to be agreed) | No TS app/package exists today. Own run identity, sequence issuance, ABI decoding, synchronous serialization, phase script, frame copying, main-thread heartbeat/watchdog, and log assertions. Do not pretend these are existing files. Test-only lifecycle fixtures/hooks remain out of the production allowlist. |

`r_main.c`, `wi_stuff.c`, `f_finale.c`, `p_setup.c`, and `p_mobj.c` provide traced behavior but need no mandatory changes: central `NetUpdate` suppression covers the renderer; phase commands use existing intermission/finale tickers; load hooks plus entry identity checks cover player replacement. Revisit only if executable proof finds an uncovered transition. Avoid new shared global callback machinery when a private helper/callback extension suffices.

## 9. Runtime Proof-of-Concept Test Plan

### Bounded execution plan after authorization

One compiled-WASM harness in a browser Worker, one fixed build/hash, one provenance-verified compatible IWAD plus at most one tiny licensed fixture PWAD, fixed skill/maps. No Decisions/API client or public UI. Cap each case at 2,000 engine tics, each WASM operation at a main-thread watchdog deadline of 2s, and the post-build suite at 5 minutes. A limit exceeded is failure with the last authoritative record, not an infinite retry. Build time is separately bounded/recorded after checking tool availability; no build-time estimate is runtime evidence.

After authorized implementation: inspect final WASM exports/imports, verify only approved production exports remain, load assets before synchronous init, run cases below, and save machine-readable traces plus a brief acceptance report. Use test-only fixtures for lethal damage, same-map reload, and exit requests to avoid relying on AI skill or long play. They must call normal engine paths (`P_DamageMobj/P_KillMobj`, pending load, `G_ExitLevel`), not manually bump counters. Hook triggers at named boundaries: before preparation, after build/before player entry, inside player/world simulation. Production ABI excludes these hooks. A fixture that forces a transition after build is specifically needed to test the last generation guard, even though ordinary controlled ordering excludes that race.

### Instrumentation before build and at consumption

In an assertion-enabled compiled WASM, record these stages: request validation; prebuild effective input; postbuild command/tag; post-lifecycle invalidation; player-entry command/tag/effective mask; initial-rule command adjustment; world-ticker completion; operation return. Store a small bounded per-operation trace in C and retrieve it **after** return; no reentrant JS callback at mutable simulation boundaries. Saturation is test failure. The production acknowledgment remains a fixed single-operation record.

Every trace joins `(runId, expectedEpoch, epochAtStage, epochAfter, requestedSequence, consumedSequence, requestedMask, effectiveMask, gameticBefore/after, leveltimeBefore/after, engine/world/playable counts, phase/flags, mission/episode/map, player index/state, build and entry command fields, invalidation reason/count)`. Include `usedown` before/after and test-only use-attempt counters for the use case; include RNG/game-state digest in the replay case. These are diagnostic test values, not a new production observation API.

Assert before build and at player entry; never rely solely on a post-call key mask. Verify fresh tags and all named command fields through actual installation. Expected-command checks for pinned default controls include neutral movement/buttons, normal forward=25, backward=-25, run forward=50, normal strafe magnitude=24, slow-turn magnitude=320 for the first five held turn tics, then normal=640 (run=1280), and `BT_ATTACK/BT_USE`. Verify values/signs from `g_game.c:149–151,315–347` at implementation time. Chainsaw override is separately tested/flagged, not treated as stale host input. Test counts come from actual thinker/ticker hooks; exported call count is insufficient.

| Case | Compiled-WASM procedure | Required evidence / pass criterion |
| --- | --- | --- |
| 1. Compound release | Consume forward+fire, then mask 0. | Both keys false before the next build and at entry; fresh neutral command delivered; one engine/world/playable tic. Residual momentum is allowed. |
| 2. Compound replacement | Consume forward+fire, then backward. | Forward/fire false and backward true at both boundaries; forwardmove=-25 and no attack; no intervening partial command. |
| 3. Menu/start ghost | Hold gameplay request, open menu, submit it while ineligible, navigate new game, and hold menu arrow on legacy cache in a test fixture. | No playable entry in phase/menu/load calls; epoch invalidated, caches/event/keys reset; old request rejected. First new-map playable request is an acknowledged neutral tic; later fresh forward works. Also test menu dismissal without load. |
| 4. Death/rebirth/restart | Damage inside a live step, including while use is held; submit old request; explicit dead neutral then respawn phase operation, process load; fresh instance restart. | Killing tic returns `APPLIED_TRANSITION` with old consumed identity and new epoch. Old request cannot drive dead/reborn/new player; dead use belongs only to explicit PHASE command. New run rejects old Worker messages; first live tic neutral. |
| 5. Same-map reload | Defer reload before preparation with a pending gameplay request; also inject transition after build. | Map ID identical but epoch changes. Pre-entry interrupted operation has zero gameplay/engine/world ticks and absent consumed tag; built command invalidated if present. Old epoch fails; next live tic neutral. |
| 6. Exit/intermission/next map | Exit inside a step, then phase tick/continue down-up pulses, next-map load. | Exit-triggering step consumes once in old epoch; no old fire/use progresses intermission. No phase operation ticks new live player; new-map load barrier and neutral-required visible. |
| 7. Intra-call transition | Menu event selects new game; after-build test hook reloads; live world hook causes exit or death. | First two yield zero playable ticks with explicit transition and invalidation; last yields exactly one playable tic plus transition. `accepted`, `consumedValid`, identity and counts agree, never an ambiguous `APPLIED` with zero. |
| 8. Use edges | After initial neutral, consume use, neutral release, use again; choose a repeatable use fixture and instrument `P_UseLines`. | Release command actually reaches live player and clears `usedown`; next press attempts use once. Consecutive held-use tics produce no extra attempt. No physical door outcome assumed. |
| 9. Wait independence | Two fresh runs, same init/menu/render schedule and scripted masks; insert 2s vs 10s waits at one equivalent boundary with no step/phase calls. | Snapshot/gameplay digest unchanged during waits; next request always one tic. Compare all normalized authoritative traces (omit runId/wall timestamps), commands/RNG/world state per step; no catch-up. Keep render schedule equal because display bookkeeping may affect non-gameplay state. |
| 10. Worker containment | Main heartbeat every 50ms while cases run. In a dedicated instance trigger a controlled hang, then trap. | Normal steps leave heartbeat running (no attributable gap >250ms). Main watchdog terminates hang at 2s, flags error within the next 250ms, ignores late results, and can create a new run. Trap handled as fault/disposal; no fake consumption acknowledgment. Never rely on a timer inside the blocked Worker. |
| 11. Rejection/render discipline | Unknown bits/conflicts, duplicate/out-of-order sequence, stale epoch, mask!=0 after load; render repeatedly with clock fixed. | All specified rejections execute zero tics/builds/entries and no input mutation; correct high-water policy. Render changes no input, command provenance, epoch, game/world/playable counters, or virtual time; builds remain zero despite renderer NetUpdate call sites. |
| 12. Native semantics | Hold turn for seven tics, neutral, turn again; request an unavailable weapon slot; chainsaw-lunge fixture. | Builder acceleration/reset matches expected history; unavailable weapon request still has correctly built/consumed BT_CHANGE without promising switch; entry command and documented chainsaw override are distinguished. |

**Suite failure:** any successful zero/multi-tic operation, pre-entry identity mismatch reaching `P_PlayerThink`, stale phase/gameplay command reaching a new player, hidden new-map tic, release mismatch, unexplained command mutation, wait-dependent authoritative trace, blocked UI, or missing transition result. Expected ineligible/transition zero counts are successes only when status, phase, consumption validity, and hooks all corroborate them. A world tic with dead player is explicitly non-playable; `leveltime` alone cannot classify it.

### Toolchain and asset prerequisites

Read-only checks today found Python 3, Docker CLI, Make, curl, Git, and clang on PATH. Docker daemon access, SDK image availability, versions, architecture support, and browser automation dependencies were **not exercised**. `wasm-opt`, `wasm-merge`, and `wasm-metadce` were not found on PATH; the upstream build actually uses local `.binaryen/bin/wasm-as`, `wasm-merge`, and `wasm-metadce`. `.binaryen`, `.dev_virtualenvs/python_virtualenv`, `.dev_virtualenvs/rust_virtualenv`, `build/`, and browser `assets/doom.wasm` are absent. Compared with the investigation, **no new compiled artifact or ready local build environment was observed**; it did not establish prior PATH versions, so no package-version change can be inferred.

Future build needs upstream's Python environment, Docker WASI SDK 24, Binaryen 119 and CMake/native compiler/Make for its local build; Git SSH access is currently assumed by the Binaryen clone recipe (`Makefile:128–142`). Rust is used by the interface-description utility, not by the C gameplay contract. Confirm architecture support and any minimal alternative tool setup before installing; record tool/image/assets hashes. The existing command is `make -C references/doom.wasm all`; it has download/install/build side effects and was **not run**. Final module needs export inspection after WAT merging/dead-code elimination, not just a successful C compile.

The engine/glue are GPL-covered; preserve notices and matching source/build materials when distributing a modified WASM. Game data rights are separate from engine rights, as explained by [Freedoom's official overview](https://freedoom.github.io/about.html). Select and hash a compatible Freedoom release with its [license/credits](https://github.com/freedoom/freedoom/blob/master/COPYING.adoc), or permitted local assets, plus a licensed test fixture. Do not assume modern Freedoom map compatibility until exercised in this port. The checked-in Freedoom WAD's release provenance remains unresolved. The default build downloads and embeds shareware `DOOM1.WAD` (`Makefile:174,258–269`); passing a replacement at runtime does not remove embedded bytes. Approve removing/replacing that fallback for a distributable Freedoom-only POC, or establish exact permission for the embedded shareware package. No public asset redistribution is authorized by this design task.

## 10. Risks, Open Questions, and Decision Request

**P0 scope:** exact controlled stepping; full input overwrite and readback; lifecycle invalidation including same-map and intra-call transitions; native command build and actual consumer acknowledgment; minimal phase/player-validity info; explicit neutral-first tic; nonblocking render path; executable Worker harness and adversarial fixtures. Player state/death hook and map/epoch are indispensable because GS_LEVEL/leveltime cannot distinguish live control, death, and same-map replacement. Health/ammo/position are not indispensable to this contract.

**Later authoritative observation:** health, armor, ammo, weapons, position/orientation, objectives/metrics/enemy state, richer terminal reasons, observation/frame SDK. Diagnostic fixture/digest data need not become public exports.

**Later product:** Decisions calls, screenshot encoding/transport, server proxy, public UI, smooth scheduling, audio/music, deployment, polished recovery, and graceful engine shutdown. P0 uses Worker disposal for traps/hangs; the known `I_Error` infinite loop and quit limitations (`E/src/i_system.c`, `A/src/internal__wasi-snapshot-preview1.c`) are containment cases, not solved by this control proposal.

Hard gates for coding are architecture authorization and a chosen legal/compatible asset/build route. There is no demonstrated source-level impossibility, but the following remain execution hypotheses:

- `G_Ticker` preparation/continuation can be split locally without breaking initialization, HUD/display, or save-load ownership. If this needs wider simulation changes, stop and revise scope/verdict.
- Bypassing wipe setup as well as its loop while preserving redraw bookkeeping produces valid destination frames.
- Normal lifecycle chains fit eight dispatches and all creation/load paths pass the chosen epoch hooks. Save-game restore must be covered through action completion even if save/load is not exposed as a normal P0 host feature.
- Compiled artifacts preserve the exports/schema and do not enter another hidden polling path. Watchdog bounds containment; it cannot guarantee every C call completes in a fixed instruction count.
- Wait-independence is required within the same build/assets/script. It is not a promise of cross-build/platform bit-for-bit determinism. Fixture and RNG/gameplay digests are needed to detect divergence invisible to a small snapshot.

Approve these concrete choices before implementation: atomic mask step retaining `G_BuildTiccmd`; control epoch broader than load epoch; run-global sequence with spent rejected attempts; player-entry acknowledgment plus documented internal command override; separate phase/render calls; explicit neutral-first load tic; suspended attract-demo gameplay; immutable single-player controlled mode; and bounded Worker POC rather than production integration. A direct engine command-injection design remains a fallback if the keyboard helper proves invasive, but it requires a new control semantics review, not a silent substitution.

This task stops at this proposal. No C/WAT/TypeScript/build/test/dependency changes, build/install/run, commit, push, or runtime testing were done. Final repository verification should show only `?? docs/doom-control-contract-design.md`; the submodule must remain clean at the original gitlink.

### Implementation Authorization Checklist

- [ ] Approve the five-export controlled ABI, mask allowlist, word-record schema strategy, phase policy, and no legacy scheduler mixing.
- [ ] Approve run/epoch/sequence ownership, invalidation hooks, spent-attempt rules, and explicit neutral first playable tic after every load.
- [ ] Approve `APPLIED` versus `APPLIED_TRANSITION` versus zero-tic transition semantics and entry-command versus chainsaw-adjusted-command evidence.
- [ ] Choose verified compatible assets and embedded-fallback provenance/removal; approve the bounded build/toolchain setup and future submodule/fork change workflow separately.
- [ ] Require one build/one entry/one world completion and `gametic +1`, `leveltime +1` for every successful playable step; zero playable entries for every rejection/pre-entry transition/phase barrier.
- [ ] Require all twelve compiled-WASM cases, both wait scripts, exact-boundary traces, final export inspection, and Worker watchdog/heartbeat criteria to pass before integrating Decisions.
- [ ] Explicitly authorize implementation only after architecture review; keep broader observation/product work deferred.
