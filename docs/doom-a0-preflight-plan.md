# Stage A0 preflight plan — UNAPPROVED

## 1. Purpose and non-goals

**All execution approvals are PENDING. A0 preflight was NOT executed.** This document plans [Issue #2](https://github.com/mikechao/doom-decisons/issues/2) using the owner's supplied scope; no issue was fetched. A successful, separately authorized A0 establishes readiness to **request A1 authorization**, not permission to begin A1.

Architecture and stage boundaries remain in the [feasibility investigation](doom-wasm-feasibility-investigation.md), [committed control design](doom-control-contract-design.md), and [Stage A plan](doom-stage-a-plan.md#5-bounded-experiment-sequence-and-gates). A0 resolves three execution prerequisites: asset admission, native tool usability, and local-file Worker feasibility. Durable source ownership is already settled by the completed root-tracked vendor import below. A0 does not compile/run Doom, prove asset compatibility, exact stepping, neutral-first, initialization/render isolation, or any compiled Doom invariant. No Decisions calls, application, production harness, CI, or public distribution belong to A0.

## 2. Verified baseline vs assumptions

**OBSERVED pre-vendoring baseline, local read-only inspection on 2026-10-08:**

| Item | Value |
| --- | --- |
| Root | `/Users/mike/projects/doom-decisons`; branch `main`; HEAD `a1928c5731d0def4532691b216b604fd442c6a1d` |
| Initial worktrees | Root and submodule `git status --short` both empty; no pre-existing changes |
| HEAD gitlink / index stage-0 gitlink / submodule HEAD | All **`31cc1af9656a8184830090c4e9f268383f5d7e15`**; submodule branch `master` |
| Root origin, fetch and push | `https://github.com/mikechao/doom-decisons.git` |
| `.gitmodules`, root configured submodule URL, submodule origin fetch/push | `https://github.com/jacobenget/doom.wasm.git`; no project remote configured |
| Engine tree | Ordinary tracked `doomgeneric/`, tree `20a2f2cb40e7892af506897fe1efec7ecef71350` |
| Documents | Root `AGENTS.md` and planning documents inspected; no issue contents inferred beyond the supplied scope |
| Local Issue #2 contents | No copy found in the root file inventory/text search; use supplied scope, not inferred issue wording |
| Host/tools | Darwin arm64; installed Python 3.14.4 at `/opt/homebrew/bin/python3`, Node v22.20.0 at `/Users/mike/.nvm/versions/node/v22.20.0/bin/node`; Git, Make, curl, Apple clang found on PATH |
| Tool/browser gaps | `wasm-as`, `wasm-merge`, `wasm-metadce`, `wasm-dis`, `gpg` not found on PATH. Chrome plist exists at `/Applications/Google Chrome.app/Contents/Info.plist`, version `154.0.8037.98`; not launched |
| Absent output/setup | Root `package.json`, `node_modules`, `experiments`, `.a0-preflight`; vendored tree `build`, `.binaryen`, Python/Rust virtual environments, browser `assets/doom.wasm` |
| Checked-in Freedoom2 | 28,787,748 bytes; header `IWAD`, 3,610 directory entries, directory offset 28,729,988; SHA-256 `a8772e088847032510d97ba2312406a6998f21cbab44d4ff10696faa9c0ecd4b`. **NOT APPROVED**; release/notices and compatibility unresolved |

**OBSERVED source only:** pinned `Makefile` names WASI SDK 24/Binaryen 119. `all -> doom` invokes Docker; missing Binaryen triggers SSH clone/native build; embedded generation creates a Python environment and pip installs. `Makefile:174,258–269` downloads/embeds `DOOM1.WAD`; `src/doom_wasm.c:7,79–116` includes/copies the fallback. The browser example supplies no external WAD and starts an HTTP server through its Makefile. Pre-commit hooks can regenerate requirements/interface and trigger setup/builds. These are reasons to bypass those entry points, not runtime evidence.

**PROPOSED:** external official Freedoom 0.13.0 Phase 1; workspace-local SDK 24.0/Binaryen 119 arm64 macOS; installed Chrome and one local HTML file.

**UNVERIFIED:** current release endpoints/redirects, package sizes/content/hashes, signer trust, full release source commits, native package usability, and file-origin Worker behavior. No external claim was revalidated over the network.

**Vendor layout, locally verified and staged on 2026-10-08:** `references/doom.wasm/` is represented by ordinary root index entries. Its staged subtree has tree ID `18ad13ab35135c607015fb645dd8bbdc4f69f473`, equal to the pinned source commit's tree; all 229 paths, modes, object types, and blob IDs match. There is no `160000` entry or nested `.git` pointer, and `.gitmodules` was removed. This import is staged for owner review and is not committed or published. A0 remains unexecuted.

## 3. Owner decisions and authorization matrix

No approval is inferred from this plan or the documentation task. Each later approval must identify its batch, exact scope and evidence reference. Dependencies below restrict execution even if several batches are approved together.

| Batch / status | Specific owner decision and permission required |
| --- | --- |
| P0 — **PENDING** | Accept A0-only readiness scope, external Phase 1/local-only asset policy, prospective A1 no-embedded-shareware profile, and ceilings in §5. No public asset/WASM delivery, embedding, or proprietary shareware acquisition |
| W0 — **PENDING** | Create fresh root `.a0-preflight/<approved-run-id>/` only, containing downloads, assets/notices, tools, smoke, browser/profile/results and evidence. Approve generated files, subprocess temporary/cache paths confined there where configurable, cleanup and hash-checked reuse; no overwrite of prior runs or tracked files. The source tree is read-only during A0; no Git replay area or source checkout is needed |
| N1 — **PENDING** | Retrieve only §5 official asset/tool URLs and bounded publisher metadata, including release/tag full source identity and license/credits. Approve per-file destinations/byte limits, TLS redirect policy and logs; no credential-bearing URLs or arbitrary redirects |
| AS1 — **PENDING** | Choose asset assurance: authenticated publisher signature with independently trusted fingerprint and an already installed verifier, or explicit acceptance of publisher HTTPS + matching CHECKSUM with signature authentication unresolved. Approve inspected ZIP extraction/static IWAD checks and notice retention. No signature tooling installation |
| T1 — **PENDING** | Accept SDK provenance assurance if no publisher checksum/signature is available; Binaryen publisher SHA-256 must match. Approve inspected archive extraction only after hashes/inventory pass; local hashes alone do not authenticate publishers |
| X1 — **PENDING** | Execute exact extracted SDK `clang`, `wasm-ld`, `llvm-ar` and Binaryen `wasm-as`, `wasm-merge`, `wasm-metadce`, `wasm-dis` paths after archive/inventory/hash review; check versions before §4's tiny compile/assemble/merge/metadce/inspection. Approve installed Node to validate/instantiate that tiny module. No quarantine removal, global install, or Doom compilation |
| B1 — **PENDING** | Launch installed Chrome with a dedicated disposable workspace profile, load only the generated local HTML/Blob Worker, approve profile/OS launch side effects and local JSON/screenshot downloads. No browser navigation/network allowance follows; use an owner-approved offline arrangement if background network cannot otherwise be excluded |
| V0 — **COMPLETE, local** | The pinned source tree is root-tracked and its staged tree matches the pinned Git tree exactly. At a later A0 run, recheck the committed root subtree and ordinary file entries using WP1. This layout decision grants no A0/A1 execution permission; the owner reviews and handles any root commit or push |

## 4. Ordered A0 work packages

**Every command and pseudocommand in this section is PROPOSED / NOT EXECUTED.** Approval gates are mandatory. `$ROOT` denotes the observed root; `$PIN` the full verified SHA above; `$A0` the approved fresh absolute run directory. Assign task variables only; never redefine HOME or CODEX_HOME. Use absolute installed tool paths recorded at run start and stop on unexpected resolution. Capture commands, exit codes, elapsed time, stdout/stderr and effects in `$A0/evidence/`.

### WP0 — authorize, recheck, isolate

**Prerequisites:** P0/W0. Recheck before any mutation:

```sh
git -C "$ROOT" branch --show-current
git -C "$ROOT" rev-parse HEAD
git -C "$ROOT" status --short
git -C "$ROOT" ls-tree HEAD references/doom.wasm
git -C "$ROOT" ls-files --stage references/doom.wasm
git -C "$ROOT" remote -v
git -C "$ROOT" rev-parse HEAD:references/doom.wasm
test ! -e "$ROOT/references/doom.wasm/.git"
test ! -e "$ROOT/.gitmodules"
```

Pseudocommands: compare root identity and the vendored subtree with §2 and the provenance record; confirm there is no gitlink, nested .git pointer, or submodule declaration; confirm run path absent/non-symlink; create run directory exclusively, then its named subdirectories; record approval references and resource ledger. Set subprocess TMPDIR to an existing directory inside the run area; inspect/configure any other cache writes before execution.

**Effects/evidence:** workspace directories and baseline/approval ledger only. **PASS:** root identity is explained, the committed vendor subtree equals the recorded pin tree, ordinary tracked files are present, and the run location is exclusive. **STOP:** unexplained root identity/tree change, unrelated dirty paths or unsafe output location; preserve existing work. **Recovery:** retain ledger; remove only this run's empty directories or resume with explicit reconciliation, never reset/clean the repository.

### WP1 — verify root-tracked source reproducibility

**Prerequisites:** WP0. The vendor layout is complete; this package is a read-only acceptance check before asset/tool transfers. The root commit used for A0 must contain ordinary tracked files at the recorded pin tree:

```sh
git -C "$ROOT" ls-tree HEAD references/doom.wasm
git -C "$ROOT" rev-parse HEAD:references/doom.wasm
git -C "$ROOT" ls-files --stage references/doom.wasm
test ! -e "$ROOT/references/doom.wasm/.git"
test ! -e "$ROOT/.gitmodules"
```

Compare the resulting tree ID with `18ad13ab35135c607015fb645dd8bbdc4f69f473`. Also compare the recursive path/mode/object/blob manifest with the pinned tree; this confirms no tracked paths were added or omitted. **Effects/evidence:** read-only Git/tree checks only. **PASS:** the root commit contains the exact vendor tree, every source path is an ordinary tracked file, and no submodule metadata or nested Git pointer remains. **STOP:** any tree mismatch, gitlink, missing file, or unexplained source change. Do not repair by refreshing upstream or excluding files.

Subsequent Doom source, adapter, and build changes are ordinary root-repository changes under `references/doom.wasm/`. The owner reviews and commits/pushes them through the root repository. No fork, engine branch, patch-series replay, submodule commit, or gitlink update is part of this workflow.

### WP2 — publisher evidence and Phase 1 static admission

**Prerequisites:** WP1, N1/AS1. Use publisher metadata first to record release/tag source commit, candidate sizes and notices. Set exact URL/output rows from §5; reject missing or over-budget sizes before package transfer. Proposed download template (bounded transfer pseudocode must enforce the byte/time ledger even for chunked responses; no generic downloader project):

```sh
curl --fail --proto '=https' --proto-redir '=https' --max-redirs 3 \
  --connect-timeout 15 --max-time 180 --max-filesize "$APPROVED_FILE_BYTE_CAP" \
  --dump-header "$A0/evidence/asset-headers.txt" \
  --output "$A0/downloads/freedoom-0.13.0.zip.part" "$APPROVED_ASSET_URL"
```

Pseudocommands: retrieve CHECKSUM/signature/tagged notices similarly into distinct files; resolve redirects one hop at a time, checking §5 before following (no unchecked `curl -L`); hash completed archive; parse publisher CHECKSUM's stated algorithm and compare the exact archive entry. Use an already approved verifier/key fingerprint for signature verification if available. Otherwise retain signature bytes/hash, mark authentication UNVERIFIED and require the chosen assurance acceptance before admission. Preserve TLS metadata and full tagged source SHA; a tag name/local hash is not independent authentication.

Use installed Python standard library `zipfile` to inventory names, compressed/uncompressed sizes, CRCs, duplicate names, path types and total expansion **before extraction**. Reject absolute/traversal paths, symlinks/special files, duplicate/case-colliding destinations, encrypted entries, excessive expansion or unexpected bundled material. Stream only selected `freedoom1.wad` and license/credits/manual notices into fresh `$A0/assets/` paths; validate CRCs and actual lengths. Do not extract or admit Phase 2 for A0. Compare archive notices with tagged COPYING/CREDITS and retain all applicable conditions/disclaimers; record exact filenames/hashes and discrepancies.

Static WAD checker pseudocode (Python `struct`/`hashlib`, no game execution):

```text
require 12 <= file length <= approved IWAD cap (proposed 64 MiB)
unpack little-endian <4sii: magic, lump count, directory offset
require magic == IWAD; 0 < count <= 100000; directory offset >= 12
require offset + 16*count <= file length (wide checked arithmetic)
for every <ii8s directory entry:
  require nonnegative position/size; position+size <= file length
  zero-sized markers are permitted; preserve raw/normalized names and order
report duplicate names, overlaps/aliases and trailing data; review anomalies
require unambiguous E1M1, E1M2 and E1M8 map blocks
require THINGS, LINEDEFS, SIDEDEFS, VERTEXES, SEGS, SSECTORS,
        NODES, SECTORS, REJECT, BLOCKMAP in native map-directory order
record E3M1/E4M1/MAP01 markers (Phase 1 identity sanity check)
record FREEDOOM, PLAYPAL, COLORMAP, PNAMES, TEXTURE1, sprite/flat ranges
record presence/hash/length of DEHACKED and any extra map-format markers
emit complete directory/static findings, IWAD length/SHA-256 and map selection
```

**Effects/evidence:** archive/metadata/notices, admitted external IWAD and static JSON only. **PASS:** publisher checksum matches, accepted assurance is recorded, terms/notices agree, inventory is safe, header/directory/map checks pass, anomalies resolved. Select E1M1 at fixed skill 2 (Doom's second skill) for later review; E1M2/E1M8 remain later compatibility fixtures. **STOP:** missing/mismatched checksum/terms, unresolved signer assurance, malformed/ambiguous maps or disallowed bytes; never substitute proprietary shareware or checked-in Freedoom2. **Cleanup:** preserve failure evidence/hashes; discard only incomplete/rejected run-owned files, never silently reuse them.

Residuals: static shape/resources do not establish rendering, map semantics, save-buffer safety or gameplay compatibility. The pinned port warns about Freedoom; IWAD DeHackEd loading is compiled out and FEATURE_DEHACKED is undefined. Record patch-content risk; no A0 engine feature/map repair. **A1 alone** may implement the additive profile removing shareware prerequisites/generated header/C/object and adapter fallback, with bounded missing-asset rejection. A0 only records that design requirement; compiled absence of embedded data remains unproven.

### WP3 — native tool inventory, then one throwaway smoke pipeline

**Prerequisites:** WP2 green, N1/T1; X1 before any downloaded executable is invoked. Download exact SDK/Binaryen archives/checksum with the same bounded/redirect-reviewed process. Record SHA-256 for archives, executable files and bundled notices. Compare Binaryen publisher `.sha256`; establish SDK publisher checksum/signature if its approved metadata supplies one, otherwise explicitly accept the documented HTTPS/hash assurance gap. No guessed digest.

Pseudocommands: inventory tar members using installed Python `tarfile`; apply WP2's path/type/collision/expansion checks. Reject device/FIFO/hardlink entries; allow relative symlinks only if fully resolved targets remain inside the isolated package (SDK layout may require them). Extract safely into separate `$A0/tools/wasi-sdk/` and `$A0/tools/binaryen/` directories, preserving only reviewed executable modes and contained symlinks; never execute archive scripts. Require native arm64 executables and packaged sysroot/headers/libc/libm/wasm32 compiler runtime. Record archive root layout; derive absolute `$SDK`, `$BIN`, `$SYSROOT` from the inventory, not assumed directory names.

```sh
"$SDK/bin/clang" --version
"$SDK/bin/wasm-ld" --version
"$SDK/bin/llvm-ar" --version
"$SDK/bin/clang" --print-resource-dir
"$SDK/bin/clang" --target=wasm32-unknown-wasi --sysroot="$SYSROOT" -print-file-name=libc.a
"$SDK/bin/clang" --target=wasm32-unknown-wasi --sysroot="$SYSROOT" -print-file-name=libm.a
"$BIN/wasm-as" --version
"$BIN/wasm-merge" --version
"$BIN/wasm-metadce" --version
"$BIN/wasm-dis" --version
```

Check returned library/resource paths exist inside the SDK and record SDK release/VERSION metadata if shipped. SDK 24 is a distribution release, not a requirement that clang report version 24. Binaryen reports 119; unexpected architecture/version/path is STOP. Review `--help` from approved tools to confirm the following switches before use; changed syntax needs a reviewed correction, not alternate tooling.

Create **throwaway** `$A0/smoke/probe.c`, `wrap.wat`, `roots.json` with these contents:

```c
#include <stdlib.h>
#include <math.h>
int probe(void) {
  volatile double *p = malloc(sizeof *p);
  if (!p) return -1;
  *p = 81.0;
  double r = sqrt(*p);
  free((void *)p);
  return (int)r;
}
int unused(void) { return 123; }
```

```wat
(module
  (import "core" "_initialize" (func $init))
  (import "core" "probe" (func $probe (result i32)))
  (func (export "smoke") (result i32) (call $init) (call $probe)))
```

```json
[{"name":"outside","root":true,"reaches":["keep-smoke","keep-memory"]},
 {"name":"keep-smoke","export":"smoke"},
 {"name":"keep-memory","export":"memory"}]
```

```sh
"$SDK/bin/clang" --target=wasm32-unknown-wasi --sysroot="$SYSROOT" \
  -Wall -Os -mexec-model=reactor -Wl,--export=probe -Wl,--export=unused \
  "$A0/smoke/probe.c" -o "$A0/smoke/core.wasm" -lm -lc
"$BIN/wasm-as" "$A0/smoke/wrap.wat" -o "$A0/smoke/wrap.wasm"
"$BIN/wasm-merge" "$A0/smoke/core.wasm" core "$A0/smoke/wrap.wasm" wrapper \
  -o "$A0/smoke/merged.wasm" --enable-bulk-memory
"$BIN/wasm-metadce" "$A0/smoke/merged.wasm" \
  --graph-file "$A0/smoke/roots.json" -o "$A0/smoke/final.wasm" --enable-bulk-memory
"$BIN/wasm-dis" "$A0/smoke/final.wasm" -o "$A0/smoke/final.wat"
```

Installed Node pseudocommand: read each WASM, assert `WebAssembly.validate`, capture `Module.imports/exports`; require merged `core` imports resolved, final imports empty, final exports exactly `smoke` function and `memory`, and `unused` present before metadce/absent afterward. Instantiate final bytes with `{}`, call `smoke` **once**, require result 9. Save JSON and typed WAT. Unexplained WASI imports STOP; do not add host shims to disguise failure.

**Effects/evidence:** local tools, tiny C/WAT/JSON inputs, intermediate/final WASM/WAT and logs; one compiler process, no Makefile or Doom sources. **PASS:** packaged compiler/linker/sysroot and all Binaryen stages work within limits; actual validation/export removal/result 9 observed. This is tool usability only, not the full Doom transformation chain. **STOP:** hashes/version/architecture mismatch, blocked execution, missing libraries/tools, unexpected imports, crash or resource limit. No security attribute removal/install/Docker fallback. **Cleanup/reuse:** retain manifests/logs/input/output hashes, remove throwaway outputs after recording; verified tools/assets may be reused for authorized A1 only after rehashing. Failure never licenses a retry loop or package substitution.

### WP4 — installed Chrome, local-file Blob Worker only

**Prerequisites:** WP3 green, B1. Create one self-contained `$A0/browser/worker-check.html`, no external scripts/assets/fetches. Use embedded classic Worker text in `new Blob([text], {type:'text/javascript'})`, `URL.createObjectURL`, `new Worker(url)`; add error/messageerror listeners and revoke URLs on disposal. Launch pseudocommand: installed Chrome, dedicated `$A0/browser/profile`, no first-run/sync/extensions/background-network features, exact `file://` URL generated from the HTML path. Flags are not a network isolation guarantee; honor the approved offline arrangement. No file-access security override or server.

Page algorithm:

1. Display 50 ms main-thread heartbeat, max gap and a click counter; allocate 16-byte buffer with known pattern and operation ID. Worker receives buffer, verifies bytes and echoes ID/buffer using transfer lists. Require immediate sender detachment (`byteLength == 0`), intact returned bytes and matching ID within 2 s; record Worker start/receipt/round-trip times.
2. Dispose that Worker. Create a separate disposable Blob Worker that replies `ready`, then enters `while (true) {}` only upon explicit `hang` message. Start a main-thread 2 s watchdog after `ready`; terminate from the page, invalidate its ID and report termination/error within the next 250 ms target. No timer inside the hung Worker is used.
3. During hang and after termination, click the counter and observe heartbeat/paint. Require no attributable gap >250 ms in a visible foreground page; record all gaps rather than hiding outliers. Create one fresh echo Worker afterward and repeat round trip to demonstrate recovery. Terminate it; no background survivors.

**Effects/evidence:** HTML, disposable Chrome profile, ordinary approved OS launch state and local evidence downloads. Save page JSON (Chrome version/user agent, file origin, input hash, events/IDs/timestamps, transfer lengths/content checks, heartbeat gaps, watchdog/fresh-Worker outcomes), plus screenshot of results and clicks. Save through a file picker into `$A0/browser/results/`, not an implicit general Downloads path; record manual observations and errors. Page has no Doom/WASM/IWAD input and no product UI.

**PASS:** actual file/Blob Worker creation, transfer round trip, hung-worker disposal, main-thread responsiveness and fresh-worker recovery all observed. `terminate()` has no completion receipt: evidence is the call/timing, responsive page, no further accepted messages and successful recovery, not a fabricated Worker acknowledgment. **STOP:** file-origin/CSP policy failure, browser execution requirement outside approval, attributed UI freeze or deadline failure. Stop for a new owner decision; never silently start a server, install Playwright or launch another browser. **Cleanup:** terminate all Workers/revoke URLs, close only this Chrome instance, retain JSON/screenshot/profile disposition; delete disposable profile only once closed under W0.

### WP5 — reconcile evidence and request review

**Prerequisites:** all four prerequisites have positive evidence and required approvals. Pseudocommands: complete §6 manifest; rehash retained assets/tools; record actual resource totals and all Git/status changes versus baseline; run nonmutating document/manifest checks. **Effects:** evidence/disposition only. **PASS:** §7 satisfied; **BLOCKED:** missing approval/provenance/persistence decision; **FAIL:** attempted check contradicted its positive criterion. Never label static source inspection a runtime pass. Preserve failure evidence and narrow next decision; no automatic repair/expansion. Cleanup is confined to this run's reviewed generated paths, with no `git clean`, reset, bulk removal of prior runs or upstream `make clean`.

## 5. Allowlist and safety envelope

**PROPOSED URLs, NOT fetched or newly verified here**, copied from [Stage A §3](doom-stage-a-plan.md#3-minimal-toolchain-artifact-and-worker):

| Input | Exact URL |
| --- | --- |
| Phase 1 archive | `https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip` |
| Publisher checksum | `https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0-CHECKSUM` |
| Archive signature | `https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip.sig` |
| SDK archive | `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-24/wasi-sdk-24.0-arm64-macos.tar.gz` |
| Binaryen archive | `https://github.com/WebAssembly/binaryen/releases/download/version_119/binaryen-version_119-arm64-macos.tar.gz` |
| Binaryen checksum | `https://github.com/WebAssembly/binaryen/releases/download/version_119/binaryen-version_119-arm64-macos.tar.gz.sha256` |

Permitted publisher metadata after N1: matching release/tag/expanded-assets pages and release/tag/source-commit metadata in those three repositories; Freedoom `v0.13.0` COPYING/CREDITS/manual notices; SDK `wasi-sdk-24` README/license/version and Binaryen `version_119` license/version. Pin full commits after resolution; record mutable metadata retrieval times/hashes. Associated GitHub API/raw.githubusercontent.com routes must stay within these exact repositories/tags/files. Signature-key provenance needs its exact trusted source approved; no arbitrary keyserver.

Permit HTTPS release-asset redirects only to GitHub's release delivery endpoints (release-assets.githubusercontent.com or objects.githubusercontent.com) after hop review; record Location/effective URL and stop on other destinations, TLS downgrade or changed package. No Git remote, fork, branch, or publication traffic is part of A0's download scope. No alternate package, download mirror or automatic fallback.

All ceilings require owner approval and remain at or below Stage A bounds: **≤300 MiB total initial downloads** (packages and metadata), **≤3 GiB total workspace storage**, **≤2 compiler jobs**, **≤15 min per individual build**, **≤60 min aggregate setup/build**. For A0 tighten to one compiler job, one tiny compile pipeline, ≤60 s per tool command, ≤5 min smoke pipeline, ≤30 min aggregate setup/build, ≤5 min browser check with 2 s watchdog. Stop before a projected cap breach; count actual bytes, expansion, elapsed setup/build and disk use. No Doom build is permitted within any allowance. Record tool/archive memory/storage estimates before extraction; unknown sizes or inability to enforce a cap blocks transfer/extraction.

Forbidden in A0: make all, dev-init, run-example_browser, any Doom build/run, Docker pulls/runs, pip/npm installs, global installs, source-built toolchains, extra browsers, Playwright, interface/pre-commit regenerators, unapproved servers/network, security-setting/quarantine changes, proprietary shareware download/embedding, and treating tracked Freedoom2 as admitted. The vendored source and root Git state remain unchanged during A0; generated A0 files stay in the specifically approved run directory. The vendor import is complete, but this plan authorizes none of the A0 execution steps.

## 6. Evidence manifest template

Future `$A0/evidence/manifest.json`; empty fields are missing evidence, never defaults to success:

```text
run: id, date/time/timezone, operator, plan/root revision, host/architecture
approvals: batch -> owner reference, exact scope, assurance choice, ceilings
git: root branch/HEAD/status and origin; root vendor subtree tree SHA;
     ordinary path/mode/blob manifest; absence of gitlink, .gitmodules entry,
     and nested .git pointer; pinned source commit and import tree SHA;
     later root commits containing source changes and reproducibility evidence
inputs[]: publisher/release/tag/full source commit, requested/effective URLs,
          redirect hops, retrieval time, sizes, publisher algorithm/value,
          computed archive SHA256, signature result/trusted fingerprint/source,
          inventory/path/expansion checks, accepted assurance/residual gap
notices[]: license/credits/manual source URLs, archive paths, retained paths,
           hashes, comparison results, obligations and unresolved differences
iwad: external path/name/release, size/SHA256, header/count/directory bounds,
      lump/map-marker/resource/DEHACKED findings, anomaly disposition,
      proposed mission/skill/maps, static admission and compatibility UNPROVEN
tools[]: archive+executable hashes, absolute executable/sysroot/resource/library
         paths, native architecture, actual versions, license paths/hashes
smoke: input/command/environment hashes, flags, exit codes/timings/logs,
       intermediate/final hashes, actual imports/exports/typed WAT,
       validate/metadce removal/one-call result observations
browser: installed path/version/profile, HTML hash/file origin, Worker IDs/events,
         transferred/returned bytes, heartbeat gaps/click observations,
         hang/watchdog/termination/recovery timings, errors, JSON/screenshot paths
operations[]: exact command or manual action, approval, cwd/env, start/end/exit,
              network/disk/Git/process effects and cleanup/reuse disposition
resources: transferred bytes, expanded/workspace sizes, jobs, per-command and
           aggregate durations, ceilings and any interrupted operation
residual_risks: authentication, compatibility, tool/runtime and durability gaps
disposition: assets/tools/browser/git each PASS|BLOCKED|FAIL with evidence;
             overall PASS|BLOCKED|FAIL, narrow next owner decision, A1 UNAPPROVED
```

Keep asset/tool bytes and browser profiles out of source commits/public uploads; publish only reviewed evidence permitted by the later publication policy. Retain hashes/notices locally even for failure. Do not upload private credentials, signed-download tokens or proprietary inputs in manifests/logs.

## 7. A0 exit gate and A1 handoff

Overall PASS requires a successful root-tracked vendor baseline check plus **all three** A0 execution prerequisite passes, recorded approvals and resource compliance: admitted official Phase 1 bytes with accepted provenance/notice/static evidence; actual native SDK/sysroot/Binaryen tiny-pipeline results; and actual installed-Chrome file/Blob Worker transfer/containment evidence. The vendor tree must match the pinned import tree as ordinary root files. Missing decisions remain BLOCKED; attempted technical failures remain FAIL. Present a bounded failure report instead of starting A1.

Handoff supplies the completed manifest, retained/rehashed asset/tool paths, root commit and vendor tree identity, browser evidence and the specific A1-only request linked to [Stage A A1](doom-stage-a-plan.md#a1--final-wasm-and-observable-controlled-initialization). The request must separately cover source/build-profile/adapter/WAT/export changes, final Doom builds, initialization/render/missing-asset experiments, and any root-repository changes. A0 records the no-shareware profile requirement; **A1 implements and proves it**.

Still unproven: compiled Doom imports/exports and embedded-data absence; title/init/graphics safety; selected-map/DeHackEd/save compatibility; exact tic/native consumption and wait isolation; lifecycle cleanup/PENDING/neutral-first; production control ABI and complete acceptance suite. Signature authentication remains unresolved if the owner accepted lower assurance. Distribution, extra assets/fixtures, alternate tools/servers, A1 execution, A2/A3 and B–D, Decisions integration and production delivery remain unapproved. **A0 PASS authorizes none of them.**
