# Doom/WASM Control Contract Design

## 1. Purpose and Baseline

**Recommendation:** add an atomic, synchronous `stepOneTic(controlEpoch, commandSequence, heldMask)` for single-player controlled mode. Synchronize private engine input, retain `G_BuildTiccmd`, remove the scheduler's command backlog from this mode, and acknowledge at `P_PlayerThink` entry. Lifecycle preparation belongs to `advancePhase`; stepping refuses non-ready state. Keep five distinct operations but a 12-word production record, use sequence high-water only on admission, and return resumable `PENDING` for unfinished valid lifecycle work. Rendering is separate. This is a proposal for review, not implementation authorization.

Starting point: the committed [feasibility investigation](doom-wasm-feasibility-investigation.md), read in full. On 2026-10-08, root branch/HEAD is `main` / `75a52c7285738a4aa8f1767e2a779b684bddbf44`; HEAD gitlink, index gitlink, and submodule HEAD all equal **`31cc1af9656a8184830090c4e9f268383f5d7e15`**. Root `git status --short` and submodule `git status --short` both produced no output at revision start. This revises an already tracked document; historical provenance in the investigation remains unchanged. No gitlink change is proposed in this task.

**Evidence convention:** **SV** means existing source inspected in the actual pinned checkout; **INF** means a design inference or proposed requirement; **RH** means a runtime hypothesis requiring compiled evidence. Source citations never establish a repaired runtime contract. Proposed behavior, pseudocode, signatures, assertions, and statuses below are INF unless explicitly marked otherwise. There is still no `references/doom.wasm/build/` directory or browser WASM artifact. No build, installation, gameplay execution, or Decisions request was performed. The only repository change is this document.

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

An additional detail matters for acknowledgment: `P_PlayerThink:201–207` edits angle/forward/side for `MF_JUSTATTACKED` (chainsaw lunge). At lines 230–231 it can clear special buttons. Therefore “consumed command” means **the exact command delivered at player-think entry**, with the post-chainsaw command recorded only in test traces, before movement. It does not promise that every command field stays unchanged for the entire thinker. Do not remove this game rule to make an equality assertion pass. [Player consumption source](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/p_user.c).

### Other build/processing paths

- `tickGame -> doomgeneric_Tick -> TryRunTics` also updates sound and calls `D_Display` (`A/src/doom_wasm.c:45`, `E/src/d_main.c:369–381`). `TryRunTics:636–737` queries time, builds ahead, waits, and can run multiple engine tics.
- `D_Display:270` calls `NetUpdate`; **`R_RenderPlayerView` also calls it four times** (`E/src/r_main.c:723,729,734,739`). Render-only must suppress all of these, not merely avoid `tickGame`. [Renderer source](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/r_main.c#L713-L739).
- Initialization is active: `D_DoomLoop:399` calls `TryRunTics`, then line 416 calls `doomgeneric_Tick`. `D_DoomMain:1606–1613` can start a load or title. The zero-argument adapter selects title by default; a new controlled initializer must stop before implicit simulation.
- `RunTic` checks `advancedemo` before `G_Ticker`. `D_DoAdvanceDemo:452–519` changes usergame/phase and can defer demo playback; `G_DoPlayDemo` calls `G_InitNew` (`g_game.c:1890`), and `G_ReadDemoTiccmd` replaces installed input (`790–791`). Controlled gameplay rejects demos and demo recording.
- Menu skill selection defers a new game and clears menus during responder processing (`E/src/m_menu.c:M_ChooseSkill:717–725`). A call that starts in a menu can load within that call.
- `G_DoReborn:1091–1125`, `G_DoNewGame:1454–1465`, `G_DoWorldDone:1320–1325`, and `G_DoLoadGame:1344–1385` reach load/new-player work. Save loading restores players after base-level load; the barrier must cover the **whole** load action, not just base-map setup.
- Intermission and finale read `players[].cmd` directly (`E/src/wi_stuff.c:WI_checkForAccelerate:1252–1273`, `E/src/f_finale.c:F_Ticker:156–175`). They require deliberate phase controls; old fire/use must not continue them accidentally.

## 3. Guarantees and Internal Proof Obligations

### Readiness and one successful playable tic

P0 supports one local player, no netgame/drone/demo playback/demo recording, `ticdup == 1`, and keyboard controls only. Ready means initialized, `GS_LEVEL`, `usergame`, valid local player/actor, `PST_LIVE`, no menu/pause/advancedemo, `gameaction == ga_nothing`, and no unfinished preparation. `neutralRequired` constrains the mask but does not make an otherwise ready player non-ready. Enforce the predicate even though stock `P_Ticker` permits a menu tic when `viewz == 1` (`E/src/p_tick.c:98–110`, SV).

For request `(expectedEpoch=e, sequence=s, heldMask=M)`, let `T/L` be `gametic/leveltime` at the ready boundary, `K` the controlled effective keys, and `B` the native command:

```text
admission:            e == currentEpoch; s > admittedHighWater; valid M; ready
                      neutralRequired implies M == 0
prebuild:             K == M; excluded builder contributors inactive
build:                exactly one fresh G_BuildTiccmd(B, T)
pre-simulation:       epoch/readiness/player identity unchanged; no pending action
player entry:         one initially-live local P_PlayerThink; K == M
                      private tag == (e, s, T); actual installed command == B
completion:           one completed P_Ticker; gametic == T + 1; leveltime == L + 1
                      no load, second build, or second playable tic in this call
```

A pending exit or death during simulation may change the current epoch. It does not revoke the command already consumed in the old epoch. Finish the existing tick and its native continuation, then invalidate future input. Do not clear `players[].cmd` midway through the consuming thinker. A transition detected before simulation invalidates the build and returns zero engine/world/playable tics; lifecycle dispatch waits for `advancePhase`. A genuine mismatch at consumer entry is `FAULT`, not a recoverable transition.

**Production C checks remain mandatory**, independent of trace compilation: read back controlled keys prebuild and at entry; check exclusive builder contributors, saved command fields, private identity tag, actor/local-player validity and initial live state; count builds, player entries and completed world ticks; verify exact engine/level tic deltas before publishing `APPLIED`. Stop before the player body on a failed entry check. Check `P_Ticker` completed its actual body, rather than counting entry into a function that can early-return. `ST_Ticker`, `AM_Ticker`, `HU_Ticker` and outer increment also complete before success (`G_Ticker:865–885`).

Field equality covers all named `ticcmd_t` fields, not padding/checksums: `forwardmove`, `sidemove`, `angleturn`, `buttons`, `chatchar`, byte `consistancy`, `buttons2`, `inventory`, `lookfly`, `arti` (`E/include/d_ticcmd.h:30–49`, SV). Retain native consistency bookkeeping; unexpected chat/other-game fields or `BT_SPECIAL` are faults. These fields stay private. Tests additionally expose build/entry copies, contributor values, and post-chainsaw movement. Production entry comparison occurs before `MF_JUSTATTACKED` changes the command (`p_user.c:201–207`); later native changes are permitted, not foreign input.

Complete overwrite, no scheduler backlog, exclusive synchronous ownership, and guarded continuation enforce the ordering. Independent C boundary checks enforce delivery/completion. The assertion harness must independently validate expected native keyboard values and actual ticker hooks; an echo of the mask, a JS call count, or a post-call snapshot cannot substitute. Native momentum, collision, fire/use/weapon availability and `usedown` remain Doom-owned.

## 4. Lifecycle, Sequence Identity, and Rejection

### Identities and recommendation

| Identity | Owner and rule | Concrete protection |
| --- | --- | --- |
| `runId` | Worker wrapper: unique opaque token per instance, never reused; initialize once. C is inherently instance-bound. | Reject late messages/results from a terminated Worker even if epoch/sequence match a new one. |
| `controlEpoch` | C uint32, starts at 1; monotone across load, same-map replacement, death/rebirth, pending exit, phase and menu/pause control edges. | Intent cannot cross a lifecycle interruption or later return to an eligible state with its old epoch. |
| `commandSequence` | Worker allocates nonzero uint32 in increasing run order for each attempted live step. C keeps a private admission high-water. | At most one admission for any sequence; no replay of an admitted build, whether consumed or aborted. |

**Choose B: high-water on admission, before input overwrite/build.** Every zero-work rejection leaves C high-water unchanged. Consumption-only high-water is insufficient: a built-but-aborted request has already changed native builder history and must not be admitted again. Admission is a private point after epoch/mask/readiness/neutral checks; it is not public proof of consumption. Consume identity is recorded only at verified initially-live player entry.

For C: `s == 0` or `s <= admittedHighWater` is `BAD_SEQUENCE`; a fresh valid sequence becomes high-water only after every admission check passes. For the Worker: allocate at invocation, retire attempted identities on every returned result (including rejection), never retry an ambiguous call, and never rewrite an old request's epoch. C does not retain rejected requests or later execute them. TS validates integer/range before i32 conversion; C checks bit patterns too. A stale request using UINT32_MAX cannot exhaust C's counter. Worker numbering is owned locally, never taken from a remote response.

The safety invariant is **at most one admission per sequence plus no admitted command crossing its epoch**, not permanent blacklisting of every rejected spelling. A stale-epoch rejection can never become eligible because epochs do not return. A menu/pending rejection cannot become eligible after dismissal/preparation because those control boundaries change epoch. A same-epoch neutral rejection can become mask-eligible after a neutral tic, but the compliant Worker has retired it and that later tic has a higher sequence, so C rejects replay. A corrected bad mask with an otherwise fresh sequence is not an execution of previously rejected work: it is a new submission requiring all checks. C deliberately does not promise to blacklist arbitrary unadmitted input. If that stronger requirement becomes necessary, reconsider scope instead of quietly restoring spent-rejection policy.

### Alternatives and specific execution histories

Here `H` is C high-water; `e` is current epoch. C options include both epoch-scoped high-water and no C sequence.

| History | A: spend fresh structural rejection | B: spend admission (chosen) | C: epoch-scoped / no C sequence |
| --- | --- | --- | --- |
| Step `(e,7)` completes, identical call arrives again | Reject `7 <= H`. | Same; one admitted execution. | Epoch-scoped H also rejects; no sequence accepts another tic in the same epoch. Single ownership alone does not prevent a duplicated caller invocation. |
| `9` arrives before `8` in the same ready epoch | Admission of 9 makes 8 stale. | Same. Neither policy proves 9's observation is current; TS must reject obsolete context before invoking C. | Epoch-scoped H same; no sequence admits both. No option reorders messages or needs a queue. |
| Current epoch 4, stale `(3,UINT32_MAX)` arrives while H=6 | Spends maximum, forcing retirement despite no engine work. | `STALE_EPOCH`; H remains 6; `(4,7)` can proceed. Rejected epoch 3 never returns. | Epoch check rejects without needing sequencing. |
| Menu opens e=5→6; `(6,10)` rejected in menu; dismissal e=6→7 | A spends 10 unnecessarily. | H unchanged; exact rejected request remains stale at e=7; Worker uses a new sequence. | Epoch-scoped H safe if reset only on a real epoch change; no sequence still fails duplicate ready calls. |
| Same-map reload requested e=7→8; load e=8→9 | Map number cannot protect any option. | Step refuses pending work; phase loads; old `(7,s)`/`(8,s)` never admitted at e=9; neutral first is explicit. | Epoch-scoped is equally safe across load, but adds reset rules without shrinking the request/receipt. |
| Admissible `(9,12)` built; test hook requests load before entry, epoch→10 | 12 already spent. | Admission already set H=12; return `TRANSITION`, consumedValid=0. Replay 12 fails even if supplied with e=10. Phase owns subsequent load. | Epoch-scoped may reuse 12 only with the new epoch; must forbid retagging old intent in TS. No sequence relies entirely on caller retirement. |
| `(e,13)` finishes but response is missing/malformed | Replay blocked, but no proof that retry would recover the lost result. | Same. Compact ABI has no replay/cache recovery: dispose the uncertain instance. A snapshot is not a missing receipt. | Epoch-scoped blocks duplicates; no sequence may run twice if retried. All still need an ambiguity policy. |
| New Worker starts epoch=1/sequence=1 | C counters restart in a new instance. | Same; wrapper rejects old runId before C. | Same. No C counter can authenticate a previous Worker run. |
| Obsolete remote answer from an earlier same-epoch observation | High-water cannot reject it if TS assigns a fresh sequence. | Same; wrapper matches run/epoch/observation/request and retires superseded context. | Same; TS staleness defense is distinct from engine replay defense. |

Epoch-scoped sequencing is viable under strict run/epoch validation; it is not required here because run-global H is one scalar with no reset protocol. Removing C sequence could work only with a stronger non-replay caller guarantee; it makes the durable one-request/one-tic boundary dependent on every wrapper call site. Retaining one private scalar and two receipt identity words is a proportionate, specific replay defense. Phase calls remain explicitly serialized host operations with TS message deduplication; no generalized C sequence protocol is added for them.

No epoch or sequence wrap. At sequence exhaustion, retire the instance before another request; stale/malformed external numbers cannot force it. Before an operation could overflow epoch or signed engine tic/time counters, return `LIMIT_REACHED` with zero work and retire. Admission of the final permitted sequence may complete, then requires retirement. Do not claim counter exhaustion corrupts the engine; actual invariants failing are a separate `FAULT`. A conservative run tic ceiling must also keep derived timer milliseconds and retained engine arithmetic in range (§7); no permanent extra public counter is needed.

### Invalidation and neutral-first

- **Load:** invalidate at `G_DoLoadLevel` entry (`522–578`), before map/player replacement; mark neutral-required even for the same map. Keep the preparation barrier through the entire enclosing `G_DoNewGame`, `G_DoWorldDone`, or `G_DoLoadGame`. The last restores leveltime and unarchives players/world/thinkers/specials after base-map creation (`1344–1385`); there is no safe return at the base-map hook. Stock missing-reader/header rejection returns without a load (`1351–1359`), not automatically an invariant fault; P0 does not expose save/load UI operations.
- **Death:** hook local `PST_DEAD` assignment (`p_inter.c:617`), latch epoch/reason immediately, defer input/installed-command clearing until current simulation completes.
- **Rebirth:** recognize `PST_REBORN` set by dead phase consumption (`p_user.c:183–184`); phase preparation then calls the stock single-player `G_DoReborn` (`g_game.c:1094–1096`), which requests load. No phase call ticks its new live player.
- **Exit:** latch at `G_ExitLevel/G_SecretExitLevel` setting `ga_completed` (`1150–1163`), and reconcile pending actions/phase changes at the return boundary. Keep preparation isolated through completion/worlddone/finale actions; a pending exit is not yet intermission.
- **Menu/pause and other control edges:** epoch and reset on interruption/resumption, even without load. Observe responder changes inside `advancePhase`, plus end-of-operation state changes; ordinary read-only snapshots do not mutate epochs. A newly pending lifecycle action closes readiness immediately. Continuing an already pending chain is not itself an epoch increment unless it crosses another control boundary.
- **Restart:** dispose/recreate with new runId; never reinitialize this instance. Same-instance menu new-game uses the load barrier.

Reset future effective keys and excluded contributors (`next_weapon`, turn/double-click history, device buttons/deltas, pause/save sends); drain owned event work and clear borrowed `netcmds`/installed commands outside an executing world tick. Preserve `turnheld` across uninterrupted accepted live tics. Controlled mode never pumps `DG_GetKey`: gated legacy setters cannot populate adapter caches, so promoting/resetting its function-local cache is unnecessary for P0. The dormant scheduler ring is never read again; per-load ring reindexing is unnecessary in immutable controlled mode. Prove its exclusion rather than introducing a second command-lifetime protocol.

After every actual load, publish neutral input with no hidden first-player tic. First `stepOneTic(newEpoch,newSequence,0)` must itself build, consume and complete once; only successful `APPLIED` lifts neutral-required. If it dies/exits during that tic, preserve transition isolation and stop the batch. `G_PlayerReborn:947–949` initializes `usedown/attackdown=true`; a native neutral consumption clears interaction history. Do not force those flags false on input submission or overwrite flags restored by save load. Menu dismissal alone resets builder history without adding another mandatory neutral tic; an existing load-neutral requirement persists through menus.

## 5. Chosen Production API and Record

### Keep five operations; shrink their results

```c
// Proposed, not implemented. Pointer results are wasm32 i32 values.
const uint32_t *initControlledGame(void); // WAT: WASI init, controlled C init
const uint32_t *stepOneTic(uint32_t expectedEpoch,
                         uint32_t sequence, uint32_t heldMask);
const uint32_t *advancePhase(uint32_t expectedEpoch, uint32_t operation);
const uint32_t *getControlSnapshot(void);
void renderControlledFrame(void);
```

Initialization must establish immutable mode before engine setup and remove both implicit init ticker calls. Init returns a zero-tic record; first title-page setup may run `D_DoAdvanceDemo` without player/world execution. Step owns one ready playable tic. Phase owns preparation and at most one non-playable tic. Snapshot supports read-only inspection after init/waits; forcing a phase operation merely to read state would blur mutation ownership. Render is separately scheduled, using the existing frame import/dimensions. These responsibilities justify all five; fewer names would not simplify engine ordering.

Legacy hosts retain their path, but legacy init/tick/key calls are prohibited once controlled mode is selected. A busy guard covers all operations, including snapshots/render from imports. Reentry or mixed scheduling poisons controlled mode; abort the outer operation or trap, never let it later publish success. Callbacks may copy/log only. No acknowledgment callbacks, queue, allocator protocol, JSON, private player pointers, or raw engine offsets.

**Proposed ABI v1: 12 uint32 words (48 bytes), fixed indices, little-endian.** Enums get explicit stable numeric assignments in the future header/wrapper; C bool/enums/padding are never wire layout. All values are adapter copies.

| Word / type | Meaning and validity | Worker consumer / invariant |
| --- | --- | --- |
| 0 `abiVersion: u32` | 1 | Reject incompatible decoding. |
| 1 `byteLength: u32` | 48 for v1 | Bounds/layout check. Version/length are distinct compatibility and memory checks. |
| 2 `status: Status` | Per-operation outcome below | Completion vs rejection/preparation/fault; only APPLIED is successful live completion. |
| 3 `controlEpoch: u32` | Current epoch at return; 0 before init | Freshness for the next operation; may differ from consumed epoch. |
| 4 `phase: Phase` | Normalized current state below | Whether step is allowed or phase management is needed. No redundant eligible flag. |
| 5 `neutralRequired: 0\|1` | Current load-neutral obligation; persists while non-ready | Ready host chooses mask 0 until explicitly completed. |
| 6 `transitionReasons: bitset` | Reasons in this operation: LOAD, DEATH, REBIRTH, EXIT, CONTROL_EDGE, PHASE_CHANGE; 0 on pure rejection/snapshot | Explain epoch changes and stop an action batch; multiple intra-call edges may be coalesced. Not an event history. |
| 7 `consumedValid: 0\|1` | Verified initially-live host command entry in this operation only | Real delivery evidence; may be 1 on a later FAULT without completion. Always 0 on phase/init/snapshot. |
| 8 `consumedEpoch: u32` | Original entry epoch if word 7=1; otherwise 0/invalid | Join consumption to request even after death/exit changes current epoch. |
| 9 `consumedSequence: u32` | Actual private tag sequence at entry if word 7=1; otherwise 0/invalid | Match exactly the synchronous requested identity, never echo merely admitted input. |
| 10 `engineTics: u32` | Actual completed outer tic increments in this operation, normally 0 or 1 | Explicit phase/step work accounting; load does not count as a tic. |
| 11 `worldTics: u32` | Completed P_Ticker bodies in this operation, normally 0 or 1 | Distinguish dead-world work from menu/intermission/finale tics. |

`APPLIED` entails consumedValid=1, matching `(epoch,sequence)`, and engineTics=worldTics=1, checked in C before publication. No separate accepted/completed/playable flags or `APPLIED_TRANSITION`: compare current epoch to the supplied epoch and inspect reasons. A returnable FAULT may preserve verified entry and completed counters, but never claims successful completion; counts must be actual, not capped if an invariant detects excess. Invalid receipt combinations cause Worker disposal.

No public absolute `gametic/leveltime`, player index, masks, built tag, full command, source, high-water, last-consumed history, mission/map/flags, or debug counters. The Worker knows which operation/request it invoked; one fixed local player needs no index. Per-operation exact counts suffice for host accounting; C checks absolute deltas and tests trace them, including map resets. Identity `(epoch,sequence)` is unique without an extra consumed-tic scalar. Snapshot contains current phase/epoch/neutral, status READY/PENDING/INELIGIBLE (or NOT_INITIALIZED/FAULT/limit), and zeros for operation evidence/reasons/counts. It does not reconstruct a missing receipt.

The record is scratch storage valid until the next bridge call; copy immediately before render/snapshot/another step. Validate pointer alignment/bounds/version/length and recreate views after memory growth. A runId is attached in TS, never in C. Render emits a frame only at a published safe state; it returns no new receipt and never replaces consumption evidence. While work remains pending, skip drawing and retain the last completed frame; a snapshot/phase return exposes only normalized state. This avoids assuming every between-action intermediate state is drawable before Stage A proves display ownership.

### Phases and outcomes

Normalize with this precedence: UNINITIALIZED/FAULT; WORK_PENDING for unfinished supported action/rebirth/title preparation; MENU; PAUSED; TITLE_OR_DEMO for suspended attract mode; DEAD; INTERMISSION; FINALE; READY. In a user level, DEAD means valid local `PST_DEAD`; REBORN maps to WORK_PENDING. READY alone represents the complete readiness predicate. Missing actor/player in a supposedly prepared user level is a fault, not a false READY. Menu/pause overlays can hide the underlying phase; after closure/reconciliation the host receives the authoritative next phase. The Worker never decodes raw engine flags to decide readiness.

Supported dispatches are ga_loadlevel, ga_newgame, ga_completed, ga_victory and ga_worlddone; ga_loadgame retains a whole-action barrier if reached internally/tested, without a public save/load operation. ga_savegame and ga_screenshot are excluded from the controlled profile. `ga_playdemo` is deliberately suspended as TITLE_OR_DEMO rather than treated as resumable supported work; it never enters demo/player simulation. New-game menu selection may replace it. Unknown/out-of-profile actions cannot masquerade as PENDING. Saved pause stays suspended in P0; new-game/restart can leave it. Public quit/save/load UI is outside the supported menu script; do not automate arbitrary menu paths.

| Status | Applicable call / rule | Receipt / work |
| --- | --- | --- |
| `APPLIED` | Step completed all live invariants; current phase may have transitioned | consumedValid=1, engine/world=1/1. New epoch/reasons distinguish a consumed transition. |
| `READY` | Init/phase/snapshot ends ready | consumedValid=0; counts 0/0: supported readiness changes occur through responder/preparation work, then stop before a destination ticker. |
| `PENDING` | Phase exhausted local preparation budget with supported work still pending; snapshot reports that state | consumedValid=0; counts 0/0. Resume explicitly with advancePhase(currentEpoch,NONE). |
| `TRANSITION` | Step admitted/built but a legitimate control edge interrupted it before simulation; phase changed epoch and ends non-ready (newly requested work may remain; exhausted preparation takes PENDING precedence) | Step counts 0/0; phase may have non-playable counts. No live consumption. |
| `INELIGIBLE` | Step refuses non-ready state without work; phase/snapshot remains stably non-ready with no new epoch edge | Step counts 0/0; phase may report one non-playable tic. This is not an instruction to spin. |
| `NEUTRAL_REQUIRED` | Ready step with nonzero mask while obligation set | No admission/build/input change; all evidence/counts zero. |
| `STALE_EPOCH`, `BAD_SEQUENCE`, `BAD_MASK`, `BAD_PHASE_OPERATION`, `NOT_INITIALIZED`, `LIMIT_REACHED` | Pre-admission rejection | No engine work, input mutation, or C high-water change; all receipt evidence/counts zero. |
| `FAULT` | Actual invariant failure/invalid engine state; latched poison | Discard instance; preserve only verified partial evidence if returnable. Hang/trap may yield no record. |

Phase outcome precedence: FAULT/rejection, then PENDING if budget exhausted with supported work remaining, then READY if ready, then TRANSITION if epoch changed in this operation, otherwise INELIGIBLE. Counts convey ordinary phase progress; no PHASE_ADVANCED synonym is needed. A step refused because phase is WORK_PENDING returns INELIGIBLE, not PENDING: it performed no preparation. A snapshot reports PENDING without progressing it. Neutral-first is a mask obligation on READY, not another lifecycle phase.

### Complete gameplay mask

Bits 0–8: Forward, Backward, TurnLeft, TurnRight, StrafeLeft, StrafeRight, Fire, Use, Run. Bits 9–16: held weapon slots 1–8. Mask 0 is neutral. Reject unknown bits, opposite movement/turn/strafe pairs, or multiple weapon slots. Other combinations, including movement+turn+strafe+fire, are valid. No Alt, pause/save/menu/chat/cheats/weapon-cycle/device events.

The private helper overwrites the full keyboard array from the mask and reads controlled bindings back. Validate distinct in-range default bindings; exclude autorun sentinels (`G_BuildTiccmd:310–311`), low-res demo turning, double-click contributors and other devices. Do not rebuild to verify: the native builder mutates history. Held weapon requests use native slot/ownership rules; acknowledgment promises delivery, not a switch. Gameplay masks bypass responders; only phase UI taps use them.

### Phase operations

`advancePhase(expectedEpoch, operation)` has enum NONE, menu taps ESCAPE/UP/DOWN/LEFT/RIGHT/ENTER/CONFIRM, CONTINUE_DOWN, CONTINUE_UP, RESPAWN. Validate pairing and epoch before work. Pending preparation permits only NONE; no new UI event can replace a partially processed supported chain. Suspended attract demo still permits bounded new-game menu navigation.

- UI taps post at most two initialized down/up events through responders, no platform key scan or carried UI held cache. ESCAPE can open a menu from READY with zero world tics. After responder processing, clear any gameplay keys responders touched, reconcile epoch, prepare pending work, and stop if control becomes ready or a load completes. No arbitrary 256-key event replay into the 64-slot ring (`d_event.c:25–57`).
- NONE first resumes preparation. If preparation did work, publish its boundary with zero tics rather than also ticking the destination phase. Otherwise at most one menu/title, dead-world, intermission, or finale tic. A READY NONE returns READY with zero. Menu/pause calls never run a live P_Ticker, including the initial-view exception.
- Phase tick command is privately owned and zeroed, with BT_USE only for a permitted continuation/respawn. No G_BuildTiccmd and no host consumption receipt. CONTINUE_UP/NONE consume no buttons; continuation downs require an intervening consumed up interval for intermission edge logic (`WI_checkForAccelerate:1252–1273`). A preparation-only result did not consume a continue pulse; host checks counts and issues a fresh phase operation later.
- RESPAWN requires a dead valid player, no blocking menu/pause, and no pending work: one dead-world tick through P_DeathThink with BT_USE. It sets REBORN; return without reload dispatch. Later NONE calls prepare reload, stop before live simulation, and expose neutral-required. NONE dead tics use no earlier combat buttons.
- At most one non-playable ticker and no action dispatch after that ticker. If it requests new work (rebirth, exit, worlddone, advancedemo), publish that pending boundary and let the next phase call prepare. No loop runs until gameplay appears. Attract demo playback stays suspended; initial title page and bounded page/menu work are supported.

### Worker calling semantics

```ts
// Synchronous inside the sole Worker; outer messages carry runId/context.
let state = doom.snapshot();
if (state.phase !== "READY") return handleLifecycle(state);
const input = { expectedEpoch: state.controlEpoch,
  sequence: nextSequence(), heldMask: state.neutralRequired ? 0 : chosenMask };
const result = doom.step(input); // immediately copy its 12 words
if (result.status === "FAULT") return disposeRun();
if (result.status === "APPLIED") {
  assert(result.consumedValid && result.consumedEpoch === input.expectedEpoch);
  assert(result.consumedSequence === input.sequence);
  assert(result.engineTics === 1 && result.worldTics === 1);
  doom.render();
  if (result.controlEpoch !== input.expectedEpoch || result.phase !== "READY")
    return handleLifecycle(result); // consumed transition ends action batch
} else return handleRejectionOrLifecycle(result); // retire identity; never retry
// External waits call neither step nor phase. Snapshot/render cannot step.
```

Holding N tics means N fresh requests, each checked before proceeding, with neutral-first a distinct acknowledged step. Obsolete remote results are rejected by run/epoch/observation/request context before allocating/invoking a C request. Missing/malformed acknowledgment or trapped/timed-out call disposes the run; no automatic replay. Main-thread watchdog contains a blocked Worker. No TS implementation of Doom mechanics or engine-state offsets.

## 6. Source Ordering and Phase Ownership

**SV:** stock `TryRunTics` builds before `RunTic` and increments gametic afterward (`d_loop.c:653–728`); `RunTic` installs borrowed netcmds and advances demo before `G_Ticker` (`d_net.c:80–88`). `G_Ticker` handles REBORN (`738–741`), loops actions (`744–778`), installs commands/demo input (`780–828`), processes specials (`830–855`), performs intermission cleanup/oldgamestate update (`857–863`), then dispatches phase tickers (`865–885`). `P_Ticker` gates pause/menu, calls player thinking, then world thinkers/specials and increments leveltime (`p_tick.c:98–117`). `P_PlayerThink` edits chainsaw input before its DEAD branch (`p_user.c:201–211`).

**INF: choose separated ownership.** Factor the existing rebirth/action preparation and continuation for controlled mode; `advancePhase` alone invokes preparation. `stepOneTic` verifies no pending work and uses only installation/normal continuation. No event pump, mutable JS callback, or demo routine between build and entry. Retain M_Ticker once per live tic (SV: it only animates the menu skull at `m_menu.c:1607–1611`), and preserve ordinary HUD/automap/status work. Snapshot/render never prepare actions. Legacy G_Ticker still executes the same preparation, installation, housekeeping and simulation in its original order without the controlled budget/guards.

| Boundary example | Stock ordering / defect | Proposed ordering |
| --- | --- | --- |
| Transition before build: menu skill selects new game | `BuildNewTic` processes M_ChooseSkill (defer newgame/clear menu), then builds; G_Ticker loads before installing that command. | Only phase processes menu. Complete bounded newgame/load action, reset epoch/neutral, return zero tics. Step sees only already prepared state and requires neutral. |
| Pending reload exists at step entry | G_Ticker would load after build and continue P_Ticker. | Reject INELIGIBLE with no build/dispatch; phase owns reload. Pending action already makes readiness false even before load hook. |
| After-build/pre-entry transition fixture | Demonstrates why the last guard cannot be removed merely because there is one owner. | Detect pending action/epoch change, invalidate admitted build, clear future input/history, return TRANSITION with zero tics; no dispatch. Next phase prepares, never reuse that sequence. A command mismatch with no legitimate transition is FAULT. |
| Exit during live tic | `G_ExitLevel` sets ga_completed; current P_Ticker finishes; next G_Ticker dispatches completion. | Same gameplay ordering: APPLIED old consumed identity, new epoch/EXIT, one completion/increment; next phase dispatches completion without another playable tic. |
| Death during live tic, including held use | P_PlayerThink may die in a sector or later thinkers kill it; next dead think can set REBORN from use. | Finish killing tic and acknowledge old live entry. Future combat input reset; only explicit dead phase RESPAWN can supply use. Phase reload stops before new player. |
| Worlddone during intermission | WI_Ticker→WI_updateNoState→G_WorldDone can directly call F_StartFinale on selected commercial maps (`g_game.c:1298–1315`), rather than only defer an action. | Reconcile direct phase change at phase-tic return; preserve stock call, no nested live tick. Otherwise next NONE prepares ga_worlddone/load. |

This narrows stepping: no prebuild or after-build action dispatch chains. It **does not remove the G_Ticker split**. Calling stock G_Ticker with a promise that gameaction was initially empty is insufficient: it still owns dispatch/rebirth and can tick a loaded live player. Moving a copy of those branches into the adapter is not simpler. Reuse private preparation/continuation helpers, including state-change housekeeping. **RH:** localized factoring preserves oldgamestate/WI_End, init, rendering and save-load ordering in compiled WASM. Stage A must establish this; if it requires broad rewrites of simulation/player/WAD semantics, stop before expanding scope.

### Controlled ordering pseudocode (INF)

```text
step(e, s, mask):
  enter exclusive busy guard; reject poisoned/uninitialized/mixed mode
  validate integer mask/sequence; reject stale e before engine work
  reject s <= admittedHighWater; reject non-ready; reject non-neutral obligation
  preflight conservative epoch/tic/time retirement limits before mutation
  admittedHighWater = s                     // only here; never on rejection
  capture private T/L, actor identity; M_Ticker once; overwrite/read back keys
  G_BuildTiccmd once; save named fields and private (e,s,T) tag
  test-only after-build fixture may request a transition
  if legitimate pending action/control edge detected before simulation:
    latch/reconcile epoch + reason; invalidate build and future input/history
    publish TRANSITION, no consumed identity, engine/world=0/0
    return                                 // no action dispatcher in step
  install through controlled continuation; assert pre-P_Ticker readiness
  P_PlayerThink entry: verify live actor/epoch/tag/keys/all command fields
    record consumed identity from verified tag; mismatch => poison before body
  finish P_Ticker + normal G_Ticker continuation; increment gametic/virtual once
  check one build/live entry/world completion and T+1/L+1
  reconcile transitions; finish deferred input reset; clear borrowed netcmds
  if any invariant/poison failed: publish FAULT with verified partial evidence
  else lift load-neutral on successful neutral tic; publish APPLIED

phase(e, operation):
  guard; validate epoch and allowed operation/phase before any mutation
  preflight retirement limits; never alter gameplay sequence high-water
  process at most one allowlisted UI tap, if requested; reconcile control edges
  prepare up to budget complete units (rebirth/title/action), no command build
    only after each whole function returns: reconcile + state-change housekeeping
  if supported work remains and budget exhausted: publish PENDING, counts=0/0
  else if any preparation ran, a load finished, or UI made control ready:
    publish current outcome, counts=0/0; return without destination ticker
  else if ready or suspended demo/paused state: publish current outcome, no tic
  else run at most one permitted non-playable phase ticker with owned command
    guard out live player simulation even at viewz==1
    finish normal phase continuation; increment gametic/virtual once
    reconcile new work/direct phase change; finish state-change housekeeping
    publish current outcome and actual engine/world counts; never dispatch again
```

For a menu overlay, the permitted phase ticker is M_Ticker without a live world body; a title page may tick D_PageTicker, intermission WI_Ticker, finale F_Ticker, or a dead valid level P_Ticker plus normal level continuation. These are engine tics only when the controlled outer loop explicitly increments gametic/virtual time. UI taps/preparation alone never increment it. Menu/paused overlays must also suppress underlying intermission/finale continuation when that would consume a UI-only operation's input. Record phase-owned command installation/consumption in test traces; public consumedValid stays zero. Never call stock RunTic/G_Ticker and infer the permitted ticker ran from its void return.

### Safe resumable preparation boundary

**SV:** each switch dispatcher returns completely to G_Ticker's `while (gameaction != ga_nothing)` head. `G_DoCompleted` can set ga_victory and return before dispatching F_StartFinale (`1177–1202`); G_DoReborn can request load; newgame/worlddone execute load within their own dispatcher; G_DoLoadGame runs all unarchive/close work before returning. `P_SetupLevel` resets leveltime (`p_setup.c:704`); save restore can replace it afterward. The stock while loop has no dispatch budget and no default case for an invalid action.

**INF:** the safe resumable boundary is **after a whole supported dispatcher returns, and after required state-change bookkeeping**, before another action/command install/ticker. No C stack, half-unarchived map, callback, or partial function is suspended. Factor `WI_End` and oldgamestate update (`G_Ticker:857–863`) so a published intermission departure is cleaned exactly once; never publish new state while retaining an invalid old intermission resource lifetime. There must be no player/world ticker to make publication safe. Pure snapshot exposes normalized state only; pending rendering is skipped. **RH:** the action-return boundary plus housekeeping is sufficient for supported assets and retained draw/init ownership; it is not yet a runtime guarantee.

Use a private per-phase-call budget of eight completed preparation units; charge local rebirth preparation, bounded title advancement, and each action dispatch, so neither rebirth nor title work evades bounded accounting. Do not rerun G_DoReborn on every resume while ga_loadlevel is already pending. Prefer existing gameaction as continuation state, with at most one private rebirth-prepared latch if needed. Suspended ga_playdemo is not dispatched. After preparation units, no destination phase ticker in that call. If supported work remains at budget exhaustion, clear future command validity, return PENDING at the safe boundary, phase=WORK_PENDING, current epoch/neutral and accumulated transition reasons, engine/world counts=0/0, and permit only subsequent NONE preparation. Count value resets per call; gametic/virtual time do not advance for map setup. Epoch changes only at actual control edges, not each PENDING poll.

A non-playable phase ticker may itself request work; it returns TRANSITION (with phase WORK_PENDING and actual tic counts), not budget-exhaustion PENDING. Snapshot then reports PENDING; the host sees the same resume requirement. READY says a command may be submitted (subject to neutral); INELIGIBLE says stable phase management is needed; TRANSITION reports a boundary this operation crossed; PENDING reports unfinished bounded preparation. Current phase/epoch drive resumption, no continuation token/action queue or raw gameaction export.

Local progress means a preparation unit completed atomically, or one permitted phase tic completed; returning from one unit does not prove global termination or meaningful state change. Eight dispatches bound each returning call, not time inside G_DoLoadLevel or thinker loops. Host/harness caps consecutive phase calls/total work and elapsed time; diagnose repeated unchanged action/phase/epoch with test traces, optionally stop for no progress. Do not fault merely because an action value repeats: it may represent valid work. No-progress detection and total-work caps are host policy/test failure, not automatic C poison for valid unfinished work. Each call still has a main-thread deadline; trap/hang returns no successful PENDING.

Poison only on actual broken invariants: unknown action/state enum; unsupported active net/demo/multiple-player mode; missing actor in a prepared user level; command/key/tag mismatch; extra build/entry/tick or wrong counter delta; phase entering a newly live player; unsafe reentry/mode mixing; load returning an inconsistent/unrestored state. Unsupported menu operation is BAD_PHASE_OPERATION before mutation. A known but prohibited action reaching internal dispatch unexpectedly is a mode invariant failure; deliberate attract-demo suspension is exempt. Routine budget exhaustion, a refused mask, or ordinary missing save reader is not corruption. FAULT is sticky; no recovery claim on the same instance.

## 7. Timing, Rendering, and Compact Future Observation

### Exact external timing

SV: TryRunTics samples time before singletics, can build ahead/wait and executes a counted batch (`d_loop.c:636–737`); non-multiplayer sets new_sync=0/ticdup=1 (`404–414`). NetUpdate returns in singletics (`201–202`), but neither that flag nor its comment fixes lifecycle-after-build ordering. D_Display's polling wipe remains (`d_main.c:278–295`).

INF: dedicated controlled loop bypasses TryRunTics, scheduler queues, polling, catch-up and TicdupSquash. Make NetUpdate a mode no-op at its central definition, covering D_Display and all four renderer call sites. Controlled engine virtual tics increment exactly once with each reported outer engine tic, including allowed non-playable phase tics; no clock changes from reads/rejections/preparation/render/waits. I_GetTime returns that integer directly; I_GetTimeMS/DG_GetTicksMs derive floor(1000*tics/35) in wide arithmetic. Explicit timer baseline avoids legacy zero-basetime behavior (`i_timer.c:34–72`). Retire conservatively before signed tic/millisecond arithmetic overflows; do not merely wait for uint32 sequence exhaustion.

Render draws completed published state once through the frame import, bypassing both wipe setup and polling loop while maintaining destination redraw/palette bookkeeping (`d_main.c:179–184,228–256,278–295`). Skip pending/poisoned states. It does no input scan, native command build, phase preparation, player/world simulation or time advance. Display bookkeeping need not be bitwise pure. **RH:** destination redraw/palette bookkeeping must be proved; stock drawing gates on gametic (`186–225`). A complete initial level view before the explicit neutral tic is not required: if unavailable, retain the prior frame until that acknowledged tic rather than silently prime simulation or broaden renderer changes. No sound/music work is needed for the proof. Waiting 2s or 10s invokes no simulation/phase operation and creates no catch-up. Freeze-on-read inside unmodified polling code and increment-on-read clocks are both rejected.

### Health and what “game over” means

This is a source-backed scope check, not authorization for a game-state SDK.

| Semantic distinction | Pinned SV signal / location | Small observer interpretation (INF, deferred) |
| --- | --- | --- |
| Live vs dead awaiting respawn | `PST_LIVE/DEAD/REBORN`, `d_player.h:43–51`; `P_KillMobj` assigns DEAD at `p_inter.c:617`. Player health mirrored/clamped at `753–755`; actor health may be negative. | DEAD is both death animation and waiting for optional respawn; there is no distinct engine “animation finished, now game over” flag. Read health only for a validated player/level. |
| Respawn requested / reborn | `P_DeathThink:183–184` sets REBORN on BT_USE without a live usedown edge; `G_DoReborn:1094–1096` reloads single-player level. `G_PlayerReborn:947–949` / `P_SpawnPlayer:589–606` restore LIVE. | RESPAWNING means requested/preparing replacement, then PLAYING under a new epoch; REBORN is not a permanently finished run. |
| Exit / map transition | `G_ExitLevel/G_SecretExitLevel:1150–1163` set ga_completed. `G_DoCompleted:1286–1292` enters intermission; episode map 8 instead queues ga_victory (`1186–1189`); Chex map 5 exception (`1180–1183`). | TRANSITIONING precedes committed INTERMISSION/FINALE or another map; map completion is not campaign completion. |
| Intermission | `GS_INTERMISSION`; `WI_checkForAccelerate:1252–1273` uses fire/use edges, stats wait at `1204–1211`, `WI_updateNoState:643–653` calls worlddone. | INTERMISSION requires deliberate host phase control, never stale combat input; zero health does not determine it. |
| Finale | `F_StartFinale:104–144` sets GS_FINALE; `G_WorldDone:1304–1315` also selects it after commercial maps 6/11/20/30 and secret exits 15/31. | FINALE alone cannot say terminal: map-6 narrative still continues the campaign. |
| Engine progression ending | `F_Ticker:159–192`: commercial button after >50 tics goes worlddone except map 30 starts cast; noncommercial text progresses to artwork. `F_CastTicker:326–331` cycles cast indefinitely. | No universal completed flag or engine shutdown. Stock noncommercial episode end and commercial map-30 ending can satisfy a declared objective, but the engine remains runnable/menu-accessible. |

[Death/damage source](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/p_inter.c#L611-L618), [finale progression](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/f_finale.c#L104-L192), [intermission continuation](https://github.com/jacobenget/doom.wasm/blob/31cc1af9656a8184830090c4e9f268383f5d7e15/doomgeneric/src/wi_stuff.c#L1204-L1273).

**Recommendation:** no health/terminal fields or observer export in P0. Reserve the idea of a separate compact post-tic observation after exact stepping passes; reserve no unused production words. A future AI-facing `{health: i32|null, state: SmallState}` can suffice if SmallState distinguishes PLAYING, SUSPENDED/TITLE, DEAD, RESPAWNING, TRANSITIONING, INTERMISSION, FINALE and an objective-specific COMPLETE. Nullable health avoids another validity flag or misleading retained/default health outside a player level. COMPLETE is a latched host/product objective result, not a synonym for DEAD or GS_FINALE. The minimal two-field idea works only with this richer state and a declared objective.

A single boolean gameOver fails precisely for death followed by respawn and for Doom II map-6 finale followed by map 7. If ending recognition is later required, choose verified asset/mission/episode/objective semantics: e.g. one-map exit, one noncommercial episode's victory path, or stock commercial map-30 ending. Detect at authoritative C lifecycle hooks using private mission/map context; latch completion for that run/objective. An arbitrary custom WAD has no universal terminal rule. No terminalReason field is needed until multiple product termination reasons must be distinguished; STOP/FAULT remain service outcomes, not engine victory. Do not enlarge this design with ammo/position/enemy/objective telemetry.

The Worker still requires current epoch, normalized readiness, neutral obligation, and actual consumption/completion receipt even if the model sees only health and state. AI-facing observation and control-plane ABI have different consumers; compressing the model prompt does not eliminate engine lifecycle isolation. Asset compatibility/objective interpretation is unresolved until an asset route is chosen; that choice is separate from proving one tic.

## 8. Prospective Source Changes

**No patches in this task.** These are future minimum responsibilities, all restricted to controlled-mode input/timing/lifecycle plumbing. Existing C structs remain private.

| Repository-relative file(s) | Symbols / proposed responsibility |
| --- | --- |
| `references/doom.wasm/src/doom_wasm.c`, `src/doom_wasm.h` | Controlled initializer/export wrappers; mask/sequence validation; exclusive legacy-input gating; immutable mode and reentrancy guard; 12-word record ABI and C-owned acknowledgment storage; virtual `DG_GetTicksMs`; gate legacy keys/tick in controlled mode. |
| `references/doom.wasm/doomgeneric/src/g_game.c`, `doomgeneric/include/g_game.h` | Private key overwrite/readback helper; clear builder contributors; factor reusable `G_Ticker` preparation/continuation and intermission cleanup; phase owns bounded preparation; one native build and tagged installation; load/death-rebirth/exit generation coordination; `G_DoLoadLevel`, `G_DoLoadGame`, `G_DoReborn`, exits/newgame/worlddone barriers. Own normal builder history. |
| `references/doom.wasm/doomgeneric/src/d_loop.c`, `doomgeneric/include/d_loop.h` | Bounded exact controlled operation, engine-tic accounting, permanently bypass command-ring scheduling, explicit controlled `NetUpdate` no-op, forbid scheduler-mode mixing. One active command tag, not per-ring-entry metadata or a new queue. |
| `references/doom.wasm/doomgeneric/src/d_net.c` | `RunTic`/loop callback wiring: separate controlled preparation/demo handling and propagate zero/one-tic outcome. Keep legacy callback behavior; allow a small private callback extension in `d_loop.h` rather than duplicating the entire dispatcher. |
| `references/doom.wasm/doomgeneric/src/p_tick.c` | `P_Ticker` controlled pre-simulation guard and world-ticker completion count. Phase mode explicitly prevents a live tick despite menu initial-view exception. |
| `references/doom.wasm/doomgeneric/src/p_user.c` | `P_PlayerThink` entry assertion/authoritative command copy; check command equality at entry in production; capture chainsaw adjustment and trace use edges only in test builds. No rewriting of movement/use/weapon rules. |
| `references/doom.wasm/doomgeneric/src/p_inter.c` | `P_KillMobj` local-death hook/latch at `PST_DEAD`, deferred reset if command is already consuming. Health getter is unnecessary. |
| `references/doom.wasm/doomgeneric/src/d_main.c`, `doomgeneric/doomgeneric.h` | Controlled init without implicit `TryRunTics`/`doomgeneric_Tick`; bounded title/menu processing ownership; render-only entry; controlled wipe bypass and correct redraw bookkeeping. |
| `references/doom.wasm/doomgeneric/src/i_input.c`, `doomgeneric/include/i_video.h` | No required patch if controlled mode never calls the platform key pump. Synthetic menu taps provide initialized character data. A shift/cache reset is needed only if that pump is retained, which is outside the preferred P0 route. |
| `references/doom.wasm/doomgeneric/src/i_timer.c`, `doomgeneric/include/i_timer.h` | Integer virtual-time branch and explicit baseline setup; legacy host timing preserved. |
| `references/doom.wasm/src/wat/merge-two-initialization-functions-into-one.wat` | Add `initControlledGame` wrapper that calls WASI initialization before controlled C initialization; prohibit both initializers in one instance. No WAT control constants required: mask values are public schema constants. |
| `references/doom.wasm/src/reachability_graph_for_wasm-metadce.json`, `Makefile`, `doom.wasm.interface.txt` | Preserve new exports in allowlist; include engine headers for adapter compile (`Makefile:240–245` currently lacks `doomgeneric/include`); verify merge ordering and regenerate final interface description. No dependency upgrade. Licensed embedded-asset replacement, if selected, is a separately explicit build requirement. |
| Future root TS Worker wrapper and small browser test harness (paths to be agreed) | No TS app/package exists today. Own run identity, sequence issuance, ABI decoding, synchronous serialization, phase script, frame copying, main-thread heartbeat/watchdog, and log assertions. Do not pretend these are existing files. Test-only lifecycle fixtures/hooks remain out of the production allowlist. |

`r_main.c`, `wi_stuff.c`, `f_finale.c`, `p_setup.c`, and `p_mobj.c` provide traced behavior but need no mandatory changes: central `NetUpdate` suppression covers the renderer; phase commands use existing intermission/finale tickers; load hooks plus entry identity checks cover player replacement. Revisit only if executable proof finds an uncovered transition. Avoid new shared global callback machinery when a private helper/callback extension suffices.

## 9. Runtime Proof-of-Concept Test Plan

### Bounded execution plan after authorization

One compiled-WASM harness in a browser Worker, one fixed build/hash, one provenance-verified compatible IWAD plus at most one tiny licensed fixture PWAD, fixed skill/maps. No Decisions/API client or public UI. Cap each case at 2,000 engine tics and 4,000 phase calls (including zero-tic preparation), each WASM operation at a main-thread watchdog deadline of 2s, and the post-build suite at 5 minutes. A limit exceeded is failure with the last authoritative record, not an infinite retry. Build time is separately bounded/recorded after checking tool availability; no build-time estimate is runtime evidence.

After authorized implementation: inspect final WASM exports/imports, verify only approved production exports remain, load assets before synchronous init, run cases below, and save machine-readable traces plus a brief acceptance report. Use test-only fixtures for lethal damage, same-map reload, and exit requests to avoid relying on AI skill or long play. They must call normal engine paths (`P_DamageMobj/P_KillMobj`, pending load, `G_ExitLevel`), not manually bump counters. Hook triggers at named boundaries: before preparation, after build/before player entry, inside player/world simulation. Keep injection points separate from production assertions; fixtures must not increment counters or synthesize success receipts. Production ABI excludes these hooks. A fixture that requests a transition after build tests the final guard; the step must invalidate and return without dispatching that action. Only a later phase call may prepare it. Add a test-only budget override (e.g. one dispatch) to expose real chained-action `PENDING` boundaries without inventing new production actions.

### Instrumentation before build and at consumption

In an assertion-enabled compiled WASM, record these stages: request validation; prebuild effective input; postbuild command/tag; post-lifecycle invalidation; player-entry command/tag/effective mask; initial-rule command adjustment; world-ticker completion; operation return. Store a small bounded per-operation trace in C and retrieve it **after** return; no reentrant JS callback at mutable simulation boundaries. Saturation is test failure. The production acknowledgment remains a fixed single-operation record.

Every trace joins `(runId, expectedEpoch, epochAtStage, epochAfter, requestedSequence, consumedSequence, requestedMask, effectiveMask, gameticBefore/after, leveltimeBefore/after, engine/world/playable counts, phase/flags, mission/episode/map, player index/state, build and entry command fields, invalidation reason/count, internal admission high-water, action budget/dispatch count, publication boundary)`. Also trace native builder contributors/configuration/history, private command/actor identity tags and their validity, virtual tics/milliseconds, rebirth-preparation state, and WI_End/oldgamestate ownership. Include `usedown` before/after and test-only use-attempt counters for the use case; include RNG/game-state digest in the replay case. These are diagnostic test values, not a new production observation API.

Assert before build and at player entry; never rely solely on a post-call key mask. Verify fresh tags and all named command fields through actual installation. Expected-command checks for pinned default controls include neutral movement/buttons, normal forward=25, backward=-25, run forward=50, normal strafe magnitude=24, slow-turn magnitude=320 for the first five held turn tics, then normal=640 (run=1280), and `BT_ATTACK/BT_USE`. Verify values/signs from `g_game.c:149–151,315–347` at implementation time. Chainsaw override is separately tested/flagged, not treated as stale host input. Test counts come from actual thinker/ticker hooks; exported call count is insufficient.

| Case | Compiled-WASM procedure | Required evidence / pass criterion |
| --- | --- | --- |
| 1. Compound release | Consume forward+fire, then mask 0. | Both keys false before the next build and at entry; fresh neutral command delivered; one engine/world/playable tic. Residual momentum is allowed. |
| 2. Compound replacement | Consume forward+fire, then backward. | Forward/fire false and backward true at both boundaries; forwardmove=-25 and no attack; no intervening partial command. |
| 3. Menu/start ghost | Hold gameplay request, open menu, submit it while ineligible, navigate new game, and hold menu arrow on legacy cache in a test fixture. | No playable entry in phase/menu/load calls; epoch invalidated, events/keys reset and adapter caches remain bypassed (including the held legacy-cache fixture); old request rejected. First new-map playable request is an acknowledged neutral tic; later fresh forward works. Also test menu dismissal without load. |
| 4. Death/rebirth/restart | Damage inside a live step, including while use is held; submit old request; explicit dead neutral then respawn phase operation, process load; fresh instance restart. | Killing tic returns `APPLIED` with old consumed identity, new epoch, and `DEATH` reason. Old request cannot drive dead/reborn/new player; dead use belongs only to explicit PHASE command. New run rejects old Worker messages; first live tic neutral. |
| 5. Same-map reload | Defer reload before preparation with a pending gameplay request; also inject transition after build. | Map ID identical but epoch changes. Step refuses the pending reload without dispatch/build; phase loads with zero engine/world/playable ticks. An after-build interruption returns `TRANSITION` with absent consumed identity; its admitted sequence remains spent, then phase performs the load. Old epoch fails; next live tic neutral. |
| 6. Exit/intermission/next map | Exit inside a step, then phase tick/continue down-up pulses, next-map load. | Exit-triggering step consumes once in old epoch; no old fire/use progresses intermission. No phase operation ticks new live player; new-map load barrier and neutral-required visible. |
| 7. Intra-call transition | Menu event selects new game; after-build test hook requests reload; live world hook causes exit or death. | Menu start yields READY with load reasons (or PENDING if budget-limited), and after-build abort yields TRANSITION; both have zero playable ticks and explicit invalidation; last yields exactly one playable tic plus transition. `consumedValid`, identity, status and counts agree; no public accepted/build flags. No `APPLIED` with zero or phase call with a playable entry. |
| 8. Use edges | After initial neutral, consume use, neutral release, use again; choose a repeatable use fixture and instrument `P_UseLines`. | Release command actually reaches live player and clears `usedown`; next press attempts use once. Consecutive held-use tics produce no extra attempt. No physical door outcome assumed. |
| 9. Wait independence | Two fresh runs, same init/menu/render schedule and scripted masks; insert 2s vs 10s waits at one equivalent boundary with no step/phase calls. | Snapshot/gameplay digest unchanged during waits; next request always one tic. Compare all normalized authoritative traces (omit runId/wall timestamps), commands/RNG/world state per step; no catch-up. Keep render schedule equal because display bookkeeping may affect non-gameplay state. |
| 10. Worker containment | Main heartbeat every 50ms while cases run. In a dedicated instance trigger a controlled hang, then trap. | Normal steps leave heartbeat running (no attributable gap >250ms). Main watchdog terminates hang at 2s, flags error within the next 250ms, ignores late results, and can create a new run. Trap handled as fault/disposal; no fake consumption acknowledgment. Never rely on a timer inside the blocked Worker. |
| 11. Rejection/render discipline | Unknown bits/conflicts, duplicate/out-of-order sequence, stale epoch, mask!=0 after load; render repeatedly with clock fixed. | All specified rejections execute zero tics/builds/entries and no input mutation; admission-only high-water unchanged on rejection. Include stale UINT32_MAX, menu dismissal, missing acknowledgment disposal, and after-build abort/replay. Force budget=1 on episode-end `ga_completed -> ga_victory`: first phase returns `PENDING`, snapshot reports work pending, subsequent NONE resumes without tics. Exercise intermission-to-map and intermission-to-finale departure at budget=1 to check WI_End exactly once; these need not produce PENDING if their single whole dispatcher completes. Harness total-work timeout fails the case without requiring C to poison valid work. Render changes no input, command provenance, epoch, game/world/playable counters, or virtual time; builds remain zero despite renderer NetUpdate call sites. |
| 12. Native semantics | Hold turn for seven tics, neutral, turn again; request an unavailable weapon slot; chainsaw-lunge fixture. | Builder acceleration/reset matches expected history; unavailable weapon request still has correctly built/consumed BT_CHANGE without promising switch; entry command and documented chainsaw override are distinguished. |

**Suite failure:** any successful zero/multi-tic operation, pre-entry identity mismatch reaching `P_PlayerThink`, stale phase/gameplay command reaching a new player, hidden new-map tic, release mismatch, unexplained command mutation, wait-dependent authoritative trace, blocked UI, or missing transition result. Expected ineligible/transition zero counts are successes only when status, phase, consumption validity, and hooks all corroborate them. A world tic with dead player is explicitly non-playable; `leveltime` alone cannot classify it.

### Toolchain and asset prerequisites

The earlier design recorded Python 3, Docker CLI, Make, curl, Git, and clang on PATH; this revision does not revalidate that environment inventory. Docker daemon access, SDK image availability, versions, architecture support, and browser automation dependencies were **not exercised**. That earlier inventory did not find `wasm-opt`, `wasm-merge`, and `wasm-metadce` on PATH; the upstream build actually uses local `.binaryen/bin/wasm-as`, `wasm-merge`, and `wasm-metadce`. Read-only path checks in this revision found `.binaryen`, both `.dev_virtualenvs/python_virtualenv` and `rust_virtualenv`, `build/`, and browser `assets/doom.wasm` absent; no daemon, toolchain, or dependency setup is exercised. There is still **no compiled-WASM proof**. Recheck availability and record versions only in an authorized Stage A.

Future build needs upstream's Python environment, Docker WASI SDK 24, Binaryen 119 and CMake/native compiler/Make for its local build; Git SSH access is currently assumed by the Binaryen clone recipe (`Makefile:128–142`). Rust is used by the interface-description utility, not by the C gameplay contract. Confirm architecture support and any minimal alternative tool setup before installing; record tool/image/assets hashes. The existing command is `make -C references/doom.wasm all`; it has download/install/build side effects and was **not run**. Final module needs export inspection after WAT merging/dead-code elimination, not just a successful C compile.

Asset/distribution prerequisites remain those documented in the [feasibility investigation](doom-wasm-feasibility-investigation.md#3-current-dependency-and-licensing): choose provenance-verified compatible assets with their notices and matching engine source/build materials, plus a licensed fixture. This revision makes no new external licensing determination. Do not assume modern Freedoom map compatibility until exercised in this port. The checked-in Freedoom WAD's release provenance remains unresolved. The default build downloads and embeds shareware `DOOM1.WAD` (`Makefile:174,258–269`); passing a replacement at runtime does not remove embedded bytes. Approve removing/replacing that fallback for a distributable Freedoom-only POC, or establish exact permission for the embedded shareware package. No public asset redistribution is authorized by this design task.

## 10. Tradeoffs, Remaining Gates, and Stage A Decision

### Decision matrix

| Question | Recommendation | Source evidence (SV) | Alternative rejected | Residual uncertainty |
| --- | --- | --- | --- | --- |
| Durable ABI / acknowledgment | Five operations, 12-word current-state/operation receipt; always-on C boundary checks; trace internals test-only | Input/build/install/entry are distinct (`doom_wasm.c:123–142`, `g_game.c:291–517,738–788`, `p_tick.c:98–117`, `p_user.c:190–207`) | Exporting masks/full commands/raw flags/debug clocks/history; combining unrelated operations | **Stage A/B RH:** final compiled hooks/exports and exact completion checks. Small receipts do not prove C checks exist; executable traces must. |
| Sequence and rejections | Private run-global H on admission, including pre-entry aborted build; no spending on zero-work rejection | Builder mutates turn/chat/device history (`g_game.c:315–321,379,412,474`); menu/load alter eligibility (`m_menu.c:717–725`, `g_game.c:522–578`) | Spent stale/malformed requests; consumption-only H; no C replay check. Epoch-scoped H viable but no simplification here | Wrapper must retire unadmitted requests and authenticate observation/run context; no recovery for a lost receipt. Future compiled replay/abort tests required. |
| Lifecycle budget | Resumable PENDING after complete dispatcher + housekeeping; host caps total work/time | `G_Ticker:744–778,857–863`; `G_DoLoadGame:1344–1385`; actual completed→victory chain (`1186–1189`) | Budget exhaustion as automatic FAULT; suspension inside load; bounded budget as global termination proof | **Stage A RH:** publication/cleanup safe between actions, including WI_End and nested load completion. Individual dispatch still can trap/hang. |
| Phase owns preparation | Yes; step refuses pending state, final pre-simulation guard aborts without dispatch | Build-before-actions defect (`d_loop.c:138–181`, `d_net.c:80–88`, `g_game.c:738–788`); exit deferral (`1150–1163`) | Two preparation passes in step or copied adapter dispatcher; calling stock G_Ticker as a supposedly pure continuation | **Stage A RH:** local helper factoring preserves legacy init/display/phase semantics. Stop if broad simulation restructuring is necessary. |
| Health / terminal scope | Defer public observer; later nullable health + small state, objective-defined COMPLETE | DEAD→REBORN→reload (`p_user.c:183–184`, `g_game.c:1094–1096`); narrative vs ending finale (`f_finale.c:159–192,326–331`) | health=0 or any GS_FINALE as boolean gameOver; broad observation SDK | Asset/objective choice required for terminal recognition; P0 needs no such field. |

### Scope and feasibility risks

P0 is the controlled input/step/lifecycle/render bridge and bounded Worker proof, not Decisions integration or product deployment. Map identity, health, ammunition, position, enemies, metrics, general observation SDK, graceful shutdown, audio and smooth spectator scheduling are not new requirements. Private player validity/death recognition is necessary; exporting player/map internals is not. Legacy quit/fatal paths remain containment cases (`i_system.c:227–294`, `internal__wasi-snapshot-preview1.c:48–67`, SV), not a recoverable PENDING path.

Remaining proof obligations are concrete:

- Factoring G_Ticker must preserve command installation, special-button handling, intermission resource cleanup, oldgamestate, HUD/automap/status tickers, and complete enclosing load actions. Supported phase preparation must reach a safe zero-tic publication boundary. The split is a feasibility risk, not an existing engine feature.
- Init skips implicit simulation without leaving graphics/title/view initialization unusable. Render never builds through NetUpdate, draws safe destination frames without wipe setup/polling, and skips pending work. No hidden neutral tic may be used to repair initialization or view state.
- All control edges, including same-map load and direct finale changes during intermission, must invalidate before future command entry. After-build legitimate transition must abort before P_Ticker; arbitrary mid-world reload is not supported recovery and is a fault. Compiled fixtures must preserve normal death/exit paths and not invent mid-world replacement as valid gameplay.
- Compiled always-on checks and test-only traces must agree; optimized/release WASM must preserve only approved production exports and no fixture entrypoints. Fault counts reflect actual partial completion; no success follows merely from command installation.
- Budget-resume tests must show no repeated rebirth dispatch, partial save restore, duplicate WI_End, hidden phase player tick, or input leak. A real chain must work when the test budget is one, even if ordinary supported chains fit eight. Global work limits remain harness/host policy.
- Wait-independence is within one build/assets/script, not cross-build/platform deterministic replay. Compare command/RNG/gameplay traces with identical render/phase schedules. Main-thread watchdog contains an unreturning call; it cannot prove an instruction/time bound inside each engine function.

A failure requiring broad changes to thinkers, player mechanics, WAD progression or a generalized continuation framework is a **stop gate**. Report it and revise feasibility before enlarging Stage A. Direct host-built ticcmd injection is not an authorized fallback: it would need a new native-semantics review. A narrower fail-closed preparation policy is acceptable only if compiled evidence disproves safe resumable publication; do not silently replace PENDING with FAULT because normal testing used short chains.

### Staged roadmap (future, separately authorized)

| Stage | Work and exit evidence | Scope boundary |
| --- | --- | --- |
| **A — compiled-WASM exact-stepping proof** | Choose legal/compatible asset and bounded build route; produce/hash real WASM; use test-only build/entry/world/action traces to prove init/render zero tics, one ready tic, G_Ticker preparation/continuation ordering, phase barriers, and resumable action boundary (including WI_End). | A local experiment with minimal hooks, not authorization to implement the entire durable ABI or expand simulation semantics. Stop/report factoring or asset incompatibility. |
| **B — atomic mask and actual consumption acknowledgment** | Complete overwrite/readback and native builder exclusions; production C entry/command/tag and completion checks; compact result layout and final export inspection. | No public test trace or duplicate TS encoder; do not turn A instrumentation into permanent ABI fields. |
| **C — lifecycle isolation and neutral-first** | Full epoch/reset hooks, admission replay rule, same-map/intra-call transition isolation, dead/respawn/menu/intermission/finale phase policy, explicit acknowledged load-neutral tic. | No hidden live phase tick or reinit/recovery of a faulty instance. |
| **D — twelve compiled-WASM acceptance cases and durable results report** | All twelve §9 scenarios with adversarial fixtures, budget-resume coverage, two wait scripts, watchdog/heartbeat and export verification; save machine-readable traces, hashes and report. | Scenarios here are future requirements, not tests run by this document task. Decisions remains deferred until the proof passes and is separately authorized. |

### Implementation Authorization Checklist — before Stage A

- [ ] Approve **Stage A only** as a bounded compiled experiment, with the proposed phase-owned preparation and stop gate if local factoring is insufficient. This design revision authorizes no code/build/download activity.
- [ ] Select provenance-verified compatible IWAD/fixture assets and resolve default embedded shareware fallback by permitted replacement/removal or established permission for that package. Approve the specific build/tool setup, downloads/installations, resource/time limits and artifact/hash recording before running it.
- [ ] Agree future submodule/fork editing workflow; no silent gitlink/dependency refresh. Future commits/pushes and root revision updates require their own task authorization.
- [ ] Accept the architectural direction: native builder, exclusive complete masks, one synchronous Worker, epochs, admission-only sequence high-water, five operations/compact record, bounded resumable preparation and explicit neutral-first. Final ABI numeric assignments may follow evidence; any material contract change returns for review.
- [ ] Require A traces at actual build/player-entry/world-completion boundaries and zero playable tics in init/phase/render, including after-build abort and completed→victory PENDING. A test-only proof may expose internals but must never prescribe permanent private offsets or production fixture exports.
- [ ] Keep B/C/D gated on A evidence, and require all twelve acceptance cases and durable results before Decisions integration. Separately approve any later objective/health observer work.

### Revision validation and repository boundary

This revision reads both documents and pinned sources and edits only `docs/doom-control-contract-design.md`. The entire updated document is reviewed for ABI validity, admission/epoch timing, post-entry transitions, neutral-first, phase counts/publication, future test expectations and authorization gates. Read-only validation completed: `git diff --check` passed without output; the full document/diff was reviewed; all twelve acceptance rows and balanced code fences were confirmed by document-only checks. Final root status is ` M docs/doom-control-contract-design.md`, with unchanged clean submodule at `31cc1af9656a8184830090c4e9f268383f5d7e15`. No engine/header/WAT/build/TS/test/dependency edits, installations/downloads, WASM build/run, test execution, Decisions calls, commits or pushes occur in this task.
