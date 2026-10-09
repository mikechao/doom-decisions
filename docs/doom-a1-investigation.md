# Stage A1 investigation: final WASM and zero-tic controlled initialization

## 1. Summary and evidence status

**Source inspection supports a localized A1 experiment; A1 remains unproved and unapproved for execution.** The actual final Doom WASM has not been built, instantiated, or tested in this investigation. Stock initialization enters the scheduler twice, external-WAD loading currently permits an embedded shareware fallback, and rendering can enter time-dependent polling. Those paths need explicit controlled-mode seams before a zero-tic claim is possible.

This document consolidates the preceding read-only Codex investigation for **Issue #3 — Stage A1: Compile final WASM and prove zero-tic controlled initialization**. No local Issue #3 body was available; the [Stage A plan's A1 scope](doom-stage-a-plan.md#a1--final-wasm-and-observable-controlled-initialization) is the scope authority. The [control-contract design](doom-control-contract-design.md), especially §§6–8 and §10, supplies the broader architectural context without making its later API/lifecycle work part of A1.

Evidence labels used below:

| Label | Meaning |
| --- | --- |
| **Source-verified** | Behavior or ordering established by inspected current source; not a runtime result |
| **Locally checked** | Read-only Git, input existence/hash, or executable-version observation from the investigation |
| **Proposed** | A future implementation or test choice requiring separate authorization |
| **Runtime hypothesis** | An assumption the real final WASM/Worker experiment must confirm |

A1's intended proof is limited to initialization and title rendering in a Chrome Worker with an externally supplied verified IWAD and zero native command builds, all player-think entries, completed world bodies, and outer simulation tics. One-tic stepping, A2/A3 lifecycle preparation, public control ABI, Decisions integration, audio delivery, and production UI are excluded.

## 2. Repository and A0 prerequisite context

**Locally checked baseline, 2026-10-09:** branch `main`, HEAD `40326b7a5819e96c6c474d3a0d07cc0d639d3dc7`; index/worktree clean before this documentation addition. This matches the supplied handoff SHA; no remote freshness was checked. The vendor subtree is `18ad13ab35135c607015fb645dd8bbdc4f69f473`, matching the pinned import of upstream commit `31cc1af9656a8184830090c4e9f268383f5d7e15`. Doom source is ordinary root-tracked source under `references/doom.wasm/`, with no gitlink or nested repository. See [vendor provenance](doom-vendor-provenance.md) and the [current ownership clarification](doom-a0-preflight-results.md#source-provenance); historical pending-import wording is not the present baseline.

A0 is complete. Workspace-local WASI SDK 24/Binaryen 119 and external Freedoom Phase 1 inputs were verified **for A0 only**, as recorded in the [committed A0 results](doom-a0-preflight-results.md). The preceding investigation rechecked the specified IWAD's existence/size/hash and tool versions without rerunning preflight. Actual Doom build, initialization, rendering, and WAD compatibility remain unproved; A0's tiny tool probe is not Doom runtime evidence.

Relevant reusable paths are `tools/wasi-sdk-24.0/`, `tools/binaryen-119/`, and `assets/freedoom-0.13.0/freedoom1.wad`. Observed SDK executables report Clang/llvm-ar `18.1.2-wasi-sdk` and LLD `18.1.2`; all four inspected Binaryen tools report `119`. These agree with A0's committed summary. No new tool or asset acquisition is proposed.

Source links below are repository-relative. Their line anchors refer to the unchanged vendored source at this baseline; future source changes require refreshing affected anchors.

## 3. Verified build graph and proposed Stage A profile

### Default graph

**Source-verified:** [Makefile:14](../references/doom.wasm/Makefile#L14) selects `all → doom`. The default data and transformation paths are:

```text
all → doom
  → generated DOOM1.WAD.c/.h
      → build/DOOM1.WAD → curl download if missing
      → development Python environment → pip requirements
  → Docker make raw linked module
      → engine objects + adapter/WASI objects + embedded WAD object
  → recursive make final module
      raw linked module
      → WASI trampoline merge
      → initialization-wrapper merge
      → metadce export trimming
      → key-constants merge
      → copy to build/doom.wasm
```

| Stage | Verified input/behavior and source |
| --- | --- |
| Compile/link | `--target=wasm32-unknown-wasi -Wall -g -Os`; `--export-dynamic`, `--import-undefined`, reactor model; `-lm -lc` ([Makefile:149–160](../references/doom.wasm/Makefile#L149)) |
| Engine/adapter objects | Explicit `SRC_DOOM` engine list plus `doom_wasm.c` and `internal__wasi-snapshot-preview1.c`; `EMBEDDED_BINARY_FILES = DOOM1.WAD` adds generated objects ([172–180](../references/doom.wasm/Makefile#L172)) |
| Embedded data | WAD download and generated C/header prerequisites ([258–270](../references/doom.wasm/Makefile#L258)); generator emits every input byte into a C array ([generator:23–46](../references/doom.wasm/utils/generate_code_for_embedded_file.py#L23)) |
| Docker delegation | `doom` invokes Docker unconditionally; direct compile/link recipes delegate unless the compiler path contains literal `wasi` ([196–255](../references/doom.wasm/Makefile#L196)) |
| WAT assembly | Assemble three helper modules with `wasm-as` ([272–275](../references/doom.wasm/Makefile#L272)) |
| WASI merge | Resolve five preview1 functions through C implementations via trampolines ([285–287](../references/doom.wasm/Makefile#L285)) |
| Init merge | Combine `_initialize` then `_initializeDoom` into `initGame` ([292–294](../references/doom.wasm/Makefile#L292)) |
| metadce | Trim using `src/reachability_graph_for_wasm-metadce.json` ([299–304](../references/doom.wasm/Makefile#L299)) |
| Constants/final copy | Merge global constants after metadce, then copy the resulting module ([311–317](../references/doom.wasm/Makefile#L311)) |

The generated WAD object is `build/file_embedded_in_code/build/DOOM1.WAD.o`, following the variables at Makefile:169–180. Supplying an external IWAD at runtime does not remove that linked data.

The existing [reachability graph](../references/doom.wasm/src/reachability_graph_for_wasm-metadce.json) roots `initGame`, `reportKeyDown`, `reportKeyUp`, `tickGame`, and `memory`. The subsequent [constants module:26–39](../references/doom.wasm/src/wat/global-constants.wat#L26) adds **fourteen immutable `i32` global exports**. The final interface is therefore not simply the metadce roots.

### Smallest additive profile

**Proposed:** preserve the default legacy profile, engine source list, reactor flags, and full transformation chain. A separately selected Stage A profile should:

1. Omit every `DOOM1.WAD` prerequisite, generated source/header/object, embedded byte array, adapter include, and fallback branch. An empty Makefile file list alone does not remove the hardcoded adapter references.
2. Select a fresh isolated output directory for each build, without reusing legacy objects. Makefile profile/header dependencies are incomplete, so timestamps alone are insufficient isolation.
3. Use absolute workspace-local SDK/Binaryen executable paths and explicit SDK sysroot. Drive the final-file target directly, rather than `all` or `doom`; missing tools must fail closed instead of entering Docker or source-building Binaryen.
4. Select Stage A initialization WAT and separate reviewed reachability graphs for trace/fixture-enabled and fixture-disabled builds. Review adapter engine-header include paths at [Makefile:240–243](../references/doom.wasm/Makefile#L240).

**Hidden side-effect paths:** embedded generation requires Python venv/pip setup ([Makefile:69–76](../references/doom.wasm/Makefile#L69)); missing Binaryen uses SSH clone/CMake/build ([128–142](../references/doom.wasm/Makefile#L128)); Docker may pull images. Example targets copy artifacts or run servers/dependency recipes. Hooks can format source or regenerate requirements/interface ([pre-commit config](../references/doom.wasm/.pre-commit-config.yaml)); the interface target invokes Rust ([Makefile:321–332](../references/doom.wasm/Makefile#L321)). `clean` recursively removes its output directory. None is part of the proposed native Stage A route; no Rust interface regeneration is needed.

### Real final-module and input-isolation evidence

**Proposed:** validate and inventory the copied final bytes after the constants merge. Node `WebAssembly.Module.imports/exports` supplies names/kinds; Binaryen `wasm-dis` supplies typed function signatures, global mutability, memory/table limits, and start-section review. Node's inventory alone cannot establish signatures. Record intermediate/final hashes and the exact final interface for each accepted build.

No-embed proof also needs explicit source/object/link-input inventories, compiler header dependencies or reviewed preprocessed adapter output, and a link map. Require empty generated-asset inputs and no stale embedded object reuse. String scans of stripped WASM are supplementary, not proof. Record source/profile/WAT/root-graph hashes, commands/flags/tool paths, asset identity, build results, final size/hash, and import/export signatures. A raw linked module or checked-in interface text cannot satisfy A1.

## 4. Verified initialization, title, render, and time behavior

### Existing initialization graph

**Source-verified:**

```text
initGame WAT
  → WASI _initialize
  → C _initializeDoom
  → doomgeneric_Create(0, argv)
      → framebuffer allocation
      → DG_Init → loading.onGameInit(640,400)
      → D_DoomMain
          → WAD loading and subsystem initialization
          → D_StartTitle
          → D_DoomLoop
              → TryRunTics                 [implicit scheduler entry]
              → graphics/buffer/view setup
              → D_StartGameLoop            [scheduler time baseline]
              → doomgeneric_Tick
                  → TryRunTics             [second implicit entry]
                  → sound update
                  → D_Display
```

Ordering comes from [init WAT:25–30](../references/doom.wasm/src/wat/merge-two-initialization-functions-into-one.wat#L25), [adapter:34–45](../references/doom.wasm/src/doom_wasm.c#L34), [doomgeneric_Create:12–23](../references/doom.wasm/doomgeneric/src/doomgeneric.c#L12), [D_DoomMain:1602–1613](../references/doom.wasm/doomgeneric/src/d_main.c#L1602), and [D_DoomLoop/doomgeneric_Tick:369–417](../references/doom.wasm/doomgeneric/src/d_main.c#L369).

`D_StartTitle` only sets `gameaction`, `demosequence=-1`, and pending advancement; it **does not establish `pagename`** ([d_main.c:532–535](../references/doom.wasm/doomgeneric/src/d_main.c#L532)). Normal `D_DoAdvanceDemo` clears advancement/action and its first sequence selects `GS_DEMOSCREEN`/`TITLEPIC`, with title-music setup and no ticker ([452–485](../references/doom.wasm/doomgeneric/src/d_main.c#L452)). Later sequences can defer demo playback.

**Proposed seam:** preserve graphics initialization, `V_RestoreBuffer`, and view-size setup; bypass both implicit scheduler calls and `D_StartGameLoop`; explicitly prepare only that first normal title transition after setup; return with rendering separate. Do not invoke `RunTic`, `G_Ticker`, `D_PageTicker`, later attract advancement, or an implicit neutral tic. The title draw branch has no `gametic` gate, unlike level drawing ([D_Display:186–225](../references/doom.wasm/doomgeneric/src/d_main.c#L186)). **Runtime hypothesis:** this preparation/setup order produces a valid title without simulation.

**Proposed guards:** protect initialization in WAT before `_initialize` runs; a C-only duplicate-init check occurs too late. Call WASI initialization once before controlled C startup, select controlled mode before engine work, and keep mode immutable. C wrappers need initialization state and a nonreentrancy/busy guard, explicit refusal for uninitialized/rejected/faulted instances, and legacy tick/key mixing prevention. Failed initialization requires a fresh instance. Imported callbacks must never call back into WASM.

### Rendering and scheduler containment

`D_Display` draws the title patch, applies `PLAYPAL` when entering a nonlevel state, updates display bookkeeping, draws menus, calls `NetUpdate`, and either finishes a frame or polls a wipe ([d_main.c:152–295](../references/doom.wasm/doomgeneric/src/d_main.c#L152)).

The actual `NetUpdate` definition is in **`d_loop.c`**, not `d_net.c`. It samples time and calls `BuildNewTic`, which invokes the registered native builder ([d_loop.c:132–233](../references/doom.wasm/doomgeneric/src/d_loop.c#L132)). Callers include `D_Display`, the scheduler, and four renderer sites ([r_main.c:723–739](../references/doom.wasm/doomgeneric/src/r_main.c#L723)). `RunTic` installs borrowed commands, advances pending demo state, and calls `G_Ticker` ([d_net.c:68–92](../references/doom.wasm/doomgeneric/src/d_net.c#L68)); it is not a render-only path.

**Proposed required branches:**

- Make central controlled-mode `NetUpdate` return before clock/network/build work, covering all callers.
- In controlled `D_Display`, bypass both wipe capture and completion/polling while retaining necessary drawing, palette, and state bookkeeping. No individual renderer patches are initially required.
- Call display through a guarded render-only wrapper, without scheduler, input pump, sound update, or state preparation. Render need not preserve display caches bit-for-bit, but it must preserve simulation state and time.

Frame flow is `D_PageDrawer → indexed I_VideoBuffer → palette conversion/2× scaling → DG_ScreenBuffer → DG_DrawFrame → ui.drawFrame`. See [i_video.c:169–223](../references/doom.wasm/doomgeneric/src/i_video.c#L169), [237–286](../references/doom.wasm/doomgeneric/src/i_video.c#L237), and [305–328](../references/doom.wasm/doomgeneric/src/i_video.c#L305). Existing dimensions are [640×400](../references/doom.wasm/doomgeneric/doomgeneric.h#L7), yielding **1,024,000 BGRA bytes**. Palette alpha is zero; copy into owned RGBA and force alpha to **255**, as the [browser example:42–62](../references/doom.wasm/examples/browser/doom.html#L42) does. A frame callback proves rendering, not tic counts.

### Fixed time and failure behavior

Legacy timer code uses `basetime == 0` as its initialization sentinel, truncates host ticks to `uint32_t`, and performs narrow tic conversion ([i_timer.c:34–63](../references/doom.wasm/doomgeneric/src/i_timer.c#L34)). Returning a fixed zero host clock alone is unsafe: [TryRunTics:636–737](../references/doom.wasm/doomgeneric/src/d_loop.c#L636) can wait indefinitely, and [wipe polling:278–295](../references/doom.wasm/doomgeneric/src/d_main.c#L278) can stall after its first iteration. Adapter sleep returns immediately for the usual one-millisecond request ([doom_wasm.c:154–175](../references/doom.wasm/src/doom_wasm.c#L154)).

**Proposed:** controlled `I_GetTime` returns an explicit integer virtual-tic value; millisecond getters derive `floor(1000*tics/35)` using wide arithmetic. A1 keeps virtual time at zero and bypasses the legacy baseline sentinel. Reads, renders, snapshots, refusals, and idle waits never advance it. Do not increment time on reads to make polling terminate.

Stock [I_Error:252–293](../references/doom.wasm/doomgeneric/src/i_system.c#L252) loops forever after error handling. [internal__proc_exit:48–67](../references/doom.wasm/src/internal__wasi-snapshot-preview1.c#L48) is not a reliable exit signal. Admission errors must return before engine startup; later synchronous engine hangs/traps are Worker-disposal cases, not successful initialization or resumable results. No fatal/quit redesign is required for A1.

## 5. External IWAD admission and WASM/Worker boundaries

### Exact input and ownership

**Proposed sole runtime input:** externally supplied `assets/freedoom-0.13.0/freedoom1.wad`, expected **28,795,076 bytes**, SHA-256 **`7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`**. The preceding read-only investigation matched both size and hash. Do not substitute vendored example WADs, embed replacement data, or reopen A0 provenance work.

**Source-verified:** current [DG_GetWads:79–118](../references/doom.wasm/src/doom_wasm.c#L79) trusts imported count/total, uses unchecked allocations and a count-sized stack VLA, trusts individual lengths, treats the first WAD as IWAD, and falls back to shareware when no WAD is supplied. `D_DoomMain` asks for bytes only after engine startup has begun ([1174–1202](../references/doom.wasm/doomgeneric/src/d_main.c#L1174)). [W_OpenFile/W_Read:31–44](../references/doom.wasm/doomgeneric/src/w_file.c#L31) retain the supplied pointer and perform unchecked `memcpy`; [W_AddFile:171–207](../references/doom.wasm/doomgeneric/src/w_wad.c#L171) trusts header-derived directory lengths and lump spans.

**Proposed:** after WASI initialization, admit/copy/validate exactly one IWAD before `doomgeneric_Create`. Cache an adapter-owned descriptor for `DG_GetWads` to return. Bytes must remain stable for the instance lifetime. Missing/invalid input returns a bounded adapter error before engine-create entry, with no embedded fallback.

| Boundary | Required proposed checks |
| --- | --- |
| Host input | Exact length/hash; at least 12-byte header; `IWAD` magic; little-endian signed count/offset nonnegative; positive bounded lump count; directory `offset + 16×count` within file; every lump position/size nonnegative and within file, using overflow-safe arithmetic; required title/palette/resource markers |
| `wadSizes` | Validate writable four-byte count/total spans in current memory; write count `1` and total `28,795,076` |
| `readWads` | Refresh views after allocation/growth; validate full destination and four-byte per-WAD length slot; copy exactly admitted bytes and write exact length |
| Adapter before engine | Enforce count/total bounds before allocation; check allocation; avoid unbounded VLA; validate returned length and exact total; independently check IWAD header/directory/payload bounds |

Structural checks do not establish resource-format or engine compatibility. A0 records **3,163 lumps** and a **20,938-byte DEHACKED lump**. This port [disables DeHackEd](../references/doom.wasm/doomgeneric/include/doomfeatures.h#L28) and compiles out automatic IWAD patch loading ([d_main.c:1204–1216](../references/doom.wasm/doomgeneric/src/d_main.c#L1204)). Record title/init outcome with that limitation; do not alter the WAD or enable support to make the experiment pass. No E1M1 compatibility claim follows.

### Host imports and memory discipline

The [adapter header](../references/doom.wasm/src/doom_wasm.h#L105) declares ten application imports. The actual final manifest may retain a subset; source declarations are not the final interface.

| Import group | Minimal Worker responsibility if retained |
| --- | --- |
| `loading.onGameInit`, `wadSizes`, `readWads` | Record/validate dimensions and supply the admitted IWAD with checked wasm32 little-endian writes |
| `ui.drawFrame` | Check the 1,024,000-byte span; immediately copy BGRA into owned RGBA; retain at most one pending frame |
| `runtimeControl.timeInMilliseconds` | Return `i64`-compatible JS `BigInt`, fixed `0n` for A1 if called; count host reads separately from C virtual-time reads |
| `console.onInfoMessage`, `onErrorMessage` | Validate pointer/length, copy bounded non-null-terminated text, cap retained logs; no reentry |
| `gameSaving.sizeOfSaveGame`, `readSaveGame`, `writeSaveGame` | Return zero; saving/loading is outside the experiment |

Reacquire memory views from current `memory.buffer` on each import and after any growth. Validate pointer/span arithmetic without wrapping; do not transfer or retain a WASM memory view as the frame result.

The [WASI trampoline WAT:26–35](../references/doom.wasm/src/wat/wasi_snapshot_preview1-trampolines.wat#L26) intends to resolve `fd_close`, `fd_fdstat_get`, `fd_seek`, `fd_write`, and `proc_exit` into C implementations. Do not assume an external WASI shim is needed. Inspect the real final imports and stop on unexplained survivors/new imports; any host-facing `i64` signature requires BigInt handling.

## 6. Native instrumentation and zero-tic proof obligations

**Proposed:** instrumentation is active from the first initialization attempt, without resetting away startup activity. Counters originate at actual hooks, not wrapper expectations, frame counts, or `gametic == 0` alone.

| Evidence | Verified location for proposed hook |
| --- | --- |
| Actual native command build | `G_BuildTiccmd`, before its first mutation at [g_game.c:300](../references/doom.wasm/doomgeneric/src/g_game.c#L300); completion before function return at 517 |
| All player-think entries | First executable statement of [P_PlayerThink:190](../references/doom.wasm/doomgeneric/src/p_user.c#L190), before actor writes/chainsaw adjustment and DEAD branch; count every player/state |
| Completed world body | Immediately after [P_Ticker's leveltime++:117](../references/doom.wasm/doomgeneric/src/p_tick.c#L117); paused/menu early returns are not completions |
| Actual outer tic | Immediately after [gametic++:728](../references/doom.wasm/doomgeneric/src/d_loop.c#L728), recording before/after values |
| WASI/C startup | Actual WAT `_initialize` invocation count, controlled C initializer entry, and engine-create entry |
| Containment/time | Scheduler entry/body, NetUpdate interception/body, wipe capture/polling, explicit title preparation, controlled time getters, and host clock reads |

The source search found one `P_PlayerThink` caller and one actual `gametic` increment. Keep all-player entries distinct from any future initially-live local-player metric. Preserve actual partial counts on failure; never clamp them to expected zero.

A bounded trace must report overflow explicitly, keep a sticky overflow flag/counters, and fail evidence rather than silently overwrite records. WASI initialization counting must survive initialization itself; do not rely on C counters that are reset after startup. Retrieve test traces only after synchronous operations return. All debug observation/trace exports and dedicated hang/trap fixtures belong to test profiles, separate from any future production ABI; the fixture-disabled final build must exclude them.

## 7. Minimal changes and proposed implementation checkpoints

### Scoped change inventory

All entries are **proposals**, not authorized changes. Paths are relative to the repository root.

| File/seam | One-line purpose |
| --- | --- |
| `references/doom.wasm/Makefile` | Add no-embed profile, isolated outputs, local-tool selection, and selectable init WAT/root graphs while preserving defaults |
| `references/doom.wasm/src/doom_wasm.{c,h}` | Pre-engine admission/ownership, immutable mode/init state/busy guard, render-only wrapper, and bounded test observations |
| New Stage A init WAT and reachability graphs | Guard before WASI initialization; retain reviewed lab operations and isolate test roots |
| `references/doom.wasm/doomgeneric/src/d_main.c` | Preserve graphics setup, skip implicit tics/baseline, prepare first title explicitly, and suppress controlled wipes |
| `references/doom.wasm/doomgeneric/src/d_loop.c` | Central NetUpdate suppression, scheduler diagnostics, and actual outer-increment hook |
| `references/doom.wasm/doomgeneric/src/i_timer.c` | Explicit controlled integer virtual-time branch |
| `references/doom.wasm/doomgeneric/src/{g_game,p_user,p_tick}.c` | Native builder, all-player entry, and world-completion hooks |
| Only necessary private headers/test trace support | Share mode/time/hooks without exporting engine structs |
| Proposed `experiments/stage-a/harness.html` and plain Worker JS | Local file selection, serialized calls, copied Canvas frames, watchdog, and bounded downloadable results |

An allocation-failure check in `doomgeneric_Create` is optional if needed to define framebuffer-allocation failure. Additional diagnostics should follow specific failures. Initially unnecessary: `G_Ticker` factoring, `d_net.c` changes, individual renderer changes, movement/thinker changes, DeHackEd/WAD edits, Rust regeneration, frameworks, or a public API. Legacy regression risk is concentrated in shared init/display/timer branches; preserve original default recipes, WAT, roots, and uncontrolled behavior.

### Dependency-ordered checkpoints

1. **(a) Additive no-embed profile and real final-module inventory.** Review exclusions/root selection and perform a development build checkpoint using installed tools, fresh output, and the complete transformation chain. Inventory actual final bytes and input/object isolation; do not initialize an unguarded development artifact.
2. **(b) Controlled zero-tic init and native traces.** Add guarded WAT/C startup, pre-engine admission, explicit title preparation, time/NetUpdate/wipe branches, and hooks from init onward. No stepping or phase API.
3. **(c) Minimal Worker/render/watchdog experiment.** Exercise guarded final bytes with verified input and the bounded harness described below.
4. **(d) Three clean acceptance-build inventories.** Build the completed trace/fixture profile twice from independent fresh output directories, then build the fixture-disabled profile once. Record all three final manifests/hashes; equivalent inputs/interface shape are required for the repeated profile. Explain hash differences; byte-identical outputs are desirable but not presumed. Verify test-export/code isolation in the fixture-disabled final module.

The development checkpoint in (a) is distinct from the **three planned clean acceptance builds** in (d). A preliminary artifact lacking later seams is not an acceptance artifact. Count every development build against the explicitly authorized resource/build budget; the three acceptance inventories do not grant an automatic allowance for extra builds. A development build can serve as an acceptance build only if it already contains the completed accepted source/profile and satisfies the clean-build/evidence requirements. Resolve any budget expansion before execution.

### Smallest browser and fault-containment experiment

**Proposed:** one local-file HTML with WASM/IWAD file inputs, Canvas, and bundled/embedded plain Worker text used to create a **classic Blob Worker**. Transfer selected buffers, instantiate in the Worker, then call init/render/snapshot explicitly. No server, framework, package manager, keyboard pump, frame/tick pump, network request, or Decisions call.

Serialize one operation at a time. Tag requests/results with run token, Worker generation, case, and operation ID. Imported callbacks only copy bounded data; publish the pending copied frame/result after a successful return. Preserve buffer ownership: transfers detach sender buffers, and recovery must obtain fresh bytes from the selected files or retained owned copies.

Install a **two-second main-thread operation watchdog before dispatch**, plus a 50 ms heartbeat. Target disposal/error handling within the following 250 ms and no attributable main-thread heartbeat gap above 250 ms. A Worker-local timer cannot interrupt synchronous stuck WASM. Dedicated test-only hang/trap exports exercise containment without using quit cleanup: terminate/discard the Worker, revoke its Blob URL, invalidate pending IDs, reject late responses, then create a fresh Worker and initialize/render again. A trap/timeout produces no successful receipt; a slow valid operation exceeding the deadline is a harness timeout, not permission to resume ambiguous work.

## 8. A1 acceptance tests and stop decisions

Every row is a **future acceptance criterion**, not a test result.

| Case | Required measurable observation |
| --- | --- |
| Final WASM + verified IWAD | Post-transform final bytes validate; one WASI/C init and explicit first title preparation; recognizable title frame at 640×400 |
| Initialization | Native builds / all player entries / completed world bodies / outer increments = **0/0/0/0**; no RunTic/G_Ticker/demo execution |
| Repeated render/snapshot | Return within deadline; valid copied frame; same four zero counts; fixed virtual time |
| Idle wait then render | No engine operation during wait; counters/time unchanged and no catch-up |
| Missing IWAD | Separate instance returns bounded host/adapter rejection before engine-create entry; no fallback |
| Malformed admission | Invalid count/total/length/header/directory/payload rejected before engine startup; test adapter rejection as well as host screening |
| Fixed-zero time | No scheduler body, native build, wipe capture/polling, or sleep loop; render completes |
| Duplicate init/reentry/mode mixing | Explicit refusal; no second WASI/C init or hidden simulation |
| Trace integrity | Hooks active through init; overflow explicit and fails evidence |
| Fixture-disabled isolation | Final module contains/exports no debug observation/trace or hang/trap entrypoints; approved lab init/render roots reviewed separately |
| Hang/trap containment | Main thread responsive; timeout/error disposes Worker; no success receipt; stale messages rejected; fresh Worker initializes/renders |
| Final interface | Exact import/export names, kinds, signatures, global mutability, memory/table limits, and start behavior recorded; no unexplained imports |
| Repeat clean builds | Two completed identical-profile builds have matching input records and equivalent interface; hashes retained/differences explained; third fixture-disabled inventory recorded |

**Stop and request the smallest concrete owner decision** when:

- Title setup needs an implicit tic: identify the dependency and review only a localized setup fix; do not silently prime simulation.
- Fixed-time rendering hangs: identify the remaining scheduler/poll path before changing clock semantics.
- Final imports differ unexpectedly: review the signature/call origin before adding a shim.
- Specified tools/assets are unavailable or changed: request restoration of the chosen input, not automatic download/substitution.
- Freedoom title/resources fail: record the exact incompatibility; asset changes or DeHackEd support require a new scope decision.
- Initialization requires broad engine changes: return to feasibility review before modifying simulation/player/WAD semantics.
- A valid operation exceeds the deadline or builds exceed the budget: discard ambiguous runtime state and obtain an explicit limit decision before another attempt.

## 9. Remaining uncertainties and authorization boundary

Runtime must still establish safe graphics/title setup without tics, retained palette/display behavior with wipes disabled, compatibility of the specified resources despite ignored DeHackEd content, actual final imports/exports, native hook retention, and Chrome Worker containment for real Doom. Source ordering selects a plausible seam; it does not prove those outcomes.

Title success would establish initialization/render feasibility only. It would not establish E1M1 compatibility, exact-tic stepping, lifecycle resumption, deterministic gameplay, public API behavior, or production delivery. Do not expand A1 to solve those questions.

This consolidation changes only `docs/doom-a1-investigation.md`. It performs no implementation, build, browser experiment, commit, push, issue edit, or network/API operation. **A1 remains unproved and unapproved for execution.** Separate authorization must cover the specific source/build/harness changes, all development and acceptance builds, Chrome/Worker execution, evidence writes, and resource limits before any proposed checkpoint begins.
