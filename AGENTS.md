# Repository Guidelines

## Project purpose

Explore running Doom in the browser and using OpenAI's decisions API to control gameplay.
The decisions API is documented here: https://developers.openai.com/api/docs/guides/decisions

## Project Structure & Module Organization

This repository currently contains `LICENSE`, `.gitmodules`, and the upstream `references/doom.wasm/` Git submodule. There is no root application, build configuration, or test suite yet.

Inside the reference submodule:
- `src/` contains the C WebAssembly adapter and WAT helpers.
- `doomgeneric/` contains the Doom engine sources.
- `examples/browser/`, `examples/native/`, and `examples/python/` demonstrate host integrations.
- `utils/` contains Python and Rust build utilities.
- `build/` holds generated artifacts, including `doom.wasm`.

Treat reference changes as submodule changes: commit them in the submodule first, then update its recorded revision in this repository.

## Build, Test, and Development Commands

Run these commands from the repository root:

- `git submodule update --init --recursive`: initialize the reference checkout.
- `make -C references/doom.wasm all`: build `references/doom.wasm/build/doom.wasm`.
- `make -C references/doom.wasm run-example_browser`: serve the browser example at `http://127.0.0.1:8000/doom.html`.
- `make -C references/doom.wasm run-example_native`: launch the native example.
- `make -C references/doom.wasm run-example_python`: launch the Python example.

The reference build requires Python 3, Docker, Make, curl, and Git. Check each example's README for additional dependencies.

## Coding Style & Naming Conventions

Match the surrounding code. Reference C code uses LLVM clang-format style with two-space indentation; `.clang-format` disables include sorting because ordering matters. Python helpers use snake_case names; the WebAssembly API uses names such as `tickGame` and `reportKeyDown`.

The submodule's pre-commit configuration checks whitespace and YAML, formats C/C++, and regenerates requirements and interface documentation. Run `pre-commit run --all-files` from the submodule after configuring its development environment.

## Testing Guidelines

No automated test suite or coverage threshold is currently defined. For runtime changes, rebuild and manually exercise the affected example, checking startup, rendering, and keyboard input. Check saving or custom WAD loading in a host that supports those features. Include reproduction steps and validation results in the pull request.

## Commit & Pull Request Guidelines

The root history currently contains only `Added doom.wasm as reference`; no formal commit convention is established. Use concise, descriptive subjects and keep changes focused.

Pull requests should describe the change, link relevant issues, and list validation performed. Include screenshots for visual changes. For submodule updates, identify the previous and new revisions and explain the update.
