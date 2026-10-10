# Issue #12: first Decisions API-controlled Doom loop investigation

Investigation date: **2026-10-10**. Status: **architecture investigation only;
Milestone 3 execution remains unproven and unauthorized**. This document preserves
the preceding read-only report; documentation preservation is the only subsequent
change authorized here.

The owner identifies Issue #11 as accepted and closed. Reuse its native-control
baseline: compiled Doom WASM with Freedoom Phase 1 in Chrome, explicit completed
tics, neutral-first input, bounded Worker actions, and passive rendering/idle.
The [Issue #11 results](doom-issue-11-results.md), lines 1–8 and 132–158, record the
successful 15-tic, two-Worker evidence. That document predates the owner's acceptance
and still says acceptance pending. Acceptance does not convert its uncovered
cases, listed at lines 200–208, into demonstrated behavior.

The original investigation made no file changes, builds, installations, Chrome
runs, authenticated API requests, credential access, commits, pushes, or GitHub
mutations. It read source, existing evidence, and public official documentation.
The public Issue #12 URL returned 404; its live body was unavailable, so the
owner's supplied investigation scope governed the report. This preservation task
performs only local read-only inspections and edits this document; it does not
repeat external research or authorize a real API call.

## Verified seams and remaining hypotheses

The Stage A [harness](../experiments/stage-a/harness.html) is inline JavaScript
with file-selected WASM/IWAD assets and a Blob Worker. The Worker owns the WASM
instance and simulation. The existing seams are sufficient for a small controller;
no native ABI or TypeScript physics redesign is indicated.

| Boundary | Current source evidence |
| --- | --- |
| Worker dispatch | Harness lines 283–395 handle load, init, prepare, action, render, and snapshot; lines 350–354 dispatch an action through the native step export. |
| Mask validation and bounded actions | Harness lines 74–76 and 125–145 validate masks and integer durations of 1–20 tics, verify each native completion, and retain completed prefixes on refusal/fault. Expiration adds no release tic. |
| Completed-tic verification | Harness lines 78–110 and 1181–1189 check native command consumption, counters, clock, readiness, and exact action completion. |
| E1M1 and neutral first | Harness lines 1190–1200 check zero-work preparation and genuine READY; lines 1244–1249 explicitly execute one neutral tic after preparation. |
| Framebuffer and Canvas PNG | Harness lines 263–278 copy BGRA from WASM into independent opaque RGBA bytes; lines 363–388 render, hash, and transfer the buffer; lines 1207–1216 paint 640×400 Canvas pixels and capture PNG data URLs. |
| Passive snapshot/render | Harness lines 379–381 only read observations. [Adapter](../references/doom.wasm/src/doom_wasm.c), lines 118–127, checks the completed boundary before and after rendering. |
| Stop and retirement | Harness lines 1120–1128 detach handlers, terminate the Worker, revoke its URL, and reject pending work. Lines 1144–1177 handle unknown completion and the existing two-second Worker watchdog. |

The [native implementation](../references/doom.wasm/doomgeneric/src/g_game.c),
lines 2141–2175, prepares the real level without ticking. Lines 2207–2262 reject
unknown/opposing input and non-neutral input at tic zero before work, assign all
six keys, invoke stock `G_BuildTiccmd` and the native continuation, and commit one
completed tic. The [export contract](../references/doom.wasm/src/doom_wasm.h),
lines 15–19, documents these statuses and host-owned duration bounds.

Reset requires retirement and a fresh Worker, initialization, preparation, and
another neutral first tic; preparation is one-shot. Native eligibility is scoped
to a live E1M1 player, not arbitrary death, map transition, or reload behavior.
Source/fixture coverage is distinguished from Chrome evidence in
[control tests](../tests/test_a21_contracts.py), lines 105–108, 429–471, and 473–517.
Those tests were inspected, not run during either investigation or preservation.

The original investigation independently read the existing build manifest's
`BUILD PASS` status and hashed the existing 360,156-byte WASM as
`cc86ed8884ec04dbace3c541e8528a9f91839b79816cc79ce988af939d42dcb8`, matching
Issue #11 results line 28. No replacement build was made.

**Unresolved:** endpoint CORS, owner account/model access, real latency/refusals,
SDK browser imports and headers, interruption/stop races, and gameplay quality.
Issue #12 has not demonstrated even one genuine API-controlled action.

## Decisions contract observed at investigation time

The [official guide](https://developers.openai.com/api/docs/guides/decisions)
documents `POST https://api.openai.com/v1/decisions`, public beta status, and
`gpt-6-luna` as the only supported model. Its latency description is not a local
measurement. Documented availability does not establish this owner's access.

The [HTTP create reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
and [TypeScript create reference](https://developers.openai.com/api/reference/typescript/resources/decisions/methods/create)
describe required `model`, `input`, and `questions`, plus optional
`safety_identifier`. Input can be text or user messages with `input_text` and
`input_image` parts. At most 128 images are allowed; file IDs, non-user roles,
audio, and tools are unsupported. A choice question has `type: "choice"`,
`instructions`, optional `name`, and 2–255 unique `choices`, each with a string
or boolean `value` and optional `description`. Numeric masks are not choice values.

Responses contain `answers`, `model`, and `usage`; answers follow question order.
Choice answers contain `type: "choice"`, `name`, `choice`, `confidence`, and
`probabilities` entries with `value` and `probability`. Refusals contain
`type: "refusal"` and `name` (null when unnamed), without documented explanatory
text. Question names identify answers; there is no documented gameplay action ID
or duration field. The [versioned SDK types](https://raw.githubusercontent.com/openai/openai-node/v7.32.0/src/resources/decisions.ts)
also expose these shapes.

**Documentation discrepancy:** the API reference accepts public HTTP(S) image
URLs or base64 data URLs, while SDK source comments require inline data URLs.
Canvas `data:image/png;base64,...` fits both and the guide's PNG example. External
image URL support remains a separate verification item. These URLs and contract
observations were checked during the original investigation, not refreshed here.

## Browser-owned architecture and transport choice

```text
Chrome controller: observe PNG → decide → validate → action → render → repeat
       │ Worker messages                              ▲ transferred RGBA
       ▼                                              │
Doom Worker → existing WASM/native builder/world → framebuffer
       single simulation owner

API boundary:
  A. Chrome ───────────────→ OpenAI /v1/decisions
  B. Chrome → local proxy ─→ OpenAI /v1/decisions
```

Waiting for OpenAI must advance zero gameplay tics. The controller serializes
requests; only an explicit accepted Worker action advances simulation. The
existing fixed acceptance script needs a separate small Decisions run path;
its native step, completion checks, capture, and retirement seams remain reusable.

The current harness CSP (line 5) sets `connect-src 'none'` and excludes external
script modules. Both API access and prospective SDK module loading need narrowly
scoped policy changes, separately authorized with implementation.

JSON plus bearer authorization triggers CORS preflight. A real Chrome test must
establish permitted origin/method/request headers and a readable actual POST
response; OPTIONS or terminal success alone is insufficient. Reading
`x-request-id` additionally needs response-header exposure.
[Browser CORS documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)

| Choice | Concrete benefit | Unresolved requirement/cost |
| --- | --- | --- |
| A: direct Chrome | No relay process; browser owns the entire loop | Endpoint CORS and browser-exposed key; SDK headers need their own proof |
| B: tiny local proxy fallback | Keeps the key in a local process; OpenAI request is server-side | One loopback process and narrow route; serve page and route from the same origin |

B forwards the bounded request and returns answers, status, usage, and upstream
request ID. It owns no Doom simulation or gameplay schedule. Loopback binding,
accepted-origin checks, and request bounds protect its credential from arbitrary
websites. It is a fallback, not a replacement gameplay controller.

Direct `fetch()` needs a JSON POST, bearer header, status/body handling, and
cancellation. `no-cors` cannot provide an authenticated readable answer.
[Fetch documentation](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
The SDK's `dangerouslyAllowBrowser: true` only removes its local browser guard;
it proves neither CORS nor key confidentiality. OpenAI recommends keeping keys
out of client code. Visitor BYOK avoids distributing the owner's key but exposes
each visitor's key to executing website code and dependencies; memory-only
storage reduces persistence, not that exposure.
[SDK browser requirements](https://github.com/openai/openai-node#requirements),
[official authentication guidance](https://developers.openai.com/api/reference/overview#authentication)

Future static-hosted, browser-direct BYOK is a **design direction to evaluate**,
not a Milestone 3 acceptance criterion or a solved security problem. Success from
loopback does not establish success from a future hosted origin. No
Decisions-specific ephemeral browser credential was established. The official
Playground can inspect question semantics but cannot prove this page's CORS.

## Smallest proposed action mapping

Use one existing 640×400 Canvas PNG as the sole `input_image` in one user message,
and one named choice question, `next_action`, asking for the next action to
explore E1M1 and survive. Map returned strings through an exact fixed lookup:

| Choice | Native mask |
| --- | ---: |
| `neutral` | 0 |
| `forward` | 1 |
| `turn_right` | 2 |
| `backward` | 4 |
| `turn_left` | 8 |
| `fire` | 16 |
| `use` | 32 |

**Proposal:** six tics per decision (about 171 ms of simulation), following the
mandatory separate one-tic neutral startup. This duration is not an API field or
demonstrated Decisions-controlled behavior. Do not accept model-provided masks,
combinations, or durations.

Require one matching-name `choice` answer and an exact string allowlist member;
do not coerce booleans or parse masks. Recheck unchanged native state with a
passive snapshot after the network wait, then require full native completion
before rendering. Allow one pending API request and one pending Worker operation.

Refusal, malformed output, HTTP/network failure, timeout, or cancellation stops
without dispatching an action. A neutral fallback would itself advance gameplay.
Stop invalidates a small local run-generation token, aborts the request, and
retires the Worker; ignore late responses from older runs. Unknown action
completion must not trigger replay. Preserve verified prefixes and retire.
Idle may retain recorded held keys, but advances no tics; the next accepted
action replaces all six. Request abortion does not establish backend cancellation
or avoided billing.

## SDK versus fetch, and TypeScript

Recommend **minimal fetch for M3-E1**, with the **official SDK preferred for the
integrated loop**, conditional on dependency authorization, import verification,
and the SDK's actual request headers passing CORS. As of 2026-10-10, Decisions
support began in [SDK 7.30.0](https://github.com/openai/openai-node/releases/tag/v7.30.0)
and [7.32.0](https://github.com/openai/openai-node/releases/tag/v7.32.0) was the
current compatible release observed. These are historical observations, not a
claim about the latest version when implementation starts.

The repository has no JS package manifest, JS lockfile, TypeScript configuration,
bundler, or established JS package manager. Its
[Python/Make wrapper](../scripts/build_doom.py), lines 307–320, builds WASM,
not browser packages. [Build documentation](doom-build.md), lines 24–32, records
Node 22.20.0, compatible with the observed SDK's Node 22 minimum; the installed
runtime was not freshly checked. The SDK supports JavaScript and TypeScript
>=4.9; TypeScript is not required to use it.

The [SDK distribution build](https://raw.githubusercontent.com/openai/openai-node/v7.32.0/scripts/build)
and [import postprocessing](https://raw.githubusercontent.com/openai/openai-node/v7.32.0/scripts/utils/postprocess-files.cjs)
support an ESM candidate served locally with a URL import. This is source-based
feasibility, not a verified published-package import. SDK use needs package
acquisition but does not inherently force a bundler or framework dev server.
Bare package imports need browser resolution; external modules need HTTP serving
and suitable CSP. Preserve the current serialized Blob Worker helpers rather than
expanding packaging scope. If B is needed, run `client.decisions.create()` in
the Node proxy and keep browser fetch; no browser SDK opt-in is then necessary.

**Proposed interactive settings:** `maxRetries: 0`, SDK `timeout: 10_000` ms,
one `AbortController` per request, and a ten-second overall deadline through body
reading. Keep the existing two-second Worker watchdog separate. The SDK defaults
to two retries and ten-minute timeouts, including timeout retries; these can
delay the loop or repeat a request already received by the service. Decisions
deduplication/billing guarantees were not established.
[SDK retries/timeouts](https://github.com/openai/openai-node#retries),
[signal/request options](https://raw.githubusercontent.com/openai/openai-node/v7.32.0/src/internal/request-options.ts)

SDK errors distinguish HTTP status failures, connection failures, timeouts, and
caller aborts; refusal is an answer, not an HTTP exception.
[Error definitions](https://raw.githubusercontent.com/openai/openai-node/v7.32.0/src/core/error.ts)
Record request IDs explicitly: `_request_id` is non-enumerable and derives from
the response header; `.withResponse()` also exposes response metadata. Fetch
needs explicit status checking and header extraction. Both requests remain
inspectable in Chrome. SDK types do not validate our native action allowlist:
the [response parser](https://raw.githubusercontent.com/openai/openai-node/v7.32.0/src/internal/parse.ts)
casts parsed JSON. Runtime action validation is mandatory.

**Defer TypeScript adoption for the first two-decision prototype.** Microsoft
released the native TypeScript 7 compiler on July 8, 2026, in the standard
`typescript` package, with CLI emit/watch and language-server support. Version
7.0 lacks a programmatic compiler API, changes defaults, and rejects deprecated
configuration such as older module-resolution modes.
[Official release](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

Plain JavaScript requires no new compiler workflow. A conventional TypeScript
CLI setup adds typed phases/messages and SDK answer narrowing, but also a
dependency, configuration, emit/watch step, and JS outputs. TS7 can provide those
benefits with the same integration costs; headline compiler speedups have little
demonstrated value for this small controller. There is no existing compiler-API
consumer or framework pipeline here, so the missing API is not a present blocker.
SDK packaging and TypeScript adoption are separate decisions; neither compiler
bundles npm imports. Adopt TS7 only when a specific maintained controller/message
surface justifies types and an authorized credential-free compile/import check
succeeds. No migration or compatibility check was performed.

## M3-E1: proposed owner-run transport and contract probe

Before Doom integration, prepare a Doom-free page on a stable loopback HTTP
origin. Draw a solid red Canvas, encode PNG, and use minimal fetch to make
**one** Decisions request with a named choice question and values `red`/`blue`.
Use an owner-provided throwaway key restricted as far as available controls permit
Decisions access. Keep normal Chrome security settings and use no relay.

Evaluate separately:

1. **Transport:** Chrome JavaScript can read the actual API POST response status
   and body. A readable API error still establishes that response path's transport;
   usable endpoint access additionally requires a successful HTTP response.
2. **Request/answer contract:** a successful response contains one correctly named,
   well-formed choice answer whose value belongs to the submitted choices.
3. **Image understanding:** selecting `red` supports understanding this simple
   image. Wrong color alone is not a CORS failure or a transport failure.

Absence of a JavaScript-readable `x-request-id` alone is not a failed request.
Classify CSP, preflight, unreadable POST, authentication/permission, timeout,
refusal, malformed-answer, and wrong-color results separately. A fetch pass
does not prove SDK-header compatibility. The proposed deadline is ten seconds.

Retain sanitized evidence: page origin and Chrome version, request shape/image
hash, preflight if issued, method/header names, CORS response headers, readable
status/body, elapsed time, usage, request ID where available, and one-POST count.
Exclude authorization values and avoid an unredacted HAR.

**Authorization required before execution:** owner approval to prepare/serve
the probe, open Chrome, handle the throwaway key, make the potentially billed API
call, and retain sanitized evidence. The owner should revoke the key afterward.
This document grants none of those permissions; M3-E1 has not run.

## Follow-on slices and limits

After separate authorization:

1. Check the pinned SDK's browser import without credentials where feasible;
   verify its actual headers/CORS before relying on it. If direct transport fails
   because of CORS, seek approval for the tiny same-origin local proxy fallback.
2. Add one narrow controller path reusing load/init/prepare, explicit neutral
   startup, existing completed-tic checks, PNG capture, and Stop/retire.
3. Produce two successive genuine Decisions responses. With the proposed six-tic
   duration: observe at tic 1, decide/validate/act, render at tic 7; send that newly
   rendered frame for decision two, act, render at tic 13, then retire.

Evidence must connect both real responses to input PNG hashes, choices/masks,
request metadata, verified native command/completion records, and resulting
frames. Counters/native state must remain unchanged during network waits;
render/frame counts advance only on explicit renders. A newly rendered frame
need not have different pixels for every legal action. Synthetic responses and
HTTP success alone cannot establish this gameplay milestone.

Open risks include beta contract changes, CORS and header exposure, account/model
access, latency/cost/refusals, SDK packaging, stop/interruption races, native
readiness loss, gameplay quality, and credential trust. Successful shots/doors
and broader death/reload/fault behavior remain outside the accepted evidence's
demonstrated coverage. Hosted deployment/relay, public key management, generalized
retry infrastructure, TypeScript migration, and native physics/ABI redesign are
deliberately out of scope. Stop after preserving this investigation; implementation
and M3-E1 require a new owner instruction.
