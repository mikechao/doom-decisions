# Issue 18, experiment 1: native collision record

The source/test implementation adds diagnostic observations only. Native
classification and gameplay parity are **not yet runtime validated**. It does
not identify doors, perform facing probes, alter inputs, or send collision data
to Decisions. The [pipeline guide](doom-game-state-pipeline.md#collision-experiment-1)
defines the indices, masks and lifecycle.

## Capture boundary

`P_XYMovement` and the `P_SlideMove` recovery it calls use `P_XYTryMove`.
Ordinary enemy/projectile `P_TryMove` calls and direct `P_CheckPosition` calls
are not recorded. `G_A21RecordMovement` also requires an active admitted tic,
the admitted actor equal to `players[0].mo`, its player back-pointer, and the
current tic's verified player-entry event. No health/live check discards events
merely because the actor dies later in the admitted tic.

`PIT_CheckLine` assigns solid-line reasons only for one-sided or explicitly
blocking lines. `PIT_CheckThing` assigns solid-thing reasons on its ordinary
solid rejection branches, including saved solidity before a pickup side effect.
Skull/missile-specific rejection branches remain unknown. `P_TryMove` assigns
clearance at its existing opening-height, z/ceiling, step and dropoff failures.
The first actual failure ends each trial; only its reason is recorded.

Two private integer handoffs in `p_map.c` carry reasons from synchronous false
return sites to their immediate callers. Position/try entry defaults them to
unknown. A rejecting callback sets its handoff after side effects, then its
iterator and position check immediately return false. `P_TryMove` sets its own
handoff immediately before returning false; the XY wrapper records it before
another engine call. Accepted trials discard the rejection handoff. This avoids
retaining a global actor/attempt scope through pickups, crossed specials,
teleports or later moving-sector checks. If future source adds engine work
between these returns and reads, re-audit this assumption.

Outside `DOOM_CONTROLLED_TITLE` with fixtures enabled, wrappers alias the stock
calls and reason helpers become constant false expressions. No new WASM export
or gameplay query is introduced.

## Checks available now

With dependencies already installed, `npm --prefix app run check` covers the
offline application suite and static checks. Collision tests verify C/TS bit
alignment, indexed Worker read order, unchanged raw integer/sentinel transport,
allowed masks, preparation, refusal/passive identity, completed-tic ownership,
terminal prefixes and Worker/controller receipt preservation. Fixtures contain
chosen protocol records, not a simulation of Doom collisions.

No maintained deterministic native scene harness exists in the current source.
The old native-contract suite is retired; the supported WASM inspector does not
execute the engine. The existing module Worker protocol is the smallest runtime
entry point for an owner-operated diagnostic session; no new test platform is
needed for an initial falsification trial.

## Proposed owner-authorized runtime procedure

### Advanced evidence summary

The existing Advanced evidence disclosure includes a compact **Native collision
telemetry (Experiment 1)** block for all providers, including OpenRouter. After a
decision's action receipt is independently verified and its resulting native/
Canvas frame passes verification, it shows the action, actual completed tic
interval, overlapping per-tic trial/success/rejection/slide counts, rejection-reason
union, and final numeric values at indices 87–89. A verified rendered terminal
prefix is explicitly labeled. Preparation's neutral tic is not a model action.

No new Worker operations, native reads, polling or provider-request fields are
added. The prior summary can remain after an API failure or Stop before dispatch
when the game/frame is unchanged. Native dispatch marks the summary pending;
verification failure/error retirement makes it unavailable. A fresh preparation
starts with no verified action. The block remains diagnostic evidence of what
native code reported, not proof that its physical classifications are correct.

For the smallest owner-operated application trial, after separately authorized
frontend build/serving and any necessary API budget, open Advanced evidence and
inspect one bounded action in an open corridor, at a straight wall, and against
an angled wall. Record the starting/ending tics and resulting-frame identity with
the summary. Expect corridor translation with accepted trials, a genuine
solid-line rejection at the wall, and possible overlapping rejection/success/
slide counts at the angle. Do not call the player stuck from these counts. Open
and close the disclosure while idle; the sample and verified tic must not change.
The existing verified native artifact can be reused by a separately authorized
`./build.sh --frontend-only` if its source/artifact identity still passes checks;
these presentation changes alone do not require native recompilation. The
isolated Worker procedure below remains available for chosen actions without
Decisions calls.

Do not execute this procedure without separate build, server and game-asset/
native-runtime authorization. Codex must never launch Chrome. No credential,
OAuth exchange, provider request or Decisions call is needed.

1. Run a fresh full `./build.sh`, retaining the build receipt and WASM SHA-256.
   Frontend-only reuse cannot validate these C changes. After server approval:

   ```sh
   (cd app && ./node_modules/.bin/vite preview --host 127.0.0.1 --port 8000 --strictPort)
   ```

2. The owner opens `http://127.0.0.1:8000/` in Chrome. For ordinary application
   preparation, select the approved asset without signing in or entering a key.
   Inspect advanced native evidence: `-1/-1/-1` at prepared tic zero, then a
   sample for tic 1 after the mandatory neutral tic. Confirm repeated snapshots,
   passive rendering and startup idle preserve the collision fields, all
   simulation counters, exposed native fields and RNG indices. Preserve native/
   Canvas frame receipts and Console/Network observations.

3. For chosen actions without the API, use a **separate diagnostic module Worker**
   from owner DevTools, using the emitted module Worker URL found in Network.
   Keep the application's own Worker untouched. Use its existing sequential
   request/reply protocol below; wait for each reply and stop on faults,
   `INELIGIBLE`, terminal outcomes or missing receipts. Inspect returned RGBA
   frames in DevTools as necessary. This path does not establish the application
   controller's Canvas verification or timeout protection.

   | Request, in order | Required evidence |
   | --- | --- |
   | `load-i11` with the built `doom.wasm` ArrayBuffer, approved IWAD ArrayBuffer, and `expectedWasmHash` from `doom-build.json.sha256` | Matching WASM/IWAD hashes; one fresh module |
   | `init`, then `prepare` | Status 0; zero gameplay tics; collision fields all -1 |
   | `action` with `mask: 0, tics: 1` | Mandatory neutral first tic, sample tic 1 |
   | `render`, `snapshot`, repeat `snapshot` | Identical native fields; only permitted render bookkeeping changes |
   | Selected `action` with one mask and small positive `tics` | Per-step sample tic matches that step, unchanged requested/reported/verified accounting |
   | `render` after each action | Resulting frame and final step share native state/tic |

   Use existing masks only: neutral 0, forward 1, right 2, backward 4, left 8,
   fire 16, use 32. Obtain approved IWAD bytes through the existing pinned
   gzip/decompression/admission flow or an approved local file; do not download,
   recompress or save raw game assets. Do not bypass the controlled initializer.
   For each scene allow at most 20 action requests of at most 6 tics each;
   terminate that diagnostic Worker when finished. If a scene cannot be reached
   within this bound, record it as unverified rather than extend the run.

4. Record a per-tic table for the following cases. Use visual staging plus
   DevTools breakpoints at the original rejecting return branch when necessary
   to establish which native predicate actually failed; do not infer the native
   cause solely from the rendered picture. Pausing invalidates wall-clock timing
   claims and is confined to the separate diagnostic Worker.

   | Scene/action | Expected evidence |
   | --- | --- |
   | Open corridor, forward | Trial + success, no rejection; separately check x/y translation |
   | Straight solid wall, forward | Actual one-sided/ML_BLOCKING return and solid-line bit |
   | Angled wall, forward | Rejection and slide bits; successful retries may coexist; no stuck verdict |
   | Solid actor ahead | Actual solid-thing return and solid-thing bit |
   | Closed door | Clearance bit if its opening causes rejection; no door classification |
   | Other actor collides, player unaffected | Other actor's return produces no player rejection bit |
   | Moving-sector height check | Direct position checking produces no extra movement event |
   | Passive reads | Collision integers, simulation counters, RNG and exposed native fields unchanged |
   | Refused native step | Previously published sample and all exposed simulation state unchanged |

   A Worker-refused invalid action is weaker evidence than a native refusal:
   the Worker can reject before calling WASM. To exercise the native guard in
   the separate Worker, pause inside the existing action step callback and use
   its in-scope `instance.exports.stepNeutralControlled(64)` once (invalid mask)
   before resuming the valid step. Compare observations before/after the refused
   call; status must be -1. Do not introduce new exports or production controls.
   A direct export read in that paused scope can likewise check getter invariance.

5. Where practical, replay the exact recorded mask/tic sequence from a fresh
   game against an independently built uninstrumented parent version, using its
   matching Worker. This requires separately approved baseline checkout/build
   work; do not reverse current edits or reuse mismatched frontend/WASM assets.
   Compare every common native field, RNG indices, clocks, work/command receipts
   and resulting RGBA hashes. Exclude only the three new diagnostic fields and
   artifact identity. Preserve both build identities and the fixed sequence.
   A comparison of exposed state and frames cannot prove equality of every
   unexposed gameplay field; no full-state serializer is claimed.

Stop on wrong actor attribution, a mismatched return-site reason, stale sample,
changed refused/passive state, or unexplained baseline divergence. A successful
compile or synthetic suite is not native collision evidence. Scene availability,
full-state parity and exact collision behavior remain pending until exercised.
