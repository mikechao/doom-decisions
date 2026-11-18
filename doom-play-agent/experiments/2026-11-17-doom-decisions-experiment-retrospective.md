# Doom Decisions — Experiment Retrospective

**Date:** November 17, 2026 (Pacific time)  
**Project:** `doom-decisions` / `doom-play-agent`  
**Suggested repository location:** `doom-play-agent/experiments/2026-11-17-experiment-retrospective.md`  
**Status:** Retrospective of completed investigations and experiments; not a proposal or proof of passage connectivity.

## Executive summary

We began the day trying to improve the agent's use of historical landmark note **B** in shareware E1M1. The note asks whether a dark-floored opening beyond the left ledge connects to a dry continuation around the basin. The historical **N=10** run approached the area but ended with the critical floor junction obscured by a near pillar. The rear-left recess and the basin-side floor were sometimes conflated in model guidance.

**Navigation outcome:** No experiment established that the dry passage exists, ends, or is traversable. Adding prior assessment history, changing perception instructions, and adding a screenshot to navigation assessment failed their predefined improvement criteria. A hand-written, more specific investigation suggestion yielded one favorable real Decisions pilot, but two additional pairs tied on blinded numerical visual scores. The resulting evidence does **not** justify integrating the prompt change or adding a planner.

**Engineering outcome:** We proved that the existing real Doom Worker can deterministically reproduce the N=10 run through tic 55; that two independent controller-owned sessions can branch from that exact checkpoint; and that guidance-only request differences can be isolated down to the real provider wire payload. We promoted a **fake-provider, offline D10 replay regression CLI** into tracked source and executed it successfully. That capability is a durable result of the day.

**Manual exploration outcome:** Two bounded, screenshot-guided sequences (eight actions, 48 tics total) improved or changed the viewpoint but did not expose the hidden floor junction. We agreed to pause this landmark investigation and return to broader autonomous gameplay.

### Experimental reference and recurring limits

- **Historical run (captured November 16, used as today's reference):** `doom-play-agent/.local/runs/2026-11-16T23-39-58.099Z_594e7297-3d53-4594-8123-a6ee9ee2ac15/result.json`, with `decision-*-before.png` and `decision-*-after.png`. The run had 10 completed six-tic decisions, tic 1 → 61. This is a reference dataset, **not** a new November 17 experiment.
- **Historical landmark:** note B, ID `9b171d6b-092f-4089-9a0a-996b4a559ffb`, revision 2, selected before D1 and held for the run. Question: “Does the dark-floored opening beyond the left ledge connect to a dry continuation around the basin?”
- **Important distinction:** The rear-left recess is not demonstrably the same place as the dark floor beside/beyond the near pillar and basin rim. Visibility of a basin edge does not establish an unobstructed, traversable dry route.
- **Shared checkpoint:** pre-D10 tic 55, raw pose `(62751105, -225029880, 1660944384)`, decoded RGBA SHA-256 `37aa03dd0f33c9601e326b6ee605a29fa0994bfa368c7cac5f072d63c6d1e8ad`.
- **Pinned local assets for replay:** controlled-title `app/public/doom.wasm`, SHA-256 `3c70f5c26d38dfee10162ea53e3546cacd02f94abfebc3fb3e125cca5f656335`; historical shareware `DOOM1.WAD`, SHA-256 `1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771`. The app's bundled **Freedoom is not interchangeable** with this shareware reference. The original browser-loaded WASM SHA-256 was not retained in the historical result, even though all tested visible historical checkpoints matched.
- **Evidence locations:** Most raw experiment evidence lives in ignored `.local/` directories. These paths work in the original workspace but **will not be available from a GitHub checkout** unless separately and appropriately preserved. Do not commit copyrighted local IWAD bytes, credential-bearing logs, or other private artifacts.

## Experiment ledger

| # | Experiment / investigation | Purpose | Result | Production decision |
|---|---|---|---|---|
| 1 | Assessment history A/B | Test whether prior observations improve investigation guidance | 0/4 checkpoints improved | Do not integrate |
| 2 | Spatial perception instruction A/B | Make scene descriptions capture relationships and occlusion | 0/2 improved | Do not integrate |
| 3 | Image-enabled navigation assessment A/B + independent audit | Test whether direct pixels resolve target ambiguity | D6 improved, D9 did not; predefined both-improve rule failed | Do not integrate |
| 4 | N=10 guidance → action → image trace | Locate where investigation loses relevant target | D9–D10 referent drift demonstrated; causal effect not proven | Targeted hypothesis identified |
| 5 | Replay feasibility/source audit | Decide whether replay can replace save/load | Initially blocked before execution by missing historical WASM hash | Execute empirical replay instead |
| 6 | Independent Worker deterministic replay | Reconstruct exact historical tic-55 state | 2/2 Workers, 10/10 checkpoints exact | Replay feasible |
| 7 | Worker branching at tic 55 | Verify different actions from equivalent states | Original and alternative branches verified | Branching feasible |
| 8 | One-controller replay/admission smoke | Verify controller-owned replay and request admission | Exact replay, fresh D10 admission; controlled fake-provider failure recovered | Controller seam feasible |
| 9 | Two-controller fake-provider branching | Verify isolated guidance-only request variation and dispatch | Exact shared checkpoint and expected tic-61 outcomes | A/B mechanics feasible |
| 10 | Real Decisions D10 guidance A/B pilot | Test whether specific guidance affects actual view | B visually better in one pair, junction still hidden | Promising, not validated |
| 11 | Pilot blinded independent review | Reduce confirmation bias in visibility judgment | Confirmed B's partial advantage | Supports pilot observation only |
| 12 | Tracked offline replay CLI | Preserve reproducible capability in source | Implemented, committed/pushed, owner execution passed | Keep tool; no real-provider mode |
| 13 | Real Decisions A/B replication (two pairs) | Test repeatability of pilot | Two score ties; B strictly better 0/2 | Hypothesis not demonstrated |
| 14 | Replication blind review and unblinding | Apply preregistered visual rule without arm bias | All four outcomes −1/0; ties after unblinding | Inconclusive; stop tuning at tic 55 |
| 15 | Manual viewpoints, tic 55 → 79 | Find a better view without model action selection | Partial visibility improvement; junction hidden | Do not claim resolution |
| 16 | Final manual viewpoints, tic 79 → 103 | One bounded attempt to expose junction | No resolution within four more actions | Pause note B investigation |

---

## 1. Navigation assessment with short-term history

**Purpose / assumption.** We suspected that `navigation-assessment.ts`, which evaluates the current perception against the selected note, was missing temporal context. If we supplied recent observations and assessment history, it might better track whether an opening or boundary had become clearer across decisions.

**Method.** Offline A/B on saved pre-decision evidence at **D4, D6, D7, and D9**: the existing text-only assessment versus an assessment augmented with two preceding records' scene features, perception uncertainty, assessment verdict, evidence and uncertainty. The schema and fundamental task were unchanged. **Eight inference calls** completed.

**Result.** **0/4** checkpoints showed a qualifying improvement. There were no demonstrated regressions, but no useful temporal-progress gain either.

**Why it did not work.** The missing information was primarily **spatial geometry and occlusion within the current image**, not the absence of more prose history. Appending prior descriptions did not restore relationships that perception never captured in the first place. Repetitive ambiguous descriptions also remained ambiguous when repeated.

**Potential improvement / condition for revisiting.** Test history only after obtaining independently verified, discriminating observations—for example, *this particular border was visible from checkpoint A but hidden from B*—rather than appending generic text. Prefer a compact, evidence-grounded change signal to large prior-model narratives. Do not integrate the tested history amendment.

**Evidence:** `doom-play-agent/.local/offline-replays/navigation-history-ab/2026-11-17-pilot/` (rubric, report, anonymized worksheet).

## 2. Spatial-relation emphasis in scene perception

**Purpose / assumption.** `scene-perception.ts` often listed objects without describing the floor, ledge, basin border and pillar **relative to one another**. We tested whether a small, goal-independent instruction change could make its outputs more useful downstream.

**Method.** Prompt-only paired comparison at **D6 and D9**, four inference calls; the schema stayed the same. Candidate wording prioritized observable spatial relationships and occlusions over object inventories.

**Result.** **0/2** qualifying improvements. At D6 the candidate mentioned a border but incorrectly identified the blue surface as “water” and still missed the important pillar occlusion. At D9 it described some objects more specifically, but omitted the key occlusion/floor relationship and incorrectly reported no uncertainty.

**Why it did not work.** Stronger generic instructions did not consistently fix the model's geometric interpretation; in places they encouraged more specific but unsupported assertions. More detail is not automatically better evidence.

**Potential improvement / condition for revisiting.** Evaluate narrowly defined, independently checkable spatial observations (e.g., *visible border to pillar's right; continuation hidden*). Penalize invented materials and unjustified certainty. Do not keep tuning the entire perception prompt merely to improve this one landmark.

**Evidence:** `doom-play-agent/.local/offline-replays/scene-spatial-ab-2026-11-17/RESULTS.md`.

## 3. Image-enabled navigation assessment and independent review

**Purpose / assumption.** Since perception text omitted the decisive floor/occlusion relationship, we tested whether `navigation-assessment.ts` could target the right visual feature if it received the original screenshot directly, alongside perception text and note B.

**Method.** Paired offline comparison at **D6 and D9**, with four completed inference calls. A was existing text-only assessment; B added the retained screenshot **and** adjusted wording to permit image grounding. This was a **bundled image-plus-instruction treatment**, not a pure pixel-only change. Two initial harness attempts failed before inference because of request fixture/header expectations; those were corrected without counting as scored calls. An independent Codex reviewer later scored the saved outputs against the original rubric.

**Result.** B improved the D6 target: it more clearly aimed at the dark floor beyond the basin-side pillar rather than the unrelated rear-left recess. At D9 it still used ambiguous referents and failed to distinguish the floor from the recess. The predeclared criterion required improvement at **both checkpoints**, without unsupported claims; **failed**. Independent review confirmed that verdict. There were no demonstrated route-connectivity or traversability claims.

**Why it did not work.** Direct image access helped at one viewpoint but did not reliably establish the crucial spatial relationship at the other. The test also cannot isolate the benefit of pixels from simultaneous wording changes.

**Potential improvement / condition for revisiting.** A future causal study should separate screenshot input from instruction changes, use clearly contrasting checkpoints, and measure actual gameplay consequences, not only assessment prose. Today's evidence does not warrant wiring screenshots into production assessment.

**Evidence:** `doom-play-agent/.local/offline-replays/navigation-image-ab-2026-11-17-resume-1/RESULTS.md` and `doom-play-agent/.local/offline-replays/navigation-image-independent-review-2026-11-17-1/REPORT.md`.

## 4. Read-only N=10 guidance → action → visual outcome trace

**Purpose / assumption.** We needed to determine whether the next problem was **prompt delivery**, **guidance quality**, or **action choice**, before implementing another planner or prompt rewrite.

**Method.** Codex traced **D4–D10** through assessment suggestion, assembled `composeGuidance()` text, acknowledged instructions, Decisions action, verified movement, and before/after frames. It checked replay/receipt/image integrity and looked for question-relevant visual information gain.

**Result.** Guidance and its suggestion arrived at Decisions unchanged; no demonstrated prompt-delivery, CAS or history contradiction. D6–D7 gave meaningful incremental visibility of floor and basin border. D8's substantial forward motion largely stalled information gain. At **D9**, suggestion wording ambiguously combined the left recess with “floor beyond the pillar”; at **D10**, it shifted to the left barrier's floor junction with no clear relationship to the basin-side question. The D9–D10 actions progressively obscured relevant geometry.

**Why the investigation did not resolve the gameplay problem.** This was diagnosis, not an intervention. The evidence shows **target/referent drift** and loss of useful visibility; it does not establish that different wording would have caused a different action.

**Potential improvement.** Preserve the stable hard-coded guidance envelope and test **referent specificity within the existing `investigationGuidance` field** before introducing a short-term-objective abstraction. Require concrete reference to the uncertain boundary and explicitly distinguish nearby lookalikes. Later A/B results constrained how much benefit we can claim from that change.

**Evidence:** historical N=10 `result.json`, D4–D10 image sidecars, and Codex trace report supplied November 17.

## 5. Deterministic replay feasibility and source audit

**Purpose / assumption.** A controlled gameplay A/B requires identical initial game states. We considered native save/load but first asked whether **replaying recorded actions from a fresh engine** could reconstruct a historical checkpoint.

**Method.** Static audit of controlled-title engine initialization, the neutral-first sequence, RNG reset, clock, Worker action masks, existing Node Worker-entry test seam, and persisted historical actions/screenshots. It verified the shareware IWAD digest and a pinned local WASM/build receipt.

**Result.** The first investigation stopped **before engine execution** because the historical run had not persisted the browser-loaded WASM SHA-256. That left replay reproducibility untested. Subsequent work treated this as a provenance caveat rather than an empirical blocker.

**Why the first attempt stalled.** It required historical byte identity as a prerequisite even though replay could be tested directly with the pinned candidate and compared against the historical pose/pixel evidence.

**Potential improvement.** Record the actually loaded WASM SHA-256 in future run provenance. Distinguish *proven exact asset identity* from *empirical reproduction of all observed checkpoints*. Do not build native save/load unless replay shows an actual limitation.

**Evidence:** `doom-play-agent/.local/offline-replays/checkpoint-tic55-audit/audit.mjs` and `evidence.json`.

## 6. Deterministic replay with two real Workers

**Purpose / assumption.** Determine whether the real Worker can reproduce N=10's historical state exactly, independently of any provider or live browser.

**Method.** Two fresh isolated Node Workers used the pinned controlled-title WASM and explicit local **shareware** IWAD (never Freedoom). Each ran `load-i11 → init → prepare → neutral × 1`, then the recorded D1–D9 six-tic actions. Screenshots, raw pose, telemetry and facing probe were compared at tics **1, 7, 13, 19, 25, 31, 37, 43, 49 and 55**; Workers were also compared across every verified tic and full available native snapshots.

**Result.** **Pass.** Both Workers matched all ten historical checkpoints, including **full decoded RGBA SHA-256**, and matched each other for all per-tic receipts and sampled native fields. The historical D10 start at tic 55 was reproduced exactly. No model or network calls.

**Remaining limits / why this was not a complete solution.** The original browser-loaded WASM digest was missing; unseen state not persisted historically cannot be compared against the original. Worker-only replay does not yet prove controller-owned decision admission or real provider behavior.

**Potential improvement.** Preserve exact asset digests and deeper state samples in future experiment provenance when useful. Reuse the recorded action prefix; avoid implementing a general snapshot/save format merely because it might be useful someday.

**Evidence:** `doom-play-agent/.local/offline-replays/checkpoint-tic55-audit/replay.mjs` and `replay-evidence.json`.

## 7. Worker-level branching at tic 55

**Purpose / assumption.** Test whether two independently reconstructed checkpoints can execute **different actions** and produce verifiably distinct outcomes.

**Method.** Worker A executed historical D10 `forward × 6`; Worker B executed alternative `turn_right × 6`, both from exact tic 55. Checked all six tics, native receipts, pose, heading, probe and screenshot hashes.

**Result.** **Pass.** A exactly reproduced historical D10 at tic 61. B produced a different, verified tic-61 state/view and exposed more basin edge, but **did not show the hidden dry-floor junction**. B moved **17.57 Doom units despite being a turn**, due to inherited momentum; action labels alone are inadequate outcome measures.

**Remaining limits.** Scripted action differences do not show that alternative guidance would cause Decisions to choose those actions. Neither branch resolved note B.

**Potential improvement.** Always evaluate the actual six-tic outcome and image, including residual momentum. Bring the same branch comparison through controller ownership and request authorization before testing real model guidance.

**Evidence:** `doom-play-agent/.local/offline-replays/checkpoint-tic55-branch/REPORT.md`, `branch-evidence.json`, and `tic61-A-forward.png` / `tic61-B-turn-right.png`.

## 8. Single controller-owned tic-55 replay and admission smoke

**Purpose / assumption.** Determine whether **real `createSessionController()`**, not just the Worker, can own the replay and admit D10 from the historical checkpoint without silently advancing gameplay.

**Method.** Real controller and Worker with injected browser ports and a fake provider. Replay D1–D9 through normal controller dispatch. At tic 55 verify current image, state, prior-action context, prompt revision and fresh observation. Enter the valid D10 request through the fake provider's `beforeCreate` hook; intentionally fail the provider, then verify reader cleanup and unchanged game state. Tests also rejected stale revision/observation inputs.

**Result.** **Pass.** All historical checkpoints matched. D10 request contained the expected PNG/instructions/context. The intentional failure dispatched **zero** D10 actions, left tic 55 unchanged, drained fake work, and restored controller readiness. One harness assertion initially ran before a presentation update; it was moved to the correct publication boundary.

**Remaining limits.** This tested fake failure handling, not successful D10 dispatch or two-controller branching. In-memory Canvas and local lease checks were not actual Chrome/broker evidence.

**Potential improvement.** Confirm the successful controller dispatch fence and two independent controller branches, reusing existing seams rather than inventing a new checkpoint API.

**Evidence:** `doom-play-agent/.local/offline-replays/controller-tic55-smoke/REPORT.md` and `evidence.json`.

## 9. Two-controller branching with scripted fake providers

**Purpose / assumption.** Establish that two real, independent controllers can start from identical state, vary only one guidance field, and correctly execute distinct model-*simulated* choices.

**Method.** Each controller replayed D1–D9, acquired its own lease/session/ten-slot bounded run and fresh D10 observation. A used exact archived guidance and fake `forward`; B replaced only `landmarkInvestigation.suggestion` and fake `turn_right`. Replies were held until both checkpoints and requests passed comparison. Dispatched one six-tic action per controller.

**Result.** **Pass.** Both matched tic 55 exactly. After restoring the suggestion field, complete captured requests were identical. Both rejected stale admission inputs; A and B reproduced the known historical and Worker alternative tic-61 hashes, respectively.

**Remaining limits.** Scripted actions cannot prove **guidance sensitivity**: the fake provider returns its chosen action regardless of the prompt. No real provider wire transport was exercised.

**Potential improvement.** Validate the actual provider encoding and run a minimal, capped real Decisions A/B pilot with all non-guidance inputs frozen.

**Evidence:** `doom-play-agent/.local/offline-replays/controller-tic55-two-branch/REPORT.md` and `evidence.json`.

## 10. Real Decisions guidance-specificity A/B pilot

**Purpose / assumption.** Test whether a hand-written suggestion that distinguishes the rear-left recess from the basin-side floor changes real Decisions action selection **and** results in more useful visible geometry.

**Method.** Two verified controller-owned tic-55 sessions, same six-tic horizon, image, state, previous-action context, seven actions and **TypeSafe Jev release** through OpenRouter. A used historical suggestion; B changed **only** `landmarkInvestigation.suggestion`. Both the encoder preflight and actual outgoing body comparison confirmed this single-field difference. Exactly **two** real calls, order A → B, no retries/fallbacks.

**Result.** A selected `forward` and reproduced the original obscured D10 view; B selected `turn_right` and revealed more basin-side border and the farther pillar. Both ended at tic 61 with full verified receipts and health 100. **Neither revealed passage continuity.** The provider reported zero cost, but the calls were real provider invocations.

**Why this did not validate the hypothesis.** One pair cannot disentangle prompt effects from model sampling variability. It tested a **hand-authored** B suggestion, not whether `navigation-assessment.ts` can generate that suggestion. A more visible border is partial information gain, not a resolved route.

**Potential improvement.** Independent blinded visual scoring, followed by limited paired replication with the same immutable suggestions and alternated call order. Keep visual information gain, not action choice, as the success metric.

**Evidence:** `doom-play-agent/.local/offline-replays/controller-tic55-real-pilot/REPORT.md`, `evidence.json`, `live-calls.jsonl`, and branch frames.

## 11. Independent blinded review of the initial pilot

**Purpose / assumption.** Check whether the original observer's claim of B's visual advantage survived evaluation without knowledge of action, guidance, or arm label.

**Method.** Prepared anonymous shared-start and two-outcome images. A fresh Codex reviewer scored relevant visibility and connection evidence **before** opening the mapping. A locked review was SHA-256-verified before unblinding.

**Result.** Blinded Y was preferred with **moderate confidence** and scored **+1 relevant visibility / +1 connection evidence**; X scored **−1 / 0**. On unblinding, **Y = B (`turn_right`)**, X = A (`forward`). Both reviewer and original pilot agreed that the near pillar still concealed the decisive junction.

**Remaining limits.** Independent interpretation reduces evaluator bias but does not create a second Decisions trial. “+1 connection evidence” meant partial boundary information, **not proof of connected or traversable dry floor**.

**Potential improvement.** Repeat identical starting-state trials and apply preregistered scoring to each new outcome; avoid extrapolating one favorable view into a reliable navigation policy.

**Evidence:** `doom-play-agent/.local/offline-replays/d10-blinded-visual-review/blind-packet/REVIEW.md` and `UNBLINDING.md`.

## 12. Promote the controller-owned replay harness into tracked source

**Purpose / assumption.** The successful replay code was duplicated across ignored scratch experiments. We wanted a durable, small offline regression capability **without** building a generic replay framework or integrating paid inference.

**Method.** Consolidated a bounded **D10-specific fake-provider CLI** and small PNG helper, documented its use and authorization boundaries, retained all raw outputs in ignored `.local/`. Owner executed the promoted CLI against pinned WASM, explicit shareware IWAD and original N=10 run. The files were then committed and pushed.

**Result.** **Pass.** Tracked files: `doom-play-agent/experiments/replay-d10.mjs` and `replay-png.mjs`; documentation: root `AGENTS.md` and `doom-play-agent/README.md`. CLI reported `Offline D10 replay passed.` Evidence: `doom-play-agent/.local/offline-replays/tracked-d10-ab/`. Real-provider mode was intentionally **not** added.

**Remaining limits / why it is not yet a general tool.** It reconstructs this recorded D10 comparison, not arbitrary maps, save states or historical checkpoints; it does not offer real Decisions experimental execution. That narrowness is intentional.

**Potential improvement.** Expand only if a second concrete checkpoint experiment needs the same seam and can justify an extraction. Preserve deterministic checks and explicit runtime/API authorization; keep IWAD and result artifacts out of source control.

**Reproduction command (with local assets and the original ignored run present):**

```bash
node doom-play-agent/experiments/replay-d10.mjs \
  --wasm app/public/doom.wasm \
  --iwad assets/doom-shareware-20261009T173326Z-bffb50/DOOM1.WAD \
  --run doom-play-agent/.local/runs/2026-11-16T23-39-58.099Z_594e7297-3d53-4594-8123-a6ee9ee2ac15/result.json
```

## 13. Real Decisions A/B replication: two more paired trials

**Purpose / assumption.** Test whether the pilot's better B outcome repeats, rather than reflecting one stochastic action selection.

**Method.** Reconstructed tic 55 independently for each arm, froze the original A and B suggestion strings and all other request fields, and issued exactly **four** more real OpenRouter Decisions calls, ordered **2B → 2A → 3A → 3B**. Provider model release remained `typesafe/jev-1.14-20261014`. All calls returned HTTP 200; all verified six tics without retries or uncertain outcomes.

**Results:**

| Pair | A: archived guidance | B: specific guidance | Numerical verdict after blinded review |
|---|---|---|---|
| Initial pilot | `forward`: −1 / 0 | `turn_right`: +1 / +1 | B better (pilot only) |
| Replication 2 | `forward`: −1 / 0 | `turn_left`: −1 / 0 | Tie |
| Replication 3 | `turn_left`: −1 / 0 | `forward`: −1 / 0 | Tie |

Scores are **relevant visibility / connection evidence**, relative to the shared tic-55 starting view. The four replication calls generated only **two distinct screenshot hashes**: one for `forward`, one for `turn_left`. A and B each selected both actions across the replicated pairs. All ended at tic 61 with health 100 and the junction hidden.

**Why the proposed change did not show repeatable benefit.** B was **strictly better in 0/2 replication pairs** under the preregistered rule (at least one higher visual score and neither lower). The exact same suggestion yielded different selected actions across calls, and the replicated outcomes all reduced relevant visibility versus tic 55. One favorable pilot plus two numerical ties is **insufficient to conclude reliable guidance improvement**.

**Potential improvement / condition for revisiting.** Do not widen the same A/B sample indefinitely or tune `navigation-assessment.ts` based on this result. First identify an action or short trajectory that genuinely exposes the target geometry. If a new test is warranted, freeze a new hypothesis with an outcome that is both observable and consequential over multiple decisions; distinguish stochastic action choice from actual information gain.

**Evidence:** `doom-play-agent/.local/offline-replays/controller-tic55-real-replication/evidence.json`, `live-calls.jsonl`, `preregistration.md` and `UNBLINDING.md`.

## 14. Replication blinded review, pairing-packet repair, and unblinding

**Purpose / assumption.** Prevent knowledge of the guidance arm or chosen action from influencing the interpretation of four replication outcome screenshots and apply the **predeclared** scoring rule.

**Method.** A fresh Codex reviewer received anonymous screenshots and a rubric. The first review attempt correctly **stopped**: the blind packet named all four outcomes but omitted which two formed each experimental pair. Preparation then added a **pairing-only** `pairings.json` without revealing arms or action labels. The same still-blinded reviewer resumed, locked `REVIEW.md`, recorded SHA-256 `4c28d17870f556c7ec16eb5e5d2d74c7358515ef5f8eea1820ea11f896d13537`; a separate session verified that hash, read preregistration and then unsealed the mapping.

**Result.** All **four** outcomes scored **−1 / 0**. The reviewer slightly preferred **A in pair 2** and **B in pair 3**, but those preferences were not numerical wins under the rule. Both slight preferences actually favored the same `forward` viewpoint, regardless of arm. **Both pairs tied**; no additional connection evidence was visible.

**Why the first review attempt could not proceed.** The anonymization removed pairing relationships that were essential for the unit of analysis. The issue was a **test-packet construction defect**, not a model or gameplay failure. After repair, the visual results remained unfavorable to a robust B advantage.

**Potential improvement.** Any future blind packet should include validated opaque trial/pair IDs from the start, while withholding A/B mapping, filenames identifying actions, and prompts. Score unique image content consistently but preserve separate trial assignments. Lock and hash review findings **before** unblinding and enforce the preregistered numerical rule even when qualitative preferences seem suggestive.

**Evidence:** `doom-play-agent/.local/offline-replays/controller-tic55-real-replication/blind-packet/pairings.json`, `REVIEW.md`, `UNBLINDING.md`, `preregistration.md` and private mapping (do not distribute the latter to blinded reviewers).

## 15. First bounded manual viewpoint experiment: tic 55 → 79

**Purpose / assumption.** We had spent the day optimizing one-step guidance without a demonstrated trajectory that actually reveals the target junction. We asked whether a screenshot-guided manual sequence could find a better viewpoint from the reproducible tic-55 state, **without** calling Decisions.

**Method.** Replayed historical tic 55; after each screenshot Codex chose one of at most four new actions, six tics each. Actual sequence: **`backward → backward → turn_right → backward`**. Verified all `6/6/6` receipts and final tic 79. An initial scratch attempt stopped before D1 because of PNG buffer typing; correction used a fresh Worker. No external inference or production changes.

**Result.** **Partial.** At tic 79, the dark tiled strip beside the basin was clearer between the near and far pillars, with the rear-left recess separately visible. However, the strip still disappeared behind the near pillar; its continuation or termination remained unknown.

**Why it did not fully work.** The new viewpoint increased some relevant visibility but **did not move the viewing ray past the occluding pillar**. Four local actions were not enough to expose the critical junction. The partial gain does not prove a viable or traversable route.

**Potential improvement.** Try an offset toward visible dry floor left of the pillar, rather than simply advancing toward the obstruction. More generally, evaluate the information obtained over short action *sequences*, not just net forward displacement. Avoid encoding “always back up” as a navigation rule from one case.

**Evidence:** `doom-play-agent/.local/offline-replays/tic55-manual-viewpoint/REPORT.md`, `sequence.json`, `tic55-reference.png`, `tic79-backward.png`.

## 16. Final bounded manual viewpoint experiment: tic 79 → 103

**Purpose / assumption.** Give the same landmark one final, finite opportunity for direct visual resolution using a lateral/offset viewpoint before moving on.

**Method.** Reconstructed and verified tic 79 exactly, then chose four screenshot-guided six-tic actions: **`turn_left → turn_left → forward → turn_right`**. All receipts verified `6/6/6`; final tic **103**, with no reported damage, collision rejection, terminal or uncertain execution. The owner explicitly authorized the bounded local Doom/WASM execution.

**Result.** **No resolution within budget.** The final view was approximately **13.2 Doom units left** of the starting viewpoint and showed more dry foreground while retaining the recess/strip distinction. The basin-side strip still vanished behind the near pillar. Neither continuity nor termination was visible.

**Why it did not work.** The local viewpoint changes failed to remove the relevant occlusion. We do **not** know whether a better viewpoint exists elsewhere, whether the suspected dry connection exists, or whether passage is traversable. An eight-action combined manual budget is evidence of a failed *local investigation*, not proof of impossibility.

**Potential improvement / decision.** **Pause this landmark investigation.** If it becomes strategically important again, first establish a demonstrably discriminating viewpoint or route (possibly outside this short local horizon) before further prompt tuning. Otherwise, prioritize actual autonomous map exploration and exit discovery.

**Evidence:** `doom-play-agent/.local/offline-replays/tic79-final-viewpoint/REPORT.md`, `sequence.json`, `tic79-reference.png`, `tic103-turn-right.png`.

---

## Cross-experiment interpretation

### Findings supported by the evidence

1. **The models' local navigation descriptions can lose an important referent.** The rear-left recess and basin-side floor were conflated in late guidance; exact delivery to Decisions was verified. That is a demonstrated **guidance-content defect**, not proof of causation for the chosen actions.
2. **More detailed or more contextual descriptions did not reliably help.** History text, generic spatial perception instructions, and screenshot-enabled assessment each failed their predefined improvement criterion. This does not show that better spatial representations are impossible; it shows these interventions were insufficient.
3. **One favorable real Decisions pair was not robust.** The hand-authored B suggestion produced a better visual outcome in the pilot, but zero strict wins across two replicated pairs. Stochastic action selection and one-step viewpoint quality are central limitations.
4. **Action labels are inadequate proxies for navigation progress.** Even a pure turn translated the player through residual momentum; a step closer to a feature sometimes obscured it more. Verified pixels and game state, rather than distance or plausible action labels, are the appropriate evidence.
5. **Deterministic replay is real and reusable.** Both Worker-only and controller-owned runs reproduced the historical checkpoint; the tracked CLI now protects a real end-to-end offline case. This was the day's clearest shipped engineering result.
6. **Note B remains unresolved.** We neither confirmed a dry continuation nor ruled it out. Do not promote the note to an answered/completed hypothesis based on these experiments.

### Mistakes and improvements to experimental practice

- **Too many iterations on proxy outcomes.** We repeatedly improved or inspected model prose before demonstrating a successful information-gathering route. Future navigation experiments should start with an observable gameplay success criterion and a short action budget.
- **A single favorable A/B pair was suggestive, not sufficient.** Replication with controlled states and blinded judging prevented a premature production prompt change. Use fixed intervention strings, sample counts and scoring rules before inference.
- **Preserve the right blinding metadata.** Anonymous screenshot filenames alone were insufficient. Future packets need an opaque pair/trial mapping that keeps arms sealed.
- **Missing provenance should be recorded, not automatically treated as a fatal blocker.** Persist the actually loaded WASM hash in future run evidence when changing provenance code, but do not require new infrastructure when empirical replay can falsify the assumption directly.
- **Separate tool reliability from agent performance.** Passing replay, admission, byte-difference, cleanup and action receipt tests establishes test validity, not better Doom gameplay. Do not turn technical verification into a navigation success claim.
- **Avoid turning today's one-off infrastructure into its own project.** Keep the tracked `replay-d10.mjs` narrow and fake-provider-only until an actual second use case demonstrates needed generalization.

## Recommended next milestone

**Return to a fresh, unchanged autonomous N=30 Doom run and assess general exploration rather than note B alone.** The question is whether keeping the same historical objective selected for the entire run helps exploration or consumes decisions around a visually ambiguous landmark.

Measure new verified viewpoints/areas, repeated exact XY/pose visits, meaningful movement and changes in obstacle visibility, survival, and how many decisions are spent around the fixed landmark. A single run is a descriptive baseline, **not** proof that fixed note selection causes or prevents progress. If comparison with free exploration is eventually needed, use an actually matched control: an earlier history-off run with unavailable memory and `free-explore` is **not** a valid like-for-like landmark control.

Only after that evidence should we reconsider initial historical note selection, dynamic reselection or explicit short-term objectives. The central objective remains **Doom visibly exploring and ultimately reaching the exit under the Decisions API**, not indefinitely resolving one uncertain historical hypothesis.

## What was changed in the repository

- **Committed and pushed:** `doom-play-agent/experiments/replay-d10.mjs`, `doom-play-agent/experiments/replay-png.mjs`, root `AGENTS.md` guidance and `doom-play-agent/README.md` usage documentation.
- **Not integrated:** navigation-history amendment, spatial perception prompt amendment, screenshot-enabled navigation assessment, the hand-written D10 suggestion, or a short-term planner.
- **Ignored local evidence retained:** historical N=10 run and experiment data under `doom-play-agent/.local/`; not automatically part of the Git repository.
- **No claimed historical-note update:** The passage hypothesis is still unresolved; absence of proof is not a negative passage verdict.
