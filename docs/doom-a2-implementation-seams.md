# Stage A2 native implementation seams

## 1. Baseline and scope

**Verdict: FEASIBLE from source; no A2 runtime success established.** The existing whole `G_DoNewGame` action loads and spawns without a ticker. A small shared extraction of `G_Ticker`'s continuation can deliver one native command without running its preparation loop. The first compiled experiment must establish that the admitted Freedoom E1M1 actually loads and completes that continuation.

Verified on 2026-10-09:

```text
pwd: /Users/mike/projects/doom-decisons
branch: main
HEAD: 99bedbe8fd3c4490e780d4996ccd304b4775d619
initial git status --short: (empty)
final git status --short:
?? docs/doom-a2-implementation-seams.md
```

The report did not exist before this investigation. There were no pre-existing tracked/untracked changes reported by Git. Ignored inputs already exist; existence/size checks did not read or hash their binary contents:

| Local input | Observed presence / size |
| --- | --- |
| `assets/freedoom-0.13.0/freedoom1.wad` | 28,795,076 bytes; ignored |
| `references/doom.wasm/build/a1-final-trace/doom.wasm` | 354,705 bytes; ignored |
| `references/doom.wasm/build/a1-final-no-fixtures/doom.wasm` | 354,393 bytes; ignored |
| `references/doom.wasm/build/a1-first-proof/doom.wasm` | 354,684 bytes |
| `assets/doom-shareware-20261009T173326Z-bffb50/DOOM1.WAD` | 4,196,020 bytes; unrelated baseline input |
| `tools/`, older shareware/repro build directories | Present; no tools executed |

All requested engine C paths and associated `g_game.h`, `d_loop.h`, `i_timer.h`, `d_ticcmd.h` exist, as do the adapter C/header, both controlled init WATs/root graphs, Makefile, build wrapper, inspector and Stage A harness. The four controlling documents exist. `git ls-files --stage references/doom.wasm` reports **234 ordinary mode-100644 files**, no gitlink; `.gitmodules` and `references/doom.wasm/.git` are absent. This is current root-vendored source. The provenance document records upstream pin `31cc1af9656a8184830090c4e9f268383f5d7e15`; its pending-import wording is historical (`docs/doom-vendor-provenance.md:3–13`). Current A1 modifications are part of HEAD, not an unchanged upstream tree.

Contracts: `docs/doom-stage-a-plan.md:214–224` requires genuine zero-tic load, native build/install/live-entry/world/outer evidence, neutral-first, preserved ticker cadence, refusals before building and paired wait isolation. `docs/doom-control-contract-design.md:68–92,130–141,242–246,259–282` supplies readiness, full field identity and separation of preparation from consumption. Its production masks/epochs/high-water machinery is outside A2. The plan's proposed general shared dispatcher (`145–155`) is broader than needed here: use only the existing whole newgame action in A2.

The owner's supplied context says A1 was accepted and Issue #3 closed on 2026-10-09. Local `docs/doom-a1-results.md:3–5,180–228,250–256` and `docs/doom-stage-a-plan.md:198–202` still say acceptance is pending. They do record final traced and fixture-disabled title smokes. Closure was **not independently verified** offline; preserve those documents and use the supplied acceptance context for this investigation. Neither record proves a playable map. No Issue #4 body was found locally: filename searches including ignored evidence found only `build/a1-final-trace/evidence/issue3-at-verification.json`. This prompt governs scope pending owner reconciliation with Issue #4.

Only this report was written. No implementation, tests, builds, binary inspection/execution, browser, network, installation, Git mutation, issue edit or Decisions integration occurred. **OF** below denotes observed source fact, **PR** proposed refactoring, **RH** unverified compiled-runtime hypothesis. Citation shorthand: **A/** = `references/doom.wasm/`; **E/** = `references/doom.wasm/doomgeneric/`. All cited line ranges are from this checkout.

## 2. Current native call graph

### Startup and whole E1M1 preparation

```text
CURRENT A1:
initControlled WAT -> WASI _initialize -> _initializeControlled
  -> admit external IWAD -> doomgeneric_Create -> D_DoomMain
  -> ordinary subsystem/network-settings initialization -> D_StartTitle
  -> controlled D_DoomLoop graphics setup -> D_DoAdvanceDemo(title only)
  -> initialized TITLE, no native builder/world/outer tic

ORDINARY NEWGAME:
M_ChooseSkill -> G_DeferedInitNew -> ga_newgame
  -> G_Ticker: rebirth scan -> action while/switch -> G_DoNewGame
  -> G_InitNew -> G_DoLoadLevel -> P_SetupLevel -> P_LoadThings
  -> P_SpawnMapThing -> P_SpawnPlayer -> G_PlayerReborn + P_SpawnMobj
  -> psprites/ST/HU setup -> specials/precache -> whole newgame returns
  -> G_Ticker CONTINUES: install commands -> P_Ticker -> ST/AM/HU
```

**OF:** The one-shot WAT guard precedes WASI/C startup (`A/src/wat/controlled-title-init.wat:3–15`; disabled variant `3–11`). `_initializeControlled` admits one structurally bounded external IWAD, then creates the engine and stores title readiness; `renderControlled` calls only `D_Display`, under a busy guard (`A/src/doom_wasm.c:45–125`). That `controlled_ready` means initialized title/renderability, **not gameplay READY**.

`doomgeneric_Create` allocates the screen and invokes `D_DoomMain` (`E/src/doomgeneric.c:12–24`). Startup initializes zone memory, configuration, WAD/version/hash resources, platform timer, menu, renderer, playloop, sound, loop callbacks/player settings and HUD/status (`E/src/d_main.c:1036–1037,1179–1221,1345,1419–1438,1556–1577`). With no arguments it queues title rather than autostart (`1618–1632`). Controlled `D_DoomLoop` excludes both implicit scheduler calls and explicitly prepares the initial title (`391–429`). `D_DoAdvanceDemo` sets the local player's state LIVE but creates **no actor**, clears `advancedemo`/action, sets `usergame=false` and enters TITLEPIC (`464–497`); `D_A1TitleReady` checks title identity (`542–545`). State/action globals live in `E/src/g_game.c:90–144`; menu initializes inactive (`E/src/m_menu.c:1617–1627`). Do not infer playability from title's LIVE flag.

**OF:** Menu skill selection queues `ga_newgame` then clears menus (`E/src/m_menu.c:717–725`). The pending request stores skill/episode/map (`E/src/g_game.c:1449–1454`); `G_Ticker` dispatches it before command installation (`735–790`). `G_DoNewGame` establishes ordinary single-player settings, calls `G_InitNew` and clears the action only after that whole call (`1456–1468`). `G_InitNew` resets both RNG streams, requests player rebirth, assigns normal game settings/sky, and calls `G_DoLoadLevel` (`1535–1567,1581–1611`). `G_DoLoadLevel` sets level state/start tic, performs `P_SetupLevel`, clears action and native device/key/pause state (`524–585`). No function in this chain calls `G_BuildTiccmd`, `P_PlayerThink`, `P_Ticker` or increments `gametic`.

`P_SetupLevel` resets level counts/time, stops sounds, frees prior level allocation, initializes thinkers, loads ordered map lumps, spawns things/specials and precaches graphics (`E/src/p_setup.c:665–747`). Player-start handling calls `P_SpawnPlayer` (`E/src/p_mobj.c:636–667`); rebirth initializes health/ammo/interaction flags, and spawning attaches a live actor in the real world, initializes weapons, ST and HU (`569–628`; `E/src/g_game.c:928–959`). Spawn itself consumes `P_Random` (`E/src/p_mobj.c:426–447,715`): **zero tics does not mean zero preparation RNG/state changes**. Psprite setup calls ordinary state actions, including weapon raise, during initialization; this is setup rather than a world tic (`E/src/p_pspr.c:46–81,112–126,324–338,634–644`).

**PR:** A narrow native prepare operation, admitted only once from initialized title with no pending work, calls `G_DeferedInitNew(sk_medium,1,1)` and a checked helper that invokes the existing `G_DoNewGame` for that specific action. Return after the **whole** action; do not call `G_Ticker` or expose READY from inside `P_SetupLevel`. No generic action switch or duplicated load implementation is necessary. The legacy `ga_newgame` case continues to call the same action function.

### Command, world body and outer ownership

```text
CURRENT SCHEDULER (exclude from A2):
TryRunTics -> NetUpdate / BuildNewTic
  -> I_StartTic -> ProcessEvents -> M_Ticker -> G_BuildTiccmd(maketic)
  -> ticdata ring write / maketic++ -> RunTic -> netcmds = ring commands
  -> demo advance -> G_Ticker preparation + continuation
  -> gametic++ -> TicdupSquash -> NetUpdate (possibly more builds)

PROPOSED CONTROLLED STEP:
preflight -> M_Ticker -> native neutral input -> G_BuildTiccmd(B, gametic)
  -> save B + initial live actor -> final guard
  -> scoped netcmds -> SHARED G_Ticker continuation (no preparation)
  -> players[local].cmd copy -> live P_PlayerThink entry check
  -> player body -> thinkers -> specials/respawns -> leveltime++
  -> ST_Ticker -> AM_Ticker -> HU_Ticker
  -> verify body/continuation -> gametic++ + virtual tick++ -> publish
```

**OF:** `BuildNewTic` pumps/responds before menu/build, installs into the scheduler ring and increments `maketic` (`E/src/d_loop.c:133–184`). `NetUpdate` can build multiple commands; A1 intercepts it before time/history mutation (`194–240`). `TryRunTics` polls elapsed/available tics, can wait or loop, runs `RunTic`, then owns `gametic++`/outer counter and squashes commands (`643–746`). `singletics` still enters this machinery. `RunTic` handles quits, borrows `netcmds`, may advance demo, then calls the full `G_Ticker` (`E/src/d_net.c:68–92`). Single-player startup sets `ticdup=1`; normal settings establish player 0 and register callbacks (`E/src/d_loop.c:411–421`; `E/src/d_net.c:97–119,220–231`).

**OF:** The native builder clears the entire output, samples `consistancy[consoleplayer][maketic % BACKUPTICS]`, keys/config/device values and consumes chat, weapon cycle, mouse deltas and pause/save sends (`E/src/g_game.c:292–518`). Persistent state includes `turnheld`, double-click timers/states/counts and function-local low-resolution carry (`160–204,319–328,424–460,503–517`). `ticdup=1` gives turn magnitude 320 for held tics 1–5, 640 from tic 6 at normal speed; normal forward is 25 (`150–152,319–359`). Chat dequeuing advances a native queue only when nonempty (`E/src/hu_stuff.c:307–332`). Neutral builds still advance double-click history when configured; that history belongs only to accepted gameplay calls.

**OF:** Installation is the copy from `netcmds[i]` to `players[i].cmd`, followed by potential demo replacement/recording, turbo/consistency processing and specials (`E/src/g_game.c:782–857`). Only then does engine state housekeeping precede `P_Ticker`, ST, AM and HU (`859–887`). `P_Ticker` can return for pause/menu; its completed body calls player thinking, all thinkers, specials and respawn processing, then increments `leveltime` and the existing world-complete counter (`E/src/p_tick.c:96–120`). `P_PlayerThink`'s current entry counter occurs **before** actor flag edits, chainsaw command rewriting and the dead-player branch (`E/src/p_user.c:191–215`). Place command/actor verification at that entry, before line 197. Native use handling clears `usedown` on neutral consumption (`263–270`); do not clear it during preparation/input submission. Weapon `attackdown` clears in the appropriate ready-weapon action, not necessarily the first raising tic (`E/src/p_pspr.c:245–252,324–338`).

## 3. Feasibility and hazards

**READY (PR, supported by the native load path):** initialization succeeded; whole newgame/load returned; verified noncommercial E1M1 at fixed medium skill; actual map/thinker resources exist; exactly local player 0 participates; its `PST_LIVE` actor has positive health, valid subsector/sector, thinker membership and matching `mo->player`; `usergame && GS_LEVEL`; no menu, pause, `advancedemo`, action, demo, netgame/deathmatch/drone or unfinished preparation; `ticdup==1`; native contributors are neutral. Record a private completed-load marker independent of trace counters. At first READY, builder/player/world/outer counts and `gametic/leveltime/virtualTicks` must all be zero. Snapshot native conditions; never manufacture them with direct map/state assignments.

Map setup initially writes `viewz=1`, but first rebirth subsequently zeroes the player struct (`E/src/p_setup.c:676–678`; `E/src/g_game.c:941–950`). Therefore do not require a finished camera or a particular `viewz` sentinel at READY. Stock menu gating depends on that sentinel; controlled readiness must reject **every** menu-active attempt before `M_Ticker`/input/build (`E/src/p_tick.c:103–107`).

The scheduler ring, consistency storage and builder statics start zero in a fresh reactor. Ordinary load clears keys/devices/sends but does **not** clear all turn/double-click/carry/chat history (`E/src/g_game.c:573–580`). A2.1's fresh instance, single load, no event pump and no prior builder make zero history defensible. Assert it; do not promise general same-instance reset/reload. Keep dormant `maketic`, ring and received-tic state unused; pass current `gametic` as builder index, retaining native consistency rules in the shared continuation.

Full `G_Ticker` is unsafe as the step seam: its rebirth scan can queue reload, and its action loop can load a new actor and then tick it in the same call (`E/src/g_game.c:740–780,1093–1098`). Specials can pause or queue save (`832–857`). An in-world exit sets `ga_completed` without immediately loading (`1152–1164`); finish that already accepted old-world body/outer tic, leave the action pending and refuse the next step. A2 must not dispatch it or resume dead/intermission play. Existing engine `oldgamestate` housekeeping differs from the function-local display `oldgamestate` (`g_game.c:90,859–865`; `d_main.c:158,261`). In the title-only-to-first-level slice there is no prior intermission resource owner; no new general cleanup dispatcher is required.

Rendering already disables wipes and intercepts `NetUpdate`, but at `gametic==0` it skips level/status/HUD/view drawing (`E/src/d_main.c:180–230,274–280`). After the first tic, `R_RenderPlayerView` adds **four** intercepted network calls plus the display call (`E/src/r_main.c:713–739`). Keep the central intercept; do not expect A1's single-intercept count for level renders. Rendering updates caches/frame counters (`r_main.c:706–707`); authoritative digest equality must exclude presentation caches, not require byte-identical linear memory.

Current controlled time is literally constant zero (`E/src/i_timer.c:34–78`; `A/src/doom_wasm.c:290–295`), not an existing advancing virtual clock. Timer consumers found are scheduler time/polling (`d_loop.c:118–130,288,655–713`), display wipes (`d_main.c:286–292`), menu mouse/joystick debounce (`m_menu.c:1107–1167`) and demo timing (`g_game.c:1895,1937`). None is needed in the proposed closed ready-step path. Frozen time plus accidental scheduler/wipe entry can hang; count and exclude these paths rather than unfreezing the clock.

**RH / concrete remaining gate:** A1 admitted title/palette/structural WAD bounds, not usable E1M1 resources (`A/src/doom_wasm.c:60–97`). Freedoom's warning and disabled DeHackEd remain (`E/src/d_main.c:1223–1235,1408–1416`; `E/include/doomfeatures.h:24–32`). Missing/unsupported map data can fail or hang through `I_Error` (`E/src/i_system.c:252–293`). Source supports the seam but cannot certify this IWAD's world load, psprites or first body. Stop on that failure; do not add compatibility surgery or substitute assets silently.

## 4. Recommended minimum A2.1 slice

**PR — implement one preparation and one explicit neutral step after separate authorization.**

1. Retain one-shot A1 startup and busy/reentry guards. Distinguish initialized/renderable from native gameplay-ready. Add a narrow experimental prepare entry for this one title-to-E1M1 action; hold busy and preparation barriers through `G_DoNewGame` return, then validate real native readiness. No menu responder or priming tic.
2. Extract `G_Ticker`'s existing **782–887** command/special/housekeeping/ticker continuation into a private shared helper. Legacy `G_Ticker` retains its original rebirth/action loop, then calls that helper with the same ordering. A controlled entry validates READY and invokes only this continuation. No duplicated ticker or generic action dispatcher. A guarded `d_net.c` helper lends a native `MAXPLAYERS` command array for the synchronous call, then clears/restores `netcmds` before its storage expires; it bypasses original `RunTic` quit/demo work.
3. A dedicated `d_loop.c` exact caller owns the outer boundary: validate all refusal conditions first; capture T/L/actor/load identity; run `M_Ticker` once; apply/assert neutral native input in `g_game.c`; invoke stock `G_BuildTiccmd(&B,T)` once; save every field; recheck readiness/actor; install and run the shared continuation; verify one initial-live entry, one body completion and ST/AM/HU return; increment `gametic` once and commit virtual time once; publish actual deltas. No `TryRunTics`, `BuildNewTic`, ring read/write, `D_StartGameLoop`, `TicdupSquash`, display or event scan.
4. Put the integer virtual-tic owner in `i_timer.c`, independent of diagnostics. Before admission/build and throughout the ticker it reads V; after completed world + native continuation, the outer owner increments it to V+1 alongside `gametic`. `I_GetTime` returns V directly; `I_GetTicks`, `I_GetTimeMS` and `DG_GetTicksMs` use wide `floor(1000*V/35)` conversion. Avoid recursion and ms-to-tic round trips; the first commit reports 1 tic / 28 ms. No host-clock import, callback advancement or snapshot advancement. A fault/trap is partial execution to discard, never a successful/refused step or a retry opportunity.
5. Keep ordinary refusal (uninitialized/title/menu/pause/pending/dead/unsupported state, invalid input or non-neutral first step) before menu/history mutation. Post-build invariant failures are faults, not zero-work refusals. In this slice no mutable host call/event/action preparation is permitted between building and live entry. Keep guards and small completion checks active when trace is disabled; use diagnostic hooks only for richer evidence.

Likely native edits: `A/src/doom_wasm.{c,h}`; `E/src/g_game.c`, `d_net.c`, `d_loop.c`, `i_timer.c`, entry/completion hooks in `p_user.c`/`p_tick.c`; only required engine declarations and `E/include/a1_trace.h`. Keep `p_setup.c`, `p_mobj.c`, player movement, RNG, engine map data and legacy scheduler behavior unchanged. Reuse the controlled build branch and one-shot WAT. The private prepare/step/trace exports need explicit retention in both selected `A/src/reachability-controlled-title*.json` graphs and matching typed inspection; diagnostic exports remain absent in disabled mode. No production ABI is being chosen.

Tooling edits later: `scripts/inspect_doom.mjs:73–85,146–155` and `experiments/stage-a/harness.html` need A2-specific inventories/operations/assertions. `scripts/build_doom.py:244–285` already captures selected WAT/graphs and invokes exact final inspection; it may need A2 evidence labeling/selection, not a second build graph. `A/Makefile:216–229,379–419` already supplies no embedded WAD, init merges, metadce, constants and final copy. Do not run legacy build/bootstrap/example/hook targets or broaden the build architecture. The existing init WAT itself need not change for these direct C exports.

## 5. Proof and observability

**PR:** Extend existing private cumulative hooks (`E/include/a1_trace.h:4–29`; `A/src/doom_wasm.c:127–138`) with a small bounded native record per operation, read only after return. Keep trace optional; busy/readiness/time and correctness checks must not depend on diagnostic storage. Record actual counts without clamping. Trace capacity/counter exhaustion must set a sticky visible failure and prevent a pass; never overwrite old entries, drop mismatches or wrap silently.

Capture these independent boundaries:

| Boundary | Minimum evidence |
| --- | --- |
| Preparation end / pre-admission | State/action, map/skill/resources, load completed, player index/LIVE/actor/back-pointer, T/L/V; keys and builder history |
| Builder begin/end | Actual stock call count, T as index, complete output B, contributor/history before/after; operation-local identity |
| Installation | Native copy destination/local player, all command fields read back, same operation/T/load tag |
| `P_PlayerThink` entry | Saved initially-live actor equals actual actor/player; current LIVE; installed fields equal B before any flag/command edits; entry count |
| World body end | Hook after thinker/special/respawn body and `leveltime++`; actual delta, not `P_Ticker` entry count |
| Outer completion / publication | ST/AM/HU completed once, `gametic`/virtual increment once, final state/action, no load during step, actual 1/1/1/1 counts |

Field identity uses **all ten named fields** in `E/include/d_ticcmd.h:30–49`: forwardmove, sidemove, angleturn, chatchar, buttons, consistancy, buttons2, inventory, lookfly, arti. Preserve the full native copy internally; compare/serialize fields, not padding or `G_CmdChecksum`. Neutral movement/buttons/chat/other-game fields must be zero; consistency must match the native indexed value. Builder receipt, installation receipt, actor identity and actual live-entry consumption are four separate obligations. Verify at entry before `MF_JUSTATTACKED` or specials alter input. On a failed entry invariant, stop before player logic and fail the operation visibly; do not continue and publish success.

A bounded diagnostic game digest should serialize named state/action/map/skill/tic values; local player health, actor position/angle/momentum/state, ammo/weapons/psprites and interaction flags; sector floor/ceiling/light/special values; mobile thinker state in stable traversal order; and both RNG indices. Normalize pointers to local identity/list ordinals and state indices; omit allocator addresses, framebuffer/render caches, host timestamps and operation timing. State the digest's field coverage: it is an A2 comparison aid, not a complete save/replay checksum. Record builder history separately (turnheld/double clicks/carry/contributors/chat position) to prove observation/refusal/waits do not mutate it. Both RNG streams matter: `P_Random` advances `prndindex`, `M_Random` advances `rndindex` (`E/src/m_random.c:44–58`); `ST_Ticker` consumes `M_Random` each accepted level tic (`E/src/st_stuff.c:817–823`). Preparation's RNG reset/spawn advances are legitimate; snapshot/digest computation must consume neither stream.

**First owner Chrome experiment, new final A2 WASM:** fresh Worker + same admitted external Freedoom -> A1 init/title render -> one native E1M1 prepare -> readiness snapshot and render -> exactly one explicit neutral step -> snapshot and level render. Require preparation/render/snapshot zero builder/live/world/outer deltas and time zero; step exactly one native build/install/live entry/world/outer with T/L/V each 0→1 and full command identity; post-step observations add no simulation/history/time. Preserve title before prepare so READY-at-zero may display the retained frame; require a real level frame only after the explicit tic. No warmup.

Reuse local-file admission/hash checks, bounded WAD imports, memory view refresh/copy, frame hashing/Canvas output, serial Worker operations, read-only snapshots and main-thread watchdog (`experiments/stage-a/harness.html:35–70,135–222,328–383,567–600`). Existing snapshots only read counters, not an A2 state digest. Existing artifact pins and interface checks are A1-specific; produce fresh A2 manifests, typed final transformed export/import inspection, native trace, JSON receipt and post-step image. A1 evidence cannot certify the new module, level render, command consumption or nonzero clock. Source-only review establishes call ordering and proposed hooks; compiled-WASM inspection and owner Chrome execution establish retention and actual behavior. This pass performed neither.

## 6. A2.2 follow-on

Only after A2.1 passes, add a private native input choice **inside the accepted step**, before building: neutral, forward or one turn direction. Change only configured `gamekeydown[key_up/key_right]` state (or the equivalent narrow native binding), verify other contributors inactive, and preserve builder history across uninterrupted tics. Do not route through adapter key caches/event/menu responders (`A/src/doom_wasm.c:155–175,238–256`; `E/src/g_game.c:633–655,696–722`). Do not construct `ticcmd_t` in JS/TypeScript or reset turnheld on each step. Keep first post-load step neutral.

Run approximately 20 accepted steps covering neutral, forward=25, at least six consecutive turn steps (right −320 through fifth, −640 from sixth at normal speed/lowres off), release-to-neutral and forward/turn repeats. Render/snapshot at fixed boundaries including nonzero `gametic`; record independent native history equality across observations. Private menu/pause/pending-newgame/reload fixtures should cause zero builds/entries/bodies/outers/time on attempted steps and leave pending work undispatched. Use separate fresh cases for fixtures requiring state changes; do not add general resume handling.

Then run paired **fresh Chrome Workers** with identical artifact/IWAD, configuration, operation/input/render script and wait locations; use main-thread message-free waits of 2 seconds versus 10 seconds. Compare normalized command/installation/live-entry/completion/game/RNG/history traces at equal script boundaries, excluding host duration and presentation counters. After either wait the next requested step must advance exactly once, with no catch-up or extra history sampling. Retain the main-thread watchdog for synchronous WASM operations; idle duration is not the operation timeout. Stop the batch on death/pending action rather than preparing another level.

## 7. Open decisions / STOP conditions

1. **Approve the narrow preparation + shared continuation design first.** Use existing `G_DoNewGame` whole action, not a general dispatcher. If extracting the continuation changes legacy ordering or needs broad engine/player surgery, STOP for review; no second broad fallback is recommended.
2. **Reconcile zero-tic visual acceptance:** recommend READY proved by native loaded-world/actor evidence, allow retained title at `gametic=0`, and require the genuine level image after the explicit neutral tic. A zero-tic level view would need a separately reviewed presentation change, not a priming tic. Confirm Issue #4 agrees when its body is available.
3. **Approve end-of-completed-tic clock commitment:** builder/ticker observe V; callbacks/snapshots after return observe V+1. Refusals and observation cannot advance time/history. Keep diagnostic-overflow/invariant faults visibly distinct from ordinary zero-work refusal; no automatic retry of partial execution.
4. **Asset/first-body gate:** genuine E1M1 resources, live actor, world completion and level image remain unverified for these bytes. Missing lumps, unsupported things/patches, skipped entry/body, scheduler/wipe entry, multiple increments or wait dependence are STOP findings. Preserve concrete native traces/errors; do not fix maps, enable DeHackEd or broaden lifecycle handling to force a pass.
5. **Scope/wording reconciliation:** mark A2.1 as a precursor, not full A2 acceptance; retain A2.2 wait/input/refusal requirements. Do not require immediate `attackdown=false` while the weapon is still raising; require native `usedown` clearing and ordinary weapon progression. Treat A1 acceptance as owner-provided; stale pending-closeout docs and unavailable Issue #4 need owner review, not unauthorized edits/network lookup.

Read-only verification actually used: `pwd`; `git branch --show-current`; `git rev-parse HEAD`; `git status --short` / `--untracked-files=all`; `git log -4 --format=...`; `git ls-files --stage references/doom.wasm` (mode/count inspection); `git check-ignore` for selected inputs; `rg` / `rg --files` including ignored issue-name searches; `cat`, `nl -ba`, `sed`, `head`, `tail`, `awk` for text/range inspection; `python3 -B` standard-library path existence, directory inventory and `stat` byte sizes. No requested source path was missing; no local Issue #4 body was available. Binary contents and historical evidence receipts were not revalidated. Final `git diff --check` and status were checked after writing this report. No tests, compiler/syntax runs, Make (including dry runs), inspector execution, WAT assembly, WASM instantiation, browser, network or Git write ran.

**STOP: architectural review and explicit implementation/build authorization are required before any A2 code/tooling edits or experiments.**
