# M3-E1 results: browser-direct Decisions trial

**Verdict: M3-E1 PASS for `http://127.0.0.1:8765`, using minimal browser
`fetch()`.** This receipt records an authorized owner-run trial on October 10,
2026; Codex did not execute the browser/API run. It establishes the tested
loopback request path, not all origins or OpenAI JS SDK compatibility.

## Purpose and procedure

The owner reports one manual Decisions POST under normal Chrome security,
without Doom, a proxy, or the SDK. The inspected [page](index.html) draws a
64×64 solid red Canvas and uses `canvas.toDataURL("image/png")` for one user
`input_image`. It submits `model: "gpt-6-luna"` and one named `choice` question,
`dominant_color`, with exactly `red` and `blue` options. Ordinary CORS fetch uses
bearer authorization, JSON content type, and `credentials: "omit"`.

The page requires a user click, locks the run control, permits at most one POST
per load, and has no retries. Its AbortController deadline is 10 seconds overall,
including response-body reading. These are inspected source properties; timeout
and fault behavior were not exercised by this successful trial. See the
[procedure and evidence guidance](README.md) and the earlier
[investigation](../../docs/doom-issue-12-investigation.md). Those documents retain
their historical preparation/investigation status; this receipt records the
subsequent owner-run evidence.

## Environment and provenance

| Field | Value and source |
| --- | --- |
| Trial date/timezone | October 10, 2026, America/Los_Angeles, PDT (UTC−07:00); owner-reported. |
| Browser | Chrome `154.0.8037.98` (Official Build) (arm64); owner-reported from `chrome://version`. |
| Origin / visited URL | `http://127.0.0.1:8765` / `http://127.0.0.1:8765/`; owner-reported. |
| Endpoint | `https://api.openai.com/v1/decisions`; owner report, screenshot, and inspected source. |
| Preflight response timestamp | `Sat, 10 Oct 2026 21:42:44 GMT` = `2026-10-10 14:42:44 PDT`; OPTIONS response Date header in screenshot. This is not an independently established exact POST completion time. |
| Request ID | `req_d44fb933ab4040dcbccab3a56ceaaef9`; exposed to page JavaScript according to owner-supplied output. This ID is not a secret. |

Codex re-ran these read-only local commands while preparing this receipt. Exact
output of `git rev-parse HEAD`:

```text
bdc7e405bed14f94fbf0242397dcf0854a9b1ef0
```

Exact output of `shasum -a 256 experiments/m3-e1/index.html`:

```text
694a4ec8e5aa3e10fb4a70e11716b34637d46f2ad2e2f984fbcd6e55600c802d  experiments/m3-e1/index.html
```

HEAD identifies the repository baseline; the experiment files are currently
untracked. The SHA-256 identifies the inspected local page and matches the
earlier local command result. It is **not independently verified as a runtime
asset hash** of the page Chrome loaded during the trial.

## Results by layer

| Layer | Result | Evidence source and limits |
| --- | --- | --- |
| OPTIONS / preflight | PASS: `200 OK`; allowed origin `*`, methods `POST,OPTIONS`, headers `authorization,content-type`, max age `600`. | DevTools screenshot independently shows these OPTIONS response headers and two `decisions` entries: one POST and one OPTIONS. The selected details are OPTIONS only. |
| Browser-readable authenticated POST | PASS: HTTP `200`, complete response body readable by page JavaScript. | Owner-supplied page output; the screenshot does not show POST headers/details. Network visibility alone is not the basis of this pass. |
| Named choice response | PASS: `type: choice`, `name: dominant_color`, `choice: red`; no refusal observed. | Owner-supplied page output reports the page's valid-answer check passed. Inspected source checks one answer, matching type/name, allowed choice, confidence, and both option probabilities; the raw answer and numeric values were not supplied. |
| Image-choice correctness | PASS: selected `red` for the red Canvas. | Owner-supplied page output; this is separate from transport and authenticated answer validity. |

The owner supplied this page result verbatim:

```text
Status: Complete — all three checks passed
Elapsed: 1193 ms (deadline: 10000 ms)
Transport/CORS: PASS — page JavaScript read HTTP status and body
Authenticated API: PASS — successful HTTP response and valid named choice answer
Image-choice correctness: PASS — red
HTTP status: 200
Response body readable: Yes
Answer type: choice
Answer name: dominant_color
Selected choice: red
Refusal: No refusal observed
Request ID (only if exposed): req_d44fb933ab4040dcbccab3a56ceaaef9
```

**1,193 ms is the page-reported overall elapsed time for this one trial only.**
It is not a server-only latency measurement or a performance distribution.
Separate OPTIONS/POST timings, actual POST CORS/header values, raw confidence
and probability values, usage/billing, and exact POST completion time are
unavailable/unverified. The page-readable request ID does not establish the
exact POST `Access-Control-Expose-Headers` value.

## Privacy and limitations

Only sanitized textual evidence is incorporated. No credential, authorization
value, cookies, raw HAR, or unredacted screenshot was incorporated or stored by
this documentation task. The inspected page clears its password input and keeps
the temporary key transiently to construct the request; the executing page and
DevTools can see it. This does not prove key secrecy or the key's actual account
restrictions. The owner should revoke the disposable key after the test;
revocation has not been verified.

This single success does not prove hosted-origin CORS, official OpenAI JS SDK
browser import/header compatibility, repeatability/reliability, gameplay/Worker
integration, a performance distribution, or API behavior under faults, refusals,
timeouts, or cancellation. Aborting a request does not establish avoided server
processing or billing. Issue #12's integrated Doom control remains unproven.

## Next smallest experiment

After separate authorization, perform a credential-free official SDK browser
packaging/import check. If that passes and an SDK request is warranted, seek
separate authorization for one targeted authenticated SDK request to verify its
actual headers, CORS, and page-readable answer. Neither experiment was executed
as part of this receipt task.
