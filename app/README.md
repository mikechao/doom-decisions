# Doom Decisions M4-C

Vanilla DOM APIs with TypeScript **7.0.2**, Vite **8.3.4**, plain CSS, and official
**openai 7.32.0**. The HTML entry loads `src/main.ts`; TypeScript checks types
without emitting JavaScript, and Vite owns bundling.
M4-C automatically prepares real E1M1 on local IWAD selection and verifies exactly
one mandatory neutral first tic. Each **Next Decision** click then makes at most
one official SDK Decisions request using the current rendered image, executes
one allowlisted action on the same Worker, and returns to idle. There is no
autoplay.
The human owns duration: **Tics per decision** accepts integers **1–20**, initially
**6**. The captured duration cannot change during a pending decision. The model
selects only `neutral`, `forward`, `turn_right`, `backward`, `turn_left`, `fire`, or
`use`; it never selects duration or combined actions.

## Prerequisites and clean checkout

Provision tools yourself; the build never installs them. The existing engine
wrapper requires Python **3.14.4**, Node **22.20.0** on PATH, POSIX process groups,
GNU Make **3.81** at `/usr/bin/make`, WASI SDK **24.0** (Clang/LLD 18.1.2),
Binaryen **119**, Git, and 512 MiB free space. See
[engine build documentation](../docs/doom-build.md) for the wrapper's constraints.
Its tested host is macOS; the Bash entrypoint does not establish support for
other hosts whose Make/tool versions differ. Paths passed to the engine wrapper
must satisfy its restrictions (including no whitespace or symlink ancestry).

From a checkout containing the app-local lockfile, install frontend dependencies:

```sh
npm --prefix app ci --no-audit --no-fund
./build.sh
```

In agent sessions, obtain owner approval before dependency resolution/downloads,
installation, builds, servers, or browser execution. This requirement comes from
AGENTS.md and the M4-C implementation prompt. Tests/checks also require separate
execution authorization for this change. Source inspection alone does not verify
a build.

The default build invokes only `scripts/build_doom.py --profile controlled-title
--jobs 2 --timeout 120` with fixtures enabled and no embedded WAD. Default tool
locations are `tools/wasi-sdk-24.0` and `tools/binaryen-119/bin`; optional `PYTHON`,
`WASI_SDK`, and `BINARYEN_BIN` environment variables select provisioned tools.
Node and npm come from PATH. No owner-specific absolute path is hard-coded.

Each build uses a new `engine/doom/build/m4b-runs/run.*/engine/` directory;
failed attempts and their evidence are retained. A deterministic ignored
`engine/doom/build/m4b-current.json` selects the current successful engine output.
It records that output's relative path and a hash of engine inputs, including
unignored additions/deletions, compiler wrapper, and inspector. It deliberately
does not require the repository HEAD to stay unchanged for frontend-only work.
The original build manifest remains beside the engine artifact. Keep it for
source/toolchain provenance; it is not published with private host paths.

The handoff rechecks the successful manifest, controlled profile, enabled
fixtures, absent embedded IWAD, bytes/hash, source-input fingerprint, and typed
interface with `scripts/inspect_doom.mjs`. It stages `doom.wasm`, a sanitized
`doom-build.json`, and licenses under ignored `app/public/`. Vite copies these
to `app/dist/`; the handoff verifies the emitted bytes and refuses `.wad` files.
All binary/output directories and dependencies are ignored. Historical ignored
builds remain untouched and are never selected as fallback inputs.

For subsequent frontend-only changes:

```sh
./build.sh --frontend-only
```

This skips engine compilation and reuses only the current verified M4-B artifact.
Missing files/evidence, changed engine inputs, mismatched bytes, or failed
interface checks require a full `./build.sh`. A clean checkout has no current
artifact and cannot use frontend-only mode first. Changed frontend dependencies
require `npm ci` again. The app build runs `npm run typecheck` before `vite build`
and retains the staging/output verification; the root wrapper also checks Worker
packaging. Every failure exits nonzero; an old `app/dist/` may still
exist after an early failure and is **not** a successful new build. Concurrent
builds in one checkout are unsupported.

## Temporary browser-direct credentials

Enter a temporary OpenAI API key in the password field before a decision click.
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
There are no Prepare, Stop, Reset or New Game buttons. Refresh starts a new game
and clears the in-memory credential; it does not resume prior state.

## Owner-run isolated Chrome/API trial (not executed by Codex)

After separate execution approval, copy **only** `app/dist/` to a new temporary
directory and serve that directory. For example, from the repository root:

```sh
SMOKE_DIR=$(mktemp -d /tmp/doom-m4c-smoke.XXXXXX)
cp -R app/dist/. "$SMOKE_DIR/"
python3 -m http.server 8000 --bind 127.0.0.1 --directory "$SMOKE_DIR"
```

Open `http://127.0.0.1:8000/` in Chrome. Use loopback or HTTPS for Web Crypto.
Relative Vite URLs also support hosting beneath a path prefix. The app uses local
static assets and one classic Blob Worker. The only CSP change for M4-C permits
OpenAI API connections; other restrictions remain. The noncredential SDK probe
uses rejecting fetch and never invokes `decisions.create`.

1. Confirm SDK **7.32.0** and `decisions.create` available. Inspect Console/Network;
   record Chrome version, errors and local resource URLs. Select known-good local
   **Freedoom 0.13.0 Phase 1** `freedoom1.wad` (28,795,076 bytes; SHA-256
   `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`).
   Selection automatically loads bundled WASM and prepares real E1M1. No API
   request occurs. Other IWADs are intentionally refused.
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
browser observations separately from Codex source inspection. These steps are an
acceptance procedure, **not evidence of a completed M4-C runtime trial**.

Record the generated WASM size/hash and manifest path. Compare the hash with the
preflight reference `cc86ed8884ec04dbace3c541e8528a9f91839b79816cc79ce988af939d42dcb8`
(360,156 bytes), without treating it as a fixed requirement for modified engines.
See the historical [M4-B verification record](../docs/doom-m4b-verification.md)
for owner-reported baseline results; it does not establish M4-C acceptance.
Builds/static inspection do not establish Chrome, native or API runtime success.

## Static checks and source boundary

Biome **2.5.15** is the app's sole linter and formatter, exact-pinned in the
app-local package and lockfile. After separate authorization, run from the
repository root:

```sh
npm --prefix app run check
node --experimental-strip-types app/tests/decision.mjs
```

`npm --prefix app run lint` checks without writing.
**`npm --prefix app run format` writes changes** to included files.
`check` runs TypeScript, Worker integrity, and non-writing Biome lint/format checks
in sequence, stopping on failure. Builds retain their existing checks and never
format source automatically. The tiny offline script uses Node assertions and the
actual admission/fence, choice validator and receipt verifier. It covers frozen N,
double admission, stale identities, invalid choices, synthetic 1 → 3 → 8 chains,
partial/fault/missing receipts and reported-versus-verified mismatches. It does not
exercise DOM wiring, real SDK calls, real Workers or native WASM execution.

`biome.json` includes app source TypeScript (including `.d.ts`), app-owned
JavaScript and CSS, `biome.json`, `package.json`, `tsconfig.json`, and
`vite.config.js`. It force-ignores `src/worker-boundary.js`, `dist/`, `public/`,
`node_modules/`, and `package-lock.json`. The raw Worker payload is excluded from
linting, formatting, and writes; its declaration file remains checked. Historical
experiments, vendored engine code, and root scripts are outside this scope.

```sh
bash -n build.sh
npm --prefix app run typecheck
node --check scripts/stage_web.mjs
npm --prefix app run check
git diff --check
```

The Worker is a verbatim app-local copy of
`experiments/m3-e3/worker-boundary.js`. Vite imports it as raw text; only the exact
single export wrapper is removed before appending `titleWorker();`. The static
check compares source bytes with the accepted experiment, validates wrapper
removal, and parses the classic payload without execution. Normal module imports
provide the independent main-thread step verifier. The raw payload never uses
bundler-transformed `Function.prototype.toString()`. Historical experiments and
native engine semantics are unchanged.

`worker-boundary.js` intentionally remains JavaScript byte-for-byte, because its
raw text is the classic Blob Worker payload. `worker-source.js` also stays plain
JavaScript so the Node static check can import it directly. Small adjacent `.d.ts`
files describe the verifier/receipt and source-wrapper boundaries without
transpiling or rewriting either runtime file. Worker replies enter as `unknown`;
the controller checks the operation envelope and uses the preserved Worker's
declared receipt contract, then retains the native completion/hash/idle checks.
These declarations do not establish runtime payload validity or browser success.

## Licenses and deployment

The generated output includes the engine GPL license and SDK license files,
including bundled vendor notices. Existing source copyright/notices stay in
`engine/doom/`; see [vendor provenance](../docs/doom-vendor-provenance.md).
No IWAD is shipped. Inclusion of licenses alone does not establish redistribution
compliance. Review GPL corresponding-source/build-provenance obligations,
third-party notices, and unresolved vendored asset rights **before public
deployment**. This milestone performs no publication or redistribution review.
