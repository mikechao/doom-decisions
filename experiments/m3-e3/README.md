# M3-E3: two Decisions → native Doom → rendered observations

**Core two-decision loop PASS, based on owner-supplied Chrome page output.**
See [results.md](results.md) for the trial evidence and its limits.
One trusted click on **Run 2 Decisions** prepares a fresh Worker/E1M1, completes
one explicit neutral tic, then runs at most two successive actual SDK choices.
Each admitted choice executes six native tics and renders before the next
observation. There is no gameplay scheduler, model call on load, retry, fallback
action, or automatic restart. A new click requires a new key entry and starts
fresh E1M1. The final Canvas and evidence remain visible after Worker retirement.

## Integration and required local assets

- [controller.js](controller.js) owns the browser sequence, Canvas capture,
  validation, cancellation and evidence. The [page](index.html) offers Run/Stop,
  per-attempt response/execution status, expandable sanitized response JSON,
  observed Canvas PNGs, and every verified native step.
- [worker-boundary.js](worker-boundary.js) copies `i11MaskValid`, `i11VerifyStep`,
  `i11Action` and `titleWorker` verbatim from the accepted Stage A
  [harness](../stage-a/harness.html), with only a file comment and export list.
  Dormant acceptance modes remain unused. The Worker alone instantiates WASM
  and steps gameplay; M3-E3 sends only `load-i11`, `init`, `prepare`, `snapshot`,
  `action` and `render`. One operation at a time uses the existing 2000 ms
  watchdog policy. No shared files or native behavior change.
- Reuses the **existing M3-E2 installation**, official `openai@7.32.0`:
  `../m3-e2/node_modules/openai/client.mjs` and `version.mjs`. These are the same
  published local ESM entrypoints proven in [M3-E2](../m3-e2/results.md), without
  bundler, CDN, proxy or SDK modifications. Version mismatch/import failure stops
  the trial. The SDK lockfile/provenance remain in [M3-E2](../m3-e2/README.md).
- Select `references/doom.wasm/build/issue-11-first-trace/doom.wasm` (360,156
  bytes), SHA-256
  `cc86ed8884ec04dbace3c541e8528a9f91839b79816cc79ce988af939d42dcb8`.
  Retain its `evidence/manifest.json`; this is the existing trace-enabled artifact
  from [Issue #11](../../docs/doom-issue-11-results.md), not a new build.
- Select `assets/freedoom-0.13.0/freedoom1.wad` (28,795,076 bytes), SHA-256
  `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`.
  This is real Doom engine E1M1 with Freedoom Phase 1 assets. The page checks
  lengths, and the Worker hashes both selected inputs before initialization.
  Assets are local/ignored; none are copied into or distributed by this experiment.

All three prerequisites were present during source preparation. If missing later,
stop and obtain authorization for acquisition/build; do not download or rebuild
implicitly. The previously approved SDK acquisition command is in M3-E2's README.

## Owner-run Chrome procedure (separate authorization required)

The implementation authorization covers source/docs and static checks only.
Serving, Chrome execution, temporary-key handling and two potentially billed
requests need separate owner authorization. Codex has performed none of them.
After authorization, the owner can:

1. Serve **the experiments directory** so the sibling M3-E2 SDK remains reachable:

   ```sh
   python3 -m http.server 8765 --bind 127.0.0.1 --directory experiments
   ```

   Open `http://127.0.0.1:8765/m3-e3/` in normal Chrome with normal browser
   security. No model traffic should occur on load. Unlike E2's old root URL,
   serving only `m3-e3` would make the sibling SDK unavailable. This server root
   exposes local experiment files, not the repository's Git metadata or assets.
2. Open Console/Network, keep the tab visible, and record the full Chrome version
   and origin. Select the exact WASM/IWAD above. Manually paste a temporary key
   restricted as far as account controls permit. Decline password-manager saving.
   Click **Run 2 Decisions** once. Never give the key to Codex or put it in a URL.
3. Inspect real E1M1 on the visible Canvas and the **1 → 7 → 13** tic checkpoints.
   Decision 1 observes tic 1; decision 2 observes the newly rendered tic 7. Both
   successful actions must report requested/reported/independently verified
   **6/6/6**, with unchanged counters/native observations across each API wait.
   Each observation's actual Canvas pixels are hashed against the native RGBA
   frame hash; its captured PNG is retained in that entry for owner inspection.
4. Confirm **2/2 completed**, 13 verified native tics, two SDK create calls and
   two actual POSTs to `/v1/decisions` (OPTIONS may be cached). Verify page-readable
   status/body, exposed request IDs if available, and no extra POST after finish.
   Inspect local module delivery/MIME, actual SDK header names, preflight/CORS and
   Console errors without disabling security. Check Chrome stays responsive.
   Same actions or identical frame hashes can be valid: movement is not required.
5. Save only sanitized page evidence and screenshots excluding the key field,
   credentials, cookies and HTTP headers. Revoke the key, clear sensitive DevTools
   captures, close the tab and stop the server. Each further trial needs owner
   authorization; there are no automatic retries or background runs.

## Request, validation and failure behavior

Uses the documented [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
and pinned SDK shapes: `gpt-6-luna`, one user message with a currently rendered
PNG `input_image`, one named `choice` question `next_action`. The seven string
values map exactly to `neutral=0`, `forward=1`, `turn_right=2`, `backward=4`,
`turn_left=8`, `fire=16`, `use=32`. Instructions describe six tics and exploration/
survival using the visible image only. Duration is always application-owned.
Validation requires one matching named choice, exact string allowlist membership,
finite confidence in [0,1] and one valid probability for each of seven choices.
Refusal/malformed data does not execute any action.

The SDK uses M3-E2's browser opt-in, fetch options, logging off, `maxRetries: 0`,
`timeout: 10000` and AbortSignal. `.asResponse()` and `.withResponse()` observe the
same APIPromise. An outer 10-second deadline stays active through body parsing;
an abort race also bounds the page's wait if body reading settles late. Late
responses recheck run validity before updating evidence or dispatching anything.
API errors show safe classifications/status/recognized request ID, never arbitrary
SDK error text, error bodies or sensitive headers. Response JSON is an explicit
allowlist projection; unexpected strings/fields are redacted/omitted.

**Stop** invalidates the run, aborts any API request, clears the credential and
retires the Worker. Controls unlock after the current handler settles; a new run
creates a fresh Worker and repeats neutral-first preparation. API/choice/native/
timeout failures retire without retry or replacement actions. Returned native
prefixes are independently checked and retained; interrupted/no-reply or faulted
current tics are marked uncertain, with a verified lower bound. Fully verified
actions and successfully rendered decision completions are counted separately.

The key clears from its password field on Run and lives only in transient run/SDK
memory until Stop/final cleanup. Nothing persists it, logs it, or includes it in
evidence. Clearing references cannot securely erase JavaScript strings or
DevTools/SDK copies. Abort does not prove upstream cancellation or avoided billing.
CSP permits only local scripts/modules, WASM compilation, Blob Workers, data
images for observed PNGs, local loads and `https://api.openai.com` connections.

## Sanitized evidence checklist and verification limits

Record date/timezone, Chrome version/origin, repository HEAD and hashes of these
experiment source files plus M3-E2's lockfile; SDK version and admitted asset hashes.
For each decision retain response received/body-readable status, observed tic/
frame hash/PNG, allowed selection/mask, request ID/latency, confidence/probabilities,
wait unchanged result, requested/reported/verified native tics, per-step consumption
checks, resulting rendered frame/tic, and error/refusal/uncertainty if any. Retain
neutral 1/1 evidence, final totals, Worker retirement, actual POST count and any
sanitized Console diagnostic. Do not save raw HARs, request headers or keys.

Codex performed only static checks: syntax, local references/import closure,
copied-source equality, artifact identities, whitespace and source review.
The owner subsequently ran the Chrome trial and supplied successful two-response,
two-action output, recorded in [results.md](results.md). UI responsiveness, Stop/
timeout/refusal races and partial native faults remain **unverified**. Codex has
not launched Chrome, handled the key or executed an authenticated request.
