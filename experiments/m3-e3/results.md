# M3-E3 results: first visible two-decision Doom loop

**Core observe → decide → act → render loop: PASS, based on owner-supplied
Chrome page output.** The owner chose to perform the serving, Chrome and API
trial personally, then supplied the completed page log and reported seeing
two `decisions` entries in Network. Codex did not launch the server/browser,
handle the key, execute requests or observe the browser directly.

## Reported successful path

The page reports two successful HTTP 200 responses with distinct exposed request
IDs and complete SDK-parsed bodies. Each selects `neutral` (mask 0), completes
six requested/reported/independently verified native tics, and renders a result.
Both waits report unchanged native state. Decision 2 observes exactly the frame
rendered after decision 1. Both choices being neutral satisfies this experiment;
different actions or visible movement are not required.

| Field | Decision 1 | Decision 2 |
| --- | --- | --- |
| Observed rendered tic | 1 | 7 |
| Selected action / mask | `neutral` / 0 | `neutral` / 0 |
| HTTP status / complete parsed body | 200 / yes | 200 / yes |
| SDK request ID | `req_98281328ff724cae999b3611139fb612` | `req_98fae9fb29c042a0b296a0e357ee3932` |
| Page-reported latency | 1060 ms | 329 ms |
| Native requested / reported / verified tics | 6 / 6 / 6 | 6 / 6 / 6 |
| Wait state unchanged | true | true |
| Resulting rendered / cumulative tic | 7 | 13 |
| Error/refusal | none | none |

RGBA frame hashes copied exactly from the supplied log:

| Tic | SHA-256 | Relationship |
| --- | --- | --- |
| 1 | `ea416a166f395e8ed6fb60d3b417a1cacedd9b764f58282892d4e9caae8e5800` | Decision 1 observation; matches the prior Issue #11 neutral baseline. |
| 7 | `e77da6fd4b8909d43715966a74d5f313c6eed9569331d9c8147d5acc86f9e6d2` | Decision 1 result and decision 2 observation. |
| 13 | `e5530ced0fb10cb63f997c18cde9ba3f692c4a8e881f3d1052486c743604748c` | Decision 2 result and final visible Canvas label. |

The supplied final status is:

```text
Completed — 2/2 Decisions, 13 verified native tics.
2/2 completed; 13 verified native tics; 2 SDK create calls.
```

These are page-reported verification results. The inspected controller reaches
completion only after exact answer validation, passive state comparisons, all
per-tic native consumption checks, and rendering. It also matches captured
Canvas pixel hashes to the native frame before each request. The owner did not
supply the expanded response JSON, per-tic native records or actual PNG bytes;
Codex has not independently audited those runtime artifacts. Raw confidence/
probability values are unavailable, although successful validation checks them.

## Local source identity and verification

Read-only receipt preparation found HEAD
`fcc0813bc81ffa02334175b535d4db59c601dc76`, with M3-E3 still untracked. HEAD alone
does not identify this experiment. Local hashes:

```text
22054153162dfbce091f6edb5e23fd91768804033113cabf1c597e0bfe9f07e0  index.html
a3ffda0d718502ed7c8fe2b798e25b5c130278db027d534aadb7b1be25c19c61  controller.js
381acb97014f70357422b74415358bfb92c5100764e1cfe18424ca18723f2943  worker-boundary.js
1ecb19f0579cf44217e02f1d53268bdc2b2d3ee62000234c35eddfed295e4c5e  ../m3-e2/package-lock.json
```

These identify inspected local files, not independently verified runtime file
hashes. The [README](README.md) records the pinned SDK 7.32.0, existing WASM/IWAD
identities, request mechanics and manual procedure. Earlier static checks passed
JavaScript and serialized Worker syntax, 221 reachable SDK modules/837 static
import edges, local references, copied Worker equality and whitespace. Native
code, WASM, SDK and existing acceptance assets were unchanged.

## Evidence limits

- Exact trial timestamp, full Chrome version and visited URL were not supplied.
  The instructed URL was `http://127.0.0.1:8765/m3-e3/`; prior E2 browser details
  are not substituted for this trial.
- The owner reported two Network entries. Their individual methods/statuses,
  OPTIONS behavior and header details were not supplied. Two real successful
  responses are supported by the page's two HTTP 200 results and distinct IDs;
  the exact Network POST count was not independently inspected.
- Responsiveness, final Worker retirement, no extra later traffic, key revocation
  and browser-security settings were not separately reported. Cleanup/no further
  requests are source properties; they are not additional measured observations.
- This successful trial does not test Stop during API/native work, the deadline,
  refusal/malformed answers, stale replies, partial faults or repeated fresh runs.
  It establishes neither gameplay strategy nor public hosted BYOK support.

Only sanitized supplied text is recorded. No keys, sensitive headers, raw HARs
or screenshots are saved. This receipt authorizes no further API calls, commits,
pushes or GitHub changes.

## Follow-up evidence: instruction-change trials

The first neutral-only trial above is preserved verbatim as historical evidence.
The following are distinct owner-reported trials, documented from supplied text;
Codex did not run Chrome, serve the page or call the API for this follow-up.

### Git-verified instruction change

Read-only local Git inspection found HEAD at
`4e7a3d4ccccda617d8573d079ebdbe75c45d316b` ("Change the instructions to the model"),
whose parent is the previously reviewed M3-E3 baseline
`29078483afca2d8dd7b2aaf9fa6b6509475ddb43` ("m3-e3 results"). The exact commit
diff changes only `questions[0].instructions` in [controller.js](controller.js).
This results file is tracked and unchanged between those commits; the earlier
untracked-state description and local hashes above apply to the historical
inspection, not this follow-up's committed baseline or runtime identity.

Old instructions, quoted from the baseline:

> Choose the next action to explore E1M1 and survive based on the visible frame. The action will persist for exactly six native gameplay tics (about 171 ms), then a new frame is observed. neutral releases all six keys. Do not assume unseen game state.

The revised instructions make exploration and progress toward the exit while
surviving the primary objective, ask for useful progress from the screenshot,
prefer forward movement or turning to explore over standing still, and reserve
`neutral` for waiting with a specific tactical benefit. They retain six gameplay
tics per action, a subsequent screenshot, and the warning not to assume unseen
game state.

Git confirms all seven choices and native masks are unchanged: `neutral` 0,
`forward` 1, `turn_right` 2, `backward` 4, `turn_left` 8, `fire` 16 and `use` 32.
The execution duration remains fixed at six tics. The request model remains
`gpt-6-luna`, and the screenshot input and input mapping are unchanged. These are
source facts; local Git inspection does not independently identify runtime bytes.

### Second neutral-only trial (original instructions; owner-reported)

The owner separately reported another two-decision run under the old
instructions. Both selections were `neutral`. This is a second trial, distinct
from the first trial above; its reported RGBA hashes at tics 1, 7 and 13 match
the first trial's three hashes exactly.

| Field | Decision 1 | Decision 2 |
| --- | --- | --- |
| Selected action | `neutral` | `neutral` |
| SDK request ID | `req_0d1a9430842b4e9aacc3b117e0ad2830` | `req_812d3f560ab44cd2ae034325844c0f44` |
| Page-reported latency | 664 ms | 262 ms |
| Reported confidence | 0.35 | 0.39 |
| Reported probability of `neutral` | 0.44 | 0.48 |
| Reported probability of `forward` | 0.31 | 0.31 |

Only these selected probabilities were supplied for the second neutral trial;
they are not a full distribution. The first trial's full response distributions
were not supplied either.

### Revised-instructions forward trial (owner-reported Chrome page outputs)

The owner supplied the page log and sanitized response JSON and reported two
real Decisions API calls. Both returned `forward` (native mask 1). The page
reports each action successfully executed as six independently verified native
Doom tics and E1M1 rendered at tic 13. "Independently verified" here describes
the page's native verification pathway, not an independent Codex runtime audit.

| Field | Decision 1 | Decision 2 |
| --- | --- | --- |
| Observed rendered tic | 1 | 7 |
| Selected action / native mask | `forward` / 1 | `forward` / 1 |
| Fixed action duration | 6 tics | 6 tics |
| HTTP status / complete parsed body | 200 / yes | 200 / yes |
| Error/refusal | none | none |
| SDK request ID | `req_11e5d236a49247b1b527d438c5a7ee9c` | `req_18d1b0501fa64b5399c8acb295ff8fe1` |
| Page-reported latency | 506 ms | 271 ms |
| Native requested / reported completed / independently verified tics | 6 / 6 / 6 | 6 / 6 / 6 |
| Cumulative verified tics | 7 | 13 |
| Wait state unchanged | true | true |
| Resulting rendered tic | 7 | 13 |
| Response model | `gpt-6-luna` | `gpt-6-luna` |
| Answer type / name | `choice` / `next_action` | `choice` / `next_action` |
| Confidence | 0.92 | 0.87 |
| Usage: input / output / total tokens | 498 / 0 / 498 | 498 / 0 / 498 |

Full choice probabilities reported in the revised trial's sanitized responses:

| Action | Decision 1 | Decision 2 |
| --- | ---: | ---: |
| `neutral` | 0.02 | 0.04 |
| `forward` | 0.93 | 0.89 |
| `turn_right` | 0.01 | 0.02 |
| `backward` | 0.01 | 0.01 |
| `turn_left` | 0.01 | 0.02 |
| `fire` | 0.01 | 0.01 |
| `use` | 0.01 | 0.01 |

Revised trial RGBA frame checkpoints, copied from the owner-supplied output:

| Tic | SHA-256 | Relationship |
| --- | --- | --- |
| 1 | `ea416a166f395e8ed6fb60d3b417a1cacedd9b764f58282892d4e9caae8e5800` | Decision 1 observation; matches both neutral trials' initial hash. |
| 7 | `989a941fff8967eddb827d87208d3a52afbc509d45a1d6fec151c79981b1e6de` | Decision 1 result and decision 2 observation. |
| 13 | `148336941d5cc1c088eeb7f36f8ca8087b306bd998ab14a952348bafdccc0890` | Decision 2 result; page reports E1M1 rendered at tic 13. |

### Comparison and follow-up evidence limits

Under the original instructions, two separately recorded neutral-only trials
returned four `neutral` selections in total. The revised trial returned two
`forward` selections. Compared with the second neutral trial, the reported
`forward` probabilities changed from 0.31/0.31 to 0.93/0.89, and `neutral` from
0.44/0.48 to 0.02/0.04. This is strong single-run, instruction-sensitive
behavioral evidence. It does not establish statistical significance, a general
win-rate improvement, or instruction text as the only possible factor in
nondeterministic outputs. Decision 2 also observes a different frame after the
first action, so its comparison is not a matched-image instruction-only test.

The page reports native action-consumption verification for two nonzero masks
and 12 gameplay tics beyond the first neutral tic. Changing RGBA hashes is
consistent with movement but does not on its own prove player displacement.
Explicit player-position/angle deltas and direct visual confirmation of
displacement were not supplied.

For the revised trial, expanded per-tic native records, raw PNGs, full Chrome
metadata and a screenshot showing displacement were not supplied and remain
unverified. Exact trial timestamp, Chrome version, visited URL/origin, final
status text, total SDK create-call count and runtime file hashes were not
supplied. Request IDs are diagnostic identifiers, not evidence of an
independently inspected Network panel. The supplied page log and sanitized JSON
support the reported results; Codex has not independently audited their runtime
artifacts or observed gameplay.

This follow-up does not independently establish Stop/fault behavior,
hosted-origin support or indefinite gameplay. It records evidence only and does
not authorize another trial or constitute Issue #12 acceptance or closure. Only
sanitized supplied text is included; no keys, auth headers, cookies, HARs or raw
credential-bearing captures are recorded.
