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
