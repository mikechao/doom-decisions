# Impeccable in Doom Decisions: Setup, Experiments, and Lessons Learned

**Project:** [Doom Decisions](https://github.com/mikechao/doom-decisions)  
**Evaluation period:** October 11–13, 2026  
**Status:** Practical retrospective, not a product endorsement or a claim of production readiness  
**Basis:** Our hands-on Codex/Chrome experiments, owner screenshots and command output, Codex investigation reports, and inspected project configuration (`AGENTS.md`, `app/vite.config.js`, `app/package.json`, `app/.impeccable/live/config.json`, and `DESIGN.md`). Local, uncommitted edits may be newer than the inspected GitHub files.

## Executive summary

**Impeccable has been useful for improving an existing, working UI.** Its most successful workflow in Doom Decisions has been **Critique → Live Mode alternatives → Steer → human selection → Accept/Discard → ordinary engineering checks**. It found a real history-layout problem, made browser-visible design alternatives easy to compare, and helped improve copy, history scrolling, gameplay-control grouping, and header spacing.

Its weaker areas have been **broad product-level redesign, ambitious Overdrive implementation, generated CSS cleanliness, and Live Mode operational reliability**. Some design variants merely rearranged the existing page. The standalone Decision Loom prototype failed to render its central chart or data rows in the screenshot we examined. A model-capacity interruption left a Live session requiring cleanup. Initial Live integration also incurred avoidable script-path and browser-connector detours.

The current practical conclusion is to **keep Impeccable as a design exploration and targeted refinement tool**, while using Codex/source review and normal browser checks to protect application behavior. We do not need to adopt every suggestion or turn every experiment into a feature.

> Guiding engineering question: **What's the smallest experiment that will prove or disprove our next architectural assumption?** For design work, the equivalent is: *What is the smallest visible change that will tell us whether this experience is actually better?*

---

## 1. What we were integrating it with

Doom Decisions is a **vanilla TypeScript + Vite + plain CSS** browser application, without React or Tailwind. The game runs through a modified Doom/WASM engine inside a module Worker. The browser shows the real Doom framebuffer; the OpenAI Decisions API selects exactly one allowed gameplay action per decision. The human controls the duration in **tics** and, for Continuous Mode, a **per-run API-attempt budget**.

The product must preserve several distinct concerns:

- **Local setup:** user-selected Freedoom 0.13.0 Phase 1 WAD, an in-browser temporary OpenAI API key, and automatic game preparation after WAD selection.
- **Human controls:** Next Decision, Start Continuous Mode, Stop, shared tics per decision (default **6**, positive JavaScript safe integer), and a separate continuous API-attempt budget (default **2**).
- **Truthful evidence:** model selection is not native execution; native execution is not successful completion until the resulting frame and receipts are verified. API waits, page idling, and snapshots must not advance Doom tics.
- **Security constraints:** a deliberately strict Content Security Policy (CSP), in-browser temporary credentials, and a locally selected game asset that must not be staged or committed.

Our design direction, documented in `DESIGN.md`, is **“Doom and its decisions take center stage.”** The visual identity uses olive-charcoal surfaces, warm off-white type, a restrained amber action color, and the unmodified native framebuffer. Those are useful design constraints; they are not permission to change gameplay semantics.

This combination made Impeccable a meaningful test: it had to work on a real interactive app with actual state, DOM bindings, a strict CSP, and nontrivial safety/correctness invariants—not a static landing-page mockup.

---

## 2. How we set up the project for Impeccable

### 2.1 Install the skill locally and give it project context

We installed Impeccable as a **project-local Codex skill**, accessible with commands such as:

```text
$impeccable live
$impeccable critique
$impeccable document
$impeccable overdrive
```

The installed skill and its helper scripts live under:

```text
.agents/skills/impeccable/
.agents/skills/impeccable/scripts/impeccable
```

The installation command itself is **not preserved in this retrospective**; do not treat the above as an installation recipe. `AGENTS.md` provides repository-specific operating guidance, while Impeccable's `SKILL.md` and its `reference/live.md` describe the skill's own workflow. We also used the project files `PRODUCT.md` and `DESIGN.md` for product/design context.

Impeccable's design-documentation workflow produced or refreshed:

```text
DESIGN.md
.impeccable/design.json
```

The design document captures colors, typography, spacing, components, guiding principles, and example treatments. The JSON sidecar is generated design reference material—not a second implementation or proof of browser correctness. **Design documentation can become stale after later accepted Live edits**; it is a snapshot, not automatic synchronization with the current CSS.

### 2.2 Why normal Live Mode initially failed: CSP

The application deliberately ships with a restrictive CSP in `app/index.html`. It limits scripts and styles to the application, constrains Worker loading, allows the WASM compilation permission, and limits network destinations to the app and OpenAI.

Impeccable Live Mode operates differently from ordinary app JavaScript. It injects a picker script and preview styles, and talks to a **localhost helper on port 8400** using HTTP/SSE. Our initial Live attempts ran into CSP restrictions: injected scripts, inline preview styles, and helper communication did not fit the application's normal policy.

We **did not relax the production CSP** to accommodate a design tool. Instead, we added an explicit **development-only Vite mode**.

### 2.3 The development-only Vite adapter

`app/package.json` now includes two distinct entry points:

```bash
# Normal development: strict application CSP
npm --prefix app run dev

# Explicitly opted-in Live development
npm --prefix app run dev:impeccable
```

The latter runs Vite in `impeccable` mode, bound to `127.0.0.1:5173`. In `app/vite.config.js`, a `transformIndexHtml` plugin runs **only when `command === 'serve'` and `mode === 'impeccable'`**.

That adapter serves a narrowly augmented development CSP:

- Adds `http://localhost:8400` to script and connection sources for the Live helper.
- Allows inline styles for Live previews.
- Adds the Vite hot-module-reload WebSocket origin (`ws://127.0.0.1:5173`).
- Preserves the application policy's other restrictions rather than inheriting arbitrary permissions.
- Recognizes Impeccable's `data-impeccable-csp-original` marker when Live rewrites the CSP meta element.
- Requires exactly one unambiguous CSP meta element and verifies the strict original value, **failing rather than silently widening policy** on unexpected input.

The original CSP remains in source. Normal development and production builds do not receive these Live-specific allowances. The adapter fixed the practical browser-preview blocker without changing game code or moving to a new framework.

**Important security limit:** this is a *development convenience*, not a guarantee that an injected script is harmless. Impeccable's page-level script executes in the same page as the WAD input and temporary API-key UI; a script with page privileges can potentially inspect sensitive state or influence network behavior. We observed **no misuse**, but we did not conduct a security audit of the third-party script/helper. For design experiments, avoid entering a real API key or loading sensitive assets unless actually needed and separately authorized. Localhost by itself is not a sandbox.

### 2.4 Live configuration and temporary file changes

Our local Live configuration is:

```json
{
  "files": ["index.html"],
  "insertBefore": "</body>",
  "commentSyntax": "html",
  "cspChecked": true
}
```

File: `app/.impeccable/live/config.json`.

During a Live session, expected temporary changes can include:

- A picker-script injection, preview variants, and temporary styles in `app/index.html`.
- Temporary session/journal records under `app/.impeccable/live/`.
- Helper-managed ignore metadata in `app/.gitignore`.
- A rewritten CSP meta element or the `data-impeccable-csp-original` marker.

Those are **expected Live mechanics**, not automatically defects. However, they must not accidentally become committed application code. On Discard or exit, ensure temporary wrappers, picker injection, preview styles, and temporary CSP changes are cleaned up **without discarding deliberately accepted source changes**.

### 2.5 The intended everyday workflow

After setup, the goal is to remember **one Codex command**, not a long operational checklist:

1. With permission, start `npm --prefix app run dev:impeccable` in a separate terminal.
2. Start a fresh Codex session and type **`$impeccable live`**.
3. Open **http://127.0.0.1:5173/** manually in Chrome.
4. Select an element, request variants or steer a preview, then choose **Accept** or **Discard**.
5. Exit Live and inspect the resulting diff; run ordinary project checks for any accepted source edits.

The app developer opens Chrome manually. **The Codex browser-automation connector is not required** for the installed picker-plus-helper flow. The separately started Vite server stays running until the owner stops it.

---

## 3. What we actually tested

| Capability / workflow | What we did | Assessment |
|---|---|---|
| **Critique** | Examined the running app, screenshot, source, and design system; compared findings | **Useful**: specific, actionable hierarchy findings |
| **Document** | Built/refreshed `DESIGN.md` and `.impeccable/design.json` | **Useful**: captures constraints and visual language; must be refreshed after changes |
| **Live Mode picker + variant generation** | Selected real UI regions in Chrome and compared generated layouts | **Very useful when scoped**; integration initially fragile |
| **Steer** | Refined variants in place, including semantics of tics and control grouping | **Useful but sometimes slow**; may still need a change of design direction |
| **Accept / Discard** | Reverted unwanted previews and promoted accepted variants to real HTML/CSS | **Useful and exercised**; cleanup matters |
| **Live-generated responsive/CSS changes** | Scrollable history, reorganized controls, header spacing | **Mixed-positive**: useful changes but CSS lint cleanup required |
| **Overdrive concept generation** | Generated Decision Loom, Decision Time Machine, Tactical Atlas concepts | **Interesting ideation**, not automatic feature justification |
| **Overdrive standalone implementation** | Viewed synthetic Decision Loom prototype | **Unsuccessful in observed screenshot**: visualization and data rows blank |
| **Whole-page spectator redesign** | Theater View and Broadcast View alternatives | **Unconvincing**: mostly rearranged existing UI |
| **Audit, Harden, Animate, Clarify, Polish** | Discussed as possible future commands | **Not meaningfully tested in these sessions**; do not grade them as observed successes |

### 3.1 Critique: strong at finding concrete UI problems

We invoked Critique against a real Doom session with the game visible, a collapsed setup region, many completed decisions, and a long history. The run involved **two independent Codex subagents** and produced a dated report under `.impeccable/critique/`.

The most useful observations were:

- **P1:** AI Decision History could dominate the vertical page as the run progressed, leaving an awkward relationship between the game and history.
- **P2:** Manual/Continuous controls required too much reading and lacked clear grouping; the shared tic duration was easy to misconstrue.
- **P2:** The supported Freedoom asset label could be more exact about release/phase.

The critique also recognized strengths: Doom was initially visually prominent, the olive-charcoal design was coherent, and setup used progressive disclosure. A tooling complaint about a flat typography hierarchy appeared to be a **false positive** when compared with the actual styles.

**Lesson:** Critique is a good way to obtain *hypotheses* worth checking against source and browser, not an authority that every warning is real.

### 3.2 Live Mode on AI Decision History: a successful targeted experiment

We selected the AI Decision History and asked for alternatives to address the long, unbounded list. The first generated variants were not quite right: one capped visible history to only a few entries. We used **Steer** to clarify that old decisions must remain accessible, not truncated or discarded.

The accepted result was a **bounded, independently scrolling, newest-first history** while retaining all existing entries and native disclosure behavior. Source changes were small: `ol#history` became keyboard-focusable, CSS constrained the scrolling pane, and the desktop layout let the game column determine the row height rather than letting history grow indefinitely.

This was one of Impeccable's clearest wins because the problem was specific, observable, and directly connected to the critique.

**Lesson:** It is especially effective when asked to solve a bounded layout defect and shown enough of the application to preserve its semantics.

### 3.3 Live Mode on setup copy: small, valuable cleanup

A separate Live experiment helped eliminate redundant setup copy and improve the wording around **Local Freedoom WAD** selection. The accepted work preserved the actual setup lifecycle, the temporary key behavior, and the fact that selecting the local WAD automatically prepares the engine. CSS hid the empty asset-placeholder slot rather than inventing additional setup state.

This kind of narrowly scoped copy/spacing task was straightforward to evaluate visually and review in the source.

**Lesson:** Small wording and visual-density changes are a particularly good fit. The work still requires verification that text describes real app behavior.

### 3.4 Live Mode on controls: useful only after substantial steering

We selected the controls under Doom and asked for clearer hierarchy between manual and continuous play. Impeccable generated three alternatives:

1. **Stacked mode bands:** clear but tall.
2. **Side-by-side Manual/Continuous columns:** visually compact, but uneven; the manual side had one button while the continuous side had a budget and two buttons.
3. **Status-first toolbar:** highlighted the status but was less explicit about some actions.

We initially preferred the side-by-side layout, but noticed a **semantic mistake**: **Tics per decision** was placed under *Manual Mode*, even though tics apply to **both** modes. A Steer moved it into a shared row above the two mode groups. That fixed the meaning but made the unequal columns conspicuous. We steered once more toward a **compact stacked-row console**: shared tic setting, Manual row with Next Decision, Continuous row with attempt budget/Start/Stop, current run-state message, and a **Limits & stopping** disclosure.

That version was accepted as a reasonable interim improvement—not a perfect finished design. An inspected patch changed only `app/index.html` and `app/src/style.css`; the essential control IDs, status elements, and validation references remained. The patch was ~50 HTML lines changed and ~118 new CSS lines. The team chose **not** to refactor CSS merely because it was verbose.

The initial `npm --prefix app run check` showed two Biome `noDescendingSpecificity` warnings. Codex resolved them with targeted selector changes; subsequent checking passed without those warnings.

**Lessons:**

- Impeccable does not automatically understand domain semantics such as shared duration, API-attempt accounting, or Stop cleanup.
- **Steer** is valuable, but when the layout concept itself is wrong, it is better to change direction than repeatedly polish that concept.
- Acceptance is a UX decision; CSS linting and source checks still belong to the normal engineering workflow.

### 3.5 Live Mode on header spacing: a successful end-to-end reliability test

After improving `AGENTS.md` (described below), we deliberately tested the simple entry path: fresh Codex session, `$impeccable live`, manually opened Chrome, selected a small page area, and asked about excess space above the page.

Codex traced the gap to `main { margin: 2rem auto; }` and generated **three treatments**: smaller inset, flush top edge, and a compact header. The owner accepted **variant 2**, which made the page start flush at the top and allowed the title and introduction to share a row when space permits.

Screenshots showed a successful `steer_done` acknowledgment, an **Accept** event, and Impeccable's **“Carbonize cleanup REQUIRED before next poll”** message. Codex then began converting the accepted preview to ordinary CSS and removing scaffolding.

A subsequent owner-run `npm --prefix app run check` passed TypeScript and Worker checks but reported **one** CSS specificity warning involving `.page-flush > header p` and `footer p + p`. A minimal fix was suggested; **the final fix result and fully cleaned exit were not shown in the supplied conversation**. Do not present that end-to-end acceptance as conclusively clean yet.

**Lesson:** The revised startup flow demonstrably launched, received a request, generated previews, and reached Accept cleanup. The final source/exit proof remains a separate verification step.

---

## 4. Where Impeccable was less convincing

### 4.1 Whole-page redesign: Theater vs. Broadcast

We wanted to stop looking like a developer test harness and start feeling like **an AI gameplay spectator product**. The key requirements still included local WAD selection, API key entry, editable tics and decision budget, manual/continuous actions, run states, and inspectable decision history.

A Live request generated two compositions:

- **Theater View:** centered Doom with controls below and history farther down the page.
- **Broadcast View:** Doom and the AI history side by side on wide screens, with controls beneath the game.

Neither felt like a meaningful redesign. Broadcast was close to the previous layout; Theater introduced a longer vertical stack that pushed history away from gameplay. Both foregrounded setup and controls more than the AI's current action and game narrative.

**Important qualifier:** screenshots were taken before the WAD was loaded, leaving a black game canvas and an empty history. That weakens any definitive judgment about the *running* spectator experience. Still, the structural variants themselves were not compelling enough to Accept.

We chose not to keep steering. The next useful product hypothesis was narrower: perhaps **a larger presentation of the existing Doom canvas plus a compact, live AI-action/status element** would change the experience more than another panel rearrangement. That was a proposal, not an implemented or verified result. It would also require revisiting the current design's 640×400 CSS-pixel display ceiling deliberately, not quietly violating it.

**Lesson:** Asking for multiple “substantially different” layouts while also requiring every current DOM group and all current presentation constraints encourages rearrangement rather than fresh product design. Explore the viewing experience separately from implementation constraints, then implement only the selected concept.

### 4.2 Overdrive: good brainstorming, weak observed prototype

We explored **`$impeccable overdrive`**, which in practical terms means looking beyond ordinary UI polish toward a more distinctive or ambitious interactive experience. The generated concept directions were:

- **Decision Loom:** seven action lanes connect supplied probabilities, selected actions, and verified results into a visual history. Claimed manageable SVG/GPU cost.
- **Decision Time Machine:** inspect retained before/after frames without pretending to rewind native gameplay. Requires bounded image retention and adds substantial memory/complexity.
- **Tactical Atlas:** plot verified player-position checkpoints as an abstract trace, not a recovered level map or exact path.

**Decision Loom** seemed like the best bounded candidate. We requested a standalone prototype with **20 synthetic decisions**, explicitly separate from the application and without new app infrastructure.

The screenshot was disappointing: a large blank visualization surface, a comparison table with headers but no populated rows, and extensive explanatory text. We did **not** establish why the synthetic data failed to appear—script/runtime or CSS problems were plausible but unverified. Nor did we prove how compelling the chart would have been if fixed.

We decided to **stop rather than rescue it**. That was a sensible experiment boundary: the goal was to learn whether it was worth watching, not to create an unrelated visualization project.

**Lesson:** Overdrive was more useful as **ideation** than as evidence of implementation capability. Conceptual ambition is not proof of working, desirable software.

### 4.3 Broader UX implication

The app's remaining “tech demo” feel is not mainly a CSS problem. The primary view still emphasizes configuring the system (WAD, key, tics, budget) and examining technical receipts rather than following the loop **observe → AI selects → engine executes → verified result**.

Technical settings are necessary and should remain discoverable. The product challenge is **information hierarchy and storytelling**, not hiding critical controls or decorating the existing test harness.

---

## 5. Live Mode reliability: failures, investigation, and smallest fix

### 5.1 Problems we encountered

| Symptom | What the evidence supports | Status |
|---|---|---|
| `exit 127` when running `live-status`, `live-poll`, or another helper | Relative helper paths broke after Impeccable switched into the `app/` project root | **Cause established** by repository investigation |
| Codex attempted browser-connector setup and failed to import `browser-service.mjs` | Unnecessary detour: the picker/helper flow works with the owner opening Chrome manually | **Avoidable**, import failure itself not reproduced later |
| CSP rewriting led Codex to restore strict source meta while retaining injection | `AGENTS.md` directed this fallback; adapter explicitly supports Live's saved-original marker | **Conflict cause not established**; no repeatable failing rewrite captured |
| Model returned “Selected model is at capacity” mid-generation | Upstream model availability interrupted work; partial edits and a stuck toolbar were observed | **Observed**, not locally fixable by project code |
| Live toolbar stuck after interrupted generation | A failed generation event may need an explicit error reply, not merely source restoration | **Recovery procedure identified**, not proven for every failure |
| Live wrapper failed once because a required element selector was omitted | Codex retried with `--query main` and successfully produced variants | **Recoverable command error** |
| A run tried to start an extra `concept-seed` workflow | It was a product/design-tool detour, but investigation found no concrete repository cause | **Unresolved / not automatically a defect** |
| Generated CSS triggered Biome warnings | Specificity/order cleanup needed after Accept | **Routine source cleanup**, not evidence gameplay was affected |

### 5.2 What `AGENTS.md` originally made ambiguous

The original Impeccable guidance mentioned running a helper through a **repository-relative path**, while Impeccable's session root was `app/`. Once Codex changed directory, `.agents/skills/impeccable/scripts/impeccable` was no longer a valid relative path. Separately, the skill's generic instructions could suggest browser tooling, even though this project intentionally uses manual Chrome.

That was **not a fundamental conflict between Impeccable and Doom Decisions**. It was an operational mismatch between generic skill instructions and project-specific guidance.

A read-only Codex investigation examined the local skill documentation, `app/.impeccable/live/roots.json`, `AGENTS.md`, and the CSP adapter. It recommended **one focused `AGENTS.md` clarification**, not wrappers, package changes, installed-skill modifications, or broader infrastructure.

### 5.3 The `AGENTS.md` correction

We updated the Impeccable section to make the expected behavior explicit:

1. Resolve `<skill-base-dir>/scripts/impeccable` to an **absolute executable path** derived from the loaded skill's `SKILL.md`.
2. From the repository root, launch Live with `live --target app/index.html`.
3. Use the returned `projectRoot` (`app/`) for subsequent app-relative operations while retaining the absolute helper path.
4. Reuse the approved Vite instance, manually open Chrome, and service the **foreground Live poll** promptly. Do not troubleshoot an unnecessary browser connector.
5. Preserve the strict source CSP; let the existing `dev:impeccable` adapter provide temporary development permissions.
6. After a failure, use session-aware recovery and cleanup rather than blind re-generation or blanket `git restore`.

The documentation-only patch passed `git diff --check` and touched only `AGENTS.md`. The owner's subsequent fresh-session experiment showed immediate improvement: absolute helper paths worked, Live started, the poll received a request, and Codex did not take the browser-connector detour.

This supports the value of the clarification. **It does not prove every Live session will now be reliable**, and it cannot fix upstream capacity errors.

### 5.4 Recovery procedure worth preserving

When a session is interrupted, Impeccable's inspected instructions indicate a **session-aware** sequence:

- Use the retained **absolute** launcher rather than a repository-relative command.
- Check `live-status`; if appropriate, use `live-resume --id SESSION_ID`.
- If the helper is down, restart via `live-server`, then resume polling.
- For a failed pending generation event, explicitly acknowledge failure using `live-poll --reply EVENT_ID error "Short reason"`. Source-only Discard may leave the browser toolbar waiting.
- Before leaving, resolve pending previews through Discard or accepted-change cleanup. After Accept, complete any required **carbonize** cleanup and the session completion step before the next poll.
- Stop the poll, run `live-server stop`, and verify the picker, preview styles/wrappers, and temporary CSP metadata are gone, while accepted edits remain intact.

These commands describe the **investigated supported workflow**. They should not be executed blindly without examining the active session and the local skill's arguments. In particular, never assume that `live-server stop` alone restores all journaled source changes.

### 5.5 The shortest repeatable smoke test

The goal is to prove that a normal developer only needs to know **`$impeccable live`**:

1. Start from a recorded `git status --short`/diff baseline and strict source CSP.
2. With the separately approved `dev:impeccable` server running, open a fresh Codex session and enter **only** `$impeccable live`.
3. Manually open Chrome, select a trivial element, and request one small variation.
4. View the result, **Discard**, and verify the selected source returns to its starting state. An **Accept** test is also useful, but then preserve that intentional source change.
5. Exit Live using its supported cleanup; check picker removal, source CSP restoration, and Vite remaining independently controlled.
6. Compare `git status --short`, `git diff`, `git diff --check`, and, for accepted app changes, `npm --prefix app run check`.

This is a **workflow acceptance test**, not evidence that the Decisions API, Doom/WASM runtime, or billing flow works.

---

## 6. Verification discipline and code-quality findings

### 6.1 A preview is not a regression test

Impeccable is effective at showing a visual possibility, but a screenshot cannot verify that:

- Existing DOM IDs and listeners still work.
- Inputs keep their positive-safe-integer validation and dynamic disabled states.
- Tics remain shared across manual/continuous modes while the budget remains per-run.
- Stop fences responses and cleans up correctly.
- API calls, frame verification, Worker/native state, and credentials are unchanged.
- A new composition works at narrow widths and with real gameplay instead of a black placeholder frame.

For accepted changes, our practical process has been to inspect `git diff`, run the existing non-writing checks, and use Chrome for visual/interaction verification as appropriate. `npm --prefix app run check` covers TypeScript, Worker packaging/import smoke, and Biome; it does **not** run the separate decision/terminal/continuous suites and does **not** establish actual WASM/browser/API correctness.

### 6.2 CSS output is usable but not always clean

We observed generated CSS with more selectors than a hand-maintained minimal patch might need. The stacked control layout added roughly 118 CSS lines. Accepted layouts also triggered `lint/style/noDescendingSpecificity` warnings, including:

- Control-guidance selectors interacting with later setup/footer selectors.
- The header rule `.page-flush > header p` interacting with `footer p + p` in Biome's specificity-order analysis.

These were warnings, not demonstrated visual failures. Targeted selector simplifications worked for the control layout. A `:where(.page-flush)` alternative was proposed for the later header warning, pending the final reported fix.

**Recommendation:** clean up actual Biome findings and inspect CSS scope, but do not turn every design experiment into a speculative refactor or rewrite.

### 6.3 Maintain a truthful evidence boundary

For every Impeccable experiment, distinguish:

- **Observed in Chrome:** visual variants, selected controls, previews, Accept/Discard interactions.
- **Read-only/source evidence:** HTML/CSS diffs, strict CSP rules, available launcher/scripts.
- **Automated checks:** Biome, typechecking, Worker/static checks.
- **Owner-reported gameplay:** real Doom/WASM and Decisions API runs, which are separate from Live Mode.
- **Unverified claims:** exact model-quality comparisons, exhaustive keyboard/responsive behavior, production credential security, and reasons for the blank Overdrive chart.

Overstating browser or gameplay verification would be worse than leaving an explicitly identified evidence gap.

---

## 7. What kinds of design tasks should we give Impeccable?

### Strong fit

- **Critique a specific screenshot plus source**, then choose one actionable issue.
- **Generate two or three alternatives for one well-defined component or region.**
- **Tune copy, spacing, hierarchy, progressive disclosure, or scroll behavior** in an already functioning application.
- **Compare alternatives in the real browser** without committing speculative source changes.
- **Capture/refine an existing design system** in `DESIGN.md` for consistent future work.

### Use cautiously

- **Steer loops:** useful after one concrete correction, but stop when the underlying layout idea is poor.
- **Large layout reorganizations:** evaluate with real populated state, not only an unprepared page.
- **Broad spectator-experience redesign:** first decide what information should dominate, rather than simply shuffling current panels.
- **Accepting variant source:** protect event bindings, state semantics, credential handling, and cleanup through ordinary reviews/checks.

### Not yet justified by our evidence

- Committing to the **Overdrive** Decision Loom/Time Machine/Atlas concepts as features.
- Building supporting infrastructure just to make a design experiment impressive.
- Claiming success for **Audit, Harden, Animate, Clarify, or Polish**—we discussed them, but did not actually evaluate those workflows in this project.
- Changing frameworks, creating a backend, loosening the production CSP, adding new API calls, or changing the engine to satisfy visual tooling.

---

## 8. Our preferred workflow going forward

### A lightweight loop

1. **Identify one visible user-experience problem.** Example: “History overwhelms the game after 50 decisions.”
2. **Get a critique or use Live directly**, whichever is cheaper.
3. **Request two or three materially different variants** for that region.
4. **Judge the preview in an honest app state**—ideally Doom prepared, some decisions completed, statuses populated.
5. **Steer once or twice to fix demonstrable issues.** If it is still wrong, Discard.
6. **Accept only a clearly better variant.** Source acceptance is not permission to modify game logic.
7. **Check the diff, cleanup, and normal project checks**; verify browser behavior appropriate to the change.
8. **Commit intentionally** after the owner approves. Keep Live-generated temporary artifacts out of source control.

### Reasonable next product experiment

We should not immediately run another whole-page rearrangement. The unresolved design question is whether Doom Decisions can look less like a harness and more like something compelling to **watch**.

A smaller hypothesis is to test **a larger presentation of the Doom canvas** and **a compact live AI-action/run-state indicator**, while keeping WAD/key/tics/budget available and keeping the actual Doom image and evidence honest. This is only a hypothesis; the present 640×400 CSS-pixel design ceiling would need an explicit design decision before enlargement.

Before a new feature experiment, finish the recent Live Mode session cleanup, any remaining generated-CSS lint fix, and the routine verification of accepted edits. Do not let tool maintenance displace the primary project objective.

---

## 9. Bottom line

Impeccable has **earned a place in this project's design toolbox**, especially for **Critique, Live, Steer, and targeted HTML/CSS improvements**. It shortened the loop between a UI idea and seeing alternatives in Chrome. The value came from *human judgment plus tight feedback*, not from treating generated design as automatically correct.

The operational integration is now better understood: use a **separate `dev:impeccable` server mode**, a **strict production CSP**, **absolute helper paths**, **manual Chrome**, **foreground polling**, and **session-aware cleanup**. A focused `AGENTS.md` clarification removed two avoidable startup detours in the observed fresh-session test.

The limits matter too. Live Mode can be fragile under interruption, generated CSS occasionally needs lint cleanup, broad redesigns may only rearrange existing pieces, and Overdrive has **not** yet demonstrated that it can reliably implement a compelling advanced visualization here.

**Recommended posture:** keep Impeccable for bounded, visual experiments; let Codex and the existing checks protect implementation correctness; and judge every variant by whether it improves the experience of **watching AI-controlled Doom**, rather than by how much design work it generates.

---

## Appendix A. Relevant project files and commands

| File or command | Role |
|---|---|
| `.agents/skills/impeccable/SKILL.md` | Installed skill instructions |
| `.agents/skills/impeccable/reference/live.md` | Live workflow, recovery, and cleanup guidance |
| `.agents/skills/impeccable/scripts/impeccable` | Launcher; use an absolute resolved path |
| `AGENTS.md` | Project-specific development, security, and Live workflow guardrails |
| `app/package.json` | `dev` / `dev:impeccable` / `check` scripts |
| `app/vite.config.js` | Dev-only CSP adapter and strict-original verification |
| `app/index.html` | Original strict source CSP, setup, canvas, controls, and history markup |
| `app/.impeccable/live/config.json` | Target file, insertion, and CSP-check settings |
| `app/.impeccable/live/roots.json` | Session root information observed in investigation |
| `app/.impeccable/live/` | Local Live session/journal state |
| `DESIGN.md` | Design direction, palette, typography, component rules; snapshot of a point in time |
| `.impeccable/design.json` | Generated design sidecar |
| `PRODUCT.md` | Product requirements and constraints |
| `npm --prefix app run dev:impeccable` | Explicitly opted-in design development server |
| `$impeccable live` | Everyday Codex entry point |
| `npm --prefix app run check` | TypeScript/static Worker/Biome checks; **not** full gameplay verification |
| `git status --short`, `git diff`, `git diff --check` | Source/cleanup inspection |

## Appendix B. References

- [Impeccable website and documentation](https://impeccable.style/)
- [Impeccable Live Mode documentation](https://impeccable.style/docs/live/)
- [Doom Decisions repository](https://github.com/mikechao/doom-decisions)
- Repository-local references: `AGENTS.md`, `DESIGN.md`, `PRODUCT.md`, `app/README.md`, `app/vite.config.js`, installed Impeccable skill docs.
