# Stage A2.1: E1M1 READY and one neutral tic

**Verdict: build verified; the core owner Chrome experiment PASS: zero-tic native
READY, one neutral native tic, and actual level rendering without extra work.**
Two supplemental checks remain PENDING: non-neutral refusal while READY and
zero-tic READY rendering. The owner supplied the receipt and matching level PNG
reviewed below. Codex did not launch Chrome or execute Doom WASM exports. This is
not full A2 or Issue #4 acceptance.

## Baseline and changed paths

- Working directory: `/Users/mike/projects/doom-decisons`; branch `main`.
- HEAD: `4bbb014dd147603f7c9cb10fd88b7bb7089e7f8f`; initial
  `git status --short --untracked-files=all` was empty.
- `references/doom.wasm/` contains ordinary tracked files (mode `100644`),
  with no gitlink, `.gitmodules` or nested `.git`. The investigation report's
  older HEAD is not this baseline.
- Ignored pinned IWAD, WASI SDK 24.0, Binaryen 119 and A1 final trace WASM/manifest
  were available. The A1 trace WASM is 354,705 bytes. Required local SDK/sysroot
  inputs and executable identities were admitted by the existing wrapper.
  No A1 outputs, tool installations or unrelated files were overwritten.

Precisely modified paths are in the final status below: native `g_game.c`,
`p_user.c`, `p_tick.c`, `i_timer.c`; their necessary headers and existing
`a1_trace.h`; adapter C/header; two controlled reachability graphs; inspector,
harness and inspector fixtures. New files: this document and
`tests/test_a21_contracts.py`. Makefile, wrapper, WAT startup, engine map loader,
physics, RNG and old A1 documents remain at the baseline versions.

## Minimal native path

```text
initControlled -> unchanged one-shot WASI/C title startup
prepareE1M1Controlled -> G_A21Prepare
  -> G_DeferedInitNew(sk_medium, 1, 1) -> whole G_DoNewGame
  -> G_InitNew -> G_DoLoadLevel -> P_SetupLevel
  -> validate loaded resources/LIVE actor -> private completed-load marker
stepNeutralControlled(0) -> G_A21Step
  -> refusal checks -> M_Ticker -> stock G_BuildTiccmd(B, gametic)
  -> scoped native netcmds lending -> G_TickerContinuation
  -> native command copy/install -> actual P_PlayerThink entry
  -> complete P_Ticker -> ST_Ticker -> AM_Ticker -> HU_Ticker
  -> verify counts/deltas -> gametic++ -> I_A21CommitTic -> outer completion
renderControlled -> passive-boundary checks -> existing no-wipe D_Display
```

The shared continuation contains the original command, demo, consistency,
special-button, intermission housekeeping and state-specific ticker statements
in their original order. Legacy `G_Ticker` retains its rebirth/action loop and
then calls the helper. A source-contract test compares the whitespace-normalized
continuation against its pre-refactor hash, excluding only new hooks. The
controlled owner and synchronous lending live together in `g_game.c`; no extra
`d_loop.c`/`d_net.c` dispatcher or scheduler/ring path is required. The previous
`netcmds` pointer is restored before stack storage expires.

READY uses a private marker set only after whole newgame returns. It checks real
geometry/blockmap/reject resources; player 0 alone, LIVE health/actor,
subsector/sector, thinker function/list links and actor back-pointer; fixed
mission/E1M1/medium skill; and supported game/action/menu/pause/demo/network
state. Title initialization is separately named `controlled_initialized`.
Preparation checks zero native work and zero gametic/leveltime/virtual tics.
There is no fabricated map/player state or priming tic.

The step accepts exactly one neutral command in this fresh instance. Every
ordinary refusal precedes menu, builder/history, command installation and time
work. Native contributors and initial turn/double-click history are asserted,
never reset to hide history. No host event pump or adapter key-cache path is
used. The builder uses tick index zero. All ten named native command fields
are compared after installation and at LIVE player entry, before player flag,
chainsaw or command mutation; the original actor identity stays private.

Always-on counters independently cover native build, install, LIVE entry,
completed world body, ST/AM/HU returns, menu cadence and outer completion.
Success requires each exactly one, `leveltime=1`, and `gametic`/virtual tics
committed from zero to one only after the native continuation. Native `usedown`
must clear through consumption. Post-build invariant failures and count
exhaustion trap; the Worker is retired. They cannot become refusal/success.
Diagnostic accessors are optional, while these checks and the completed-load
marker remain compiled when diagnostics are disabled. Optional A1 counters
also trap on overflow.

`i_timer.c` owns one integer virtual tic; all timer reads are passive. First
completion means one tic and `floor(1000/35)=28` ms, including `DG_GetTicksMs`.
Rendering checks native counters/time before and after display and retains the
central `NetUpdate` suppression. Presentation caches may change. Zero-tic
READY is proved from native load state; its image may retain the title. A real
level view is required only after the explicit step. The experiment deliberately
refuses a second step and any second preparation.

## Sole build and compiled identities

Run from the repository root (record of the completed build, **not authorization
for another build**):

```sh
python3 -B scripts/build_doom.py --profile controlled-title \
  --out references/doom.wasm/build/a2-1-first-trace --jobs 2
```

**Build attempts: 1; BUILD PASS**, 3.77 seconds; trace enabled, existing local
controlled profile, no embedded WAD arguments/object. The fresh output is
ignored. No fixture-disabled build, downloads or bootstrap recipes ran.
Tools: Python 3.14.4, GNU Make 3.81, WASI SDK 24.0 Clang/LLD 18.1.2,
Binaryen 119 (`wasm-as`, `wasm-merge`, `wasm-metadce`), Node 22.20.0.
Eleven existing engine warnings were retained (unused variables, pointer sign,
unsigned absolute value); no compilation errors.

| Identity | Value |
| --- | --- |
| Final post-WAT-merge/metaDCE/constant-merge WASM | `references/doom.wasm/build/a2-1-first-trace/doom.wasm`, 358,160 bytes |
| WASM SHA-256 | `e926848cd0a3e763ea00300808a687ac72180dec250b82838db7354543fedf15` |
| External IWAD | `assets/freedoom-0.13.0/freedoom1.wad`, 28,795,076 bytes |
| IWAD SHA-256 | `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d` |
| Build manifest SHA-256 | `5ccd0ac790d750e9f53ba204096077cb31af63dd87800dddbe01e9e46f9584d0` |
| Captured native/configuration/inspector patch SHA-256 | `f04710473fb7fda18623671d4f76fd7a7f4abcf6c60151d075950c803a3ab4bb` |
| Final harness SHA-256 | `32b70011aedf3d8fbb7908fb700236585ef105d7b1ffbbb3a8085615da54093e` |

Build evidence: `references/doom.wasm/build/a2-1-first-trace/evidence/manifest.json`
contains HEAD/status, source patch, selected WAT/graph, exact Make argv/environment,
SDK/tool hashes, versions, final identity and typed interface. The captured
compiled patch was byte-compared with the final native/configuration/inspector
worktree: unchanged. Only harness artifact pin/assertions and this results text
were completed after the build. Supplemental test logs, file identities,
final harness/test source copies and static hook inspection were added under
that new evidence directory; the original build manifest was preserved.

Typed final inspection passed both inside the wrapper and independently:

```sh
node scripts/inspect_doom.mjs \
  references/doom.wasm/build/a2-1-first-trace/doom.wasm --profile controlled-title
python3 -B references/doom.wasm/build/a2-1-first-trace/evidence/hook_inspection.py
```

Exact function exports (seven): `initControlled() -> i32`,
`renderControlled() -> i32`, `prepareE1M1Controlled() -> i32`,
`stepNeutralControlled(i32) -> i32`, `a21ReadObservation(i32) -> i32`,
`a1ReadCounter(i32) -> i32`, `a1WasiInitCount() -> i32`.
Also one wasm32 unshared memory, initially eight pages/524,288 bytes with no
maximum, and the same fourteen immutable i32 key globals. Total exports: 22;
funcref table 163/163. No start section, scheduler, key-reporting, raw initializer
or native-private export survives.

Exact imports (nine functions):

| Import | Signature |
| --- | --- |
| `console.onErrorMessage`, `console.onInfoMessage` | `(i32,i32) -> void` |
| `gameSaving.writeSaveGame` | `(i32,i32,i32) -> i32` |
| `gameSaving.readSaveGame` | `(i32,i32) -> i32` |
| `gameSaving.sizeOfSaveGame` | `(i32) -> i32` |
| `ui.drawFrame` | `(i32) -> void` |
| `loading.onGameInit`, `loading.readWads`, `loading.wadSizes` | `(i32,i32) -> void` |

No host clock or external WASI import. Manifest `asset=null`, no embedded-file
compile/generation commands, and the controlled adapter excludes the embedded
fallback. The inspector validates typed core metadata; its code/data scope is
opaque and it never instantiates/calls exports.

Supplemental `final-hook-inspection.json` statically identifies 24 retained
native functions by unique normalized instruction shapes against this build's
named object symbols, then verifies direct-call ordering through real load,
build, install, player, world and continuation boundaries. Normalization omits
numeric constants, relocated offsets and identifiers; this is retention evidence,
not a semantic equivalence proof or runtime pass. For this artifact's Binaryen
WAT labels: builder `$214` calls build hook `$371`; continuation `$197` calls
install hook `$297`, world `$520`, ST `$448`, AM `$760`, HU `$790`; player `$517`
starts with entry hook `$807`; world `$520` calls player/thinkers/specials/respawns
before boundary hook `$809`. These labels are private inspection notes, not ABI.

## Verification and boundaries

```sh
DOOM_BUILD_PROCESS_INTEGRATION=0 PYTHONDONTWRITEBYTECODE=1 \
  python3 -B -m unittest discover -s tests -v
node --check scripts/inspect_doom.mjs
git diff --check
```

Final suite: **29 tests, 28 passed, 1 skipped** (separately authorized live
process-group integration). Six A2.1 checks cover continuation preservation,
whole-load/no-tic ordering, refusal placement/unsupported eligibility,
install/player/world hook placement, an executable copy of the actual ten-field
native comparator with differing padding, and the actual controlled timer C
implementation's passive reads/one-shot commit/trapping second commit.
Synthetic typed fixtures cover new exports, wrong step signature and gated
export absence. These are contract/unit checks, not mocked E1M1 compatibility
claims. Test output is retained in `evidence/a21-checks.{stdout,stderr}.log`.

WASI `-Wall -fsyntax-only` passed for the four changed native C files in legacy,
controlled-trace and controlled-no-fixtures modes; the adapter passed in both
controlled modes. The harness inline script was extracted to
`/private/tmp/doom-a21-harness-check.js` and passed `node --check`; inspector
syntax and `git diff --check` passed. The full actual diff and final status
were inspected. No A1 acceptance matrix was rerun.

| Boundary | Source/local verification | Compiled-artifact inspection | Owner Chrome |
| --- | --- | --- | --- |
| Init/title | Existing one-shot startup/guard retained; zero-work assertions in harness | Startup/export/import inventory retained; no start/host clock | **PASS** receipt: one startup, title frame hash, simulation/time zero; screenshot not supplied |
| E1M1 READY | Whole real action, marker after return, real resources/LIVE actor predicate; no builder/ticker call | `G_DoNewGame -> G_InitNew -> G_DoLoadLevel -> P_SetupLevel` retained | **PASS** receipt: loaded E1M1 resources/LIVE actor, READY with T/L/V zero |
| One neutral step | Refusal before mutation, all ten fields + original LIVE actor at entry, body/continuation/count/delta enforcement | Builder/install/entry/world/menu/ST/AM/HU/virtual commit hooks retained in final module | **PASS** receipt: exact 1/1/1/1 + outer, all command/actor checks, T/L/V 0->1 |
| Snapshot/render | Read-only accessors/timers; display passive checks and central NetUpdate intercept | Diagnostics/display/guards retained; no clock import | **PASS** for recorded snapshots, title render and two post-step level renders; PNG matches frame hash; zero-tic READY render PENDING |

## Owner Chrome receipt: partial runtime proof

Reviewed `/Users/mike/Downloads/a2-1-receipt (1).json`, run timestamp
`2026-10-10T01:19:40.225Z`, user agent Chrome/154.0.0.0. Preserved verbatim as
`references/doom.wasm/build/a2-1-first-trace/evidence/owner-chrome/a2-1-receipt-20261010T011940Z-2af3a532.json`;
SHA-256 `2af3a5321d0bfc64b9c466af16e79c754eca4053c68eadae5af29d5decf8109b`.

Seven operations: load, init, title render, title-step refusal, prepare,
READY snapshot, accepted neutral step. WASM/IWAD hashes exactly match this build
and pinned asset despite the selected WASM filename `a2-1-doom.wasm`.

- Init/title render: one startup, zero native gameplay/time; title frame hash
  `d6c8cfd39fb13d32e9ec6ab2778dc3a17dd3216c423183012a28da8f6f344525`.
- Title step: `REFUSED/-1`; counters and native observation identical to the
  preceding title render.
- Preparation: native READY, E1M1/medium, LIVE health 100, resources/actor checks
  true; 1,196 vertexes, 1,175 lines, 182 sectors, 2,057 segs, 682 subsectors,
  681 nodes. All build/install/player/world/continuation/outer counts and times
  zero. The next snapshot is identical.
- Explicit step: `APPLIED/0`; build/install/LIVE entry/world/menu/ST/AM/HU/outer
  each one; gametic/leveltime/virtual tics each one, virtual milliseconds 28.
  All ten built/entered fields match and are zero; installation, entry and
  original-actor checks true; `usedown` clears 1->0. No scheduler/network-body,
  wipe or demo work, error log or truncation.
- No watchdog firing. Recorded maximum main-thread operation gap is 29.7 ms.
  Heartbeat count is zero because these operations complete before a 50 ms
  interval sample; this does not establish sustained heartbeat/fault containment.

This first receipt ended at **ONE NATIVE TIC VERIFIED — render next**. Its
post-step rendering and second-step refusal gaps are resolved by the subsequent
receipt below. The first receipt remains preserved as historical evidence.

## Owner Chrome update: level rendering and second-step refusal

Reviewed `/Users/mike/Downloads/a2-1-receipt (2).json` and
`/Users/mike/Downloads/a2-1-level.png`. The updated receipt extends the same run
to 12 successful operations; its first seven operations exactly equal the first
receipt. Preserved without overwriting earlier evidence under
`references/doom.wasm/build/a2-1-first-trace/evidence/owner-chrome/`:

- `a2-1-receipt-20261010T011940Z-31ecdec8.json`, SHA-256
  `31ecdec8f96aba1c68e39c76a5a6a90d296acc1d7329cc9a04d70a10d2ac27c1`.
- `a2-1-level-408402de.png`, file SHA-256
  `408402deab92f00981f70ed2e0e9e4deb2a7d0190f81cbebffb2d9c81c786d8c`.

The added sequence is snapshot, render, snapshot, render, second-step refusal.
Local receipt assertions verified all native observations remain exactly equal
to the completed first step. Snapshots and the refused second step leave every
counter unchanged. Each render increases only render/frame by one and central
NetUpdate intercepts by five; native builds/player/world/outer/time remain one.
Both renders record the same frame hash, different from the title hash.

The PNG visibly shows a first-person level scene, weapon and status bar. Decoding
its 640x400, 8-bit RGBA pixels and hashing them gives exactly the recorded frame
SHA-256 `ea416a166f395e8ed6fb60d3b417a1cacedd9b764f58282892d4e9caae8e5800`.
The receipt establishes that the loaded native map is E1M1; the matching image
establishes actual level rendering after that one explicit tic.

No watchdog fired; maximum recorded gap remains 29.7 ms. Heartbeat count remains
zero, so sustained heartbeat/fault containment is not established by this short
run. There is no non-neutral READY operation or zero-tic READY render in either
receipt. Those supplemental checks require a fresh manual Worker run following
steps 4–7 below; no rebuild or code change is indicated. Title/READY and combined
Canvas/receipt screenshots were not supplied. The receipt's `ownerChrome=PENDING`
is a harness placeholder; this document records the reviewed boundary evidence
without establishing full A2 acceptance.

## Copy/paste owner Chrome protocol

Open the repository HTML manually in Chrome; do not run a server or automation.
Use Cmd-Shift-G in file dialogs to enter these exact local paths:

```text
/Users/mike/projects/doom-decisons/experiments/stage-a/harness.html
/Users/mike/projects/doom-decisons/references/doom.wasm/build/a2-1-first-trace/doom.wasm
/Users/mike/projects/doom-decisons/assets/freedoom-0.13.0/freedoom1.wad
```

Use only the **A2.1 manual fieldset**, with one click at a time. Every operation
has a main-thread 2,000 ms watchdog; operations are serialized and the session
is limited to 32. The main heartbeat samples at 50 ms and requires maximum
operation gap <=250 ms. Fault/error retires the Worker and clears handlers;
there is no automatic retry. Stop on the first fault, timeout, invariant failure
or incompatible map; save the failing JSON for review.

1. Select WASM/IWAD. Click **1. Load fresh A2.1 Worker**. Require the two hashes
   above, the inspected imports/exports and all pre-init counters zero.
2. Click **2. Initialize title**, then **Render / capture Canvas**. Require
   `status=0`, WASI/C/create/title preparation/title-ready each one, all native
   build/player/world/outer/scheduler/time values zero, and visible Freedoom
   title. Click **Save Canvas PNG** (`a2-1-title.png`).
3. Click **4. Execute one neutral tic** while still on title. Require `REFUSED`,
   `status=-1`, and unchanged commands/native counters/time.
4. Click **3. Prepare E1M1**, then **Observe READY / counters**. Require
   `ready/loadComplete/resources/liveActor/gameEligible=1`, episode/map=1,
   skill=2 (medium), playerstate=0 (LIVE), positive health, game/action=0
   (LEVEL/nothing), positive geometry counts; build/install/liveEntry/world/
   ST/AM/HU/menu/outer and T/L/V are all zero. Capture a screenshot of this
   READY observation. Snapshot must change none of it.
5. Click **Render / capture Canvas**, then **Observe READY / counters**.
   Simulation/commands/time stay zero; retained title at this point is allowed.
6. Click **Refuse non-neutral input**. Require `REFUSED`, `status=-1`, unchanged
   READY/native commands/counts/time. No build or menu ticker may occur.
7. Click **4. Execute one neutral tic**. Require `status=0`, `APPLIED`,
   build/install/liveEntry/world/status/automap/HUD/menu/outer each exactly one;
   A1 native build/player entry/world complete/outer complete each one;
   gametic/leveltime/virtualTicks each one, virtualMs=28;
   installEqual/entryEqual/actorEqual each one; built and entered commands
   identical with all ten fields zero; `usedown=0`. READY now becomes zero
   because this one-shot experiment is spent, even if native game eligibility
   remains true. No scheduler/net body/wipe/demo counts may appear.
8. Click **Observe READY / counters**, **Render / capture Canvas**, then
   **Observe READY / counters**. Require unchanged native commands/work/T/L/V,
   640x400 Canvas, a frame hash different from the captured title, and manually
   verify an actual E1M1 first-person scene/status bar. Save **Canvas PNG**
   (`a2-1-level.png`) and a screenshot showing Canvas plus the native receipt.
   Render/frame/NetUpdate-intercept presentation counters may increase; level
   rendering can intercept five NetUpdate calls per render.
9. Click **Render / capture Canvas** once more and **4. Execute one neutral tic**
   again. Render stays passive; the second step must refuse with all native
   work/time still one. Require `watchdogFired=false`, heartbeat maxGapMs<=250,
   no diagnostic truncation and no fault/error. Click **Save JSON**
   (`a2-1-receipt.json`), then **Retire Worker**.

Save the downloaded files and two screenshots into the new result directory:

```text
/Users/mike/projects/doom-decisons/references/doom.wasm/build/a2-1-first-trace/evidence/owner-chrome/
  a2-1-receipt.json
  a2-1-title.png
  a2-1-level.png
  a2-1-ready-screenshot.png
  a2-1-level-receipt-screenshot.png
```

Chrome may default downloads to `~/Downloads`; move/save the files into this
location without overwriting prior evidence. The JSON keeps `ownerChrome=PENDING`
until owner review of receipt/screenshots establishes PASS/FAIL. A differing
frame hash alone does not prove level imagery. Supply actual evidence before
changing the boundary table or claiming A2.1 Chrome success.

## Gaps and deliberately deferred work

The owner receipts and matching PNG prove real zero-tic E1M1 preparation, one
native step, passive post-step level rendering and second-step refusal.
Non-neutral refusal while READY and zero-tic READY rendering remain unverified
in Chrome. Sustained heartbeat/fault containment and requested combined
screenshots are not established by the supplied evidence.
Menu/pause/pending-action refusals are
source-guard verified, not exercised through mutable runtime fixtures here.
Legacy ticker preservation is structural/syntax checked, not an ordinary legacy
gameplay regression run. Diagnostics-disabled enforcement is syntax/fixture
checked; no disabled final-WASM rebuild ran. No normalized whole-game/RNG/history
digest, forward/turn/fire/use commands, 20-tic script, paired 2s/10s wait isolation,
reload/lifecycle/PENDING, production ABI or Decisions integration is implemented.
A2.2 input/history/wait work needs separate authorization after this first proof.

Acceptance criteria are unchanged: zero-tic READY is native state, real level
imagery follows the explicit tic, native count/delivery failures retire the
Worker. No broad engine/map surgery, scheduler fallback or second build was used.
Stop here for owner-led Chrome verification and review; no commit, push or issue
edit occurred.

Final `git status --short --untracked-files=all`:

```text
 M experiments/stage-a/harness.html
 M references/doom.wasm/doomgeneric/include/a1_trace.h
 M references/doom.wasm/doomgeneric/include/g_game.h
 M references/doom.wasm/doomgeneric/include/i_timer.h
 M references/doom.wasm/doomgeneric/src/g_game.c
 M references/doom.wasm/doomgeneric/src/i_timer.c
 M references/doom.wasm/doomgeneric/src/p_tick.c
 M references/doom.wasm/doomgeneric/src/p_user.c
 M references/doom.wasm/src/doom_wasm.c
 M references/doom.wasm/src/doom_wasm.h
 M references/doom.wasm/src/reachability-controlled-title-no-fixtures.json
 M references/doom.wasm/src/reachability-controlled-title.json
 M scripts/inspect_doom.mjs
 M tests/test_build_doom.py
?? docs/doom-a2-1-results.md
?? tests/test_a21_contracts.py
```
