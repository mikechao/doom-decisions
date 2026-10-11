# Doom Decisions M4-C implementation investigation

Repository: [mikechao/doom-decisons](https://github.com/mikechao/doom-decisons). Primary milestone: [Issue #13](https://github.com/mikechao/doom-decisons/issues/13), under [roadmap #1](https://github.com/mikechao/doom-decisons/issues/1). Worker cleanup is deferred to [Issue #14](https://github.com/mikechao/doom-decisons/issues/14).

Investigation date: **2026-10-11**. Inspected branch and commit: **main, `dd3e3487e3b61a61810415dd287c6997a4409f6a`**. The working tree was clean before and after the investigation. File/line references below describe that inspected commit and the locally installed SDK available during inspection; they may shift after implementation.

**Evidence provenance: read-only local source, configuration, Git, historical experiment, and installed SDK inspection. No new build, tests/checks, server, browser run, or live API trial was performed for the investigation. M4-C is proposed work, not implemented or runtime-accepted behavior.**

This document preserves the preceding investigation report beginning “M4-C can be implemented as one focused frontend change.” Saving this record is a separately authorized documentation-only change. It authorizes no implementation or execution. Historical owner-run results are distinguished from source findings throughout.

## Executive summary

**M4-C can be implemented as one focused frontend change. No inspected evidence requires changing the Worker, Doom engine, native ABI, or build pipeline.**

Successful preparation already leaves one Worker and its native game state alive. The existing finite-action protocol accepts integer durations 1–20 and returns per-tic native receipts. The main gaps are controller lifecycle, a real SDK request for each admitted human click, cumulative accounting in place of render-time tic-1 assumptions, credential cleanup, and readable decision history.

The smallest useful proof is: prepare genuine E1M1 and verify its mandatory neutral first tic; click `Next Decision` with N1=2; inspect the resulting frame at tic 3; change N to 5 and click again; verify the second observation is the first result and the final checkpoint is tic 8, all on the same Worker. This does not require predictable model actions, continuous gameplay, or a generalized agent framework.

## Owner decisions and open choice

- **Decided:** The human selects integer **Tics per decision, 1–20**, and may change the value between clicks. The model selects only one action, never a duration. One click yields at most one real API request and one bounded native action. There is no autoplay.
- **Decided:** Keep the current Worker intact for M4-C. Its cleanup is tracked by Issue #14.
- **Agreed direction:** Favor a minimal controller and readable user-facing history, with detailed sanitized evidence available separately. Avoid a generalized state-machine or testing framework.
- **Not finalized:** The investigation recommended an initial tic default of **1**. Subsequent architectural discussion, as reported by the owner in the instruction to save this document, suggested **6** based on M3-E3. The owner has not explicitly selected the default. It remains an open product choice; neither value is an approved requirement. Six tics was an experimental constant, not the new duration policy.

## Current behavior and inspected evidence

### Configuration and scope

- [app/package.json:6](../app/package.json#L6) pins Node **22.20.0**, OpenAI SDK **7.32.0**, TypeScript **7.0.2**, Vite **8.3.4**, and Biome **2.5.15**. [app/package-lock.json:10](../app/package-lock.json#L10) contains matching root declarations.
- [app/tsconfig.json:2](../app/tsconfig.json#L2) enables strict TypeScript with DOM libraries, bundler resolution, and no emitted JavaScript. The app uses vanilla DOM APIs and plain CSS.
- [app/biome.json:12](../app/biome.json#L12) explicitly excludes the preserved Worker source.
- The locally installed [SDK package.json:3](../app/node_modules/openai/package.json#L3) reports **7.32.0**. SDK citations in this report refer to inspected, ignored `app/node_modules/openai/` files, not checked-in repository files. They may be unavailable in a fresh checkout; no dependency installation was performed for this investigation.
- Current [AGENTS.md:7](../AGENTS.md#L7) describes the preparation-only baseline and M4-C as next. [AGENTS.md:18](../AGENTS.md#L18) requires separate approval for installs, builds, servers/browsers, authenticated/billable calls, and Git mutations.

### Controller assumptions

| Inspected location | Current behavior | Proposed M4-C treatment |
| --- | --- | --- |
| [main.ts:202](../app/src/main.ts#L202) | Init/prepare require zero gameplay work and exactly one initialization. | Preserve these startup invariants. |
| [main.ts:357](../app/src/main.ts#L357) | Every render requires `gametic === 1`. | Compare against the current independently verified cumulative count. |
| [main.ts:372](../app/src/main.ts#L372) | Frame evidence stores `tic: 1`; the visible frame label also hardcodes tic 1. | Record the actual verified checkpoint. |
| [main.ts:381](../app/src/main.ts#L381) | Preparation is the sole controller event. A valid run prevents another preparation. | Keep preparation once per run; add decision and Stop/Reset events. |
| [main.ts:451](../app/src/main.ts#L451) | The sole action dispatch is neutral, requested/reported/verified as exactly one tic. | Preserve the mandatory first tic; add reusable finite-action verification. |
| [main.ts:471](../app/src/main.ts#L471) | Neutral completion verifies one step, final receipt equality, readiness, and cumulative tic 1. | Keep strict startup checks; general actions require a chained N-step receipt. |
| [main.ts:482](../app/src/main.ts#L482) | Preparation renders, snapshots twice, renders again, and compares the two frame hashes. | Preserve passive-operation isolation. |
| [main.ts:491](../app/src/main.ts#L491) | The five-second startup idle check requires tic 1. | Valid for startup; any reusable idle check must use its captured checkpoint. |
| [main.ts:530](../app/src/main.ts#L530) | Page exit retires the Worker; no API/credential cleanup exists. | Extend cleanup. |
| [main.ts:534](../app/src/main.ts#L534) | SDK availability probe uses a placeholder key and rejecting `fetch`; evidence says requests are disabled. | Keep SDK availability distinct from credentialed request capability; update truthful status/evidence. |

These are source findings. The placeholder probe establishes neither live credential use nor authenticated Decisions access. [app/index.html:7](../app/index.html#L7) also currently blocks direct OpenAI connections with `connect-src 'self'`.

### Persistent native state and existing contracts

The Worker closure owns `instance`, memory, WAD, dimensions, and pending frame state. Preparation creates one classic Blob Worker, and its successful path does not retire it. See [worker-boundary.js:67](../app/src/worker-boundary.js#L67), [main.ts:420](../app/src/main.ts#L420), and [main.ts:513](../app/src/main.ts#L513).

The existing [finite-action implementation:44](../app/src/worker-boundary.js#L44):

- Admits integer durations 1–20 and validates masks.
- Calls the existing native step function once per requested tic.
- Verifies each completed step and returns the completed prefix on refusal/fault.
- Applies no extra release tic on expiration; the next accepted action replaces all keys.
- Reports `FAULT` with `currentTic: 'UNKNOWN'` when completion is uncertain.

The native step verifier already uses the prior cumulative `gametic`, checks one-tic work/clock increments, player-consumed commands, input history, and zero scheduler work. Its neutral requirement applies to the first native tic, not every later action. See [worker-boundary.js:9](../app/src/worker-boundary.js#L9).

The controller can reuse:

- [assertCurrent/retire/passiveCheck:170](../app/src/main.ts#L170) for run validity, retirement, and passive-state comparisons.
- [request:249](../app/src/main.ts#L249) for serialized Worker operations, envelope checking, a two-second watchdog, and retirement on communication uncertainty.
- [snapshot:328](../app/src/main.ts#L328) for read-only native state and complete counter equality.
- [render:338](../app/src/main.ts#L338) for passive render cadence, dimensions, native frame hashing, Canvas painting, and independent Canvas/native RGBA hash equality, after generalizing its tic-1 assumptions.

### Historical runtime evidence, not a fresh trial

[M3-E3 results:3](../experiments/m3-e3/results.md#L3) record owner-supplied Chrome output supporting two real sequential Decisions requests. The initial trial selected neutral twice; a later [revised-instructions trial:147](../experiments/m3-e3/results.md#L147) selected forward twice. Its six-tic actions and checkpoints 1, 7, and 13 are historical evidence, not M4-C product policy. The experiment's evidence limits remain applicable; Codex did not independently operate that browser or audit every runtime artifact.

[M4-B verification:151](doom-m4b-verification.md#L151) records owner-supplied genuine E1M1 preparation, neutral requested/reported/independently verified **1/1/1**, matching native/Canvas frame hashes, unchanged passive state, and approximately five seconds of unchanged idle. [Verification:173](doom-m4b-verification.md#L173) explicitly distinguishes the page's main-thread receipt verifier from an independently operated Codex browser audit.

Those owner-run results support the baseline. They do not establish that M4-C exists or that authenticated calls work from the current built app.

## Minimal proposed controller design

Use a small phase field on the existing `Run`; no state-machine library is needed:

```text
unprepared → preparing → ready/idle
                           ↓ admitted Next Decision click
                       requesting
                           ↓ valid choice + unchanged observation
                    stepping/rendering
                           ↓ verified action + verified frame
                       ready/idle
```

An API failure before native dispatch may return to ready after confirming native state remains unchanged. Native uncertainty moves to a retired/error state requiring fresh preparation. Stop/Reset returns to unprepared.

### State ownership

- **Run:** validity, phase, existing Worker/Blob URL, independently verified cumulative tics, last native observation, current verified frame, active attempt, API abort controller/client, and evidence.
- **Decision attempt:** immutable selected N, observed checkpoint/hash, captured PNG, attempt identity, response metadata, execution receipt, and terminal status.
- **Worker:** existing persistent native state. Credentials never enter Worker messages.

Initialize the verified cumulative count through the mandatory neutral-first receipt. Keep its startup proof exact. General actions then advance from the prior verified count; they never reinitialize native state.

### One admitted click

1. Synchronously require ready state, a usable credential, and integer N within 1–20. Change phase and create the attempt before the first `await`.
2. Capture N into the attempt. Never reread the UI control for this request or native action, even if its value changes while the network call is pending.
3. Snapshot native state and require its tic to match the current verified rendered frame.
4. Capture the Canvas as `data:image/png;base64,…`; independently hash its RGBA pixels and match the current native frame hash.
5. Make exactly one SDK `decisions.create` call for the admitted attempt.
6. Validate the answer and reject stopped, replaced, timed-out, or superseded attempts.
7. Snapshot again. Require complete counter/native equality with the pre-request snapshot and the same rendered-frame identity.
8. Dispatch `{op: 'action', mask: allowlist[action], tics: attempt.N}` once.
9. Independently verify the receipt, render, verify native/Canvas hashes, append the result/history, and return to ready.

This adapts the existing M3-E3 [observation → request → validation → unchanged-wait → action → render sequence:379](../experiments/m3-e3/controller.js#L379). Do not copy its automatic two-iteration loop or its completion-time Worker retirement. The second click captures the frame committed by the first click's successful render; no initial PNG is cached for reuse.

## Concrete edit map

| Likely file | Focused proposed changes |
| --- | --- |
| `app/src/main.ts` | Extend Run/attempt/evidence types; phase/admission handling; SDK request; generalized action verification; cumulative frame checks; Stop/Reset; guarded error/UI completion. |
| `app/index.html` | Temporary password input; `Tics per decision`; exactly labeled `Next Decision`; `Stop / Reset`; appended history below the visible Canvas; updated preparation-only copy and CSP. |
| `app/src/style.css` | Small control/history spacing changes; preserve Canvas dimensions and visibility. |
| `app/README.md` | Click-driven BYOK behavior, cleanup, failure semantics, and acceptance procedure. |
| Optional `app/src/decision.ts` and `scripts/check_decision.mjs` | Only a small extraction of actual DOM-free admission/attempt logic and a proportional offline harness, if justified. No generalized controller or new testing framework. |

No dependency, lockfile, framework, or build-pipeline change is indicated. Optional files above do not exist as an implemented proposal in this investigation.

### Native action receipts

Adapt M3-E3's [action helper:205](../experiments/m3-e3/controller.js#L205) rather than extending neutral-specific assertions inline. It independently re-verifies the returned prefix with `i11VerifyStep`, then checks receipt identity, counts, final observation, status, and cumulative checkpoint.

Extend the controller-local [action result type:92](../app/src/main.ts#L92) for optional `currentTic`, `error`, and refusal details. The adjacent [declaration:93](../app/src/worker-boundary.d.ts#L93) already exposes the verifier; rewriting the runtime Worker is unnecessary.

**Receipt nuance:** an error can include independently verifiable completed tics. `request()` currently calls `healthy(result)` before returning any receipt; see [main.ts:309](../app/src/main.ts#L309). For actions, retain reported counts and independently verify any returned prefix before rejecting a terminal fault, so known completed work is not lost from evidence. Other operations can retain their existing health checks. A verified prefix is a lower bound when the next tic's completion is unknown, not proof that the full action succeeded.

### SDK 7.32.0 request and answer shape

The locally inspected SDK confirms this proposed request structure:

```ts
{
  model: 'gpt-6-luna',
  input: [{
    role: 'user',
    content: [
      { type: 'input_text', text: observationDescription },
      { type: 'input_image', image_url: canvasPngDataUrl }
    ]
  }],
  questions: [{
    type: 'choice',
    name: 'next_action',
    instructions: instructionsUsingCapturedN,
    choices: actionNames.map(value => ({ value }))
  }]
}
```

This is a shape example, not implemented code. `decisions.create` posts to `/decisions`; inline images require base64 data URLs rather than external URLs or file IDs. See locally installed [decisions.ts:14](../app/node_modules/openai/src/resources/decisions.ts#L14), [image type:159](../app/node_modules/openai/src/resources/decisions.ts#L159), and [request types:199](../app/node_modules/openai/src/resources/decisions.ts#L199). The inspected [ESM implementation:20](../app/node_modules/openai/resources/decisions.mjs#L20) agrees. The historical request is at [controller.js:279](../experiments/m3-e3/controller.js#L279).

Replace the experiment's six-tic description with the currently captured N, for example: “The human selected N gameplay tics for this action. Choose only an action; do not choose its duration.” Keep the exploration objective and action-only choice set.

Require exactly one answer with `type === 'choice'`, `name === 'next_action'`, and an exact own-property string from this allowlist:

| Action | Native mask |
| --- | ---: |
| `neutral` | 0 |
| `forward` | 1 |
| `turn_right` | 2 |
| `backward` | 4 |
| `turn_left` | 8 |
| `fire` | 16 |
| `use` | 32 |

Reject refusal, booleans, unknown strings, model-supplied masks/durations, and malformed answer shapes. SDK choice values generally permit booleans, so the app must narrow them; see [decisions.ts:65](../app/node_modules/openai/src/resources/decisions.ts#L65).

The response type contains `answers`, `model`, and `usage`; it declares choice `confidence` and `probabilities`, but no body-level decision ID. Record those metrics only if actually returned and validated. They need not be an action-admission dependency; the historical validator required them, but they do not select duration or authorize a native mask. See [decisions.ts:40](../app/node_modules/openai/src/resources/decisions.ts#L40) and historical [validateChoice:50](../experiments/m3-e3/controller.js#L50). Do not invent model reasoning or missing confidence data.

Use one APIPromise and `.withResponse()` for parsed data, HTTP response, and nullable `request_id` from `x-request-id`. Optional `.asResponse()` on the same promise does not create another request. `_request_id` is also attached to parsed objects; SDK errors expose `requestID`. See local [api-promise.ts:53](../app/node_modules/openai/src/core/api-promise.ts#L53), [client.ts:1435](../app/node_modules/openai/src/client.ts#L1435), [parse.ts:119](../app/node_modules/openai/src/internal/parse.ts#L119), and [error.ts:22](../app/node_modules/openai/src/core/error.ts#L22). Treat unexposed or invalid IDs as unavailable rather than fabricating an identifier.

Use the historical [client settings:353](../experiments/m3-e3/controller.js#L353): explicit `https://api.openai.com/v1` base URL, `dangerouslyAllowBrowser: true`, `maxRetries: 0`, `logLevel: 'off'`, and restrictive fetch options (`mode: 'cors'`, credentials omitted, no-store cache, redirects rejected, no referrer). Pass an abort signal and explicit timeout per call.

Retain M3-E3's [bounded end-to-end deadline:257](../experiments/m3-e3/controller.js#L257), including body reading, with attempt fencing around late continuations. The historical deadline is 10 seconds. Local SDK [request options:38](../app/node_modules/openai/src/internal/request-options.ts#L38) and [implementation:1490](../app/node_modules/openai/src/client.ts#L1490) support abort/timeouts; [client.ts:1522](../app/node_modules/openai/src/client.ts#L1522) shows body-timeout retries stop when the retry budget is zero. Do not rely solely on successful-body timeout handling to bound every error path. Aborting a request does not establish that upstream processing or billing stopped.

### Minimum CSP change

In [app/index.html:7](../app/index.html#L7), change only:

```text
connect-src 'self' https://api.openai.com
```

Keep unrelated restrictions intact. Canvas PNGs transported inside JSON need no image-display permission. Omitting historical observation thumbnails avoids adding `img-src data:`. Do not copy the experiment's inline-style allowance.

### Prototype credentials and history

Use a password input with autocomplete off, spellcheck false, and autocapitalization disabled, following [M3-E3 HTML:30](../experiments/m3-e3/index.html#L30). Consume and clear the field when establishing the run's client; keep the client only in memory across clicks.

On Stop/Reset/page exit: invalidate first, abort, clear the input and pending key, clear the public client key, and drop the entire client reference. Clearing `client.apiKey` alone is insufficient: the inspected constructor retains options containing the key. See local [client.ts:566](../app/node_modules/openai/src/client.ts#L566) and [client.ts:651](../app/node_modules/openai/src/client.ts#L651).

No localStorage/sessionStorage, logging, key echo, Worker transfer, or build-time credential. JavaScript cleanup cannot promise secure memory erasure. The SDK requires explicit browser opt-in; executing page code, SDK code, and DevTools can access the credential. A user must trust a hosted page and its deployed scripts; CSP does not remove that trust requirement. See [client.ts:617](../app/node_modules/openai/src/client.ts#L617).

Keep the Canvas visible, with current status and readable appended decision history. Put detailed sanitized receipts in separate expandable evidence. Per attempt, retain:

```text
run/decision identity; terminal status; action/mask; captured N;
request ID if exposed; API latency;
observed/resulting tic and RGBA hashes;
native requested/reported/independently verified tics;
cumulative verified tics; completion uncertainty;
network-wait unchanged result; fixed failure category.
```

Use null/unavailable for missing evidence. If no native action was dispatched, distinguish selected N from native requested tics. Project API errors into fixed categories and validated HTTP status/request ID. Do not reuse preparation's arbitrary `error.message` display for SDK failures. Never display raw error bodies, headers, arbitrary returned strings, or the key. M3-E3 provides a [sanitization pattern:17](../experiments/m3-e3/controller.js#L17) and [error classification:304](../experiments/m3-e3/controller.js#L304).

### Preserve the Worker and build boundary

Leave `worker-boundary.js`, `worker-source.js`, and their packaging guard unchanged. [worker-source.js:2](../app/src/worker-source.js#L2) narrowly removes the export wrapper; [check_worker.mjs:8](../scripts/check_worker.mjs#L8) requires exact equality with the historical Worker and parses the classic payload without executing it. Continue importing raw source for the Worker and normal module exports for independent verification. Do not copy historical `Function.prototype.toString()` packaging into the Vite app.

## Correctness and failure invariants

1. **One admitted click, one create call, at most one native action.** Lock synchronously; disabling the button supplements the handler guard. No overlapping or automatic calls, retry, fallback action, or implicit next decision.
2. **Frozen N.** Validate with `Number.isInteger`, reject outside 1–20 without clamping, and use the captured value for instructions, dispatch, and evidence. Changes to the control apply only to a later admitted click.
3. **Current observation.** Bind the PNG and RGBA hash to the verified frame and native checkpoint. After the network wait, compare all snapshot counters/native fields before dispatch.
4. **Native accounting.** Require each counted step's status to be zero before calling `i11VerifyStep`; its refusal branch deliberately accepts an unchanged state. Verify N chained steps, requested mask/N, reported N, `APPLIED`, status zero, matching final receipt, readiness, and cumulative `base + N`.
5. **Checkpoint proof.** Establish startup 1, then `1+N1`, then `1+N1+N2`. Do not require particular model choices, visible displacement, or differing frame hashes.
6. **No hidden advancement.** Preserve passive snapshot/render checks, zero scheduler-work invariants, and unchanged network-wait/idle snapshots. Rendering may change its documented bookkeeping, but not gameplay/native time. Never release keys through an extra action.
7. **Stale-response fencing.** Every async continuation checks run validity, captured Worker identity, and active attempt identity. Closing or timing out an attempt invalidates it before controls become ready. Old catches/finalizers cannot update a replacement run.
8. **Stop/Reset.** Invalidate, abort, retire, clear credentials, and return to unprepared. Retain the last Canvas/evidence for inspection. Only a later Prepare creates a new Worker.
9. **Failure before dispatch.** Record “no native action dispatched.” API rejection, refusal, malformed choice, or timeout must dispatch nothing. Another explicit click is permissible only after successful unchanged-state verification on a still-valid run.
10. **Failure after dispatch.** Retain any independently verified prefix, distinguish known partial refusal from unknown completion, and retire conservatively. A timeout or missing receipt does not prove zero tics. Do not claim full success or reuse an uncertain Worker.
11. **Render failure after verified action.** Report “action verified; resulting frame unavailable,” retire, and never replay the action.

## Proposed implementation and verification plan

**All implementation and runtime acceptance below remain unperformed for M4-C.** This is one cohesive proposed slice: controller lifecycle/receipts, click-driven SDK flow, minimal controls/CSP/history, and documentation. No narrower native experiment is currently indicated by a demonstrated blocker.

### Proportional offline verification

After separate implementation/execution authorization, a small Node `assert` harness is worthwhile for concurrency-sensitive logic, without Vitest, Playwright, or another framework. If necessary, extract only actual DOM-free admission/attempt logic into `decision.ts`, import it using the provisioned Node's TypeScript stripping, and use delayed fake API/Worker adapters. Avoid tests that only duplicate the implementation.

Verify that:

- Double admission yields one create/action.
- Changing N during a pending response preserves that attempt's captured N.
- Stop/Reset followed by a late response cannot dispatch or affect a new run.
- Invalid choices and API failures dispatch nothing.
- Exact, mismatched, partial, and missing native receipts produce truthful counts/status.

Exercise the preserved verifier with synthetic receipt chains separately. These checks establish controller behavior and receipt handling, not native runtime correctness or real API access. Keep any extraction small enough to serve the product logic directly.

### Existing checks and build, after separate approval

Run the repository's existing non-writing `npm --prefix app run check`, covering TypeScript, Worker integrity, and Biome. See [package.json:14](../app/package.json#L14). With separate build approval, use `./build.sh --frontend-only` only if staging accepts the current verified engine artifact. Missing evidence, changed engine inputs, or mismatched bytes require stopping for the necessary full-build authorization. Do not bypass provenance checks or treat an old `dist` as new build evidence. See [build.sh:11](../build.sh#L11) and [README:54](../app/README.md#L54).

No dependency installation, app checks, build, server, browser, or API trial is part of saving this report.

### Owner-run Chrome and real Decisions acceptance — not yet performed

After separate authorization, follow the [isolated dist delivery procedure:70](../app/README.md#L70), with the owner entering a temporary key directly into the page.

| Step | Required acceptance evidence |
| --- | --- |
| Prepare genuine E1M1 | Neutral requested/reported/verified **1/1/1**, verified frame at tic **1**, startup idle unchanged. |
| Set N1=2; click `Next Decision` once | One actual Decisions request; **2/2/2** native receipt; cumulative/resulting tic **3**. |
| Inspect result and wait without clicking | Canvas stays visible; no extra request or native advancement. |
| Change N to N2=5; click once | Second request's actual captured image/hash/checkpoint matches decision 1's rendered result at tic **3**. |
| Inspect second result | **5/5/5** native receipt; final cumulative/resulting tic **8**. |
| Check persistence and isolation | Same Worker/run across both clicks, initialization counters remain one, no replacement Worker; unchanged native state across both network waits and a final bounded idle check. |
| Stop/Reset | Credential UI clears; no further accepted work; fresh preparation required for another game. |

The acceptance checkpoints are **1 → 3 → 8**, from **N1=2** and **N2=5**, with **two separate human clicks, two actual Decisions requests, and one live Worker**. Count two Decisions POSTs separately from any OPTIONS preflights. Model choices need not differ or cause visibly obvious movement.

Collect sanitized receipt projections, build identity, Chrome version, safe page screenshots, and owner Console/Network observations. Inspect image payloads locally without exporting authorization headers, raw HARs, or keys. Label owner observations separately from source checks and independent main-thread receipt verification. Do not call an owner-run trial a Codex-operated browser test.

### Explicit stop conditions

Stop on staging/provenance failure; SDK/CSP/CORS/access blocker; stale-frame mismatch; overlapping admission; native count/command mismatch; partial or unknown completion; or failed resulting-frame verification. Preserve evidence and retire uncertain native state. Do not silently widen the milestone, substitute artifacts, replay actions, or change the engine/Worker to address an unproven problem.

## Risks, blockers, evidence gaps, and deferred work

- The live issue bodies, roadmap, and [Decisions documentation](https://developers.openai.com/api/docs/guides/decisions) were not fetched under the local-only investigation boundary. SDK schema claims above come from inspected local files. [M4-A investigation:93](doom-m4a-investigation.md#L93) agrees with the requested M4-C scope.
- Current account/model access, browser CORS and request-ID header exposure, and authenticated behavior of the built bundle remain unverified. Reuse historical `gpt-6-luna` for the smallest trial, subject to verifying availability during the separately authorized owner run.
- Hosted-origin BYOK trust remains a real prototype limitation. No public hosted BYOK acceptance or security architecture follows from historical local Chrome success.
- Full 1–20 runtime behavior and cancellation/fault behavior still need targeted verification. No local source blocker demonstrates a need to change the engine, native ABI, or Worker first.
- The initial tic default is the only identified unresolved product choice; it does not alter the required 1–20 admission and frozen-N behavior.
- Treat Stop/Reset as retiring the game. Pause/resume adds lifecycle complexity without helping the two-click proof.

**Must-have M4-C:** persistent successful-run Worker; explicit `Next Decision` clicks; frozen human-selected N; current image observations; strict action mapping; cumulative native verification; readable sanitized history and detailed evidence; credential cleanup; and failure fencing.

**Deferred/non-goals:** Worker migration in [Issue #14](https://github.com/mikechao/doom-decisons/issues/14); React, Tailwind, a new framework or generalized state-machine/testing framework; autoplay or continuous gameplay; a backend; native protocol overhaul; generalized agents; automatic retries/recovery; save/resume; broader gameplay strategy; public hosting/security architecture; and licensing/deployment review. Preserve existing notices and local-only IWAD handling; this milestone does not approve distribution.

## Recommendation

Implement the persistent controller and generalized action/frame accounting first, then connect the existing M3-E3 request pattern to one guarded `Next Decision` click. Accept M4-C only after two real, separately authorized owner-run requests prove checkpoints **1 → 3 → 8** on one Worker. Resolve the initial tic default explicitly without treating either the investigation's recommendation of 1 or the later suggestion of 6 as an approved requirement.
