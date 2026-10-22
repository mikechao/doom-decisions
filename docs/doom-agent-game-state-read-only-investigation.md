# Doom Decisions: read-only investigation and two-commit implementation plan

You are investigating the existing `feat/agent-control` feature worktree for its owner. **This task authorizes read-only source/Git inspection and a concrete implementation plan only.** Do not implement changes or create commits. The owner will review your findings before authorizing an implementation slice.

## Location and authorization

- Target worktree: `/Users/mike/projects/doom-decisions-agent-control`.
- Ordinary worktree to leave untouched: `/Users/mike/projects/doom-decisions` (`main`).
- Read the target worktree's `AGENTS.md` first and follow applicable repository instructions. Explicit read-only limits here override standing test authorization.
- Verify cwd, worktree paths, current branch, HEAD, tracked/untracked status, merge base and ahead/behind ancestry using read-only Git commands. Identify any additional applicable instructions before inspecting their scope.
- Last reported state, **not a current fact**: feature HEAD `294fa147091dd8fb37d52f55acb0ef2592561f13`, main HEAD/merge base `2458e03b8f17daa53f3f2a0ac86d6c7f587871f5`, feature five commits ahead, both clean. Recheck and identify Slice C in current history/source.
- If the target is on an unexpected branch or Slice C is absent, report the discrepancy before making branch-specific recommendations. Preserve all existing changes; distinguish their effects on findings.
- Do not edit files, install/download dependencies, run tests/builds or application/CLI/runtime commands, start servers, launch/use/automate a browser, execute Worker/WASM, use game assets, or make network/authenticated/billable API calls. Do not switch/reset/clean/merge/cherry-pick worktrees or make Git/GitHub mutations. Read CLI source rather than executing commands that could contact the bridge.
- Do not invoke the gameplay skill or its live workflow. Read its documentation as contract evidence only. No provider reconfiguration or sub-agent delegation is needed.

## Settled architecture and product behavior

**Design A is selected:** extend the existing agent projection using normalized domain data and existing provenance/eligibility helpers. Keep `formatDecisionState()` and native/Worker sampling unchanged. Do not reopen a shared `GameEvidenceContext`/`GameStateContext` design without concrete source evidence of meaningful duplicated semantic assembly. A small pure agent-specific projector is acceptable if it reduces controller complexity; do not introduce another state owner, cache, or generic telemetry framework.

Implement later as two distinct, independently reviewable commits on `feat/agent-control`:

1. Complete Codex observation of all five verified signals, without changing Decisions request behavior.
2. Give Codex session-scoped control of effective inclusion flags in agent mode, with all five initially enabled, preserving human browser configuration.

| Policy | Ordinary browser mode | Codex agent mode |
| --- | --- | --- |
| Inclusion owner | Human's five UI toggles | Codex's effective agent settings |
| Initial flags | Existing saved human selection | All five enabled regardless of human selection |
| Codex observations | Not applicable | All five eligible signals regardless of flags |
| Decisions request | Included and eligible signals only | Codex-enabled and eligible signals only |
| Saved human configuration | Existing behavior | Unchanged by agent defaults/updates |

The five flags are `includeReadyWeapon`, `includeAmmo`, `includeHealth`, `includeFacingProbe`, and `includePreviousAction`. **Observation availability and request inclusion are separate policies.** Do not propose forcing every flag true per decision. An enabled flag cannot fabricate missing, stale, terminal, or otherwise ineligible evidence. Agent overrides must not persist into normal browser settings or instructions. Effective defaults need not toggle visible human DOM checkboxes.

Keep the seven Decisions-selected actions, requested tic semantics, model/provider paths, SDK cleanup, attempt charging, Stop, receipt/frame/Canvas/PNG identity and all existing admission/lifecycle boundaries intact. No new native/Worker telemetry or read operations are expected; flag any demonstrated need before implementation.

## Investigation

Treat the file list and previous findings below as leads to verify, not established facts or an instruction to edit every file. Use concise source excerpts and exact file/line references for conclusions.

### 1. Trace all five signals and the complete observation contract

Inspect `app/src/session-controller.ts` (including `captureAgentObservation`), `agent-observation.ts`, `player-state.ts`, `worker-shared.ts`, `facing-probe.ts`, `previous-action.ts`, and `decision-request.ts`. Read `docs/doom-game-state-pipeline.md` for observation provenance; no schema/index/sampling changes are authorized.

For each signal, identify its exact existing TypeScript type, owner, normalization/eligibility helper, capture boundary, current agent representation, missing fields, and minimal proposed representation:

- Ready weapon: existing nullable normalized `{id, name, ammoType}`. Confirm current scalar `weaponId`; prefer retaining existing scalars for this milestone unless removal has a concrete benefit and a complete consumer migration.
- Ammo: existing nullable normalized inventory with `{current, max}` quantities/capacities. Confirm exact keys and null semantics rather than inventing a shape. Retain existing current-count scalars initially.
- Health: retain existing numeric value and ready/terminal eligibility; native zero health does not itself establish a ready observation.
- Facing probe: reuse observation-qualified structured evidence. Verify enum meanings, verified tic, door metadata, approximate distance and units. A valid no-relevant-line sample (`kind=1`, if confirmed) must remain distinct from unavailable/ineligible `null`. Preserve rejection of stale contradictory probes. Explain the forward center-ray approximation and approximately 64-Doom-unit range; it cannot guarantee traversability or successful door use.
- Previous action: reuse eligible receipt-derived outcome, including existing `.text` alongside action/tics/endTic. Verify resulting frame/tic/XY eligibility. Initial, terminal, and ineligible outcomes must be `null`. Do not recompute displacement, infer it from images, or parse generated prose. Text does not prove a hit or door activation.

Trace producer → strict exact-key DTO/parser → browser bridge → broker → CLI output → skill consumers. Inspect `app/src/agent-browser.ts`, `app/agent-bridge.mjs`, `scripts/doom-agent.mjs`, `.agents/skills/doom-decisions/SKILL.md`, `app/README.md`, fixtures and relevant tests. Identify nested aliases and how to produce deeply detached values without mutating/freezing borrowed native structures. Confirm transports can carry the full DTO without duplicating semantic decoding or permitting unknown keys.

Identify every current observation operation and verification bracket so Commit 1 can demonstrate unchanged Worker operation count/order, gameplay tics, provider calls and native/frame/Canvas verification timing. Observations are detached snapshots, not reusable proof tokens.

### 2. Trace configuration ownership, revisions and admission

Inspect human draft/save/persistence in `app/src/main.ts` and `app/index.html`, and controller effective configuration, prompt editing, request capture, observation grants, run admission/termination, Stop and invalidation. Follow existing `observe`, `get-prompt`, `set-prompt`, and `decide` through browser, broker and CLI.

Answer with concrete call paths/types:

1. Where are saved human instructions/flags, unsaved UI drafts, current effective settings, and immutable per-decision configuration held? Which writes persist or update UI? Which consumers depend on object identity versus a revision/value comparison?
2. What precisely starts and ends an agent session/run today? Distinguish bridge connection, browser authorization, bounded run, budget exhaustion, Stop, terminal/uncertain retirement, disconnect and refresh. Recommend the narrowest unambiguous lifecycle for fresh all-on defaults and disposal of agent overrides. Do not invent a new lifecycle without evidence.
3. How do current prompt revisions, session/run IDs, lease/epoch checks, observation grants and configuration identity interact? What invalidates a prior observation/authorization, and what order prevents stale or concurrent configuration writes from reaching admission/native dispatch?
4. Where can ephemeral agent flags and instructions live while preserving one effective configuration boundary for each admitted request? Reuse existing coherent control points; avoid a competing mutable settings store that can drift. Explicitly check whether current agent prompt writes already touch human-saved instructions.
5. During which states may Codex inspect/update flags? What happens during an admitted request, SDK cleanup, Stop and retirement? Which rejected changes preserve revision, grant and remaining budget? Preserve nonrefundable attempt reservation and all current fences.
6. Should get/set-prompt grow into a configuration operation, or should a small distinct get/set configuration command be introduced? Recommend exact names, argument/response TypeScript shapes, full replacement versus per-field patch semantics, required revision/fence fields, exact-key validation and error behavior. Explain the smallest coherent choice; do not assume flags belong on a text-only command.
7. Does any agent UI need to display effective settings or ownership? Recommend only the minimum clarity needed, with no writes into human drafts/saved settings and no UI redesign.

## Required two-commit plan

Provide concrete proposed interfaces and a short dependency-ordered file/test sequence for each commit. Keep both commits independently coherent and call out unavoidable coupling.

### Commit 1: complete verified Codex observations

- Extend the agent DTO/parser/projection using the existing five sources and helpers; retain useful existing scalars.
- Export all eligible signals independently of inclusion flags; preserve first-observation and terminal/null behavior.
- Update strict nested validation, fixtures, broker/CLI transport expectations, skill and docs together. No silent cross-version compatibility layer.
- Leave `formatDecisionState()`, request inclusion, provider behavior and action/verification lifecycle unchanged.
- Plan focused tests for complete values, null cases, detachment, eligibility/freshness, invalid nested combinations, strict unknown-key rejection, terminal behavior, broker/CLI round-trip and unchanged observation verification/operation boundaries.

### Commit 2: agent-controlled effective inclusion

- Initialize fresh agent-mode effective flags to all true at the recommended entry boundary. Define behavior on exit, Stop, restart/re-admission, budget exhaustion and retirement. Restore ordinary-mode policy without changing human saved flags or instructions.
- Add inspect/update operations with current revisions and fences, capturing changes only for future admissions and invalidating stale grants as required.
- Preserve the existing formatter as the request text authority. Enabled but ineligible fields remain omitted. Codex observation still exports every eligible field when its inclusion flag is false.
- Plan tests for all-on defaults against saved-off human flags; independent field changes; exact enabled/disabled request content; missing/ineligible evidence; stale revision and malformed command errors; configuration/grant invalidation; immutable admitted snapshots; Stop/cleanup/race behavior; attempt accounting; human settings isolation and normal-mode restoration. Use all 32 formatter flag combinations only if cheaply supported by the existing harness; do not build an elaborate new framework.
- Identify documentation/skill/CLI changes required for the final command contract.

For later implementation validation, recommend focused offline coverage and the repository's pre-authorized `npm --prefix app run check` when applicable with dependencies installed. **Do not execute it now.** Separate synthetic/offline evidence from future human-run browser/native/API acceptance. Do not request or imply authorization for live/billable trials, builds or commits.

## Response format

Return a concise report containing:

1. Verified worktree/branch/HEAD/status/ancestry and Slice C availability; discrepancies from the supplied baseline.
2. A five-signal source/type/eligibility/current-gap/proposed-DTO table with exact file/line references.
3. The configuration lifecycle and admission findings, including exact revision/grant/fence boundaries and saved-versus-effective ownership.
4. Proposed DTO and configuration command signatures, clearly labeled as proposals rather than existing APIs.
5. The explicit two-commit plan, per-commit acceptance tests and proportional validation, plus any coupling.
6. Concrete risks, simpler alternatives, no-go findings, unresolved source ambiguities, and only decisions that truly require owner input. Identify what can be resolved from source instead of asking speculative questions.

Challenge assumptions using source evidence, especially configuration isolation and session/run reset semantics. Stop after the report. The owner and staff engineering partner will review the plan before a separate implementation prompt is authorized; commits require separate agreement.
