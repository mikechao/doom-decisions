# Stage A2.2: twenty explicit native tics and paired waits

**Source checks and the sole trace-enabled build PASS. Owner Chrome: PENDING.**
No Doom WASM exports were executed by Codex. This does not establish A2/Issue #4
acceptance or Decisions integration.

## Baseline and implementation

Branch `main`; starting HEAD `f309a81c9188fb2b39b4b7ed707ec3648df57f6c`;
initial `git status --short --untracked-files=all` empty. Investigation and A2.1
results were read in full. Read-only `gh issue view ... --json number,title,body,state`
retrieved current [Issue #1](https://github.com/mikechao/doom-decisons/issues/1)
and [Issue #4](https://github.com/mikechao/doom-decisons/issues/4); both remain open.
The current roadmap prioritizes native playable stepping, then minimum external
controls and Decisions. Issue #4 still requires 20 steps, passive rendering,
time/RNG/gameplay observations and paired waits; it was not amended.

The vendor remains 234 ordinary tracked `100644` files. Existing ignored WASI
SDK 24.0, Binaryen 119 and external Freedoom inputs were used; no dependencies
were downloaded or installed. Earlier outputs were preserved.

The controlled block in `references/doom.wasm/doomgeneric/src/g_game.c` now uses
`a21_events[A21_OUTER]` as cumulative completed count N. Admission checks the
completed boundary and supported input contributors. Each request performs:

```text
M_Ticker -> replace both owned native keys -> stock G_BuildTiccmd(N)
  -> lend stack commands through netcmds -> existing G_TickerContinuation
  -> native install -> initially LIVE P_PlayerThink entry -> completed P_Ticker
  -> ST/AM/HU returns -> restore netcmds -> gametic/virtual commit -> outer N+1
```

Every native build/install/entry/world/status/automap/HUD/menu/outer count must
advance exactly once. Build and entry see gametic/leveltime/virtual=N; stock
P_Ticker increments leveltime during its completed body. After all continuation
work, gametic and virtual commit to N+1 and all three clocks/counts agree.
The ten built/installed/entered fields and original actor identity are checked
without diagnostic exports. Unexpected partial work traps; it cannot return a
successful or ordinary refused result. Death/pending action after a completed
world tic closes subsequent eligibility; no lifecycle work is dispatched.

The historical export **`stepNeutralControlled(i32)` now accepts private selector
0=NEUTRAL, 1=FORWARD, 2=TURN_RIGHT**. First accepted tic must be neutral. Unknown,
first non-neutral, ineligible and unsupported input/configuration requests refuse
before menu, keys, builder/history or clocks. Only `gamekeydown[key_up/key_right]`
are replaced, inside admission. Other keys/devices, pause/save/weapon requests,
lowres turning, aliases, autorun and changed movement defaults are excluded.
Turnheld and double-click history are never reset. Lowres carry stays untouched
and unreachable. Init/load latches and busy/active guards remain.

`i_timer.c` accepts consecutive exact commits, traps duplicate/skipped commits
and checks overflow, including its signed millisecond observation range. Reads
remain passive. Existing central NetUpdate interception and no-wipe display are
unchanged. Stock builder and legacy continuation statements are unchanged.

Private observation indices 52–71 add x/y, unsigned angle bits, momx/momy,
turnheld, six double-click fields, both RNG indices, owned keys, contributor
validity, build tick index, reactiontime and flags. Accessors remain trace-only;
reads do not tick or consume RNG. Positions/momentum are signed 16.16 map units;
angle is modulo 2^32 per circle; RNG indices wrap modulo 256. Defaults produce
forward=25; right turn=-320 for held tics 1–5, then -640 at tic 6. Expected angle
deltas are -1.7578125° and -3.515625°. Neutral releases keys/turnheld but momentum
can continue moving the player. Exact movement/pixels await the owner experiment.

The existing HTML gains a small A2.2 fieldset and fixed manual script. Each click
sends one serial Worker operation; the wait sends none. A case has 20 accepted
tics, 38 Next clicks (including the main-thread wait), and 38 Worker operations
including load, bounded by 64. Receipts keep native observations after every
request and per-render pixel hashes. Normalization is an ordered JSON selection
of the existing authoritative counters and complete private observations, plus
operation/input/status and render hash; SHA-256 covers that transcript. It excludes
wall durations, heartbeat, logs and presentation counters. This is a selected
gameplay digest for this script, not a complete world/replay checksum. The second
receipt retains the first case even when comparison fails. Old A1/A2.1 modes
retain their historical pins; the old A2.1 artifact still has one-shot semantics.

## Checks and sole build

```sh
DOOM_BUILD_PROCESS_INTEGRATION=0 PYTHONDONTWRITEBYTECODE=1 \
  python3 -B -m unittest discover -s tests -v
node --check /private/tmp/doom-a22-harness-check.js
node --check scripts/inspect_doom.mjs
git diff --check
```

Suite: **32 tests, 31 passed, 1 skipped** (separately authorized live process-group
integration). Added checks execute extracted **actual** stock builder, controlled
step/hooks, comparator, accessors and timer with inert dependencies, in trace and
diagnostics-disabled configurations. Twenty consecutive inputs verify tick index,
native turn acceleration/release, double-click accumulation, pointer restoration,
counts and passive reads. Refusal fixtures preserve keys/commands/history/time;
missing/extra world completion, duplicate build, wrong command, clock drift and
actor replacement trap. These fixtures supply continuation boundaries and stub
eligibility/resources; they do not prove real E1M1 physics or browser eligibility.
Timer tests prove 20 commits, passive reads and duplicate/skip traps. Preservation
hashes cover stock builder and legacy continuation. Existing typed export/gating
fixtures pass unchanged. An inert Node VM checks the HTML pattern, normalization,
passive mismatch detection and absence of Worker messages during the wait;
it does not instantiate WASM or use a browser.

WASI `-Wall -fsyntax-only` passed for g_game/i_timer/p_user/p_tick in legacy,
controlled-trace and controlled-no-fixtures modes, and adapter C in both controlled
modes (14 invocations, zero warnings). Exact base flags:

```text
tools/wasi-sdk-24.0/bin/clang --target=wasm32-unknown-wasi
--sysroot=tools/wasi-sdk-24.0/share/wasi-sysroot -Wall -fsyntax-only
-Ireferences/doom.wasm/doomgeneric -Ireferences/doom.wasm/doomgeneric/include
```

Controlled modes add `-DDOOM_CONTROLLED_TITLE`; disabled mode also adds
`-DDOOM_A1_NO_FIXTURES`. Changed g_game syntax was rechecked in all three modes
before building. The extracted final HTML script passed Node syntax and its
focused VM check after artifact pinning/failure-evidence handling.

**Build attempts: 1; BUILD PASS, 3.76 seconds**, using the existing wrapper/Make
graph, two jobs, no embedded WAD and no second profile:

```sh
python3 -B scripts/build_doom.py --profile controlled-title \
  --out references/doom.wasm/build/a2-2-first-trace --jobs 2
node scripts/inspect_doom.mjs \
  references/doom.wasm/build/a2-2-first-trace/doom.wasm --profile controlled-title
```

| Identity | Value |
| --- | --- |
| Final WASM | `references/doom.wasm/build/a2-2-first-trace/doom.wasm`, 359,439 bytes |
| WASM SHA-256 | `98dd924ac24cfc42ab748efa6ae40161878b8f257da7d709cd6a9f7c768be46c` |
| External IWAD, rehashed locally | `assets/freedoom-0.13.0/freedoom1.wad`, 28,795,076 bytes |
| IWAD SHA-256 | `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d` |
| Manifest SHA-256 | `8ef64e80f9f8cb6f6f3d2ea478976aa68f24857495ff8627c38d9041a40eb682` |
| Captured compiled patch SHA-256 | `c39f4fc41a25c2fdd36a738fe45d5551bd7778c472f7672bfee66deb83e84b6b` |
| Final harness SHA-256 | `eff7b0b21a61867a09b327722726570c381f0a33394d38ac6b71c5d1f1abd69a` |

Evidence is under `references/doom.wasm/build/a2-2-first-trace/evidence/`:
manifest, Make/inspection/version logs, captured native patch and final harness/
test copies. The captured compiled patch was byte-compared with final native/
configuration/inspector changes: identical. Only harness pin/failure-evidence
handling and this report were completed after build. Eleven existing engine
warnings remain; no compilation errors. Tools recorded by the wrapper: Python
3.14.4, Make 3.81, Clang/LLD 18.1.2 (SDK 24), Binaryen 119, Node 22.20.0.

Both wrapper and independent final typed inspection pass: nine function imports
(console×2, saving×3, UI×1, loading×3), no host clock/WASI import or start section;
seven function exports: init/render/prepare `()->i32`, step/observation/counter
`(i32)->i32`, WASI count `()->i32`. Also unshared wasm32 memory, eight initial
pages with no maximum, fourteen immutable key globals; table 163/163. No raw
initializer, key-reporting, scheduler or native-private export survives. Inspector
reports `instantiated=false`, `exportsCalled=false`; code/data are opaque.
No new static call-shape matcher was built or used. Compiled gameplay behavior
requires the native Worker trace from Chrome.

## Owner Chrome protocol — PENDING

Manually open this HTML in Chrome; no server or automation. File-picker paths
(Cmd-Shift-G) are:

```text
/Users/mike/projects/doom-decisons/experiments/stage-a/harness.html
/Users/mike/projects/doom-decisons/references/doom.wasm/build/a2-2-first-trace/doom.wasm
/Users/mike/projects/doom-decisons/assets/freedoom-0.13.0/freedoom1.wad
```

Use only the **A2.2 fieldset** and keep the tab visible. The Next button describes
the request it will send. One click at a time; do not reload the page between cases.

1. Select WASM/IWAD. Click **Load fresh A2.2 / 2-second wait**. Require the hashes
   above. Click Next for init, title render, prepare, snapshot and zero-tic READY
   render. All simulation/time counts remain zero; a retained title is acceptable.
2. Next refuses first FORWARD and unknown input 3 without any counter/history
   change. Next executes explicit NEUTRAL and renders the real level: N=1.
   Next four FORWARD requests and render: N=5, actual x/y displacement and changed
   frame required. Inspect the Canvas; optionally save PNG here before continuing.
3. Next five TURN_RIGHT requests, render and snapshot: N=10, turnheld=5,
   built/entered angleturn=-320. Click the **message-free 2s wait**; controls are
   disabled until it ends. No Worker messages occur. Next snapshot must match
   pre-wait state/history/RNG/time, followed by passive render and snapshot.
4. Next sixth TURN_RIGHT: N=11, turnheld=6, angleturn=-640 and one angle delta;
   render. Next NEUTRAL: N=12, both owned keys/turnheld clear. Continue Next through
   `FORWARD, FORWARD, RIGHT, RIGHT, NEUTRAL, FORWARD, RIGHT, NEUTRAL`, then render/
   snapshot. N=20, all nine work counts and three clocks=20; virtual ms=571.
5. Require **2s LOCAL CHECKS PASS**; save JSON and Canvas PNG. Click **Retire A2.2
   Worker**, then **Load fresh A2.2 / 10-second wait**. Repeat exactly the same
   Next sequence; only the explicit wait changes. The final JSON includes both
   cases and `paired.equal=true` only if normalized traces and every matched render
   hash agree. Save that JSON and PNG for owner review. Same names receive the
   browser's usual download suffixes; preserve both cases and any N=5 image.

Each synchronous Worker request retains the 2,000 ms main-thread watchdog and
250 ms operation-gap check. Idle duration is separate. Heartbeat samples are
operation-only; short requests can have zero samples, which does not prove
sustained heartbeat/fault containment. No browser timing result is claimed here.

**STOP on first fault, watchdog, error/log truncation, unexpected refusal,
count/command/history/angle mismatch, lack of forward displacement/view change,
death/pending work, or unexplained idle/paired divergence.** The harness retires
the Worker and keeps failure operations; save JSON immediately. Do not retry an
ambiguous result, reload a level or change engine/assets to force success.

## Remaining acceptance and final paths

Actual Chrome movement/rotation, rendering at zero/nonzero tics, 20-step native
traces and paired wait/digest agreement are all PENDING. The selected digest does
not cover every sector/thinker/weapon state. Separate real-WASM menu/pause/pending
newgame/reload refusals, diagnostics-disabled compiled runtime evidence and broader
lifecycle coverage were not run. A2.1's two supplemental cases remain pending for
its historical bytes; this new artifact cannot retroactively certify them. Issue
#4 acceptance requires owner evidence/reconciliation, not this build receipt.

Changed paths are exactly the status below. Headers document the experimental
selector/boundaries; no extra production paths were needed. Adapter C, p_user,
p_tick, reachability graphs, inspector, build driver/Make, WAT and historical
reports remain unchanged. No Chrome, Decisions call, asset download, second
build, issue edit or Git staging/commit/push occurred. Final `git diff --check`
passed. Final `git status --short`:

```text
 M experiments/stage-a/harness.html
 M references/doom.wasm/doomgeneric/include/g_game.h
 M references/doom.wasm/doomgeneric/src/g_game.c
 M references/doom.wasm/doomgeneric/src/i_timer.c
 M references/doom.wasm/src/doom_wasm.h
 M tests/test_a21_contracts.py
?? docs/doom-a2-2-results.md
```
