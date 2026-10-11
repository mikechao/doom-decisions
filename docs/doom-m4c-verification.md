# M4-C owner-run browser verification

Date: **2026-10-11**. Milestone: **4-C**, [Issue #13](https://github.com/mikechao/doom-decisons/issues/13).

The **core interactive M4-C product loop is demonstrated in an owner-run Chrome
trial**: automatic preparation with one mandatory neutral tic, repeated human
`Next Decision` clicks using real Decisions API responses, bounded native actions,
and a duration change while gameplay continued. The owner reported **14 successful
decisions**; **five individual receipt summaries** were supplied. The other nine
were not supplied individually.

## Scope and evidence classification

The known test environment is Chrome running the static browser app with a locally
selected IWAD. The current app requires Freedoom 0.13.0 Phase 1, but the trial's
exact asset/build identity, serving location, host details, and Chrome version
were not pasted. Current source configuration does not establish those run facts.

This note separates four evidence classes:

- **Owner report:** browser behavior and prior command/review outcomes relayed by
  the owner, without Codex operating or independently observing Chrome.
- **Receipt summaries:** the five pasted decision records reproduced below.
  “Independently verified” means the browser controller's per-tic checking of
  Worker/native receipts, not a separate independent Codex Chrome run. Full native
  step records were not pasted for this trial.
- **Static/source findings:** read-only inspection of the current implementation,
  documentation, and offline harness; these explain behavior without establishing
  browser execution. The separate review's approval is a reported result.
- **Not exercised/not collected:** gaps explicitly identified below; no runtime
  success is inferred for them.

At documentation time, the worktree already contained modified `app/README.md`,
`app/index.html`, `app/src/main.ts`, and `app/src/style.css`, plus untracked
`app/src/decision.ts` and `app/tests/`. This record describes that local M4-C
implementation without assuming it is committed or identifying it with the exact
served build. Only this document was created for this task. No installs, checks or
tests of the app, builds, servers, browsers, or API requests were run for this note;
no staging, commits, pushes, or issue changes were made.

The earlier M4-C investigation was a proposal, not
the implemented acceptance record. The [M4-B verification](doom-m4b-verification.md)
provides the evidence conventions and earlier baseline results; its hashes,
browser version, and network/idle evidence are not evidence for this M4-C trial.

## Reported build and review prerequisites

| Prerequisite | Available evidence |
| --- | --- |
| `npm --prefix app run check` | Owner reported passing. Not rerun or independently witnessed for this note. |
| `node --experimental-strip-types app/tests/decision.mjs` | Owner reported passing the offline harness. Not rerun for this note. |
| `./build.sh --frontend-only` | Owner reported passing. Exact final build artifact identity was not pasted or independently established here. |
| Separate read-only Codex `/review` | Reported **APPROVED**, with no actionable correctness defects across six changed/new files. This is code-review evidence, not browser coverage. |

The [offline harness](../app/tests/decision.mjs) inspects admission, frozen duration,
stale identity fences, choice validation, and synthetic receipt accounting. It
does not execute the DOM flow, real SDK requests, Workers, or native WASM. See
[app setup and smoke instructions](../app/README.md) for the intended execution
procedure and build boundaries.

## Browser flow and source findings

The owner reported that selecting the IWAD automatically prepared Doom, with no
`Prepare Doom` button. Initialization accounts for **one explicit mandatory
neutral tic**. Decision 1's observed checkpoint of tic 1 is consistent with that
report; a complete M4-C preparation receipt was not pasted.

The owner then repeatedly clicked `Next Decision`, using real Decisions API
responses, without reporting a restart. Decision 14 changed the human-selected
duration from **6 to 2** while the game continued. All five supplied records chose
`forward`; the other nine actions are not individually documented here.

Read-only inspection of [the controller](../app/src/main.ts),
[decision contracts](../app/src/decision.ts), and [controls](../app/index.html)
finds the following implemented behavior:

- IWAD selection starts preparation. Successful preparation retains its Worker
  and native state; the decision handler does not create another Worker.
- Each admitted click captures an integer N in **1–20** before asynchronous work.
  The initial control value is **6**. One SDK `decisions.create` invocation uses
  the captured Canvas PNG and N; retries are disabled. Completion returns to ready
  for another human click, with no automatic decision loop.
- The model selects only one allowlisted action. The mapping is `neutral=0`,
  `forward=1`, `turn_right=2`, `backward=4`, `turn_left=8`, `fire=16`, `use=32`.
  The human controls duration; combined or unknown choices are rejected.
- The controller checks the observation against the current verified checkpoint
  and Canvas/native RGBA hash, compares native snapshots across the API wait,
  verifies each returned tic, and renders at the new cumulative checkpoint.
- History displays selected N, action, requested/reported/verified counts,
  observed/resulting/cumulative tics, sanitized request ID, and API latency.

These are source findings. The configured model name is not proof of returned
model metadata; none was supplied. Source checks of hashes, Worker identity, or
unchanged snapshots do not supply the missing runtime artifacts.

After decision 14, the owner left the page open for several seconds and reported
**nothing happened**. This supports **no visible idle gameplay**. It does not by
itself prove an unchanged instrumented native checkpoint or absence of additional
network requests.

## Supplied receipt evidence

Exactly these five summaries were pasted. All five actions were **`forward`**.
Latency values are the supplied app-reported API latency, not independently timed
measurements. “Verified” below means controller per-tic receipt verification.

| Decision | Human N | Native requested / reported / verified | Observed tic | Resulting / cumulative tic | API latency | API request ID |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| 1 | 6 | 6 / 6 / 6 | 1 | 7 | 1110 ms | `req_a4920078687944298a1dc24d845bc988` |
| 2 | 6 | 6 / 6 / 6 | 7 | 13 | 266 ms | `req_b473a090305443f884c182ac8786cc52` |
| 3 | 6 | 6 / 6 / 6 | 13 | 19 | 202 ms | `req_800fd7b05db545a085503c11a198d51a` |
| 13 | 6 | 6 / 6 / 6 | 73 | 79 | 282 ms | `req_859a98648357491ead9d96de0f5d2309` |
| 14 | 2 | 2 / 2 / 2 | 79 | 81 | 322 ms | `req_a6cb779114064d09ac98bbee422e7162` |

The first three records show **1 → 7 → 13 → 19**, adding six tics per action.
The last pair shows **73 → 79 → 81**, adding six and then two. In each supplied
consecutive pair, the next observed tic equals the prior resulting tic. This
supports checkpoint continuity and successful bounded stepping.

Decisions **4–12** are the nine individually missing records. The owner report
adds that all 14 decisions succeeded in the run. The gap from tic 19 to tic 73 is
arithmetically compatible with nine six-tic actions, but does not establish their
individual durations, actions, receipts, latencies, or request IDs. The five
summaries alone do not prove every intermediate transition or explicit Worker
identity across the full run.

The investigation and README proposed **1 → 3 → 8**, with N=2 followed by N=5.
That exact browser sequence **was not executed** and is not recorded as passing.
The actual trial provides a stronger repeated-use duration-change demonstration:
decision 13 used **N=6 at 73 → 79**, immediately followed by decision 14 using
**N=2 at 79 → 81**, after many earlier owner-reported successful clicks. The
offline harness's synthetic 1 → 3 → 8 case is separate from Chrome evidence.

## Acceptance assessment for the reduced M4-C scope

| Requirement | Evidence and assessment |
| --- | --- |
| Automatic preparation, one mandatory neutral first tic | **Supported by owner report** and decision 1 observing tic 1. Exact neutral 1/1/1 enforcement is **code-reviewed only** for this trial; full preparation receipts were not collected in the pasted material. |
| Repeated human-triggered real Decisions responses and successful native actions | **Supported by owner report** of 14 successes and **supported by receipt summaries** for decisions 1, 2, 3, 13, 14. |
| Human-chosen N and change between decisions | **Supported by receipt summaries**: N=6 then N=2 with continuous 73 → 79 → 81 checkpoints. Full 1–20 browser coverage is **not exercised/not collected**. |
| Frozen N during an in-flight request; overlap prevention | **Code-reviewed only**, with reported offline harness coverage. No owner-run pending-control-change or rapid-double-click browser trial was supplied. |
| Strict supported action mapping | `forward` execution is **supported by receipt summaries**. Validation and the other six mappings are **code-reviewed only**, with reported offline harness coverage; the other actions lack supplied browser receipts. |
| Cumulative receipt accounting | **Supported by receipt summaries** for the five listed decisions. Raw per-tic native chains were not supplied for independent rechecking here. |
| Persistent Worker/native game across successful decisions | **Supported by owner report**, consecutive receipt checkpoints, and source retention of the Worker. Explicit Worker-instance and repeated initialization-counter proof is **not collected**. |
| Current rendered image used for the next decision | Tic continuity is **supported by receipt summaries**. PNG capture, hash matching, and unchanged network-wait snapshots are **code-reviewed only** here; exact frame-hash/payload proof was not collected. |
| No automatic loop or visible idle play | **Supported by owner report** of quiet idle after decision 14 and source click-only flow. Instrumented final idle equality and exact POST/preflight counts are **not collected**. |
| Readable sanitized history/evidence | The five supplied summaries support the displayed decision fields. Full DOM presentation and advanced evidence coverage remain **code-reviewed only**. |
| Credential lifecycle, failure recovery, cancellation/stale-response fences, native refusal/uncertainty handling | **Code-reviewed only**, with reported offline coverage of selected contracts. Owner-run browser coverage is **not exercised/not collected**. |

The reduced implemented flow uses refresh to start over; there are no Prepare,
Stop, Reset, or New Game buttons. The investigation's proposed Stop/Reset flow is
not an implemented acceptance item or an exercised browser result.

## Limitations and follow-up

No detailed frame hashes, explicit Worker instance ID, Chrome version, full
network request count with POST/OPTIONS distinction, or exact final build artifact
identity were pasted. No M4-C Console/Network inspection result was supplied.
Consecutive checkpoints and source retention support continuity, but cannot fill
those evidence gaps. The final several-second idle observation is visual only;
the current source's instrumented startup idle check does not prove an
instrumented post-decision-14 idle result.

Failure paths, API cancellation and stale responses, credential clearing or
replacement, and unusual native refusals lack owner-run browser coverage. Source
inspection, the reported offline harness, and reported review approval are not
full Chrome coverage. Returned model metadata, usage, and private response content
were not supplied and are not inferred. This note records only the provided safe
request IDs and receipt projections; it contains no credential, authorization
header, complete HAR, or private response data.

If fuller acceptance evidence is required, a separately authorized follow-up can
collect sanitized build identity, Worker/frame continuity, final native idle
snapshots, and Network observations, then exercise targeted failure/lifecycle
cases. No such execution is authorized or performed by this documentation task.
Worker source migration remains deferred to
[Issue #14](https://github.com/mikechao/doom-decisons/issues/14).

## Outcome

The core interactive M4-C product loop is demonstrated in the **owner-run Chrome
trial**, including repeated real Decisions responses, successful controller-verified
bounded native stepping, and the N=6 → N=2 duration change without a reported
restart. This establishes the exercised product behavior with the evidence limits
above. Milestone acceptance remains with the owner; this record neither closes
Issue #13 nor establishes uncollected runtime proof. Any remaining acceptance
decision is whether the documented core-loop demonstration is sufficient or the
specific missing continuity/idle/network evidence is required first.

## Later status — 2026-10-11

The owner accepted the reduced v0.1.0 MVP scope described above. Worker migration,
reported as deferred in the original record, was subsequently completed in
commit `a268837ef89b114966623f58d47bae51e55c0564` (#14): the app now packages
`app/src/worker.ts` as a Vite ES module Worker with shared receipt code in
`app/src/worker-shared.ts`. Retired experiments and superseded plans are in Git
history. This status annotation adds no Chrome/API evidence and does not fill
the trial's uncollected proofs. See the [app guide](../app/README.md) for current
setup and controls.
