# Repository Guidelines

## Project purpose

Let users watch Doom in the browser while OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions) controls gameplay.

The owner-accepted **v0.2.0 Continuous Mode MVP** is the prototype baseline, not a production certification. It is a standalone static browser app with a bundled module Worker, modified native Doom WASM, and a user-selected local Freedoom Phase 1 IWAD. Selecting the IWAD automatically prepares a fresh Worker/game in real E1M1 and verifies exactly one mandatory neutral first tic, without an API request.

The user supplies an API key in the browser for browser-direct BYOK calls through the official OpenAI Decisions SDK (`decisions.create`). This is an intentionally temporary MVP architecture with no backend/proxy and no claim of production credential security; see [credential behavior and trust boundaries](app/README.md#temporary-browser-direct-credentials).

Manual **Next Decision** admits one model-selected action; **Start Continuous Mode** explicitly admits sequential decisions through the same pipeline. The user controls duration: any **positive JavaScript safe integer N of tics, default 6**, captured per admitted decision before asynchronous work. N changes during continuous play affect only later decisions. The model selects only `neutral`, `forward`, `turn_right`, `backward`, `turn_left`, `fire`, or `use`, never duration or combined actions. Healthy successes retain one persistent Worker/native game session. API waits, screenshots, passive rendering/snapshots, and idle must not advance gameplay.

Continuous Mode freezes a positive safe-integer **per-run SDK-attempt budget, default 2**, separate from N and **not capped at 20**. Charge one unit when each `decisions.create` invocation starts, including failed or canceled attempts; preparation and pre-request failures consume none. There are no refunds, implicit retries, or automatic restarts. Manual admission stays locked while a continuous run owns admission or cleanup. See [Continuous Mode](app/README.md#continuous-mode).

**Stop** fences late SDK responses from native dispatch. Before dispatch, await SDK cleanup and prove unchanged native state before restoring manual readiness. After dispatch, finish receipt/resulting-frame verification; a healthy verified result preserves manual play. Unsupported states, uncertain native outcomes, or unverifiable frames retire the Worker and require reload. Verified death and **E1M1 exit pending** stop at the independently verified tic prefix and retire after terminal-frame verification; exit pending is not proof of intermission or E1M2. There are no Prepare, Reset, or New Game controls. Refresh starts a new session and clears in-memory credentials.

## Project Structure & Module Organization

- `engine/doom/`: locally modified upstream Doom/WASM source, tracked as ordinary root-repository files and the source of truth for compilation. `src/` holds the adapter/WAT helpers; `doomgeneric/` holds the engine. Do not recreate a nested repository or submodule. See [vendor provenance](docs/doom-vendor-provenance.md).
- `app/`: static browser application using vanilla TypeScript and DOM APIs, plain CSS, and an app-local `package-lock.json`. Exact pins in `app/package.json`: TypeScript **7.0.2**, Vite **8.3.4**, official OpenAI SDK **7.32.0**, Biome **2.5.15**. No React or Tailwind.
- `build.sh`: thin engine → verified staging → Vite build wrapper. `scripts/build_doom.py` owns compilation admission/evidence; `scripts/inspect_doom.mjs` checks the WASM interface; `scripts/stage_web.mjs` verifies/stages artifacts; `scripts/check_worker.mjs` protects Worker packaging.
- `README.md` is the project entry point; `app/README.md` is the setup/run guide. `docs/` retains build/provenance references. Historical reports, retired experiments and superseded plans are recoverable from Git history. Do not silently move or delete ignored assets/artifacts, including any historical `references/doom.wasm/build/` outputs. New engine outputs belong under `engine/doom/build/`.

Older Stage A3/B/C/D full-contract plans and the M4-C investigation are superseded historical/deferred design scope in Git history, not automatic prerequisites for the accepted MVP or descriptions of current features.

## Build, Test, and Development Commands

Obtain owner approval before dependency installs/downloads, builds, opening a server/browser, Worker/WASM runtime execution, game-asset use, authenticated or billable API calls, commits/pushes, or GitHub mutations. After approval, from the repository root:

- `npm --prefix app ci --no-audit --no-fund`: install locked frontend dependencies.
- `npm --prefix app run dev`: start ordinary Vite development with the strict CSP.
- `npm --prefix app run dev:impeccable`: opt into Live-compatible development at `http://127.0.0.1:5173/`; keep it running in a separate terminal. Only Vite `serve` in `impeccable` mode adds the localhost helper (`http://localhost:8400`) to script/connect sources, inline styles, and the Vite HMR WebSocket. Ordinary development and production builds retain the strict policy.
- `./build.sh`: build a fresh `controlled-title` engine with fixtures enabled and no embedded WAD, stage verified WASM/metadata/notices under ignored `app/public/`, and build `app/dist/` with output verification.
- `./build.sh --frontend-only`: reuse only the previously verified, locally generated current engine artifact. Missing evidence, changed engine inputs, or mismatched bytes require a full build; **this cannot run first from a fresh checkout**.

**Impeccable Live Mode:** with the opt-in dev server running, send `$impeccable live` in Codex chat. Reuse the existing Vite instance; Live starts a separate helper on port 8400. The user manually opens the app URL, selects an element, requests variants, and chooses Accept or Discard while Codex services the live poll. Generation, Discard restoration, and exit cleanup have been exercised; this is not gameplay/API evidence.

Expect temporary edits to `app/index.html` (picker script, variant markup/styles, and possibly CSP metadata), plus state under `app/.impeccable/live/` and helper-managed ignores in `app/.gitignore`. Keep the source CSP strict; if Live's CSP rewrite conflicts with the Vite adapter, restore the strict meta element while retaining the picker injection, letting the opt-in adapter supply allowances. Never widen the production policy. Live work does not authorize game-asset use, Worker/WASM execution, or authenticated/billable calls; retain the approval requirements above and all gameplay/credential invariants.

On exit, stop the poll and run `.agents/skills/impeccable/scripts/impeccable live-server stop` from the repository root. Verify removal of the picker injection, temporary variant/carbonize wrappers and preview styles, and restoration of the strict source CSP; Discard restores the original selection, while accepted changes must become ordinary source. Inspect the diff before any build or commit. Local configuration/ignored session history may remain. The separately started Vite server stays running until its owner stops it with **Ctrl+C**.

The app automatically loads generated/bundled `doom.wasm` on preparation. The IWAD stays locally user-selected and **must not be staged, bundled, or committed**; the app accepts only the known-good Freedoom 0.13.0 Phase 1 asset documented in [app/README.md](app/README.md).

Provision tools separately: Node **22.20.0**/npm, Python **3.14.4**, GNU Make **3.81**, WASI SDK **24.0**, Binaryen **119**, and Git on the tested macOS host. See [app setup/build instructions](app/README.md) and [engine build/fixture documentation](docs/doom-build.md) for tool paths and constraints. Builds never install tools. Make owns the engine build graph; use the wrapper rather than legacy targets.

Legacy upstream `all`, `doom`, example, dev-init, clean, and hook targets require separate authorization. They may download/embed game assets, install dependencies, create environments, use Docker, or clone/build Binaryen. Inspect their Makefile/README effects first; the historical shareware profile is not the app's no-IWAD workflow.

With dependencies already installed, app checks are:

- `npm --prefix app run check`: DOM and Worker TypeScript checking, static Worker packaging/import checks, offline Worker entry smoke, then non-writing Biome lint/format checks.
- `npm --prefix app run typecheck`: `tsc --noEmit` for the DOM config and `tsconfig.worker.json`.
- `npm --prefix app run lint`: `biome lint .`, without writes.
- `npm --prefix app run format`: `biome format --write .` — **writes files**.

After separate test authorization, run the dedicated Node suites with `node --experimental-strip-types app/tests/decision.mjs`, `node --experimental-strip-types app/tests/terminal.mjs`, and `node --experimental-strip-types app/tests/continuous.mjs`. **`check` does not run these three suites**; its Worker-entry smoke is separate. These offline suites exercise admission/receipts and controller behavior with synthetic or mocked state, including the pinned SDK with rejecting/delayed offline transport; they do not establish real browser/API/WASM behavior.

Read-only inspection and non-writing syntax/diff checks include `git status --short`, `git diff`, `git diff --check`, `rg`, `bash -n build.sh`, and `node --check scripts/stage_web.mjs`. Honor task-specific execution limits; a documentation-only task does not authorize tests or runtime execution.

`npm --prefix app run build` verifies staged assets, typechecks, runs Vite, and verifies emitted assets; use `build.sh` for the engine handoff and Worker check. Builds do not format source. An old `app/dist/` after a failed build is not new build evidence.

## Coding Style & Naming Conventions

Match the surrounding code. Reference C code uses LLVM clang-format style with two-space indentation; `.clang-format` disables include sorting because ordering matters. Python helpers use snake_case names; the WebAssembly API uses names such as `tickGame` and `reportKeyDown`.

Biome is the app's linter/formatter, including the app-owned `app/src/worker.ts`. Vite packages this entry as an ES module Worker; the controller uses the literal `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` form. `worker-shared.ts` owns side-effect-free receipt types and the native step verifier used by both contexts. Never import executable Worker startup code into the main thread or serialize functions into Worker source. `scripts/check_worker.mjs` checks the constructor, ES output setting, CSP, and import boundary without executing the Worker. The tiny offline entry smoke checks module imports and unknown-operation retirement without native WASM. Retired experiment files are not app build/check dependencies. Preserve native initialization, step verification, passive rendering/snapshots, and idle-state contracts.

Preserve `worker: { format: 'es' }` and the CSP in `app/index.html`: same-origin scripts/styles/Workers, `'wasm-unsafe-eval'` for WASM compilation, and `connect-src 'self' https://api.openai.com`, with default denial. Do not introduce Blob/raw-source Worker assembly or loosen these boundaries.

Preserve pre-dispatch session/attempt/Stop fences, no overlapping native requests, native-state verification, and observation/resulting-frame checkpoint and native/Canvas hash verification. Requested tics, Worker-reported consumption, and controller-verified tics are separate evidence; retain verified prefixes and terminal/uncertainty handling. Only fully verified actions and resulting frames permit another continuous iteration. Never treat uncertain completion as success or replay a consumed action.

**OpenAI SDK 7.32.0 reader ownership is mandatory:** `asResponse()`/`withResponse()` helpers and the actual underlying `response.text()` reader can settle at different times. Keep admission locked until both helpers and the underlying reader settle, including Abort/timeout cases; a never-settling read keeps controls locked. Do not weaken this by moving or simplifying cancellation/reader code in `app/src/main.ts`; `app/tests/continuous.mjs` covers the helper/reader race. Abort does not prove remote processing or billing stopped. Never copy credentials into logs, artifacts, history, or prompts.

Use the smallest useful experiment and Codex for bounded investigations, implementations, and reviews. Keep changes focused and preserve proven engine/Worker behavior. Vendored hooks can download tools or alter tracked files; inspect their effects before running them.

## Testing Guidelines

Distinguish static inspection/checks, successful build evidence, and actual browser/API evidence. Source checks and builds alone do not establish Chrome runtime correctness. The owner reports successful production builds and Chrome rendering of real E1M1, neutral-first requested/reported/verified **1/1/1**, and no simulation advancement during passive snapshots/rendering or five-second idle. See [prototype evidence](app/README.md#prototype-acceptance-and-evidence) for owner-reported preparation, manual-API and death observations and their limits. Do not present owner-run browser results as tests personally run by Codex.

Issues #15 (Continuous Mode) and #16 (terminal detection) were accepted for the v0.2.0 prototype with known evidence gaps, not exhaustive WASM instrumentation. The owner observed real Doom death detection at decision #48 with N=20 and cumulative tic 961. Independently instrumented browser/WASM terminal evidence remains uncollected, including exact Worker/frame linkage, exit-pending and early-prefix proof, as stated in [app/README.md](app/README.md#prototype-acceptance-and-evidence). Prototype acceptance, owner observations and synthetic suites do not establish uncollected runtime proofs.

For authorized runtime changes, rebuild and follow the isolated Chrome smoke steps in [app/README.md](app/README.md), recording native/Canvas/idle receipts and Console/Network observations. Engine fixture checks are in [docs/doom-build.md](docs/doom-build.md); no engine runtime suite or coverage threshold is defined. Report exactly what was exercised; SDK availability is not authenticated Decisions evidence.

## Repository Hygiene and Distribution

Preserve upstream notices, licenses, and source/build provenance; review engine changes against the pinned source documented in vendor provenance. Before public distribution, review redistribution rights, GPL corresponding-source/build obligations, third-party notices, and unresolved vendored asset rights. Bundled license files alone do not establish compliance.

## Commit & Pull Request Guidelines

Use concise, descriptive commit subjects and keep changes focused.

Pull requests should describe the change, link relevant issues, and list validation performed. Include screenshots for visual changes. Doom source, adapter, and build changes are reviewed and committed with the root repository as ordinary file changes.
