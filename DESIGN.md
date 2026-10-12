---
name: "Doom Decisions"
description: "A game-first dark viewer with visible AI decisions and deliberate human control."
colors:
  primary: "#d2a65b"
  primary-hover: "#e0b66f"
  primary-active: "#bf944d"
  primary-ink: "#201a10"
  page: "#151716"
  text: "#e8e3d9"
  muted: "#b2b4aa"
  boundary: "#7f8778"
  focus: "#b9d9f4"
  rule: "#42483e"
  field: "#20251e"
  field-disabled: "#242923"
  setup: "#2b3128"
  controls: "#2e352a"
  secondary-action: "#363d30"
  secondary-hover: "#444c3e"
  action-boundary: "#81745b"
  action-disabled: "#413827"
  action-disabled-ink: "#c4b493"
  disclosure-hover: "#353d30"
  history-open: "#292f25"
  selected: "#3b4533"
  probability: "#939d89"
  track: "#353d31"
typography:
  headline:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
  action-label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: 1.5
  decision-action:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  supporting:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  metadata:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  evidence:
    fontFamily: "ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  detail: "3px"
  field: "6px"
  action: "8px"
  panel: "12px"
  console: "16px"
spacing:
  micro: "0.25rem"
  tight: "0.375rem"
  small: "0.5rem"
  row: "0.625rem"
  group: "0.75rem"
  inset: "0.875rem"
  base: "1rem"
  roomy: "1.25rem"
  section: "1.5rem"
  outer: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.action-label}"
    rounded: "{rounded.action}"
    padding: "0.625rem 1.25rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
  button-secondary:
    backgroundColor: "{colors.secondary-action}"
    textColor: "{colors.text}"
    typography: "{typography.action-label}"
    rounded: "{rounded.action}"
    padding: "0.625rem 1.25rem"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  button-secondary-active:
    backgroundColor: "{colors.controls}"
  button-disabled:
    backgroundColor: "{colors.action-disabled}"
    textColor: "{colors.action-disabled-ink}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "0.5rem 0.75rem"
  setup:
    backgroundColor: "{colors.setup}"
    textColor: "{colors.text}"
  control-panel:
    backgroundColor: "{colors.controls}"
    rounded: "{rounded.panel}"
    padding: "1rem"
  history-open:
    backgroundColor: "{colors.history-open}"
    rounded: "{rounded.panel}"
  probability-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
  selected-marker:
    textColor: "{colors.text}"
    rounded: "{rounded.detail}"
    padding: "0 0.25rem"
---

# Design System: Doom Decisions

## Overview

**Creative North Star: "Doom and its decisions take center stage"**

Doom anchors the visual character. Olive-charcoal surfaces, warm off-white text,
and a muted amber primary action surround the framebuffer without competing with
it. System typography keeps instructions direct; visible AI history lets people
follow each choice and inspect its outcome. The human chooses when and how long;
the AI chooses the action.

The interface groups setup, game, controls, and history inside one rounded console.
Tonal layers, controlled gradients, a soft outer shadow, and precise disclosure
details give it depth. Setup is prominent during onboarding, secondary during
play, and discoverable for intervention or replacement. Framing and game-adjacent
details remain available when they improve hierarchy, cohesion, legibility, or
personality; additional effects are not requirements.

**Key Characteristics:**

- Doom first, visible AI history second, with duration and manual/continuous controls immediately accessible.
- Olive-charcoal layers, readable system typography, and amber emphasis for Next Decision.
- Honest decision feedback, native disclosures, and complete secondary evidence.

**Reference status:** Refreshed from `app/index.html`, `app/src/style.css`,
`app/src/decision-history.ts`, and setup presentation in `app/src/main.ts` on
2026-10-12, including the owner's accepted Live copy and alignment changes.
Frontmatter records implemented values for reuse; it does not certify contrast,
responsive usability, or browser/gameplay behavior. No browser, build, or runtime
verification was performed for this refresh. The native-size canvas ceiling,
setup lifecycle, and first-class history remain accepted guardrails.
See [PRODUCT.md](PRODUCT.md) for product truth, [AGENTS.md](AGENTS.md) for execution
constraints, and [app/README.md](app/README.md) for runtime evidence and its limits.

## Colors

The palette combines olive-tinted charcoal, warm readable text, muted amber, and
pale blue interaction cues. Frontmatter is the source-derived value reference;
the names below explain its roles. The sidecar's eight-step OKLCH ramps are
synthesized panel explorations, not implemented palette scales or new app tokens.

### Primary

- **Muted amber** (`primary`, with hover and active variants) makes Next Decision the strongest control.
- **Dark amber ink** (`primary-ink`) supplies text on the primary button.

### Neutral

- **Deep charcoal** (`page`) anchors the page; the game stage is darker still.
- **Warm off-white** (`text`) carries main copy, selected actions, and selected probability fills.
- **Sage-gray supporting text** (`muted`) carries help, latency, and secondary state.
- **Olive layers** (`setup`, `controls`, `field`, `field-disabled`, `history-open`) distinguish functional regions without another accent.
- **Action surfaces** (`secondary-action`, `secondary-hover`, `action-boundary`) distinguish Start and Stop from Next Decision.
- **Muted ochre disabled state** (`action-disabled`, `action-disabled-ink`) keeps unavailable actions readable without opacity-only fading.
- **Olive boundaries** (`boundary`, `rule`) separate fields, rows, and evidence.
- **Sage fill and dark olive track** (`probability`, `track`) represent supplied probabilities; the selected row uses `selected` and warm off-white.
- **Disclosure hover** (`disclosure-hover`) highlights interactive summaries.

### Interaction

- **Pale blue** (`focus`) marks focus rings, links, carets, and selection backgrounds. It is an interaction cue rather than a second action accent.

**The Amber Action Rule.** Reserve amber emphasis for Next Decision. Selected probabilities use text weight and an explicit label. Errors, uncertainty, and readiness require words; color alone never communicates state.

## Typography

**Interface font:** `system-ui, sans-serif`. **Evidence font:**
`ui-monospace, monospace`. There is no downloaded font or separate display face.
Mixed-case labels and a restrained title leave the game dominant. Tabular numerals
stabilize tic inputs, decision numbers, latency, percentages, and continuous state.

| Role | Source-derived treatment | Use |
|---|---|---|
| Headline | Frontmatter `headline`; 1.75rem below 640px | Product identity |
| Title | Frontmatter `title` | AI Decision History heading |
| Body | Frontmatter `body` | Introductory copy and input text |
| Label | Frontmatter `label`; setup title uses weight 650 | Setup and duration labels |
| Action label | Frontmatter `action-label` | Manual and continuous buttons |
| Decision action | Frontmatter `decision-action` | Action in each history summary |
| Supporting | Frontmatter `supporting` | Help, notices, probabilities, main status |
| Metadata | Frontmatter `metadata` | Client state, execution state, compact guidance |
| Evidence | Frontmatter `evidence` | Wrapped technical receipts |

Latency is smaller (0.75rem); the Selected marker uses 0.6875rem. These describe
current code, not proof of readability. Trust copy has an 85ch ceiling; the footer
has a 90ch ceiling. There is no global body measure. Monospace stays with evidence;
do not add terminal or pixel fonts to surrounding controls.

## Layout

Identity and setup precede the main experience. The centered page shell has a
maximum border-box width (1184px), side padding (2rem), and vertical margin (2rem).
The usable console width at that maximum is 1120px. The game region's ceiling
(688px) includes side padding (1.5rem each), leaving the native 640px canvas.
Controls and operational status sit beneath the game. History remains visible
content, followed by advanced evidence and notices.

| Viewport width | Implemented composition |
|---|---|
| At least 1168px | Game region (688px) and flexible history column with a left divider. Four-column setup summary; client status occupies column four and aligns right. |
| 640–1167px | Game and history stack, each centered with a 688px ceiling. Setup fields remain two equal columns. Client status spans the summary's text columns and aligns right. |
| Below 640px | Page side padding (1rem), vertical margin (1.25rem), single-column setup fields, game/history padding (1rem), control-panel padding (0.75rem). Summary text occupies column two. Duration labels stack above inputs; Next and Start can grow. |

Controls wrap with row/column gaps (0.75rem / 1rem); the attempt-budget group
begins a new flex row. Setup fields use gaps (0.75rem / 1.5rem). Desktop game and
history have no separate gutter: internal padding provides separation. Both page
and history use document scrolling; there is no bounded history scroller.

Frontmatter spacing names describe repeated rem values; they are not existing CSS
spacing variables. Long filenames, states, and identifiers wrap. Reading and
keyboard order follow the stacked composition.

**The Native Frame Rule.** Preserve the intrinsic framebuffer (640×400, 8:5) and display it at no more than 640×400 CSS px. Scale down proportionally for available width, keep square corners and pixelated rendering, and preserve the full image and HUD. Never stretch, crop, enlarge, overlay, or repaint it for decoration.

Current canvas CSS constrains width and uses automatic height, with no
viewport-height fitting rule. Short windows rely on page scrolling. Height-aware
fitting, fractional downscaling, narrow layouts, and 200% zoom still need visual
review before stronger usability claims.

## Elevation & Depth

Depth comes from olive tonal layers, two controlled gradients, and one soft console
shadow. The page uses `radial-gradient(ellipse at 35% 0, #2a3027, #151716 65%)`;
the console uses `linear-gradient(125deg, #242923, #1c201b)`. Its outer shadow
(`0 20px 56px #0005`) lifts the experience rather than each row. Dividers organize
setup, history, status, and receipts. The stage has a dark surface (`#10130f`) and
fine offset outline (`1px solid #4c5345`, offset `5px`), leaving the image untouched.

There are no authored animation or transition rules. Hover, active, disclosure,
and pending states change directly. Any future motion must serve an interaction,
respect reduced-motion preferences, and never imply gameplay during API waits or
idle observation.

## Shapes

Use gently rounded outer containment and smaller radii inside: console (16px),
control panel and open history treatment (12px), action buttons (8px), fields and
selected probability rows (6px), file-picker button, Selected marker, and meters
(3px). Setup rounds only its top corners to meet the console. The canvas is square
and unmasked. Controls and fields use thin boundaries (1px).

Native setup/history disclosures use CSS-drawn chevrons (6px, 1.5px strokes),
rotated when open. Preserve native interaction. Avoid nested decorative containers
where existing tonal grouping and dividers already explain structure.

## Components

### Buttons

Confident primary action, quieter continuous controls. Next Decision uses amber
and dark ink; Start Continuous Mode and Stop use olive and warm text. All use
minimum height (48px), action radius, weight 650, and padding
(0.625rem 1.25rem). Hover/active colors are in frontmatter. Below 640px, Next and
Start reduce horizontal padding (0.75rem). Disabled actions share muted ochre and
a default cursor. Busy Next Decision uses a wait cursor while retaining its label
and footprint.

### Inputs and focus

Dark fields use the field surface, olive boundary, field radius, minimum height
(44px), and padding (0.5rem 0.75rem). Hover brightens the boundary. Disabled fields
use the disabled surface and muted text. The file field has padding (0.25rem);
its native picker button uses minimum height (36px), padding (0.25rem 0.75rem),
and olive default/hover fills (`#394033` / `#484f42`).

Keyboard focus uses a pale-blue outline (3px) with offset (3px). Links use pale
blue with underline offset (0.2em); carets use the same blue. Selection uses pale
blue behind dark text (`#191919`). Scrollbars use the boundary color over dark
olive (`#1d211b`). Retain labels, descriptive help, native semantics, and concise
live status. Contrast and 200% zoom remain targets, not verified conformance.

### Setup disclosure

Prominent before play, compact when safely ready. The summary combines a semibold
title, selected local filename/state, and right-aligned client state. With no
selected file, the filename slot is empty and hidden; the old placeholder is
removed. The label reads **Local Freedoom WAD**. Help reads: “Your Freedoom WAD
stays on your computer. The engine loads automatically. Refresh to change the
file.” Shorter labels do not change supported asset identity in the setup guide.

Preserve the accepted one-time collapse lifecycle: verified preparation, retained
client, healthy idle readiness, an empty key field, and no focus inside setup must
all hold. Preparing Doom alone must not hide the key input. Deliberate expansion
or opened recovery guidance prevents later automatic collapse. Keep unresolved
problems discoverable and preserve keyboard access, focus, and user choice.
“API client retained · authentication unverified” never implies authentication.

Preserve masking, capture/clearing, blank-field retention, and replacement
behavior. Direct-to-OpenAI, page/script trust, and refresh-clears-credentials
guidance remain discoverable in the handling/trust disclosure. Visual edits must
not trigger capture, probes, requests, or gameplay to collapse setup.

### Duration and continuous controls

Group human-owned tics with Next Decision. The tics field is 5rem wide, reducing
to 4.5rem below 640px; the attempt-budget field is 9rem. Keep duration and the
separate per-run budget visibly distinct. Preserve explicit Start/Stop, legible
cleanup status, persistent recovery wording, and disabled/pending meanings.
Duration changes during a run affect only later admissions. PRODUCT.md and
AGENTS.md own the admission, cleanup, and verification contracts.

### AI Decision History

Compact, newest-first native disclosure rows. Each summary exposes decision
number, AI-selected action, API latency, and honest execution state; duration
stays in the receipt. Action type is stronger than metadata. Rows have bottom
dividers; open rows gain an olive surface and panel radius, with a transparent
bottom divider. The empty state explains that no AI decisions exist and the
preparation neutral tic is not an AI decision.

Expansion shows all seven validated action probabilities, descending with
deterministic ties. Labeled percentages pair with native meters (6px high). The
actual selected action gets warm text, an olive highlight, and an explicit
Selected marker, even when another action has higher probability. Confidence is
separate. Missing/invalid values say **Action probabilities unavailable.** Never
synthesize, normalize, or substitute zeros for unavailable values.

Reuse row nodes across updates to preserve open disclosures and focus. Do not
force scrolling while someone inspects older decisions. Keep pending choice,
verification, verified execution awaiting a frame, completed results, failure,
and uncertainty distinct. A selection is not execution; execution without a
verified resulting frame is not complete success.

### Evidence and status

Technical receipts nest in expanded history; advanced evidence has its own native
disclosure below the console. Wrapped monospace text exposes duration,
requested/reported/independently verified tics, verified prefixes, checkpoints,
hashes, and sanitized request information. Status sits beneath controls with a
divider and minimum height (3em); busy/error states gain weight 600. Readiness is
distinct from the last outcome. Fatal uncertainty keeps reload guidance;
exit-pending wording must not imply E1M2.

## Do's and Don'ts

### Do:

- **Do** keep Doom dominant and AI history visible beside it or below its controls.
- **Do** reuse olive-charcoal layers, system typography, and coherent radii; use framing and depth for hierarchy and legibility.
- **Do** reserve amber emphasis for Next Decision and express selection, readiness, errors, and uncertainty with words.
- **Do** preserve the full 640×400 framebuffer, its CSS size ceiling, readable controls, and complete secondary evidence.
- **Do** keep setup prominent until preparation and client capture permit collapse, preserving intervention, user choice, and focus.
- **Do** distinguish source-derived values and owner-accepted changes from uncollected responsive, accessibility, and runtime evidence.

### Don't:

- **Don't** replace persistent history with a setup rail, duplicate the newest result in another card, or hide probabilities as engineering diagnostics.
- **Don't** show the removed asset placeholder, repeat duration in history summaries, fabricate probabilities, or equate retained credentials with authentication.
- **Don't** stretch, crop, enlarge, round, decorate over, or repaint the framebuffer.
- **Don't** collapse setup before verified preparation and client capture, during editing, or over deliberate expansion or recovery.
- **Don't** alter Worker/native/WASM behavior, passive zero-tic observation, SDK admission/reader cleanup, Stop fences, credentials, or verification contracts for visual work.
- **Don't** introduce autoplay, automatic retries/restarts, Reset, New Game, or Prepare controls; preserve explicit manual and continuous admission.
