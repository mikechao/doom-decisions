# Doom Decisions app guide

The owner-accepted **v0.2.0 Continuous Mode MVP** uses vanilla DOM APIs with
TypeScript **7.0.2**, Vite **8.3.4**, plain CSS, and official
**openai 7.32.0**. The HTML entry loads `src/main.ts`; TypeScript checks types
without emitting JavaScript, and Vite owns bundling.
The app automatically prepares real E1M1 on local IWAD selection and verifies exactly
one mandatory neutral first tic. Each **Next Decision** click then makes at most
one official SDK Decisions request using the current rendered image, executes
one allowlisted action on the same Worker, and returns to idle. **Start Continuous
Mode** explicitly authorizes sequential decisions through that same pipeline,
until Stop, budget exhaustion, a terminal boundary, or a failure.
The human owns duration: **Tics per decision** accepts any **positive JavaScript
safe integer**, initially **6**. **35 tics = 1 Doom second**: N/35 is simulated
Doom time, not API or browser wall time. Very large batches may exhaust memory,
trip the existing 2-second Worker watchdog or native counter guards, and require
reload; acceptance does not guarantee completion. The captured duration cannot
change during a pending decision. The model selects only `neutral`, `forward`,
`turn_right`, `backward`, `turn_left`, `fire`, or `use`; it never selects duration
or combined actions.

## Local IWAD support

Select a user-provided **Local Doom IWAD**, between **12 and 33,554,432 bytes
(32 MiB), inclusive**. The browser checks size before reading; the Worker checks
the received size independently before WASM compilation. Both hash the actual
bytes and require matching digests for that preparation, without a fixed WAD
size/hash identity allowlist. WASM size/hash/interface verification is unchanged.

Compatibility is **best-effort**: native IWAD/header/directory/resource checks and
controlled Doom E1M1 preparation must succeed, including the single neutral tic,
frame/Canvas verification and passive/idle proofs. Freedoom **0.13.0 Phase 1** and
the owner's local Doom shareware **DOOM1.WAD** have worked in owner-run trials.
This does not promise support for Doom II, PWADs, mods or every IWAD variant.
No WAD is bundled, staged, uploaded or redistributed. Initial size/read errors allow
selection retry; failed WASM verification or Worker/native work requires reload.

Native lump consumers still have unchecked malformed-input paths. Worker isolation,
retirement and the existing two-second request watchdog provide best-effort failure
containment, not a memory-safety guarantee for arbitrary/untrusted files. Browser
fetch/read/hash work before Worker creation has no application deadline. Parser
hardening and an end-to-end preparation deadline are outside this prototype change.

## Continuous mode

**Max API attempts** defaults to **2** and accepts any positive JavaScript safe
integer (up to 9,007,199,254,740,991), including 100, 500, or 1000. This is separate
from the **tics per decision** duration. Start validates and freezes the budget
for that run; neither the budget nor credentials are persisted. One unit is charged
immediately before each `decisions.create` invocation, including failed, refused, invalid,
timed-out, or canceled calls. Pre-request failures and preparation's neutral tic
consume no units. There are no refunds, automatic retries, or automatic restarts.
The status shows attempts used/limit, stop reason, and cumulative verified tics.
Another explicit Start is required after exhaustion.

Each iteration captures N separately at admission. You can edit N during a
continuous wait; this affects only later decisions. Ordinary successes preserve
the Worker/game and observe the preceding verified resulting frame. Only a fully
verified action and resulting frame permit another iteration. Manual Next Decision
is locked while a continuous run owns admission or cleanup.

**Stop** before native dispatch closes future admission, best-effort aborts the
SDK operation, ignores late choices, and proves unchanged native state before
returning to manual readiness. An underlying SDK response/read must settle before
any new request is admitted, even if Abort is ignored. A never-settling read leaves
controls locked with a waiting status; Abort does not prove remote processing or
billing stopped. Stop after native dispatch says **Stopping after current decision**
and finishes receipt and resulting-frame verification. It cannot interrupt or roll
back a synchronous native tic/batch. A healthy verified result preserves manual
play; unsupported state, uncertain completion, or unverifiable frames retire the
session and require reload.

Verified death or **E1M1 exit pending** stops at its independently verified prefix
(`N/k/k`) and retires after the terminal frame is verified. Exit pending is not
completed intermission or permission to advance to E1M2. A verified terminal
boundary with an unavailable resulting frame is reported separately; the prior
frame is not terminal imagery. Prototype acceptance includes owner-observed death
detection, but independently instrumented browser/WASM terminal evidence remains
uncollected, including exit-pending and early-prefix proof. Synthetic tests do not
establish that runtime evidence; see [prototype evidence](#prototype-acceptance-and-evidence).

## Prerequisites and clean checkout

Provision tools yourself; the build never installs them. The supported engine
build requires Bash (macOS **3.2** syntax), Node **22.20.0**/npm on PATH,
GNU Make **3.81** at `/usr/bin/make`, WASI SDK **24.0** (Clang/LLD 18.1.2),
Binaryen **119**, and Git. Python is not required for a fresh build or preview. See
[engine build documentation](../docs/doom-build.md) for the wrapper's constraints.
Its tested host is macOS; the Bash entrypoint does not establish support for
other hosts whose Make/tool versions differ. Paths passed to the engine wrapper
must satisfy its restrictions (including no whitespace or symlink ancestry).

From a checkout containing the app-local lockfile, install frontend dependencies:

```sh
npm --prefix app ci --no-audit --no-fund
./build.sh
```

In agent sessions, follow [AGENTS.md](../AGENTS.md) and task-specific execution
authorizations. Obtain owner approval before dependency resolution/downloads,
installation, builds, servers, browser execution or billable API calls.
Source inspection alone does not verify a build.

The default build uses Node admission, foreground Make, Node closeout and verified
staging, with `controlled-title`, fixtures enabled, two jobs and no embedded WAD.
Default tool locations are `tools/wasi-sdk-24.0` and `tools/binaryen-119/bin`;
optional `WASI_SDK` and `BINARYEN_BIN` environment variables select provisioned tools.
Node and npm come from PATH. No owner-specific absolute path is hard-coded.
Independent Python inspector/native tests remain separate from the build; see the
[build guide](../docs/doom-build.md#optional-python-checks).

Each build uses a new `engine/doom/build/m4b-runs/run.*/engine/` directory;
failed attempts and their evidence are retained. A deterministic ignored
`engine/doom/build/m4b-current.json` selects the current successful engine output.
It records that output's relative path and a hash of engine inputs, including
unignored additions/deletions, `build.sh`, Node build/staging helpers and inspector.
It deliberately does not require the repository HEAD to stay unchanged for frontend-only work.
The original build manifest remains beside the engine artifact. Keep it for
source/toolchain provenance; it is not published with private host paths.
Admission writes a pending receipt; only successful Make followed by closeout's
source/tool rechecks and WASM inspection permits a success receipt. Pending output
is rejected. The new receipt schema requires one full build before reusing an old
Python-generated cache; no old artifacts are deleted or silently adopted.

The handoff rechecks the successful manifest, controlled profile, enabled
fixtures, absent embedded IWAD, bytes/hash, source-input fingerprint, and typed
interface with `scripts/inspect_doom.mjs`. It stages `doom.wasm`, a sanitized
`doom-build.json`, and licenses under ignored `app/public/`. Vite copies these
to `app/dist/`; the handoff verifies the emitted bytes and refuses `.wad` files.
Staging verifies the candidate and `public` before atomically selecting current.
Current certifies the native engine; a later failed frontend build still exits
nonzero and does not certify a fresh `dist`.
Generated app/native outputs and installed dependencies are ignored. Historical
ignored builds are never selected as fallback inputs; old `references/doom.wasm/build/`
receipts cited in evidence records are unavailable in this checkout. Tracked
upstream example assets remain subject to the vendor-provenance caveats below.

For subsequent frontend-only changes:

```sh
./build.sh --frontend-only
```

This skips engine compilation and reuses only the current verified native artifact.
Missing files/evidence, changed engine inputs, mismatched bytes, or failed
interface checks require a full `./build.sh`. A clean checkout has no current
artifact and cannot use frontend-only mode first. Changed frontend dependencies
require `npm ci` again. The app build runs `npm run typecheck` before `vite build`
and retains the staging/output verification; the root wrapper also checks Worker
packaging. Every failure exits nonzero; an old `app/dist/` may still
exist after an early failure and is **not** a successful new build. Concurrent
builds in one checkout are unsupported.

Make runs in the foreground with no global timeout or process-tree supervisor.
The owner reports successful full and frontend-only builds with the same WASM
SHA-256, verified fixture-enabled WASM and `public`/`dist`, no bundled IWAD, and
Ctrl+C stopping compilation in a macOS terminal. These are owner-run observations;
the deliberate compilation-failure experiment was skipped for this milestone.
Shell INT/TERM traps exit rather than continue; they do not guarantee descendant
cleanup when only the wrapper receives a signal. A hung tool may require manual intervention. The old
512 MiB disk-space admission check and output-size accounting are omitted.

## Temporary browser-direct credentials

Enter a temporary OpenAI API key in the password field before Next Decision or Start.
The app sends it directly to `https://api.openai.com/v1/decisions` using the pinned
SDK, `gpt-6-luna`, browser opt-in, zero retries, and a 10-second deadline including
response-body reading. Availability, account access and browser CORS must be
confirmed in the owner trial; installed SDK types and a successful build do not
establish authenticated access. See the
[official Decisions guide](https://developers.openai.com/api/docs/guides/decisions).

The field clears when captured; the SDK client remains only in memory for later
clicks. An empty field can therefore mean a client is already available. During a
healthy idle session, enter a replacement key before the next click to replace
the client without restarting Doom. No key goes into storage, a URL, Worker
messages, diagnostics, or build artifacts. Page exit or fatal retirement drops
client references and clears the field. JavaScript cannot securely erase every
browser heap copy.

This prototype requires trust in the served page, all deployed scripts, the SDK,
and browser/DevTools access. CSP does not remove that trust requirement. It has
no account system, backend, proxy, or persistent credential. A deadline/abort does
not prove that upstream processing or billing stopped.

API failures/refusals/invalid choices dispatch no native action. If a fresh
snapshot proves the native state unchanged, the game returns to ready for another
explicit click; there are no automatic retries or fallback actions. Partial or
uncertain native completion, or failed render verification, retires the Worker:
**reload to restart**, with no reconstruction or replay. A bad IWAD can be
corrected before native preparation begins. Once preparation is admitted, the
picker is locked; changing the selected file never restarts a prepared game.
There are no Prepare, Reset or New Game buttons. Refresh starts a new game
and clears the in-memory credential; it does not resume prior state.

## Prototype acceptance and evidence

The owner accepted v0.2.0 with known evidence gaps. Prior observations are
**owner-reported**, not browser/API trials personally run by Codex:

- Earlier Chrome preparation showed real E1M1, neutral-first requested/reported/
  verified **1/1/1**, matching native/Canvas RGBA hashes, and no simulation
  advancement during passive snapshots/rendering or five-second startup idle.
- During the temporary identity-gate bypass, the owner reported shareware
  `DOOM1.WAD` loading with the complete original HUD and multiple AI forward
  decisions (reported screenshot: decision #6, verified tic 73), using the existing
  WASM. The file's exact identity was not independently inspected by Codex. This
  is compatibility evidence for that local file, not universal IWAD support or
  a browser verification of the permanent admission patch.
- The accepted manual trial reported **14 successful Decisions API decisions**,
  with five supplied receipt summaries and a duration change from **6 to 2**.
  Full Worker-instance/frame linkage, payload hashes, exact network accounting,
  and instrumented post-decision idle equality were not collected for that trial.
- The owner subsequently reported real Doom death detection at decision **#48**,
  with **N=20** and cumulative **tic 961**. This is not independently captured
  exact Worker/frame linkage or proof of every terminal path.

Controller "independently verified" counts mean receipt rechecking, not an
independent browser run. Independently instrumented terminal proof, including
E1M1 exit-pending and early-prefix behavior, remains uncollected. Synthetic offline
tests and builds do not fill those gaps. Detailed historical reports remain in
Git history; historical ignored raw artifacts cannot be recovered from Git.

## Owner-run isolated Chrome/API trial (not executed by Codex)

After separate build/runtime approval, run `./build.sh --frontend-only` if the
current verified native artifact can be reused, then serve **only** `app/dist/`.
From the repository root:

```sh
(cd app && ./node_modules/.bin/vite preview --host 127.0.0.1 --port 8000 --strictPort)
```

Open `http://127.0.0.1:8000/` in Chrome. Use loopback or HTTPS for Web Crypto.
Relative Vite URLs also support hosting beneath a path prefix. The app uses local
static assets and one Vite-packaged ES module Worker. CSP permits same-origin
Workers and OpenAI API connections. Inspect any Worker response CSP headers as
well as the page policy. The noncredential SDK probe
uses rejecting fetch and never invokes `decisions.create`.

1. Confirm SDK **7.32.0** and `decisions.create` available. Inspect Console/Network;
   record Chrome version, errors and local resource URLs. Select known-good local
   **Freedoom 0.13.0 Phase 1** `freedoom1.wad` (28,795,076 bytes; SHA-256
   `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`).
   Selection automatically loads bundled WASM and prepares real E1M1. No API
   request occurs. This is a known-working example, not a required identity pin.
   Repeat in a fresh page session with the owner's local shareware `DOOM1.WAD`,
   leaving the key blank; require the same preparation proofs and complete HUD.
   Invalid/incompatible input must not produce an admitted gameplay session;
   retain its exact error. Do not use hostile files as a safety test.
2. Confirm zero gameplay work before the mandatory neutral action and neutral
   requested / reported / independently verified **1 / 1 / 1** afterward. Expect
   the real 640×400 frame and matching native/Canvas RGBA hashes at **tic 1**.
   Wait for the five-second startup idle check to complete. Expand evidence:
   repeated snapshots preserve every counter and native field; the passive render
   changes only render/frame/intercept bookkeeping. No keyboard input drives Doom.
3. Enter a temporary key; set **N1=2**; click **Next Decision** once. Expect exactly
   one Decisions POST (OPTIONS preflight is separate), action **2 / 2 / 2**,
   cumulative **tic 3**, a verified resulting frame, and the same Worker/game.
4. Wait without clicking. Expect no new API request or native tic. Set **N2=5**;
   click once more. Verify the API observes the actual frame from **tic 3** (its
   captured checkpoint/hash equals decision 1's result). Expect **5 / 5 / 5**,
   cumulative **tic 8**, same Worker and initialization counters still one.
   Network-wait snapshots must be unchanged. Actions may be neutral; motion and
   differing frame hashes are not requirements.
5. Inspect accumulating history and advanced evidence for selected N, action,
   native requested/reported/verified counts, cumulative checkpoint, observation
   and result RGBA hashes, sanitized request IDs, API latency and honest failures.
   Missing receipts/timeouts after dispatch are uncertain completion, never proof
   of zero execution. A verified action with a failed resulting render is not
   replayed. Refresh to start over.

Keep build/WASM identity, sanitized request IDs, hashes and receipt projections.
Inspect the current image request locally without exporting secrets, authorization
headers, raw HARs or unredacted request content. Record owner Console/Network and
browser observations separately from Codex source inspection. These steps are a
verification procedure, **not evidence that this exact sequence was executed**.

Record the generated WASM size/hash and manifest path. Compare the hash with the
preflight reference `cc86ed8884ec04dbace3c541e8528a9f91839b79816cc79ce988af939d42dcb8`
(360,156 bytes), without treating it as a fixed requirement for modified engines.
See [prototype evidence](#prototype-acceptance-and-evidence) for prior owner reports
and their limits. Builds/static inspection do not establish Chrome, native or API
runtime success.

## Owner-run continuous trial (separate authorization required)

After an authorized build and isolated Chrome setup above, explicitly authorize a
**two-attempt** continuous run. Select N=2, Start, and change N to 5 during the first
API wait. Confirm receipts **2/2/2** then **5/5/5**, cumulative tics **3** then **8**,
and decision 2's observation checkpoint/hash equal to decision 1's verified result.
Record the persistent DevTools Worker target, initialization counters, local
observation payload, and exactly two Decisions POSTs (preflight is separate).
Expect **Budget exhausted, 2/2**, no third call, and manual readiness.

Separately authorize **one further attempt**, set the budget to 1, Start, and Stop
while its API response is pending. Confirm no late native action, no replacement
request while response cleanup remains pending, unchanged native checkpoint, and
manual readiness only after cleanup/passive proof. This trial admits at most three
potentially paid requests. Also record native-counter equality during SDK waits
and an idle interval, Console/Network observations, and keyboard/narrow-screen
control behavior. If Stop cannot be timed before dispatch, record that gap; a
completed action is not evidence of pre-dispatch cancellation.

A separately authorized one-attempt API-failure trial should stop without retry
or native dispatch and retain manual readiness only after passive proof.
Independently instrumented terminal proof, including E1M1 exit-pending and
early-prefix behavior, remains separate and uncollected despite the owner's
reported death observation. None of these browser/API/WASM trials has been
executed by Codex for this implementation.

## Offline tests, static checks and source boundary

Biome **2.5.15** is the app's sole linter and formatter, exact-pinned in the
app-local package and lockfile. Vitest **5.0.4** is the exact-pinned application
test runner. With dependencies already installed and offline test execution
separately authorized, run either command from the repository root:

```sh
npm --prefix app test
npm --prefix app run check
```

`npm --prefix app run lint` checks without writing.
**`npm --prefix app run format` writes changes** to included files.
`test` runs the complete offline application regression suite: all nine
`tests/*.test.ts` files in the default Node environment, with isolated files and
serial cases within each file. No additional Vitest configuration is needed.
`check` runs DOM and Worker TypeScript checks, static Worker packaging/import
checks, that complete suite once (including Worker-entry smoke), and non-writing
Biome lint/format checks in sequence, stopping on failure. Builds retain their
asset checks and never format source automatically.

The suite covers whole-body request fidelity and fresh request trees; admission,
frozen N, stale fences, choice validation and receipt accounting; Latest Outcome
truth gates; pinned SDK transport, deadlines, charging and helper/underlying-reader
ownership; and passive Worker imports/unknown-operation retirement. The ordinary-import
`session-controller.test.ts` initializes the real controller, prepares synthetic
receipts through neutral 1/1/1 and passive/idle checks, and completes one verified
SDK decision with local fake transport and native/Canvas hash agreement. IWAD,
terminal and continuous tests retain source extraction, Node type stripping and
VM contexts with mocked DOM, SDK, Worker responses and native receipts. They
cover synthetic size/digest admission, initialization failures, sequential frame
checkpoints, request/budget ownership, Stop before/after dispatch, delayed
success/rejection, timeout cleanup, failures without retry, and terminal/unsupported/
uncertain boundaries. These legacy loaders now read the moved controller and (for terminal/continuous)
the browser renderer; their prepared-state and VM Error/timer seams remain for
Stage 3. Extraction remains fragile when production source changes.

All fixtures are synthetic/offline. They use no game assets and demonstrate no
real Chrome, paid Decisions API, native Doom/WASM or live gameplay correctness,
successful browser preparation, or malicious-IWAD safety.

`biome.json` includes app source TypeScript (including `.d.ts`), app-owned
JavaScript and CSS, `biome.json`, `package.json`, both TypeScript configs, and
`vite.config.js`. It force-ignores `dist/`, `public/`, `node_modules/`, and
`package-lock.json`. The app-owned Worker is checked and formatted normally.
Vendored engine code and root scripts are outside this scope.

```sh
bash -n build.sh
npm --prefix app run typecheck
node --check scripts/build_engine.mjs
node --check scripts/stage_web.mjs
npm --prefix app run check
git diff --check
```

`src/session-controller.ts` is inert on import and construction. Its factory owns
session/attempt identity, readiness, preparation/proofs, decisions, continuous
admission, Stop/SDK reader cleanup, recovery and retirement. Explicit commands
start work. `src/main.ts` composes DOM rendering, synchronous input and Canvas
ports, local resource fetch, the Worker factory and page events. Presentation
receives detached read-only evidence and controller-decided controls, never mutable
session state, clients or cancellation hooks. Canvas ports return pixels; the
controller checks their digests and native receipts between the session fences.

`src/worker.ts` is the sole app-owned Worker entrypoint, loaded with Vite's literal
Worker constructor and explicit ES output format. `worker-shared.ts` contains
receipt types and one native step verifier reused by the Worker and controller;
importing it starts no Worker. There is no raw-source/Blob assembly or experiment
file dependency. Retired experiments are available in Git history; native engine
semantics are unchanged.

`tsconfig.json` checks the browser entry, session controller and shared code; `tsconfig.worker.json`
checks the Worker and shared code with WebWorker globals. Explicit `.ts` imports
also resolve in the Vitest tests. The packaging check parses
stripped source with Vite's already-installed parser and checks the constructor,
ES format, CSP and import boundary. The offline entry smoke imports the actual
modules, checks that only the entry installs a handler, and checks retirement on
a removed operation, without instantiating WASM or creating a real Worker.

Worker replies enter the controller as `unknown`; it checks the operation
envelope and uses the shared receipt contract while retaining native
completion/hash/idle checks. Types, offline checks and production builds do not
establish Chrome, native gameplay or authenticated API success. Follow the
owner-run procedure above after separate browser/server and billed-call approval.

## Licenses and deployment

The generated output includes the engine GPL license and SDK license files,
including bundled vendor notices. Existing source copyright/notices stay in
`engine/doom/`; see [vendor provenance](../docs/doom-vendor-provenance.md).
No IWAD is shipped. Inclusion of licenses alone does not establish redistribution
compliance. Review GPL corresponding-source/build-provenance obligations,
third-party notices, and unresolved vendored asset rights **before public
deployment**. This guide does not establish publication or redistribution clearance.
