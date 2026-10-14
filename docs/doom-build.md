# Local-only Doom/WASM build

`engine/doom/` is the maintained native source. From the repository root, after
provisioning tools and installing the locked frontend dependencies as described
in the [app guide](../app/README.md#prerequisites-and-clean-checkout), use:

```sh
./build.sh
```

The Bash wrapper checks Worker packaging, uses `scripts/build_engine.mjs` for
admission, runs GNU Make in the foreground, then uses Node for closeout and
staging. This supported fresh-build path requires **no Python**. It selects
`controlled-title`, native fixtures enabled and two jobs, and embeds **no WAD**.
Each native build uses a fresh
`engine/doom/build/m4b-runs/run.*/engine/` output. Make owns compilation and WAT/
Binaryen transformations; `scripts/inspect_doom.mjs` checks the final interface.

`scripts/stage_web.mjs` verifies the successful receipt, engine input
fingerprint and exact WASM bytes/interface before staging `doom.wasm`, sanitized
`doom-build.json` and license notices in ignored `app/public/`. Vite packages the
app-owned `app/src/worker.ts` as an ES module Worker and copies static assets to
`app/dist/`; emitted WASM identity and absence of `.wad` files are checked.
The candidate and staged `public` are verified before atomically publishing the
current selection. Current means a verified native engine, not a successful
frontend build; a subsequent Vite failure still makes `build.sh` exit nonzero.
The browser reads the user's locally selected IWAD; none is shipped. Best-effort
compatibility requires verified Doom E1M1 preparation; see the
[local IWAD support boundary](../app/README.md#local-iwad-support).

`./build.sh --frontend-only` reuses the artifact selected by
`engine/doom/build/m4b-current.json`. It never compiles the engine or falls back
to another output. Missing evidence, changed engine inputs or mismatched bytes
require a separately authorized full build; a fresh checkout cannot use this
mode first. The fingerprint covers all tracked/unignored engine files plus
`build.sh`, `scripts/build_engine.mjs`, `scripts/stage_web.mjs` and the inspector,
so even removing unused vendored examples invalidates reuse.
Frontend-only reuse does not probe or require installed
compiler tools. Old Python receipts are not adopted: run one full build with the
new schema. Existing artifacts are left in place. See [vendor provenance](doom-vendor-provenance.md).

Historical ignored receipts under `references/doom.wasm/build/` are unavailable
in this checkout and cannot be recovered from Git. This guide describes the
current build route; historical stage gates do not add MVP acceptance criteria.
Agent execution requires the approvals specified in [AGENTS.md](../AGENTS.md).

## Inputs and ownership

Use Bash (macOS 3.2 syntax) and the pinned macOS toolchain: GNU Make 3.81 at
`/usr/bin/make`, WASI SDK 24.0 (Clang/LLD 18.1.2), Binaryen 119 and Node 22.20.0/npm.
Defaults are `tools/wasi-sdk-24.0/` and `tools/binaryen-119/bin/`;
`WASI_SDK` and `BINARYEN_BIN` select existing installations with the same versions.
Node/npm are selected from PATH. Required SDK headers, libc/libm, reactor startup and compiler
builtins must exist; their identities are recorded. These are focused local
checks, not publisher-signature verification or a complete sysroot inventory.

Node validates supplied/resolved tool paths and creates fresh ignored output
without symlink ancestors. It records a schema-1 `PENDING` manifest before Make;
this satisfies Make's existing `LOCAL_ADMITTED`/manifest guard, not staging's
success requirement. Bash retains the admission digest and canonical tool paths.
There is no clean, overwrite or retry option. Make paths permit only ASCII letters,
digits, `_`, `.`, `/`, `@`, `+` and `-`; parent-traversal segments are rejected.
Make runs under `env -i` with fixed PATH/locale/timezone, run-local TMPDIR and
`BINARYEN_CORES=2`. Inherited Make/compiler flags and credentials are excluded.
Node's tool, Git and inspector children also receive a fixed environment.
Portability beyond this host is unproved.

Make owns source lists, flags, dependencies, reactor linking and every WAT/
Binaryen transformation, including constants merge and final copy. The historical
shareware profile's generator uses one stamp; both C/header outputs must be
nonempty before touching it. That generator is not run by the app's controlled
profile. Embedded-object header ordering, local layout and `-MMD -MP` are retained.
Neither Bash nor Node duplicates the graph. The selected mode permits only
`local-build` and excludes download, Docker, venv/pip, SSH/CMake bootstrap,
Rust, example, hook and cleanup rules. Missing inputs fail.
Legacy `all`, `doom`, example, dev-init, clean and hook targets retain their
side effects and require separate authorization; use `./build.sh` for the app.

## Limits and interruption

The supported build fixes Make to `-rR -j2`, `A1_FIXTURES=1` and explicit SDK/
Binaryen paths. There is no global 120-second timeout, watchdog or process-tree
supervisor. The existing static inspector subprocess retains its 10-second limit.
The old 512 MiB free-space admission and recursive output-size accounting are
omitted; neither was a storage quota.

Ordinary terminal Ctrl+C is intended to interrupt foreground Make and its recipes.
Shell INT/TERM traps exit 130/143 rather than continue; Make failure exits before
closeout, staging or Vite. Pending evidence cannot stage or become current.
The owner reports Ctrl+C stopping compilation in a real macOS terminal. This is
an owner observation, not a Codex-run signal test or a general process-cleanup proof.
Bash can defer a trap while waiting for a foreground command. Wrapper-only
SIGTERM/SIGKILL, detached descendants and hung tools have no cleanup guarantee;
manual intervention may be needed. Diagnose observed failures before adding
supervision.

## Evidence and comparison

Each admitted output retains `evidence/manifest.json` and `evidence/local.patch`.
After Make returns zero, Bash writes `evidence/make-pass` with the admission digest;
closeout requires that matching marker as well as the pending receipt.
The compact receipt records the fixed profile, fixture/no-IWAD settings, input
fingerprint, HEAD/status, tool versions and executable/SDK identities, selected
paths, jobs and sanitized Make environment. Exact Make arguments remain readable
in the fingerprinted `build.sh`; verbose compiler commands go to the terminal.
Separate Make/version/inspection logs, entrypoint copies, duration and recursive
size accounting are not retained. The Git patch covers tracked changes in the
fingerprinted scope; untracked additions are hashed but not a complete source archive.

Only after Make returns zero does Bash invoke closeout with the admission digest.
Closeout requires that matching pending receipt, runs the inspector, compares
final byte identity, rechecks source and tool/SDK inputs, then atomically writes
`BUILD PASS` with the final size/hash and typed interface. Failures need no special
failure rewrite: missing/pending receipts remain rejected. The helpers are parts
of the trusted local build flow, not signatures. Do not fabricate success markers
or manually close out a failed run.

Sources and tools are trusted local inputs and must stay unchanged during a run.
Closeout re-resolves invocation paths and compares targets/digests, detecting
persistent changes rather than transient swaps. There is no general filesystem audit.

Only the final copied module can yield `BUILD PASS`, after Node validates it and
checks the profile's exact interface and absence of a start section. The app's
fixture-enabled controlled profile has nine function imports, seven function
exports, memory and fourteen immutable `i32` key globals. The functions are
`initControlled`, `renderControlled`, `prepareE1M1Controlled`,
`stepNeutralControlled`, `a21ReadObservation`, `a1ReadCounter` and
`a1WasiInitCount`; their signatures are checked by the inspector. The legacy
shareware profile instead has ten imports and four control-function exports.
The bounded inspector reports memory/table limits and globals; unsupported forms
fail. It never instantiates or calls exports; code/data remain opaque.

For separately authorized comparison, use two fresh `./build.sh` runs.
Compare input/configuration/tool identities and typed interface, accounting for
output paths and timestamps; compare final SHA-256 separately. Debug paths and
`__FILE__` can affect bytes. Procedural reproducibility does not imply byte
equality; two equal hashes establish equality only for those runs.
Investigate unexplained differences. Static inspection and builds do not establish
native or browser runtime behavior. The [app guide](../app/README.md#prototype-acceptance-and-evidence)
separates owner-reported browser/API observations from checks and uncollected proof.
Historical compiler warnings remain a separate source-review concern.

## Build evidence and follow-up

The owner reports successful `./build.sh` and `./build.sh --frontend-only` runs:
fixture-enabled WASM, verified `public`/`dist`, no bundled IWAD, and the same WASM
SHA-256 on reuse. The owner also reports Ctrl+C stopping compilation in a macOS
terminal. These are owner-run observations, not Codex-run checks. A focused static
review found no actionable correctness regressions; no runtime tests were run by
that review. The owner skipped deliberate compilation failure for this milestone.

After cleanup, the owner will rerun `./build.sh` followed by
`./build.sh --frontend-only`; changed fingerprint inputs require a fresh full build
first. Agent execution still requires the approvals in `AGENTS.md`.

## Verification coverage

The optional Python native-contract and synthetic WASM inspector test suites are
retired. Their independent stepping/timer/source-contract and positive/negative
WASM regression coverage is intentionally removed, not replaced by successful
builds or the direct inspector invocation. `scripts/inspect_doom.mjs` still verifies
the actual generated WASM during closeout and staging. The app's offline Vitest
suite remains available through the
[app checks](../app/README.md#offline-tests-static-checks-and-source-boundary).

## Historical embedded-shareware profile

The historical Make profile and Python embedded-file generator remain outside the
supported app build. Their old wrapper entrypoint has been retired; no replacement
historical build command is provided. Legacy targets still require separate
authorization, and their admission guards must not be bypassed.
