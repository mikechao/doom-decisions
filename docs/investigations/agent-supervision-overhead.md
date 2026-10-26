# Doom agent supervision overhead

## Decision and scope

Updated 2026-10-26 by independently recounting all five archived sessions.
**KEEP COMBINED:** Run E's combined `doom_observe` replaced routine separate
configuration reads, delivered complete evidence, and supported ten healthy
completed decisions with correct final accounting. Close this supervision-overhead
investigation and return to gameplay under its existing authorization rules.
No further infrastructure or paid repeat is warranted by these observations.

This is a historical, noncontrolled comparison, not a speed/cost benchmark or
negative-path certification. The original 2026-10-24 A/B findings remain verified.
The current implementation is MCP-only play with combined observation, not the
formerly proposed MCP migration or CLI-default skill. The guarded-pair recipe has
been removed from the current skill; `doom_get_config` intentionally remains for
standalone reads and final exhaustion accounting.

The documentation audit ran offline in the project checkout on
`feat/combined-agent-observation`, HEAD
`5170cc6c557df26b688a8ea5265e8d5830de2f2e`, with a clean initial working tree
and no locally configured upstream. No fetch was performed. Only this Markdown
was edited; no gameplay, provider calls, runtime checks, builds or app tests were
performed during this audit.

## Archives, effective contracts and method

Archives were discovered by exact embedded session ID under
`~/.codex/sessions/`. Each file is newline-terminated, entirely parseable JSONL,
with one relevant task, matched outer call/results, individual usage records and
a task-completion record. Task completion does not imply gameplay success.

| Label | Exact session ID | Archive beneath `~/.codex/sessions/` |
| --- | --- | --- |
| B | `01a16f35-4177-7ab0-afea-85aadc6d65db` | `2026/10/24/rollout-2026-10-24T11-38-43-01a16f35-4177-7ab0-afea-85aadc6d65db.jsonl` |
| A | `01a16f56-4fd3-7ac2-a55c-cc45555f56a3` | `2026/10/24/rollout-2026-10-24T12-14-49-01a16f56-4fd3-7ac2-a55c-cc45555f56a3.jsonl` |
| C | `01a1792d-ecd5-7310-a02a-b5368bb98558` | `2026/10/26/rollout-2026-10-26T10-06-55-01a1792d-ecd5-7310-a02a-b5368bb98558.jsonl` |
| D | `01a17947-0059-71a2-ac4b-cde8bf84fe76` | `2026/10/26/rollout-2026-10-26T10-34-18-01a17947-0059-71a2-ac4b-cde8bf84fe76.jsonl` |
| E | `01a1797c-82eb-70a1-b486-9242c7a6b370` | `2026/10/26/rollout-2026-10-26T11-32-45-01a1797c-82eb-70a1-b486-9242c7a6b370.jsonl` |

Evidence references below are **label + 1-based JSONL lines**, not repository
line numbers. In every archive, line 1 records identity/CLI/Git context, line 10
records model/effort, line 12 is the user invocation, and line 14 injects the full
effective skill. The disk skill reread at lines 17–20 matches that injection in
all five runs. Comparing the injected bytes with locally recorded Git objects
shows why HEAD alone cannot identify the effective contract:

| Run | Recorded branch / HEAD | Effective injected skill |
| --- | --- | --- |
| B | `feat/agent-control` / `9747eb677705a744d0549d90eca4dc47daf081f4` | 26,669 bytes; differs from HEAD: optional MCP translation added; user explicitly selected MCP |
| A | `feat/agent-control` / `2acf505aa54d92b59ee4638f69d73b8afae3c4c3` | 28,421 bytes; differs from HEAD: routine post-decision config removal and final-accounting exception |
| C | `main` / `ad41e8fb2f9a639587d66c72188609e728394333` | 32,293 bytes; matches HEAD: MCP-only, first guarded-pair permission |
| D | `main` / `ad41e8fb2f9a639587d66c72188609e728394333` | 34,307 bytes; differs from HEAD: explicit eligible-pair default and viewed-baseline recording |
| E | `feat/combined-agent-observation` / `5170cc6c557df26b688a8ea5265e8d5830de2f2e` | 29,518 bytes; matches HEAD and current disk: combined observation, no guarded-pair exception |

All five record Codex 0.164.0, `gpt-6.1-sol`, high effort. B's archived sandbox
network setting is false; A–E's is true. B/A used a different checkout from C–E;
these are recorded contexts, not independently reconstructed historical working
trees. Every decision receipt requests OpenRouter `typesafe/jev-1.14`; successful
responses report `typesafe/jev-1.14-20261014`. C's failed tenth attempt has no
response model/usage metadata. These are distinct from the supervising Codex model.

Counts include **executed nested Doom MCP invocations**, including D's stored,
evaluated helper, not just literal tool names in outer call text. A successful
pair requires both complete successful results in the same outer invocation.
No model continuation occurred between the two reads in those eleven D pairs.
Outer calls are archived `functions.exec` calls; image/file/discovery work is
included. Recorded model responses count unique `response_id` values in
`token_usage_record`, summing only each individual `usage`, never repeated
cumulative snapshots. No run compacted. This counts recorded responses, not
unobservable service-side retries or provider billing.

Elapsed time consistently uses the timestamp of user invocation at line 12
through `task_complete`: B 380, A 345, C 306, D 302, E 311. Archive lengths are
381/345/306/302/311 lines respectively. First–last individual usage records are
B 18–378, A 19–343, C 18–304, D 18–300, E 18–309. The earlier A figure
186.847 s ended at its assistant message; the consistent endpoint is 186.896 s.

## Five-run comparison

D and E columns provide the exact before/after comparison on the same definitions.
All runs claimed limit 10 once, starting with `reserved/sdkInvoked/remaining =
0/0/10`. All healthy actions were `forward`; no death or exit was reported.

| Measured metric | B: original | A: fewer reads | C: first guard | D: paired reads | E: combined |
| --- | ---: | ---: | ---: | ---: | ---: |
| Frozen SDK-attempt limit | 10 | 10 | 10 | 10 | 10 |
| SDK-invoked attempts | 10 | 10 | 10 | 10 | 10 |
| Healthy completed decisions | 10 | 10 | **9** | 10 | 10 |
| Other outcomes | 0 | 0 | 1 api-failure | 0 | 0 |
| Confirmed action tics / last verified tic | 84 / 85 | 84 / 85 | 54 / 55 | 72 / 73 | 84 / 85 |
| Requested horizon by decision | 6,12,12,12,12,6,6,6,6,6 | 6,18,18,6,6,6,6,6,6,6 | 6 × 10 | 6,12,12,6,6,6,6,6,6,6 | 6,12,12,12,12,6,6,6,6,6 |
| Successful config / prompt writes | 2 / 0 | 2 / 0 | 0 / 0 | 2 / 0 | 2 / 0 |
| Revision progression | 0→1→2 | 0→1→2 | 0 | 0→1→2 | 0→1→2 |
| Final accounting: reserved / SDK / remaining | 10/10/0 | 10/10/0 | not read | 10/10/0 | 10/10/0 |
| `doom_attach` | 1 | 1 | 1 | 1 | 1 |
| `doom_observe` | 11 | 13 | 11 | 13 | 13 |
| `doom_get_config` | 21 | 14 | 11 | 14 | **1** |
| `doom_get_prompt` | 0 | 0 | 1 | 1 | 1 |
| `doom_start_run` | 1 | 1 | 1 | 1 | 1 |
| `doom_set_config` | 2 | 2 | 0 | 2 | 2 |
| `doom_set_prompt` | 0 | 0 | 0 | 0 | 0 |
| `doom_decide` | 10 | 10 | 10 | 10 | 10 |
| **Total MCP domain calls** | **46** | **41** | **35** | **42** | **29** |
| Successful observe/config pairs | 0 | 0 | **0** | **11** | 0 (obsolete) |
| Outer orchestration calls | 61 | 56 | 47 | 46 | 44 |
| Recorded Codex responses | 62 | 57 | 48 | 47 | 45 |
| Codex model / effort | 6.1-sol / high | 6.1-sol / high | 6.1-sol / high | 6.1-sol / high | 6.1-sol / high |
| Decisions requested model (OpenRouter) | typesafe/jev-1.14 | typesafe/jev-1.14 | typesafe/jev-1.14 | typesafe/jev-1.14 | typesafe/jev-1.14 |
| Codex input tokens | 3,098,691 | 2,703,867 | 2,268,452 | 2,421,881 | 2,156,592 |
| Cached input | 2,982,784 | 2,605,440 | 2,219,520 | 2,368,256 | 2,107,136 |
| Uncached input (input minus cached) | 115,907 | 98,427 | 48,932 | 53,625 | 49,456 |
| Codex output | 7,862 | 5,814 | 5,894 | 10,073 | 8,201 |
| Decisions reported input / output tokens | 12,622 / 700 | 12,629 / 700 | 11,333 / 630¹ | 12,609 / 700 | 12,627 / 700 |
| User invocation → task completion | 248.391 s | 186.896 s | 235.666 s | 268.732 s | 258.689 s |
| Delivered startup + post-start + completed PNGs | 12 | 12 | 11 | 12 | 12 |

¹ C's provider usage covers nine successful responses only; failed-attempt usage
and actual charges are unknown. SDK invocation is neither a completion nor proof
of a charge. C has returned counters 9/9/1 immediately before attempt 10, then an
SDK-invoked failure. Admission of that attempt follows from its receipt and the
source's reserve-before-SDK contract; no final counter snapshot was requested.
The other runs explicitly return inactive, exhausted 10/10/0 accounting.

## Reconciliation and historical progression

The eight per-tool rows sum exactly to each domain total. Outer totals reconcile
as domain calls minus successful pairs, plus image calls, two temporary config-file
writes where present, and one discovery/skill-read call:
B `46+12+2+1=61`; A `41+12+2+1=56`; C `35+11+0+1=47`;
D `42−11+12+2+1=46`; E `29+12+2+1=44`.
Each run has one more recorded model response than outer calls.

For reproduction, the ten decision-result lines, in order, are:
B **71,114,143,172,205,246,277,306,337,364**;
A **71,117,141,187,209,233,255,281,303,329**;
C **76,100,126,150,174,200,224,252,276,300**;
D **78,118,138,174,192,210,228,248,266,284**;
E **68,110,131,152,173,213,234,253,274,293**.
They retain requested/reported/verified tics, cumulative tic, uncertainty and
provider identity. Every healthy receipt has matching tics and
`completionUncertain:false`. Every delivered startup/post-start/completed PNG's
archived image bytes hash to its correlated receipt's `pngSha256`; image delivery
is observable, internal visual attention is not independently provable.

Configuration-read classification below is mutually exclusive. A post-CAS read
also validates the next decision, but is counted only as post-CAS. “Pre” includes
reads before an intended decision that instead leads first to a CAS write.
Numbers identify **invocation lines**; paired results appear in the same outer
result, with no intervening model response.

- **B: 21 = 1 startup + 10 pre/CAS + 2 post-CAS + 1 final + 7 other.**
  Startup **37**; pre **63,78,133,162,193,212,265,298,329,356**;
  post-CAS **104,238**; final **371**.
  Other **121,150,179,253,284,313,344** are routine post-decision reads.
  Reads **78,212** also supply pre-write CAS scope, so are not double counted.
- **A: 14 = 1 startup + 10 pre/CAS + 2 post-CAS + 1 final.**
  Startup **37**; pre **63,85,131,155,201,223,247,269,295,317**;
  post-CAS **109,179**; final **336**. Pre-write reads **85,155** accompany
  fresh observations; no unexpected residual read was found.
- **C: 11 = 1 startup + 10 pre-decision.**
  Startup **37**; pre **68,92,118,142,166,192,216,240,268,292**.
  No write, post-CAS or final-exhaustion read occurred.
- **D: 14 = 1 startup + 10 pre/CAS + 2 post-CAS + 1 final.**
  Startup **39**; pre **68,87,127,147,183,201,219,239,257,275**;
  post-CAS **107,163**; final **293**. Pre-write pairs are **87,147**.
- **E: 1 = final exhaustion only, invocation/result E 302/305.**
  Startup, ordinary pre-decision, pre-write and post-CAS separate reads are
  **all zero**; other/unexpected reads are zero. E 293 returns decision 10,
  E 295–298 delivers its PNG, and only then E 302–305 confirms expected
  revision/configuration, same run/limit, reserved 10, SDK 10 and remaining 0.
  No extra observation, decision or accounting call follows.

**B → A removed actual redundant reads:** seven fewer config calls, offset by
two extra observations for fresh pre-write preparation, gives five fewer domain
calls (46→41). Both wrote duration twice. B's writes are **92–95,226–229**;
A's are **99–102,169–172**. Prompt and all five inclusion flags stayed unchanged.
The earlier counts and elapsed figures are confirmed, not copied from the prior
document.

**A → C loaded the first guarded skill but did not pair:** C 14/20 contains
the permission, yet every observe/config read was separate. C 297–300 is
`api-failure`, `sdkInvoked:true`, no action/resulting PNG, null
reported/verified/cumulative tics and no response metadata. Nine healthy decisions
verified 54 tics, ending at tic 55. C 303/306 explicitly ends without retry and
asks the human to use Stop Agent; the archive does not prove that Stop occurred.
No normal exhaustion or tenth completion may be inferred.

**C → D demonstrated pairing uptake, not a domain-call reduction:** D's eleven
executed observe/config pairs are **87–91,107–111,127–131,147–151,163–167,
183–187,201–205,219–223,239–243,257–261,275–279**. Each returns two complete
successful domain results. D 107 stores the guarded helper; subsequent evaluated
calls must also be counted. Pairing eliminates the intermediate model continuation
at each such boundary but retains both MCP operations. C→D's 35→42 domain increase
reconciles as two extra observations, three extra config reads and two writes;
their write trajectories and outcomes differ.

D's first pair **87–91** did not explicitly record the complete viewed-baseline
provenance required by its revised skill. Matching prior image delivery is
reconstructible at **78–83**, with attachment/run scope at **25,52**; that does
not make the explicit record complete. Later baseline/helper storage at **107**
improves the record. Do not describe D as flawless procedural compliance.
D's duration writes **100–103,158–161** preserve counters and move revision
0→1→2; final accounting is **293–296**.

## Run E: every combined observation checked

The thirteen actual observation invocation/result pairs are **E 27/30,53/56,
77/80,98/101,119/122,140/143,161/164,182/185,203/206,222/225,243/246,
262/265,283/286**. Each successful model-facing result is one complete
`structuredContent` object with `isError:false`, retaining:

- Original `observationId,sessionId,tic,phase,frame,counters,telemetry,
  facingProbe,previousAction,pngSha256`, plus verified local `pngPath`.
  IDs are fresh, native/Canvas hashes agree at the observation tic, and telemetry,
  probe and previous action match the preceding resulting frame where applicable.
- Transport correlation `pageId,epoch,commandId`; the same attached page/epoch
  persists. `ownerId` and lease path come from attachment, not newly invented
  observation fields. PNG filenames correlate with command IDs.
- Top-level `revision`, complete seven-field `configuration`
  (`instructionTemplate,tics,includeReadyWeapon,includeAmmo,includeHealth,
  includeFacingProbe,includePreviousAction`), and `run` null or all six fields
  `runId,active,limit,reserved,sdkInvoked,remaining`.

There is no missing field, partial JSON, silent truncation or duplicated text
fallback in any of these thirteen model-facing outputs. Their compact domain
objects occupy 1,785–2,103 UTF-8 bytes. This verifies these actual deliveries,
not maximum-size prompts or universal host output capacity.

Startup **27–35** supplies revision 0, tics 6, `run:null`, and its viewed PNG.
The standalone prompt cross-check **39–42** agrees with the combined configuration.
Start **44–47** uses the startup observation/revision and returns one active run
with 0/0/10 accounting. The mandatory fresh post-start observation **53–56**
has a new ID and that active run; its PNG is delivered again at **58–61** despite
identical pixels. Pre-run viewing is not reused across the claim boundary.

Ordinary pre-decision observations return reserved/SDK counters 0 through 9,
remaining 10 through 1, the same active run and frozen limit. Every SDK-invoked decision
uses its latest observation ID, session, revision and run. Full results return to
a model continuation before a subsequent write or decision; E contains no
observe/config or observe/decision batch.

The two CAS sequences demonstrate actual use of combined data, not merely its
presence. At **77–80** and **182–185**, Codex stores the returned observation,
then **86** and **191** spread its complete `configuration` and change only
`tics`. CAS calls **91–94** and **196–199** use the current scope/revision.
Fresh post-CAS observations **98–101** and **203–206** confirm respectively
revision 1/tics 12/counters 1/1/9 and revision 2/tics 6/counters 5/5/5, with no
budget replenishment. Subsequent decisions **107–110,210–213** use those new
observation IDs/revisions. Instructions and all inclusion flags remain unchanged.
Observable horizon explanations precede nondefault decisions at **106,127,148,169**.

All ten E receipts are healthy completed, SDK-invoked, requested=reported=verified,
with no uncertainty; cumulative tics are **7,19,31,43,55,61,67,73,79,85**.
Their resulting observations correctly retain the base DTO without added
configuration/revision/run. Resulting PNG deliveries are **73,115,136,157,178,
218,239,258,279,298**; together with startup **35** and post-start **61**,
all twelve archived PNG hashes match. Health remains 100 and bullets 50.
Final accounting **302–305** proves exhaustion. No error, human Stop,
cancellation, uncertain completion or terminal path was exercised in E.

## D → E attribution and architectural conclusion

Both runs completed ten decisions, observed thirteen times, wrote configuration
twice (6→12→6, revision 0→1→2), retained the prompt/inclusion flags, viewed twelve
required PNGs and confirmed final exhaustion. The number and kind of writes match;
their placement differs: D restores 6 after decision 3, E after decision 5.

| Operation change | D | E | Observed delta |
| --- | ---: | ---: | ---: |
| Startup config read | 1 | 0 | −1 |
| Pre-decision/pre-write config reads | 10 | 0 | −10 |
| Additional post-CAS config reads | 2 | 0 | −2 |
| Final exhaustion config read | 1 | 1 | 0 |
| All other MCP domain calls | 28 | 28 | 0 |
| **Total MCP domain calls** | **42** | **29** | **−13 (30.95%)** |

The contribution is exactly thirteen eliminated config operations. Eleven were
already inside D's pairs, so they remove domain calls without removing another
model continuation there. Startup and first post-start config were separate:
their removal accounts for the observed **46→44 outer calls and 47→45 recorded
responses**. E no longer constructs or evaluates D's observation guard helper.

Observed D→E usage deltas are input **−265,289**, cached **−261,120**,
uncached **−4,169**, output **−1,872** tokens; elapsed **−10.043 s**.
These are totals for uncontrolled executions, not attributed architectural
savings. D advances 72 action tics, E 84; effective skills, narration, runtime,
cache behavior and context differ. No provider-latency decomposition, general
speedup, dollar saving or advantage over another transport is established.

The source-reviewed contract supports the observed behavior:
[configuration/combined DTOs](../../app/src/agent-control.ts) reuse strict
observation/config validators; [controller observation finalization](../../app/src/session-controller.ts)
restores readiness then synchronously rechecks lease, session, observation/tic and
configuration identity around the authoritative config read before publishing a
detached snapshot. The [broker](../../app/agent-bridge.mjs) checks correlation,
issued run/limit and PNG hash; the [shared transport](../../scripts/doom-agent.mjs)
validates the composite and verifies PNG bytes before writing the local path.
The [MCP adapter](../../app/agent-mcp.mjs) still returns JSON text fallback plus
structured output; the model-facing orchestration selects one copy.
These are source contracts, not additional runtime experiments in this audit.

The [current skill](../../.agents/skills/doom-decisions/SKILL.md) now requires
individual model inspection of each combined result, fresh observations before
decisions and after CAS, and one standalone final accounting read. It contains
no guarded-pair recipe. Keeping `doom_get_config` permits final accounting without
a needless observation and supports independent diagnostic reads; its existence
does not justify routine follow-on reads during play.

Preserve these safety invariants:

- Controller/browser admission, attempt budget and Stop remain authoritative;
  snapshots, local attempt counts and after-action receipts cannot authorize the
  next decision. Keep fresh IDs, current revision/run checks, complete CAS
  replacement, post-write reobservation and human-edit detection.
- Keep mandatory startup, post-start, completed and terminal image delivery,
  native/Canvas/PNG linkage and bounded same-run visual reuse. Preserve full
  telemetry, requested/reported/verified tics, verified prefixes and uncertainty.
- Preserve independent pre-dispatch freshness/Stop fences, SDK-reader cleanup,
  and conservative error/unknown-completion handling. No retries, replay,
  reconnect/rearm, implicit renewal or domain calls after observed Stop/terminal;
  verified terminal allows only its prescribed final PNG inspection.
- The provider chooses the action; Codex selects the horizon beforehand with an
  explanation for every nondefault decision. Keep prompt-change disclosure and
  all credential/provider trust boundaries.

Truncation extremes, human-edit conflicts, Stop/cancellation races, lost responses,
terminal/early-prefix behavior and uncertain outcomes were not exercised by E.
Source review and the separate offline-test descriptions in the
[transport contract](../doom-agent-mcp.md) do not fill those runtime gaps; no tests
were rerun here. C demonstrates conservative handling of one delivered API failure,
not all negative paths. The redundant startup skill reread still occurs in all
five archives, sharing the discovery invocation. No continuation saving was
demonstrated; token effects of changing host skill loading remain unmeasured.

The most useful next action is to **close this investigation and return to
gameplay**, retaining the combined response and existing safety rules. Reopen only
for a concrete defect; do not expand supervision infrastructure or repeat paid
benchmarks on the strength of these uncontrolled timings.
