# Repository Guidelines

## Project purpose

Let users watch Doom in the browser while OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions) controls gameplay.

The implemented M4-B app is a preparation-only static baseline: bundled WASM, a locally selected IWAD, real E1M1 preparation, exactly one neutral first tic, and passive rendering/snapshots/idle diagnostics. The bundled official SDK exposes `decisions.create`, but the app makes no live API calls and accepts no API key. M4-C is next: `Next Decision`, user-chosen 1–20 tics per decision, and persistent Worker/native state across human-triggered decisions are **not yet implemented**.

## Project Structure & Module Organization

- `engine/doom/`: locally modified upstream Doom/WASM source, tracked as ordinary root-repository files and the source of truth for compilation. `src/` holds the adapter/WAT helpers; `doomgeneric/` holds the engine. Do not recreate a nested repository or submodule. See [vendor provenance](docs/doom-vendor-provenance.md).
- `app/`: static browser application using vanilla TypeScript and DOM APIs, plain CSS, and an app-local `package-lock.json`. Exact pins in `app/package.json`: TypeScript **7.0.2**, Vite **8.3.4**, official OpenAI SDK **7.32.0**, Biome **2.5.15**. No React or Tailwind.
- `build.sh`: thin engine → verified staging → Vite build wrapper. `scripts/build_doom.py` owns compilation admission/evidence; `scripts/inspect_doom.mjs` checks the WASM interface; `scripts/stage_web.mjs` verifies/stages artifacts; `scripts/check_worker.mjs` protects Worker packaging.
- `experiments/` and `docs/`: historical experiments and evidence. Keep original paths; do not silently move or delete ignored assets/artifacts, including `references/doom.wasm/build/`. New engine outputs belong under `engine/doom/build/`.

## Build, Test, and Development Commands

Obtain owner approval before dependency installs/downloads, builds, opening a server/browser, authenticated or billable API calls, commits/pushes, or GitHub mutations. After approval, from the repository root:

- `npm --prefix app ci --no-audit --no-fund`: install locked frontend dependencies.
- `./build.sh`: build a fresh `controlled-title` engine with fixtures enabled and no embedded WAD, stage verified WASM/metadata/notices under ignored `app/public/`, and build `app/dist/` with output verification.
- `./build.sh --frontend-only`: reuse only the previously verified, locally generated current engine artifact. Missing evidence, changed engine inputs, or mismatched bytes require a full build; **this cannot run first from a fresh checkout**.

The app automatically loads generated/bundled `doom.wasm` on preparation. The IWAD stays locally user-selected and **must not be packaged**; the current baseline accepts only the known-good Freedoom 0.13.0 Phase 1 asset documented in [app/README.md](app/README.md).

Provision tools separately: Node **22.20.0**/npm, Python **3.14.4**, GNU Make **3.81**, WASI SDK **24.0**, Binaryen **119**, and Git on the tested macOS host. See [app setup/build instructions](app/README.md) and [engine build/fixture documentation](docs/doom-build.md) for tool paths and constraints. Builds never install tools. Make owns the engine build graph; use the wrapper rather than legacy targets.

Legacy upstream `all`, `doom`, example, dev-init, clean, and hook targets require separate authorization. They may download/embed game assets, install dependencies, create environments, use Docker, or clone/build Binaryen. Inspect their Makefile/README effects first; the historical shareware profile is not the app's no-IWAD workflow.

With dependencies already installed, app checks are:

- `npm --prefix app run check`: TypeScript checking, static Worker integrity, then non-writing Biome lint/format checks.
- `npm --prefix app run typecheck`: `tsc --noEmit`.
- `npm --prefix app run lint`: `biome lint .`, without writes.
- `npm --prefix app run format`: `biome format --write .` — **writes files**.

`npm --prefix app run build` verifies staged assets, typechecks, runs Vite, and verifies emitted assets; use `build.sh` for the engine handoff and Worker check. Builds do not format source. An old `app/dist/` after a failed build is not new build evidence.

## Coding Style & Naming Conventions

Match the surrounding code. Reference C code uses LLVM clang-format style with two-space indentation; `.clang-format` disables include sorting because ordering matters. Python helpers use snake_case names; the WebAssembly API uses names such as `tickGame` and `reportKeyDown`.

Biome is the app's linter/formatter. **Do not format, convert to TypeScript, or casually transform `app/src/worker-boundary.js`.** It is byte-identical to the accepted `experiments/m3-e3/worker-boundary.js` and supplies the raw-source classic Blob Worker payload. `scripts/check_worker.mjs` checks the copy, narrowly validated export-wrapper removal, and classic payload parsing without execution. Biome excludes this file; adjacent `.d.ts` declarations supply typing. `worker-source.js` also remains JavaScript for direct Node checking. Preserve native initialization, step verification, passive rendering/snapshots, and idle-state contracts.

Use the smallest useful experiment and Codex for bounded investigations, implementations, and reviews. Keep changes focused and preserve proven engine/Worker behavior. Vendored hooks can download tools or alter tracked files; inspect their effects before running them.

## Testing Guidelines

Distinguish static inspection/checks, successful build evidence, and actual browser/API evidence. Source checks and builds alone do not establish Chrome runtime correctness. The owner reports successful production builds and Chrome rendering of real E1M1, neutral-first requested/reported/verified **1/1/1**, and no simulation advancement during passive snapshots/rendering or five-second idle. See the [M4-B verification record](docs/doom-m4b-verification.md); historical version/path references there are not current configuration. Do not present owner-run browser results as tests personally run by Codex.

For authorized runtime changes, rebuild and follow the isolated Chrome smoke steps in [app/README.md](app/README.md), recording native/Canvas/idle receipts and Console/Network observations. Engine fixture checks are in [docs/doom-build.md](docs/doom-build.md); no engine runtime suite or coverage threshold is defined. Report exactly what was exercised; SDK availability is not authenticated Decisions evidence.

## Repository Hygiene and Distribution

Preserve upstream notices, licenses, and source/build provenance; review engine changes against the pinned source documented in vendor provenance. Before public distribution, review redistribution rights, GPL corresponding-source/build obligations, third-party notices, and unresolved vendored asset rights. Bundled license files alone do not establish compliance.

## Commit & Pull Request Guidelines

Use concise, descriptive commit subjects and keep changes focused.

Pull requests should describe the change, link relevant issues, and list validation performed. Include screenshots for visual changes. Doom source, adapter, and build changes are reviewed and committed with the root repository as ordinary file changes.
