# Issue #11: minimal native controls investigation

## Context and scope

Recorded 2026-10-10. Issue #11 / Milestone 2 follows completed A2 / Issue #4
under **narrowed prototype acceptance**. Issue #1 prioritizes minimal external
controls, then Decisions-driven gameplay; the old A3→B→C→D sequence is no longer
the critical path. Issue status and scope are owner-supplied context: live issue
bodies were not fetched. Historical results still contain pending/open language;
that does not supersede the supplied roadmap.

This is a source investigation and recommended design, **not implementation or
verified Milestone 2 acceptance**. Implementation requires separate owner
authorization. The investigation used local inspection only: no network, builds,
tests, browser/Worker execution, downloads or Git mutations.

## Baseline and existing control path

Investigated branch: `main`; HEAD:
`368b2afbd30d53cb58890f424042e36bf97de1d8`. `git status --short` was empty before
and after investigation, and before this documentation change. Read root
`AGENTS.md`; no relevant nested instructions were found. Evidence read:
`docs/doom-a2-2-results.md` and relevant implementation/evidence sections of
`docs/doom-a2-1-results.md`, plus the source and fixtures below. References are
repository-relative line numbers at that HEAD.

| Boundary | Source-backed behavior and reference |
| --- | --- |
| Export → adapter | `stepNeutralControlled(i32)` requires initialized/not busy and delegates to `G_A21Step`: `references/doom.wasm/src/doom_wasm.h:15`, `references/doom.wasm/src/doom_wasm.c:138`. |
| Admission → input | Selector is **0=neutral, 1=forward, 2=right turn**. First accepted tic must be neutral. Admission precedes `M_Ticker`, then both owned keys are assigned anew: `references/doom.wasm/doomgeneric/src/g_game.c:2184`. |
| Builder → installation | Stock `G_BuildTiccmd` builds from native state; controlled code verifies ten named fields, lends stack commands through `netcmds`, and restores its previous pointer after the continuation: `references/doom.wasm/doomgeneric/src/g_game.c:296`, `:2204`, `:2213`. Native copy/install checks equality: same file `:803`, `:2163`. |
| First live-player consumption | The first `P_PlayerThink` hook verifies original live actor, command equality, build/install counts and pre-tic clocks before native mutations: `references/doom.wasm/doomgeneric/src/p_user.c:196`, `references/doom.wasm/doomgeneric/src/g_game.c:2171`. |
| World → outer completion | Player/thinker/special work finishes before `leveltime++` and the world marker: `references/doom.wasm/doomgeneric/src/p_tick.c:110`. ST/AM/HU return markers follow: `references/doom.wasm/doomgeneric/src/g_game.c:883`. Count checks precede `gametic++`, exact virtual commit and outer completion: same file `:2217`; `references/doom.wasm/doomgeneric/src/i_timer.c:38`. |
| Observation | Native accessors expose counts, built/entered commands, equality flags and readiness: `references/doom.wasm/doomgeneric/src/g_game.c:2261`. Worker calls synchronously, then observes and reports status: `experiments/stage-a/harness.html:258`. |

## Findings / crucial assumption

**SUPPORTED within the isolated A2 path:** controlled held inputs can be fully
replaced before each accepted tic while preserving the stock builder and native
verification. Extending this to six inputs is a source-supported inference;
the extension has not been demonstrated in compiled Chrome WASM.

- Current ownership covers only forward/right. Other keys, mouse/joystick
  buttons and axes, pause/save/weapon requests, autorun and low-resolution
  turning are excluded; binding aliases are refused. Six-key ownership must
  extend these guards (`references/doom.wasm/doomgeneric/src/g_game.c:2049`).
- Stock movement, turn, fire and use compose independently
  (`references/doom.wasm/doomgeneric/src/g_game.c:335`). `turnheld` persists
  across consecutive turns, including direction changes; turning accelerates
  at tic six. A non-turning tic resets it (same file `:322`).
- Use acts on the first held tic, not repeatedly during a continuous hold.
  A consumed non-use tic clears `usedown`
  (`references/doom.wasm/doomgeneric/src/p_user.c:265`). Current completion
  unconditionally requires `!usedown`, so normal use would trap
  (`references/doom.wasm/doomgeneric/src/g_game.c:2219`).
- Fire follows weapon timing, `attackdown` and refire history. Releasing its
  command bit does not cancel an ongoing weapon animation
  (`references/doom.wasm/doomgeneric/src/p_pspr.c:242`, `:266`). Neutral removes
  controlled input; it does not erase physical momentum. Native chainsaw effects
  can alter movement after entry verification
  (`references/doom.wasm/doomgeneric/src/p_user.c:205`).
- Double-click timers persist, but absent device/strafe contributors keep their
  activation states/counts inactive. Low-resolution carry is excluded
  (`references/doom.wasm/doomgeneric/src/g_game.c:429`, `:508`, `:2067`). Do not
  reset histories to manufacture stateless behavior.
- Ordinary refusals precede input/history/tic work; a refused command leaves
  the previous controlled keys intact
  (`references/doom.wasm/doomgeneric/src/g_game.c:2189`).

Isolation depends on retaining the current export surface and bypassing event
processing (`references/doom.wasm/src/reachability-controlled-title.json:1`,
`references/doom.wasm/doomgeneric/src/d_loop.c:133`). The chat queue is not
explicitly checked by admission; fresh-instance/no-event-path isolation implies
it remains empty. Unexpected chat output would fail command verification, not
become an ordinary refusal (`references/doom.wasm/doomgeneric/src/hu_stuff.c:309`).

## Recommended minimal design

Use a private six-bit vocabulary: forward, back, left/right turn, fire, use;
zero is neutral/release. Reject unknown bits and opposing forward/back or
left/right pairs before mutation. Movement+turn and movement/turn+fire are useful
now; use normally needs a one-tic pulse followed by non-use. Other non-conflicting
combinations can compose without special native handling.

Replace **every owned key** on every accepted tic, including omitted inputs.
Preserve stock builder/history and existing consumption/completion enforcement.
Host/Worker validates a finite duration, initially proposed as **1–20 tics**, and
repeatedly invokes the existing exact single-tic operation. No native batch engine
is justified. Explicit neutral release is a real, separately counted tic;
duration expiration alone advances nothing.

Keep the current export where practical. **Bit assignments and compatibility
remain a design choice:** reserving 1 for forward and 2 for right preserves old
accepted selector meanings, but makes 3 a combination instead of the old invalid
selector. Another mapping can change even accepted meanings. Either requires
deliberate harness labels, refusal checks and artifact-pin updates; retaining the
signature does not imply full backward compatibility. A seven-value exclusive
enum is simpler only if useful combinations are deferred.

## Truthful outcomes and lifecycle

- Native `0` means verified installation, matching first live-player consumption
  and one completed world/outer tic. It does not promise a shot, door activation,
  displacement or eligibility for another step.
- Native `-1` is pre-mutation refusal. Invariant traps and watchdog expiry are
  faults, not successful applications or ordinary refusals
  (`references/doom.wasm/doomgeneric/src/g_game.c:2009`, `:2184`;
  `experiments/stage-a/harness.html:770`, `:292`).
- Recommended Worker receipts retain requested/completed counts and the verified completed
  prefix before refusal/fault. An interrupted in-flight tic is not counted as
  completed without evidence; partial work is not rolled back.

Existing trace observations suffice for this slice. `ready` checks the loaded
original live actor/game state, while `contributorsValid` separately checks input
eligibility (`references/doom.wasm/doomgeneric/src/g_game.c:2118`, `:2348`). Render
success independently establishes a returned frame, not step readiness
(`references/doom.wasm/src/doom_wasm.c:118`).

Stop prevents future calls; retire the Worker to interrupt in-flight work.
Restart/load uses a fresh Worker and instance, then explicit neutral-first.
Current initialization/preparation are one-shot; there is no native stop/reset
export (`references/doom.wasm/src/wat/controlled-title-init.wat:8`,
`references/doom.wasm/doomgeneric/src/g_game.c:2140`,
`experiments/stage-a/harness.html:717`). Broader reset/lifecycle behavior is deferred.

## Smallest implementation slice and first proof

Pending authorization, affected seams are `g_game.c` (ownership, expected output,
use-aware completion, observations), relevant `g_game.h`/`doom_wasm.h` declarations,
`experiments/stage-a/harness.html` (bounded loop/receipts/checks), and
`tests/test_a21_contracts.py` (replacement, combinations, refusal and use coverage).
Preserve stock builder/player/world/timer behavior. Current fixture continuation
forces `usedown=false`; it does **not** establish use semantics
(`tests/test_a21_contracts.py:154`).

One proposed compiled-WASM Chrome script, reusing the existing harness:

1. Fresh Worker: load identified WASM/IWAD, init, prepare; require zero native
   gameplay/time and READY. Execute explicit neutral (N=1), then render baseline.
2. Worker loops forward+right+fire+use for six tics (N=7). Record matching
   built/entered commands, forward=25, attack/use bits, right turn -320 for five
   tics then -640, and `usedown` becoming/staying true.
3. **After accepted control**, submit an unknown-bit request; require `-1` and
   unchanged effective inputs, commands, histories and counters. Then neutral
   (N=8): require all owned inputs and movement/button fields zero, `turnheld=0`,
   `usedown=0`. Render and snapshot.
4. Wait two seconds without Worker messages; snapshot must match. Passive render
   must preserve native state/frame hash. Another neutral must advance exactly
   once to N=9, with no elapsed-time catch-up.
5. Retire; create a fresh Worker/instance with the same bytes. Init/prepare must
   return to zero work/time. Refuse first non-neutral without changes; explicit
   neutral must produce N=1 and a real level frame.

Capture byte identities, each status, requested/completed counts, nine work counts,
three tic clocks, command/equality flags, effective inputs, use/turn history,
readiness, position/angle, frame hashes/PNG and error/watchdog evidence. Require
visible real gameplay/view change. Stop and preserve evidence on first mismatch,
unexpected refusal, lost readiness, trap, watchdog or unexplained idle change;
do not retry an ambiguous result.

Native fixtures can establish encoding/replacement/refusal/history contracts;
final WASM/Chrome must establish the real compiled path and visible rendering.
This first script does not prove a fired shot or successful door interaction.
**Backward and left-turn behavior need explicit coverage before claiming the
entire selected vocabulary is accepted.**

## Out of scope / limitations

Decisions API integration belongs to Milestone 3; UI/spectator work belongs to #10.
Defer full Stage B ABI, A3 `PENDING`, Stage C replay/epochs, Stage D adversarial
suite, toolchain bootstrap and the nonblocking harness button-state P2.

The owner-reported A2 20-tic/two-second run supports narrowed acceptance; its JSON
was not independently inspected here. The waived fresh-Worker ten-second trace/
frame comparison, broader menu/pause/reload/death/transition checks,
diagnostics-disabled compiled gameplay and sustained fault-containment coverage
remain unverified, **not passed** (`docs/doom-a2-2-results.md:16`, `:37`, `:44`, `:50`).
