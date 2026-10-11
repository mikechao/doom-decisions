# Repository Guidelines

## Project purpose

Let users watch Doom in the browser while OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions) controls gameplay.

The implemented, owner-accepted **v0.1.0 very-minimal MVP (M4-C)** is a standalone static browser app with bundled modified native Doom WASM and a user-selected local Freedoom Phase 1 IWAD. Selecting the IWAD automatically prepares a fresh Worker/game in real E1M1 and verifies exactly one mandatory neutral first tic, without an API request.

The user supplies an API key in the browser for browser-direct BYOK calls through the official OpenAI Decisions SDK (`decisions.create`). This is an intentionally temporary MVP architecture with no backend/proxy and no claim of production credential security; see [credential behavior and trust boundaries](app/README.md#temporary-browser-direct-credentials).

Each **Next Decision** click requests one model-selected action, with no autoplay. The user controls duration: integer **N=1–20 tics, default 6**, captured at click admission before asynchronous work. The model selects only `neutral`, `forward`, `turn_right`, `backward`, `turn_left`, `fire`, or `use`, never duration or combined actions. Successful decisions retain the same Worker/native game state between clicks. Preserve the distinction between the requested/model-selected action and native consumption: requested, reported, and independently verified tic counts are separate evidence. Waits, screenshots, passive rendering/snapshots, and idle must not advance gameplay; uncertain native completion must not be treated as success.

There are no visible Prepare, Stop, Reset, or New Game controls. Refresh starts a new session and clears in-memory credentials.

## Project Structure & Module Organization

- `engine/doom/`: locally modified upstream Doom/WASM source, tracked as ordinary root-repository files and the source of truth for compilation. `src/` holds the adapter/WAT helpers; `doomgeneric/` holds the engine. Do not recreate a nested repository or submodule. See [vendor provenance](docs/doom-vendor-provenance.md).
- `app/`: static browser application using vanilla TypeScript and DOM APIs, plain CSS, and an app-local `package-lock.json`. Exact pins in `app/package.json`: TypeScript **7.0.2**, Vite **8.3.4**, official OpenAI SDK **7.32.0**, Biome **2.5.15**. No React or Tailwind.
- `build.sh`: thin engine → verified staging → Vite build wrapper. `scripts/build_doom.py` owns compilation admission/evidence; `scripts/inspect_doom.mjs` checks the WASM interface; `scripts/stage_web.mjs` verifies/stages artifacts; `scripts/check_worker.mjs` protects Worker packaging.
- `README.md` is the project entry point; `app/README.md` is the setup/run guide. `docs/` retains build/provenance references and historical results/verification records. Retired experiments and superseded plans are recoverable from Git history. Do not silently move or delete ignored assets/artifacts, including any historical `references/doom.wasm/build/` outputs. New engine outputs belong under `engine/doom/build/`.

Older Stage A3/B/C/D full-contract plans and the M4-C investigation are superseded historical/deferred design scope in Git history, not automatic prerequisites for the accepted MVP or descriptions of current features.

## Build, Test, and Development Commands

Obtain owner approval before dependency installs/downloads, builds, opening a server/browser, authenticated or billable API calls, commits/pushes, or GitHub mutations. After approval, from the repository root:

- `npm --prefix app ci --no-audit --no-fund`: install locked frontend dependencies.
- `./build.sh`: build a fresh `controlled-title` engine with fixtures enabled and no embedded WAD, stage verified WASM/metadata/notices under ignored `app/public/`, and build `app/dist/` with output verification.
- `./build.sh --frontend-only`: reuse only the previously verified, locally generated current engine artifact. Missing evidence, changed engine inputs, or mismatched bytes require a full build; **this cannot run first from a fresh checkout**.

The app automatically loads generated/bundled `doom.wasm` on preparation. The IWAD stays locally user-selected and **must not be packaged**; the app accepts only the known-good Freedoom 0.13.0 Phase 1 asset documented in [app/README.md](app/README.md).

Provision tools separately: Node **22.20.0**/npm, Python **3.14.4**, GNU Make **3.81**, WASI SDK **24.0**, Binaryen **119**, and Git on the tested macOS host. See [app setup/build instructions](app/README.md) and [engine build/fixture documentation](docs/doom-build.md) for tool paths and constraints. Builds never install tools. Make owns the engine build graph; use the wrapper rather than legacy targets.

Legacy upstream `all`, `doom`, example, dev-init, clean, and hook targets require separate authorization. They may download/embed game assets, install dependencies, create environments, use Docker, or clone/build Binaryen. Inspect their Makefile/README effects first; the historical shareware profile is not the app's no-IWAD workflow.

With dependencies already installed, app checks are:

- `npm --prefix app run check`: DOM and Worker TypeScript checking, static Worker packaging/import checks, offline Worker entry smoke, then non-writing Biome lint/format checks.
- `npm --prefix app run typecheck`: `tsc --noEmit` for the DOM config and `tsconfig.worker.json`.
- `npm --prefix app run lint`: `biome lint .`, without writes.
- `npm --prefix app run format`: `biome format --write .` — **writes files**.

`npm --prefix app run build` verifies staged assets, typechecks, runs Vite, and verifies emitted assets; use `build.sh` for the engine handoff and Worker check. Builds do not format source. An old `app/dist/` after a failed build is not new build evidence.

## Coding Style & Naming Conventions

Match the surrounding code. Reference C code uses LLVM clang-format style with two-space indentation; `.clang-format` disables include sorting because ordering matters. Python helpers use snake_case names; the WebAssembly API uses names such as `tickGame` and `reportKeyDown`.

Biome is the app's linter/formatter, including the app-owned `app/src/worker.ts`. Vite packages this entry as an ES module Worker; the controller uses the literal `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` form. `worker-shared.ts` owns side-effect-free receipt types and the native step verifier used by both contexts. Never import executable Worker startup code into the main thread or serialize functions into Worker source. `scripts/check_worker.mjs` checks the constructor, ES output setting, CSP, and import boundary without executing the Worker. The tiny offline entry smoke checks module imports and unknown-operation retirement without native WASM. Retired experiment files are not app build/check dependencies. Preserve native initialization, step verification, passive rendering/snapshots, and idle-state contracts.

Use the smallest useful experiment and Codex for bounded investigations, implementations, and reviews. Keep changes focused and preserve proven engine/Worker behavior. Vendored hooks can download tools or alter tracked files; inspect their effects before running them.

## Testing Guidelines

Distinguish static inspection/checks, successful build evidence, and actual browser/API evidence. Source checks and builds alone do not establish Chrome runtime correctness. The owner reports successful production builds and Chrome rendering of real E1M1, neutral-first requested/reported/verified **1/1/1**, and no simulation advancement during passive snapshots/rendering or five-second idle. See the [M4-B verification record](docs/doom-m4b-verification.md); historical version/path references there are not current configuration. Do not present owner-run browser results as tests personally run by Codex.

For M4-C, the owner reported **14 successful decisions using real Decisions API responses in Chrome**, with five supplied receipt summaries (decisions 1, 2, 3, 13, 14), including **N=6 → N=2** while gameplay continued, and no visible gameplay during the final idle observation. See the [M4-C verification record](docs/doom-m4c-verification.md) for detailed evidence and limitations. Complete Worker-instance ID evidence, frame-hash/payload proof, exact network accounting, instrumented post-decision idle equality, and full browser failure-path verification were not supplied. The owner accepted this reduced MVP scope; acceptance does not establish those uncollected proofs.

For authorized runtime changes, rebuild and follow the isolated Chrome smoke steps in [app/README.md](app/README.md), recording native/Canvas/idle receipts and Console/Network observations. Engine fixture checks are in [docs/doom-build.md](docs/doom-build.md); no engine runtime suite or coverage threshold is defined. Report exactly what was exercised; SDK availability is not authenticated Decisions evidence.

## Repository Hygiene and Distribution

Preserve upstream notices, licenses, and source/build provenance; review engine changes against the pinned source documented in vendor provenance. Before public distribution, review redistribution rights, GPL corresponding-source/build obligations, third-party notices, and unresolved vendored asset rights. Bundled license files alone do not establish compliance.

## Commit & Pull Request Guidelines

Use concise, descriptive commit subjects and keep changes focused.

Pull requests should describe the change, link relevant issues, and list validation performed. Include screenshots for visual changes. Doom source, adapter, and build changes are reviewed and committed with the root repository as ordinary file changes.
