# Doom Decisions M4-B

Vanilla DOM APIs with TypeScript **7.0.2**, Vite **8.3.4**, plain CSS, and official
**openai 7.32.0**. The HTML entry loads `src/main.ts`; TypeScript checks types
without emitting JavaScript, and Vite owns bundling.
M4-B packages/prepares Doom and executes exactly one neutral tic. It makes no
Decisions request, takes no API key, and has no gameplay loop or stepping UI.

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
the M4-B implementation prompt. Source/static checks alone do not verify a build.

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

## Isolated static smoke

After separate execution approval, copy **only** `app/dist/` to a new temporary
directory and serve that directory. For example, from the repository root:

```sh
SMOKE_DIR=$(mktemp -d /tmp/doom-m4b-smoke.XXXXXX)
cp -R app/dist/. "$SMOKE_DIR/"
python3 -m http.server 8000 --bind 127.0.0.1 --directory "$SMOKE_DIR"
```

Open `http://127.0.0.1:8000/` in Chrome. Use loopback or HTTPS for Web Crypto.
Relative Vite URLs also support hosting beneath a path prefix. The app loads
only local static files and a classic Blob Worker. CSP permits same-origin
connections and WASM compilation, blocks external connections, and permits the
Blob Worker. The SDK probe additionally uses a rejecting fetch implementation;
it constructs a client with a noncredential placeholder and checks the public
`decisions.create` method without calling it.

1. Confirm the page reports SDK **7.32.0** and `decisions.create` available.
   Inspect Console and Network; record Chrome version, errors, resource URLs,
   and whether any external/API request occurred. Expected resources are the
   local HTML, bundled JS/CSS, `doom-build.json`, and `doom.wasm` on preparation.
2. Select your own known-good **Freedoom 0.13.0 Phase 1** `freedoom1.wad`
   (28,795,076 bytes; SHA-256
   `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`).
   Other IWADs are intentionally refused by the preserved proven Worker.
3. Click **Prepare Doom** once. Expect genuine E1M1 readiness and zero
   gameplay/native/clock counters before the action, then neutral requested /
   reported / independently verified **1 / 1 / 1**. Expect a real 640×400 frame
   and equal native/Canvas RGBA hashes. The mandatory neutral action is the only
   gameplay action dispatched. No key input drives the engine.
4. Wait for the idle check to finish (at least five seconds). Expand evidence:
   repeated snapshots preserve every counter; the passive render changes only
   render/frame/intercept bookkeeping; all simulation counters remain at 1,
   native state and the frame hash stay unchanged. No further timer or operation
   loop runs after this bounded diagnostic. The Worker remains idle.
5. A successful run disables preparation and the picker; reload for a new game.
   A failure retires the Worker and permits a fresh preparation. Never retry an
   uncertain action on the existing game. Keep the displayed receipts and build
   manifest for review; they contain no key, headers, local IWAD path, or pixels.

Record the generated WASM size/hash and manifest path. Compare the hash with the
preflight reference `cc86ed8884ec04dbace3c541e8528a9f91839b79816cc79ce988af939d42dcb8`
(360,156 bytes), without treating it as a fixed requirement for modified engines.
See [verification record](../docs/doom-m4b-verification.md) for what was actually
run. Builds/static inspection do not establish Chrome or native runtime success.

## Static checks and source boundary

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
