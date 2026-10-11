---
name: Doom Decisions
description: A game-first dark viewer with visible AI decisions and deliberate human control.
---

# Design System: Doom Decisions

## Overview

**Creative North Star: "Doom and its decisions take center stage"**

Doom anchors the visual character. Readable surroundings and clear controls give the framebuffer priority while keeping AI decision history visible as its companion. The human chooses when and how long; the AI chooses the action.

The interface keeps attention on the game, its next decision, and the visible history. Setup is prominent during onboarding, secondary during gameplay, and always discoverable for intervention or replacement. Cards, panel framing, borders, controlled gradients, subtle depth, graphic emphasis, and tasteful industrial or game-adjacent details are available design tools where they improve hierarchy, cohesion, legibility, or personality. None is mandatory; choose a cohesive treatment rather than adding every effect.

**Status:** Design direction reconciled with the owner's choices after reviewing the second UI polish screenshot. Setup collapse below is **intended future behavior, not implemented behavior**. The owner-selected direction and native-size canvas ceiling are binding guidance; numerical color, type, spacing, radius, and layout candidates remain **provisional starting hypotheses**, not certified tokens. Frontmatter deliberately omits normative tokens until implementation and visual review establish them.

**Historical observations, not current target rules:** The saved investigation and critique describe the earlier 850px column, light controls, chronological multiline receipts, and substantial setup above the game. They predate the two polish passes. The current uncommitted presentation uses dark controls, newest-first expandable AI history, and a 640px canvas ceiling; setup inputs remain exposed. The owner's second screenshot review does not establish mobile, zoom, pending/error, or future setup-collapse behavior. No new rendered or runtime verification is claimed here.

**Key Characteristics:**

- Doom first, visible AI history second, with duration and Next Decision immediately accessible.
- Cohesive surfaces and readable typography; clear primary-action emphasis with room for visual personality.
- Honest decision feedback, accessible inspection, and secondary complete evidence.

Sources: [PRODUCT.md](PRODUCT.md), [UI investigation](docs/doom-ui-polish-investigation.md), [completed critique](.impeccable/critique/2026-10-11T21-11-02Z__app-index-html.md), current presentation source, and the owner's subsequent choices. Those choices supersede earlier suggestions for an enlarged canvas, a separate latest-result slot, chronological history, and categorical visual-style restrictions. The setup lifecycle below also supersedes the earlier prohibition on automatic collapse. Implementation stays vanilla TypeScript/Vite with plain CSS in a static app; styled native controls and disclosures remain the baseline. Web Awesome Core remains eligible for a later evidence-driven experiment, not a design requirement.

## Colors

The warm-neutral palette remains a starting direction, with room for cohesive surface variation and controlled gradients. The following candidates are proposals, not extracted implementation tokens; validate actual combinations, including disabled and focus states, before adoption.

| Role | Provisional candidate | Use |
|---|---|---|
| Primary: muted amber | `#D2A65B` | Next Decision background; hover stays within this role. |
| Primary ink | `#201A10` | Text on the amber action. |
| Neutral: quiet charcoal | `#191919` | Page and stage surroundings. |
| Neutral: raised charcoal | `#232323` | Fields and subtle disclosure hover/open treatment. |
| Neutral: warm off-white | `#E8E3D9` | Primary text and selected-action emphasis. |
| Neutral: supporting gray | `#ADA79E` | Help, latency, and secondary text. |
| Neutral: control boundary | `#81786B` | Field boundaries and optional cohesive panel framing. |
| Interaction: pale blue | `#B9D9F4` | Focus and links; distinct from action emphasis. |

**The Amber Action Rule.** Reserve amber emphasis for Next Decision. Selected probabilities use text weight and an explicit label. Errors, uncertainty, and readiness require words; color alone never communicates state. Additional semantic colors remain unresolved unless they improve comprehension during visual review.

## Typography

Use `system-ui, sans-serif` for identity, instructions, controls, and history. Use `ui-monospace, monospace` sparingly for hashes, request identifiers, and technical counts. No downloaded font or display-font dependency is required.

Provisional hierarchy: product title (28–32px, weight 700, line-height 1.2); section title (18–20px, weight 600, line-height 1.3); body and controls (16px, line-height 1.5); supporting text (14px, line-height 1.5). Labels use weight 600. Keep mixed-case labels, readable disabled text, and tabular numerals where useful for latency/percentages. The game remains more prominent than the title.

## Layout

For this MVP, place compact identity and local IWAD/key setup **above** the main experience. On sufficiently wide screens, pair a dominant left/main game stage with a persistent **AI Decision History** column. That column is never a setup rail. Center Doom inside its available stage; place duration, Next Decision, and persistent operational status immediately beneath it. History remains visible content, not an advanced-evidence disclosure.

Narrow order: identity/setup → game → duration/Next Decision/status → AI decision history → advanced evidence → notices. Maintain matching reading and keyboard order. Setup fields stack as needed; controls wrap without squeezed targets. In the intended future lifecycle, setup may become a compact expandable summary only under the conditions in Components below; game readiness alone is insufficient.

Provisional sizing hypotheses: shell maximum (1360px), history column (320px), column gap (24px), and two-column starting breakpoint (1120px). Use a small spacing rhythm (4, 8, 12, 16, 24, 32px), with tighter spacing inside a group and larger separation between groups. These are review candidates, not fixed device assumptions; the canvas ceiling below is an owner decision.

Fit the stage to available width **and height**, retaining nearby action controls in short windows. Stack when space or zoom makes the companion column impractical. Allow normal page scrolling rather than clipping content. A bounded desktop history scroller is acceptable; prefer page scrolling on narrow screens. Long filenames and technical identifiers wrap without widening the page.

Preserve the native framebuffer and intrinsic canvas at **640×400 (8:5)**. Display at up to **640×400 CSS px** on sufficiently spacious desktops; scale down proportionally when width or height is constrained. Never enlarge above native size or change to 640×480. Preserve the uncropped image, complete HUD, and pixel-art presentation. Only CSS display dimensions may change. Pixelated scaling is the intended treatment; fractional downscaling still needs visual inspection. Do not stretch, crop, round off, overlay, or repaint the framebuffer for UI decoration.

## Elevation & Depth

Flat tonal separation, cohesive panels or cards, borders, controlled gradients, subtle shadows or glows, and industrial framing are all options. Choose them for the hierarchy, cohesion, legibility, or personality they add to the game-and-decision-history experience. Keep Doom and history central; avoid distracting ornament, excessive layering, or effects that reduce contrast or performance. No effect is a required addition. Any motion must have a clear purpose and respect reduced-motion preferences; pending feedback may use a small text-supported indicator. Do not animate gameplay or imply simulation during waits. Treatments must fit the existing static-app, CSP, and dependency constraints.

## Shapes

Use a coherent shape language across controls, disclosures, and optional game/history panel shells. A small control radius (provisionally 4px) remains a candidate, not a restriction on other useful shapes. Badges, framing, and decorative corners may help grouping or emphasis when they remain readable and do not add needless nesting or clutter. Preserve square corners on the complete 8:5 framebuffer; surrounding treatment must not cover or clip it.

## Components

### Duration and primary action

Group the human-owned integer duration (1–20 tics, default 6) with **Next Decision**. Duration is captured at click admission before asynchronous work. Explain that duration belongs to the human and action selection belongs to the AI. The amber button is the strongest UI control. Provisionally target interactive heights of at least 44 CSS px; validate actual touch and keyboard usability.

Retain clear hover, focus, disabled, and pending treatments. A provisional focus ring (3px with 3px offset) must stay visible and unclipped. Pending retains its footprint and readable stage text; disabled is legible and distinguishable without relying on faint opacity alone. Keep validation and persistent recovery/fatal explanations close to the controls, without silently editing the duration or triggering requests.

### AI Decision History and probabilities

Show newest decisions first. Each compact collapsed row exposes **decision number, AI-selected action, API latency, and honest execution state**. Omit duration from summaries. When selection or latency is absent, say pending/unavailable as appropriate; do not imply zero. The newest row provides the latest result; do not duplicate a separate latest-result card.

Every row supports mouse and native keyboard disclosure. Expansion shows all seven actual validated action probabilities: `neutral`, `forward`, `turn_right`, `backward`, `turn_left`, `fire`, `use`. Sort descending for scanning, using deterministic ties. Show labeled percentages; proportional bars are optional and must represent the supplied values directly. Mark the **actual selected action** with explicit text and weight, even when it is not the highest-probability option. Display confidence separately if present. Never normalize, synthesize, or replace missing/invalid metrics with zeros; say **"Action probabilities unavailable."**

Clearly distinguish pending choice, execution verification, verified execution awaiting a frame, complete verified results, failed requests, and uncertain native completion. Preserve precise recovery wording and verified-prefix evidence. A selected action is not proof of execution; verified execution without a verified resulting frame is not complete success. Readiness alone does not mean the last decision succeeded.

Keep open rows, keyboard focus, and sensible scroll position stable across status updates and new entries. Do not force scrolling to the newest item while the user inspects older decisions. Keep operational announcements concise; avoid re-announcing the entire history. Empty history states that no AI decisions exist yet; preparation's neutral tic is not an AI decision.

### Setup lifecycle (intended future behavior)

**Onboarding prominent, gameplay secondary, replacement always discoverable.** This lifecycle is design intent for a future implementation; automatic setup collapse is not present in the current polish. Keep labeled local IWAD and temporary BYOK password controls clearly accessible while setup is needed. Preparing Doom alone must not hide the key input still needed for the first API request. Only after Doom is prepared **and the API client has been captured for the session** may setup automatically become a compact, user-expandable summary. Do not trigger credential capture, authentication probes, or an API request merely to collapse setup.

Never collapse while the user is editing or has focus inside setup, or overwrite a deliberate user expansion during subsequent state updates. Provide an obvious keyboard-accessible disclosure with visible focus and an announced expanded/collapsed state; preserve user choice and focus. The compact summary identifies the selected local asset and retained-client state without exposing a credential or implying successful authentication. Keep validation errors, intervention guidance, and recovery instructions visible and make affected controls easy to reveal; do not conceal unresolved setup problems.

Replacement remains discoverable under existing readiness rules: a replacement key can be entered during a healthy idle session before the next explicit click. An invalid IWAD may be corrected before native preparation is admitted; once preparation is admitted, the picker remains locked and changing the asset requires refresh. Disclosure does not unlock controls, restart Doom, or change recovery behavior.

Preserve masking, capture/clearing, and temporary in-memory behavior; never reproduce a real key in documentation, status, storage, logs, or examples. Explain that a cleared field may coexist with a retained client, and that a blank field keeps that client. A retained client is **not proof of successful authentication**. Retain concise direct-to-OpenAI, page/script-trust, and refresh-clears-credentials guidance in the setup flow, with full explanations discoverable when compact. This remains temporary browser-direct BYOK through the official OpenAI Decisions SDK, without a backend/proxy, persistent credential storage, or a claim of production credential security.

### Engineering evidence

Use accessible disclosures for technical receipts and advanced evidence. Preserve selected duration, distinct requested/reported/independently verified tic counts, uncertainty, checkpoints, hashes, request IDs, and operational diagnostics. Keep notices legible. Probability inspection is first-class history content; it is not buried inside engineering evidence.

### Accessibility and interaction states

Retain associated labels, descriptive help, visible focus, semantic headings, and concise live status. Use text as well as color for selection/errors; aim for text contrast of at least 4.5:1, or 3:1 for large text, and distinguishable control boundaries/focus. These are design targets, not a claim of verified conformance. Support 200% zoom, touch, keyboard expansion, and reduced motion without clipped controls or HUD. Error explanations persist long enough to read and identify corrective action; fatal uncertainty retains the reload instruction.

## Do's and Don'ts

### Do:

- **Do** keep Doom dominant and AI history persistently visible beside it or below its controls.
- **Do** make setup prominent for onboarding, secondary after preparation and client capture, and discoverable for intervention or replacement without overriding user choice.
- **Do** use panels, cards, borders, gradients, depth, and decoration selectively when they improve the game-and-history experience; they are options, not a checklist.
- **Do** preserve the full framebuffer, readable controls, honest outcomes, and complete secondary evidence.
- **Do** honor the 640×400 CSS px canvas ceiling and treat other numerical styling candidates as provisional until reviewed in rendered desktop, narrow, short-window, and zoom states.

### Don't:

- **Don't** displace the persistent history column with a setup rail, let ornament distract from Doom or history, or add effects solely to satisfy a visual-style checklist.
- **Don't** collapse setup before both preparation and client capture, while the user edits, or over a deliberate expansion; never equate client retention with authentication.
- **Don't** hide AI history as diagnostics, repeat duration in every summary, fabricate probabilities, or confuse confidence with probability.
- **Don't** alter Worker/native/WASM contracts, rendering or capture, passive zero-tic behavior, official SDK request boundaries, single-click request admission, or credential handling for visual design. An admitted click makes at most one billable Decisions request; no autoplay, automatic retries, Play/Stop, Reset, New Game, or Prepare controls are added.

## Open visual design decisions

A later Impeccable-led redesign may choose the degree of panel/card framing, surface depth or gradients, industrial/game-adjacent detail, the compact setup summary's composition, and the final palette, type scale, spacing, and responsive breakpoints. Evaluate these together for hierarchy, personality, contrast, performance, and desktop/narrow/short-window/zoom usability. The setup visibility rules, first-class newest-first history, and native-size canvas ceiling are settled constraints rather than open aesthetic questions.
