---
name: Doom Decisions
description: A quiet dark game viewer with visible AI decisions and deliberate human control.
---

# Design System: Doom Decisions

## Overview

**Creative North Star: "Quiet game viewer"**

Doom supplies the visual character. Quiet charcoal surroundings, warm readable text, and restrained controls give the framebuffer priority while keeping AI decision history visible as its companion. The human chooses when and how long; the AI chooses the action.

The interface is compact and calm. Setup and engineering evidence remain accessible without competing with the game, its next decision, or the visible history. Borders describe functional boundaries; decoration and animation do not carry the experience.

**Status:** Initial target design for owner review before implementation. The owner-selected direction is binding guidance; all numerical styling candidates below are **provisional starting hypotheses**, not visually verified tokens or previously approved values. Frontmatter deliberately omits normative tokens until implementation and visual review establish them.

**Current observations, not target rules:** The existing page has an 850px maximum content column, a 640px displayed canvas, system typography, default light controls, chronological multiline receipts, and substantial setup above the game. The previously inspected owner screenshot shows one loaded desktop state; it establishes neither mobile nor pending/error appearance. These rough styling choices are not an approved system.

**Key Characteristics:**

- Doom first, visible AI history second, with duration and Next Decision immediately accessible.
- Quiet surfaces and simple typography; one restrained primary-action accent.
- Honest decision feedback, accessible inspection, and secondary complete evidence.

Sources: [PRODUCT.md](PRODUCT.md), [UI investigation](docs/doom-ui-polish-investigation.md), [completed critique](.impeccable/critique/2026-10-11T21-11-02Z__app-index-html.md), current presentation source, and the owner's subsequent choices and session plan. Those choices supersede the critique's separate latest-result suggestion and its open layout questions. Implementation stays vanilla TypeScript/Vite; styled native controls and disclosures are the current first-pass recommendation. Web Awesome Core remains eligible for a later evidence-driven experiment, not a design requirement.

## Colors

Use a quiet warm-neutral palette. The following candidates are proposals, not extracted implementation tokens; validate actual combinations, including disabled and focus states, before adoption.

| Role | Provisional candidate | Use |
|---|---|---|
| Primary: muted amber | `#D2A65B` | Next Decision background; hover stays within this role. |
| Primary ink | `#201A10` | Text on the amber action. |
| Neutral: quiet charcoal | `#191919` | Page and stage surroundings. |
| Neutral: raised charcoal | `#232323` | Fields and subtle disclosure hover/open treatment. |
| Neutral: warm off-white | `#E8E3D9` | Primary text and selected-action emphasis. |
| Neutral: supporting gray | `#ADA79E` | Help, latency, and secondary text. |
| Neutral: control boundary | `#81786B` | Functional field boundaries; avoid framing whole panels. |
| Interaction: pale blue | `#B9D9F4` | Focus and links; distinct from action emphasis. |

**The Amber Action Rule.** Reserve amber emphasis for Next Decision. Selected probabilities use text weight and an explicit label. Errors, uncertainty, and readiness require words; color alone never communicates state. Additional semantic colors remain unresolved unless they improve comprehension during visual review.

## Typography

Use `system-ui, sans-serif` for identity, instructions, controls, and history. Use `ui-monospace, monospace` sparingly for hashes, request identifiers, and technical counts. No downloaded font or display-font dependency is required.

Provisional hierarchy: product title (28–32px, weight 700, line-height 1.2); section title (18–20px, weight 600, line-height 1.3); body and controls (16px, line-height 1.5); supporting text (14px, line-height 1.5). Labels use weight 600. Keep mixed-case labels, readable disabled text, and tabular numerals where useful for latency/percentages. The game remains more prominent than the title.

## Layout

For this MVP, place compact identity and local IWAD/key setup **above** the main experience. On sufficiently wide screens, pair a dominant left/main game stage with a persistent **AI Decision History** column. That column is never a setup rail. Center Doom inside its available stage; place duration, Next Decision, and persistent operational status immediately beneath it. History remains visible content, not an advanced-evidence disclosure.

Narrow order: identity/setup → game → duration/Next Decision/status → AI decision history → advanced evidence → notices. Maintain matching reading and keyboard order. Setup fields stack as needed; controls wrap without squeezed targets. Do not hide setup automatically.

Provisional sizing hypotheses: shell maximum (1360px), history column (320px), column gap (24px), two-column starting breakpoint (1120px), and canvas display ceiling (960px). Use a small spacing rhythm (4, 8, 12, 16, 24, 32px), with tighter spacing inside a group and larger separation between groups. These are review candidates, not fixed device assumptions.

Fit the stage to available width **and height**, retaining nearby action controls in short windows. Stack when space or zoom makes the companion column impractical. Allow normal page scrolling rather than clipping content. A bounded desktop history scroller is acceptable; prefer page scrolling on narrow screens. Long filenames and technical identifiers wrap without widening the page.

Preserve the intrinsic canvas (640×400), uncropped 8:5 image, complete HUD, and pixel-art presentation. Only CSS display dimensions may change. Pixelated scaling is the intended treatment; fractional scaling still needs visual inspection. Do not stretch, crop, round off, overlay, or repaint the framebuffer for UI decoration.

## Elevation & Depth

Use flat tonal separation and understated functional borders. No decorative shadows, gradients, glows, heavy cards, or industrial framing. Keep the game's own depth and texture dominant. No ornamental animation; pending feedback may use a small text-supported indicator that respects reduced-motion preferences. Do not animate gameplay or imply simulation during waits.

## Shapes

Keep simple rectangular controls and unframed game/history regions. A small control radius (provisionally 4px) may soften native fields and buttons. Preserve square corners on the complete 8:5 framebuffer. Avoid pill-shaped output badges, nested card shells, and decorative corner treatments.

## Components

### Duration and primary action

Group the human-owned integer duration (1–20 tics, default 6) with **Next Decision**. Explain that duration belongs to the human and action selection belongs to the AI. The amber button is the strongest UI control. Provisionally target interactive heights of at least 44 CSS px; validate actual touch and keyboard usability.

Retain clear hover, focus, disabled, and pending treatments. A provisional focus ring (3px with 3px offset) must stay visible and unclipped. Pending retains its footprint and readable stage text; disabled is legible and distinguishable without relying on faint opacity alone. Keep validation and persistent recovery/fatal explanations close to the controls, without silently editing the duration or triggering requests.

### AI Decision History and probabilities

Show newest decisions first. Each compact collapsed row exposes **decision number, AI-selected action, API latency, and honest execution state**. Omit duration from summaries. When selection or latency is absent, say pending/unavailable as appropriate; do not imply zero. The newest row provides the latest result; do not duplicate a separate latest-result card.

Every row supports mouse and native keyboard disclosure. Expansion shows all seven actual validated action probabilities: `neutral`, `forward`, `turn_right`, `backward`, `turn_left`, `fire`, `use`. Sort descending for scanning, using deterministic ties. Show labeled percentages; proportional bars are optional and must represent the supplied values directly. Mark the **actual selected action** with explicit text and weight, even when it is not the highest-probability option. Display confidence separately if present. Never normalize, synthesize, or replace missing/invalid metrics with zeros; say **"Action probabilities unavailable."**

Clearly distinguish pending choice, execution verification, verified execution awaiting a frame, complete verified results, failed requests, and uncertain native completion. Preserve precise recovery wording and verified-prefix evidence. A selected action is not proof of execution; verified execution without a verified resulting frame is not complete success. Readiness alone does not mean the last decision succeeded.

Keep open rows, keyboard focus, and sensible scroll position stable across status updates and new entries. Do not force scrolling to the newest item while the user inspects older decisions. Keep operational announcements concise; avoid re-announcing the entire history. Empty history states that no AI decisions exist yet; preparation's neutral tic is not an AI decision.

### Setup and engineering evidence

Keep labeled local IWAD and temporary BYOK password controls compact and accessible when needed, including key replacement under existing readiness rules. Preserve masking, capture/clearing, and temporary in-memory behavior; never reproduce a real key in documentation, status, storage, logs, or examples. Explain that a cleared field may coexist with a retained client. A retained-client indicator must never claim validated authentication. Retain concise direct-to-OpenAI and page/script-trust guidance.

Use accessible disclosures for technical receipts and advanced evidence. Preserve selected duration, distinct requested/reported/independently verified tic counts, uncertainty, checkpoints, hashes, request IDs, and operational diagnostics. Keep notices legible. Probability inspection is first-class history content; it is not buried inside engineering evidence.

### Accessibility and interaction states

Retain associated labels, descriptive help, visible focus, semantic headings, and concise live status. Use text as well as color for selection/errors; aim for text contrast of at least 4.5:1, or 3:1 for large text, and distinguishable control boundaries/focus. These are design targets, not a claim of verified conformance. Support 200% zoom, touch, keyboard expansion, and reduced motion without clipped controls or HUD. Error explanations persist long enough to read and identify corrective action; fatal uncertainty retains the reload instruction.

## Do's and Don'ts

### Do:

- **Do** keep Doom dominant and AI history persistently visible beside it or below its controls.
- **Do** preserve the full framebuffer, readable controls, honest outcomes, and complete secondary evidence.
- **Do** treat exact styling values as provisional until reviewed in rendered desktop, narrow, short-window, and zoom states.

### Don't:

- **Don't** introduce a setup rail, heavy cards, industrial ornament, neon, fake terminal/pixel fonts, or gratuitous animation.
- **Don't** hide AI history as diagnostics, repeat duration in every summary, fabricate probabilities, or confuse confidence with probability.
- **Don't** alter Worker/native contracts, passive zero-tic behavior, single-click request admission, or credential handling for visual polish. An admitted click makes at most one billable Decisions request; no autoplay, automatic retries, Play/Stop, Reset, or Prepare controls are added in this pass.
