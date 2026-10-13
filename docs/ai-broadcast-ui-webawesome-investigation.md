# AI Broadcast UI and Web Awesome investigation

Date: 2026-10-13. Investigation only; implementation requires owner approval.

## 1. Executive recommendation

Use **vanilla TypeScript, native HTML, and CSS Grid** for the AI Broadcast direction. First test a three-zone shell by regrouping the existing setup/controls into a left rail, retaining the actual canvas and current status centrally, and keeping complete history on the right. Limit that experiment to `app/index.html` and `app/src/style.css`, retain the 640×400 CSS ceiling, and make no controller changes. Web Awesome provides useful components but no demonstrated advantage for this particular composition; reconsider selective adoption only when a specific interaction defect justifies it. Review canvas enlargement and a read-only verified-outcome projection separately.

## 2. Baseline and evidence

- Actual cwd and Git root: `/Users/mike/projects/doom-decisions`; origin: `https://github.com/mikechao/doom-decisions.git`.
- Branch: `main`; HEAD: `9246299ccc4c0413604c0c463c6d366217c63beb`. Initial `git status --short` was empty; no pre-existing changes. Earlier UI tag/checkpoint was context only; no checkout/reset occurred.
- Opened the actual tracked `ui-experiment.png`; its working copy matches HEAD (blob `244fc7c83892c102a3ee54f425fc4ec6c31f8677`). It shows a compact left control rail, large central game/HUD, latest-outcome strip, and tall newest-first history, with thin rules, near-black olive surfaces, warm copy, amber emphasis, and condensed display lettering. Gameplay and numbered results are illustrative. Its apparent framebuffer proportions must not override the real 8:5 frame.
- Read `AGENTS.md` first. Inspected `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, the Impeccable lessons report, and all requested app sources. Adjacent inspection was limited to action/phase definitions, relevant synthetic test seams, and the Worker packaging check.
- Evidence labels below: **Repository** means source inspection; **Documented** means official public documentation accessed **2026-10-13**; **Judgment** means an engineering recommendation, not runtime proof. No installs, builds, tests, server/browser launches, Live Mode, WAD use, Worker/WASM execution, or API calls occurred. Existing gameplay observations remain owner-reported, with the limits in `app/README.md:157–176`.

## 3. UI, DOM, and state findings

### Composition and safe file boundaries

**Repository:** Setup currently spans the console above `.experience`; the latter contains `.game` (canvas, controls, status) and `.history-panel`. Advanced evidence and notices follow the console (`app/index.html:17–99`). Desktop becomes two columns at 1168px; below that game/history stack. The page ceiling is 1184px (`app/src/style.css:25–29,672–749`). A third rail requires changing the shell width and grouping, not gameplay architecture.

The controller queries IDs globally, with explicit native element types (`app/src/main.ts:27–60`). Preserve one instance of each:

| Contract | IDs / behavior |
|---|---|
| Setup | `setup` is native `<details>` with its native `<summary>`; `setup-title`, `setup-asset`, `setup-client`; `iwad` is a file input; `key` is a password input; `key-state` is updated text. |
| Admission controls | `tics`, `budget` are native number inputs; `next`, `start`, `stop` are native buttons. Click listeners are attached once (`main.ts:1070–1074`); WAD `change` calls preparation (`:1216`). No key-input listener captures credentials. |
| Presentation/evidence | `screen` is the original canvas; `status`, `continuous-state`, `sdk`, `frame`, `evidence`, `history`, `history-empty` receive controller/history updates. |
| Accessible relationships | Preserve labels and IDs `asset-note`, `key-note`, `tic-rate`, `duration-note`, `continuous-note`, `stop-note`, `continuous-mode-title`, `history-title`, including their `aria-describedby`/`aria-labelledby` references (`index.html:26–93`). |

Moving intact groups in **static HTML before initialization** is feasible. Keep WAD/key and their guidance inside `#setup`; keep gameplay controls outside it so collapse cannot hide Stop. Do not replace nodes during updates, duplicate controls for mobile, remove IDs, override controller `disabled` states, hide live status, or simulate a file picker with unsupported upload behavior. Parent-dependent CSS must be revised deliberately, especially `.experience > section`, `.game` width/padding, compact-control selectors, and history containment.

### Setup, credentials, and readiness

**Repository:** `displaySetup()` (`main.ts:211–267`) collapses setup once only after verified preparation/frame, retained client, healthy ready phase, empty key field, and no focus inside setup. Deliberate expansion or recovery keeps it open. Summary clicks record expansion intent; `focusout` queues a reevaluation. Moving the key outside setup or replacing native summary activation would invalidate this behavior. Preserve the disclosure even though the illustration shows permanently exposed setup.

On fresh load all controls are initially disabled; initialization checks SDK availability and bundled engine metadata, then enables WAD selection (`:1231–1284`). Selecting the supported local Freedoom 0.13.0 Phase 1 IWAD automatically prepares E1M1, verifies one neutral tic and passive/idle checks, then enables key/tics/manual/Start (`:1076–1214`). No preparation history entry or API request is created. Keep the empty canvas honest and first-use instructions visible; no mock framebuffer, default “Loaded,” or authenticated badge.

Key capture happens on an admitted manual/continuous decision path: clear field, retain client in memory; blank retains it, nonblank replaces it (`:782–825`). Retained client explicitly means authentication unverified. Preserve masking, trust disclosure, refresh/page-exit clearing, and fatal retirement clearing (`:312–322,1217–1227`; `app/README.md:124–155`). Do not bind a projection to raw key values.

Readiness comes from the controller predicate in `display()` (`:272–310`), including validity, phase, terminal state, SDK-reader settlement, and continuous ownership. A ready phase alone is insufficient. Tics remain editable during an active non-stopping continuous run; budget/key/manual/Start remain locked. Preserve positive-safe-integer checks, default N=6 and budget=2, shared duration, 35 tics/second, per-admission N capture and per-run frozen budget. Invalid budget receives focus (`:1018–1022`); invalid tics currently reports status without programmatic focus (`:782–788`). Do not silently change these interactions.

### History, focus, and scrolling

**Repository:** `createDecisionHistory()` retains each numbered row and nested disclosures in a Map, prepending new entries without rebuilding older nodes (`app/src/decision-history.ts:63–149`). It updates summaries in place, distinguishes pending/unavailable actions, and calls success “Completed · verified and rendered” only with complete execution and a resulting frame (`:47–61,151–155`). Expansion keeps all seven supplied probabilities, descending with deterministic ties, explicit Selected marking, tiny-value notation, optional separate confidence, and native technical receipts (`:36–45,91–120,156–197`). Full hashes/native receipts remain in advanced JSON; row receipts are a compact projection, not the entire evidence object.

`ol#history` is reversed and keyboard-focusable. CSS bounds the panel, gives the list its own overflow, stable scrollbar gutter and contained overscroll; desktop history uses `contain: size` so it cannot grow the game row (`style.css:470–494,672–683`). There is no scripted scroll-to-newest or explicit scroll-position restoration. Preserve stable nodes and scroll container; verify Chrome anchoring rather than claiming guaranteed scroll preservation. Keep native Enter/Space disclosures, 44px minimum summary/field targets, 48px buttons, visible focus rings, live statuses, canvas accessible name, wrapped identifiers/receipts, and textual state/selection cues.

**Documentation mismatch:** `DESIGN.md:249–252` still says there is no bounded scroller; current CSS and the accepted history account in `docs/impeccable-doom-decisions-lessons-learned.md:170–178` supersede that description. Its older control measurements also lag the compact selectors. No repair is authorized here. Palette and behavioral rules remain useful; the new concept deliberately revisits rounded framing, typography and layout. `DESIGN.md:392`/sidecar `:519` also discourage duplicating the newest result; a later outcome strip should be an explicit design revision, preserving full history.

## 4. Mockup-to-real-state mapping

| Visual feature | Classification | Grounded implementation / truth condition |
|---|---|---|
| WAD card, filename and disabled picker | **Existing DOM/state** | Restyle `#setup`, `#iwad`, `#setup-asset`. Current summary distinguishes selected/prepared; do not reduce both to “Loaded.” Refresh-to-change guidance stays. |
| Temporary key and client note | **Existing DOM/state** | Keep native masked `#key`, capture/blank/replacement behavior and authentication-unverified copy. |
| Tics, Next, budget, Start/Stop | **Existing DOM/state** | Relocate intact native groups, validation/help and disabled states. No new Prepare/Reset or autoplay. |
| Central game | **Existing DOM/state** | Original `#screen`, complete HUD and 8:5 image. Black before preparation; retain last painted frame during waiting/failure with honest status. |
| E1M1 heading | **Derived presentation** | Show as current level only after successful preparation's native episode/map checks and verified frame (`main.ts:376–395,497–542`); otherwise “Game view” or setup instructions. Never imply E1M2 after exit pending. |
| Current run state below game | **Existing DOM/state** | Move `#status` and `#continuous-state`; preserve full cleanup/stopping/reload wording and live semantics (`:272–310`). |
| “Latest outcome #14 Fire; 6 tics completed; Frame verified” | **Derived presentation** | No dedicated current node. Later project decision number/action, captured N, verified execution and resulting-frame evidence from `DecisionEntry` (`:117–130,916–941`). Never hardcode illustration values. |
| Complete newest-first history with chevrons | **Existing DOM/state** | Keep every stable `decision-N` row, independent disclosures, supplied probabilities, Selected labels and receipt. No six-row cap, exclusive accordion or hidden older entries. |
| Advanced evidence | **Existing DOM/state** | Keep existing native disclosure and `#sdk/#frame/#evidence`, initially below the shell; no extra drawer required. |
| Combat scene/HUD numbers, illustrative decisions | **Unavailable/illustrative** | Only actual canvas/history can supply these. Do not extract mockup pixels or invent thumbnails. |
| Decision explanations, kill/progress claims, wall-clock timestamps | **Unavailable/illustrative** | No grounded narrative/event/timestamp stream exists. Actual API latency is available; it is not total execution time. |
| Thin dividers, dark olive surfaces, display lettering, “AI Broadcast” subtitle | **Pure decoration** | Optional CSS/static identity. Retain legible body type; use system fonts initially. No fake activity indicator, LIVE claim, scan animation or canvas overlay. |

### State distinctions for a later outcome strip

**Repository → judgment:** Use the existing update cadence; no polling, timers, extra snapshots, requests or state transitions.

- **First use:** no decisions means “No AI decisions yet,” with setup visible and no verified-outcome badge. Game readiness does not mean an API key exists or authenticates.
- **Active / verification pending:** show the latest entry's actual stage: capturing, requesting, stepping/verifying, or action verified/rendering (`main.ts:832–923`). Action selection and `execution.complete` alone do not establish a resulting frame. Keep the prior completed result explicitly labeled “Last verified decision” if shown while new work is pending.
- **Fully verified:** require `entry.status === 'Complete'`, complete execution without uncertainty, and `entry.result` with matching native/Canvas hashes. To claim that result corresponds to the **currently displayed frame**, also match its tic and hashes to `run.frame`. Otherwise present it as historical. Do not infer success from a button becoming enabled.
- **Stopped versus cleaning up:** continuous ownership, `stopRequested`, dispatch state and `sdkRead` already distinguish these (`:293–303,943–979,1006–1067`). Preserve “waiting for API response cleanup”; a never-settling reader keeps admission locked. Only the existing readiness predicate permits “Ready.” Stop does not establish remote cancellation or billing cessation.
- **Terminal/error:** show verified death/exit-pending prefixes and reload guidance; terminal execution is distinct from healthy Complete. A terminal frame is verified only when that terminal entry has its verified result; an unavailable result leaves prior imagery, which must not be described as the terminal frame (`:927–999`). Keep uncertainty/lower-bound accounting visible in receipts.
- **Volume/narrow widths:** bounded scrolling must retain all entries and independently expanded evidence. Wrap long statuses/actions/IDs; keep numerical percentages and Selected text readable. Stack regions instead of hiding history behind tabs or clipping disclosures.

## 5. Web Awesome assessment

Official site/docs currently identify **3.14.0**; the official [package source](https://raw.githubusercontent.com/shoelace-style/webawesome/next/packages/webawesome/package.json) agrees. This is an observation, not a proposed installation pin; reverify the published package before any future authorized adoption. All links in this section were accessed **2026-10-13**.

### Three concrete choices — engineering judgment

| Choice | Fidelity and integration | Responsive/accessibility and maintenance |
|---|---|---|
| **1. Vanilla — recommended** | Grid, restrained surfaces, typography and native controls can express the distinctive shell directly. Reuse IDs, native input reads and disclosure lifecycle; no additional JS or package. | Keep accepted keyboard/history behavior; add responsive CSS and visually verify. Existing scoped CSS is easiest to edit; this slice does not need a component system. |
| **2. Selective Web Awesome** | Retain custom shell; use a component only for an observed deficiency, potentially a nonessential tooltip. Native controls/disclosures already cover the core jobs. Mixed native/component styling requires token mapping and targeted CSS parts. | Potential benefit for complex positioning/focus behavior, offset by custom-element lifecycle/CSP tests and added dependency ownership. No demonstrated need today. |
| **3. Broader adoption** | Replace controls/disclosures and map suite tokens/themes. The game-centered layout still needs custom CSS; component defaults cannot supply the concept. Migration is substantially larger than the shell experiment. | More consistent library primitives across a larger future app, but greater JS/CSS, versioning, theme/asset/license work, and regression surface. No current benefit warrants it. |

### Verified components and commercial boundaries

**Documented:** These are current names/APIs, not assumed Shoelace equivalents:

- Free core: [`wa-button`](https://webawesome.com/docs/components/button/) has disabled state, variants/appearance and focus/click methods; [`wa-input`](https://webawesome.com/docs/components/input/) supports password inputs, labels/hints, value/disabled, and ordinary `input`/`change` events (plus `wa-clear`/`wa-invalid`). [`wa-number-input`](https://webawesome.com/docs/components/number-input/) provides min/max/step and numeric entry. These could replace controls but offer little functional gain here.
- Free core: [`wa-details`](https://webawesome.com/docs/components/details/) offers summary slot/property, `open`, show/hide methods and `wa-show`/`wa-hide`/after events. [`wa-tooltip`](https://webawesome.com/docs/components/tooltip/) references a target ID with `for`, defaults to hover/focus, and supports Escape dismissal; essential Stop/credential guidance must remain available outside a tooltip.
- Free core: [`wa-drawer`](https://webawesome.com/docs/components/drawer/) is available for responsive secondary navigation, with open/placement, focus trapping and initial-focus handling. This app has no navigation problem requiring it; hiding controls or history there would add interaction burden.
- **Pro:** [`wa-file-input`](https://webawesome.com/docs/components/file-input/) actually exists, supports `accept`, disabled state and file selection, and exposes `files: File[]` rather than native `FileList`. It is not part of the free core. Keep native `input[type=file]`; no upload UI/server is needed.

**Documented:** [Core is MIT](https://webawesome.com/license), free for commercial/open-source use with retained notices. [Built-in themes](https://webawesome.com/docs/themes) include free Default/Awesome/Shoelace; additional themes and Theme Builder are Pro. [Pro terms](https://webawesome.com/license/pro) restrict standalone redistribution and transfer of modification/integration rights to non-Creators; some plans have limited rather than perpetual rights. That creates a concrete concern for a public source repository using Pro assets. [Purchase](https://webawesome.com/purchase) presents paid seat/subscription plans, but readable fetched content did not expose a numeric price; no dollar amount is asserted. Legal/distribution clearance is not established by this investigation.

### Integration, build/security, and ownership

**Documented:** [Customizing](https://webawesome.com/docs/customizing) supports dark mode, tokens, custom properties, states and `::part()`. Shadow DOM prevents ordinary descendant selectors from styling internals. **Judgment:** custom density/amber/olive treatment is feasible, but existing `input:disabled`, `#next:hover:enabled`, native-summary selectors and focus styles cannot simply carry over.

**Repository → judgment:** Keeping an ID on a custom element does not preserve its native type. Current `.valueAsNumber` reads (`main.ts:782,1018`) would need an adapter; the current [number-input source](https://raw.githubusercontent.com/shoelace-style/webawesome/next/packages/webawesome/src/components/number-input/number-input.ts) exposes string/null `value`, not a native host `.valueAsNumber`. Preserve empty/invalid numeric semantics and safe-integer validation rather than substituting permissive parsing. External label/help relationships, immediate key clearing, disabled propagation, focus, readiness updates before component upgrade, and event retargeting need explicit verification. Current inputs use standard events; do not blindly rename them all to `wa-*`. Replacing setup/history details requires changing summary lookup/activation and stable row creation, not just tags.

Synthetic suites mock native value/focus properties and extract controller source sections (`app/tests/continuous.mjs:95–111,160–167,387–410`; `terminal.mjs:156–164`). They do not prove custom-element behavior or CSS sizing. Broad adoption would require additional integration coverage; no existing test establishes the CSS display ceiling.

**Documented:** [Installation](https://webawesome.com/docs) supports `@awesome.me/webawesome`, cherry-picked `dist/components/<name>/<name>.js` imports and theme CSS; `dist` is intended for Vite, `dist-cdn` for direct browser delivery. Required theme can be imported separately from optional utility/native-reset CSS. Asset users need an appropriate base path via `setBasePath()`. [Icons](https://webawesome.com/docs/components/icon/) default to Font Awesome CDN; `setIconPath()` or a custom library supports self-hosting. Default-theme [source](https://raw.githubusercontent.com/shoelace-style/webawesome/next/packages/webawesome/src/styles/themes/default.css) uses system font stacks, so downloaded fonts are unnecessary.

**Repository → judgment:** Any later trial must bundle selected modules/CSS locally, avoid hosted kits/autoloaders, stage only needed licensed assets, honor relative Vite base paths, and leave the strict production CSP unchanged (`index.html:7`; `vite.config.js:3–13,62–68`). Remote scripts/styles/icons are outside its allowances; font/image sources also default to denial. Do not copy inline examples into production. Web Awesome's [base source](https://raw.githubusercontent.com/shoelace-style/webawesome/next/packages/webawesome/src/internal/webawesome-element.ts) uses Lit/shadow styles and runtime style updates; exact compatibility with this CSP has **not** been exercised. Local bundling alone is insufficient proof. Verify chosen components' styles/icons under the real policy; do not use the development-only Impeccable adapter as production evidence or widen policy to make them work.

Shadow DOM is not a credential-security boundary. Additional trusted page JS increases dependency exposure; preserve temporary memory-only credentials and no logs/storage/telemetry. The [package manifest](https://raw.githubusercontent.com/shoelace-style/webawesome/next/packages/webawesome/package.json) lists 13 direct dependencies, including Lit, Floating UI, localization and animations; selective bundling may exclude unused features. Installed package size is not shipped weight. No bundle-size figure was measured. Adoption adds pins/lockfile, notices, asset strategy and upgrade ownership while custom shell CSS remains. The [accessibility commitment](https://webawesome.com/docs/resources/accessibility) explicitly does not certify whole-app accessibility; labels, focus order, contrast, zoom and history reachability remain our responsibility.

**What would change the recommendation:** if the vanilla shell review reveals a specific essential interaction that native HTML handles poorly—such as a justified secondary drawer with focus/return-focus defects—authorize one isolated free-component comparison. Selective adoption wins only if it fixes that observed defect, needs less maintained interaction code, preserves keyboard/state contracts, emits no unexpected network requests or CSP violations under the unchanged policy, and has an acceptable measured production JS/CSS delta. Aesthetic polish alone does not qualify. Broader adoption needs evidence of several recurring complex controls; the current page supplies none.

## 6. Canvas display sizing decision

**Repository:** backing dimensions are `width="640" height="400"` (`index.html:44`). CSS uses width 640px, max-width 100%, auto height, 8:5 and pixelated rendering (`style.css:228–236`); `.game` caps at 688px including 48px padding. `DESIGN.md:258` and `.impeccable/design.json:504–507` explicitly prohibit enlargement beyond 640×400 CSS pixels. Rendering validates 1,024,000 RGBA bytes and native dimensions, paints and hashes the 640×400 backing buffer (`main.ts:497–541`); observation PNG/hash reads that same buffer (`:859–868`). Related synthetic fixtures fix backing dimensions (`continuous.mjs:115,225`; `terminal.mjs:164,210`), not display scale.

**Judgment:** CSS-only proportional enlargement is feasible: change shell/game constraints and display width, retain backing attributes, context, verified frame, square corners, pixelation and complete HUD. CSS size does not change `getImageData()`/`toDataURL()` backing pixels; no engine or new render loop is needed. It likely improves spectator prominence on wide monitors, but offers no new image detail; fractional scaling may look uneven and increased height may push status/controls down. Do not copy the illustration's apparent proportions, crop, stretch, use decorative repainting, or resize the backing canvas for device pixel ratio.

Options: retain 640×400 for the first layout test; then compare a bounded **800×500 maximum** with proportional downscaling on wide screens; leave 1280×800 integer enlargement deferred because it overwhelms typical three-rail viewports. **Recommend the bounded comparison only after explicit owner approval to relax the Native Frame Rule.** That approval should also authorize synchronizing `DESIGN.md` and its sidecar with the accepted rule. None of these sizing or documentation changes is made here.

## 7. Smallest first implementation experiment

**Hypothesis:** regrouping the existing native UI into three zones can make Doom and its decision history easier to follow without component migration or any controller change. This proves the shell path; it cannot prove the value of larger imagery or a new outcome projection.

**Exact likely files and changes:**

1. `app/index.html`: add a left-rail wrapper containing intact `#setup` and the existing control bar, outside one another. Retain `.experience` for center/history; relocate the existing `#continuous-state` status group beneath the canvas alongside `#status`. Keep all controls, guidance, IDs, native types and accessible references. Advanced evidence/notices can remain below the shell. No new latest-outcome data node in this slice.
2. `app/src/style.css`: widen the page, use nested CSS Grid for the rail plus center/history, stack the rail's native controls, use calmer near-black olive surfaces/thin dividers and warm text, retain amber for Next. Start with approximately 15rem controls / up to 640px framebuffer / 19rem history at wide desktop. Choose collapse breakpoints from these minimum content needs, not the old 1168px threshold. Keep system fonts and current canvas ceiling; update affected parent selectors rather than append a competing stylesheet.

**No controller, history renderer, Worker/shared types, engine, API, package, Vite or CSP changes.** Preserve setup auto-collapse, including access to replacement key through its summary. Narrow layout follows source order: setup/controls → game/status → complete history → advanced evidence/notices; no CSS order tricks, modal control rail or duplicate mobile nodes. History gets a bounded keyboard scroller with a usable height even when its parent layout changes.

**User-visible acceptance:** at 1440×1000 the three regions are distinct and readable, the real full frame/HUD is central, Next is prominent, Stop and run status remain discoverable, and history cannot lengthen the game column indefinitely. At 390×844 the layout stacks without horizontal page scrolling, clipped buttons/filenames/status or inaccessible evidence; the canvas scales down proportionally. All existing probability/receipt disclosures remain usable. Tab order follows reading order; setup does not collapse during key editing or override deliberate expansion/recovery. Existing status words, numeric defaults and helper semantics remain truthful. No screenshot pixels or illustrative entries ship.

**Smallest later verification, separately authorized:** inspect the diff for preserved IDs/types/ARIA/CSP and untouched controller; run `git diff --check` and, with dependencies already installed, `npm --prefix app run check` (includes offline Worker-entry smoke, not the three dedicated decision suites). No new implementation-mirroring tests or exhaustive engine suite for this HTML/CSS slice. These checks do not establish DOM interactions or browser/native correctness.

For visual proof after separate build/server/browser approval, use the isolated Chrome procedure in `app/README.md:179–229`: capture **one wide and one narrow** view, fresh/unprepared and then the actual prepared canvas; inspect Console/Network, native/Canvas receipts and unchanged idle state. WAD/runtime authorization is separate. For populated-history proof, reuse an owner-authorized live session if one exists; otherwise separately authorize a bounded manual/API history sample and capture only sanitized evidence. Do not invent entries to fill the rail or count black-canvas/empty-history screenshots as running-layout proof (lessons report `:224–237`). Check expansion, keyboard access and older-entry scrolling while genuine updates arrive. No API calls are needed merely to prove preparation. Do not repeat the README's broader gameplay trial automatically.

**Main risks:** relocated help/status can become hidden, setup containment can change collapse semantics, old specificity/width/container rules can fight the new grid, and history size containment can collapse its new parent. Avoid these through intact static groups, explicit grid sizing/min-width constraints, preserved scroll nodes and the bounded visual pass. Reject or adjust the shell if it sacrifices canvas prominence or evidence readability; that finding should motivate the separate sizing decision, not a framework rewrite.

## 8. Reviewable sequence and owner decisions

1. **Native broadcast shell:** the two-file experiment above, with current canvas ceiling and existing statuses. Review composition before adding data projections.
2. **Canvas sizing comparison, conditional:** after approval, compare up to 800×500 CSS display with unchanged 640×400 backing, full HUD and matching receipts; update design rule/sidecar only as explicitly authorized. Skip if the retained size works well enough.
3. **Verified latest outcome:** separately authorize a small synchronous, read-only projection from `DecisionEntry` and current run/frame at the existing `display()` boundary, plus HTML/CSS. Keep active/cleanup state distinct from last verified outcome and use the truth gates in section 4. A small controller presentation addition is necessary here; no admission, async scheduling, verification or credential changes. Reconcile the old no-duplicate-result design rule explicitly.
4. **Responsive/history refinement:** address only defects observed with real history, expanded receipts, zoom, short windows and keyboard use. Preserve all entries; no pagination/truncation infrastructure. Consider a selective component trial only if the specific interaction criterion in section 5 is met.

**Owner decisions needed:** approve implementation of slice 1; decide separately whether to relax the 640×400 CSS ceiling and permit its design-document update; approve the later read-only outcome strip/design-rule reconciliation if desired. No Web Awesome purchase or dependency is recommended. Execution/build/browser/WAD/API approvals remain distinct from source-edit approval under `AGENTS.md`.

**Investigation validation:** source/image inspection and official-document research only. Report was absent before creation. Final working-tree check shows only `?? docs/ai-broadcast-ui-webawesome-investigation.md`; `git diff --check` and a whitespace check of the new untracked report passed. No implementation has begun.
