# Repository Guidelines

## Project purpose

Explore running Doom in the browser and using OpenAI's decisions API to control gameplay.
The decisions API is documented here: https://developers.openai.com/api/docs/guides/decisions

The goal is to let users watch Doom running in the browser while OpenAI’s decisions API controls gameplay.

## Project Structure & Module Organization

This repository contains `LICENSE` and the upstream Doom/WASM source vendored as ordinary root-tracked files under `references/doom.wasm/`. The pinned source revision, import check, and asset caveats are recorded in [docs/doom-vendor-provenance.md](docs/doom-vendor-provenance.md). There is no root application, build configuration, or test suite yet.

Inside the vendored source:
- `src/` contains the C WebAssembly adapter and WAT helpers.
- `doomgeneric/` contains the Doom engine sources.
- `examples/browser/`, `examples/native/`, and `examples/python/` demonstrate host integrations.
- `utils/` contains Python and Rust build utilities.
- upstream Makefile targets can create `build/` artifacts, including `doom.wasm`.

Treat changes under `references/doom.wasm/` as ordinary changes in this root repository. Preserve upstream notices and review source changes against the pinned tree recorded in the provenance document. Do not recreate a nested repository or submodule for this source.

## Build, Test, and Development Commands

The repository has no root build system. The following commands invoke upstream recipes from the vendored source:

- `make -C references/doom.wasm all`: runs the upstream Doom/WASM build and writes under `references/doom.wasm/build/`.
- `make -C references/doom.wasm run-example_browser`: serve the browser example at `http://127.0.0.1:8000/doom.html`.
- `make -C references/doom.wasm run-example_native`: launch the native example.
- `make -C references/doom.wasm run-example_python`: launch the Python example.

These are not A0 preflight commands. The upstream build can download or embed shareware data, create a Python environment, use Docker, and clone/build Binaryen; example targets may install dependencies or download WAD files. Check the relevant Makefile and README, and obtain the stage-specific authorization before running them. The reference build requires Python 3, Docker, Make, curl, and Git; examples may need additional dependencies.

## Coding Style & Naming Conventions

Match the surrounding code. Reference C code uses LLVM clang-format style with two-space indentation; `.clang-format` disables include sorting because ordering matters. Python helpers use snake_case names; the WebAssembly API uses names such as `tickGame` and `reportKeyDown`.

The vendored pre-commit configuration checks whitespace and YAML, formats C/C++, and regenerates requirements and interface documentation. Those hooks can download tools or alter tracked files; inspect their effects before running them.

## Testing Guidelines

No automated test suite or coverage threshold is currently defined. For runtime changes, rebuild and manually exercise the affected example, checking startup, rendering, and keyboard input. Check saving or custom WAD loading in a host that supports those features. Include reproduction steps and validation results in the pull request.

## Commit & Pull Request Guidelines

The root history currently contains only `Added doom.wasm as reference`; no formal commit convention is established. Use concise, descriptive subjects and keep changes focused.

Pull requests should describe the change, link relevant issues, and list validation performed. Include screenshots for visual changes. Doom source, adapter, and build changes are reviewed and committed with the root repository as ordinary file changes.
