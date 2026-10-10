# M3-E2 results: official JavaScript SDK in Chrome

**Verdict: M3-E2 PASS for the tested `http://127.0.0.1:8765` origin.**
The owner separately approved SDK acquisition, performed the credential-free
import check, then authorized and performed one manual SDK request. Official
`openai@7.32.0` loaded from local published files without a bundler, and the page
read a successful `client.decisions.create()` answer selecting `red`.
Codex installed the approved dependency and prepared this receipt; Codex did not
launch Chrome, handle the API key, or execute the authenticated request.

## Packaging and request

The [page](index.html) imports `node_modules/openai/client.mjs` and
`version.mjs` through explicit local URLs. The isolated
[manifest](package.json) pins 7.32.0; the [lockfile](package-lock.json) records
the official npm tarball/integrity. No runtime CDN, bundler, compiler, or local
proxy was introduced. See [the README](README.md) for acquisition details and
the inspected mixed-format adapter; that adapter required no source changes.

Check A's owner-reported output established SDK import, OpenAI construction with
a nonsecret placeholder, and presence of `decisions.create`. The owner reported
no Network traffic during this credential-free check. Individual module request
headers/statuses were not supplied.

Check B uses the same M3-E1 payload: `gpt-6-luna`, one user message with a red
64×64 Canvas PNG data URL, and one `choice` question named `dominant_color`,
with choices `red` and `blue`. Source calls the official SDK once, with explicit
browser opt-in, `maxRetries: 0`, a 10-second SDK timeout, and an AbortSignal plus
overall deadline through body parsing. SDK headers are retained and SDK logging
is off. `.asResponse()` and `.withResponse()` observe the same request promise.

## Environment and results

| Field | Observation and evidence |
| --- | --- |
| Browser | Chrome `154.0.8037.98` (Official Build) (arm64), owner-reported. |
| Origin | `http://127.0.0.1:8765`; instructed procedure and screenshot's DevTools title. Normal browser security was instructed; settings were not independently audited. |
| Trial date | October 10, 2026; POST response Date shows `Sat, 10 Oct 2026 22:14:06 GMT`, equivalent to 15:14:06 PDT. This is a response-header timestamp, not independently measured trial start/completion. |
| Import/packaging | PASS: actual official SDK 7.32.0 imported, client constructed, Decisions method present, no API traffic reported for A. |
| SDK transport/CORS | PASS: owner-supplied page output reports readable HTTP status and complete SDK-parsed body. Screenshot independently shows selected POST `200 OK`. |
| Authenticated API | PASS: successful HTTP response and valid named choice, per page output. |
| Named choice | PASS: sole `choice` answer named `dominant_color`; inspected page validation checks confidence and both option probabilities. Raw confidence/probability values were not supplied. |
| Correctness | PASS: `red` selected for red Canvas; no refusal observed. |
| Elapsed | **366 ms**, page-reported overall elapsed time for this one attempt. |
| Request ID | `req_e922b55de3e94aa48361cb2cec066a34`, exposed to page JavaScript per owner output. |
| Attempt count | Page reports one SDK create call. Screenshot shows two `decisions` entries and confirms one selected POST; the second entry's method/status is not visible. It is consistent with a POST plus preflight, but the exact Network method count is not independently established. |

The screenshot shows the POST endpoint as
`https://api.openai.com/v1/decisions`, referrer policy `no-referrer`, response
`Content-Type: application/json`, `Access-Control-Allow-Origin: *`, and exposed
headers `x-request-id,retry-after,server-timing-total`, with a separate exposed
`CF-Ray` header. It also shows `Openai-Processing-Ms: 116` and
`Server-Timing-Total: 116.088`; these response-reported timings are separate from
the page's 366 ms elapsed measurement. Keep log is visibly enabled.

OPTIONS status, preflight requested/allowed header names, actual POST request
header names, and separate OPTIONS/POST timing panels were not supplied. SDK
source and the readable successful answer establish the tested SDK request
path; this receipt does not invent exact observed `X-Stainless-*` header values
or claim independently inspected preflight success.

Owner-supplied page output:

```text
SDK load: PASS — 7.32.0
Status: Complete — SDK network and choice correctness passed
Elapsed: 366 ms (deadline: 10000 ms)
SDK create calls initiated by page: 1 (actual POST count: inspect Network)
Transport/CORS: PASS — page read SDK HTTP status and complete body
Authenticated HTTP/API result: PASS — successful authenticated HTTP response
Valid named choice: PASS — one valid dominant_color choice answer
Image-choice correctness: PASS — red
HTTP status: 200
Complete response body readable: Yes — SDK finished reading/parsing
Answer type: choice
Answer name: dominant_color
Selected choice: red
Refusal: No refusal observed
Request ID (only if exposed): req_e922b55de3e94aa48361cb2cec066a34
```

## Local provenance and limits

Read-only receipt-preparation checks found repository HEAD
`f375014443aa61063407082fda20e7b4ca48a271` and these SHA-256 hashes:

```text
ce4e91d057b3bda4e1cf234384901eac3646878502a7b49fa7916cf2d63915d2  experiments/m3-e2/index.html
1ecb19f0579cf44217e02f1d53268bdc2b2d3ee62000234c35eddfed295e4c5e  experiments/m3-e2/package-lock.json
```

E2 files are untracked; HEAD alone does not identify the experiment. These are
hashes of inspected local files, not independently verified runtime asset hashes.
Prior offline checks validated the pin/integrity, resolved 221 local modules,
checked module syntax, links, whitespace, and isolated file scope. Those checks
are separate from the owner-run browser evidence.

Only sanitized text is saved in this repository. The supplied screenshot's
cookie value is excluded; the screenshot, authorization headers, API keys,
and raw HARs are not copied into the repo. Actual key restrictions and revocation
are unverified. The owner should revoke the temporary key and clear sensitive
DevTools captures after the trial.

This proves the tested local SDK import/request path, not hosted-origin CORS,
public BYOK security, latency distribution, fault/timeout/cancellation behavior,
or Doom control. Browser keys remain visible to executing site JavaScript;
aborting does not establish avoided upstream processing or billing. No additional
paid request is authorized by this receipt. Doom integration is a separate slice;
M3-E2 introduced no Doom, Worker, WASM, or Stage A changes.
