# Local-only Doom/WASM build

Checkpoint 1 implements infrastructure only. Real compilation and two clean
builds require separate Checkpoint 2 authorization. The historical shareware
baseline and this profile are **not A1 acceptance**.

After build authorization, run from the repository root:

```sh
python3 scripts/build_doom.py \
  --profile upstream-shareware \
  --embed-wad assets/doom-shareware-20261009T173326Z-bffb50/DOOM1.WAD \
  --embed-sha256 1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771 \
  --out references/doom.wasm/build/repro-1 \
  --jobs 2
```

This local experiment embeds existing shareware v1.9: 4,196,020 bytes, IWAD
header, 1,264 valid directory entries and the SHA-256 above. Neither the asset
nor generated WASM is authorized for public distribution. Nothing is downloaded.

## Inputs and ownership

Use the tested macOS tools: Python 3.14.4, GNU Make 3.81 at `/usr/bin/make`,
WASI SDK 24.0 (Clang/LLD 18.1.2), Binaryen 119 and Node 22.20.0.
Defaults are `tools/wasi-sdk-24.0/` and `tools/binaryen-119/bin/`;
`--wasi-sdk`, `--binaryen-bin` and `--node` select existing installations with
the same versions. Required SDK headers, libc/libm, reactor startup and compiler
builtins must exist; their identities are recorded. These are focused local
checks, not publisher-signature verification or a complete sysroot inventory.

Python validates assets and supplied/resolved paths, invokes Make and Node, and
writes one result manifest. Assets must be ignored; output must be a new ignored
directory beneath `references/doom.wasm/build/`, without symlink ancestors.
There is no clean, overwrite or retry option. Paths permit only ASCII letters,
digits, `_`, `.`, `/`, `@`, `+` and `-`, excluding Make/shell metacharacters.
Ambient Make/compiler flags, Node/Python options and credentials are excluded
from the recorded child environment. Portability beyond this host is unproved.

Make owns source lists, flags, dependencies, reactor linking and every WAT/
Binaryen transformation, including constants merge and final copy. The unchanged
generator uses one stamp; both C/header outputs must be nonempty before touching
it. Embedded-object header ordering, local layout and `-MMD -MP` are retained.
Python does not parse or duplicate the graph. The selected mode permits only
`local-build` and excludes download, Docker, venv/pip, SSH/CMake bootstrap,
Rust, example, hook and cleanup rules. Missing inputs fail.
Legacy `all`, `doom`, example, dev-init, clean and hook targets retain their
side effects and require separate authorization; use the Python entrypoint.

## Limits and interruption

Jobs are bounded to 1–2. The default deadline is 120 seconds, including admission
and verification; `--timeout` can reduce it. At least 512 MiB free disk is required
before output creation. **There is no 512 MiB quota, per-file limit or continuous
storage monitoring:** a run can exceed that amount. Retained file byte lengths
are measured once before the final manifest write, not peak storage/allocation.

SIGINT/SIGTERM handlers record pending cancellation during child launch.
After `Popen` returns, registration precedes raising cancellation. Supervised
failure, cancellation or deadline triggers TERM, then KILL to the owned process
group and reaping. Normal cancellation returns 130/143; prior handlers are
restored. Cleanup allows up to 5.1 seconds beyond the deadline.
A permanently blocked `Popen` constructor is outside this guarantee; deadline
checks also cannot preempt blocked filesystem calls.

The host must permit owned-group signaling and tools must remain in that group.
Permission denial reports cleanup failure and attempts direct-child termination
without claiming descendant cleanup. Wrapper SIGKILL and detached descendants
are outside the guarantee. There is no capability probe or sandbox fallback.
Mocks do not prove live signaling.

## Evidence and comparison

Each fresh output retains `evidence/manifest.json`, Make stdout/stderr, version
and inspection logs, and `evidence/sources/` with the local source patch and
entrypoint copies. The manifest records HEAD/status, focused source/tool
identities, exact Make argv/cwd/environment, asset identity, final size/hash,
typed interface, duration and success/failure. Failures after output creation
preserve partial files and an atomic failure manifest when possible.
Verbose Make logs retain effective commands and warnings; they are **not
structured captured argv for each compiler subprocess**.

Sources, assets and tools are trusted local inputs and must stay unchanged during
a run. Closeout re-resolves executable invocation paths and compares admitted
targets/digests, detecting persistent changes rather than transient swaps.
There is no general filesystem audit or normalization layer.

Only the final copied module can yield `BUILD PASS`, after Node validates it and
checks ten function imports, four legacy control exports, memory, fourteen
immutable `i32` key globals, signatures and absence of a start section.
The bounded inspector reports memory/table limits and globals; unsupported forms
fail. It never instantiates or calls exports; code/data remain opaque.

For separately authorized comparison, use fresh `repro-1` and `repro-2` outputs.
Compare input/configuration/tool identities and typed interface, accounting for
output paths and timestamps; compare final SHA-256 separately. Debug paths and
`__FILE__` can affect bytes. Procedural reproducibility does not imply byte
equality; two equal hashes establish equality only for those runs.
Investigate unexplained differences. Engine initialization, zero-tic behavior,
rendering, external WAD loading and Worker containment remain unverified.
The future no-embed A1 profile requires separate implementation/authorization;
historical compiler warnings remain a separate source-review concern.

## Fixture checks

```sh
DOOM_BUILD_PROCESS_INTEGRATION=0 PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests -p 'test_build_doom.py' -v
node --check scripts/inspect_doom.mjs
git diff --check
```

Tests use temporary synthetic files, mocked tools/processes and inert WASM
metadata, never real Make builds, generation or instantiation. Live group cleanup
integration is skipped by default; enable only with separate authorization on a
permitted host. A skip is not a pass. Actual GNU Make 3.81 graph execution and
two-build reproducibility remain Checkpoint 2 gates. No tool bootstrap or cache.
