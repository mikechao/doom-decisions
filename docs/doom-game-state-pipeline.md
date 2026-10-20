# Doom game-state pipeline

## Scope and data flow

This guide describes the current controlled E1M1 browser app, including its C
inventory adapter and TypeScript player-state adapter. Native Doom owns game
state; the adapters expose selected values without creating an independent
cache, state store, or Worker.

Player observations include health, player/actor state and coordinates, armor,
ready weapon, and four ammo quantities/capacities. Inventory is only one part of
the larger observation/receipt surface: it also contains work counters, clocks,
readiness, map/resource checks, commands, input history, and RNG indices. Native
fields such as owned weapons, pending weapon, keys, powers, and backpack status
remain engine-internal; there is no structured world/enemy inventory. This is a
maintenance guide, not a complete Doom state model or a new telemetry ABI.

```text
Native authoritative state: players[0], players[0].mo, weaponinfo[]
  → A21ObservePlayerInventory (inventory) / G_A21Observe (dispatcher + other fields)
  → a21ReadObservation(index): numeric i32 → i32 WASM getter
  → existing Worker: observations() samples counters, then native fields
      ↳ readReadyWeapon / readPlayerTelemetry translate player inventory
  → Observation { counters, native: NativeObservation } in operation receipts
  → requestWorker → session controller: consistency, admission, receipt checks
  → detached presentation evidence → main.ts → browser evidence JSON

Native framebuffer → Worker RGBA/hash → controller Canvas/hash + verified tic
  → Canvas PNG + verified tic + selected duration instructions/action choices
  → buildDefaultDecisionRequest → decisions.create
```

**Player telemetry is opt-in text in Decisions instructions.**
[`buildDefaultDecisionRequest`](../app/src/decision-request.ts) resolves visible
`{{readyWeapon}}` and `{{ammo}}` placeholders from the controller's verified
pre-request `Observation.native`, alongside `{{tics}}` from the admitted duration.
Edit Prompt checkboxes add or remove labeled placeholder lines in the draft;
only Save applies edits. No telemetry text is appended when tokens are absent.
The same verified observation is checked against the rendered tic and Canvas
hash before request construction. The resolved instructions are frozen in history.
Health, armor, and other native fields remain local evidence; the screenshot can
also show the native HUD. No separate structured telemetry API field is added.

## Layer responsibilities

| Owner | Source and responsibility |
| --- | --- |
| Doom state | [`g_game.c`](../engine/doom/doomgeneric/src/g_game.c) defines `players`; [`d_player.h`](../engine/doom/doomgeneric/include/d_player.h) defines `player_t`; [`p_mobj.h`](../engine/doom/doomgeneric/include/p_mobj.h) defines actor state. [`doomdef.h`](../engine/doom/doomgeneric/include/doomdef.h) defines weapon/ammo enums; [`d_items.c`](../engine/doom/doomgeneric/src/d_items.c) defines `weaponinfo[]`. |
| C inventory extraction | [`g_player_observation.c`](../engine/doom/doomgeneric/src/g_player_observation.c), declared in [`include/g_player_observation.h`](../engine/doom/doomgeneric/include/g_player_observation.h): `A21ObservePlayerInventory(const player_t *, int)` reads armor, ready weapon, weapon ammo type, and fixed ammo slots. |
| Native dispatch | `G_A21Observe` in `g_game.c` gates inventory on completed preparation and routes indices. Health, actor position/state, and other receipt fields remain here. |
| WASM boundary | [`doom_wasm.c`](../engine/doom/src/doom_wasm.c), [`doom_wasm.h`](../engine/doom/src/doom_wasm.h): `a21ReadObservation(int32_t index)` checks `controlled_busy` and delegates. No object/string export was introduced. |
| Sampling | [`worker.ts`](../app/src/worker.ts): `snapshot`, `a21Observation`, `observations`, and operation handlers own when reads occur and construct receipts. |
| TS inventory translation | [`player-state.ts`](../app/src/player-state.ts): `readReadyWeapon` and `readPlayerTelemetry` synchronously invoke the supplied index reader, decode names, and assemble quantities. They neither schedule work nor retain state. |
| Contract and transport | [`worker-shared.ts`](../app/src/worker-shared.ts): `NativeObservation`, `Observation`, `Results`, `Reply`, `Request`; [`worker-request.ts`](../app/src/worker-request.ts): `requestWorker` correlates replies, records operations, and retires on transport failure/timeout. Its reply assertion is a bundled-Worker protocol contract, not full payload validation. |
| Consistency and consumers | [`session-controller.ts`](../app/src/session-controller.ts): `createSessionController` owns session/admission, last observation, verified tics, frames, and evidence. [`native-observation-checks.ts`](../app/src/native-observation-checks.ts) supplies passive/preparation checks; [`decision.ts`](../app/src/decision.ts) supplies `verifyAction`. [`main.ts`](../app/src/main.ts) owns the single module Worker constructor, Canvas ports, and evidence display. |

## Indices and browser shape

These are existing private indexed observations, not a general serialized
`player_t`. Counter indices belong to the separate `a1ReadCounter` domain.
Within `G_A21Observe`, 0–8 are work events, 32–41 and 42–51 are built/entered
commands; other indices mix game state, diagnostics, and player fields.

| Index | Native source → browser field |
| --- | --- |
| 9 / 10 | `G_A21Ready()` / `a21_load_complete` → `ready` / `loadComplete` |
| 19 / 20 | `players[0].playerstate` / `.health` → `playerstate` / `health` |
| 52–56 | `players[0].mo` → `x`, `y`, `angle`, `momx`, `momy` |
| 70 / 71 | Actor `reactiontime` / `flags` → same names |
| 76 | `armorpoints` → `armorpoints` |
| 77 | `readyweapon` → `readyWeapon.id` and decoded `.name` |
| 78 | `weaponinfo[readyweapon].ammo` → decoded `readyWeapon.ammoType` |
| 79 / 83 | `ammo[am_clip]` / `maxammo[am_clip]` → `ammo.bullets.current` / `.max` |
| 80 / 84 | `ammo[am_shell]` / `maxammo[am_shell]` → `ammo.shells.current` / `.max` |
| 81 / 85 | `ammo[am_cell]` / `maxammo[am_cell]` → `ammo.cells.current` / `.max` |
| 82 / 86 | `ammo[am_misl]` / `maxammo[am_misl]` → `ammo.rockets.current` / `.max` |
| 87 | Completed collision sample boundary → `collisionSampleTic` |
| 88 / 89 | Latched XY trial events / rejection reasons → `movementFlags` / `rejectionMask` |
| 90 / 91 / 92 | Completed-tic forward center ray → `facingKind` / `facingDoor` / `facingDistance`, owned by index 87 |

Actor fields fall back to `0` when `mo` is absent; zero is not proof of a valid
actor. Coordinates/momentum remain native fixed-point numbers. The angle getter
returns raw bits through i32; the Worker applies `>>> 0` to expose an unsigned
number, without converting to degrees. Health is read from `player_t.health`,
not substituted from `mo->health`.

Weapon IDs 0–8 decode, in order, to `fist`, `pistol`, `shotgun`, `chaingun`,
`rocket_launcher`, `plasma_rifle`, `bfg9000`, `chainsaw`, `super_shotgun`.
`NUMWEAPONS` (9), `wp_nochange` (10), and unrecognized IDs decode to `unknown`;
the raw weapon ID is retained. Before indexing `weaponinfo`, C checks
`wp_fist <= readyweapon < NUMWEAPONS`; an invalid weapon yields `-1` at index 78.

Ammo IDs 0–3 decode to `bullets`, `shells`, `cells`, `rockets`; `am_noammo` (5)
becomes `none`, while `NUMAMMO` (4), `-1`, and unrecognized IDs become `unknown`.
TS decodes the sampled ammo ID independently of the weapon name. C always reads
the four fixed inventory slots, never `ammo[am_noammo]`. `current` and `max` are
the player's native quantities/capacities, not hard-coded defaults, percentages,
or derived firing counts. TS does not clamp or validate these quantities.

`Observation` contains `counters`, `native`, and optional diagnostic logs.
Only `armorpoints`, `readyWeapon`, and `ammo` are nullable in `NativeObservation`.
Both native dispatch and Worker sampling gate inventory on completed E1M1 load:
C returns `-1` for 76–86 before completion; the Worker skips those reads unless
`loadComplete === 1` and emits all three properties as `null`. Other native
numeric fields still return their current/default/fallback values before
preparation; they must not be interpreted as prepared gameplay evidence.

Completion differs from readiness: after a supported death or exit-pending tic,
`loadComplete` remains set while `ready`/`gameEligible` are zero. Inventory stays
available for terminal receipts and the final render, until session retirement.
Unknown dispatcher indices and busy observation reads return `-1`; this sentinel
must not be interpreted as a valid inventory quantity.

### Collision experiment 1

Indices 87–89 are diagnostic integers, all `-1` until the first successfully
completed native tic (including through preparation at tic zero). Afterward,
`collisionSampleTic` equals the completed `gametic`. `movementFlags` uses
`trial=1`, `success=2`, `rejected=4`, `slide=8`; `rejectionMask` uses
`solid_line=1`, `solid_thing=2`, `clearance=4`, `unknown=8`. Both masks OR events
within that one tic. A trial records a completed `P_TryMove` call, not a tic or
proof of nonzero translation. Zero flags mean no relevant trial; flags 3 with
zero reasons mean at least one accepted trial and no observed rejection.
Success and rejection may coexist, including successful slide recovery.

`P_XYTryMove` wraps only `P_XYMovement` and its slide-recovery trials. Callback
reasons are assigned at actual false return sites, handed immediately through
`P_CheckPosition` and `P_TryMove`, then recorded only for the admitted controlled
actor after its verified player entry. Dedicated synchronous reason handoffs
are not sampled through getters; unrelated position/height checks never publish
events. Pending masks reset only after admission, and publish after successful
tic closeout and its checks. Refusal preserves the previous sample. Completed
terminal/unsupported tics retain their event record; no further stepping is
authorized by its availability. Faults retain the previous published boundary,
which must never be treated as proof of the uncertain tic.

These are movement events during an admitted tic, not input causality, a stuck
verdict, visible-wall recognition, or door identification. Existing momentum,
damage, teleports and reaction delay remain relevant. No facing query, extra
collision query, C multi-tic accumulator, prompt or Decisions request change is
included. See the [pending native validation procedure](issue-18-native-collision.md).

### Facing experiment 2

Indices 90–92 append a cached read-only forward linedef probe. The unchanged
collision sample stamp at 87 owns both observations. All three are `-1` before
the first completed tic. Afterward, kind/door/distance are validated together;
terminal or unsupported gameplay publishes unavailable `0/0/-1` at its own tic.
Kinds distinguish unknown, no relevant line, solid, clearance, nonrestricting
manual-door metadata and other specials. Only a narrow front-side candidate may
suggest that use is possible; no activation or player-radius clearance is proven.
See [the exact enum contract and pending native validation](issue-18-facing-probe.md).

The separate OFF-by-default **Nearby wall / door** configuration appends this
current-facing context to request `state`, independent of Previous action outcome
and editable instructions. Admission freezes configuration; construction requires
sample/frame tic agreement after existing native/Canvas checkpoint verification.
Preview and Advanced evidence use detached last-verified-render data. No probe
runs in a getter, render, snapshot or idle; no additional Worker operation exists.

## Sampling and correctness boundaries

Preserve the existing synchronous read order and object/property insertion order.
The code uses `JSON.stringify` equality for native/receipt comparisons, and
synthetic tests explicitly assert ordering. In `observations()`:

1. Sample `wasiInit`, then `counterNames` through `a1ReadCounter`.
2. Read native base indices 0–31. If loaded, read weapon IDs 77 then 78.
3. Read extra indices 52–75, built command 32–41, then entered command 42–51.
4. If loaded, read armor 76 and paired current/max slots in order:
   `79,83,80,84,81,85,82,86`.
5. Read collision indices `87,88,89` unconditionally, preserving `-1` sentinels.
6. Append facing indices `90,91,92` unconditionally, preserving raw integers.

The returned native object's order is base, extra, `built`, `entered`,
`armorpoints`, `readyWeapon`, `ammo`, `collisionSampleTic`, `movementFlags`,
`rejectionMask`, `facingKind`, `facingDoor`, `facingDistance`; weapon properties
are `id`, `name`, `ammoType`, and ammo entries are bullets/shells/cells/rockets with `current`,
`max`. Weapon reads happen earlier than their placement in this object.

The Worker samples after module instantiation, after init/prepare return, before
an action and after each synchronous native step, and after render returns.
The `snapshot` operation only reads observations; it calls no init, display, or
tick function. There is no periodic telemetry loop. `a21ReadObservation` refuses
while `controlled_busy` is set; controlled init/prepare/step/render surround
native work with that flag. The app serializes Worker requests in the controller.
These are sequential getter reads at controlled boundaries, not a new atomic
snapshot export.

The observation getter, dispatcher, and C inventory adapter are compiled under
`DOOM_CONTROLLED_TITLE` with `DOOM_A1_NO_FIXTURES` absent. The supported app build
enables fixtures; this surface is unavailable in the no-fixtures variant.

`passiveCheck` compares selected simulation counters and the entire native
object. Snapshots additionally compare all counters. Rendering allows explicit
render/frame/net-intercept increments while retaining native state and verified
tic. Startup idle and API-wait/cleanup checks compare all counters and native
state. Thus new native properties participate in existing whole-object equality.

Telemetry decoding is separate from execution proof. `i11VerifyStep` checks
single-tic command/work/clock receipts in the Worker and controller;
`verifyAction` retains an independently rechecked prefix and requires the outer
receipt to agree with its final verified step, including inventory. Requested,
reported, and verified tics stay distinct. `assessE1M1` interprets readiness,
health/player state, and game state; it does not infer terminal outcomes from
inventory. Supported terminal prefixes stop further stepping, then require final
frame verification before retirement. Exit pending is not intermission/E1M2.

Frame proof separately checks the observation tic, Worker RGBA hash, transferred
pixels, and Canvas readback; inventory decoding proves none of these. Stop and
session/attempt fences remain controller responsibilities, including waiting for
SDK reader cleanup before proving unchanged state and restoring admission.

These are source-enforced checks, not proof that every runtime path has been
independently exercised. Synthetic tests fake native boundaries. Existing owner
reports and uncollected browser/WASM terminal linkage, exit-pending, and early
prefix evidence are distinguished in the
[app evidence notes](../app/README.md#prototype-acceptance-and-evidence).

## Adding another game-state field

1. Establish the authoritative native owner, units, valid range, and meaning
   before initialization/preparation and at death/exit. Decide unavailable and
   fallback semantics explicitly; do not expose pointers.
2. Inspect `G_A21Observe` and the relevant domain before choosing an unused
   index. Preserve existing indices and the numeric getter signature; do not
   renumber arrays or assume every observation belongs to player inventory.
3. Extend native extraction/dispatch and its guards. For inventory, use
   `A21ObservePlayerInventory`; health and actor extraction currently live in
   the dispatcher. New C translation units must enter the explicit `SRC_DOOM`
   list in [`engine/doom/Makefile`](../engine/doom/Makefile).
4. Extend `NativeObservation` and Worker sampling, including preparation/null
   behavior and ordering. Put enum/quantity translation in the appropriate
   adapter and preserve synchronous readers. World/enemy domains may eventually
   warrant separate adapters; choose that when implementing the domain.
5. Update synthetic coverage for decoding, sentinels, ordering, preparation,
   passive comparisons, terminal availability, and final-step/receipt agreement
   as relevant. Current examples are [`iwad.test.ts`](../app/tests/iwad.test.ts),
   [`session-controller.test.ts`](../app/tests/session-controller.test.ts), and
   [`fixtures/synthetic-doom.ts`](../app/tests/fixtures/synthetic-doom.ts).
   Preserve [`worker-entry.test.ts`](../app/tests/worker-entry.test.ts) and
   [`check_worker.mjs`](../scripts/check_worker.mjs) import checks when
   dependencies change. Request construction has its own
   [`decision-request.test.ts`](../app/tests/decision-request.test.ts); adding
   observation data alone does not change the model's input.
6. Obtain separate authorization before checks/tests, a full native build for C
   changes, or optional browser smoke. Use [`build.sh`](../build.sh): admission,
   foreground Make, closeout, verified staging, frontend build. Frontend-only
   reuse cannot validate changed native sources. The
   [`WASM inspector`](../scripts/inspect_doom.mjs) checks the indexed i32
   signature and module interface without instantiation; it does not verify
   field values. Paid API calls need separate approval and are only necessary
   for an actual API integration question, not telemetry decoding.

For timing see [Doom tic semantics](doom-tic-semantics.md); its source table has
historical line anchors, so follow current symbols. For build provenance and
coverage limits see [Doom build](doom-build.md). For setup, approval boundaries,
and isolated browser procedures see the [app guide](../app/README.md).
