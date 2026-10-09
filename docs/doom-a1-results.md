# Stage A1 — first executable proof checkpoint

**FIRST PROOF PASS (owner manual run, 2026-10-09T20:58:08.918Z); A1 / Issue #3 NOT ACCEPTED.** The exact final transformed WASM loaded external Freedoom Phase 1 in a Chrome Worker, initialized once and returned a visible 640×400 title frame at time zero. Native counters show zero command builds, player-think entries, completed world bodies and outer simulation tics through this single init/render. The earlier CSP failure was corrected without rebuilding WASM. This proves the first vertical slice, not repeated rendering/idle isolation or full A1 acceptance.

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

## Checks and next checkpoint

Passed:

```sh
DOOM_BUILD_PROCESS_INTEGRATION=0 PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests -p 'test_build_doom.py' -v
node --check scripts/inspect_doom.mjs
git diff --check
```

Fixture result: **19 passed, 1 live process-integration test skipped**. Also passed Python AST / root-graph JSON parsing, extracted inline harness JS syntax via `node --check --input-type=commonjs`, and controlled C syntax checks using `tools/wasi-sdk-24.0/bin/clang --target=wasm32-unknown-wasi --sysroot=tools/wasi-sdk-24.0/share/wasi-sysroot -DDOOM_CONTROLLED_TITLE -Wall -fsyntax-only -Ireferences/doom.wasm/doomgeneric -Ireferences/doom.wasm/doomgeneric/include` for adapter plus changed engine C files. No Node engine instantiation was used as a substitute for Chrome.

**Next recommended check, after separate authorization:** extend the minimal harness to repeated render/snapshot pairs, a host idle delay and another render/snapshot, requiring unchanged zero work/time and no scheduler/wipe body. This is the next unproved isolation assumption. Missing-WAD and disposable hang/trap checks plus repeated/fixture-disabled build evidence remain subsequent A1 work. No new experiment, build or browser launch was performed while reviewing the supplied successful evidence.

Missing-WAD runtime refusal, repeated-init/reentry tests, multiple renders/idle waits, hang/trap containment, repeat/fixture-disabled builds, and full Issue #3 acceptance were **not run**. No A2/A3, Decisions API, proxy, server, commits, pushes or publication. Stop here pending review of this checkpoint.
