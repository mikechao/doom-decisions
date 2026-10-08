# doom.wasm Feasibility Investigation

## 1. Executive Summary and Verdict

**SUITABLE WITH SMALL EXTENSIONS**

The repository contains a clean, revision-pinned `jacobenget/doom.wasm` reference, but no root browser application or Decisions integration. The port is a useful foundation: JavaScript supplies assets, receives pixels, reports held keys, supplies the clock, and explicitly invokes execution. It does **not** intentionally expose player state, lifecycle state, exact simulation stepping, or reliable fatal/quit notification.

**Go** for a bounded prototype using this foundation; **do not treat the current public interface as sufficient for predictable autonomous gameplay.** The recommended architecture is a browser Worker owning one WASM instance, a spectator Canvas on the main thread, a small versioned C snapshot/control bridge, and a server-side Decisions proxy. Initially advance a short, exact action interval, freeze simulation during each request, and resume only with a validated response. This will visibly pause under network latency; smooth continuous play is a separate scheduling decision.

The minimum extension is more than health getters: add authoritative snapshots, intentional single-tic stepping, correct input release/reset handling, and bypass the blocking screen wipe in stepped mode. A Worker watchdog can contain existing fatal hangs; explicit fatal/quit callbacks should replace ambiguous logging and cleanup failures before public deployment. These are localized adapter/loop changes, not a replacement of Doom's simulation. Their runtime feasibility remains to be proved.

**Direct answer:** the host can already stop calling Doom, retain its last frame, await a remote decision, and call Doom again. It cannot claim that N current `tickGame()` calls equal N gameplay tics. The example's wall clock causes resume catch-up, while a clock frozen inside a call can deadlock its busy waits. Exact, drift-free action stepping across transitions needs the bounded extensions below. [S2–S6]

## 2. Investigation Provenance

| Item | Inspected value |
| --- | --- |
| Investigation date | 2026-10-08, America/Los_Angeles |
| Local project | `/Users/mike/projects/doom-decisons`, project identified as `mikechao/doom-decisons` |
| Root branch / HEAD | `main` / `ecdc4409613eeaea9f44adc1d84e53f7aec32d41` |
| Dependency mechanism | Git submodule, `references/doom.wasm` |
| Configured upstream | `https://github.com/jacobenget/doom.wasm.git` |
| Recorded gitlink and checked-out HEAD | Both `31cc1af9656a8184830090c4e9f268383f5d7e15` |
| Upstream commit | 2024-12-10, “Merge pull request #22 … Provide Details on Controlling Browser Example”; `v0.1.0-6-g31cc1af` description |
| Local modifications at start | Root and submodule status clean; no submodule tracked or untracked changes |
| Engine source provenance | `doomgeneric/` is an ordinary tracked tree within this upstream commit, tree ID `20a2f2cb40e7892af506897fe1efec7ecef71350`; not a nested gitlink. A separate original doomgeneric commit is not established. |
| Runtime artifact | No local `references/doom.wasm/build/` directory; no tracked build artifact. No binary inspected. |

Evidence labels used throughout:

- **Source verified (SV):** read the actual pinned C, headers, WAT, browser example, Makefiles, export allowlist, and interface description. This establishes behavior of the source, not successful execution of a compiled module.
- **Check verified (CV):** read-only Git/status/tree checks and a Python standard-library byte comparison established that local `src/doom_wasm.c` exactly matches its revision-pinned raw GitHub file. Adapter SHA-256: `8b3443893189282fc46b30ba28b2d61ca4b86dd8db7a013e38c50d63dd1c6872`.
- **Documented, not runtime verified (DOC):** current official Decisions guide/reference, general image guide, upstream README claims, and external asset licensing documentation. Documentation was fetched on this date; these URLs are mutable.
- **Inference/proposal (INF):** architectural recommendations and expected results of future extensions. No Doom execution, browser rendering, compiled-export inspection, API calls, build, installation, or performance measurement was performed.

Documentation checked: [Decisions guide][O1], [Decisions create reference][O2], [image input guide][O3], pinned upstream README/header/interface, local GPL texts and C license headers, [Freedoom overview][L1] and [license][L2]. The GNU website fetch failed; GPL findings use the local license texts. A historical id Software README was also inspected, but its older source-license wording is not the license authority for this dependency.

This investigation writes only this report. It does not initialize/update dependencies, produce patches, build artifacts, or create commits.

## 3. Current Dependency and Licensing

**SV/CV — actual dependency:** `.gitmodules:1–3` specifies the upstream URL and path. The root gitlink pins the full revision above. Root tracked files at investigation start are `.gitmodules`, `AGENTS.md`, `LICENSE`, and the submodule. There is no root package manifest, wrapper, asset URL, server, application entrypoint, or production integration. The browser code discussed below is an upstream example, not a current application. [S1]

The example expects `examples/browser/assets/doom.wasm`; its Makefile copies the artifact from `PATH_TO_DOOM_WASM` and serves that directory using Python's HTTP server. Upstream builds `build/doom.wasm` with WASI SDK 24 in Docker, then Binaryen 119 tools merge WASI trampolines, merge initialization functions, remove unallowlisted exports, and add key constants. SDK/Binaryen versions are named, but Docker tags and the downloaded WAD are not content-hash pinned. [S3, S7]

| Component | License evidence and implication |
| --- | --- |
| Root repository | `LICENSE` contains GPL version 2. There is no separate root application yet. |
| Doom/doomgeneric engine | Engine C headers, e.g. `doomgeneric/src/g_game.c:2–13`, explicitly state GPL version 2 **or later**. Preserve notices and satisfy applicable GPL source/distribution obligations when serving a compiled engine. |
| WASM adapter, WAT, example glue | Submodule `LICENSE` is GPL version 2; no separately declared permissive exception was found in the inspected adapter/WAT/browser files. Treat the distributed engine/glue bundle under that repository license; do not infer MIT licensing from its small interface. |
| Original Doom game data | Engine licensing does not grant rights to graphics, maps, sounds, characters, or IWADs. Freedoom's official overview explicitly distinguishes proprietary Doom content from the released engine. Owning a retail IWAD does not establish permission for this project to publicly redistribute it. [L1] |
| Default shareware data | `Makefile:174,258–261` downloads `doom1.wad` from ibiblio and embeds it into generated C, which is linked into WASM. `DG_GetWads` uses it by default. The precise shareware distribution terms/package notices are **Unknown** here: no accompanying shareware license was found in the inspected files. Availability on a mirror or upstream demo is not sufficient redistribution evidence. Verify permission for embedding and public serving before using that build publicly. [S2, S7] |
| Freedoom alternative assets | A tracked `doomgeneric/example_implementation/test_wad_files/freedoom2.wad` exists, but the browser example does not load it. Its header is `IWAD`, size 28,787,748 bytes, SHA-256 `a8772e088847032510d97ba2312406a6998f21cbab44d4ff10696faa9c0ecd4b` (CV). Exact release/notice provenance is not established. Official Freedoom assets use a BSD license with notice, disclaimer, and non-endorsement conditions. Select a release with its accompanying license/credits. [L1, L2] |

**INF:** use a provenance-verified Freedoom release for a public prototype, or have users load permitted local assets. Loading custom assets does **not** remove the currently embedded shareware bytes from the distributed module; a public Freedoom-only build should remove/replace that fallback too. Preserve engine source and build instructions matching any distributed WASM. The licensing scope of a future independent JavaScript application/proxy and WASI runtime components needs a distribution review; this report establishes no blanket licensing exception for them.

## 4. Existing Execution and Control Interface

### Initialization, assets, memory, and shutdown

**SV:** final intentional exports are `initGame()`, `tickGame()`, `reportKeyDown(i32)`, `reportKeyUp(i32)`, `memory`, and fourteen `KEY_*` constants. Imports comprise initialization/WAD loading, frames, time, stdout/stderr messages, and save I/O. The export allowlist confirms there are no intentional state getters; `--export-dynamic` during intermediate linking does not preserve arbitrary engine symbols in the final artifact. [S2, S3, S7]

`initGame` is a WAT wrapper that calls WASI `_initialize`, then `_initializeDoom`. The latter passes zero command-line arguments to `doomgeneric_Create`. It allocates `DG_ScreenBuffer`, invokes `onGameInit`, loads engine/assets, and enters `D_DoomMain`. Initialization itself calls `TryRunTics` and `doomgeneric_Tick`; it is not merely allocation. With default arguments it starts the title/demo sequence (`D_StartTitle`), not a selected playable map. There is no exported start-map, restart, or destroy function. Menus can start a game via keys; an intentional bounded start command would be more reliable for automation. [S2, S4, S18]

Custom WAD bytes must be prefetched before synchronous initialization. `wadSizes` writes a WAD count and total size through wasm32 pointers; `readWads` writes concatenated data and an array of individual lengths. First WAD is the IWAD, subsequent files are PWADs. Empty `wadSizes` selects embedded shareware. Validate count/lengths and asset compatibility in the host: the adapter trusts supplied sizes and does not comprehensively validate their consistency. [S2]

Shutdown must currently mean cancel the host scheduler, invalidate requests, release host resources, and discard the instance/terminate its Worker. Calling `initGame` again is not an established reset contract. Internal cleanup exists, but normal quit is unreliable and there is no public shutdown callback. Save I/O is intentional; the browser example disables it, and save-file parsing is not a live-state interface. [S2, S3, S15]

### What a tick actually does

**SV:** `tickGame → doomgeneric_Tick → TryRunTics`, followed by sound update and `D_Display`. `TICRATE` is **35** in `doomgeneric/include/i_timer.h:22`. `I_GetTime` converts the imported millisecond clock into tics; `I_GetTimeMS` shares its baseline. `TryRunTics` builds commands based on elapsed time, computes available work, and increments `gametic` for each `RunTic`. [S4–S6]

- One exported call is **not exactly one simulation tic**. It can consume several available tics and draw the resulting frame; its waiting branch can also return without running a tic. “At least one tic” in the caller comment is not a stronger guarantee than the implementation.
- Rendering and stepping are coupled. A normal call renders after its tic batch; a wipe renders several times inside one call. There is no intentional render-only or exact-step export.
- No engine-created JavaScript timer or `requestAnimationFrame` advances it independently. The example installs `setInterval(tickGame, 1000/35)` and uses `performance.now()` for time. The host owns invocation, but internal command generation also occurs through `NetUpdate`, including during display.
- `TryRunTics` waits synchronously, calling `I_Sleep(1)` while polling time. The adapter's sleep is a no-op for 1 ms. `D_Display:278–295` completes the entire screen-melt in a polling loop. Main-thread paint cannot show its intermediate callbacks before the call returns.
- Stopping exported calls freezes computation after the current call returns. With the example clock, resuming sees elapsed wall time. Command buffering caps limit work but do not make it exact, replay all missed time, or prevent stale held keys from affecting catch-up.
- A host clock excluding API-wait time can avoid that elapsed-time jump, but it must advance enough **inside** calls for polling loops to finish. A fixed timestamp per call is unsafe, particularly on wipes. Increment-on-read clocks make progress but tie simulated time to the number of internal time queries, so are not an exact action contract.

`singletics` is an existing **internal** mode, normally used for timed demos. It builds one command per `TryRunTics` invocation and suppresses `NetUpdate`; with `ticdup=1` and no prebuffered commands it offers a promising exact-step seam. It is not exported or enabled by the zero-argument adapter. Expose an intentional stepped mode set before initialization, prove those invariants, and bypass wipes; do not toggle it using guessed memory offsets. [S5, S6]

**INF:** slower/faster-than-real-time simulation is plausible once exact stepping controls cadence independently of the clock. Ordinary calls with a wall clock instead busy-wait when called too early and batch/drop elapsed work when called late. Deterministic replay is not verified: `P_Random` uses a fixed sequence, but rendering/wipes use their own random state, command buffering matters, and compile/asset/input differences remain. Exact tic count is a narrower and necessary first guarantee. [S20]

### Keys, compound actions, and release caveats

**SV:** `reportKeyDown/Up` set `isKeyPressed[256]`. Keys persist until changed; repeated downs do not create repeated events. `DG_GetKey` compares that array against `statePreviouslyCommunicated`, then `I_GetEvent` posts events, `D_ProcessEvents` gives menus first refusal, and `G_Responder` updates `gamekeydown`. `G_BuildTiccmd` combines held movement, turn, strafe, attack, use, speed, and weapon keys. [S2, S8–S10]

| Command | Intentional key mapping |
| --- | --- |
| Forward / backward | `KEY_UPARROW` / `KEY_DOWNARROW` |
| Turn left / right | `KEY_LEFTARROW` / `KEY_RIGHTARROW` |
| Strafe left / right | `KEY_STRAFE_L` / `KEY_STRAFE_R` |
| Fire / use | `KEY_FIRE` / `KEY_USE` |
| Run | `KEY_SHIFT` |
| Alternate strafe modifier | `KEY_ALT` makes left/right arrows strafe instead of turn |
| Weapon slot | ASCII `'1'` through `'8'` in this engine's defaults; ownership, mode, and shared fist/chainsaw or shotgun/SSG selection rules apply |
| Menu navigation | Escape, arrows, Enter; reserve for host lifecycle/UI control |

The WAT constants are scalar `WebAssembly.Global` exports; use their numeric values. Movement+turn+fire and strafe+fire are supported. Keyboard turning accelerates after held tics; momentum/collision mean releasing movement is not an instantaneous physical stop. Fire repeats according to weapon rules. `use` is edge-triggered during live play (`usedown`); distinct uses require a consumed release interval. Weapon switching sets `pendingweapon` and may wait for an attack animation. [S8, S10, S11]

Three material implementation details prevent claiming perfectly atomic compound-key intervals today:

1. `I_GetEvent:285–299` breaks after **one key-up**, so multiple releases can span input scans. A held movement/fire set may take several simulation tics to clear in a single-scan stepping scheme.
2. `G_DoLoadLevel:573–578` clears `gamekeydown`, but adapter key caches remain intact. A continuously reported held key can cease affecting the engine after a load because the bridge sees no new edge. Explicitly reset/reconcile inputs across map loads and restarts.
3. `DG_GetKey:128–130` scans indices `< UINT8_MAX`; key 255 is accepted by setters but never relayed. Also, down+up before any scan collapses to no event. Use known allowlisted keys and schedule taps across actual input processing boundaries.

### Held-key invariant: what the current bridge cannot guarantee

**Conclusion (SV): the current public bridge cannot guarantee that Doom's effective held keys match a controller request at every gameplay tic boundary. TypeScript alone cannot supply that guarantee.** An atomic update of the adapter cache is achievable in TypeScript; an atomic update of the engine's effective state and its consumed command requires C changes. The following analysis addresses simultaneous changes, transitions, death, and restarts explicitly.

Define the contract over the supported gameplay control keys, with a single controller and no concurrent human/demo input. For gameplay tic `t`, let `S_t` be the complete requested held-key set accepted for the current run/load generation. The required invariant is:

```text
Before building the command for tic t:
  engine gamekeydown over the controlled keys == S_t
Immediately before that command is consumed by P_PlayerThink:
  engine effective keys still == S_t
  consumed ticcmd was built from S_t in the same run/load generation
```

The second requirement matters: a matching key array is insufficient if a buffered command from another action/map is still consumed. This is a keyboard-input invariant, not a promise that movement instantly stops, use always activates, firing always succeeds, or weapon animations finish. Engine momentum, dead-player handling, `usedown`, `attackdown`, `turnheld`, ownership, and animations continue to govern gameplay. Requests for obsolete generations must be rejected, not silently acknowledged as applied. Outside an eligible gameplay phase, return an explicit lifecycle/suspended result and use a documented neutral-input policy.

There are four distinct representations in the current source:

| Representation | Owner / mutation | What it proves |
| --- | --- | --- |
| Controller requested set | Future TypeScript controller | Intent only; not currently an engine input acknowledgment |
| `isKeyPressed` | Adapter setters in `src/doom_wasm.c:32,47–66` | Last reported desired states |
| `statePreviouslyCommunicated` | Function-local static cache in `DG_GetKey:128–137` | Last transitions **emitted**, not last transitions accepted by responders |
| `gamekeydown`, then `ticdata[].cmds`, `netcmds`, `players[].cmd` | `g_game.c:181,291–410,694–707,733–788`; `d_loop.c:178–181,715–727` | Actual keyboard state and command that the engine uses |

`gamekeydown` is **static in `g_game.c`**, so even an adapter extension cannot directly read/write it through an existing extern declaration. An intentional engine helper is needed there, or a controlled command-building seam must own synchronization. No current getter exposes the effective set or the generation of the consumed command. [S2, S5, S10, S14]

**Source-backed counterexamples:**

- **Simultaneous release:** after `{fire, forward}` has been consumed, request `{}` with both setters before stepping. The next `I_GetEvent` scan sees fire (`0xa3`) before forward (`0xad`), posts its key-up, and breaks. That scan can build a command with forward still held. With `{fire, forward} → {backward}`, the first release can also delay the new backward press. JavaScript call order cannot change this numeric scan order. More input scans may occur within current `tickGame`, but there is no guarantee they precede each affected gameplay tic. [S2, S8, S10]
- **Responder consumption:** `DG_GetKey` marks a down as communicated before `D_ProcessEvents` calls `M_Responder` and `G_Responder`. A menu consumes an arrow-down event without applying it to `gamekeydown`. If the request stays held when the menu closes, there is no edge left to relay. A title/demo key can open the menu rather than control a player; `GS_LEVEL` alone does not exclude demo playback. Menus generally let key-up pass (`M_Responder:1177–1178`), so this finding is specifically about consumed downs, not a claim that every menu swallows every release. [S8, S18, S25]
- **Load clears engine state only:** `G_DoLoadLevel` zeros `gamekeydown` after a new game, map change, or single-player rebirth. Both adapter caches can still say forward is held. Repeating `reportKeyDown(forward)` changes neither cache, so no new down is emitted. A raw “resend all downs” policy does not repair this. [S2, S10]
- **Load occurs after command construction:** `BuildNewTic` processes events/menu and builds/stores a command; `RunTic → G_Ticker` then processes rebirth/pending game actions **before copying `netcmds` into the player command**. A newly loaded player can therefore receive a command constructed before `G_DoLoadLevel` cleared keys. A menu-selected new game can be requested during event processing in this same cycle. Post-call TypeScript reconciliation is too late to guarantee that first gameplay tic. Fixing the key-up loop or merely replaying keys on load does not fix this command-generation ordering. [S5, S10, S14, S18]
- **Death/rebirth:** death does not itself clear held-key arrays. A held use reaches `P_DeathThink` on a subsequent tic and can set `PST_REBORN`; another tic can reload the map. Current multi-tic calls can cross those boundaries without a TypeScript opportunity to cancel fire/movement/use. `G_PlayerReborn` sets `usedown/attackdown=true`, which suppresses immediate live interactions even when held-key equality is satisfied. An explicit consumed neutral tic is still needed before a fresh live use. [S11, S12, S14]
- **Unbounded event generalization:** removing the key-up break alone and attempting to replay all 256 keys could overflow `D_PostEvent`'s 64-slot ring, which has no overflow check. Key 255 also happens to be `KEY_PAUSE` (`doomkeys.h:52`) and is omitted from the bridge scan. Keep the gameplay allowlist small, separate pause/menu controls, and avoid using the ring to implement arbitrary whole-keyboard state restoration. [S2, S26]

| Responsibility or fix | TypeScript possible with current API? | C adapter / engine change needed for strict invariant? |
| --- | --- | --- |
| One input owner; serialize commands and stepping in one Worker; avoid yields between setter calls | Yes | No; this ensures complete adapter updates before calls, not engine equality |
| Full desired-set calculation, key allowlist, conflict rejection, safe idle/stop, stale response/run rejection | Yes | Engine should also validate its accepted control generation if a transition can occur within a call |
| Focus-loss/visibility/manual-takeover release policy, request cancellation, reset TypeScript cache when replacing instance | Yes | Same current release limitations apply when actually consuming those ups |
| Pulse keys over a consumed down interval and a consumed release interval; keep menu and gameplay commands separate | Yes as policy | Exact input-processing/tic acknowledgment is missing, so present API cannot prove consumption |
| Recreate WASM/Worker for a clean full restart | Yes | No for disposal; creation/start still needs the specified input/timing contract. Old instance state must never be reused. |
| Repair a known cache mismatch by down/up toggles and extra calls | Only a workaround | Extra calls consume gameplay and may cross phases; cannot satisfy the per-tic invariant or exact action duration |
| Drain simultaneous key releases before any command build | No | Fix `i_input.c` key-up break, or bypass edge delivery for intentional gameplay full-set input |
| Synchronize `gamekeydown` with complete desired state despite consumed events or resets | No | Engine helper in `g_game.c`; adapter desired/applied caches must be reconciled or bypassed in controlled mode |
| Prevent old buffered commands being consumed after an action or load generation change | No | Exact-step/command scheduling seam in `d_loop.c` and lifecycle ordering/validation in `g_game.c` |
| Detect and neutralize at an intra-call death/load/restart boundary | No | One-tic return/transition barrier or engine-owned invalidation before further gameplay |
| Read effective input and command generation as proof | No | Stable snapshot/debug acknowledgment; do not infer it from a frame or adapter cache |

**INF — minimum robust design:** use a bounded **complete gameplay held-set submission associated with a control sequence and load generation**, rather than model-driven key events. Inside a controlled single-player stepping path, process pending lifecycle work first, then accept/reconcile the set and build exactly one current-generation command immediately before it is consumed. If a new load occurs after acceptance, invalidate that command and either return a transition result before level simulation or explicitly run a documented neutral transition tic; never carry the old action into the new map while claiming it was accepted there. This likely needs a small lifecycle/command-order seam, not just an adapter setter. Do not rebuild commands twice per tic as a shortcut: `G_BuildTiccmd` mutates turn acceleration and other state.

Make controlled gameplay application idempotent: overwrite the engine control-key subset from the accepted complete set at each eligible boundary, including false values. It must not depend on whether `DG_GetKey` previously emitted an event. Isolate menu navigation/human input into a separate mode; a gameplay full-set must not accidentally dismiss menus, trigger cheats, or inject demo input. The existing public keyboard path can remain for manual/menu operation, with the release bug fixed.

On death, latch the event and interrupt the current batch; TypeScript submits neutral for subsequent death-animation tics and an explicit respawn command only when its policy permits. On load/restart, invalidate the prior accepted set, flush or reject commands for its generation, reset adapter/event/engine input coherently, and acknowledge neutral before accepting new gameplay actions. Include same-map rebirth and save-load paths (`G_DoLoadGame → G_InitNew`) in this rule. Reset control-related accumulators such as turn acceleration deliberately; preserve live `usedown/attackdown` semantics rather than falsely promising every held input produces an interaction immediately. [S10, S14, S27]

Expose in the bounded snapshot/step result the **effective control mask**, applied control sequence, load sequence, and the sequence/generation of the last consumed command. Because `gamekeydown` is private, this acknowledgment needs the engine helper. Capture it at the pre-consumption seam as well as post-step during the experiment: a post-step key mask can hide a first-tic stale-command defect. Runtime verification is still required; this investigation proves the counterexamples/order from source, not a repaired implementation.

## 5. Observation Capability Matrix

Classification: **A** = stable intentional export/import callback; **B** = accessible only by brittle internal WASM addressing/layout; **C** = known engine state requiring an intentional bridge/export; **D** = no equivalent semantic interface, requiring material new logic; **Unknown** = missing evidence. “Stable” refers to an intentional host contract, not just a C field's existence. All engine observations below are SV; compiled addresses and runtime correctness are unverified.

| Capability | Class / availability | Mechanism and stable? | Source and notes |
| --- | --- | --- | --- |
| Current visible frame | A / available as-is | `ui.drawFrame(ptr)`, dimensions from `onGameInit`; intentional | [S2, S3, S16]. Copy pixels during callback; use latest completed frame. |
| Held keys | A / available as-is, caveats | `reportKeyDown/Up`; intentional | [S2, S8–S10]. Not an atomic engine key-set command. |
| Effective held-key / consumed-command acknowledgment | C / requires engine helper | Private `gamekeydown` plus buffered/current `ticcmd`; no intentional acknowledgment | [S5, S10, S14]. Adapter cache equality does not prove the gameplay-boundary invariant. |
| Exact N-tic progression | C / requires export or patch | `singletics`, `gametic`, `ticdup`; no stable export | [S5, S6]. `tickGame` is intentional but its tic quantity is not fixed. |
| Health / armor | C / requires export | `players[consoleplayer].health`, `.armorpoints`, `.armortype`, `.mo->health`; no | [S9, S12]. Damage mirrors health into player data, clamped to zero; mobj health can be negative. Header comment understates use of player health; HUD reads it directly. |
| Alive / dead | C / requires export | `player_t.playerstate`, actor health, validity flags; no | [S9, S11, S12]. `PST_LIVE/DEAD/REBORN`; ignore stale/default health outside a valid user level. |
| Ammo / current weapon | C / requires export | `ammo[NUMAMMO]`, `readyweapon`, `pendingweapon`, `weaponowned`, `weaponinfo[readyweapon].ammo`; no | [S9, S17]. Fist/chainsaw have `am_noammo`, not ammo zero. HUD is secondary evidence. |
| Coordinates / orientation | C / requires export | `player_t.mo`, `mobj_t.x/y/z`, `.angle`; no | [S9, S19]. Signed 16.16 fixed-point map units; unsigned 32-bit binary angle, degrees = angle × 360 / 2^32. Check `mo` validity before dereferencing. |
| Map / episode / mode / skill | C / requires export | `gamemap`, `gameepisode`, `gamemode`, `gamemission`, `gameversion`, `gameskill`; no | [S9]. Map/episode generally one-based; `wminfo.last/next` zero-based. Mode alone does not identify objective or asset version. |
| Gameplay / menu / pause / attract demo | C / requires export | `gamestate`, `gameaction`, `menuactive`, `paused`, `usergame`, `demoplayback`; no | [S4, S9, S13, S18]. A demo can be `GS_LEVEL`; state alone is insufficient. Menu is an overlay, not a `gamestate` enum member. |
| Intermission / map exit | C / requires export | `ga_completed`, `GS_INTERMISSION`, `wminfo`, `G_ExitLevel/G_DoCompleted`; no | [S9, S14]. Pending exit can be seen before committed transition if explicitly exported. |
| Game/episode victory | C for stock completion / requires bridge | `ga_victory`, `GS_FINALE`, mission/map context; no | [S14, S21]. Finale also occurs mid-campaign. Export a latched completion reason/sequence for supported stock content. |
| Arbitrary custom-WAD success objective | D / requires new policy/logic | No universal “won” API or objective specification | [S14, S21]. Engine follows fixed progression rules; product success for custom scenarios must be defined. |
| Respawn / restart | C for state; A keys for requesting use | `PST_REBORN`, `G_DoReborn`, `G_DoLoadLevel`; no stable reset getter/command | [S11, S14]. Single-player reload differs from multiplayer respawn. Fresh-instance reset is host glue. |
| Kills / items / secrets / progression | C / requires export | `killcount/itemcount/secretcount`, totals, `leveltime`, cards, `wminfo`; no | [S9, S12, S14]. Useful progress evidence; not a universal win predicate. |
| Enemies present / target objects | C / requires bridge | `thinkercap` and actor thinkers; `mobj_t` flags/type/health/target; no | [S13, S19]. Enumerate only validated actor thinkers, not every thinker cast to mobj. Exclude corpses; define what counts as hostile. |
| Enemies visibly perceived / actionable screen targets | A image; D semantic list | Frame available; no stable screen-target list | [S16, S19]. Existing renderer/LOS internals do not establish a host-visible, occlusion-aware target contract. Use visual inference initially. |
| Informational/error text | A / available as-is | `console.onInfoMessage/onErrorMessage(ptr,len)`; intentional | [S2, S15]. Not every stderr message is fatal. |
| Fatal / quit status | C / requires patch; exact trap behavior Unknown | `I_Error`, `I_Quit`, `internal__proc_exit`; no typed callback | [S15]. Fatal can hang indefinitely; quit can fail cleanup. Browser exceptions alone do not cover these paths. |
| Internal state memory reads | B in principle / brittle internals; addresses Unknown | Exported `memory`; no symbol-address getters, layout schema, or offset map | [S3, S7, S9]. Not a recommended substitute for C observations. |

**SV/INF — memory is not a state API:** final exports give no address for `players`, `gamestate`, or `thinkercap`. A forensic reader could derive offsets for a particular built binary, but none were established here. Linker layout, optimization/dead-code elimination, Binaryen transforms, compiler versions, C alignment/enums, and source edits can change those offsets. Heap objects can disappear or be replaced at map loads; `.mo` is a pointer, not an inline stable object. Memory growth does not relocate existing linear-memory offsets, but JavaScript views must be recreated when `memory.buffer` changes. The checked-in interface describes minimum 72 memory pages and no maximum; it is not an enforced 16 MB ceiling. A snapshot's explicitly documented layout is an ABI; raw Doom struct offsets are not.

## 6. Lifecycle and Terminal-State Semantics

### Death and respawn

**SV:** `P_DamageMobj` subtracts armor-adjusted damage, mirrors/clamps player health, subtracts actor health, and calls `P_KillMobj` when actor health is `<= 0`. `P_KillMobj` marks the player's `PST_DEAD`, removes shootability/solidity, selects death/gib state, and lowers the weapon during that simulation tic. A post-tic snapshot is authoritative; the death animation need not finish first. [S12]

`P_PlayerThink` routes dead players through `P_DeathThink`: weapon sprites animate, view falls, camera turns toward the attacker, and damage flashes fade. World thinkers still run. Holding `BT_USE` sets `PST_REBORN`; this dead-state path does not require the live `usedown` edge. On the next `G_Ticker`, `G_DoReborn` requests a single-player level reload, handled by the same action-processing loop. Multiplayer would spawn a player instead, but multiplayer support is disabled in this build. [S11, S13, S14]

**INF policy:** death ends the current AI attempt, not the Doom rendering service or necessarily the selected Doom campaign. Cancel decisions/release inputs immediately, keep a short bounded neutral death-animation interval if desired, then request use/restart only under explicit retry policy. A use held through death can trigger immediate rebirth and let a multi-tic batch miss `PST_DEAD`; inspect each exact tic and/or latch death events. Cap retries. Reinstantiate after fatal errors; do not reuse a partially cleaned-up instance.

### Level exits and intermission

**SV:** switches, crossing exit lines, special sectors, and boss logic invoke `G_ExitLevel`/`G_SecretExitLevel`, which set `gameaction=ga_completed`. That is a pending action at the end of the triggering tic. At a following `G_Ticker` action phase, `G_DoCompleted` clears level-specific inventory, selects progression, fills `wminfo`, and sets `GS_INTERMISSION`; episode-end maps take the victory path instead. Intermission ticks animations and statistics, not level thinkers. [S14]

Intermission progression is not universally automatic: the single-player statistics state waits for an acceleration input to proceed. `WI_checkForAccelerate` detects fire/use edges; later `WI_updateNoState` invokes `G_WorldDone`. `G_DoWorldDone` loads `wminfo.next+1`. The host should release combat keys, tick and render intermission under a separate controller, and deliberately pulse continue when appropriate. Avoid an indefinite neutral loop waiting for a map change. [S14, S22]

### Victory is content-specific

**SV:** stock noncommercial Doom ends an episode on map 8 (`ga_victory → F_StartFinale → GS_FINALE`); Chex has a map-5 exception. Doom II/Final Doom finales also occur after maps 6, 11, 20 and secret routes 15/31. Those can return to `ga_worlddone` after a button press once text has run for >50 tics. Map 30 instead starts the cast sequence. Noncommercial finales advance from text to artwork; they do not automatically select another Doom episode. There is no universal terminal `completed=true` flag or natural engine shutdown on victory. [S14, S21]

**INF policy:** for the default shareware objective, episode-1 map-8 finale is successful episode completion. For a stock Doom II objective, map-30 finale is successful campaign completion, while earlier finales continue. A single-map benchmark can end on its authoritative exit before intermission finishes. Choose one objective with the asset manifest; retain a completion reason and sequence instead of treating any `GS_FINALE` as victory. Other registered Doom episodes require new-game selection if the product wants to continue them.

### Menus, pause, demos, errors, quit

**SV:** `P_Ticker` returns when `paused`, or when a single-player menu is active after the initial view setup and not in demo playback. Menu tickers still run through command construction; `gametic` can advance while `leveltime` does not. Intermission/finale handling is dispatched separately by `G_Ticker`, so the level pause check is not a universal freeze mechanism. Use a host freeze between calls for API waits. Attract demos must be distinguished using `usergame`/`demoplayback`. [S5, S9, S13, S18]

`config.h:94` undefines `ORIGCODE`; the active `I_Error` path writes stderr, invokes cleanup, then loops `while(true)`. `I_Quit` invokes cleanup callbacks but its actual `exit(0)` is compiled out. `internal__proc_exit` does not implement an exit event; its comments record an upstream browser quit crash (“null function or function signature mismatch”), **DOC, not reproduced here**. Log callbacks are synchronous and the browser example only logs them. Catching `WebAssembly.RuntimeError` handles traps, but cannot recover a same-thread infinite C loop. [S15]

### Proposed application state machine (INF)

```text
initializing -> starting (title/menu or explicit start) -> playing
playing -> awaiting_decision -> playing
playing/awaiting_decision -> dead -> respawning -> playing
playing -> exiting -> intermission -> playing or narrative_finale
narrative_finale -> playing (stock campaign continuation)
playing/intermission/narrative_finale -> completed (declared objective met)
any active state -> error or stopped
```

`menu` and `engine_paused` are overlays/suspensions of the relevant engine phase; `awaiting_decision` belongs to the application, not Doom's pause bit. `exiting` means pending `ga_completed`; stop asking for combat decisions immediately. Every transition invalidates outstanding observation/action IDs. Death, map-load, completion, and error sequence numbers preserve events that raw state polling could miss. A post-tic snapshot plus a last completed frame should be captured as one observation; framebuffer callbacks during a wipe are not independent simulation boundaries.

## 7. Decisions API Integration

### Documented transport and answer contract (DOC)

The [current Decisions guide][O1] documents `POST /v1/decisions`, public beta status, and `gpt-6-luna` as its supported model on the investigation date. Shared `input` evidence can combine `input_text` and `input_image` in a user message. Named questions return typed answers: `predicate` probabilities, fixed `choice` selections, or ordered `score` results. The guide demonstrates inline PNG base64 images and advertises relative speed; it establishes no absolute gameplay latency guarantee. Its JavaScript examples require SDK 7.30.0 or later; no SDK is installed by this investigation.

The [endpoint reference][O2] specifies **inline base64 data URLs only**, no hosted URLs or file IDs, at most **128 images per request**, and **2–255 unique choices**. `detail` accepts low/high/auto/original, default auto. Refusals are a separate answer type. Schema `image_url.maxLength=1073741824` is a string constraint, not proof of a permitted 1 GB upload or operational request limit.

The [general image guide][O3] lists PNG, JPEG, WebP, and non-animated GIF; its 512 MB/1,500-image request limits are general guidance and should **not** replace Decisions' stricter image count. Decisions explicitly demonstrates PNG. Endpoint-specific byte/dimension limits and support for every other general format remain **Unknown** from the inspected Decisions pages; use one small PNG initially and verify acceptance. No live API/image acceptance test was performed.

### Frame encoding (SV/INF)

The engine renders a **320×200 indexed-color** screen (`I_VideoBuffer`) and converts it using the current gamma-adjusted palette into the **640×400, 32-bit BGRA** `DG_ScreenBuffer`, with 2× integer scaling. The browser callback creates a fresh WASM byte view, swaps B/R into reusable RGBA `ImageData`, forces alpha to 255, and calls `putImageData`. Alpha in the actual converter is not populated as an opaque channel; preserve the example's explicit alpha handling. Palette changes include game flashes, not just static colors. [S2, S3, S16]

**INF:** capture the engine Canvas or a retained owned RGBA buffer, encode PNG once per observation, and send `data:image/png;base64,…`. Do not screenshot the page, repeatedly re-read pixels already copied for rendering, or encode every rendered frame. Preserve the HUD/context initially. The CSS focus opacity does not alter Canvas pixel contents. Raw BGRA is 1,024,000 bytes/frame; a 320×200 observation is 256,000 RGBA bytes before compression, because the default display is only a 2× duplication of those native pixels. Downscaling to native resolution may reduce bandwidth; perception quality must be measured. Base64 adds approximately one third to encoded byte size. PNG preserves small text; JPEG/WebP benefits and endpoint acceptance require testing. No encoded size, encoding cost, or network latency was measured.

### Bounded action selection and independent evidence (INF)

Use one `choice` question named `action` over a small menu of safe compound actions: idle, forward, backward, turn left/right, strafe left/right, fire, use, forward+fire, turn+fire, and strafe+fire. Host-defined choices may include run and weapon-slot variants later. Keep duration in host policy, not a freely generated model number. Distinct values/descriptions map to a host allowlist.

Independent questions for direction/fire/use can share an image, but produce combinations the host must arbitrate and can obscure action coherence. A score distribution is inappropriate for selecting arbitrary keyboard categories. Optional perception questions (enemy/door/obstruction) can aid diagnosis; they should not decide engine death or campaign success.

Supply concise authoritative state as an `input_text` part beside the image: valid player health/armor, ammo/weapon, level/mission, tick and load sequence, previous action/duration, objective, and recent progress. This is host-provided evidence, not a tool return or an assumed server memory of previous requests. The HUD is useful to perception, but can be hidden at full view size, replaced by menus/finale, or affected by flashes; visual health/ammo accuracy has not been measured. [S17]

### Failures, ordering, and credentials (INF)

Only one decision is outstanding per run. The application/proxy envelope carries `runId`, `attemptId`, `loadSequence`, `observationId`, and `observationGametic`. Match it against the current controller generation before applying the action; question names alone are not request identity. Reject mismatches, malformed/missing/refused answers, and choice values outside the exact current allowlist. Invalidate on restart, death, exit, manual takeover, or stop. In paused mode, retain the last frame and advance no simulation during requests, retries, or timeout handling.

Use bounded timeouts and retry budgets for transient errors, including rate limits. On failure, clear keys, remain visibly in a paused error/retry state, and never leave an old fire/movement action running indefinitely. Cancellation is best-effort; generation validation is mandatory even after aborting a request. Confidence can influence an optional fallback policy, but is not a safety or lifecycle guarantee.

A server-side proxy holds the long-lived OpenAI key, authenticates/rate-limits clients, bounds images/actions/request cost, validates schema, and returns only the result and application identity envelope. Do not ship the key in WASM, browser JavaScript, URLs, or browser storage. The proxy does not need Doom state authority for a local demonstration; client-supplied health is untrusted for billing/scoring/security. Competitive authoritative scoring would require server-owned simulation, a separate scope.

## 8. Proposed Browser Architecture

**INF — component boundary:** one Worker owns engine memory, simulation scheduling, held input, snapshots, and run lifecycle. The main thread owns spectator presentation, UI, and the watchdog. A server owns API credentials and request limits. No component other than the engine controller may independently invoke stepping.

| Loop operation | Existing support | Missing work |
| --- | --- | --- |
| Load assets and instantiate | Intentional imports and browser example | Browser glue: prefetch, validate asset manifest/sizes, record hashes, catch initialization failures |
| Start playable game | Menu keys, internal `G_DeferedInitNew` | Prefer bounded engine start command; otherwise explicit manual/menu setup with verified state |
| Hold selected keys | Public down/up setters | Browser allowlist + adapter/input release and reset fixes |
| Advance one tic; repeat at most N | Internal `singletics`/loop machinery | Intentional stepped mode, invariants, transition interruption |
| Render intermediate frames | Draw callback coupled to current stepping | Worker-to-main delivery, bounded queues; skip/bypass wipe initially |
| Inspect state after each tic | C fields only | Versioned read-only snapshot + transition counters |
| Capture observation | Frame callback/memory | Owned image copy, pair with snapshot/tic ID, PNG encoding |
| Await decision | Host can refrain from calling WASM | Proxy, serialized requests, visible wait status; freeze simulation clock |
| Validate and apply | None currently | Generation/schema/action checks; bounded scheduler |
| Handle death/intermission/finale | Engine logic exists internally | Authoritative bridge + explicit application transition policy |
| Stop/recover from trap or hang | Host controls instance lifetime | Main-thread Worker watchdog, scheduler cancellation, fresh instance |

Recommended loop, **a design sketch only**:

```text
initialize in stepped mode; select verified assets and a fixed objective
start a playable map; render and snapshot initial state
while active:
  set the validated complete held-key set
  for at most N exact simulation tics:
    advance one tic, produce/present frame, poll authoritative snapshot
    stop the action immediately on death, exit, load, or other phase change
    yield between scheduled steps so browser presentation stays responsive
  clear held keys at the action boundary
  if playing and another decision is due:
    copy the completed frame and its matching state snapshot
    freeze simulation/virtual clock; await one proxy request
    verify run/observation identity and answer allowlist
    schedule the next bounded action
  otherwise use the lifecycle controller for respawn, intermission, or finale
```

An engine tic and a **gameplay** tic must be reported separately: `gametic` advances through menu/intermission; `leveltime` advances only when the level simulation runs. N gameplay tics are valid only while the verified playing predicate remains true. Interrupt rather than execute a combat batch across a transition.

### Conceptual typed control contract (INF, not an implementation)

```text
ActionCommand = {
  runId, observationId, loadSequence,
  actionId: a value in the current predefined ActionId allowlist,
  durationTics: host-selected integer in [1, 35]
}
HeldInput = {
  move: none | forward | backward,
  turn: none | left | right,
  strafe: none | left | right,
  fire: boolean, use: boolean, run: boolean,
  weaponSlot: none | 1..8
}
ControlCommand = ActionCommand | Stop | Restart
```

Start with 7-tic intervals (200 ms of simulation), then measure. Permit compound combinations through an explicit mapping, never raw key codes from the model. Mutually exclusive enum fields prevent forward+backward and left+right conflicts; disallow alternate-strafe modifier plus turn in the model vocabulary. Stop is a host operation that clears keys and suspends simulation, while idle advances neutral tics. Neither guarantees immediate cessation of player momentum. Restart is lifecycle-only.

At each boundary replace the entire desired set and consume its transitions before the next command is built. Distinct use taps require at least one live tic without use. The host can request a weapon slot, but observes eventual `readyweapon`/`pendingweapon` rather than assuming immediate success. Keys must also be cleared on stop/error/death/load; a reset must synchronize adapter and engine caches, not just call setters redundantly.

### Cadence and threading tradeoffs

**INF:** schedule active simulation at 35 tics/s if spectator pacing matters; present the last available frame at display cadence. Do not run all N synchronous calls in a main-thread burst and expect N visible paints. Paused decision mode has effective simulation throughput `N / (N/35 + request-and-encoding latency)` tics per wall second. Repainting a frozen frame does not create smooth gameplay.

Continuous 35-tic/s play with intermittent AI decisions is a different policy: continue only a time-bounded prior action, neutralize when its budget expires, age-check responses, and capture fresh observations after transitions. It improves spectator continuity but accepts gameplay between observation and response, with enemies/damage progressing during network delays. No absolute API latency evidence justifies indefinite action holding or a 35 Hz AI cadence.

A Worker prevents busy waits/fatal C loops from freezing the main UI and enables a main-thread watchdog to terminate a stuck instance. It adds message identity, asset transfer, frame ownership/backpressure, and recovery complexity. Ordinary WASM memory is not a shared-memory rendering API; transfer owned frame buffers/ImageBitmaps with at most a bounded latest-frame queue. OffscreenCanvas could keep conversion/encoding in the Worker and reduce transfers, but adds browser compatibility/lifecycle work; defer until measurements. A main-thread timer cannot interrupt its own synchronous infinite WASM call. Worker-local timers also cannot interrupt that Worker's blocked call.

## 9. Minimum Required Extensions

All items here are **INF proposals with SV patch seams**, not patches produced in this investigation. Preserve the small curated ABI. No broad mutable engine access or hard-coded memory offsets are needed.

| Priority / scope | Exact source seams | Proposed contract and limits |
| --- | --- | --- |
| P0: authoritative snapshot | `src/doom_wasm.h`, `src/doom_wasm.c`; engine declarations in `doomgeneric/include/doomstat.h`, `d_player.h`, `g_game.h`, `m_menu.h`, `d_loop.h` | Return a pointer to an adapter-owned, explicitly laid-out read-only snapshot, or small scalar getters initially. Include ABI version/size, valid-player bit, normalized phase/action, menu/pause/demo flags, `gametic`, `leveltime`, map/mission/skill, player state/health/armor, ready/pending weapon and ammo. Copy values; never expose `player_t` or `mobj_t` pointers. |
| P0: exact stepping and nonblocking display | Adapter initialization/step exports; `doomgeneric/src/d_loop.c:636–737`, `d_main.c:152–296,369–417` | Enable stepped mode before init using existing `singletics` with `ticdup=1` and no buffered work, or add an explicit single-player step seam in `d_loop.c`. Preserve event/menu/command/RunTic ordering. Bypass the melt in stepped mode; render destination screen. Advance a virtual clock consistently with tics. Return actual tic/phase information. |
| P0: complete input application and acknowledgment | `src/doom_wasm.c:29–67,123–142`; `doomgeneric/src/i_input.c:264–301`; private `gamekeydown` and `G_BuildTiccmd/G_Ticker/G_DoLoadLevel` in `g_game.c`; buffering in `d_loop.c` | Add bounded complete-set submission, effective-mask/applied-sequence acknowledgment, and a private engine helper. Drain releases for the manual path. In controlled stepping, reconcile after lifecycle work and build a single current-generation command before consumption. Invalidate old commands on loads/death/restart, coordinate caches, and neutralize transitions. Key-up `break` removal alone is insufficient. See the held-key invariant analysis in §4. |
| P0: detect attempt/load transitions | `p_inter.c:P_KillMobj`, `g_game.c:G_DoLoadLevel/G_DoCompleted`, `f_finale.c:F_StartFinale`, or post-single-tic adapter polling | For one-tic polling, derived edges can suffice initially. Add latched death/load/exit/completion sequence and reason if transitions could occur before the host sees them. Load sequence is necessary even when reloading the same map. |
| P1: deterministic start/restart selection | `g_game.c:G_DeferedInitNew/G_InitNew`, `m_menu.c:M_ChooseSkill`; adapter export | Bounded supported skill/episode/map request using normal deferred lifecycle. Validate supported asset/map range and clear menus/inputs. Do not call arbitrary engine functions from JavaScript. A manual start is acceptable for the first experiment. |
| P1: typed fatal/quit boundary | `doomgeneric/src/i_system.c:I_Error/I_Quit`, adapter `DG_*` functions, `src/doom_wasm.h`, `src/internal__wasi-snapshot-preview1.c:48–67` | Dedicated reason/message callback before dangerous cleanup/infinite loops; terminate via an intentional trap or host callback exception and discard the instance. Avoid returning into code that assumes `I_Error` never returns. Worker watchdog remains defense against missed hangs. Clean graceful shutdown may expose further table/cleanup problems; its exact fix is Unknown. |

**Scope qualification:** snapshots are straightforward field-copy work. Reusing single-tic mode, resetting input, bypassing wipes, and fatal notification are localized but require an execution experiment. Asynchronous resumable melt animation would require a persistent transition renderer; it is optional and deferred, not necessary for bounded control. A Worker watchdog permits an initial prototype without a fully repaired quit path, provided hangs are contained and reported as errors.

ABI details: specify wasm32 little-endian offsets, fixed-width integer fields, enum values, flags for unavailable fields, snapshot lifetime, and version/size checks. Avoid C `bool`, implicit padding, compiler enum widths, heap pointers, and silent enum renumbering in the public layout. Scalars can be even simpler for an initial seam; multiple reads must occur between steps to form a coherent snapshot. Recreate JS views after memory growth and copy the snapshot before another step. Optional coordinates use signed 16.16 and unsigned angles with documented conversion. Full enemy enumeration is outside the minimum interface.

New exports also require `src/reachability_graph_for_wasm-metadce.json` entries, or Binaryen removes them despite `EXPORT` visibility. Compile adapter includes with the engine include directory (the adapter recipe currently includes `doomgeneric/` and `build/`, not `doomgeneric/include/`). A new imported fatal callback must be supplied by every host example. The build merges WAT in a fixed sequence; key constants currently require WAT because the compiler does not directly export C constants as the intended scalar globals. [S7]

Future authorized build path: edit/commit extensions in the submodule/fork, `make -C references/doom.wasm all`, regenerate `doom.wasm.interface.txt`, then inspect actual exports and exercise hosts. Build setup includes Python environment creation, Docker WASI SDK, and local Binaryen compilation; none was run here. Keep the root gitlink update separate and identify old/new revisions. Useful test seams are import callbacks, `gametic/leveltime` deltas, snapshot values after one tic, complete key-set changes, map-load counters, and watchdog recovery. Do not validate timing solely by counting draw callbacks.

Polling after each exact tic is the smallest lifecycle seam and avoids reentrant JS calls during mutable C state. Callbacks can capture transient events, but should only queue typed data and never step the engine recursively. A bounded latched event sequence alongside snapshots is preferable to many synchronous gameplay callbacks.

## 10. Risks, Unknowns, and Tradeoffs

| Finding / uncertainty | Evidence status | What would settle it / implication |
| --- | --- | --- |
| No intentional gameplay/lifecycle getters | SV: header, allowlist, interface agree | Inspect newly built binary's exports to validate ABI additions. Raw memory is not a supported fallback. |
| `tickGame` varies tic count; freezes can hang | SV: clock conversion, batching, wipes/waits | Log post-call tic deltas under controlled clocks, including initial/menu/map/finale transitions. |
| Proposed single-tic mode is sufficient | INF: existing internal path supports it under stated invariants | Build experiment proving exactly one `gametic` increment and no hidden buffering for every successful step. Revisit verdict if a deeper scheduler change is needed. |
| Compound changes, responder consumption, load cache/command mismatch | SV: key-up break, responder ordering, separate caches, lifecycle before command installation | Assert effective key set and consumed-command generation at the pre-gameplay seam, including the first tic after same-map reload/new game. Post-call TypeScript fixes cannot guarantee it. |
| Fatal hang / broken quit containment | SV hang; DOC quit crash; exact compiled behavior Unknown | Exercise a controlled fatal path and normal quit inside a Worker; main thread must remain interactive and report timeout/trap. |
| HUD perception accuracy and AI playing skill | Unknown; no model/game test | Evaluate labeled frames/action outcomes. Avoid a correctness dependency on visual health or terminal recognition. |
| Actual Decisions image acceptance, account access, latency, rate limits | DOC contract only; operational values Unknown | One PNG request through authorized credentials, then bounded latency/throughput measurements. Relative marketing speed is not a deadline. |
| Shareware public redistribution rights | Unknown for this downloaded/embedded artifact | Retrieve exact distribution license/package provenance, or eliminate shareware bytes using licensed replacement assets. |
| Included Freedoom release identity | CV file/hash, release Unknown | Match hash to a documented release and include its notices; choose a fresh verified asset release if unmatched. |
| Build reproducibility and availability | SV named tool versions; no build performed | Authorized clean build, hashed SDK/tool/WAD inputs, compare final exports. README notes Binaryen builds can take over an hour (DOC, not measured). |
| Bit-for-bit cross-build replay | Unknown | Replay a fixed command sequence with fixed assets/build and compare state; broaden only after tic control passes. |
| Smooth continuous spectatorship | INF scheduling limitation | Measure combined request/encode latency and decide acceptable freezes or action staleness. Faster rendering cannot remove network waits. |
| Missing sound/music | DOC upstream README; no audio imports in SV interface | Audio is a separate feature, not needed for visual observation/control feasibility. |

No demonstrated limitation warrants replacing the foundation now. No broad Doom/WASM ecosystem survey was performed. Reconsider alternatives only if exact stepping requires invasive simulation changes or required asset compatibility fails; both remain falsifiable experiment outcomes.

## 11. Recommended Next Experiment

**One bounded proof of concept: prove pause-safe, exact action stepping across a death/reload and a level transition in a Worker, before adding remote AI.** This experiment is recommended future work and was not performed here.

Use the pinned engine with only the P0 snapshot/step/input seams above, melt bypassed, a provenance-verified asset set, fixed map/skill, and scripted actions. Manual menu start is sufficient initially. Use controlled damage/exit fixture triggers confined to that future test harness to exercise transitions without waiting for a successful autonomous campaign. Those triggers must not masquerade as production exports. Run the exact same scripted sequence twice with different simulated decision delays.

Measure/log `(run, observation, load sequence, gametic, leveltime, phase, player state, health, coordinates, requested/effective input masks, applied/consumed control sequences, frame sequence)` after **every** exact step, with input assertions immediately before player-command consumption. Hold a compound forward+turn+fire action for 7 tics, clear all its keys, capture a frame/state pair, wait 2 seconds and then 10 seconds without stepping, and repeat. Also switch `{fire, forward} → {backward}`, keep a request held through menu closure, start a new game during menu event processing, and test a use-while-dying case, same-map reload, ordinary map exit/intermission continue, and a contained fatal/quit check. Maintain a main-thread heartbeat while the Worker runs.

Success criteria:

1. Every successful step increments `gametic` exactly once. During unpaused playable simulation, `leveltime` increments once; phase transitions interrupt the action batch. Initialization is logged separately.
2. No state/frame changes occur during either external wait. The next step advances one tic, with no delay-dependent movement or catch-up. Matching scripted runs agree on authoritative state despite different waits.
3. Every eligible tic's effective key mask matches its accepted complete request; its consumed command has the current control/load generation. All simultaneous releases/presses take effect at that boundary. The first playable tic after menu start, map load, same-map rebirth, or fresh restart uses the documented neutral/new-generation set; no old command leaks through. A consumed no-use tic permits a fresh use edge. Movement inertia is allowed, lingering input bits are not.
4. Death, rebirth/load, pending exit/intermission, and next-map identity are recognized from state/sequences. Death is retained even if use immediately requests rebirth. Intermission continues deliberately and does not hang waiting for neutral input to finish it.
5. A copied frame has correct colors/opacity and matching observation identity. UI heartbeat stays responsive; the watchdog terminates a stuck Worker and preserves the spectator/error UI.

Failure criteria: any multi-/zero-tic successful step, wait-dependent catch-up, stuck wipe, lost death/load event, persistent released input, mismatched state/frame, or a main-thread freeze. Fix the specific seam before introducing an API feedback loop. If scheduler repair exceeds these localized changes, revise the verdict and scope explicitly.

Only after this passes, replace one scripted action selection with a single authorized PNG Decisions request through the proxy, checking acceptance, refusal/timeout handling, stale-response rejection, and measured latency. That is the next milestone, not a prerequisite for proving the engine contract.

## 12. Decisions and Deferred Questions

**Recommended decisions from this investigation:**

- Retain the pinned current port as the prototype foundation; introduce a small explicit bridge rather than raw-memory offsets.
- Separate authoritative lifecycle/state from screenshot perception. Health/player phase/map transitions come from C snapshots; navigation/targets initially come from images.
- Begin with exact stepped play and pause while awaiting one decision. Use predefined compound choices and host-owned short durations.
- Require complete gameplay input application and current-generation command acknowledgment at the engine tic seam. TypeScript serializes intent; C establishes the effective held-key invariant. A key-up-loop fix alone does not satisfy it.
- Keep WASM in a terminable Worker, API credentials in a server proxy, and spectator/UI on the main thread.
- Treat death as attempt failure with a bounded restart policy; define victory by the selected asset/objective. Preserve the final frame and terminal reason.
- Defer audio and asynchronous melts; bypass melts for the stepped prototype.

**Deferred until evidence or a product choice:** exact public ABI representation (getters vs snapshot), automatic start command, verified WAD/release and public redistribution package, one-map vs episode/campaign objective, retry budget, initial action-menu breadth, image resolution/detail, confidence fallback, smooth real-time vs paused cadence, OffscreenCanvas, and whether graceful quit is worth repairing beyond explicit stop/Worker disposal. The exact-step experiment settles engine feasibility; a real request/measurement settles API transport and cadence. No implementation or final API specification is approved or created by this document.

## 13. Source References

Paths below are repository-relative. All engine/glue links pin `31cc1af9656a8184830090c4e9f268383f5d7e15`; root source pins `ecdc4409613eeaea9f44adc1d84e53f7aec32d41`. Line numbers refer to the inspected local files. `[Sx]` references identify sources, not claims of runtime execution.

| ID | Path / symbols / relevant lines | Permalink |
| --- | --- | --- |
| S1 | `.gitmodules:1–3`; root gitlink `references/doom.wasm` | [Root dependency declaration][S1] |
| S2 | `references/doom.wasm/src/doom_wasm.h:19–90,105–179,190–218`; `src/doom_wasm.c:29–175`: init, keys, assets, frames, sleep/time | [Adapter implementation][S2], [interface header][H2] |
| S3 | `references/doom.wasm/examples/browser/doom.html:20–184`; `doom.wasm.interface.txt:11–43` | [Browser example][S3], [declared module shape][H3] |
| S4 | `references/doom.wasm/doomgeneric/src/d_main.c:152–296,369–417,1606–1613`: display, wipes, initialization/tick | [Main loop/display][S4] |
| S5 | `references/doom.wasm/doomgeneric/src/d_loop.c:71–76,117–184,193–233,404–414,636–737`: timer scheduling, buffering, single-tic mode | [Tic loop][S5] |
| S6 | `references/doom.wasm/doomgeneric/src/i_timer.c:34–72`; `include/i_timer.h:22`; `include/d_loop.h:31–48,76–77` | [Clock conversion][S6], [35-tic rate][H6], [loop interface][H6b] |
| S7 | `references/doom.wasm/Makefile:128–159,172–184,258–317`; `src/reachability_graph_for_wasm-metadce.json`; init WAT | [Build pipeline][S7], [export allowlist][H7], [initialization wrapper][H7b] |
| S8 | `references/doom.wasm/doomgeneric/src/i_input.c:218–230,264–301`; `d_main.c:127–138`: releases and responder chain | [Input pump][S8] |
| S9 | `references/doom.wasm/doomgeneric/include/d_player.h:43–151,170–193`; `include/doomstat.h:49–104,130–200`; `include/doomdef.h:49–66` | [Player state/layout][S9], [global state declarations][H9], [engine state enums][H9b] |
| S10 | `references/doom.wasm/doomgeneric/src/g_game.c:G_BuildTiccmd:291–410`, `G_Responder:694–707`, `G_DoLoadLevel:522–583`; `m_controls.c:29–38,120–127`; key WAT | [Input-to-command][S10], [default controls][H10], [key constants][H10b] |
| S11 | `references/doom.wasm/doomgeneric/src/p_user.c:P_DeathThink:146–184`, `P_PlayerThink:190–267` | [Death/use/weapon behavior][S11] |
| S12 | `references/doom.wasm/doomgeneric/src/p_inter.c:P_KillMobj:586–632`, `P_DamageMobj:725–773` | [Damage/death authority][S12] |
| S13 | `references/doom.wasm/doomgeneric/src/p_tick.c:35–117`: thinkers, pause/menu, leveltime | [World ticker][S13] |
| S14 | `references/doom.wasm/doomgeneric/src/g_game.c:G_Ticker:733–877`, `G_PlayerReborn:929–957`, `G_DoReborn:1091–1125`, exits/completion/worlddone:1150–1325` | [Lifecycle dispatch][S14] |
| S15 | `references/doom.wasm/doomgeneric/src/i_system.c:227–294`; `src/internal__wasi-snapshot-preview1.c:48–67`; `include/config.h:94` | [Quit/fatal paths][S15], [WASI exit limitation][H15], [active build configuration][H15b] |
| S16 | `references/doom.wasm/doomgeneric/src/i_video.c:75–88,144–187,203–286,305–327`; `doomgeneric.h:7–13`; `include/i_video.h:26–27` | [Palette/scaling/frame conversion][S16], [output dimensions][H16], [native dimensions][H16b] |
| S17 | `references/doom.wasm/doomgeneric/src/st_stuff.c:758–767,1095–1096,1131–1142`; `src/d_items.c:35–59` | [HUD values][S17], [weapon/ammo mapping][H17] |
| S18 | `references/doom.wasm/doomgeneric/src/doomgeneric.c:12–23`; `src/m_menu.c:686–738`; `src/d_net.c:68–92` | [Engine initialization][S18], [menu game start][H18], [per-tic callback][H18b] |
| S19 | `references/doom.wasm/doomgeneric/include/p_mobj.h:193–245`; `m_fixed.h:25–26`; `tables.h:78` | [Actor state][S19], [fixed-point units][H19], [binary angle type][H19b] |
| S20 | `references/doom.wasm/doomgeneric/src/m_random.c:44–58`; `src/g_game.c:G_InitNew:1533` | [Deterministic random table][S20] |
| S21 | `references/doom.wasm/doomgeneric/src/f_finale.c:39–91,104–192`: stock finales and continuation | [Finale semantics][S21] |
| S22 | `references/doom.wasm/doomgeneric/src/wi_stuff.c:637–654,1133–1217,1252–1306` | [Intermission progression][S22] |
| S23 | `LICENSE`; `references/doom.wasm/LICENSE`; `doomgeneric/src/g_game.c:2–13` | [Root GPL text][S23], [dependency GPL text][H23] |
| S24 | `references/doom.wasm/README.md`: interface, TODOs, build; `examples/browser/Makefile:18–39` | [Pinned upstream documentation][S24], [browser serving][H24] |
| S25 | `references/doom.wasm/doomgeneric/src/m_menu.c:M_Responder:1170–1178,1345–1455`; `g_game.c:G_Responder:631–674` | [Menu event consumption][S25], [game responder][H25] |
| S26 | `references/doom.wasm/doomgeneric/src/d_event.c:25–57`; `include/doomkeys.h:52` | [Event ring][S26], [unrelayed pause key][H26] |
| S27 | `references/doom.wasm/doomgeneric/src/g_game.c:G_DoLoadGame:1337–1385`, `G_DeferedInitNew/G_DoNewGame:1447–1465`; `p_mobj.c:P_SpawnPlayer:580–606` | [Load/new-game ordering][S27], [player spawn][H27] |
| O1 | Official Decisions guide; fetched 2026-10-08 | [Guide][O1] |
| O2 | Official Decisions endpoint schema; fetched 2026-10-08 | [Create reference][O2] |
| O3 | General OpenAI image requirements; fetched 2026-10-08, not an endpoint-specific override | [Images and vision][O3] |
| L1/L2 | Official Freedoom asset provenance/licensing background; mutable external references | [Overview][L1], [license conditions][L2] |

[S1]: https://github.com/mikechao/doom-decisons/blob/ecdc4409613eeaea9f44adc1d84e53f7aec32d41/.gitmodules#L1-L3
[S2]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/src/doom_wasm.c#L29-L175
[H2]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/src/doom_wasm.h
[S3]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/examples/browser/doom.html#L20-L184
[H3]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doom.wasm.interface.txt
[S4]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/d_main.c#L152-L417
[S5]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/d_loop.c#L636-L737
[S6]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/i_timer.c#L34-L72
[H6]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/i_timer.h#L22
[H6b]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/d_loop.h
[S7]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/Makefile#L149-L317
[H7]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/src/reachability_graph_for_wasm-metadce.json
[H7b]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/src/wat/merge-two-initialization-functions-into-one.wat
[S8]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/i_input.c#L264-L301
[S9]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/d_player.h#L43-L151
[H9]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/doomstat.h
[H9b]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/doomdef.h#L49-L66
[S10]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/g_game.c#L291-L410
[H10]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/m_controls.c
[H10b]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/src/wat/global-constants.wat#L26-L39
[S11]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/p_user.c#L146-L267
[S12]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/p_inter.c#L586-L773
[S13]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/p_tick.c#L35-L117
[S14]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/g_game.c#L733-L1325
[S15]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/i_system.c#L227-L294
[H15]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/src/internal__wasi-snapshot-preview1.c#L48-L67
[H15b]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/config.h#L94
[S16]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/i_video.c#L144-L327
[H16]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/doomgeneric.h#L7-L13
[H16b]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/i_video.h#L26-L27
[S17]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/st_stuff.c
[H17]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/d_items.c#L35-L59
[S18]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/doomgeneric.c#L12-L23
[H18]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/m_menu.c#L686-L738
[H18b]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/d_net.c#L68-L92
[S19]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/p_mobj.h#L193-L245
[H19]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/m_fixed.h#L25-L26
[H19b]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/tables.h#L78
[S20]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/m_random.c#L44-L58
[S21]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/f_finale.c#L39-L192
[S22]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/wi_stuff.c
[S23]: https://github.com/mikechao/doom-decisons/blob/ecdc4409613eeaea9f44adc1d84e53f7aec32d41/LICENSE
[H23]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/LICENSE
[S24]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/README.md
[H24]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/examples/browser/Makefile#L18-L39
[S25]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/m_menu.c#L1170-L1455
[H25]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/g_game.c#L631-L674
[S26]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/d_event.c#L25-L57
[H26]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/include/doomkeys.h#L52
[S27]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/g_game.c#L1337-L1465
[H27]: https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/p_mobj.c#L580-L606
[O1]: https://developers.openai.com/api/docs/guides/decisions
[O2]: https://developers.openai.com/api/reference/resources/decisions/methods/create
[O3]: https://developers.openai.com/api/docs/guides/images-vision
[L1]: https://freedoom.github.io/about.html
[L2]: https://github.com/freedoom/freedoom/blob/master/COPYING.adoc
