# M3-E1: browser-direct Decisions API probe

This isolated, Doom-free page prepares the smallest direct-browser transport
experiment for Issue #12. **No real Chrome/API trial has been performed by this
implementation task. Browser-direct feasibility remains unproven.**
The baseline is [the committed investigation](../../docs/doom-issue-12-investigation.md)
at repository revision `bdc7e40`. Stage A and the native Doom code are unchanged.

`index.html` is self-contained HTML/JavaScript with no dependencies, SDK, proxy,
or external resources. Its CSP permits connections only to
`https://api.openai.com`; it does not inherit Stage A's `connect-src 'none'`.
Loading the page makes no API request. Only a user click can initiate its single
POST; the control locks immediately and another attempt requires a reload.
Chrome may independently issue an OPTIONS preflight. There are no retries,
redirect following, cookies, or background API calls.

The payload was checked on 2026-10-10 against the official
[Decisions guide](https://developers.openai.com/api/docs/guides/decisions) and
[create reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).
It uses `model: "gpt-6-luna"`, one user message containing one `input_image`
whose `image_url` is a real Canvas-generated `data:image/png;base64,...`, and one
`choice` question named `dominant_color` with exactly `{value: "red"}` and
`{value: "blue"}`. The Canvas is 64×64 opaque solid red. No undocumented request
fields are added. A valid choice answer must be the sole answer, have matching
type/name, a supplied string choice, numeric confidence, and one numeric
probability for each option. Refusals have type/name; no explanation is assumed.

## Owner-run procedure (requires separate authorization)

Authorize the local server and normal Chrome run separately from the **one
potentially billed authenticated Decisions request** and temporary-key handling.
Do not provide the key to the coding agent. Once authorized:

1. From the repository root, serve **only this experiment directory**:

   ```sh
   python3 -m http.server 8765 --bind 127.0.0.1 --directory experiments/m3-e1
   ```

2. Open `http://127.0.0.1:8765/` in normal Chrome with normal browser security.
   Do not use `file://`, disable CORS/security, add a relay, or change the request
   to `no-cors`. Keep the tab visible during the trial. Note the full Chrome
   version from `chrome://version` and the exact origin
   `http://127.0.0.1:8765` (not `localhost`).
3. Open DevTools Console and Network before running. Enable Preserve log if
   useful and filter Network for `decisions`. Confirm no API traffic on load.
   Create a temporary test key restricted as far as available account controls
   permit this endpoint/model. Manually enter it in the password-style field;
   decline password-manager saving. The page clears/disables the input on Run
   and retains the key only transiently to construct the request. The executing
   page and DevTools necessarily see it; this is not a confidential browser key.
4. Click **Run one test** once. The page uses ordinary CORS `fetch()` with
   `Authorization: Bearer …` and `Content-Type: application/json`. It aborts at
   a 10-second overall deadline, kept active through response-body reading.
   **An abort does not prove the server stopped processing or avoided billing.**
5. Inspect OPTIONS if present and the **single POST**. Check the actual Origin,
   preflight `Access-Control-Request-Method` and requested header names
   (`authorization`, `content-type`), plus the response's
   `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and
   `Access-Control-Allow-Headers`. Check the POST response's CORS headers,
   status, timing, and `Access-Control-Expose-Headers` for `x-request-id`.
   Preflight may be cached, so its absence alone is not failure. A blocked
   preflight can prevent the POST entirely. Visibility in Network alone is not
   enough: verify that the **page reports readable HTTP status and body**.
6. Record only the sanitized receipt described below. Revoke the temporary key
   after the trial, close the tab/clear DevTools captures containing the key,
   and stop the server with Ctrl-C. Reload and obtain authorization before any
   additional request; do not troubleshoot by repeated clicking or retries.

## Expected results and failure classification

The page reports status, elapsed time, available HTTP status, body readability,
answer type/name/choice, refusal, and only a browser-exposed request ID. It does
not print raw response bodies, raw headers, keys, or payloads to the console.

| Observation | Classification and consequence |
| --- | --- |
| Page reads HTTP status and complete body, including an API error body | **Transport/CORS PASS for that response path.** A readable rejection does not establish authorized model access or the successful-response CORS path. |
| Successful HTTP status, readable JSON, one valid `dominant_color` choice answer | **Authenticated API PASS.** Requires `choice` type, matching name, red/blue choice, confidence, and both option probabilities. |
| Valid answer chooses `red` | **Image-choice PASS**, an additional check. `blue` fails this check while transport/API can still pass. |
| CSP connection violation | CSP failure; inspect Console and the effective page policy. Do not bypass browser security. A policy blocking the script itself may leave the initial status unchanged; inspect Console. |
| OPTIONS rejected or POST response CORS headers missing/incompatible | Preflight/CORS failure established by DevTools; JavaScript may expose only `TypeError`. |
| `TypeError` without definitive CORS details | Unclassified fetch/body failure: network, CORS, or preflight. Inspect Console/Network; do not infer CORS from `TypeError` alone. |
| Page reads 401 | Authentication failure; transport can still pass. |
| Page reads 403 | Permission/access failure; transport can still pass. |
| Page reads 429 | Rate-limit or quota failure; transport can still pass. |
| Page reads another non-success HTTP status | Other HTTP failure, recorded by status; transport can still pass. |
| Deadline expires before status or during body reading | Timeout; preserves any already readable status, but complete-body transport and authenticated success remain unproven. |
| Readable successful body is invalid JSON or has missing/invalid named choice fields | Malformed-response failure; transport still passes. |
| Answer has `type: "refusal"` | Refusal; transport can pass, but the authenticated choice-answer check fails. No explanatory text is expected. |
| No exposed `x-request-id` | Header-exposure limitation only; **does not fail transport or API success**. |
| Empty key on Run | Local no-request result; reload required. No transport conclusion. |

A single loopback trial proves only the observed origin/account/model/request
and response path. It does **not** establish support for a later hosted origin,
browser SDK requests with extra headers/packaging, Doom control, latency
reliability, or public BYOK infrastructure. If ordinary direct fetch is blocked,
record the blocker and stop this slice; do not add scaffolding or a workaround.

## Safe evidence collection

Do **not** share an unredacted HAR, authorization header/value, API key, full
network payload, or screenshot that exposes credentials. Preserve log keeps
sensitive network entries in DevTools; it is not a sanitized receipt. Manually
copy only the allowed fields below into a receipt after reviewing for secrets;
use a cropped/redacted result screenshot only if needed. Do not save credentials
to source, files, query strings, logs, browser storage, cookies, or settings.

Record the repository HEAD and exact page revision before serving, including
the hash of the uncommitted page (HEAD alone does not identify these new files):

```sh
git rev-parse HEAD
shasum -a 256 experiments/m3-e1/index.html
```

Sanitized receipt template (leave unobserved values explicitly unknown):

```text
Chrome full version:
Exact origin:
Trial timestamp with timezone:
Repository HEAD and index.html SHA-256:
OPTIONS observed/cached/unknown; attempted POST count:
Origin and request header names only (never Authorization value):
Allowed origin/method/header names; exposed header names:
Page-readable HTTP status and complete body yes/no:
Transport / authenticated API / image-choice outcomes:
Failure classification and sanitized Console/Network diagnostic, if any:
Elapsed time / OPTIONS and POST timing, if observed:
Answer type / name / choice / refusal:
Request ID if exposed to page JavaScript (otherwise unavailable):
```

## Manual pass/fail checklist

- [ ] Normal Chrome, exact loopback origin, solid red Canvas, no API traffic on load.
- [ ] Input cleared and run control disabled; no more than one POST attempt and no retries.
- [ ] OPTIONS (if present) and POST CORS/status/timing inspected without sharing secrets.
- [ ] **Transport:** page JavaScript reads status and complete body; Network-only visibility fails proof.
- [ ] **Authenticated API:** successful HTTP response and correctly shaped named choice answer.
- [ ] **Image:** `red` separately checked; missing request ID does not fail the other checks.
- [ ] Sanitized receipt saved; key revoked; server stopped. Any failure is classified without guessing.

Preparation and offline checks are not manual test results. No screenshot,
latency measurement, or live API response is supplied here.
