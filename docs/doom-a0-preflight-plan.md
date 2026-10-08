# Stage A0 preflight plan — TECHNICAL PASS; CLEANUP PENDING

## 1. Purpose and non-goals

**Technical A0 PASS, with an owner-accepted WP4 procedural deviation; A1 is not authorized.** On 2026-10-08, the owner separately authorized and completed the bounded local WP3 toolchain preflight recorded below, and authorized WP2 Freedoom Phase 1 asset admission and WP4 Chrome Worker feasibility. WP1–WP4 technical checks passed within their stated scopes. The owner accepts the remaining WP4 evidence and network-isolation limitations for this local-only experiment: network isolation was not independently established, and the original B1 no-network restriction cannot be claimed as satisfied. This is an accepted procedural deviation, not verified compliance. The missing screenshot and complete local JSON are accepted as non-blocking evidence limitations. This document plans [Issue #2](https://github.com/mikechao/doom-decisons/issues/2) using the owner's supplied scope; no issue was fetched. A0 establishes readiness to **request A1 authorization**, not permission to begin A1.

**Owner disposition, 2026-10-08:** [A0 preflight results](doom-a0-preflight-results.md) records the four prerequisite outcomes, evidence limitations and owner acceptance. **Technical A0 PASS.** The network-isolation gap remains unverified and is not represented as satisfaction of B1; the owner accepts it as a procedural deviation. Preserve `.a0-preflight/` and both Chrome profiles for now. Before removing a profile, confirm the dedicated Chrome instance is closed; deleting scratch evidence/profile data requires separate owner authorization. Keep reusable ignored `tools/` and `assets/` for later separately authorized work. Scratch evidence is disposable storage, not a project dependency. Historical observations and prior-run dispositions below remain unchanged.

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

**Selected route and status:** official Freedoom 0.13.0 Phase 1 static admission passed for local reuse under WP2; the owner-provided workspace-local SDK 24.0/Binaryen 119 arm64 macOS toolchain passed the bounded WP3 check below; installed Chrome and one local HTML file passed the bounded WP4 feasibility check below.

**UNVERIFIED:** cryptographic authenticity of the Freedoom archive signature and tag signature; Doom/engine runtime and gameplay compatibility; compiled Doom behavior inside a Worker. WP2 records official HTTPS retrieval, exact redirect destinations, the full tagged source commit, matching publisher checksum, retained notices and static WAD findings. The owner-provided SDK and Binaryen archives, local hashes, safe inventories, native executables, and WP3 smoke pipeline are recorded below. WP3 used no network access.

**Current committed vendor baseline, rechecked at WP2 start on 2026-10-08:** branch `main`, root HEAD `d82f9eee2e7c318276a399454b1852b5fb6f7767` (also `origin/main`), and `references/doom.wasm/` tree `18ad13ab35135c607015fb645dd8bbdc4f69f473`, equal to the pinned source commit's tree. The root commit contains the 229-path tree as ordinary tracked files; there is no `160000` entry, nested `.git` pointer, or `.gitmodules`. The worktree was clean before this task. The prior WP3 `.gitignore` and plan edits described in the prompt are already committed in this HEAD; the ignored `tools/` installs and `.a0-preflight/20261008T214406Z-4aade6/` evidence were present and preserved. WP2 adds only the root-anchored `/assets/` ignore rule and the WP2 plan observations; asset bytes stay in ignored `assets/`, and this run's evidence stays in a fresh ignored `.a0-preflight/` directory. These current values supersede the historical pre-vendoring SHAs and the earlier `8b281ef...` check above.

## 3. Owner decisions and authorization matrix

No approval is inferred from this plan or the documentation task. Each later approval must identify its batch, exact scope and evidence reference. Dependencies below restrict execution even if several batches are approved together.

| Batch / status | Specific owner decision and permission required |
| --- | --- |
| P0 — **PARTIAL; WP2 scope accepted only** | This task accepts official external Phase 1 assets for a local-only experiment, the exact WP2 downloads/metadata and static checks, HTTPS plus matching publisher CHECKSUM assurance with PGP authenticity UNVERIFIED, and the WP2 limits below. This does not approve overall A0 completion, A1, public delivery, embedding, or proprietary shareware acquisition |
| W0 — **AUTHORIZED / COMPLETE for WP2** | The prior WP3 run at `.a0-preflight/20261008T214406Z-4aade6/` and reusable `tools/` installs were preserved. WP2 used a fresh `.a0-preflight/20261008T220038Z-wp2-dbe6ec/` evidence/download/temp area and the new ignored root `assets/freedoom-0.13.0/` reuse directory. Existing paths were checked before creation; no prior run or tool install was overwritten |
| N1 — **AUTHORIZED / COMPLETE for WP2 only** | This task authorized only the three §5 Freedoom release assets and bounded official release/tag/source/notice metadata. The exact URLs, redirect hops, times, lengths and hashes are in the WP2 manifest. No other release asset, version, mirror, tool or package was fetched |
| AS1 — **AUTHORIZED / COMPLETE for WP2, local assurance only** | The owner accepted official HTTPS plus a matching publisher CHECKSUM for this local-only experiment. The PGP archive signature and signed CHECKSUM/tag authenticity remain UNVERIFIED; no signer key was imported and no verifier installed. ZIP safety, selected extraction, notice retention and static WAD checks were authorized and recorded. This makes no public-distribution or legal conclusion |
| T1 — **AUTHORIZED / COMPLETE for the two supplied local archives only** | The owner accepted the SDK archive's official-HTTPS-download plus locally calculated SHA-256 assurance solely for this local experiment; no publisher-authenticated SDK checksum/signature is established. Binaryen's supplied publisher .sha256 matched. Both archive hashes, gzip checks, inventories, and extracted destinations are recorded in the WP3 run evidence. No network access or package substitution |
| X1 — **AUTHORIZED / COMPLETE for WP3 only** | The owner authorized the exact extracted SDK/Binaryen executables and installed Node for the tiny C/WAT smoke pipeline. Versions, arm64 paths/hashes, sysroot, commands, results, and logs are recorded in the WP3 run evidence. No Doom compilation, quarantine removal, global install, or A1 work |
| B1 — **AUTHORIZED / WP4 technical PASS; network deviation accepted by owner** | The owner's WP4 task authorized installed Chrome, one local HTML/classic Blob Worker experiment, a dedicated disposable profile and run-specific evidence, subject to execution-environment permission prompts. No network access was authorized. Both dedicated-profile launches recorded owner offline confirmation. The successful retry supplied runtime JSON, trusted clicks during/after hang and manual visible-responsiveness confirmation. Network isolation was not independently measured; GCM registration/authentication/connection errors remain in logs. The owner accepts this unverified isolation as a procedural deviation; the original no-network restriction is not claimed as satisfied. The owner also accepts the missing screenshot and complete local JSON as non-blocking evidence limitations. Chrome closure and scratch/profile removal remain operational cleanup items, with separate authorization required before removal |
| V0 — **COMPLETE, local** | The committed root source tree is ordinary tracked content and matches the pinned Git tree exactly. This layout decision grants no A0/A1 execution permission; the owner reviews and handles any root commit or push |

## 4. Ordered A0 work packages

Commands outside the recorded WP2, WP3 and WP4 results below remain **PROPOSED / NOT EXECUTED**. `$ROOT` denotes the observed root; `$PIN` the full verified SHA above; `$A0` a fresh absolute evidence run directory. Assign task variables only; never redefine HOME or CODEX_HOME. Use absolute installed tool paths recorded at run start and stop on unexpected resolution. Capture commands, exit codes, elapsed time, stdout/stderr and effects in `$A0/evidence/`.

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

**Prerequisites:** WP1, N1/AS1. For this WP2 run, use the publisher release/tag metadata to record the full source commit, candidate sizes and notice names before package transfer. The supplied task authorizes the three exact v0.13.0 URLs in §5, bounded official GitHub release/tag/source metadata, and tagged COPYING/CREDITS source files. The bounded Python standard-library fetcher checked HTTPS destinations one hop at a time, redacted signed URL queries from evidence, capped response bytes and refused overwrites. No generic downloader was installed or used.

The owner accepted the lower-assurance path for this local-only experiment. The fetched CHECKSUM is OpenPGP clear-signed text; its `Hash: SHA256` header and exact `SHA256 (freedoom-0.13.0.zip)` record were parsed. The ZIP matched that value and the independent cross-check in the task. The `.sig` file was retained and hashed but not cryptographically verified; GitHub's tag API also reports `unknown_key`. No trusted signer fingerprint/verifier was available or established. This accepted assurance is sufficient for this local WP2 admission; it does not authenticate PGP signatures.

The ZIP inventory and every CRC were checked before extraction. Only `freedoom1.wad`, `COPYING.txt`, `CREDITS.txt`, `CREDITS-MUSIC.txt`, `README.html`, and the three language manual PDFs were extracted. `freedoom2.wad` and `freedm-0.13.0.zip` were not extracted or admitted. Tagged `COPYING.adoc`, `CREDITS`, and `CREDITS-MUSIC` were fetched from the resolved release tag; after removing the archive UTF-8 BOM and normalizing CRLF to LF, all three archive text notices were byte-equal to their tagged source counterparts. Manual PDFs were retained and hashed but not parsed or compared with manual source text.

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

**Effects/evidence:** archive/metadata/notices, admitted external IWAD and static JSON only. **PASS:** publisher checksum matches the accepted local assurance, notices match, inventory is safe, and header/directory/map checks pass with structural anomalies resolved. Select E1M1 at fixed skill 2 (Doom's second skill) for later review; E1M2/E1M8 remain later compatibility fixtures. **STOP:** missing/mismatched checksum/terms, no accepted assurance, malformed/ambiguous maps or disallowed bytes; never substitute proprietary shareware or checked-in Freedoom2. **Cleanup:** preserve failure evidence/hashes; discard only incomplete/rejected run-owned files, never silently reuse them.

Residuals: static shape/resources do not establish rendering, map semantics, save-buffer safety or gameplay compatibility. The pinned port warns about Freedoom; IWAD DeHackEd loading is compiled out and FEATURE_DEHACKED is undefined. Record patch-content risk; no A0 engine feature/map repair. **A1 alone** may implement the additive profile removing shareware prerequisites/generated header/C/object and adapter fallback, with bounded missing-asset rejection. A0 only records that design requirement; compiled absence of embedded data remains unproven.

**WP2 result — STATIC ASSET ADMISSION PASS; EVIDENCE CLOSEOUT VALIDATED, local-only, 2026-10-08.** The completed manifest and referenced evidence hashes were validated at closeout; evidence is `.a0-preflight/20261008T220038Z-wp2-dbe6ec/evidence/manifest.json`; reusable ignored files are in `assets/freedoom-0.13.0/`. The official `v0.13.0` annotated tag object `8cecc3642861dfb71839984c886d5576fa120d49` resolves through the GitHub tag API to full source commit `cfb8644b1a8dc7d7d2177e6a892ccaa2922bdaae`. The 24,143,781-byte archive SHA-256 is `3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59`, matching both the publisher CHECKSUM record and the independent task cross-check. The CHECKSUM is 898 bytes (SHA-256 `01a627fa0c80b7446f4f435df6fffef8f354a9987b23870bc5ea5464ca82e977`); the 438-byte binary OpenPGP `.sig` SHA-256 is `77f243f179a42317e22e816e3e7b012a505d36e8416fe5cb914220e58412c789`. PGP authenticity is **UNVERIFIED**; the locally accepted basis is official HTTPS plus matching publisher checksum.

The ZIP contained 11 entries under one `freedoom-0.13.0/` root and 61,716,528 expanded bytes (maximum observed compression ratio 3.17). No traversal/absolute paths, duplicate/case-colliding destinations, encryption, symlinks/special files, CRC failures, local-record overlaps or unexpected files were found; the included Phase 2 WAD was identified but not extracted. The selected `freedoom1.wad` is 28,795,076 bytes, SHA-256 `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`. The IWAD header/directory are within bounds: 3,163 lumps, directory offset 28,744,468, directory end 28,795,076. E1M1/E1M2/E1M8 each occur once and have the ten standard vanilla map lumps in expected order. E3M1/E4M1 are present; MAP01 is absent. PLAYPAL, COLORMAP, PNAMES, TEXTURE1/TEXTURE2 and flat/sprite/patch namespace markers are present. No nonempty range overlaps or exact data aliases were found; duplicate map-lump names are the expected ten map-sequence groups (36 occurrences each). A 20,938-byte `DEHACKED` lump is present (SHA-256 `5591abc1671d7d1439a85602e670caad3fa42ecd6683d759e3b092a4b3650fb7`); compatibility remains unresolved because the pinned port's DeHackEd loading is disabled. The WAD was not loaded or run.

The retained `COPYING.txt` includes source/binary notice-retention conditions, a non-endorsement restriction and warranty/liability disclaimer; its normalized text exactly matches tagged `COPYING.adoc`. Both credits files likewise match tagged source after BOM/newline normalization. Three manual PDFs and README are retained and hashed. This is notice preservation, not a legal conclusion or public-redistribution clearance. The prospective A1 input remains external Phase 1 `freedoom1.wad`, E1M1 at skill 2; A1 must independently remove and prove absence of embedded shareware fallback. WP2 establishes no engine compatibility, startup, map gameplay or compiled no-embed behavior.

### WP3 — native tool inventory, then one throwaway smoke pipeline

**Prerequisites:** WP1 green and the task-specific T1/X1 authorization. WP2 (Freedoom) is independent and is not a prerequisite for this tool-only package. Use only the exact archives already supplied under `~/Downloads`; no network access or additional metadata retrieval is authorized for this run. Record archive and executable SHA-256 values. The owner accepted the SDK's official-HTTPS-download plus local-hash assurance for this local experiment; no publisher-authenticated SDK checksum/signature is established. Verify Binaryen against its supplied publisher `.sha256`.

Pseudocommands: inventory tar members using installed Python `tarfile`; reject absolute/traversal paths, device/FIFO/hardlink entries, duplicate or case-colliding paths, and expansion above the approved ceiling. Accept relative symlinks only when their resolved targets remain inside the package. Extract all package contents safely, without running archive scripts, into reusable root installs `tools/wasi-sdk-24.0/` and `tools/binaryen-119/`; strip each archive's single redundant top-level folder. Keep per-run smoke inputs, outputs and evidence in `$A0/smoke/` and `$A0/evidence/`, with subprocess temporary paths in `$A0/tmp/`. The root `.gitignore` anchors `/tools/` and `/.a0-preflight/`. Require native arm64 executables and the packaged WASI sysroot/headers/libc/libm/runtime. For this run, `$SDK=$ROOT/tools/wasi-sdk-24.0`, `$BIN=$ROOT/tools/binaryen-119/bin`, and `$SYSROOT=$SDK/share/wasi-sysroot`.

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

**Effects/evidence:** reusable ignored tools, tiny per-run C/WAT/JSON inputs, intermediate/final WASM/WAT and logs; one compiler process, no Makefile or Doom sources. **PASS:** packaged compiler/linker/sysroot and all Binaryen stages work within limits; actual validation/export removal/result 9 observed. This proves tool usability only, not the Doom transformation chain. **STOP:** hashes/version/architecture mismatch, blocked execution, missing libraries/tools, unexpected imports, crash or resource limit. No security attribute removal/install/Docker fallback. Retain manifests, logs and hashes; reuse tools for later authorized work only after rehashing.

**WP3 result — TOOLCHAIN PREFLIGHT PASS, 2026-10-08:** evidence is in `.a0-preflight/20261008T214406Z-4aade6/evidence/manifest.json`. The 108,199,177-byte SDK archive hash is `aeae999396d5f5caa5ce419f52e83c35869d5fd21d40af80acba2c80f51b0b3a`; this is a locally calculated identity hash, not publisher authentication. The 6,546,962-byte Binaryen archive hash is `c12dffafb3e3274026268e90577bd86d98186f7be32457618672f8ca437d8d53`, and its supplied `.sha256` check passed. Both gzip tests passed. Safe inventories found 7,006 SDK members / 350,675,976 expanded bytes / 30 contained relative symlinks and 21 Binaryen members / 25,435,538 expanded bytes / no symlinks; no rejected member types, collisions or unsafe paths. The smoke compiled and linked with SDK Clang 18.1.2 (SDK package 24.0), assembled/merged/metadce'd with Binaryen 119, and Node v22.20.0 validated all four modules. The merged module had no imports and exported `memory`, `_initialize`, `probe`, `unused`, and `smoke`; the final module had no imports and exported exactly `memory` and `smoke`. `unused` was removed and one `smoke()` call returned `9`. No Doom source was built or run.

The extraction helper first compared a timing field that naturally differed between inventory and extraction; it stopped before writing either installation. After removing that volatile comparison field, both fresh destinations extracted successfully. The first Node harness attempt used the wrong result shape for `WebAssembly.instantiate(bytes, imports)`; the harness was corrected in the ignored run area, and the corrected Node run passed. Both initial failures and the corrected runs remain in command evidence.

### WP4 — installed Chrome, local-file Blob Worker only

**Prerequisites:** WP3 green, B1. Create one self-contained `$A0/browser/worker-check.html`, no external scripts/assets/fetches. Use embedded classic Worker text in `new Blob([text], {type:'text/javascript'})`, `URL.createObjectURL`, `new Worker(url)`; add error/messageerror listeners and revoke URLs on disposal. Launch pseudocommand: installed Chrome, dedicated `$A0/browser/profile`, no first-run/sync/extensions/background-network features, exact `file://` URL generated from the HTML path. Flags are not a network isolation guarantee; honor the approved offline arrangement. No file-access security override or server.

Page algorithm:

1. Display 50 ms main-thread heartbeat, max gap and a click counter; allocate 16-byte buffer with known pattern and operation ID. Worker receives buffer, verifies bytes and echoes ID/buffer using transfer lists. Require immediate sender detachment (`byteLength == 0`), intact returned bytes and matching ID within 2 s; record Worker start/receipt/round-trip times.
2. Dispose that Worker. Create a separate disposable Blob Worker that replies `ready`, then enters `while (true) {}` only upon explicit `hang` message. Start a main-thread 2 s watchdog after `ready`; terminate from the page, invalidate its ID and report termination/error within the next 250 ms target. No timer inside the hung Worker is used.
3. During hang and after termination, click the counter and observe heartbeat/paint. Require no attributable gap >250 ms in a visible foreground page; record all gaps rather than hiding outliers. Create one fresh echo Worker afterward and repeat round trip to demonstrate recovery. Terminate it; no background survivors.

**Effects/evidence:** HTML, disposable Chrome profile, ordinary approved OS launch state and local evidence downloads. Save page JSON (Chrome version/user agent, file origin, input hash, events/IDs/timestamps, transfer lengths/content checks, heartbeat gaps, watchdog/fresh-Worker outcomes), plus screenshot of results and clicks. Save through a file picker into `$A0/browser/results/`, not an implicit general Downloads path; record manual observations and errors. Page has no Doom/WASM/IWAD input and no product UI.

**PASS:** actual file/Blob Worker creation, transfer round trip, hung-worker disposal, main-thread responsiveness and fresh-worker recovery all observed. `terminate()` has no completion receipt: evidence is the call/timing, responsive page, no further accepted messages and successful recovery, not a fabricated Worker acknowledgment. **STOP:** file-origin/CSP policy failure, browser execution requirement outside approval, attributed UI freeze or deadline failure. Stop for a new owner decision; never silently start a server, install Playwright or launch another browser. **Cleanup:** terminate all Workers/revoke URLs, close only this Chrome instance, retain JSON/screenshot/profile disposition; delete disposable profile only once closed under W0.

**WP4 result — CHROME BLOB WORKER FEASIBILITY PASS, 2026-10-08:** owner-supplied finalized page JSON plus manual foreground responsiveness confirmation support this bounded browser result. Start was clean on `main`, HEAD `c5859e93bdf9fe53ddc5f07bdea4a81aa6495ba1`; existing WP2/WP3 plan and ignore rules were preserved. Installed executable `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, plist/launch version `154.0.8037.98`; page UA reports `Chrome/154.0.0.0`. The single preserved HTML is `.a0-preflight/20261008T222743Z-wp4-fdf2bf/browser/worker-check.html`, SHA-256 `18d2fd75baea7df7cb88ff0057a9df71deae21375bf1feb920bfcc171c7649db`. Actual owner-reported URL is `file:///Users/mike/projects/doom-decisons/.a0-preflight/20261008T222743Z-wp4-fdf2bf/browser/worker-check.html`, with `location.origin == "file://"`; this supersedes the preparation's untested expected `null`. Chrome was manually launched directly with a fresh dedicated profile, `--no-first-run`, `--no-default-browser-check`, `--disable-extensions`, `--disable-sync`, `--disable-background-networking` and `--new-window`; no server or security/file-origin bypass was used. No installed-Chrome interaction tool is available here: runtime evidence is owner-supplied, not agent-observed.

The successful attempt's dedicated profile/logs/evidence are `.a0-preflight/20261008T223747Z-wp4-retry-8dbd3f/`. Launch log records 22:40:09 UTC, PID 84176; page started at 22:40:56.260 UTC and finalized at 22:41:17.580 UTC (21.320 s including manual observation). The page's run ID remains `20261008T222743Z-wp4-fdf2bf` because the same HTML was reused; distinguish attempts by dedicated profile and `startedUtc`. Operation IDs `20261008T222743Z-wp4-fdf2bf-initial-1` and `20261008T222743Z-wp4-fdf2bf-recovery-3` both detached sender buffers 16→0 bytes, echoed all 16 expected bytes `[0,17,34,51,68,85,102,119,136,153,170,187,204,221,238,255]`, matched operation IDs and completed in 12.7/7.8 ms within the 2 s deadlines. Separate classic Blob Worker `20261008T222743Z-wp4-fdf2bf-hang-2` replied ready at 22:40:56.282 UTC; hang command was sent at 22:40:56.283 UTC. The main-thread watchdog fired at 22:40:58.285 UTC after 2001.9 ms (1.9 ms late); terminate returned and URL revocation/disposal completed within 1 ms. Fresh-Worker recovery followed successfully. These are observable terminate/disposal/recovery results, not a Worker thread-exit acknowledgment.

All 40 hung-phase heartbeat samples report visible/focused; their largest gap is 51.6 ms. Across the entire supplied JSON the largest gap is 64.9 ms, with no >250 ms anomalies. Trusted clicks are recorded during hang at 22:40:57.069 UTC and after disposal at 22:41:04.095 UTC. The owner recorded `visiblyResponsive: true`, one click during/after, `foregroundThroughout: true`, and no anomaly review required. No page/Worker errors were recorded. All three Workers have terminate/revoke events; finalized cleanup reports zero owned handles, zero object URLs, zero ignored stale messages and zero accepted messages after disposal. No test-owned Worker handle remains; actual thread exit is not acknowledged by `terminate()`.

`evidence/owner-pass-review.json` in the successful attempt saves selected exact fields, all 40 hung-phase gap values, manual/cleanup evidence and limitations; the **complete raw finalized JSON including every heartbeat sample remains in the conversation**, not a complete local JSON artifact. Clipboard access did not yield a matching result; no unrelated clipboard content was retained. No screenshot was supplied. The owner accepts the missing screenshot and complete local JSON as non-blocking for A0 acceptance; the durability limitation remains. The first attempt's partial results (10.1/7.1 ms echo, 2001.7 ms watchdog, 102.1 ms maximum gap, missing during-hang click/manual confirmation) remain in the original run's `evidence/owner-result-review.json` and conversation. The owner's Control-C and two refused relaunches did not constitute further browser tests; the retry used a new profile without altering earlier evidence.

Both launches record owner `OFFLINE` confirmation; network isolation was **not independently measured**. Logs retain GCM `DEPRECATED_ENDPOINT` registration response errors, and the retry also logged GCM authentication/connection errors. No network-isolation claim follows from flags or the browser feasibility PASS. The owner accepts this gap as a procedural deviation for this local-only experiment; the original B1 no-network restriction is not claimed as satisfied. Chrome instance closure is not independently verified; confirm/close only the dedicated disposable instance before removing its profile. All scratch remains temporary ignored evidence storage; no previous evidence was deleted. Source/tools/assets and WP1–WP3 remain unchanged; WP1–WP4 technical checks passed. **Overall technical A0 PASS is recorded with the accepted deviation and evidence limitations; A1 remains unauthorized.**

### WP5 — reconcile evidence and request review

**Prerequisites:** all four prerequisites have positive evidence and required approvals. Pseudocommands: complete §6 manifest; rehash retained assets/tools; record actual resource totals and all Git/status changes versus baseline; run nonmutating document/manifest checks. **Effects:** evidence/disposition only. **PASS:** §7 satisfied; **BLOCKED:** missing approval/provenance/persistence decision; **FAIL:** attempted check contradicted its positive criterion. Never label static source inspection a runtime pass. Preserve failure evidence and narrow next decision; no automatic repair/expansion. Cleanup is confined to this run's reviewed generated paths, with no `git clean`, reset, bulk removal of prior runs or upstream `make clean`.

**WP5 consolidation and owner disposition recorded:** see the [results summary](doom-a0-preflight-results.md). This read-only documentation update does not rerun experiments. The owner accepts the WP4 evidence and network limitations as a procedural deviation, establishing technical A0 PASS while preserving the fact that B1's no-network condition was not verified or satisfied. No commit, push or cleanup is authorized by this update. Confirm the dedicated Chrome instance is closed before profile removal, and obtain separate owner authorization before deleting `.a0-preflight/` evidence or profiles. A0 PASS permits requesting A1 authorization only; A1 execution remains separately unauthorized.

## 5. Allowlist and safety envelope

**Reference URLs** copied from [Stage A §3](doom-stage-a-plan.md#3-minimal-toolchain-artifact-and-worker). The SDK and Binaryen files were supplied locally by the owner and verified as recorded under WP3; no network calls were made by that run. WP2 fetched only the three authorized Freedoom release files below plus bounded official release/tag/source and notice metadata:

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

The WP2 task-specific ceilings were stricter and govern its completed run: **≤150 MiB cumulative downloaded response bodies**, **≤1 GiB new asset/evidence storage**, and **one worker/compiler job maximum**. The bounded fetcher used a 30-second per-request timeout and no retries. The ZIP was capped at 512 MiB expanded during preflight and selected extraction at 64 MiB. Actual transferred bytes, expanded bytes, elapsed times and asset/evidence storage are in the WP2 manifest. These limits do not change the broader proposed Stage A ceilings below.

All broader Stage A ceilings remain subject to stage-specific authorization and remain at or below the planning bounds: **≤300 MiB total initial downloads** (packages and metadata), **≤3 GiB total project-local tool plus evidence storage**, **≤2 compiler jobs**, **≤15 min per individual build**, **≤60 min aggregate setup/build**. For A0, use one compiler job, one tiny compile pipeline, ≤60 s per tool command, ≤5 min smoke pipeline, ≤30 min aggregate setup/build, and ≤5 min browser check with a 2 s watchdog. Stop before a projected cap breach; count actual bytes, expansion, elapsed setup/build and disk use. No Doom build is permitted within any allowance. Record tool/archive memory/storage estimates before extraction; unknown sizes or inability to enforce a cap blocks transfer/extraction.

Forbidden in A0: make all, dev-init, run-example_browser, any Doom build/run, Docker pulls/runs, pip/npm installs, global installs, source-built toolchains, extra browsers, Playwright, interface/pre-commit regenerators, unapproved servers/network, security-setting/quarantine changes, proprietary shareware download/embedding, and treating tracked Freedoom2 as admitted. The vendored source, HEAD and index remain unchanged during A0; authorized plan/ignore-file edits are tracked separately, and generated per-run evidence stays in `.a0-preflight/` while reusable tools stay in `tools/`. Verified reusable WP2 bytes stay in root-anchored ignored `/assets/freedoom-0.13.0/`; they are separate from ephemeral per-run evidence/downloads. WP2, WP3 and bounded WP4 feasibility are complete; technical A0 PASS is recorded with the owner-accepted WP4 procedural deviation. No network-compliance claim is made.

## 6. Evidence manifest template

The completed WP2 and WP3 records are `.a0-preflight/20261008T220038Z-wp2-dbe6ec/evidence/manifest.json` and `.a0-preflight/20261008T214406Z-4aade6/evidence/manifest.json`. WP2 assets and retained notices are in ignored root `assets/freedoom-0.13.0/`; per-run downloads, metadata, checkers and evidence are in the fresh WP2 run. Use the template below for remaining A0 batches; empty fields are missing evidence, never defaults to success:

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

Technical A0 PASS requires a successful root-tracked vendor baseline check plus all three A0 execution prerequisite passes and recorded resource/evidence dispositions: WP2 admitted official Phase 1 bytes with accepted provenance/notice/static evidence; WP3 actual native SDK/sysroot/Binaryen tiny-pipeline results; and WP4 actual installed-Chrome file/Blob Worker transfer/containment evidence. A procedural deviation may be owner-accepted without being represented as verified compliance with the original condition. For this run, WP1–WP4 technical checks passed and the owner accepted the WP4 evidence and network-isolation limitations. The original B1 no-network restriction was not independently verified and is not claimed as satisfied; the missing screenshot and complete local JSON are accepted as non-blocking evidence limitations. Thus **technical A0 PASS is recorded with the procedural deviation and limitations preserved**. The vendor tree matches the pinned import tree as ordinary root files. Technical failures remain FAIL; unresolved owner dispositions remain BLOCKED. This PASS permits requesting A1 authorization only; it does not start or authorize A1.

Handoff supplies the completed manifest, retained/rehashed asset/tool paths, root commit and vendor tree identity, browser evidence and the specific A1-only request linked to [Stage A A1](doom-stage-a-plan.md#a1--final-wasm-and-observable-controlled-initialization). The request must separately cover source/build-profile/adapter/WAT/export changes, final Doom builds, initialization/render/missing-asset experiments, and any root-repository changes. A0 records the no-shareware profile requirement; **A1 implements and proves it**.

Still unproven: compiled Doom imports/exports and embedded-data absence; title/init/graphics safety; selected-map/DeHackEd/save compatibility; exact tic/native consumption and wait isolation; lifecycle cleanup/PENDING/neutral-first; production control ABI and complete acceptance suite. Archive and tag PGP authenticity are UNVERIFIED under the accepted local checksum assurance. Distribution, extra assets/fixtures, alternate tools/servers, A1 execution, A2/A3 and B–D, Decisions integration and production delivery remain unapproved. Operational cleanup remains: confirm the dedicated Chrome instance is closed before removing its profile, and obtain separate owner authorization before removing `.a0-preflight/` evidence/profile data. **Technical A0 PASS authorizes none of the later work; it permits requesting separate A1 authorization only.**
