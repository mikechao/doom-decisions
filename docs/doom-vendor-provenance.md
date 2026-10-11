# Doom/WASM vendor provenance

Current location (2026-10-10 relocation): the actively maintained source is now `engine/doom/`. All 234 tracked files, including local modifications, licenses/notices, and tracked example assets, were relocated without content changes. The import paths, tree IDs, counts, and publication status below are historical records of the original import, not claims about the current tree. Ignored build artifacts remain at `references/doom.wasm/build/`; relocation does not re-establish their binary provenance or redistribution clearance.

The files under `references/doom.wasm/` were imported on **2026-10-08** from [jacobenget/doom.wasm](https://github.com/jacobenget/doom.wasm) at pinned commit **`31cc1af9656a8184830090c4e9f268383f5d7e15`**. This is a direct vendor import of the checked-out source, not a fork, submodule, or patch series. The owner has not yet committed or pushed this root-repository change.

## Import verification

Before conversion, the root checkout was clean at `main` / `a1928c5731d0def4532691b216b604fd442c6a1d`; its stage-0 entry for `references/doom.wasm` and the clean nested checkout both named the pinned commit above. The local submodule origin matched the upstream URL. No network access or newer upstream revision was used.

The source commit's tree object is **`18ad13ab35135c607015fb645dd8bbdc4f69f473`**. Verification compares that recursive Git tree with the root index subtree at `references/doom.wasm`: paths, Git modes, object types, and blob IDs must match. Equal tree IDs prove the complete tracked tree is identical, including file bytes, executable modes, and symlink targets. The imported tree has 229 tracked paths totaling 41,043,865 bytes; all entries are mode `100644`, with no symlinks. No source paths were intentionally excluded or altered.

The original `.git` pointer was copied to a local recovery directory outside the repository before it was removed. The historical object database under `.git/modules/references/doom.wasm/` was left intact. The root index now records ordinary files and has no `160000` entry for this path; `.gitmodules` was removed because it contained only this declaration. The pointer backup is local recovery material and is not part of the repository.

After the owner commits and pushes the root change, a fresh clone of that root revision will receive the vendored files as normal tracked files. It will not need `git submodule update`. This local import is not yet published.

## Third-party asset and license notes

The upstream tree includes its `LICENSE` and per-file copyright notices. Those notices cover source code where indicated; they do not establish redistribution rights for every bundled binary asset.

- `doomgeneric/example_implementation/test_wad_files/freedoom2.wad` is 28,787,748 bytes. The checked-in source tree has no adjacent Freedoom-specific license, credits, or release-provenance notice. An upstream example Makefile points to a mutable Freedoom `master` URL, which does not establish the checked-in file's identity or redistribution terms. Its asset status remains unresolved and is a **pre-push review concern**.
- `doomgeneric/example_implementation/test_wad_files/GOTHIC2.WAD` is 8,046,898 bytes. The example Makefile points to a downloadable archive, but the vendored tree does not establish the checked-in file's redistribution terms. Review its provenance and license before distribution.
- `doomgeneric/screenshots/sdl.png` is 2,243,101 bytes. Its rights and provenance have not been independently assessed.

These files were preserved byte-for-byte to satisfy the pinned-tree import. Their presence in upstream does not constitute legal clearance. No additional assets were downloaded, and this import makes no public-distribution claim.
