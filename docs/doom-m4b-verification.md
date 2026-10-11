# M4-B implementation and verification

Date: 2026-10-10. Initial checkout: `cd97907bbaafeb9b16fddbf68df60c38ce07d20b`;
initial `git status --short` was empty. Implementation is local, uncommitted.
Historical experiments, C/native sources, and `scripts/build_doom.py` are unchanged.
M4-A needed no material correction and was left unchanged.

The owner explicitly approved dependency resolution/installation, builds and
static serving, reserving **Chrome smoke testing for the owner**. Codex opened
no Chrome session and performed no authenticated request, API method call,
commit, push, or publication. Owner-supplied Chrome preparation receipts pass
the native/Canvas/idle checks below, the owner reports all browser requests
stayed local, and the supplied screenshot confirms a visible Doom frame.
Owner-run smoke verification is complete with the nonblocking Canvas performance
advisory recorded below. Milestone acceptance remains with the owner.

## Source changes and design

| Files | Responsibility |
| --- | --- |
| `.gitignore` | Ignore app dependencies, generated staging/identity/notices, dist. Existing engine/historical build ignores remain. |
| `build.sh` (executable) | Thin Bash orchestration: fresh fixtures-enabled controlled-title engine build, verified handoff, app-local Vite build; optional verified frontend-only reuse. |
| `scripts/stage_web.mjs` | Engine-input fingerprint/current receipt, successful manifest/typed-interface/byte checks, staging and output checks, license copying. Python compiler wrapper remains frontend-independent. |
| `scripts/check_worker.mjs` | Lightweight static Worker packaging regression check. |
| `app/package.json`, `app/package-lock.json`, `app/vite.config.js` | App-local npm dependencies, exact OpenAI 7.32.0 / Vite 7.3.6, lockfile v3, relative URLs. |
| `app/index.html`, `app/src/main.js`, `app/src/style.css` | Minimal IWAD/preparation/Canvas/evidence page, credential-free SDK probe, one-neutral-tic initialization and bounded passive diagnostics. |
| `app/src/worker-boundary.js`, `app/src/worker-source.js` | Verbatim accepted Worker copy; raw-text import with one narrowly validated export removal and `titleWorker()` invocation. |
| `app/README.md`, `docs/doom-m4b-verification.md` | Setup/build/smoke/license instructions and this observed evidence record. |

The only main-thread action dispatch is `action(mask=0,tics=1)`. Successful
preparation disables retries; a failed preparation retires its Worker before a
fresh attempt. No native/Worker protocol change, hidden step, keyboard driver,
request loop, AI UI, or timer-driven simulation was added. A single five-second
diagnostic wait invokes a read-only snapshot after the wait.

## Commands and observed results

Read the M4-A investigation, engine wrapper, actual inspector
`scripts/inspect_doom.mjs`, M3-E3 HTML/controller/Worker/results, and applicable
Stage A native preparation/action/passive checks before editing.

Read-only versions: Node **22.20.0**, npm **10.9.3**, Python **3.14.4**.
The successful engine manifest admits Clang/LLD **18.1.2**, WASI SDK **24.0**,
Binaryen **119**, and GNU Make **3.81**. Node comes from PATH, with no personal
absolute path in source.

| Command/check | Observed result |
| --- | --- |
| `bash -n build.sh`; `node --check app/src/main.js`; `node --check scripts/stage_web.mjs`; `node --check app/src/worker-source.js`; `node --check app/vite.config.js` | Passed. |
| `node scripts/check_worker.mjs` | Passed: exact source copy, export wrapper check/refusal, classic payload parses without execution. |
| `git diff --check` and separate whitespace check of new source files | Passed. |
| `npm view vite@7.3.6 version engines --json --cache "$PWD/tools/npm-cache"` | Registry confirms version and Node range `^20.19.0 \|\| >=22.12.0`. |
| `npm --prefix app install --package-lock-only --ignore-scripts --no-audit --no-fund --cache "$PWD/tools/npm-cache"` | Exit 0; app-local lockfile created (66 package entries, including platform optional dependencies). |
| `npm --prefix app ci --no-audit --no-fund --cache "$PWD/tools/npm-cache"` | Exit 0; 15 packages installed. No audit was run. |
| `./build.sh --frontend-only` before first build | Exit 1; missing current receipt refused with guidance to run full build. |
| `./build.sh` | Exit 0; fresh engine build and Vite production build, 231 transformed modules, no reported build errors/warnings. |
| `./build.sh --frontend-only` after full build | Exit 0; verified reuse and frontend rebuild, same engine output and emitted WASM identity. |
| `node scripts/stage_web.mjs verify public`; `node scripts/stage_web.mjs verify dist` | Passed after refusal fixtures were restored. |

Fresh engine output:
`engine/doom/build/m4b-runs/run.7puDxN/engine/doom.wasm`.
Manifest:
`engine/doom/build/m4b-runs/run.7puDxN/engine/evidence/manifest.json`.
Current selector: `engine/doom/build/m4b-current.json`.

Generated, staged, and emitted WASM all measured **360,156 bytes**, SHA-256:

```text
cc86ed8884ec04dbace3c541e8528a9f91839b79816cc79ce988af939d42dcb8
```

This matches the supplied preflight reference exactly. Build manifest is
`BUILD PASS`, `controlled-title`, fixtures enabled, `asset: null`; the typed
inspector validates the no-start controlled interface without instantiation or
export execution. Its `a1_acceptance` remains `NOT ESTABLISHED`. No `.wad` file
exists in dist. All generated binaries, notices, identities, dependencies,
engine outputs, npm cache and test receipts are Git-ignored. `git ls-files`
confirmed no staged WASM, dist or dependency path is tracked. New source files,
including the lockfile, remain untracked pending owner review/add/commit.

### Refusal and emitted-source checks

Bounded one-shot fixtures invoked `./build.sh --frontend-only` and observed exit
1 for a missing current receipt, missing selected WASM, changed engine input,
mismatched engine bytes, and failed engine manifest. `node scripts/stage_web.mjs verify public` observed
exit 1 for mismatched staged WASM. Each fixture restored only its own generated
data or temporary input; previous dist hash stayed unchanged. Diagnostics are
retained in ignored `tools/m4b-checks.json`. No failed check triggered engine
recompilation, artifact fallback, or download.

An AST inspection of the final JS using the installed Rollup parser found
**exactly one unchanged raw Worker source literal** and **zero runtime module
imports**. The classic payload parses. This confirms raw text survived the build;
it does not prove execution under Chrome/CSP. The SDK bundled successfully.
A separate installed-SDK Node import/probe reported **7.32.0** and
`typeof client.decisions.create === 'function'`, with no API method invoked.
That probe is not a browser or built-bundle runtime result.

### Isolated static delivery

Copied only final `app/dist/.` into `/tmp/doom-m4b-smoke.DQaBRw/` and started:

```sh
python3 -u -m http.server 8000 --bind 127.0.0.1 --directory /tmp/doom-m4b-smoke.DQaBRw
```

The loopback server is left running for owner smoke testing at
`http://127.0.0.1:8000/`. A Python HTTP checker fetched all ten emitted files;
all returned **200** and byte-identical contents. Resource details are retained
in ignored `tools/m4b-http-checks.json`:

| URL path (all on loopback origin above) | Bytes | Content type |
| --- | ---: | --- |
| `/index.html` | 1,858 | text/html |
| `/assets/index-oY7ZxwJj.js` | 397,553 | text/javascript |
| `/assets/index-CpWdWK_E.css` | 534 | text/css |
| `/doom-build.json` | 7,061 | application/json |
| `/doom.wasm` | 360,156 | application/wasm |
| `/notices/doom-LICENSE.txt` | 18,092 | text/plain |
| `/notices/openai/LICENSE` | 11,336 | application/octet-stream |
| `/notices/openai/src/_vendor/partial-json-parser/LICENSE` | 1,075 | application/octet-stream |
| `/notices/openai/src/_vendor/zod-to-json-schema/LICENSE` | 746 | application/octet-stream |
| `/notices/openai/src/internal/qs/LICENSE.md` | 1,588 | text/markdown |

Requests for `/experiments/m3-e3/controller.js`,
`/node_modules/openai/client.mjs`, and `/engine/doom/Makefile` returned expected
**404**. These were HTTP isolation checks, not browser resource observations.
Registry/package network access occurred during authorized acquisition. Codex
did not inspect browser Network state; no OpenAI request was issued by the
implementation session. Owner-reported Network/Console evidence is recorded below.

## Owner-supplied Chrome verification

The owner supplied this initial Chrome page output:

```text
OpenAI SDK 7.32.0 loaded · decisions.create available · requests disabled
```

The owner also reported nothing in the Console. This supports successful loading
of the bundled SDK and its credential-free method probe in the owner's Chrome
session. It is owner-reported evidence, not a Codex-observed browser session.

The owner subsequently pasted the successful preparation status, rendered-frame
label, and full preparation evidence JSON. The status was:

```text
Prepared E1M1 — neutral tic 1/1/1; snapshots, passive render and five-second idle unchanged.
```

Review of the supplied receipts supports these observations:

| Check | Supplied evidence |
| --- | --- |
| Assets | WASM 360,156 bytes / `cc86ed8884ec04dbace3c541e8528a9f91839b79816cc79ce988af939d42dcb8`; IWAD 28,795,076 bytes / `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`. Both match this build's expected identities. |
| Worker protocol | `load-i11 → init → prepare → snapshot → action → render → snapshot → snapshot → render → snapshot → snapshot`; exactly one action and two renders. |
| One-shot initialization | Pre-init counters all zero; `wasiInit`, `cInit`, `engineCreate`, `titlePrepare` each become 1. Init/prepare status 0; `titleReady` changes from 1 after init to 0 after prepare. |
| Prepared real E1M1 | Episode 1, map 1, skill 2, health 100; `ready`, `loadComplete`, `resources`, `liveActor`, `gameEligible`, `contributorsValid` all 1; `gamestate` and `gameaction` both 0. Loaded geometry includes 1,196 vertexes, 1,175 lines, 182 sectors, 2,057 segs, 682 subsectors, 681 nodes. |
| Before mandatory action | Native work counts and `nativeBuild`, `playerEntry`, `worldComplete`, `outerComplete`, `gametic`, `leveltime`, `virtualTicks` all 0; virtual time 0 ms. |
| Neutral action | Mask 0; requested 1, reported completed 1, independently verified 1; `APPLIED`, status 0, one completed step, `completionUncertain: false`. |
| After action | All nine native work counts and seven gameplay counters become exactly 1; virtual time 28 ms. Built/entered commands are neutral and equal; install/entry/actor equality flags all 1. |
| Frames | Both 640×400 frames at tic 1 have equal native and Canvas hashes (below), also equal across the passive render. |
| Passive isolation | Snapshots preserve counters/native state; second render changes `render/frame` from 1/1 to 2/2 and `netIntercept` from 5 to 10 while gameplay/native state stays at tic 1. |
| Idle | Requested minimum 5,000 ms; reported elapsed 5,007 ms; `unchanged: true`. Supplied before/after counters and native records match, with gameplay counts 1 and virtual time 28 ms. |
| Diagnostics | Supplied native logs are informational, with `logsTruncated: false` and no native error-kind record. This does not independently establish the post-preparation browser Console state. |

Both native and Canvas RGBA SHA-256 values, for both renders:

```text
ea416a166f395e8ed6fb60d3b417a1cacedd9b764f58282892d4e9caae8e5800
```

This also matches the historical M3-E3 neutral-first frame checkpoint. The supplied
page evidence demonstrates successful native preparation and rendering without
hidden gameplay advancement in this owner-run trial. "Independently verified"
describes the main-thread verifier rechecking the Worker's native step evidence,
not an independently operated Codex browser audit. No new runtime source defect
was shown, so no app/engine changes or rebuild were made for this evidence update.

The owner subsequently confirmed that **all requests were local to
`127.0.0.1:8000`** after checking Chrome's Network panel. This supports no observed
OpenAI or external CDN traffic during the owner-run smoke. An exact request-path
list, browser HTTP statuses, or exported Network capture was not supplied;
the independently checked static resource URLs are listed above.

The owner confirmed the Doom frame is visible and supplied a screenshot showing
the rendered first-person scene and HUD, successful preparation status, disabled
Prepare Doom button, tic 1, 640×400 label, and the matching RGBA hash. Codex
reviewed the supplied screenshot; it is visual evidence in addition to the
native/Canvas receipts, without operating the browser.

Owner-reported browser: **Chrome 154.0.8037.98 (Official Build), arm64**.
The owner initially reported an empty Console, then supplied this post-preparation
performance advisory from `index-oY7ZxwJj.js:349`:

```text
Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true.
```

The stack points to the Canvas readback used for pixel-hash verification.
`app/src/main.js` creates a normal 2D context and performs one `getImageData`
readback per render (two reads in this bounded preparation). The
[HTML Canvas specification](https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently)
defines `willReadFrequently` as marking a context for readback optimization.
This is a performance advisory, with no failed preparation, frame, native-state,
or hash check shown. No browser runtime error was reported. It is recorded as
nonblocking; no code change, rebuild, or repeat smoke was needed for M4-B.

The local build/static-delivery checks plus owner-run SDK/native/Canvas/idle/
visual/Network observations satisfy the exercised packaging smoke. This does not
claim Codex-controlled Chrome verification or owner milestone acceptance.

The default build was exercised on the current checkout with provisioned tools
and freshly installed app dependencies, using a fresh engine output and no
historical binary fallback. A separate fresh-clone build, other hosts, path-prefix
deployment, arbitrary IWADs, authenticated Decisions behavior, and redistribution
compliance were not tested or established. Manual steps and deployment/source
obligation caveats are in [app/README.md](../app/README.md).
