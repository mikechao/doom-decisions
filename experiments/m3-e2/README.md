# M3-E2: official SDK in normal Chrome

**M3-E2 PASS for the tested loopback origin; see the [sanitized results](results.md).**
The owner approved the isolated `openai@7.32.0` installation and then manually
performed check A and a separately authorized SDK request. The page reported a
readable HTTP 200 answer selecting `red` in 366 ms. Codex did not run Chrome or
the authenticated request. This Doom-free [page](index.html) is isolated
from [M3-E1](../m3-e1/results.md) and Stage A. Loading it calls no API method;
A explicitly checks import/construction, and B prepares one separately approved
request. Missing SDK assets cannot produce a PASS.

## Packaging decision and evidence (2026-10-10)

Recommend **locally served published ESM, pinned `openai@7.32.0`, without a
bundler**. Before E2, the repo had no JS manifest, JS lockfile, node_modules,
or bundler. Its experiment server is Python's static HTTP server. Installed tools
inspected: Node `22.20.0`, npm `10.9.3`, Bun `1.4.2`. The approved acquisition
used npm `10.9.3`; no bundler or compiler was installed.

The current [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
requires JavaScript SDK **7.30.0+**. The
[official SDK release](https://github.com/openai/openai-node/releases/tag/v7.32.0)
and [npm latest metadata](https://registry.npmjs.org/openai/latest) were rechecked:
latest reported **7.32.0**. Metadata points to
`https://registry.npmjs.org/openai/-/openai-7.32.0.tgz`, with 3,882 files and
21,108,112 unpacked bytes. Recorded npm integrity:

```text
sha512-avqxu/jl1gsVBCBgFNPr9sTh+wZppQphuhhFy1zEvAJxEaJ4t0ery6hZdOT9kws/EcNTARoQcZs2IT3bliE1SA==
```

The initial read-only inspection of public registry metadata and selected
published files through UNPKG was performed in memory, before package acquisition
was approved. That inspection saved no SDK assets. Inspected published
[package.json](https://unpkg.com/openai@7.32.0/package.json),
[client.mjs](https://unpkg.com/openai@7.32.0/client.mjs),
[version.mjs](https://unpkg.com/openai@7.32.0/version.mjs), and
[decisions.mjs](https://unpkg.com/openai@7.32.0/resources/decisions.mjs).
The package exports `./client` as `client.mjs`; the initially inspected direct
imports use relative `.mjs` paths. The full traversal later found one `.js`
adapter, recorded below. `client.mjs` exports `OpenAI` and creates
the Decisions resource. Its published method posts to `/decisions`.
The page uses explicit local URLs, not the bare specifier `openai` (Chrome
does not apply npm's package resolution).

The published package has **no mandatory dependencies**. Its peers (`ws`,
`zod`, `undici`, and AWS/Smithy packages) are optional; this experiment uses
none of their entrypoints. The [SDK requirements and options](https://github.com/openai/openai-node/tree/v7.32.0#requirements)
support browsers with explicit `dangerouslyAllowBrowser`, Node >=22, and
TypeScript >=4.9 if TypeScript is used. Plain JavaScript needs no compiler.
Browser opt-in only removes the SDK guard; it establishes neither CORS nor
credential confidentiality.

| Option | Decision / concrete tradeoff |
| --- | --- |
| Local published ESM | Selected path: one pinned dependency, no build step, no runtime third-party code host. Use the public client subpath to avoid the root index's Azure/Bedrock re-exports. Offline traversal found 221 reachable files, including one guarded `.js` adapter described below. The owner subsequently reported Chrome import PASS; detailed HTTP/MIME evidence was not supplied. The whole installed package is about 21 MB; Chrome loads reachable modules, not all package files. |
| Small bundle | Only consider if local ESM actually fails. A pinned bundler and generated output would add an install/build gate; no bundler selected, installed, or configured. Do not add polyfills or rewrite the SDK silently. |
| Pinned CDN import | Evaluated and declined. An ESM CDN could resolve/repackage imports but adds runtime third-party delivery, availability, and trust to code handling a future BYOK key. UNPKG was a read-only inspection source, not a page dependency. |

Packaging and the tested SDK network path now have **owner-run PASS evidence**,
separate from the offline static checks recorded below. Detailed results and
their evidence limits are preserved in [results.md](results.md).
Stop for an owner decision on unexpected imports/dependencies, any new build,
CDN, proxy, or change outside this directory. If packaging grows materially,
defer SDK use and retain accepted M3-E1 fetch as the fallback.

## Gate 1: approved acquisition (completed)

The owner explicitly approved the isolated installation. Created
`experiments/m3-e2/package.json` with exactly:

```json
{
  "name": "doom-decisions-m3-e2",
  "private": true,
  "dependencies": { "openai": "7.32.0" }
}
```

Created `experiments/m3-e2/.gitignore` containing `/node_modules/`, then ran
the following approved command from the repository root:

```sh
npm install --prefix experiments/m3-e2 --ignore-scripts --no-audit --no-fund --omit=optional --omit=peer --registry=https://registry.npmjs.org --cache /private/tmp/doom-decisions-m3-e2-npm-cache
```

Observed outputs: isolated `package-lock.json` (npm 10 lockfile v3, including
the SDK's resolved tarball/integrity), `node_modules/openai/` with official
notices unchanged, and npm's internal `node_modules/.package-lock.json`.
The temporary cache may hold downloaded tarballs/logs; it contains no API key.
Verified lockfile version/integrity and installed module imports. npm reported
`added 1 package in 2s`; only OpenAI is installed. No root package files or
generated bundle were created. Acquisition uses npm's registry delivery/integrity; runtime serves
only local files. Optional peers are unnecessary for this client/Decisions path.

### Offline acquisition checks and unexpected import

- Installed package and version module both identify **7.32.0**. Lockfile v3
  contains only the root entry and `node_modules/openai`; resolved tarball and
  integrity match the previously inspected registry metadata. License is present,
  and SDK files were not edited. Install scripts were disabled.
- Lexical traversal from the page's client/version entrypoints found **221 local
  files and 837 static import/re-export edges**. All paths exist; no bare npm,
  remote, or Node builtin static specifiers were found. The only `import(...)`
  text found is a `node:buffer` suggestion inside an error-message string.
- An initial `.mjs`-only check stopped at
  `internal/auth/x509-transport-state.mjs` importing
  `./x509-transport-state.js`. This is an **unexpected mixed-format adapter**,
  not evidence of a browser failure. Its `.js` body guards CommonJS operations
  with `typeof module` / `typeof exports`; the `.mjs` wrapper selects
  `x509-transport-state-browser.mjs` if the Node registry export is absent.
  The source suggested browser compatibility; the owner subsequently reported
  successful client import/construction. No adapter rewrite, shim, import map,
  or bundle was added.
- Syntax-only module parsing passed for all 221 files, including the guarded
  `.js` adapter. Python's offline MIME lookup reports `text/javascript` for
  both extensions. No SDK code was evaluated, server started, or Chrome opened;
  these checks do not prove HTTP delivery or browser import.

Lockfile SHA-256:

```text
1ecb19f0579cf44217e02f1d53268bdc2b2d3ee62000234c35eddfed295e4c5e
```

### Credential-free Chrome result (owner-reported)

After reviewing the unexpected adapter, the owner chose to serve E2 and launch
Chrome manually, following check A's procedure. The owner supplied this exact
page output:

```text
SDK import PASS — official SDK 7.32.0 imported; OpenAI constructed; decisions.create present. No API method called. Confirm zero API traffic in Network.
```

The owner additionally reported: "Yeah there was no traffic in network tab".
This records no observed API traffic; individual local module requests, status
codes, MIME headers, and cache behavior were not supplied.

**Verdict: import/packaging PASS, based on the owner-run page result.** The
inspected page reaches this message only after importing actual local SDK/version
modules, checking 7.32.0, constructing OpenAI with a nonsecret placeholder, and
checking `decisions.create` presence. No API method is invoked during A.
This demonstrates the selected packaging path in the reported browser run,
including the adapter, without a bundler or real credential.

At the time of A's initial report, the instructed URL was
`http://127.0.0.1:8765/` in normal Chrome; the full Chrome version and network
details had not yet been supplied. The later B report supplies Chrome version
and a POST screenshot, recorded in [results.md](results.md). Codex did not observe
Chrome directly or copy screenshots/HARs into the repo. The local page SHA-256 is
`ce4e91d057b3bda4e1cf234384901eac3646878502a7b49fa7916cf2d63915d2`;
it is not independently verified as the runtime asset hash.

Import/construction alone did not establish CORS. The owner subsequently
authorized and performed one manual B request, which passed SDK network/CORS,
authenticated API, named choice, and color correctness checks. No additional
request is authorized. Codex must not execute authenticated requests.

## Gates 2 and 3: owner-run procedure

**Gate 2 is credential-free serving/normal Chrome import only.** After separate
approval and Gate 1, stop any previous process on port 8765 and serve just E2:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory experiments/m3-e2
```

1. Open `http://127.0.0.1:8765/` in normal Chrome; retain browser security.
   Record full Chrome version and origin. Open Console and Network; enable
   **Keep log / Preserve log**. Click **Check actual SDK import** without any
   credentials. Inspect same-origin `.mjs`/`.js` loads, JS MIME types, and zero traffic
   to `api.openai.com`. A imports actual SDK/version modules, checks the pin,
   constructs a client with a nonsecret placeholder, and checks method presence
   without calling it. Constructor failure or any unresolved import fails A.
2. Retain sanitized A evidence and review it before authorizing B. Syntax checks,
   npm success, HTTP 200 on one module, and a Node import are not Chrome PASS.
   If A fails, stop and diagnose packaging; do not add infrastructure or enter a key.

**Gate 3 is one separately authorized, potentially billed owner-run request.**
Codex must not handle the key or run it. Only after A's evidence is reviewed:

3. Confirm separate approval using B's checkbox. Manually enter a temporary key
   restricted as far as account controls allow for Decisions access. Decline
   password-manager saving. Click **Run one SDK test** once. The page clears the
   input, locks the controls, calls actual `client.decisions.create()` once with
   `maxRetries: 0`, `timeout: 10000`, and an AbortSignal. **Stop request** aborts;
   an overall timer remains active through SDK body parsing. SDK logs are off.
4. Inspect actual requested header **names**, OPTIONS if sent, and at most one
   POST to `https://api.openai.com/v1/decisions`. SDK source includes
   `X-Stainless-Lang`, `Package-Version`, `OS`, `Arch`, `Runtime`,
   `Runtime-Version`, `Retry-Count`, and `Timeout` (all prefixed `X-Stainless-`).
   Inspect actual names rather than assuming this list is complete. Do not strip
   them to obtain a pass. M3-E1's authorization/content-type preflight pass does
   not prove SDK-header compatibility. Preflight may be cached or prevent POST.
5. Check allowed origin, method, headers, POST status/CORS headers, and exposed
   header names in Network. A Network-visible response alone is insufficient;
   page JavaScript must read SDK status/body. Connection errors can hide preflight
   details: use Console/Network to distinguish CORS, CSP, network, or timeout.
6. Save only sanitized evidence below. Revoke the temporary key, clear sensitive
   DevTools captures, close the tab, and stop the server. Every further attempt
   requires new authorization and reload; no automatic retries occur.

The payload matches M3-E1: solid red 64×64 Canvas PNG data URL; `gpt-6-luna`;
one user `input_image`; one `choice` question named `dominant_color`, asking
to select `red` or `blue`, with those exact choice values. Schema checked against
the [Decisions reference](https://developers.openai.com/api/reference/typescript/resources/decisions)
and [pinned SDK types](https://raw.githubusercontent.com/openai/openai-node/v7.32.0/src/resources/decisions.ts).
SDK `.asResponse()` and `.withResponse()` observe the same APIPromise; they do
not initiate two requests. The first retains status before body parsing fails.

## Criteria, failures, and sanitized evidence

- **Import/packaging PASS:** actual official 7.32.0 imports and constructs in
  normal Chrome; Decisions method exists; zero API traffic and no real key.
- **SDK network PASS:** page reads a successful real SDK HTTP response
  and parsed answer from this origin with the actual SDK headers and browser
  security intact. HTTP errors preserve observed status but fail successful API
  access; SDK error-body completeness is explicitly unverified. A refusal is an
  API answer, separately identified, and provides no valid choice.
- **Named choice PASS:** exactly one `choice` / `dominant_color` answer,
  red/blue string value, finite confidence in [0,1], and one probability in [0,1]
  for each supplied option. SDK parsing alone does not validate these fields.
- **Correctness PASS:** valid answer chooses `red`; `blue` is a correctness
  failure while transport/API can pass. Missing exposed request ID fails none
  of these criteria. Refusal, malformed JSON/answer, HTTP rejection, connection
  failure, CSP, timeout, and Stop have distinct page outcomes.

Stage B output deliberately omits arbitrary API error messages/bodies, response
fields, and headers. It records only expected answer values, numeric HTTP status, and
recognized request IDs; other values remain missing/unavailable. Do not copy
authorization values, keys, `Set-Cookie`, request headers wholesale, raw HARs,
or screenshots containing secrets. Keep log retains secrets in DevTools; it is
not a sanitized artifact. Manually copy only this allowlist:

```text
Trial timestamp/timezone; full Chrome version; exact origin:
Repository HEAD; index.html SHA-256; lockfile SHA-256; installed SDK version:
A: PASS/FAIL/NOT RUN; constructor/method result; zero API traffic yes/no:
B: NOT RUN or authorized single trial; page create-call count; actual POST count:
OPTIONS observed/cached/unknown; request header names only:
Allowed origin/method/header names; exposed header names:
Page-readable status; complete body yes/no/unverified; elapsed ms:
Transport / authenticated HTTP / named choice / correctness / refusal:
Answer type/name/choice; exposed request ID or unavailable:
Sanitized failure classification; Console/Network diagnostic without secrets:
```

Known limits: loopback does not establish hosted-origin support; browser BYOK
exposes the key to executing site JavaScript and dependencies. The SDK retains
the credential during the attempt; the page clears its input/local reference,
then clears the client's key and drops references when the attempt settles.
This cannot securely erase JS strings, browser/SDK copies, or DevTools state.
API cancellation does not establish upstream billing cancellation. One request
does not establish a latency distribution or any Doom gameplay behavior.
