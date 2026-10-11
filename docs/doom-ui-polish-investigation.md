# Doom Decisions UI polish investigation

**Read-only investigation / not an authorized implementation plan**

**Date:** October 11, 2026

**Inspected commit:** `7351b68473a9e35653dd8d8a5acd6f671ba6d907`

This document preserves the investigation already reported in the Codex conversation, with light Markdown edits and repository-relative links. Findings describe that inspection snapshot; recommendations are proposals requiring separate authorization. An Impeccable hands-on critique is a possible follow-up, not something already performed. The owner-supplied loaded-game screenshot was an input/reference and is not included as a repository asset.

## 1. Baseline

**Recommend a native HTML/CSS polish pass, with a narrowly bounded presentation change in `display()`.** Prioritize the game, its action controls, and the latest result; retain complete diagnostics behind disclosures. Web Awesome has useful candidates, but the reviewed components do not yet justify changing this MVP's working control contracts.

- **HEAD:** `7351b68473a9e35653dd8d8a5acd6f671ba6d907` on `main`; clean worktree at investigation time. Local `origin/main` pointed to the same commit; no remote fetch was performed.
- Worker migration `a268837` and subsequent cleanup `7351b68` were present. Local tag `v0.1.0` resolved to `73fc395`.
- Read root [AGENTS.md](../AGENTS.md), both [root](../README.md) and [app](../app/README.md) READMEs, UI/controller source, configuration, and validation-script structure. No applicable nested `AGENTS.md` was found.
- Actual frontend: vanilla TypeScript, Vite, CSS, OpenAI SDK; no React, Tailwind, or Web Awesome dependency.
- **Observed:** the supplied screenshot showed a loaded game at tic 13, two complete receipts, and a blank key field. Its composition matched the source.
- **Owner-reported:** successful native/browser/API operation and prior acceptance. Codex did not reproduce those results. Empty, preparing, pending, error, and narrow-screen appearances remained visually unverified.

Entry points are [app/index.html:12](../app/index.html#L12), [app/src/main.ts:23](../app/src/main.ts#L23), and [app/src/style.css:1](../app/src/style.css#L1). Line references throughout this report refer to the inspected commit.

Existing commands are defined in [app/package.json:9](../app/package.json#L9): `check`, `typecheck`, `lint`, writing `format`, and asset-verifying `build`. Separate offline decision checks and the verified frontend build wrapper also exist. **None were run.**

## 2. UI inventory

Locations below distinguish presentation work from behavior changes. Bare file references in the tables are relative to `app/`, except where otherwise stated.

| Feature | Exact source location | Current implementation | Safe polish seam / coupling risk |
|---|---|---|---|
| Layout and typography | `index.html:12`; `src/style.css:1`, `main`, `.controls` | One column; 850px content maximum; system font; dark background. No media queries. | Semantic wrappers, spacing, responsive grid, colors, and typography are presentation-only. Preserve logical DOM/tab order. |
| Game viewport | `index.html:28`; `src/style.css:67` `canvas`; `src/main.ts:375` `render()` | Intrinsic 640×400; displayed at 640px maximum, shrinking responsively. No `image-rendering` rule. | Change **CSS display dimensions only**. Keep intrinsic dimensions, Canvas object, rendering, readback, hashing, and PNG capture untouched. |
| Local IWAD | `index.html:16`; `src/main.ts:767` `prepare()`, `:899` change listener | Native file input, `.wad` filter, exact size/hash validation. Locks during preparation and afterward; asset-validation failures permit correction. | Style native picker/`::file-selector-button`, label, and help. Replacing it changes element typing and `files` access at `:776`. |
| API key | `index.html:20`; `src/main.ts:596`, `:208` `retire()`, `:900` page lifecycle | Password input; no reveal control. Captured and cleared on click; client retained in memory. Enabled only when ready. | Style and shorten/reorganize help while preserving trust, direct transmission, clearing, and replacement instructions. Blank does **not** mean no client. |
| Duration | `index.html:23`; `src/main.ts:591`; `src/decision.ts:24` `admitDecision()` | Native number input, 1–20, step 1, default 6. Handler validates `valueAsNumber`; admission freezes N before awaiting. | CSS/help is safe. Custom control replacement requires a value adapter and explicit regression review. No input/change listener currently dispatches actions. |
| Primary action | `index.html:25`; `src/main.ts:181` `display()`, `:588` click handler | One native button/listener. `display()` sets disabled and `aria-busy`; admission guard prevents overlap. Button text stays unchanged while pending. | Style `[aria-busy="true"]`, hover, focus, disabled states. Preserve `type="button"` and the single listener. |
| Readiness/errors | `index.html:15`, `:27`; `src/main.ts:639`, `:661`, `:687`, `:705`, `:717`, `:721`, `:914` | SDK and operational status regions; explicit preparation, request, verification, recovery, and retirement text. | Style persistent text. There is no typed UI severity field: a recovered API failure returns to `ready`, so phase alone cannot safely mean “success.” |
| Results/history | `index.html:34`; `src/main.ts:190` receipt loop | Ordered chronological list; every entry contains full multiline engineering receipt. Action and latency appear here. No dedicated latest-result summary. | Compact summaries plus full receipts require a small presentation change. Existing `item.textContent` replaces children, so nested disclosure cannot be added by HTML/CSS alone. |
| Frame/evidence/footer | `index.html:29`, `:30`, `:36`; `src/main.ts:184`, `:415` | Full hash visible; JSON inside native `<details>`; long operational/license paragraphs. | Move `#frame` into disclosure without changing its writer; demote footer while preserving notices and links. |
| Accessibility | `index.html:16–35`; `src/style.css:82` | Associated labels, described-by help, live status, Canvas label, ordered history, visible focus outline. | Preserve these strengths. Add consistent control contrast and sizing. Field-specific invalid state/focus is absent; adding it crosses into presentation behavior. |

`display()` is also called by Worker operations (`request()` at `app/src/main.ts:280`). It is a usable seam, but any edit there must leave disabled/busy assignments and evidence intact.

## 3. Ranked design opportunities

| Rank | Improvement and evidence | Precise scope | Risk / later visual confirmation |
|---|---|---|---|
| **1** | **Make Doom dominate.** The screenshot places substantial setup copy above a 640px canvas despite wider available content. | Compact header/setup; action bar and status adjacent to the game; enlarge `canvas` through CSS; add `image-rendering: pixelated`. | **Low.** Preserve 8:5 and intrinsic 640×400. Confirm full HUD, sharpness, and useful height at desktop/narrow widths. Fractional scaling cannot guarantee uniform pixel sizes. |
| **2** | **Separate latest outcome from diagnostics.** Two receipts already occupy substantial space; full hash is immediately visible. | Small latest-result projection; compact chronological receipt summaries with native disclosures; move full frame metadata into evidence. | **Low–medium:** bounded `display()` work. Preserve selected action/N, verified execution, uncertainty, and frame-unavailable distinctions. Confirm disclosures stay open across updates. |
| **3** | **Make tics + Next Decision one obvious interaction.** Current button and inputs look like browser defaults. | Existing `#tics`, `#next`, `.controls`; one restrained accent, consistent heights, visible pending treatment based on existing `aria-busy`. Show “1–20 tics; one request per click.” | **Low.** No new dispatch or form submission. Confirm disabled/pending readability and keyboard focus during disable/re-enable. |
| **4** | **Compress setup without obscuring credentials.** Long setup prose pushes the game down; blank key after capture is ambiguous. | Compact desktop setup grid, stacked narrow layout; visible local-file/direct-to-OpenAI/in-memory explanation. | **Low** for layout/copy. A dynamic “client captured” indicator would require separate presentation logic and must never imply authentication was verified. |
| **5** | **Create a restrained dark visual system.** Current page has good basic text contrast but white default controls and little hierarchy. | `app/src/style.css`: local tokens, `color-scheme: dark`, consistent surfaces/borders/spacing, retained focus ring, border-box sizing and wrapping. | **Low.** Verify contrast, zoom, long IDs, file-picker width, and touch targets. Keep licenses legible. |

A flexible action row leaves room for later work without adding placeholders, Play/Stop, or other speculative controls.

## 4. Web Awesome component fit matrix

The investigation reviewed the official [catalog](https://webawesome.com/docs/components), installation/usage documentation, and individual APIs. At review time, the catalog presented version **3.14.0**. The eight candidates below were documented **stable**: number/file input since 3.2; the others since 2.0.

“Defer” means viable for a later bounded evaluation; “reject” means unnecessary for this polish pass. No installation is authorized.

| UI need | Candidate + official API | Core/Pro | Actual payoff | Integration implications/risk | Native alternative | Verdict |
|---|---|---|---|---|---|---|
| Next Decision | [`wa-button`](https://webawesome.com/docs/components/button/) | Core | Consistent action styling; built-in loading state retains width. | Retain ordinary `click`, explicit `type="button"`, and one handler. Change `Elements['#next']` type; map existing phase to `.loading` and `.disabled`. Verify keyboard activation, focus, and busy announcement. | Styled `<button>` with reserved pending-indicator space and existing `aria-busy`. | **Defer; strongest control candidate.** Concrete loading benefit, but native is already semantically correct. |
| BYOK key | [`wa-input`](https://webawesome.com/docs/components/input/) | Core | Integrated accessible label/hint and consistent appearance. | Supports password, `.value`, `.disabled`, ordinary `input`/`change`, and focus methods. Preserve property-based capture/clearing at every existing path. Use documented label/hint interface; verify association. Keep password reveal/clear features off. | Existing password input and associated help, styled consistently. | **Defer.** Mostly styling benefit; credential migration adds review burden. |
| Integer tics | [`wa-number-input`](https://webawesome.com/docs/components/number-input/) | Core | Visible increment/decrement controls; numeric keyboard, min/max/step validation. | Ordinary `input`/`change`; custom `wa-invalid`. Documents `.value`, **not `valueAsNumber`**. Requires explicit empty/invalid parsing adapter and typed selector change. Preserve click-time integer check and frozen N. | Native number input with visible range help. | **Defer; second strongest control candidate.** Useful steppers, but a real value-contract change. |
| Local IWAD | [`wa-file-input`](https://webawesome.com/docs/components/file-input/) | **Pro** | Styled picker/dropzone and selected-file presentation. | `.files` is `File[]`, rather than native `FileList`; ordinary `change`/`input`. Preserve single selection, `.wad`, lock timing, and local validation. | Native file input with styled selector button, label, and state text. | **Reject.** Not available as a Core/free drop-in; no need for drag/drop scope. |
| Ready/setup marker | [`wa-badge`](https://webawesome.com/docs/components/badge/) | Core | Small consistent visual marker. | Presentational default slot and variant; no announcement guarantee replaces the existing status region. Avoid attention animations. Wrapping existing `#status` avoids controller type changes. | Text plus small CSS marker. | **Reject.** Little benefit for one persistent status; badges on every receipt would add clutter. |
| Persistent error/help | [`wa-callout`](https://webawesome.com/docs/components/callout/) | Core | Clear, persistent message treatment; icon optional. | Can wrap existing status paragraph without event changes. Variant switching needs reliable severity mapping; recovered failures can be `ready`. Preserve live-region text and recovery instructions. | Styled semantic paragraph/section with border and background. | **Defer.** Good feedback component if library is otherwise adopted; insufficient alone. |
| Evidence/receipt disclosure | [`wa-details`](https://webawesome.com/docs/components/details/) | Core | Consistent disclosure styling, optional animation, summary slot, `.open`. | `wa-show`/`wa-hide` and after-animation events differ from native `toggle`. No gameplay listener should be attached. Preserve disclosure nodes/open state through updates. | Existing `<details>/<summary>` with lightweight CSS. | **Reject.** Native already provides the needed keyboard interaction and disclosure. |
| Setup/action/history grouping | [`wa-card`](https://webawesome.com/docs/components/card/) | Core | Header/footer/media slots and coherent panel appearance. | Mostly presentational; adds custom-element styling/upgrade. Slotted canvas must keep its dimensions. Cards do not supply section headings automatically. | `<section>`, headings, CSS border/background. | **Reject.** Nested cards would compete with Doom; plain sections suffice. |

Other requested candidates:

- [`wa-spinner`](https://webawesome.com/docs/components/spinner/), **Core, stable**: defer; useful for indeterminate waits, but redundant with button loading or a simple native pending indicator. Pair with text and respect reduced motion.
- [`wa-slider`](https://webawesome.com/docs/components/slider/), **Core, stable**: reject; exact integer entry is already straightforward. A synchronized number/slider pair adds state wiring.
- [`wa-divider`](https://webawesome.com/docs/components/divider/), **Core, stable**: reject; CSS borders or semantic `<hr>` cover this need.
- [`wa-accordion`](https://webawesome.com/docs/components/accordion/), **Core, stable since 3.8**: reject; no need for coordinated disclosure navigation.
- [`wa-tag`](https://webawesome.com/docs/components/tag/), **Core, stable**: reject; action labels are output, not removable selections or filters.
- [`wa-tooltip`](https://webawesome.com/docs/components/tooltip/), **Core, stable**: reject; local-file, credential, duration, and recovery instructions should remain visible.
- [`wa-icon`](https://webawesome.com/docs/components/icon/), **Core, stable**: reject as an added dependency here. Icon assets have separate licensing/access considerations; default icons resolve from Font Awesome's CDN, while internal system icons are embedded data URIs.

**Loading, styling, and CSP implications.** Custom controls require component registration before property/method access; the usage docs provide `customElements.whenDefined()`. Boolean properties must remain booleans, rather than attributes containing `"false"`. Shadow DOM means current `button`, `input`, and `:disabled` selectors cannot simply style internal controls; use tokens and documented CSS parts. Confirm focus reaches the internal control and that external descriptions remain accessible. [Usage documentation](https://webawesome.com/docs/usage/)

The documented npm approach imports `@awesome.me/webawesome/dist/styles/webawesome.css` plus selected component modules such as `dist/components/button/button.js`. Selective imports avoid deliberately loading the entire catalog, but still include component dependencies and shared runtime. Adoption changes `package.json`, the lockfile, imports, and notices. **No bundle size or startup cost was measured.** A later authorized comparison should measure emitted JS/CSS, dependencies/assets, request count, and first usable control timing against native. [Installation](https://webawesome.com/docs)

The inspected CSP permits local scripts/styles and OpenAI connections, with no default font/image allowance. Consequently, local bundling alone does not prove compatibility: verify shadow styling, internal icons, optional assets, and load failures under the **unchanged** policy. Do not use the CDN/autoloader approach or loosen CSP for polish.

**CSS-only Web Awesome is a real option.** Official docs explicitly support importing `styles/themes/default.css` and `styles/native.css` without custom-element controls. This preserves native value/events while supplying consistent styling; tokens can also style ordinary HTML. However, native styles affect page-wide typography, spacing, controls, and disclosures, so regression scope remains broader than a few local rules. Default, Awesome, and Shoelace are free themes; premium themes such as Brutalist are Pro. [Native styles](https://webawesome.com/docs/utilities/native/), [tokens](https://webawesome.com/docs/tokens/), [themes](https://webawesome.com/docs/themes)

Core—including its supporting assets/code—is MIT; distributed portions require the copyright and permission notice. CSS-only use still carries that obligation. Pro uses a separate license, and no Pro entitlement was established here. [Core license](https://webawesome.com/license), [Pro license](https://webawesome.com/license/pro/)

**Decision test:** button + number input is a coherent Core subset with specific benefits. It is viable for a separate experiment, but those benefits do not solve the larger composition/evidence hierarchy problem. Native HTML/CSS wins this first pass; a button-only hybrid would still require shared styling and native control styling, while delivering one comparatively small benefit.

## 5. Options and Impeccable process

| Approach | Assessment |
|---|---|
| **Vanilla + direct Codex design** | **Recommended.** Existing evidence identifies a bounded hierarchy problem; no new runtime or workflow installation. |
| Vanilla + Impeccable | Conditional later critique; preserves runtime simplicity but adds workflow setup and generated artifacts. |
| Selective Web Awesome + direct Codex | Viable if loading/stepper consistency becomes an explicit priority after the layout pass. |
| Selective Web Awesome + Impeccable | Adds two independent variables; excessive for testing this small design direction. |

Impeccable was **not exposed among the investigation session's available skills**. Scoped searches of the known local skill/plugin locations found no Impeccable skill reference; this was not a machine-wide installation audit.

Its critique workflow combines source review, automated anti-pattern checks, and rendered inspection when browser tools exist. That could improve a later review of multiple states, but it cannot replace missing screenshots or prove gameplay correctness. Critique leaves the design unchanged **but saves reports under `.impeccable/critique/`**, so it is not a filesystem-read-only operation. [Critique guidance](https://impeccable.style/docs/critique/)

If separately approved, the minimal process would be:

1. Inspect/approve the installer and install the Codex skill at a chosen scope; reload.
2. Supply the existing product constraints. `$impeccable init` writes `PRODUCT.md`; optional documentation writes `DESIGN.md`.
3. Request one scoped `$impeccable critique` of owner-supplied screenshots/source, explicitly excluding implementation and gameplay changes.
4. Review its saved findings before authorizing fixes.

The documented installer is `npx impeccable install`; it can download/execute code and write skill files. Code-led review needs no image generation. [Getting started](https://impeccable.style/tutorials/getting-started/)

Configuration writes under `.impeccable/` are additional effects. Automatic hooks are optional executable checks requiring separate setup/trust; omit them from this minimal trial. Browser execution and image generation would also need separate authorization. [Configuration](https://impeccable.style/docs/config/), [hooks](https://impeccable.style/docs/hooks/)

This evaluation was based on documentation and scoped environment inspection. No Impeccable installation, command, detector, hook, or hands-on critique was performed.

## 6. Minimum viable pass — proposed, not authorized

Propose **three files only**:

- **`app/index.html`:** compact setup grouping; action/status next to the viewport; semantic latest-result slot; full metadata inside evidence; restrained footer.
- **`app/src/style.css`:** responsive canvas display, pixelated scaling, dark native controls, consistent spacing/borders, primary action emphasis, wrapping and focus.
- **`app/src/main.ts`, presentation inside `display()` only:** latest-entry projection and compact receipt disclosures retaining the existing full receipt text. Update persistent nodes so focus/open state survives subsequent displays.

Keep every ID/native control type and existing event listener. Preserve the distinction between a selected action, verified execution, and a verified resulting frame.

Exclude `app/src/decision.ts`, Worker/shared code, engine/WASM/ABI, SDK/request logic, initialization/rendering, CSP, dependencies, build scripts, and generated assets. No new gameplay controls, automatic collapsing, authentication checks, timers, or requests.

This is the smallest useful experiment because it tests **composition, control clarity, and evidence hierarchy together**, using the functioning integration and existing receipt data.

## 7. Future validation plan — only after authorization

**Existing checks:**

```sh
npm --prefix app run check
node --experimental-strip-types app/tests/decision.mjs
git diff --check
./build.sh --frontend-only
```

The wrapper requires valid existing native evidence; otherwise follow the separately authorized full-build procedure. `check` includes typechecking, Worker packaging checks, offline entry smoke, and non-writing Biome checks. The decision script exercises admission/receipt contracts, not DOM or browser behavior. Biome's configured file set excludes `index.html`; manually review its semantics and CSP.

**Before/after capture and interaction checklist:**

- Capture empty/setup, preparation, loaded tic 1, pending, completed result, and safely reachable validation errors at desktop and roughly 360–390px widths.
- Pending/completed/API-error screenshots requiring real requests remain owner-directed. Do not trigger authentication failures merely to obtain a screenshot.
- Tab through labels, fields, button, disclosures, and license links; test Enter/Space and visible focus, including disable/re-enable behavior.
- Check blank/fractional/out-of-range tics and missing key: no request or native dispatch. Confirm one admitted click and frozen duration during pending work.
- Verify 8:5 canvas, complete HUD, pixel presentation, no horizontal overflow, long receipt/hash wrapping, and 200% zoom.
- Preserve requested/reported/verified accounting and uncertainty wording. Confirm passive waits/disclosure/layout interaction do not advance gameplay.
- Follow the existing [isolated Chrome smoke procedure](../app/README.md#owner-run-isolated-chromeapi-trial-not-executed-by-codex); inspect Console/Network for CSP failures and unexpected assets/requests.
- Capture no real key, private paths, authorization headers, or raw request exports. Verify no IWAD is bundled.
- Finish with an independent read-only diff review focused on presentation boundaries, persistent disclosure nodes, event wiring, and credential clearing.

Static checks/builds must be reported separately from actual Chrome/native/API evidence.

## 8. Unknowns / owner input

No clarification was needed to discuss this scope. The missing visual evidence was limited to **empty/preparing**, **pending/error**, and **narrow-width** states. Owner screenshots of those states would materially improve the later polish review; no additional billable requests were needed for this investigation.

## 9. Investigation mutations

**None during the investigation.** No files were generated or edited; no installs, tests, builds, server/browser execution, gameplay/API calls, Git state changes, or GitHub mutations were performed. No secret values, WAD bytes, or private browser storage were read.

Saving this document is a subsequently authorized documentation-only action; it does not authorize Impeccable installation/critique or UI implementation.
