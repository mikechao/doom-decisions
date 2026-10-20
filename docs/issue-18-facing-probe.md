# Issue 18, experiment 2: forward center ray

This opt-in slice tests whether one conservative current-facing observation
improves traversal over screenshot plus previous-action outcome. Native geometry,
gameplay parity, overhead, and navigation benefit are **unproven** until fresh
builds and bounded owner-run gameplay. Offline fixtures prove protocol plumbing,
not Doom intersections, doors, physics, or performance.

## Native contract

`G_A21Step` computes a local result after successful admitted tic closeout and
passive boundary checks, then publishes it alongside the unchanged Experiment 1
sample. It runs once per completed tic, including the mandatory first neutral
tic; never in preparation, getters, snapshots, rendering or idle. Refusals retain
all previous fields. Computation precedes publication, so a scan trap cannot
publish a partial sample. The existing index **87**, `collisionSampleTic`, owns
both samples and must equal the verified completed `gametic`. No export changed.

| Index / field | Values |
| --- | --- |
| 90 / `facingKind` | `-1` before first tic; `0` unknown/unavailable; `1` no relevant line detected; `2` one-sided/explicitly blocking solid line; `3` current opening/clearance restriction; `4` nonrestricting recognized manual-door boundary; `5` other special with unknown physical meaning |
| 91 / `facingDoor` | `-1` before first tic; `0` no manual-door evidence; `1` recognized metadata only, usability unknown; `2` front-side manual-door use candidate, activation/keys/activity unknown |
| 92 / `facingDistance` | `-1` before first tic or for kinds 0/1; otherwise approximate forward-ray distance rounded to an integer, 0–64 Doom units |

Completed terminal/unsupported gameplay publishes `0/0/-1`, owned by its completed
tic; no stale living geometry is retained. Kind 0 also covers near-degenerate
geometry and the scan limit. Kinds 0/1 require door 0; kind 2 permits door 0/1,
kind 3 permits 0/1/2, kind 4 requires 1/2, and kind 5 requires 0. Missing, stale,
out-of-range or contradictory fields invalidate step/preparation verification.
Whole-native-object equality includes all three fields for passive operations,
refusals, frame checkpoints, API waits and final receipt agreement.

The probe scans existing linedefs with local double-precision segment arithmetic,
using the fine-angle direction and native `USERANGE` (64 units). It reads current
sector floor/ceiling heights and actor z/height; it never invokes movement/use,
blockmap, line-opening or angle-query helpers. No actor intersections or thinker
identification are performed. Only the published observation integers are written.
The scan is O(number of linedefs), capped at 65,536; larger maps yield unavailable.
Bounding boxes discard distant lines before intersection work. This favors an
auditable E1M1 experiment over mutable traversal machinery. Actual WASM per-tic
cost still needs measurement; no scalability or modest-overhead result is claimed.

The nearest relevant crossing wins: solid, clearance, manual-door metadata, or
another special. Ordinary nonrestricting nonspecial lines are skipped. Other
specials stop discovery conservatively, preventing a door behind them from being
called a use candidate. A nearer clearance/solid boundary similarly hides doors.
Inconsistent two-sided metadata, fixed-point endpoint overflow, near vertices,
origin/range edges, overlapping nearly parallel lines, or tied
relevant crossings produce unknown rather than guessed ordering. Clearance means
insufficient current opening/headroom or a floor rise over 24 units; it does not
predict movement failure. Dropoffs, radius clearance, momentum and future sector
motion are outside this observation.

Manual metadata is exactly `1`, `26–28`, `31–34`, `117`, `118`, matching
`P_UseSpecialLine` → `EV_VerticalDoor`. Candidate status additionally requires a
two-sided nonblocking line, valid back sidedef/sector, and the axial front side
that the use dispatcher accepts. Diagonal/back-side boundaries retain metadata
only. Earlier relevant boundaries prevent candidate classification, even where
stock use might pass them; this is intentionally conservative. Keys and thinker
activity are never inferred from `specialdata`. A door that loses its special may
become unrecognized. Other door mechanisms and actors are out of scope.

## Request and presentation

**Configure AI Decision → Game state → Nearby wall / door** defaults OFF,
independent of Previous action outcome. Save/Cancel/Reset and the immutable
per-admission configuration apply as before. OFF preserves prior request text.
ON appends state text, leaving editable instructions, seven actions and duration
unchanged. Unknown consistently says `Facing probe: unavailable at this verified
frame.` The controller uses the verified native snapshot matching the rendered
tic and Canvas/native hash; the request adapter also requires the sample tic to
match. Inspector sidecars freeze the actual request. Draft preview uses only the
last verified rendered sample. Advanced evidence shows that sample, its tic and
raw indices for every provider, without enabling request inclusion or new reads.

Example **synthetic** state suffix:

```text
Facing probe (within 64 Doom units): solid line about 24 units ahead. Center ray only; full player clearance unknown.
```

## Pending owner-operated validation

Obtain separate approval for a fresh full `./build.sh`, local serving, approved
asset use and native execution. Frontend-only reuse cannot validate the new C
source. The owner manually opens Chrome; Codex never launches Chrome. No API key,
OAuth exchange or Decisions request is needed for native validation.

1. Retain the build receipt/hash. Use the existing bounded isolated module Worker
   protocol in [Experiment 1](issue-18-native-collision.md#proposed-owner-authorized-runtime-procedure)
   for chosen actions without the API. Retain its 20-action/6-tic scene bounds,
   native refusal check and mandatory neutral-first preparation. Unreachable scenes
   remain unverified. The application Advanced evidence block additionally shows
   only controller-verified native/Canvas frames.
2. For each scene record raw 87 and 90–92, player origin/heading, independently
   inspected linedef/sector predicates, completed-tic receipts and RGBA hashes.
   Use the separate Worker's existing action/render/snapshot requests; do not infer
   the native predicate solely from the image or the probe's own classification.

   | Scene | Check |
   | --- | --- |
   | Open corridor, including turning/stationary tics | Kind 1 only when no relevant ray line; never infer full player clearance |
   | Straight solid wall | Kind 2 and plausible distance; heading changes change the sample only on admitted tics |
   | Closed/open manual door, front and back | Closed clearance stays kind 3; open metadata may be kind 4; front axial candidate only; back/diagonal usability unknown |
   | Keyed door, if reachable | Recognized metadata/candidate never promises keys or activation |
   | Non-door special | Kind 5 if nonrestricting, otherwise physical kind; no door label |
   | Door behind wall/clearance/another special | Earlier relevant boundary wins; no candidate for the hidden door |
   | Low opening, rise, vertex/near-parallel ambiguity | Clearance or unavailable as appropriate; never solid wall merely from low headroom |

3. Repeated passive snapshots/render/idle and a native refusal must preserve the
   cached integers and all existing permitted simulation/RNG/clock invariants.
   Preserve native/Canvas receipts for application frames. The separate diagnostic
   Worker alone does not establish controller Canvas verification.
4. With separate baseline checkout/build approval, replay the exact fixed mask/tic
   sequence against parent `8358461` with its matching Worker and against this
   version. Compare all common native fields, counters, RNG indices and RGBA
   hashes, excluding only new fields/artifact identity. Record per-tic timing over
   repeated fixed sequences without breakpoints to assess overhead. The checkbox
   gates request text only: OFF versus ON is not an uninstrumented native control.
   Exposed-state/frame agreement cannot prove every unexposed game field equal.
5. Stop on stale ownership, wrong classification/side/order, passive/refusal
   mutation or unexplained baseline divergence. Only after native validation,
   separately authorize small paid comparisons: hold model, IWAD, prompt,
   previous-action option, N and attempt budget fixed; vary only this checkbox.
   Compare useful traversal and repeated obstruction/turn oscillation using frozen
   Inspector requests and resulting frames. No navigation improvement is claimed
   by the implementation or offline suite.
