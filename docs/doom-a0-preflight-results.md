# Stage A0 preflight results — technical PASS; owner disposition recorded

**Stage A0 / [Issue #2](https://github.com/mikechao/doom-decisons/issues/2), 2026-10-08: TECHNICAL A0 PASS, with an owner-accepted WP4 procedural deviation; A1 remains separately unauthorized.** The owner accepts the remaining WP4 evidence and network-isolation limitations for this local-only experiment. Network isolation was not independently established, so the original B1 no-network restriction cannot be claimed as satisfied; this is recorded as an accepted procedural deviation, not verified compliance. The missing screenshot and complete local JSON are accepted as non-blocking evidence limitations. This documentation records the owner's disposition and reconciles existing evidence; it performs no new preflight experiment. Root baseline is `main` at **`292e9ceb57255e0df76bd8996a9ad37132b04186`**, with an initially clean worktree and index. Earlier run HEADs below are historical, not the current baseline. Prior plan/ignore edits are committed in this HEAD. Current root ignore rules are `/tools/`, `/.a0-preflight/`, and `/assets/`.

| Prerequisite | Reconciled outcome | Evidence boundary |
| --- | --- | --- |
| WP1: durable source ownership | **PASS**, rechecked against current Git state | Exact pinned tree, 229 ordinary root-tracked files |
| WP3: native WASM toolchain | **Observed PASS** | Retained command logs, module inventory and matching tool/artifact hashes; tool usability only |
| WP2: Freedoom Phase 1 admission | **Observed static PASS**, local-only | Publisher checksum, retained notices, safe ZIP and IWAD reports; runtime compatibility untested |
| WP4: Chrome Blob Worker | **Owner/manual observed technical PASS; procedural deviation accepted by owner** | Locally retained review extract and launch records; no independent browser observation or complete local raw JSON; network isolation unverified and B1 no-network condition not claimed as satisfied |

Together, the four prerequisite results establish **technical A0 PASS** with the owner-accepted WP4 limitations above. This is not a claim of verified B1 network compliance, and it does not authorize A1. Scope, authorization history, owner disposition and cleanup requirements remain in the [A0 preflight plan](doom-a0-preflight-plan.md); later experiments remain in the [Stage A plan](doom-stage-a-plan.md).

## Source provenance

Upstream is [jacobenget/doom.wasm](https://github.com/jacobenget/doom.wasm), commit **`31cc1af9656a8184830090c4e9f268383f5d7e15`**, expected imported Git tree **`18ad13ab35135c607015fb645dd8bbdc4f69f473`**. Current HEAD's `references/doom.wasm/` subtree and the pinned commit's tree in the retained historical Git object database both equal that tree. All 229 tracked paths have mode `100644`; vendor worktree/index changes are absent. There is no gitlink, nested `.git` pointer or `.gitmodules`. These are ordinary root-repository files; subsequent changes use root diffs and commits, with no fork/submodule/patch workflow.

The [detailed vendor provenance](doom-vendor-provenance.md) records the original import and bundled-asset caveats. Its pending-import-publication wording, and similar wording in the Stage A plan, describes an earlier state: the import is now committed locally. This consolidation makes no remote-publication assertion and leaves historical documents unchanged. Bundled example assets are not admitted by this A0 result.

## WP3: WASM toolchain

Reusable ignored installs are `tools/wasi-sdk-24.0/` and `tools/binaryen-119/`. Recorded host is macOS 26.6.2 arm64; all seven required native executables are arm64. SDK package **24.0** reports Clang **18.1.2-wasi-sdk**, LLD **18.1.2**, and `llvm-ar` **18.1.2-wasi-sdk**. Binaryen `wasm-as`, `wasm-merge`, `wasm-metadce` and `wasm-dis` report **119**; Node reports **v22.20.0**. The SDK's `share/wasi-sysroot/`, headers, libc/libm, reactor startup object and `lib/clang/18` were recorded as contained and usable; their cited paths still exist.

| Input / output | Bytes | SHA-256 (rehash matched retained file) |
| --- | ---: | --- |
| `wasi-sdk-24.0-arm64-macos.tar.gz` | 108,199,177 | `aeae999396d5f5caa5ce419f52e83c35869d5fd21d40af80acba2c80f51b0b3a` |
| `binaryen-version_119-arm64-macos.tar.gz` | 6,546,962 | `c12dffafb3e3274026268e90577bd86d98186f7be32457618672f8ca437d8d53` |
| Smoke `final.wasm` | 40,199 | `12e2ad4d6ebdf2b6750289140bbfca1922e867d9072269cc8de32d564808fb1d` |

Archives remain in the owner's `~/Downloads/`; no retrieval occurred during WP3. Binaryen matched the supplied **published `.sha256`**. The SDK hash is **locally calculated but not publisher-authenticated**; the owner accepted official-HTTPS-download plus local-hash assurance for this local experiment. Recorded gzip and safe-inventory checks passed (SDK: 7,006 members, 30 contained relative symlinks; Binaryen: 21 members, no symlinks).

The retained pipeline logs show successful C compilation/linking, WAT assembly, merge, metadce and disassembly. A malloc/free/sqrt probe computes `sqrt(81)`; a WAT wrapper calls `_initialize` then `probe`, exporting `smoke`. Reachability roots retain `smoke` and `memory`. Node validated all four WASMs. Merge resolved both wrapper imports and exported `memory`, `_initialize`, `probe`, `unused`, `smoke`; metadce removed the extra exports, including `unused`. **Expected and observed final exports: `memory` (memory), `smoke` (function); imports: none; one `smoke()` call returned 9.** Module inventory equals both the manifest and corrected Node stdout.

Historical command outline: `$ROOT` denotes the absolute repository root; working directory is isolated smoke storage. Not executed by this consolidation; input definitions are in the plan's WP3 section.

```sh
SDK="$ROOT/tools/wasi-sdk-24.0"; BIN="$ROOT/tools/binaryen-119/bin"
"$SDK/bin/clang" --target=wasm32-unknown-wasi --sysroot="$SDK/share/wasi-sysroot" \
  -Wall -Os -mexec-model=reactor -Wl,--export=probe -Wl,--export=unused \
  probe.c -o core.wasm -lm -lc
"$BIN/wasm-as" wrap.wat -o wrap.wasm
"$BIN/wasm-merge" core.wasm core wrap.wasm wrapper -o merged.wasm --enable-bulk-memory
"$BIN/wasm-metadce" merged.wasm --graph-file roots.json -o final.wasm --enable-bulk-memory
"$BIN/wasm-dis" final.wasm -o final.wat
node inspect.mjs  # validate/inventory all four modules; instantiate final with {}; call once
```

Initial extraction-helper timing comparison and Node result-wrapper mistakes were corrected in scratch; failed and corrected logs remain. Recorded smoke wall time was **14.374 s**, longest instrumented command **4.631 s**, one compiler job; tool/evidence logical storage **378,358,260 bytes**, below 3 GiB. This establishes a tiny tool pipeline, not the Doom transformation chain.

## WP2: Freedoom 0.13.0 Phase 1

Retained official metadata identifies [Freedoom release `v0.13.0`](https://github.com/freedoom/freedoom/releases/tag/v0.13.0), annotated tag object `8cecc3642861dfb71839984c886d5576fa120d49`, resolving to source commit **`cfb8644b1a8dc7d7d2177e6a892ccaa2922bdaae`**. Release files came from `https://github.com/freedoom/freedoom/releases/download/v0.13.0/`; HTTPS redirect records are retained. The ZIP matched the exact SHA256 record in the publisher's clear-signed CHECKSUM and the release's size.

| Retained input (`assets/freedoom-0.13.0/`) | Bytes | SHA-256 (rehash matched) |
| --- | ---: | --- |
| `freedoom-0.13.0.zip` | 24,143,781 | `3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59` |
| External `freedoom1.wad` | 28,795,076 | `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d` |
| `COPYING.txt` | 1,644 | `7c62f2c520769c798774f416637eec4921e5f0aafdac1245ae7c8a8cf65fe102` |
| `CREDITS.txt` | 15,872 | `72364333d295c598d75ef9553d3b3661ad0b60e27271c87b7637c74b2f46918a` |
| `CREDITS-MUSIC.txt` | 9,388 | `2bb77677bbc4e587bba44ccb6514ee0f5397c7bb8ae9580b9188d3d6a57c0a31` |

The recorded ZIP checks passed for all 11 entries and CRCs, 61,716,528 expanded bytes, with no unsafe paths, collisions, encryption, special files or overlapping local records. Only Phase 1 and its notices/README/three manual PDFs were extracted; Phase 2 was not admitted. The three text notices match tagged source after BOM/newline normalization. They support notice-retention, non-endorsement and disclaimer obligations; manuals were retained and hashed, not text-compared. **PGP authenticity remains UNVERIFIED** for archive, CHECKSUM and tag (tag API: `unknown_key`). Accepted local assurance was official HTTPS plus a matching publisher checksum; no broader redistribution clearance is claimed.

Static IWAD report: **3,163 lumps**, directory offset **28,744,468**, directory end **28,795,076**, all directory/payload bounds valid, no nonempty overlaps or exact data aliases. E1M1/E1M2/E1M8 each occur once (indices 0/11/77), followed by the ten standard vanilla map lumps in order. E3M1/E4M1 and required palette/texture/flat/sprite resources are present; MAP01 is absent. Duplicate names are expected repeated map-lump groups. **DEHACKED is present: 20,938 bytes**, hash `5591abc1671d7d1439a85602e670caad3fa42ecd6683d759e3b092a4b3650fb7`. The pinned port disables its loading, so map semantics, rendering, gameplay and save compatibility remain unresolved. Prospective first map is E1M1 at skill 2; no WAD was loaded.

Recorded download bodies totaled **25,069,586 bytes** (<150 MiB); retained assets **57,040,070 bytes** plus evidence **1,860,968 bytes** excluding the manifest (<1 GiB). Selected extraction was **32,894,953 bytes** (<64 MiB); no compiler job ran.

## WP4: Chrome Blob Worker

Installed/launch version was **154.0.8037.98** (UA: `Chrome/154.0.0.0`). The successful owner-run retry reused the initial HTML/run ID with a new dedicated profile; page interval was **22:40:56.260–22:41:17.580 UTC** (21.320 s). Owner JSON extract reports a `file:` page with **`location.origin == "file://"`**, superseding preparation's untested expectation `null`. Classic Blob Workers used no server or file-origin security bypass.

| Recorded check | Result |
| --- | --- |
| Initial transfer/round-trip | **12.7 ms**, sender **16 → 0 bytes**, return 16 bytes, matching ID and pattern `byte[i] = 17*i`, i=0…15 |
| Hung Worker watchdog | Ready then intentional loop; main-thread watchdog **2001.9 ms** (1.9 ms late) |
| Disposal | `terminate()` returned in about 0.5 ms; terminate/revoke/local disposal completed within **1 ms** |
| Main-thread responsiveness | 50 ms heartbeat; 40 hung-phase gaps, maximum **51.6 ms**; reported whole-run maximum **64.9 ms**, no >250 ms anomalies; trusted clicks during hang and after disposal |
| Replacement Worker | Successful identical transfer/echo in **7.8 ms** |
| Page cleanup | Zero owned Worker handles/object URLs, zero accepted messages after disposal, no page/Worker errors |

Measurements are page instrumentation copied into an **owner-supplied review extract**; visible responsiveness and continuous foreground status are **manual owner observations**, not agent/browser automation evidence. `terminate()` provides no synchronous thread-exit completion acknowledgment; local disposal and recovery establish the observed containment result.

No screenshot or complete finalized browser JSON was found locally. The extract says the full JSON remained in the prior conversation, which is not a durable local artifact. The first attempt lacked during-hang/manual confirmation and is preserved separately; its timings are not merged into this PASS. Both launches recorded owner offline confirmation, but **network isolation was not independently verified**, and Chrome logs retain GCM endpoint/authentication/connection errors. On 2026-10-08, the owner accepted this network-isolation limitation as a procedural deviation for this local-only experiment and explicitly stated that the original B1 no-network restriction cannot be claimed as satisfied. The owner also accepted the absent screenshot and incomplete local JSON as non-blocking for A0 acceptance. This records owner disposition, not verified network compliance or a complete durable raw record. Chrome closure remains unverified and is an operational cleanup item.

## Evidence, limitations and closeout

Read-only consolidation reconciled **49 manifest-referenced files** (archive/checksum, required tool executables, smoke inputs/artifacts, all retained WP2 assets and listed WP2 evidence) with no size/hash mismatch; all 52 WP3 command-record paths exist. No original checker, compile, archive verification or browser experiment was rerun. The following principal records exist; hashes were calculated from retained bytes here (WP2 manifest also matches the supplied closeout hash).

Paths below are historical under `.a0-preflight/`; the measurements and identities above remain the durable record after separately authorized scratch removal.

| Historical record | Verified SHA-256 |
| --- | --- |
| `20261008T214406Z-4aade6/evidence/manifest.json` | `58594f49872dbe4dbb98694ed9e0e34b8a5c0f0b8ab02b63f544041c4da56c1c` |
| `20261008T214406Z-4aade6/evidence/module-inventory.json` | `8762c2749489530b9930fa33347cc1ac0ff9a31ae8c7370d7334e3a6e5f47892` |
| `20261008T220038Z-wp2-dbe6ec/evidence/manifest.json` | `a73d5f03fc2a3c52c241b3b4dab310da4724fcf4fd93d2ce536f6c4dc2f4e872` |
| Same WP2 run: `evidence/archive-inventory.json` | `4e0ef6012b47529f7d9bc0e3c4dc9f60595a2d9114b1a87c25ff26d75555decf` |
| Same WP2 run: `evidence/notice-comparison.json` | `878e6943fc2111cc529333f8189d672c477e13de7105cdeba27040403ccba132` |
| Same WP2 run: `evidence/static-wad-report.json` | `17367cb5e613ff0393a3d8ef2768205fac9b9022c3d1af974766eefd1bafb20b` |
| `20261008T222743Z-wp4-fdf2bf/evidence/preparation.json` | `8bf4b2ad4b2f94bb21173bb15698544f4a57b9a95b906a69aced18ae9761ef8d` |
| Same initial WP4 run: `browser/worker-check.html` | `18d2fd75baea7df7cb88ff0057a9df71deae21375bf1feb920bfcc171c7649db` |
| `20261008T223747Z-wp4-retry-8dbd3f/evidence/owner-pass-review.json` | `6ccef45e8712b176d2c8166023c1e7922241008b188d172bf347e639fcfa2dbd` |

Run root revisions: WP3 `8b281ef6d20c34650c10152c2947b486c12389ea`; WP2 `d82f9eee2e7c318276a399454b1852b5fb6f7767`; WP4 `c5859e93bdf9fe53ddc5f07bdea4a81aa6495ba1`. Earlier incomplete dispositions reflect the remaining work at those times. No supplied measurement/hash discrepancy was found. Browser evidence gaps preclude an independent automated WP4 claim and verified B1 network-compliance claim; the owner accepted the limitations for technical A0 acceptance as recorded above.

**Not tested:** real Doom WASM build, initialization/rendering, any gameplay tic, exact stepping, lifecycle preparation, or Freedoom runtime compatibility. The **no-embedded-shareware build-profile guarantee belongs to A1** and is still unproved; external asset admission does not remove the existing fallback.

The owner has recorded the disposition of the remaining WP4 limitations, establishing technical A0 PASS without claiming the B1 no-network condition was satisfied. Operational cleanup remains pending: confirm that only the dedicated test Chrome instance is closed (close it if still open) before removing its profile, and obtain separate owner authorization before deleting any `.a0-preflight/` contents, including either profile. This task preserves every run and both Chrome profiles and makes no source changes, cleanup, commit or push. Keep verified `tools/` and `assets/` locally for any separately authorized A1. `.a0-preflight/` is disposable evidence storage, not a project dependency. A0 PASS permits requesting A1 authorization only; it does not authorize A1 execution. Issue #2 was not closed or otherwise changed by this documentation update.
