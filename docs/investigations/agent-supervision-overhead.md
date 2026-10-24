# Doom agent supervision overhead

## Status, scope and provenance

Recorded 2026-10-24 from a completed read-only investigation of two MCP gameplay
sessions. This document preserves findings; it authorizes no implementation or
gameplay. Only the earlier skill-only removal of routine post-decision
`get-config` reads is implemented. Both follow-up candidates below are unimplemented.

The governing question is: **What's the smallest experiment that will prove or
disprove our next architectural assumption?**

| Label | Session ID | Description |
| --- | --- | --- |
| B | `01a16f35-4177-7ab0-afea-85aadc6d65db` | Previous MCP run |
| A | `01a16f56-4fd3-7ac2-a55c-cc45555f56a3` | Optimized config-read MCP run |

Sources are the local archived Codex JSONL transcripts identified by these IDs,
the completed investigation, and the repository contracts linked below. The
transcripts are not committed or required to read this record. Transcript line
references are 1-based. The investigation validated embedded identities, complete
call/results and task completion. Usage totals count each unique response's usage
once, rather than summing repeated cumulative snapshots; neither run compacted.

Both used Codex 0.164.0, `gpt-6.1-sol` with high effort, and OpenRouter
`typesafe/jev-1.14`. Each completed ten provider-invoked decisions, selected
`forward` every time, verified 84 action tics, and inspected every required
resulting PNG. Both ended at tic 85, including the initial neutral tic.

These are **noncontrolled runs**. B used horizons `6 → 12 → 6`; A used
`6 → 18 → 6`. Their skill versions, development instructions and sandbox network
settings differed. The archived injected skills differed from their recorded
HEAD versions, so HEAD alone does not identify the effective contract. Identical
final game frames do not establish a controlled benchmark or transport advantage.

## Demonstrated config-read reduction

The existing optimization removes routine post-decision config reads while
retaining pre-decision validation and final exhaustion accounting.

| Measured metric | B: previous MCP | A: optimized MCP |
| --- | ---: | ---: |
| Provider-invoked completed decisions | 10 | 10 |
| MCP domain calls | 46 | 41 |
| `doom_observe` | 11 | 13 |
| `doom_get_config` | 21 | 14 |
| `doom_set_config` | 2 | 2 |
| `doom_decide` | 10 | 10 |
| Outer tool/orchestration calls | 61 | 56 |
| Model invocations | 62 | 57 |
| Input tokens | 3,098,691 | 2,703,867 |
| Cached input tokens | 2,982,784 | 2,605,440 |
| Uncached input tokens | 115,907 | 98,427 |
| Output tokens | 7,862 | 5,814 |
| User invocation → task completion | 248.391 s | 186.896 s |
| Inspected resulting + startup images | 12 | 12 |

A's 14 config reads reconcile as **1 startup + 10 pre-decision + 2 extra
post-write checks + 1 final exhaustion**. Both runs changed duration twice.
B used preceding post-decision reads for pre-write CAS scope; A performed fresh
pre-write preparation, explaining its two additional observations. No residual
duplicate config read was demonstrated in A.

The call reduction is observed. Attributing all elapsed or token differences to
it is not established. Timing above consistently ends at the task-complete record;
the previously quoted 186.847 s for A ends at its final assistant message instead.
Unattributed record gaps must not be labeled provider latency, approval latency
or model thinking without supporting evidence.

## Ranked follow-up candidates

### 1. Guarded `observe → get-config` orchestration pair

**Evidence:** B contains nine eligible adjacent boundaries and A contains eleven.
At each, a fresh observation matched an already-delivered image's PNG,
native/Canvas hashes and tic under the same active-run ownership, followed by a
separate config read validating current run/revision/allowance. Examples are
B lines 126–136 and A lines 196–204; post-write examples are B lines 97–107
and A lines 104–112.

**Hypothesis:** one bounded orchestration call could perform both existing
read-only domain operations and return both complete results, eliminating only
the intervening model continuation on the eligible path. This removes **zero
MCP domain operations**. Nine/eleven historical continuations might be avoidable;
token, context and elapsed improvements remain unknown. Aggregate inter-call
gaps of 29.364 s in B and 32.194 s in A are not predicted savings.

The proposed pair would observe once, inspect the complete result, and continue
to one config read only after rejecting Stop/error/terminal/malformed evidence
and validating every visual-reuse predicate: previously delivered verified image,
unchanged lease/page/epoch/session/run ownership, matching PNG and native/Canvas
hashes and tic. A newly distinct image requiring viewing must return control.
Both unabridged results still reach the model; current telemetry must be processed.
Fresh observation IDs and current config/revision/run validation remain mandatory.

The current [skill](../../.agents/skills/doom-decisions/SKILL.md) requires immediate
result inspection. Consolidation would need an explicit, narrow contract amendment;
this record does not permit it. The
[controller](../../app/src/session-controller.ts) remains authoritative for
configuration, observation identity, allowance and admission, while the
[browser bridge](../../app/src/agent-browser.ts) retains synchronous Stop revocation.

**Smallest falsification experiment:** offline replay of the eligible pairs plus
Stop, error, malformed results, invalid/changed hashes or ownership, changed tic,
terminal observation and failed `get-config`. Assert exact operation order,
complete result retention, zero downstream calls after a rejected observation,
and no decision, retry or allowance change. No independent loop or automatic
decision belongs in this pair. Negative-case proof remains outstanding.

Only after offline proof should a separately authorized 3–5-decision live smoke
measure actual continuations and tokens. Reject the candidate if it weakens
inspection, freshness, admission or Stop/terminal priority, or requires a
controller/bridge rewrite or substantial guard machinery. Hidden errors, stale
scope, lost receipts or unknown completion must end conservatively, never cause
a repeated paid attempt.

### 2. Avoid the redundant startup skill reread

**Evidence:** in both transcripts the full skill was injected at line 14, then
reread at lines 17–20 with identical contents: 26,669 bytes in B and 28,421 bytes
in A. The read shared an orchestration call with discovery, so no model
continuation saving was demonstrated. Token savings remain unknown.

**Hypothesis and smallest proof:** confirm whether host requirements permit using
an explicitly complete, untruncated injected skill as the loaded contract. If so,
test complete and missing/truncated injection cases offline: retain tool discovery
and fall back to the file read when necessary. Reject if an independent disk read
is required. The risk is silently omitting current restrictions or trusting partial
instructions. The idea could benefit both CLI and MCP; it changes no authority.

## Safety invariants and things not to optimize

- Keep fresh `observe` operations. A `decide` receipt's after-action observation or
  image is not sufficient authorization for another decision without separate
  proof; receipt reuse is deferred.
- Keep pre-decision config/revision/run checks, human-edit detection, complete CAS
  replacement semantics and post-write fresh observation/validation. Writes
  invalidate old observations and never replenish allowance. Preserve browser
  budget authority and final exhaustion accounting.
- Keep initial and every completed/terminal image inspection, verified hash
  linkage and same-active-run ownership. Identical startup pixels do not justify
  reuse across `start-run`. Preserve full receipts, state telemetry,
  requested/reported/verified tics, uncertainty and resulting-frame evidence.
- Keep observable explanations before every nondefault-duration decision and full
  prompt-change disclosure. The Decisions provider chooses actions; Codex chooses
  only the bounded horizon before seeing that action.
- Keep Stop/error/terminal priority and conservative handling of lost responses,
  failed viewing and unknown completion. No retries, reconnect/rearm, implicit
  allowance renewal or further agent operations after observed Stop/terminal;
  only the prescribed terminal PNG inspection is permitted for a verified terminal.
- Keep MCP's JSON-text fallback. The host archive contains both it and
  `structuredContent`, but logged model-facing orchestration output projected
  only one copy. Removing fallback has no demonstrated model-context benefit.
- Tool discovery occurred once per run. Repeated discovery is hypothetical.

These constraints also follow the [MCP transport contract](../doom-agent-mcp.md),
[shared CLI](../../scripts/doom-agent.mjs) and
[strict observation/receipt DTOs](../../app/src/agent-observation.ts).

## Open questions and recommended next action

The team is considering an **MCP-only Codex gameplay interface**, where
`$doom-decisions play` would use the eight MCP tools while `runAgentCli` remains
an internal dependency. This is a proposed direction, neither implemented nor
formally accepted. The current skill still defaults to CLI with explicit MCP
opt-in. Settle that interface decision before considering the guarded read pair;
this record is not an architectural migration decision.

Outstanding questions are whether a small guard can preserve every inspection
boundary, whether real host execution removes one continuation per eligible pair
without offsetting overhead, and whether host skill-loading requirements permit
candidate 2. Neither future token savings nor latency savings are proven.

Preserve this finding now; implement neither candidate yet. If separately
authorized after the interface decision, investigate candidate 1 with the bounded
offline experiment above, then consider the separately authorized live smoke.
Proceed only with complete evidence and unchanged authority; stop if achieving
the reduction requires weaker safety or broader architecture. No source, skill,
transport or configuration behavior changes are part of this documentation task.
