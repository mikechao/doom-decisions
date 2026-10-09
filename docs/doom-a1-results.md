# Stage A1 — executable proof and build checkpoints

**FIRST PROOF PASS; REPEAT/IDLE PASS; MISSING-IWAD PASS; FAULT-CONTAINMENT PASS (owner manual runs, 2026-10-09); A1 / Issue #3 NOT ACCEPTED.** The exact final transformed WASM loaded external Freedoom Phase 1 in a Chrome Worker, initialized once and returned a visible 640×400 title frame at time zero. The second experiment produced six identical title frames across a two-second idle interval, with unchanged zero simulation work/time. The third confirmed native missing-IWAD refusal before engine startup. The fourth contained separate WASM trap/hang fixtures and recovered the title in two fresh Workers. The earlier CSP failure was corrected without rebuilding WASM. These bounded experiments do not establish full A1 acceptance.

**Final two-build static checkpoint: PASS; both final artifacts passed owner Chrome title smokes.** One fresh trace build and one fresh fixture-disabled build passed from the same frozen source. The trace smoke measured zero native work; the disabled smoke verified initialization, second-init refusal and the matching title without diagnostic counters. The owner-approved two-build substitution is now visibly amended in the plan; Issue #3's original three-build wording still requires explicit acceptance reconciliation. **A1 remains NOT ACCEPTED pending separate final review.**

## Baseline and changes

Started at repository root `/Users/mike/projects/doom-decisons`, clean `main`, HEAD `cbf0db8926016842f31bac966cebf1a0a64e9614`. The committed [implementation guide](doom-a1-implementation-seams.md) was present and remains unchanged. [Issue #3](https://github.com/mikechao/doom-decisons/issues/3) was read through the GitHub connector; its full acceptance matrix remains outside this first checkpoint. The successful `da74f6c…` shareware baseline was not rebuilt or instantiated.

Changed paths:

- `scripts/build_doom.py`, `scripts/inspect_doom.mjs`, `references/doom.wasm/Makefile`: additive `controlled-title` profile, conditional embed admission/generation, selected controlled initialization WAT/root graph, exact profile-aware typed inspection. Existing shareware invocation fixture still passes.
- `references/doom.wasm/src/doom_wasm.{c,h}`: bounded external-IWAD admission before engine creation, lifetime-owned bytes, guarded init/render and read-only counters; controlled fallback and host clock removed.
- `references/doom.wasm/doomgeneric/src/{d_main,d_loop,i_timer}.c`: preserve graphics setup, perform initial title advancement without scheduler/ticker/baseline setup, intercept NetUpdate, bypass wipe capture/polling and freeze time.
- `references/doom.wasm/doomgeneric/src/{g_game,p_user,p_tick,f_wipe}.c`, new `doomgeneric/include/a1_trace.h`: cumulative native work/demo/wipe hooks. Legacy builds compile hooks to no-ops.
- New `references/doom.wasm/src/wat/controlled-title-init.wat` and `src/reachability-controlled-title.json`: one-shot WASI/C startup and experimental exports only. No hang/trap fixtures or fixture-disabled profile added.
- New [experiments/stage-a/harness.html](../experiments/stage-a/harness.html): local file selectors, Blob Worker, one init/render, copied opaque RGBA Canvas frame, bounded JSON/PNG downloads and 2-second main-thread operation watchdog.
- `tests/test_build_doom.py`: synthetic profile admission/export isolation checks; this results document.

The narrow source correction from the guide was header ordering: Doom's `false`/`true` enum must be parsed before `<stdbool.h>` when the adapter includes engine state headers. Syntax checking caught this before the single build. Controlled mode is compile-time immutable; no later-stage control ABI was introduced.

## Observed build evidence

Executed once:

```sh
python3 scripts/build_doom.py --profile controlled-title --out references/doom.wasm/build/a1-first-proof --jobs 2
```

Result: **BUILD PASS**, 3.686 seconds. Tools recorded by the wrapper: Python **3.14.4**, GNU Make **3.81**, WASI SDK **24.0** / Clang and LLD **18.1.2**, Binaryen assembler/merge/metadce **119**, Node **22.20.0**. Existing local tools/assets were reused; no downloads, installations or legacy Make entrypoints.

Final artifact: `references/doom.wasm/build/a1-first-proof/doom.wasm`, **354,684 bytes**, SHA-256 **`bd4115cf78f9f2dc5e594206491398bd2b591a4e808d67f72265870051d3bb84`**. A subsequent read-only rehash matched the manifest. The build log retains link → WASI trampoline merge → controlled initialization merge → metadce → constants merge → final copy. Inspector compiled metadata only: `validate:true`, `instantiated:false`, `exportsCalled:false`, no start section.

Ignored local evidence (not published):

- [evidence/manifest.json](../references/doom.wasm/build/a1-first-proof/evidence/manifest.json): exact Make/inspection argv, tool/source/profile identities, source patch, final hash and typed inventory.
- [evidence/inspection.stdout.log](../references/doom.wasm/build/a1-first-proof/evidence/inspection.stdout.log): complete typed final interface.
- [evidence/no-embed.json](../references/doom.wasm/build/a1-first-proof/evidence/no-embed.json): inspected actual link command and all **80** object inputs, **80** dependency files, transformation commands. No embedded object, generated embedded directory or embedded-header dependency; manifest `asset:null`. Fresh output rules prevented stale object reuse. The generator's source identity in metadata does not mean it ran.
- `evidence/make.stdout.log`, `make.stderr.log`: effective commands and warnings. Warnings include existing engine unused-variable/pointer-sign/unsigned-abs warnings and a controlled-only unused legacy `basetime`; no compilation errors.

Exact final function imports (all are functions; `void` means no WASM result):

| Import | Signature |
| --- | --- |
| `console.onErrorMessage`, `console.onInfoMessage` | `(i32,i32) → void` |
| `gameSaving.writeSaveGame` | `(i32,i32,i32) → i32` |
| `gameSaving.readSaveGame` | `(i32,i32) → i32` |
| `gameSaving.sizeOfSaveGame` | `(i32) → i32` |
| `ui.drawFrame` | `(i32) → void` |
| `loading.onGameInit`, `loading.readWads`, `loading.wadSizes` | `(i32,i32) → void` |

Nine imports total; no external WASI imports. The baseline host-clock import disappeared as expected because controlled timer/adapter sources return zero.

Exact final exports: `initControlled()→i32`, `renderControlled()→i32`, `a1WasiInitCount()→i32`, `a1ReadCounter(i32)→i32`; one wasm32 unshared `memory` (initial **8 pages / 524,288 bytes**, no declared maximum); fourteen immutable i32 globals:

```text
KEY_LEFTARROW=172 KEY_RIGHTARROW=174 KEY_UPARROW=173 KEY_DOWNARROW=175
KEY_STRAFE_L=160 KEY_STRAFE_R=161 KEY_FIRE=163 KEY_USE=162
KEY_SHIFT=182 KEY_TAB=9 KEY_ESCAPE=27 KEY_ENTER=13 KEY_BACKSPACE=127 KEY_ALT=184
```

Nineteen exports total. No `initGame`, `tickGame`, key-reporting, raw WASI initializer or engine-private exports survive. The constants merge remains intact. Internal funcref table has minimum/maximum **163** entries (baseline: 169); the controlled profile removes reachable legacy control/timing paths.

## Browser checkpoint and native observations

External `assets/freedoom-0.13.0/freedoom1.wad` was rehashed with `shasum -a 256` and matched **`7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`**. It was not copied into a compiled object. The successful manual receipt independently reports this WAD hash and the exact final WASM hash above.

Installed Chrome version read from application metadata: **154.0.8037.98**. Intended run method: open the harness as a local file in Chrome, select the final artifact above and external IWAD, click **Run first proof**, inspect visible TITLEPIC, save JSON and PNG. No file-access restriction was observed because browser setup never reached navigation; there is no basis for a static-server fallback.

Browser setup failed, including after a connection reset, with the earliest actionable error:

```text
Cannot find module '/Users/mike/.codex/plugins/cache/openai-bundled/browser/26.901.51231/scripts/browser-service.mjs'
imported from /private/var/folders/48/c3jqdtj515v6d81tl9gc_wvw0000gn/T/.tmpOmVpBa/trusted-worker.js
```

The available skill/client is version `26.915.31945`; its service file exists, but the trusted runtime references the older missing path. No installed plugin files were modified and no alternate browser/automation surface was substituted. The [Browser skill](</Users/mike/.codex/plugins/cache/openai-bundled/browser/26.915.31945/skills/control-in-app-browser/SKILL.md>) requires: “Do not use external MCP browser-control tools, separate browser automation servers, or other browser skills for this surface.” Setup failed before an agent existed to request runtime troubleshooting documentation.

The automation failure above is historical. The owner now runs Chrome manually; no further Codex browser automation or Browser-skill troubleshooting is intended.

### Owner manual attempt and narrow correction

Owner-supplied JSON records `FIRST PROOF FAIL` at `2026-10-09T20:53:33.509Z`, Chrome user-agent `Chrome/154.0.0.0`, selected files `a1-first-proof.wasm` and `freedoom1.wad`. The owner copied/renamed the final WASM into `~/Downloads` because the file picker had trouble with the repository build path. A subsequent `shasum -a 256 /Users/mike/Downloads/a1-first-proof.wasm` matched the build hash above; the current copy is byte-identical. This failed receipt itself does not include its computed WASM hash.

Only `load` returned, with `ok:false`, empty logs and this error:

```text
CompileError: WebAssembly.compile(): Compiling or instantiating WebAssembly module violates the following Content Security policy directive because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: "script-src 'unsafe-inline'".
```

The Blob Worker started and reached WASM compilation; this is not evidence of a file-picker, IWAD, engine or fixed-clock failure. Source ordering puts Freedoom length/hash admission before this compilation call. Native initialization was never attempted, so zero native work is not a collected counter result.

Correction: add **`'wasm-unsafe-eval'`** to the harness's `script-src`. This specifically permits WebAssembly compilation without granting JavaScript string evaluation ([MDN script-src documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)). The Blob Worker inherits the harness policy. No WASM/source rebuild, clock change or server is required to address this demonstrated CSP defect. Refresh/reopen the corrected repository HTML before retrying; an older copied HTML retains the defect. Syntax/whitespace checks only were performed after the correction; no browser was launched.

For this failed attempt, native counters/frame were unavailable and `watchdogFired:false`. The successful retry below supplies the missing first-proof observations.

Counter accessor indices 0–13 are `cInit, engineCreate, titlePrepare, nativeBuild, playerEntry, worldComplete, outerComplete, schedulerEntry, netBody, netIntercept, wipeEntry, demoLoad, render, frame`. Indices 14–17 read actual `gametic`, `leveltime`, controlled `I_GetTime()` and title readiness; the separate WAT accessor counts actual WASI startup calls. Host cannot reset counters. Hooks precede native-builder/player mutations, follow actual world/outer completion increments, and distinguish NetUpdate interception from its body.

### Successful owner manual retry

Owner supplied `/Users/mike/Downloads/a1-first-proof.json` and `a1-title.png`. Receipt date: **2026-10-09T20:58:08.918Z**, user-agent `Chrome/154.0.0.0`. All three operations returned `ok:true`; init/render statuses are **0**. Worker operation elapsed times: **load 27.2 ms, init 11.8 ms, render 4.5 ms**. Main-thread watchdog was configured for **2,000 ms** and did **not fire**. This does not exercise hang containment.

Read-only checks matched receipt WASM/WAD hashes to the admitted identities and matched browser import/export names/kinds exactly to the final static inventory. Every pre-init counter was zero. Actual cumulative snapshots:

| Counters / observations | After load, before init | After init | After render |
| --- | ---: | ---: | ---: |
| `wasiInit`, `cInit`, `engineCreate`, `titlePrepare`, `titleReady` (each) | 0 | 1 | 1 |
| `nativeBuild`, `playerEntry`, `worldComplete`, `outerComplete` (each) | 0 | 0 | 0 |
| `schedulerEntry`, `netBody`, `wipeEntry`, `demoLoad` (each) | 0 | 0 | 0 |
| `gametic`, `leveltime`, `virtualTicks` (each) | 0 | 0 | 0 |
| `netIntercept`, `render`, `frame` (each) | 0 | 0 | 1 |

Both initialized snapshots report **640×400**. The attached PNG is visually the Freedoom **Phase 1 / 0.13.0** title artwork; PNG header inspection confirms 640×400. Receipt raw RGBA frame SHA-256: **`d6c8cfd39fb13d32e9ec6ab2778dc3a17dd3216c423183012a28da8f6f344525`**. Decoded PNG pixels were not independently rehashed; the raw frame hash comes from the Worker. Encoded PNG is **90,145 bytes**, SHA-256 **`aab99c921b67ce791bb82d224fa854351898bb2a1741cc7bfdf8cf2521e81260`**. JSON file SHA-256: **`b08c8debccfe08e26c3b0be1f1ef87aab385bbca508374112ad1e177dbfe2922`**.

Exact owner evidence is retained locally, without modifying Downloads originals: [manual receipt](../references/doom.wasm/build/a1-first-proof/evidence/manual-20261009T205808Z.json) and [title PNG](../references/doom.wasm/build/a1-first-proof/evidence/manual-20261009T205808Z.png). Logs are not truncated and contain no `error` entries; they retain the port's general Freedoom compatibility warning. This title result does not establish map compatibility. Receipt JSON does not record the page URL, so launch scheme is not independently captured.

## Experiment 2 — repeated renders and idle (owner manual)

Implementation baseline: `main`, HEAD **`0535aa369905b9dcd6a560356b71d3cc450d092a`**, initially clean. Only `experiments/stage-a/harness.html` changed for the experiment: a separate repeat/idle action, read-only Worker `snapshot` operation and bounded receipt, preserving first-proof behavior. One Worker/instance performs load/init once, five render/snapshot pairs, a main-thread idle delay with no dispatched messages, a snapshot, then a sixth render/snapshot pair. The existing 2,000 ms per-request watchdog excludes the intentional idle delay. No engine/build changes or WASM rebuild occurred.

Owner supplied `a1-repeat-idle.json` and `a1-repeat-idle-title.png`, receipt date **2026-10-09T21:14:48.819Z**, user-agent **Chrome/154.0.0.0**. Verdict: **REPEAT/IDLE PASS**, with **A1 NOT ACCEPTED**. Independent receipt checks verified all **15** ordered operations succeeded: one load, one init, six renders and seven read-only snapshots. WASM/WAD hashes match the exact admitted artifacts above, rehashed locally; import/export names/kinds match the first-proof inventory. Load took **20.8 ms**, init **11.6 ms**, renders **2.2–7.6 ms**, snapshots **0–0.1 ms**. All init/render statuses are **0**, all frames report **640×400**, and `watchdogFired:false`.

| Observation | Verified result |
| --- | --- |
| Before init | All 19 counters zero |
| `wasiInit`, `cInit`, `engineCreate`, `titlePrepare`, `titleReady` | Each 1 after init and at every later boundary |
| `render`, `frame`, `netIntercept` | Each N after render N (1–6) |
| `nativeBuild`, `playerEntry`, `worldComplete`, `outerComplete`, `schedulerEntry`, `netBody`, `wipeEntry`, `demoLoad`, `gametic`, `leveltime`, `virtualTicks` | Each zero at every boundary |
| Each read-only snapshot | Full counter object equals preceding render/snapshot |
| Idle | **2,001.6 ms** elapsed; all counters identical before/after, including render/frame/interception counts staying 5 |
| After idle | Sixth render succeeds normally; render/frame/interception counts become 6 |

All six Worker-reported raw RGBA hashes equal **`d6c8cfd39fb13d32e9ec6ab2778dc3a17dd3216c423183012a28da8f6f344525`**, also matching the first proof. The final attached PNG visibly shows Freedoom Phase 1 TITLEPIC; its header is 640×400 and its encoded bytes exactly match the first-proof PNG (**90,145 bytes**, SHA-256 **`aab99c921b67ce791bb82d224fa854351898bb2a1741cc7bfdf8cf2521e81260`**). Decoded pixels were not independently rehashed. Initialization logs are untruncated, contain no error entries, and retain the general Freedoom compatibility warning.

Exact evidence is preserved in ignored local output: [repeat/idle receipt](../references/doom.wasm/build/a1-first-proof/evidence/repeat-idle-20261009T211448Z.json) (**21,005 bytes**, SHA-256 **`deca6fd686b84d0e79a48ea83618fd8306bb5ee716fc40f739e863fd9ca41148`**) and [final title PNG](../references/doom.wasm/build/a1-first-proof/evidence/repeat-idle-20261009T211448Z.png). Downloads originals remain intact. The receipt records the operation order and measured idle duration, while the inspected harness establishes that the idle interval dispatches no Worker messages; it does not record the page URL. This proves repeated title rendering and idle isolation for this instance/sequence, not hang containment, arbitrary lifecycle cases or gameplay.

## Experiment 3 — missing-IWAD refusal (owner manual)

Implementation baseline: clean `main`, HEAD **`951923aa13bb25d5d0f02061e946888d822eaa84`**. Only `experiments/stage-a/harness.html` changed for this experiment. Its explicit missing-IWAD mode bypasses JavaScript WAD admission, pins the existing final WASM hash, and supplies count/total zero through validated memory in `loading.wadSizes`. It records unexpected callbacks as failures, transports the actual native status, and dispatches only load, one init and one read-only snapshot. No engine/WAT edits or rebuild occurred; positive experiment paths remain intact.

Owner supplied `/Users/mike/Downloads/a1-missing-iwad.json`, receipt date **2026-10-09T21:25:29.301Z**, user-agent **Chrome/154.0.0.0**. Verdict: **MISSING-IWAD PASS** (expected negative test), with **A1 NOT ACCEPTED**. All three operations returned `ok:true`: load **2.4 ms**, native init **0.4 ms**, snapshot **0 ms**. The receipt hashes the selected `a1-first-proof.wasm` to the final identity above, independently rehashed locally; import/export names/kinds match the first-proof inventory. WAD selection is `null`.

| Observation | Verified result |
| --- | --- |
| Pre-init | All 19 counters and four callback counts zero; `frameProduced:false` |
| Actual `initControlled()` status | **`-2`** |
| `wasiInit`, `cInit` | Each 1 after refusal |
| All other 17 native counters | Zero, including engine/title startup, rendering, simulation work and virtual time |
| `wadSizes` | Called once; checked memory readback reports count=0, total=0 |
| `readWads`, `onGameInit`, `drawFrame` | Each called zero times |
| Post-refusal snapshot | All counters/callback observations unchanged; `frameProduced:false` |
| Failure handling | `watchdogMs:2000`, `watchdogFired:false`; no error, trap or truncated logs reported; init logs empty |

This is native refusal evidence, not a JavaScript admission failure: [`AdmitExternalWad`](../references/doom.wasm/src/doom_wasm.c#L57) returns false for count other than one; [`_initializeControlled`](../references/doom.wasm/src/doom_wasm.c#L97) returns `-2` before `engineCreate` and `doomgeneric_Create`. The [WAT wrapper](../references/doom.wasm/src/wat/controlled-title-init.wat) propagates the native return value after one WASI initialization. No render was requested and no frame callback occurred; no PNG is expected. This does not exercise invalid-but-present WADs, repeated initialization or hang/trap containment.

Exact [missing-IWAD receipt](../references/doom.wasm/build/a1-first-proof/evidence/missing-iwad-20261009T212529Z.json) is retained in ignored local evidence (**6,225 bytes**, SHA-256 **`e74f0d552a7f34f4bafd887c4ca9af532b8c45711ee71e67beed6de0fc778f12`**), preserving the Downloads original.

## Experiment 4 — simplified Worker fault containment (owner manual)

Implementation baseline: clean `main`, HEAD **`fa927f76064ca891f823a98e3c36c78d9d19f880`**. Only `experiments/stage-a/harness.html` changed: two inline, import-free WASM fixtures with adjacent equivalent WAT, a fault action using the existing main-thread watchdog, heartbeat/disposal observations and two fresh Doom recoveries. The **34-byte trap** executes `unreachable`; the **39-byte hang** executes an unconditional `loop/br`. Their SHA-256 values are **`17dc0b5ef1bc192036c9f8bb6dfc95a38af3517baa2a3d626ae65df4d7322611`** and **`f8dd9cf3439b3928de845c4519350d97ec3cdc18ab6755df791ed96e002918c2`**, matching the inspected inline bytes and independently assembled WAT. Doom C/WAT/build configuration and its final artifact remain unchanged.

Owner supplied `a1-worker-faults.json` and `a1-worker-faults-title.png`, receipt date **2026-10-09T21:44:15.743Z**, user-agent **Chrome/154.0.0.0**. Verdict: **FAULT-CONTAINMENT PASS**, with **A1 NOT ACCEPTED**. All **10** ordered operations match the intended sequence: for each fixture, load → fault execution → fresh Doom load/init/render. The two fault executions are correctly recorded as `ok:false`; the other eight operations are successful. Each fixture reports successful validation/compilation and an execution-start message before its synchronous WASM call.

| Observation | Trap | Hang |
| --- | --- | --- |
| Actual negative outcome | `WebAssembly.RuntimeError`, `unreachable`, phase `execute`; **0.2 ms** | Main-thread watchdog timeout; **2,001.4 ms** |
| Watchdog fired | false | true, expected |
| Main-thread heartbeat | Not required for the prompt trap response | **40** beats at 50 ms nominal interval; maximum gap **51.7 ms**, including interval boundaries |
| Disposal | Handlers cleared, `terminate()` called; **0.5 ms** after test start | Termination call **1.4 ms** after deadline; disposal/handler cleanup **1.5 ms** after deadline, within 250 ms |
| Fault accepted as successful operation | false | false |
| Fresh recovery load / init / render | **20.6 / 11.4 / 4.4 ms** | **16.8 / 11.0 / 4.3 ms** |

The receipt's top-level `watchdogFired:true` is the intentional hang outcome. Both recovery paths independently report the admitted final WASM and Freedoom hashes, matching local rehashes and the original import/export inventory. Each recovery starts with all **19** counters zero; after init, `wasiInit`, `cInit`, `engineCreate`, `titlePrepare`, `titleReady` are each **1**, and after render `render`, `frame`, `netIntercept` are each **1**. All eleven simulation/scheduler/body/wipe/demo/time counters remain **0** at every boundary. Both init/render statuses are **0**, dimensions **640×400**, logs untruncated with no error entries. Recovery buffers are reread from the selected files, and inspected source creates each recovery Worker only after disposing of the faulty one and removing its handlers. No fault success acknowledgment appears in the receipt; this does not inject or independently test a synthetic late reply.

Both recovery frame hashes equal the first proof's **`d6c8cfd39fb13d32e9ec6ab2778dc3a17dd3216c423183012a28da8f6f344525`**. The final supplied PNG visibly shows Freedoom Phase 1 TITLEPIC, has a 640×400 header, and is byte-identical to the first-proof PNG (**90,145 bytes**, SHA-256 **`aab99c921b67ce791bb82d224fa854351898bb2a1741cc7bfdf8cf2521e81260`**); decoded pixels were not independently rehashed. Exact [fault receipt](../references/doom.wasm/build/a1-first-proof/evidence/worker-faults-20261009T214415Z.json) (**23,049 bytes**, SHA-256 **`c6f1aca340baf93394506cffc13e2faf7e0ff2895074121516415be148bb9e05`**) and [recovery PNG](../references/doom.wasm/build/a1-first-proof/evidence/worker-faults-20261009T214415Z.png) are preserved in ignored local evidence, leaving Downloads originals intact.

This establishes the simplified browser Worker containment checkpoint using separate synchronous WASM faults and successful fresh Doom recovery. It does not exercise Doom's own fatal/quit paths, add fault exports to Doom, or establish production supervision/full Stage D containment.

## Final two-build verification and owner Chrome smokes

Started clean on `main`, HEAD **`c0d80a3c761b26155916f15f4bebd949860cd6a2`**. Changes: `scripts/build_doom.py`, `scripts/inspect_doom.mjs`, `tests/test_build_doom.py`, vendor `Makefile`, `doomgeneric/include/a1_trace.h`, `src/doom_wasm.{c,h}`, and new `src/wat/controlled-title-init-no-fixtures.wat` / `src/reachability-controlled-title-no-fixtures.json`. The positive harness, existing init WAT/root graph and gameplay sources were unchanged. Code/configuration was frozen before the two builds; no source edits or replacement builds occurred between them. Documentation changed afterward.

Selection: **`--profile controlled-title --without-a1-fixtures`**, admitted only for controlled-title, maps to Make **`A1_FIXTURES=0`** and **`DOOM_A1_NO_FIXTURES`**. Omitting it retains traced controlled-title by default; shareware admission/invocation is unchanged. Counter hooks become no-ops and C counter storage/accessor are omitted. The disabled WAT omits the diagnostic WASI counter/accessor but retains its private attempted-state guard. `_initializeControlled` now checks a real **`controlled_attempted`** bool in both modes and sets it before any imported WAD callback; no lifecycle guard reads a diagnostic counter. Busy/readiness, external-WAD admission, frozen time, title preparation and render isolation remain active independently of fixtures.

Exactly these two real builds ran, in previously unused ignored directories:

```sh
python3 scripts/build_doom.py --profile controlled-title --out references/doom.wasm/build/a1-final-trace --jobs 2
python3 scripts/build_doom.py --profile controlled-title --without-a1-fixtures --out references/doom.wasm/build/a1-final-no-fixtures --jobs 2
```

| Final artifact under `references/doom.wasm/build/` | Result / duration | Bytes | SHA-256 | Exports |
| --- | --- | ---: | --- | ---: |
| `a1-final-trace/doom.wasm` | BUILD PASS / **3.697 s** | 354,705 | `3521a5be4bf79f20d783abe2b736f36087730f293a1efd07a55423e3d169fe8c` | 19 |
| `a1-final-no-fixtures/doom.wasm` | BUILD PASS / **3.744 s** | 354,393 | `647ee4031a4067639a915aa2747f0613f3f0997bc1bcd6797a50256946cae1fd` | 17 |

Both manifests record the same HEAD, pre-build worktree status, configuration identities, toolchain and source-patch SHA-256 **`a2b46ae4f09712ebe59a94e349ff6a5f5df70dbee05ae67d5b96e49891474b5e`**. Selected WAT/root contents are copied into each evidence directory; a full tracked patch including tests is also retained with the comparison. Tool versions remain Python **3.14.4**, Make **3.81**, SDK **24.0** / Clang and LLD **18.1.2**, Binaryen **119**, Node **22.20.0**. Builds started at **21:57:54Z / 21:58:00Z on 2026-10-09**. No downloads, installations or legacy targets ran.

Both final modules pass `WebAssembly.validate` and exact typed inspection **without instantiation/export calls**, with no automatic start section. The nine typed application imports match the earlier inventory exactly (no WASI/host-clock imports). Shared exports are `initControlled()→i32`, `renderControlled()→i32`, one unshared wasm32 memory (**8 pages / 524,288 bytes**, no maximum), and the same fourteen immutable i32 key globals/values. Only trace retains `a1ReadCounter(i32)→i32` and `a1WasiInitCount()→i32`. Both internal funcref tables remain **163/163**. Wrong-mode inspection and unexpected diagnostic exports/signatures fail closed in focused fixtures.

Actual inventories show **80** C compilations, **80** linked objects and dependency files, and **172** identical unique dependency inputs per mode. Seven objects differ, exactly the adapter and six hook-containing engine units (`d_main`, `d_loop`, `f_wipe`, `g_game`, `p_user`, `p_tick`); 73 object hashes match. Normalizing output paths, the disabled define and selected WAT/root names leaves identical compilation/link/transformation commands. The graph remains **link → WASI trampoline merge → controlled init merge → metadce → constants merge → final copy**. The disabled module is 312 bytes smaller; differing hashes/content are expected across diagnostic modes, not reproducibility failures.

No WAD file, generated embedded directory/C/header, embedded object, embed command or embedded-header dependency appears in either actual build inventory; both manifests have **`asset:null`**. Generator identity in source configuration is not a generated/link input. Final copies equal their constants-merge outputs. Final disassembly confirms each `initControlled` retains an early private-global refusal (`-1`), sets that guard before the WASI/C calls, and retains the native lifecycle byte guards before `wadSizes`. Disabled preprocessing of all seven hook/accessor units contains no `a1_counts` or `a1ReadCounter` references; its final WAT contains neither test accessor. These are static retention/removal checks, not runtime reentry results.

Evidence: [trace manifest](../references/doom.wasm/build/a1-final-trace/evidence/manifest.json), [disabled manifest](../references/doom.wasm/build/a1-final-no-fixtures/evidence/manifest.json), each directory's `inspection.stdout.log`, `build-inventory.json`, `final.wat`, `controlled-init-final.wat.txt`, source snapshots and Make logs; disabled `trace-removal-check.json`; [two-mode comparison](../references/doom.wasm/build/a1-final-trace/evidence/two-build-comparison.json). Existing `a1-first-proof/doom.wasm` remains untouched and rehashes to **`bd4115…`**; Freedoom remains external and rehashes to **`7323bc…`**. Each new build logs the same **12 warnings** (existing unused variables/constants, pointer-sign and unsigned-absolute-value warnings, including controlled `basetime`); no build/inspection errors.

**Explicit owner-authorized deviation:** one fresh trace build plus one fresh disabled build substitutes for the original two equivalent trace builds plus one disabled build. It demonstrates the diagnostic-on/off boundary, **not independent same-profile rebuild reproducibility**, and does **not** satisfy the original three-build criterion as written. [Issue #3](https://github.com/mikechao/doom-decisons/issues/3), Scope, says: “Save three clean-build inventories as planned (two same trace-profile, one fixture-disabled), artifact hashes, source/tool/asset manifests and machine-readable results.” Its previously fetched body is retained in `a1-final-trace/evidence/issue3-at-verification.json`; no network check or issue mutation was performed during reconciliation. The [visible A1 plan amendment](doom-stage-a-plan.md#a1--final-wasm-and-observable-controlled-initialization) records the substitution while preserving the original pipeline, allowance, trace/pass and authorization clauses as history. The owner must explicitly reconcile Issue #3 at separate final acceptance/closeout. The static comparison's `browser_executed:false` describes its earlier build checkpoint; subsequent owner runtime observations follow below.

### Owner Chrome verification of the new final trace artifact

**FIRST PROOF PASS**, owner receipt dated **2026-10-09T22:11:33.327Z**, Chrome **154.0.0.0** on macOS. The unchanged harness loaded `a1-final-trace.wasm`; its measured SHA-256 exactly matches **`3521a5be4bf79f20d783abe2b736f36087730f293a1efd07a55423e3d169fe8c`**, the new local final transformed trace artifact and inspection record. External Freedoom hashes to **`7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`**. Receipt import/export names and kinds match that artifact's typed static inventory.

The operation order is exactly **load → init → render**, all successful, taking **20.8 / 12.2 / 4.4 ms** respectively; native init/render statuses are **0**. All 19 counters are zero before init. After init, `wasiInit`, `cInit`, `engineCreate`, `titlePrepare`, `titleReady` are each **1**, with every other counter zero. After render those five stay **1**, and `render`, `frame`, `netIntercept` become **1**. Throughout, `nativeBuild`, `playerEntry`, `worldComplete`, `outerComplete`, `schedulerEntry`, `netBody`, `wipeEntry`, `demoLoad`, `gametic`, `leveltime`, `virtualTicks` remain **0**. The **2,000 ms watchdog did not fire**; no error or truncated logs were reported. The engine's generic Freedoom compatibility warning appears in informational startup logs, as in the original proof.

The supplied PNG visibly shows the **640×400 Freedoom Phase 1 TITLEPIC**. Receipt RGBA frame SHA-256 is **`d6c8cfd39fb13d32e9ec6ab2778dc3a17dd3216c423183012a28da8f6f344525`**, matching the original proof. PNG header dimensions and exact byte equality with the original proof were independently checked; decoded pixels were not independently rehashed. Exact [receipt](../references/doom.wasm/build/a1-final-trace/evidence/manual-20261009T221133Z.json) (**14,756 bytes**, SHA-256 **`fd53ec1e266ff5fd866be1f882da60ac7371b7fecefc10cbfe6dbaf0c93b5e93`**) and [PNG](../references/doom.wasm/build/a1-final-trace/evidence/manual-20261009T221133Z.png) (**90,145 bytes**, SHA-256 **`aab99c921b67ce791bb82d224fa854351898bb2a1741cc7bfdf8cf2521e81260`**) are preserved under ignored final-trace evidence, leaving Downloads originals unchanged.

This closes the new-trace **single-init/single-render** runtime gap caused by moving lifecycle guards off diagnostic counters. Experiments 2–4 still certify the original **`bd4115…`** artifact; this receipt does not rerun or transfer their complete coverage to the new SHA. The original artifact and harness hash pins remain unchanged.

### Owner Chrome verification of the final fixture-disabled artifact

**FIXTURE-DISABLED PASS**, owner receipt dated **2026-10-09T23:03:47.098Z**, Chrome **154.0.0.0** on macOS. Selected WASM SHA-256 **`647ee4031a4067639a915aa2747f0613f3f0997bc1bcd6797a50256946cae1fd`** matches the existing final disabled artifact, manifest and static inspection. External Freedoom SHA-256 is **`7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`**. Runtime import/export names and kinds match **nine imports / 17 exports**, with neither `a1ReadCounter` nor `a1WasiInitCount`. The retained `initControlled()→i32` / `renderControlled()→i32` signatures come from static inspection of those pinned bytes; Chrome reflection did not independently parse typed signatures.

One fresh Worker returned **load-no-fixtures → init `0` → init-again `-1` → render `0`**, in **23.2 / 13.2 / 0 / 4.8 ms** respectively. The second init is an expected native refusal, not another successful initialization. All four callback counts were zero after load. After initial init and refused init, cumulative callbacks were unchanged: **wadSizes=1, readWads=1, onGameInit=1, drawFrame=0**. Render increased only **drawFrame to 1**. The **2,000 ms watchdog did not fire**; no error or truncated logs were reported. The generic informational Freedoom compatibility warning remains as in the trace proof.

The visible **640×400 TITLEPIC** has receipt frame SHA-256 **`d6c8cfd39fb13d32e9ec6ab2778dc3a17dd3216c423183012a28da8f6f344525`**, matching the trace proof. PNG dimensions and byte equality with the preserved original first-proof PNG were reverified; decoded pixels were not independently rehashed. Owner-local [JSON receipt](/Users/mike/Downloads/a1-no-fixtures.json) is **10,082 bytes**, SHA-256 **`2d5b76059ab938eca10ce36630e5af847704ef44fc9ef7126cf22e04b50248a4`**; [title PNG](/Users/mike/Downloads/a1-no-fixtures-title.png) is **90,145 bytes**, SHA-256 **`aab99c921b67ce791bb82d224fa854351898bb2a1741cc7bfdf8cf2521e81260`**. These supplied files remain in Downloads, outside version control; no corresponding smoke copies were found in the final build evidence directories, and none were created in this documentation-only step. Build manifests/comparison remain in ignored local directories linked above.

This closes the fixture-disabled initialization/refusal/title smoke gap. **`nativeCountersAvailable:false`: it does not independently measure native command builds, player/world/outer tics or virtual time.** Direct zero-work evidence belongs to the trace-enabled artifact. No gameplay, level compatibility or production failure handling is established. **A1 remains NOT ACCEPTED pending separate final review and explicit Issue #3 acceptance reconciliation.**

## Checks and next checkpoint

Passed:

```sh
DOOM_BUILD_PROCESS_INTEGRATION=0 PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests -p 'test_build_doom.py' -v
node --check scripts/inspect_doom.mjs
git diff --check
```

Fixture result: **19 passed, 1 live process-integration test skipped**. Also passed Python AST / root-graph JSON parsing, extracted inline harness JS syntax via `node --check --input-type=commonjs`, and controlled C syntax checks using `tools/wasi-sdk-24.0/bin/clang --target=wasm32-unknown-wasi --sysroot=tools/wasi-sdk-24.0/share/wasi-sysroot -DDOOM_CONTROLLED_TITLE -Wall -fsyntax-only -Ireferences/doom.wasm/doomgeneric -Ireferences/doom.wasm/doomgeneric/include` for adapter plus changed engine C files. No Node engine instantiation was used as a substitute for Chrome.

Experiment 2 harness checks passed before the owner run: extracted inline JavaScript and serialized Worker syntax via `node --check`, inspection of the unchanged first-proof checks and message-free idle block, and `git diff --check`. During evidence review, Python standard-library assertions checked every operation/checkpoint, complete counter snapshots, idle equality, frame hashes, PNG header/byte equality and artifact/interface identities; `git diff --check` passed again. Codex did not launch a browser or rebuild WASM.

Experiment 3 checks passed before the owner run: inline JavaScript and serialized Worker syntax via `node --check`, static comparison of the preserved positive render/idle sequences and CSP, and `git diff --check`. Receipt review independently asserted operation order, exact native status, all counters and callback observations, unchanged snapshot, artifact/interface identity and watchdog outcome. `git diff --check` passed after documentation. No browser launch, rebuild or additional runtime experiment occurred during review.

Experiment 4 checks passed before the owner run: page and both serialized Worker syntax via `node --check`, fixture validation/compilation without execution in Node, exact WAT-to-byte comparison with installed Binaryen `wasm-as`, and static preservation checks for the Doom Worker, Experiments 1–3 engine sequences, CSP and 2,000 ms pre-dispatch watchdog. Receipt review asserted both fixture identities/outcomes, operation order, heartbeat/disposal limits, complete recovery counter snapshots, artifact/interface identities and PNG header/byte equality. `git diff --check` passed after documentation. No browser launch, fixture execution or Doom rebuild occurred during Codex evidence review.

Final build checks: **22 fixture tests passed, one live process-integration test skipped** using `DOOM_BUILD_PROCESS_INTEGRATION=0 PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests -p 'test_build_doom.py' -v`. Also passed `node --check scripts/inspect_doom.mjs`, Python AST/root JSON parsing, both initialization WAT assemblies, adapter C syntax in both modes, static reinspection of the old traced/shareware modules, real-artifact/manifest/inventory assertions, disabled preprocessing, final disassembly guard checks and `git diff --check`. Neither final module was instantiated by Codex; no second equivalent trace build or Chrome execution ran.

**Next recommended checkpoint:** separate final review of the recorded evidence and remaining coverage, with explicit owner reconciliation of Issue #3's three-build criterion against the amended two-build plan. Both final artifact title smokes are complete. The existing positive experiment assumptions and separate Experiment 4 fault modules remain unchanged; A2 requires separate authorization.

Receipt review of the new trace first proof passed independent standard-library assertions for artifact/interface identities, exact operation order, all cumulative counters, numeric statuses, watchdog outcome, frame hash, PNG dimensions and byte equality. Only evidence copies and this document were written; `git diff --check` passed.

Fixture-disabled receipt review reverified local artifact/WAD hashes, exact interface names/kinds, operation order/statuses, unchanged startup callbacks across refusal, one frame callback, watchdog/log outcome, frame hash and PNG header/byte equality. The documentation reconciliation rechecked manifests/comparison and changed Markdown links, preserved pending implementation/harness files byte-for-byte, and passed `git diff --check`. No builds, tests, browser execution or network access were repeated for this documentation-only task.

Repeated-init on the new trace artifact, reentrant-init runtime cases, and repeat/idle/native-refusal reruns on the new trace SHA remain **untested**; the disabled artifact's sequential second-init refusal is now tested. A second equivalent final trace build was **deliberately omitted** under the owner-approved substitution, so independent same-profile rebuild reproducibility remains unverified. Full Issue #3 acceptance has **not been granted**. No A2/A3, Decisions API, proxy, server, commits, pushes or publication. Stop here pending separate final review.
