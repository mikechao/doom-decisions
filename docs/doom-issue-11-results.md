# Issue #11: minimal native controls Chrome results

**Historical record:** source, harness, test-count and acceptance statements below describe the recorded checkpoints. Native source now lives under `engine/doom/`; the retired harness is in Git history. Historical ignored build evidence under `references/doom.wasm/build/` is unavailable in this checkout and cannot be recovered from Git. See the [app guide](../app/README.md) for current setup. This annotation adds no runtime evidence.

**Chrome prepared-script validation: PASS. Owner acceptance is recommended,
not declared.** The saved receipt establishes 15 completed native gameplay tics
across two fresh Workers, six-input command consumption, real movement and
isolated rotation, input refusal, and idle/render isolation. Successful shooting,
successful door interaction, browser fault/interruption handling, and Decisions
API integration are not established by this run.

## Evidence and provenance — 2026-10-10

The owner supplied `/Users/mike/Downloads/a1-first-proof.json` and
`/Users/mike/Downloads/a1-title.png`. The successful receipt starts at
`2026-10-10T19:28:47.211Z`, identifies experiment `issue-11-prepared-script`, and
ends at:

> SCRIPT CHECKS PASSED — retain receipt/frames for owner review; acceptance NOT DECLARED

Its `milestoneAcceptance` remains `NOT DECLARED`. Chrome is owner-recorded as
`154.0.8037.98 (Official Build) (arm64)`; the user agent reports Chrome 154 on
macOS. There are 35 operation records, nine successful actions containing 15
verified steps, four refused native step requests, and ten embedded Canvas PNGs.

| Artifact | Identity / provenance |
| --- | --- |
| Successful owner JSON | 1,740,631 bytes; file SHA-256 `748b09e5f8ac2c7d82afeaa1a21e7bfb4c030e6b130249c2bac376a8e20223ce`. The reviewed copy contains the passing checkpoint, not the earlier preparation failure. |
| Standalone owner PNG | 96,515 bytes; file SHA-256 `408402deab92f00981f70ed2e0e9e4deb2a7d0190f81cbebffb2d9c81c786d8c`; decoded size 640×400. |
| Final WASM | Browser filename `doom-issue-11.wasm`; 360,156 bytes; SHA-256 `cc86ed8884ec04dbace3c541e8528a9f91839b79816cc79ce988af939d42dcb8`. Both Worker loads match the receipt's expected hash and the existing final `references/doom.wasm/build/issue-11-first-trace/doom.wasm`. |
| External IWAD | Browser filename `freedoom1.wad`; 28,795,076 bytes; SHA-256 `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`. Both loads match local `assets/freedoom-0.13.0/freedoom1.wad` (Freedoom Phase 1). This is not a proprietary Doom shareware IWAD. |
| Build evidence | Recorded manifest (`references/doom.wasm/build/issue-11-first-trace/evidence/manifest.json`; unavailable locally), status `BUILD PASS`, started `2026-10-10T19:08:48.668748+00:00`, profile `controlled-title`, diagnostics/fixtures enabled. Build source HEAD `b1cef3ca5e25f489e7965988283c3451aca32203` (`b1cef3c`), clean source status and empty local patch. |
| Corrected harness | HEAD `7c93aa863ccebb481370ef3c72c11acf4686b7fc` (`7c93aa8`), `fix: correct title readiness check in Issue 11 harness`. Only harness/tests differ from build HEAD; native build sources are unchanged. |

The first owner attempt stopped before gameplay because the harness required
`titleReady=1` after E1M1 preparation. Native preparation had succeeded with
`titleReady=0`. Commit `7c93aa8` separates the cumulative one-shot init counts
from current title readiness: init requires 1, preparation requires 0. The
successful receipt uses the corrected harness; this correction required no
WASM rebuild.

The receipt records these hashes for owner-selected source files:

| Selected file | SHA-256 | Reconciliation |
| --- | --- | --- |
| `g_game.c` | `eac214e139643d1f5486590f38152be1f56fabb90580c25ed5e63f578e7a0c89` | Matches build HEAD and corrected repository HEAD. |
| `g_game.h` | `3a172a1b972c6d053ccfb0055e12a5bb42d1230b5232031296fdf08a1c2f371d` | Matches both HEADs. |
| `doom_wasm.h` | `ee10208b7d08d445ffc98eead29192a251d0d1983ca7e10ed90c94c02e98578c` | Matches both HEADs. |
| `harness.html` | `5a6f79e5d7414fabf078b74e21caadc863a92d1102d9383bc8cc5f7ec337984e` | Matches corrected harness at `7c93aa8`. |
| `test_a21_contracts.py` | `868211012c724f1e027b7ce3cbc57f2ad49ad995fc033faa784b9d3f4181b79a` | Older selected copy: matches build HEAD `b1cef3c`, not corrected HEAD. |

The corrected repository test file hashes to
`1a7b3d6b99486fa68f51996d2cfd1dbe23f5d31f0bb9bc663e3d37ae41ca6a8f`.
The selected older test copy is a provenance distinction, not evidence that the
old harness ran: the harness hash matches the corrected source. The test file
is hashed for identification; it is neither executed by Chrome nor compiled
into Doom. Prior local verification of the correction reported 11 contract
tests passing and 33 full-suite tests passing with one process-group integration
skip. Those tests were not rerun for this evidence review or documentation edit.

## Exact gameplay sequence and native consumption

Operation indexes below are zero-based indexes into `receipt.operations`.
The private mask is forward=1, right=2, backward=4, left=8, fire=16, use=32;
neutral=0. The Worker admits integer durations 1–20 and calls the existing native
single-tic export explicitly, without a native batch or elapsed-time scheduler.

| Worker / operation | Input | Requested / verified completed tics | Native total afterward |
| --- | --- | --- | --- |
| First / 6 | Neutral 0 | 1 / 1 | 1 |
| First / 8 | Right 2, isolated before firing | 1 / 1 | 2 |
| First / 9 | Left 8, isolated before firing | 1 / 1 | 3 |
| First / 11 | Forward + right + fire + use, mask 51 | 6 / 6 | 9 |
| First / 15 | Neutral 0 | 1 / 1 | 10 |
| First / 17 | Backward 4 | 2 / 2 | 12 |
| First / 19 | Neutral 0 | 1 / 1 | 13 |
| First / 25 | Neutral 0 after idle | 1 / 1 | 14 |
| Fresh second / 33 | Neutral 0 | 1 / 1 | 1 |

All actions return `APPLIED`, native status 0, and exactly their requested
completed counts. The first Worker completes 14 tics; the second completes 1;
**15 total, not a shared 15-tic native clock**. No action expiration adds another
tic: action-level native observations/counters equal the last verified step.

For every accepted step, native `build`, `install`, `liveEntry`, `world`,
`status`, `automap`, `hud`, `menu`, and `outer` counts move from N to N+1.
`nativeBuild`, `playerEntry`, `worldComplete`, `outerComplete`, `gametic`,
`leveltime`, and `virtualTicks` also increase exactly once. Native virtual
milliseconds equal `floor(N*1000/35)`: first-run final N=14 is 400 ms; fresh-run
N=1 is 28 ms. Built and entered commands match in all ten named fields;
`installEqual`, `entryEqual`, `actorEqual`, and `contributorsValid` are 1.
These observations and the native checks establish installation and initial
live-player consumption followed by one completed world/outer tic per step.

Both init/preparation sequences keep gameplay counts and clocks at zero.
One-shot `wasiInit`, `cInit`, `engineCreate`, and `titlePrepare` remain 1.
Preparation establishes episode/map 1/1, skill 2, a live healthy actor, loaded
resources and native eligibility; it does not simulate a hidden first tic.
Unexpected scheduler, net-body, wipe, and demo work remain zero.

### Movement, rotation, fire/use, and replacement

**PASS — observed rotation:** the isolated right step changes angle from 0 to
4273995776 with `angleturn=-320`; the following left step returns it to 0 with
`angleturn=320`. The assertions use
`after.angle == (before.angle + angleturn*65536) modulo 2^32` and require a
change. Unsigned deltas are 4273995776 (right) and 20971520 (left). Both steps
have zero reaction time and no `MF_JUSTATTACKED` override; both proof receipts
are `VERIFIED`, one verified tic each. These are isolated pre-fire effect checks,
not a prediction of final angle on arbitrary weapon-active tics.

**PASS — movement and history:** the six combined tics move position from
`(-27262976, 16777216)` to `(-26347961, 16684636)` in native fixed-point units
and change the frame. `turnheld` is 1 after right, 2 after left, then 3–8 during
the combination: its first three turn commands are -320 and last three -640,
accelerating at history value 6. This differs from the investigation's earlier
proposed sequence because the executed script adds isolated right/left steps.
Both backward tics consume `forwardmove=-25`; residual forward momentum means
they need not immediately reverse displacement. Observed x momentum falls from
196992 before backward to 133876 and then 76677.

**PASS — fire/use input consumption:** combined tics have `forwardmove=25`,
native fire/use keys held, and `buttons=3` (`BT_ATTACK | BT_USE`) in matching
built/entered commands. `usedown` changes from 0 to 1 on the first use tic,
stays 1 during the hold, and returns to 0 on the subsequent non-use tic. The
stock player path invokes use on the edge rather than on every held tic.
This proves native input consumption and use-edge handling, not a fired shot
or successful door activation.

**PASS — replacement/release:** neutral assigns all six owned keys to zero,
clears movement/turn/button fields, resets `turnheld` normally, and clears
`usedown`. It does not erase physical momentum or ongoing weapon animation.

### Refusals, idle, rendering, and fresh Worker

**PASS — refused inputs:** operation 5 refuses first forward input at N=0;
operation 32 repeats this in the fresh Worker. After genuine movement, operation
13 refuses unknown mask 64 and operation 14 refuses forward/back pair 5 at N=9.
All four return `REFUSED`, status -1, with exactly unchanged counters and native
observations, including held keys, command fields and history. Step requests do
not include their input argument in the saved operation record; masks are tied
to the fixed script in the hash-matched harness. The following explicit neutral
advances once to N=10 with neutral commands; refusal neither advances nor replays
the preceding action.

**PASS — idle/render isolation:** operations 21 and 22 bracket a requested
2000 ms no-message wait, measured at 2006.3999999761581 ms. Native state and
counters are identical at N=13 (virtual milliseconds 371). Operation 23 renders
passively with the same frame hash as before the wait; operation 24 observes
without mutation. Operation 25 explicitly advances once to N=14, with no
wall-clock catch-up. Every render preserves native gameplay state/time while
incrementing only its expected render/frame and intercepted-render counters.

**PASS — fresh Worker:** operation 28 loads the same WASM/WAD into a new Worker;
init/preparation again start at zero. First non-neutral is refused, explicit
neutral advances to 1, and the level frame matches the first Worker's neutral
baseline. `freshRunNeutralFirstVerified=true` and final `retired=true`. No
watchdog fires; the 43 recorded heartbeat samples have maximum gap
150.60000002384186 ms, below the script's 250 ms threshold. This successful-run
observation does not establish behavior during a trap, hang, or interruption.

## Frame evidence

Read-only review decoded all ten embedded PNGs, checked PNG structure/CRCs,
and matched decoded RGBA SHA-256 to each frame record and corresponding render
operation. These are framebuffer pixel hashes, not PNG-file byte hashes.

| Embedded frame / render operation | Worker tic | Decoded RGBA SHA-256 |
| --- | --- | --- |
| 0 / 2, title | First 0 | `d6c8cfd39fb13d32e9ec6ab2778dc3a17dd3216c423183012a28da8f6f344525` |
| 1 / 7, neutral baseline | First 1 | `ea416a166f395e8ed6fb60d3b417a1cacedd9b764f58282892d4e9caae8e5800` |
| 2 / 10, after isolated turns | First 3 | `72614f4e8c9b31e2bdf95c48b5b70c6c2b2c2757c019debc59380aea1efc6548` |
| 3 / 12, after combined movement | First 9 | `23f64cd628de3bdcf245dc8318bc6ca156bf6a20e95b20495415d620e9a7fe50` |
| 4 / 16, neutral release | First 10 | `de5759930b77c5e090e7efeb31ebedf78f55789e504ad10a6b79047f92654db5` |
| 5 / 18, after backward | First 12 | `f307f65e9fe69f6af75846ae9d5d294d1b99e500e46a4f0ef4443cbe0e92c051` |
| 6 / 20, before wait | First 13 | `f937c93f25dbfab6f6aedb2109b98a1be1dac14f72550eb27e21eb7535e70c20` |
| 7 / 23, after wait | First 13 | `f937c93f25dbfab6f6aedb2109b98a1be1dac14f72550eb27e21eb7535e70c20` |
| 8 / 26, post-wait explicit tic | First 14 | `5ab83f12e2ddffe1c1d8525f611e359cb4e7fee1b71c5d41a592e769aa0997a5` |
| 9 / 34, fresh neutral baseline | Second 1 | `ea416a166f395e8ed6fb60d3b417a1cacedd9b764f58282892d4e9caae8e5800` |

Despite its filename, standalone `a1-title.png` shows the real E1M1 gameplay
view after explicit neutral, not the title and not the moved view. Its decoded
pixels match embedded frames 1 and 9. Movement evidence belongs to embedded
frames 3–8, alongside the native positions/commands, not that standalone PNG.
`lastFrameSha256` is the fresh Worker's neutral baseline because the script ends
there; it is not the first Worker's final movement frame.

The raw JSON/PNG remain owner-held at the paths above, and build outputs are
ignored local artifacts. This document records audited results and identities;
it does not commit copies of those raw artifacts. Retain the complete JSON with
embedded movement PNGs, standalone PNG, exact WASM/IWAD, and build manifest before
cleanup. This is not a complete deterministic world/replay checksum.

## Acceptance recommendation and scoped waiver proposal

**Recommend owner acceptance of the agreed minimal-control prototype scope.**
The supplied investigation and implementation scope distinguish native input
consumption from guaranteed shots/door effects.
Decisions integration belongs to Milestone 3. The successful Chrome observations
above are PASS; the following browser coverage remains **INCONCLUSIVE**, not
silently passed:

- Actual shot/ammunition/target effects and successful door interaction.
- Maximum-duration 20 and invalid-duration rejection; this run uses 1, 2, and 6.
- Opposing left/right pair 10; this run exercises opposing forward/back pair 5.
- Partway refusal/fault prefixes, traps, watchdog expiry, and in-flight owner
  stop/interruption handling. A successful action prefix and final retirement
  do not prove these failure cases.
- Broader lifecycle/death/reload/menu/pause behavior, diagnostics-disabled
  gameplay, generalized containment, and Decisions API integration.

The original live Issue #11 acceptance wording was not fetched during this
review/documentation task. No claim is made that its complete original matrix
has been satisfied. If it requires the additional browser cases above, the
owner must either obtain that coverage separately or explicitly narrow
acceptance. The following is a **proposed owner statement, NOT APPROVED**:

> I accept Issue #11 as a minimal native-control prototype on the identified
> traced WASM and external Freedoom IWAD, supported by the audited 15-tic,
> two-Worker Chrome receipt, embedded frames, reviewed implementation, and
> previously reported local fixture checks. For this milestone only, I waive
> additional Chrome runs for maximum/invalid durations, opposing left/right
> input, partway refusal/fault accounting, and trap/watchdog/in-flight-stop
> behavior. Those browser cases remain unverified, not passed. If the original
> criteria require successful shooting or door interaction, I explicitly
> substitute verified native fire/use input consumption and use-edge handling
> for those effects in this prototype acceptance. I accept the older selected
> test-file copy as a documented identity distinction; the executed harness and
> native artifact identities are reconciled. This does not establish broader
> lifecycle/fault containment, diagnostics-disabled gameplay, or Decisions API
> integration, and grants no authorization to implement or run those tasks.

This proposal is not an owner decision or an Issue #11 closure. Any additional
original requirement outside this stated scope still needs explicit owner
reconciliation; it is not covered by a blanket waiver.

## Review and documentation boundary

The preceding read-only review evaluated the repository's step/isolated-turn
verifiers against saved observations, independently checked the 15-step/four-
refusal/ten-render totals and passive records, decoded saved PNGs, compared
artifact/source hashes, and inspected native control and stock gameplay paths.
It did not execute Doom or rerun the Chrome experiment.

This documentation task started with clean `main` at `7c93aa8` and adds only this
results document; no existing Issue #11 results document was present. The
investigation and implementation remain unchanged. Proportional documentation
checks verify receipt-derived values/hashes, local links, Markdown structure,
and whitespace with `git diff --check` plus
`git diff --no-index --check /dev/null docs/doom-issue-11-results.md` for the new
untracked document. No build, test suite, browser run, installation, network
operation, commit, push, or GitHub mutation is performed. Owner acceptance is
pending.
