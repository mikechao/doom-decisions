# DoomPlayAgent: Next Experiments — Objective Progress (D–G)

**Status:** Proposed roadmap; no implementation authorized  
**Target:** `doom-play-agent/` on `main`  
**Last updated:** 2026-11-12

## Goal

Move from *measuring and influencing movement* to *determining whether DoomPlayAgent is making verifiable progress on its selected navigation objective*.

The project goal remains browser-visible Doom controlled by the Decisions API. These experiments should support that goal with the smallest useful changes, not introduce a general navigation framework.

> **Guiding question:** What's the smallest experiment that will prove or disprove our next architectural assumption?

Work in short cycles: **investigate → agree on the evidence/contract → implement only if justified → offline verification → independent `/review` → separately authorized live run → inspect persisted evidence.**

## What A–C established

| Experiment | Result | Important limitation |
| --- | --- | --- |
| **A — Movement summary** | Deterministic per-decision endpoint XY displacement and signed heading delta from reported telemetry. | Endpoint displacement is not path length, collision proof, or objective progress. |
| **B — Recent pose comparison** | Passive within-run pose/checkpoint recurrence evidence. | Exact coordinate recurrence is not a general loop detector. |
| **C — Recent verified history in Decisions guidance** | A bounded summary of the previous four eligible completed decisions is composed, acknowledged, and persisted correctly. | Its behavioral benefit is not causally established. |

Four matched N=30 runs were examined: two history-off and two history-on. The history-off runs ended near the same indoor wall/corner (18.74 Doom units apart); the history-on runs ended in a visually similar outdoor courtyard (7.13 units apart). The two history-on runs showed sustained translation after low-movement episodes, **but a history-off run also resumed translation**. Different early decisions and varying perception/assessment text prevent attributing the route split or recovery to history alone.

**Decision:** Treat Experiment C as technically successful and behaviorally suggestive. Do not add more history machinery or collect additional A/B/C comparison runs merely to refine these observations.

## Current navigation objective

The selected historical landmark is note `1d3cf84f-8e29-4e40-8c00-87e274aaeefd`, **revision 9**, on E1M1. Its hypothesis describes the area after a blue-water chamber, a green-striped barrel, a red/green object, and a possible passage on the right. Its next question is:

> Does the right-side passage connect onward toward the exit, and is its approach clear?

The objective is selected once per run and remains fixed. Existing navigation assessment labels (`possible-match`, `no-visible-match`, `insufficient-evidence`) are *advisory visual comparisons*, not proof of landmark arrival, passage traversal, or objective completion.

Existing evidence includes each persisted `DecisionRecord`, scene perceptions, navigation assessments, reasoning/admission/receipt observations, verified movement summaries, recent-pose comparisons, and screenshot sidecars. The persisted run artifacts use schema v2; no persistence change is planned here.

---

## Experiment D — Investigate existing objective-progress evidence

**Type:** Read-only investigation; **first next step**.  
**Question:** Do the saved runs already contain evidence that the agent observed, approached, traversed, or learned something about the candidate right-side passage?

### Smallest experiment

Inspect the **two history-on N=30 runs** first. Correlate selected screenshots, model-generated perceptions and navigation assessments, verified XY/heading/tics, facing probes, and action receipts. Use the history-off runs as context only where they help distinguish routes. Avoid re-auditing previously validated artifact integrity unless a defect appears.

For each potentially objective-relevant point, record:

1. **When and where:** decision ordinal, tic, verified pose, and screenshot filename.
2. **What was observed:** direct visible features, keeping those separate from model descriptions.
3. **What the agent inferred:** perception and assessment text/status, with uncertainty intact.
4. **What happened next:** subsequent verified movement, viewing direction, and scene continuity.
5. **What it establishes:** visible resemblance, candidate opening, possible approach, supported traversal, answer to the next question, or **unknown**.

Compare poses with the landmark's recorded anchor where useful, using correct raw-coordinate units. Spatial proximity alone does not establish that the landmark was recognized or reached. A `possible-match` does not establish arrival; a courtyard view does not establish passage connectivity or exit progress.

### Deliverable and decision gate

Produce a compact, cited **objective-evidence timeline** (file paths and decision ordinals) and classify the principal gap:

- **Evidence already resolves the question:** investigate only the minimum mechanism for reporting/retaining that result.
- **Relevant passage was seen but not pursued or remembered:** consider short-term objective-context continuity in Experiment F.
- **No convincing objective-related observation:** prioritize reaching/locating the objective; do not implement a completion detector yet.
- **Observations cannot distinguish the possibilities:** document the missing signal and design only the smallest way to acquire it.

**Stop condition:** If the artifacts do not support a claim, report `unknown` instead of manufacturing an objective-progress label.

## Experiment E — Define a minimal objective-progress evaluation

**Type:** Evidence rubric and offline evaluation; only implement code if D warrants it.  
**Question:** Can we consistently distinguish *evidence of progress* from *a plausible story about progress*?

### Candidate rubric — not a committed data model

| Candidate finding | Minimal supporting evidence | What it must not imply |
| --- | --- | --- |
| **Unknown** | Insufficient or conflicting observations. | Failure, lack of progress, or absence of a passage. |
| **Possible landmark observed** | A screenshot and associated observations plausibly resemble the historical description. | Confirmed landmark identity or arrival. |
| **Candidate passage visible** | A specific opening is visible, consistent with the current objective. | That it is accessible or leads onward. |
| **Passage likely traversed** | Continuous verified movement plus before/after visual evidence supporting passage through that opening. | Proven sector topology or exit connectivity. |
| **Question resolved** | Direct evidence sufficient to answer the specific next question, with uncertainty stated. | Automatic landmark completion or database mutation. |

These are *evaluation findings*, not necessarily mutually exclusive runtime states. Use as few distinctions as the evidence supports; if traversal cannot be reliably judged from the retained observations, leave it unresolved.

### Smallest experiment

Apply the rubric manually or with a lightweight deterministic offline analysis to selected D checkpoints. Check whether two independent reviews of the same evidence would reach the same defensible conclusion. Reuse existing perceptions and assessments; **do not add a new LLM stage merely to create a progress label**.

### Decision gate

- If existing assessments and images suffice, document an evaluation procedure and **skip new implementation**.
- If the gap is specific and repeatable (for example, losing a previously seen candidate passage), define the smallest additional context contract for F.
- If the evidence cannot support reliable progress evaluation, identify the exact missing observation before designing a feature.

**Success:** The evaluation can state what is supported, what is tentative, and what remains unknown without promoting model interpretation into verified world state.

## Experiment F — Optionally carry objective-related context forward

**Type:** Small implementation *only if D/E demonstrate a specific need*.  
**Hypothesis:** A bounded summary of recent objective-relevant observations helps Decisions continue investigating a landmark after a relevant feature leaves the current screenshot.

### Candidate change

At the existing per-decision guidance composition point, derive a short, bounded summary from **previously published** records: recent perception/assessment findings, the selected objective, associated decision/tic/pose references, and explicit uncertainty. Keep the current screenshot/state authoritative. Retain the Experiment C movement-history block unchanged.

Example of appropriately qualified advisory context:

> Two decisions ago, a perception described a possible opening on the right. Its connectivity was not established. The current screenshot takes precedence.

This example is illustrative, **not an approved payload format**.

### Constraints

- Reuse existing records and prompt composition; no separate mutable memory store.
- No new model call by default; do not summarize uncertainty into certainty.
- Do not change the fixed objective, action/tic authority, prompt CAS, receipt checks, no-retry behavior, error handling, or persistence schema.
- Bound history by decision count and prompt size; include only completed earlier evidence, never in-flight or future data.
- Preserve baseline gameplay and controller contracts in both landmark and free-explore modes. Objective-related context may legitimately be absent for free exploration.
- Test the actual need shown by D/E; don't create a general navigation state machine, path planner, or autonomous landmark lifecycle.

### Smallest verification

Focused offline tests should prove temporal eligibility, ordering and bounds, correct qualification/uncertainty, no duplicated prompt amendments, and unchanged CAS/decision behavior. Run the existing package checks and an independent `/review` before authorizing gameplay.

**Decision gate:** Skip F entirely if the existing guidance already carries enough useful context or if D/E cannot identify a concrete context-loss failure.

## Experiment G — Evaluate one bounded objective investigation

**Type:** Separately authorized live experiment, after the necessary evidence/evaluation contract exists.  
**Question:** Can the agent gather verifiable evidence addressing the selected landmark's *specific next question*?

### Smallest experiment

Run a single, broker-bounded gameplay session from a known starting state with the fixed landmark, consistent IWAD/configuration, selected models, and retained artifact logging. Keep the scope at one objective; **N=30 is a reasonable initial horizon, not a guarantee of success**. If F was implemented, make that the only intentional behavioral change relative to a suitable existing comparator; otherwise evaluate the existing agent unchanged.

### Primary outcome (not just displacement)

Report whether observations support one of:

- **Question resolved:** evidence establishes whether the candidate passage is approachable/traversable and what is visible beyond it, without overclaiming exit connectivity.
- **Partial progress:** the passage was plausibly observed or approached, but the connection remains unknown.
- **No supported progress / unknown:** the run did not provide sufficient relevant evidence.

Support each finding with decision ordinals, verified pose/action continuity, and relevant screenshots. Treat `possible-match` as advisory. Do not automatically mark the landmark complete.

### Secondary diagnostics

Retain existing movement and low-movement metrics for troubleshooting, not as success criteria. In particular, the exploratory wall episode definition is **endpoint displacement ≤3 Doom units plus a valid pre-action solid-ray distance ≤24**; it does not by itself prove being stuck or escaping. Record pose revisits, endpoint separation, health, receipt integrity, and resource budget only as relevant.

**Decision gate:** If objective evidence is still insufficient, determine whether the problem was *navigation to the relevant area*, *visual recognition*, *continuity across decisions*, or *evaluation of observed evidence*. Address only the demonstrated blocker in the next iteration.

---

## Execution order and scope control

```text
D: Inspect retained objective evidence (read-only)
            |
            v
Can existing evidence resolve or narrow the objective question?
            |
            v
E: Define/validate a minimal evidence rubric (offline)
            |
            +-- Existing information sufficient --> Skip F
            |
            +-- Demonstrated context-loss gap --> F: Small guidance change
            |
            v
G: One bounded objective-focused live evaluation
            |
            v
Inspect artifact; choose the next smallest proven need
```

Before any live run or change to a historical artifact, require separate authorization. Read-only investigations must not edit source, stage/commit/push, run Doom or the agent, invoke paid inference/Decisions APIs, or modify historical SQLite/run artifacts. Offline tests after implementation are allowed only within the agreed scope and must not initiate gameplay or paid services.

## Initial artifacts and source entry points

- **C1:** `doom-play-agent/.local/runs/2026-11-11T23-05-35.619Z_693e4b63-3614-4c57-b7ef-ecc79c6f2f9a/result.json`
- **C2:** `doom-play-agent/.local/runs/2026-11-11T23-29-51.774Z_cf6badc9-46fa-4864-b012-f629489bae34/result.json`
- **Original history-off B30:** `doom-play-agent/.local/runs/2026-11-11T21-40-54.409Z_565bcd50-6e09-4933-b03a-96415a384d84/result.json`
- **Second matched history-off B3:** separate `doom-decisions-baseline` worktree, `doom-play-agent/.local/runs/2026-11-12T18-01-05.852Z_613ab607-6526-46e0-812c-4178fcc193c6/result.json`
- **Coordinator:** `doom-play-agent/src/doom-play-agent.ts`
- **Contracts:** `doom-play-agent/src/doom-play-agent-types.ts`
- **Reasoning:** `doom-play-agent/src/scene-perception.ts`, `doom-play-agent/src/navigation-assessment.ts`
- **Movement/pose evidence:** `doom-play-agent/src/movement-summary.ts`, `doom-play-agent/src/recent-pose-comparison.ts`
- **Architecture guides:** `doom-play-agent/README.md`, `doom-play-agent/doom-play-agent.md`

Paths are relative to the specified worktree. Before relying on code line numbers or architecture claims, confirm the current local branch, HEAD, working-tree status, and source. Retained screenshots are sidecars in the same run directories. The unmatched free-explore control run is **not** part of the matched four-run comparison.

## Completion criteria for this roadmap

The milestone is not more sophisticated navigation code. It is a **defensible, evidence-backed answer about the selected navigation question**, or a precise demonstration of what prevents such an answer. Anything beyond that should be justified by the next smallest experiment.
