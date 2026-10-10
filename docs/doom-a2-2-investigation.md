# A2.2 source investigation: consecutive native tics

**Finding:** repeated stepping can reuse the A2.1 continuation. Generalize its
one-tic enforcement to a completed-tic count; replace two native key states only
after admission. No new ticker, scheduler, ring, or lifecycle dispatcher is needed.
This is an offline source finding, not A2.2 runtime acceptance.

## Baseline and evidence

- Branch `main`, HEAD `44e5abf235c39e79d115456499e543af8d170ca8`.
  Initial `git status --short --untracked-files=all`: empty.
- Vendor index: 234 ordinary paths, all mode `100644`; no gitlink, nested
  `references/doom.wasm/.git`, or `.gitmodules`.
- Existence only: ignored WASI SDK 24.0 clang/wasm-ld/sysroot, Binaryen 119
  wasm-as/merge/metadce, `assets/freedoom-0.13.0/freedoom1.wad`, and
  `references/doom.wasm/build/a2-1-first-trace/doom.wasm`, manifest, updated
  owner receipt and level PNG are present. No binary contents were read or hashed.
- Current report records core Chrome PASS for WASM
  `e926848cd0a3e763ea00300808a687ac72180dec250b82838db7354543fedf15`
  and IWAD `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`.
  It still explicitly leaves non-neutral READY refusal and zero-tic READY rendering
  pending (`docs/doom-a2-1-results.md:249–268`). This investigation does not
  revalidate receipts or complete those cases.
- No local Issue #4 body found by issue-name searches including ignored evidence;
  only an Issue #3 snapshot exists. Neither issue was fetched. The discussion's
  revised roadmap is an assumption supplied by the owner; the local A2 contract
  remains `docs/doom-stage-a-plan.md:220–224` and the original A2.2 sketch is
  `docs/doom-a2-implementation-seams.md:147–153`.

References below abbreviate `references/doom.wasm/` as **A/** and
`references/doom.wasm/doomgeneric/` as **E/**. Line numbers describe this HEAD.

## Admission and native ownership

Actual path: adapter init/busy guard → `G_A21Step` → `M_Ticker` → stock
`G_BuildTiccmd(&cmds[0], gametic)` → save built command → lend stack `cmds` through
`netcmds` → `G_TickerContinuation` → native copy/install → initial LIVE
`P_PlayerThink` entry → complete world/ST/AM/HU → restore `netcmds` → increment
`gametic`, commit virtual tic, mark outer completion
(`A/src/doom_wasm.c:138–143`; `E/src/g_game.c:2143–2179,791–890`).

The **one-shot step** is `a21_spent=true` at admission and `!a21_spent` in READY
(`g_game.c:2081–2083,2151–2152`). Removing that alone fails: step also requires
`A21ZeroWork` and fresh neutral history; hooks require counts=1 and tick/time=0;
postconditions require times=1; passive rendering expects only 0/1; timer commit
traps when its current count is nonzero (`g_game.c:2086–2100,2118–2177`;
`E/src/i_timer.c:37–40`).

Smallest generalization: use existing `a21_events[A21_OUTER]` as completed count
**N**, replacing spent. At each accepted request start, all nine event counts and
`gametic/leveltime/virtual tics` equal N. Builder/install/entry hooks require their
count N+1; build/entry still see times N. After continuation, eight inner counts
equal N+1, `leveltime=N+1`, `gametic/virtual=N`; restore the pointer, then commit
both clocks and outer count to N+1. Rendering validates the completed count before
and after display. Keep cumulative counts; do not reset them per request.
Timer commit accepts only current+1, with exhaustion checked before arithmetic.
All enforcement and ten-field native command equality remain always-on; trace
accessors remain behind `!DOOM_A1_NO_FIXTURES` (`g_game.c:1997–2024,2182`).

**Keep one-shot:** WAT WASI startup latch (`A/src/wat/controlled-title-init.wat:6–13`),
C `controlled_attempted/initialized` (`doom_wasm.c:101–115`), whole E1M1 load
attempt/completion and zero-work preparation (`g_game.c:2103–2115`). Keep busy/
active guards and original actor identity. Preserve all eligibility refusals:
not-loaded/title, pending action, menu/pause/demo/network/extra player, unsupported
map/skill/ticdup, missing resources, dead/reborn/replaced actor
(`g_game.c:2054–2083`). Ordinary refusal must precede menu, key writes, builder,
history and clocks. Post-admission mismatch remains a terminal trap, not refusal.

Use private integers **0=NEUTRAL, 1=FORWARD, 2=TURN_RIGHT**, exclusively; require
first accepted tic neutral and refuse other/unknown values without mutation.
After all preflight checks and `M_Ticker`, assign both native states completely:
`gamekeydown[key_up]=(input==1)`, `gamekeydown[key_right]=(input==2)`, immediately
before the single stock build. Check other keys/devices inactive while allowing
these two owned slots from the previous request. The loader already clears device
states (`g_game.c:578–585`); responders otherwise own key writes (`:706–713`).
Do not call responders or adapter key caches (`doom_wasm.c:262–280`). Validate
the admitted bindings as distinct/in-range and free of aliases to other builder
keys, and normal-speed configuration (no speed key/autorun hack). Current defaults
are separate arrows, speed RSHIFT, `joybspeed=2`, `dclick_use=1`
(`E/src/m_controls.c:29–38,181,196`; builder `g_game.c:317–318`).

Split fresh-history assertion from ongoing contributor checks. `turnheld` and all
six double-click fields must survive accepted requests: even neutral builds
increment double-click timers (`g_game.c:429–465`). Preserve function-static
lowres carry unchanged; lowres remains refused, so that branch is unreachable
(`:508–522`). Neutral release resets turnheld through stock builder logic, not
host cleanup. No TS command structure, event queue, mouse/joystick path, bitmask,
or public command ABI.

## Observations and expected gameplay

Extend existing private `G_A21Observe`/`a21ReadObservation`, not a world digest.
Existing observations already expose nine events, readiness/state/health,
installation/entry/actor equality, and all ten last built/entered fields;
`a1ReadCounter` supplies three clocks and forbidden-work counters
(`g_game.c:2211–2267`; `doom_wasm.c:152–159`; harness `:78–96`). Add raw player
x/y, angle, momx/momy, turnheld, the six double-click fields, both RNG indices,
owned key states and an ongoing-contributors-valid result. Reactiontime/flags
are useful small observations for diagnosing blocked consumption. Capture the
build tick index to associate each command with N. Read fields without ticking,
random calls or pointer serialization. Save a snapshot after every accepted tic;
last-command storage suffices because operations are serial.

| Input | Native command and effect under admitted defaults |
| --- | --- |
| NEUTRAL | forward/side/turn/buttons/chat=0; consistancy from native slot N % BACKUPTICS; remaining fields zero. Momentum can continue moving the player. |
| FORWARD | forward=25, side/turn=0 (`g_game.c:154,361–363,492`); grounded thrust=25×2048=51200 fixed units along native angle. |
| TURN_RIGHT | forward/side=0; turn=-320 for held tics 1–5, -640 at tic 6 onward: increment turnheld before testing `<6` (`g_game.c:156,181,324–353`). |

x/y and momentum are signed 16.16: divide by 65536 for map units
(`E/include/m_fixed.h:25–28`). Angle is unsigned 32-bit, one circle=2^32;
reinterpret returned i32 with `>>>0`. Compare modular deltas: -320×65536
(-1.7578125°), then -640×65536 (-3.515625°)
(`E/include/tables.h:78`; `E/src/p_user.c:123–133`). Six right tics total -12.3046875°.
RNG indices wrap modulo 256; compare indices, not cumulative RNG calls
(`E/src/m_random.c:44–58`). Both streams matter: ST_Ticker consumes M_Random once
per accepted tic (`E/src/st_stuff.c:817–822`). Three clocks must equal N and virtual
ms=floor(1000N/35), not N×28 (`i_timer.c:46–77`). Keep the experiment short and
trap counter exhaustion; signed clock/fixed-coordinate overflow is outside this
bounded experiment, not permission to wrap clocks.

**First forward tic:** source predicts immediate x/y displacement, approximately
0.78125 map units from rest if unobstructed. Player thrust precedes thinker XY
movement in the same world body (`p_user.c:219–227`; `p_tick.c:110–119`;
`E/src/p_mobj.c:374–377,127–145`). Player spawn reactiontime defaults zero
(`E/src/info.c:1099–1105`). Camera translation is immediate, but a single sub-unit
move need not look obvious at this resolution. Several forward tics should change
the view. Exact spawn clearance, coordinate direction and pixel change require
Chrome confirmation; do not demand both coordinates increase. Collision, airborne
state, reactiontime and MF_JUSTATTACKED can affect actual movement independently
of command identity (`p_user.c:205–225`).

## Minimal delta and manual falsification

Recommendation: reuse `stepNeutralControlled(i32)->i32` with this private vocabulary
in the new artifact despite its historical name. Retain the pinned A2.1 artifact/
harness mode and add a small A2.2 fieldset/mode. Alternative: add a separately
named step export and an old one-shot wrapper; clearer naming costs extra graph,
typed-fixture and export inventory changes and is unnecessary for this experiment.

Necessary native edits are the controlled block of **E/src/g_game.c**
(`G_A21Ready`, contributor checks, step, hooks, passive validation, observations)
and **E/src/i_timer.c** commit. Update comments/declarations in **E/include/g_game.h**
and **A/src/doom_wasm.{c,h}** as needed for vocabulary clarity; no new adapter
input storage. Existing **p_user.c/p_tick.c hooks and G_TickerContinuation stay**.
Both **A/src/reachability-controlled-title*.json** already retain step; expanding
observation indices needs no new export/graph changes. **scripts/inspect_doom.mjs:76–88**
already has the correct signatures and diagnostic gating; inventory remains exact.

In **experiments/stage-a/harness.html**, extend observations, add three choices,
replace A2.2 absolute 0/1 assertions with per-request deltas, replace its old
second-step refusal, and use an unknown value (e.g. 3) for invalid input.
Keep old A2.1 value-1 refusal tied to old bytes. Reuse frame copies/hash/Canvas,
watchdog and retirement (`:241–267,695–835`). Set a small A2.2 operation limit
such as 64 per Worker; 32 is too tight for per-tic observations plus 20-step
coverage. No global UI redesign. Update **tests/test_a21_contracts.py:38–59,94–121**
for admission order and repeated timer commits/duplicate-or-skipped commit traps;
retain continuation hash and comparator tests. Add a focused test of actual
native builder consecutive input/history, with inert dependency stubs, rather
than a host imitation of its arithmetic. Existing inspector fixtures in
**tests/test_build_doom.py:515–555** still check the unchanged inventory/gating.
Use existing wrapper/Make build graph (`scripts/build_doom.py:260–285`).

Proposed owner-only Chrome script after separate implementation/build approval:

1. Fresh Worker, new artifact hash and same IWAD; init/title render; prepare E1M1;
   snapshot and zero-tic READY render. Require no build/time; retained title at
   zero is allowed. Refuse FORWARD as first tic and unknown input, unchanged.
2. Explicit NEUTRAL; require each event and T/L/V 0→1; render baseline level.
   Send four FORWARD requests serially, saving each command/state; render.
   Require counters increase once/request, real position displacement and changed
   level view. Save receipt and PNG. This is the first falsifying experiment.
3. Send five consecutive TURN_RIGHT requests; save each trace (turnheld=1…5,
   turn=-320); render/snapshot. Start a **main-thread 2-second wait**, controls
   disabled, after the last reply. Send **no Worker requests**, including snapshots
   or renders, until it ends. Then snapshot, render, snapshot: authoritative
   fields/history/RNG/clocks unchanged. Next explicit TURN_RIGHT is held tic 6,
   turn=-640, and advances exactly once. Render; NEUTRAL resets turnheld naturally.
4. Retire; run steps 1–3 in a second fresh Worker with **10 seconds** as the only
   script change. Compare equal operation boundaries: commands, count deltas,
   state/health/actor checks, coordinates/momentum/angle, RNG/history/keys/clocks
   and matched render hashes. Exclude wall duration/heartbeat and presentation
   counters from authoritative comparison; inspect their expected render deltas
   separately. Record actual external wait lengths; idle wait has no WASM deadline.

Snapshots/timer reads are already passive; the existing A1 idle example is
main-thread-only (`harness.html:649–659`). Worker code has no engine timer loop.
Keep central `NetUpdate` interception **before all network/time/build work**
(`E/src/d_loop.c:194–203`): nonzero virtual time would otherwise permit extra
builds via display's one and renderer's four NetUpdate calls
(`E/src/d_main.c:275`; `E/src/r_main.c:723–739`). No-wipe display and startup
scheduler bypass remain (`d_main.c:180–189,404–428`); DG_GetTicksMs delegates to
the passive virtual clock (`doom_wasm.c:314–319`). Chat queue is initially empty,
and no admitted path calls its responder/enqueue: dequeue does not advance an
empty tail (`E/src/hu_stuff.c:309–332`). This restricted path needs no chat queue
instrumentation or lowres-carry refactor. Contributor admission plus native
counts/history and both RNG streams support **no hidden tic/no catch-up for this
script**, not universal world equivalence or complete replay determinism.

**STOP:** first unexpected refusal, trap/timeout/log truncation, count or command
mismatch, history/time/RNG mutation during observation/wait, scheduler/network
body/wipe/demo work, unchanged position/view after the forward block, wrong turn
acceleration, death/reborn/pending action or actor replacement. Retire and save
evidence; do not retry ambiguous work, reload, dispatch pending work or change
physics/assets to force success. Preserve synchronous pointer lending/restoration;
no native command pointer may outlive the stack request. Post-step eligibility
may close naturally: complete the already-entered world tic once, publish the
result, then refuse subsequent steps; do not require a newly dead actor to be LIVE
after completion or silently resume lifecycle work.

## Acceptance and next authorization

Minimal proposed **A2.2 PASS** is the above consecutive native input/movement/
turn-history proof plus paired message-free waits and passive rendering, with
always-on enforcement preserved. Twenty steps remain inexpensive useful coverage
(append forward/turn/release repeats); they are not an architectural requirement.
Full normalized world digest and separate menu/pause/pending-newgame/reload
fixtures can be deferred for this narrower claim; those refusals remain required
source behavior, but source inspection does not prove their browser acceptance.
Paired waits remain directly relevant and should run now. These are proposed
scope reductions, **not amendments to or closure of Issue #4**; its unavailable
body and full acceptance must be reconciled explicitly by the owner. Supplemental
A2.1 cases, diagnostics-disabled runtime evidence and broader lifecycle coverage
remain gaps. New A2.2 results cannot retroactively certify the old A2.1 artifact.

Next authorization to request: one bounded implementation of this repeated-step/
three-input path, focused native/source/typed-fixture and syntax checks including
diagnostics-disabled compilation, then **at most one fresh trace-enabled
controlled-title build initially**, followed by the owner-run Chrome script.
No automatic second build, Decisions integration or Issue #4 closeout.

Investigation checks: read-only Git/source/text inspection, ignored-path checks
and standard-library path existence checks; `git diff --check` passed. No tests,
compiler, build, inspector execution, WASM execution, network or Chrome ran.
Final `git status --short --untracked-files=all`:

```text
?? docs/doom-a2-2-investigation.md
```
