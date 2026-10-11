# Repository Guidelines

## Project purpose

Explore running Doom in the browser and using OpenAI's decisions API to control gameplay.
The decisions API is documented here: https://developers.openai.com/api/docs/guides/decisions

The goal is to let users watch Doom running in the browser while OpenAI’s decisions API controls gameplay.

## Project Structure & Module Organization

This repository contains `LICENSE` and the upstream Doom/WASM source, with local modifications, vendored as ordinary root-tracked files under `engine/doom/`. This is the source of truth for engine compilation. The pinned source revision, import check, and asset caveats are recorded in [docs/doom-vendor-provenance.md](docs/doom-vendor-provenance.md). There is no root application; the local build wrapper and fixture checks are described in [docs/doom-build.md](docs/doom-build.md).

Inside the vendored source:
- `src/` contains the C WebAssembly adapter and WAT helpers.
- `doomgeneric/` contains the Doom engine sources.
- `examples/browser/`, `examples/native/`, and `examples/python/` demonstrate host integrations.
- `utils/` contains Python and Rust build utilities.
- upstream Makefile targets can create `build/` artifacts, including `doom.wasm`.

Treat changes under `engine/doom/` as ordinary changes in this root repository. Preserve upstream notices and review source changes against the pinned tree recorded in the provenance document. Do not recreate a nested repository or submodule for this source.

Historical experiments and evidence retain their original paths. Ignored local builds remain under `references/doom.wasm/build/`; do not move or delete them implicitly. New engine build outputs belong under `engine/doom/build/`.

The agreed future layout adds `app/` (vanilla JavaScript + Vite) and a thin root `build.sh` orchestrating engine build → generated WASM staging → Vite build, with optional verified frontend-only reuse. `scripts/build_doom.py` retains responsibility for Doom compilation. The app will automatically load generated/bundled `doom.wasm`; users select the IWAD. These are architectural decisions, not implemented pipelines or verified clean-build/runtime claims; see [M4-A](docs/doom-m4a-investigation.md).

## Build, Test, and Development Commands

For an independently authorized local build, use `scripts/build_doom.py` with the explicit profile and fresh output described in [docs/doom-build.md](docs/doom-build.md). M4 uses `controlled-title` with fixtures enabled and no embedded WAD; the historical `upstream-shareware` profile embeds an explicitly supplied asset. Make owns the build graph; the Python entrypoint admits local inputs and records evidence. Legacy `all`, `doom`, example, dev-init, clean and hook targets are **not** safe local-only entrypoints and require separate authorization.

The following commands invoke legacy upstream recipes from the vendored source:

- `make -C engine/doom all`: runs the upstream Doom/WASM build and writes under `engine/doom/build/`.
- `make -C engine/doom run-example_browser`: serve the browser example at `http://127.0.0.1:8000/doom.html`.
- `make -C engine/doom run-example_native`: launch the native example.
- `make -C engine/doom run-example_python`: launch the Python example.

These are not A0 preflight commands. The upstream build can download or embed shareware data, create a Python environment, use Docker, and clone/build Binaryen; example targets may install dependencies or download WAD files. Check the relevant Makefile and README, and obtain the stage-specific authorization before running them. The reference build requires Python 3, Docker, Make, curl, and Git; examples may need additional dependencies.

## Coding Style & Naming Conventions

Match the surrounding code. Reference C code uses LLVM clang-format style with two-space indentation; `.clang-format` disables include sorting because ordering matters. Python helpers use snake_case names; the WebAssembly API uses names such as `tickGame` and `reportKeyDown`.

The vendored pre-commit configuration checks whitespace and YAML, formats C/C++, and regenerates requirements and interface documentation. Those hooks can download tools or alter tracked files; inspect their effects before running them.

## Testing Guidelines

Build infrastructure fixture checks are documented in [docs/doom-build.md](docs/doom-build.md); no engine runtime test suite or coverage threshold is currently defined. For runtime changes, rebuild and manually exercise the affected example, checking startup, rendering, and keyboard input. Check saving or custom WAD loading in a host that supports those features. Include reproduction steps and validation results in the pull request.

## Commit & Pull Request Guidelines

The root history currently contains only `Added doom.wasm as reference`; no formal commit convention is established. Use concise, descriptive subjects and keep changes focused.

Pull requests should describe the change, link relevant issues, and list validation performed. Include screenshots for visual changes. Doom source, adapter, and build changes are reviewed and committed with the root repository as ordinary file changes.
