---
name: Doom Decisions — AI Broadcast
description: A restrained viewing console for real Doom, human-controlled duration, AI action choices, and inspectable execution evidence.
colors:
  page: "#10120e"
  surface: "#13160f"
  ivory: "#efe5d2"
  amber: "#f5b94f"
  light-action: "#d9ccb0"
  ink: "#191b14"
  muted: "#b6b4a8"
  boundary: "#7f8778"
  focus: "#b9d9f4"
  rule: "#4b4e40"
  probability: "#939d89"
  track: "#353d31"
typography:
  display:
    fontFamily: 'Oswald, "Arial Narrow", "Helvetica Neue", sans-serif'
    fontSize: "clamp(2.25rem, 4vw, 3.25rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  game-heading:
    fontFamily: 'Oswald, "Arial Narrow", "Helvetica Neue", sans-serif'
    fontSize: "2rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  section-label:
    fontFamily: 'Oswald, "Arial Narrow", "Helvetica Neue", sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.22em"
  outcome:
    fontFamily: 'Oswald, "Arial Narrow", "Helvetica Neue", sans-serif'
    fontSize: "clamp(2.25rem, 4vw, 3rem)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
  help:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.875rem"
  receipt:
    fontFamily: "ui-monospace, monospace"
    fontSize: "0.8125rem"
    lineHeight: 1.6
rounded:
  control: "2px"
spacing:
  compact: "0.375rem"
  control-gap: "0.625rem"
  group-gap: "0.75rem"
  content: "1rem"
  panel: "1.25rem"
  section: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.625rem 0.5rem"
  button-secondary:
    backgroundColor: "{colors.light-action}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.625rem 0.5rem"
  button-stop:
    backgroundColor: "transparent"
    textColor: "{colors.ivory}"
    rounded: "{rounded.control}"
    padding: "0.625rem 0.5rem"
  input:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.625rem"
---

# Design System: Doom Decisions — AI Broadcast

## Overview

**Creative North Star: "AI Broadcast"**

AI Broadcast frames Doom Decisions as a restrained viewing console: near-black olive and charcoal surfaces, warm ivory text, amber action accents, and condensed display typography. The persistent setup and control rail, game stage, and complete decision history make watching, admitting actions, and inspecting evidence part of one interface.

The game image remains the visual center. Readable system text carries setup instructions, operational status, and receipts; Oswald gives identity, actions, and decision numbers their hierarchy. Thin rules and tonal changes organize dense information, while native disclosures keep technical detail available.

**Key Characteristics:**

- Olive-black surfaces, thin borders, warm ivory text, and selective amber emphasis.
- Locally hosted Oswald for display roles; system sans-serif for reading.
- Persistent session controls, an uncropped pixelated game view, and complete newest-first history.
- Evidence-aware outcomes and explicit pending, stopping, unavailable, and terminal states.

### Documentation baseline and authority

This is a normal documentation scan of the implemented interface, not a seed or
redesign. On 2026-10-13 the repository root was
`/Users/mike/projects/doom-decisions`, branch `main`, HEAD
`9c1b61b1c946b5aa76045970985db743ee29dfc7`
(`feat(ui): polish AI Broadcast controls and decision history`). The working
tree was clean before generation; the Slice 4 interface was committed.

Visual authority is [app/index.html](app/index.html) and
[app/src/style.css](app/src/style.css). Presentation behavior is read from
[decision-history.ts](app/src/decision-history.ts),
[latest-outcome.ts](app/src/latest-outcome.ts), and the display/render paths in
[main.ts](app/src/main.ts), with optional metric validation in
[decision.ts](app/src/decision.ts). [PRODUCT.md](PRODUCT.md) and
[AGENTS.md](AGENTS.md) supply durable product constraints.

The committed [ui-experiment.png](ui-experiment.png) was visually inspected for
the original AI Broadcast intent. It is an illustrative concept, not a runtime
capture. Its gameplay, sample completed decisions, “Loaded” indicator, oversized
image, “E1M1” heading, and ornamental surface effects are not implementation
evidence. Neither superseded design file was consulted from Git history.

The palette, fonts, DOM structure, CSS rules, and presentation conditions below
are directly observed in source. “Restrained”, “flat”, and the reusable spacing
rhythm are descriptive interpretations of that source and the owner's brief.
Responsive behavior is specified by CSS, not browser-tested in this scan. No
server, browser, build, tests, Worker/WASM, WAD, or API was run. Actual font
loading, layout/overflow, disclosure and focus behavior, assistive-technology
announcements, and runtime outcome/frame linkage remain unverified here. Existing
prototype observations and their limits remain in [app/README.md](app/README.md).

The frontmatter records a selected reusable vocabulary, not every literal in the
stylesheet. Spacing names summarize observed repeated values; they are not new
CSS variables or a mandatory scale. The sidecar extends these tokens with
component previews and metadata. Its synthesized color ramps are preview aids,
not implemented colors or permission to expand the palette. Component previews
are static style examples; fields, outcome, and history show initial states.
They contain no sample completed decisions and do not constitute gameplay or
verification evidence.

## Colors

The palette is warm, low-saturation olive charcoal with ivory reading text and
one amber emphasis family.

### Primary

- **Broadcast amber** (`amber`): Next Decision, the latest history number, and
  the Latest Outcome number. A selected action is not automatically successful.
- **Pale action ivory** (`light-action`): the secondary filled Start Continuous
  Mode button, visually distinct from manual admission.

### Neutral

- **Olive black** (`page`): page and editable input background.
- **Console charcoal** (`surface`): the shared console surface.
- **Warm ivory** (`ivory`): body text, prominent actions/headings, and selected
  probability detail.
- **Dark olive ink** (`ink`): text on the filled action buttons.
- **Muted stone** (`muted`): guidance, latency, evidence, and resting statuses.
- **Boundary olive** (`boundary`): outer header and control boundaries.
- **Quiet rule** (`rule`): internal dividers, stage outline, receipts, and panels.
- **Probability sage / dark track** (`probability`, `track`): native probability
  meters; the selected option uses ivory fill.

### Interaction

**Ice-blue focus** (`focus`) is reserved for keyboard outlines, links, caret, and
text selection. It is an interaction cue, not a second action hierarchy.
Disabled fields and buttons use explicit muted charcoal treatments. Busy/error
status text becomes ivory and heavier; neither gets an invented warning color.

**The Evidence Before Emphasis Rule.** Amber identifies the primary action and latest decision number; color alone never establishes completion, readiness, authentication, or game health.

## Typography

**Display Font:** locally hosted Oswald with Arial Narrow, Helvetica Neue, and
sans-serif fallbacks. The single Latin variable WOFF2 supports weights 200–700;
display roles use 400, 500, and 600. It loads with `font-display: swap` from
`app/src/assets/fonts/oswald-latin-wght.woff2`. No runtime font-provider request
is part of this system; retain the OFL notice and footer link.

**Body Font:** system-ui, sans-serif. **Receipt Font:** ui-monospace, monospace.

### Hierarchy

- **Identity:** the fluid display token belongs to Doom Decisions. AI Broadcast
  is a smaller uppercase, widely tracked companion label.
- **Game heading:** “Game view” uses the game-heading token and sentence case.
  It is intentionally more prominent than the small section labels.
- **Section labels:** small Oswald labels use uppercase and generous tracking.
  Do not carry that treatment into explanatory paragraphs.
- **Latest Outcome:** fluid display action text with a larger amber number
  (1.2em, weight 600). The empty state is smaller and muted.
- **History:** large tabular decision numbers (3rem, weight 600) pair with action
  names (1.875rem, weight 500); status and API latency stay in the body stack.
  History preserves API action identifiers; Latest Outcome humanizes underscores.
- **Reading:** the body token sets the root baseline. Help is generally smaller;
  rail guidance is denser (0.8125rem, line-height 1.45). Status remains readable
  (0.875rem, line-height 1.6).
- **Evidence:** technical text wraps in monospace. Tic, latency, probability, and
  decision counts use tabular numerals where styled.

**The Readable Evidence Rule.** Use the system body stack for instructions and operational detail, and monospace for technical receipts. Keep condensed display type for identity, headings, actions, and decision numbers.

## Layout

A centered page container (maximum 1360px, including padding) holds the identity
header, console, advanced evidence disclosure, and footer. The console follows
source order: persistent session/control rail, game view with Latest Outcome,
then AI Decision History. Persistent means the controls remain present after
preparation; there is no sticky/fixed positioning in the current CSS.

At viewport widths of at least 1280px, the console has three columns: a 17rem
rail, flexible game area, and 20rem history panel. Thin vertical rules separate
them. These are current composition measurements, not minimum widths for every
future surface. The flexible middle can show a smaller canvas even on desktop.

Below that breakpoint, the console stacks in source order. Between 760px and
1279px, WAD/key setup and manual/continuous controls each use two columns within
the rail. Below 760px those groups stack. At 639px and below, outer gutters and
game padding tighten to 1rem and the AI Broadcast label loses its left divider.
Do not infer mobile drawer or navigation behavior.

The Game view heading, stage, and outcome align within a 640px maximum width.
The canvas keeps **640×400 backing pixels and a 640×400 CSS display ceiling**:
`width: 640px; max-width: 100%; height: auto; aspect-ratio: 8 / 5`.
It shrinks proportionally when space is limited. Retain the entire framebuffer,
including the **full HUD**, with `image-rendering: pixelated`; no crop, stretch,
enlargement, or smoothed resampling is part of the design.

Latest Outcome uses an inline-size container query. At a container content width
of at least 34rem, outcome and operational status sit in 3:2 columns with a
vertical divider; otherwise they stack with a horizontal divider. This is not a
viewport breakpoint.

History keeps all entries in a bounded scrolling region. Its panel is capped at
`min(42rem, 75dvh)`, with that explicit height on wide layouts. The focusable list
scrolls vertically, contains overscroll, and reserves a stable scrollbar gutter.
A viewport limit must not become an entry limit.

Repeated small gaps, roughly one-rem content spacing, and slightly larger panel
padding form the rhythm captured in frontmatter. Preserve hierarchy and
readability instead of applying every recorded measurement to every component.

## Elevation & Depth

Surfaces are flat: the stylesheet defines no box shadows, gradients, or animated
transitions. Thin rules, a slightly different outcome surface, expanded-history
tonal fill, and a stronger selected-probability fill provide depth. The stage's
one-pixel outline bounds a black framebuffer. Color changes and disclosure
chevron rotation reflect interaction immediately; do not infer animation tokens.

**The Rules Before Shadows Rule.** Separate resting surfaces with thin borders, spacing, and tonal changes. Preserve the implemented flat treatment.

## Shapes

Panels and the stage are rectangular. Controls have nearly square corners via
the control radius token. Borders are generally one pixel; the keyboard outline
is deliberately stronger. The tiny Selected tag and meter rounding are local
details (3px), not a universal pill or card language. Native disclosure markers
are retained for guidance and receipts; history summaries use a CSS chevron.

## Components

### Session rail and inputs

WAD selection and temporary API-key entry stay present alongside decision
controls. Setup initially reads “Set up Doom”; verified preparation changes it
to “Setup & key” and reports the selected filename as prepared. There is no
invented “Loaded” light. WAD selection prepares automatically; refreshing is the
way to change a prepared WAD.

Use native labeled file, password, and number inputs with visible borders and
dark fill. Inputs have at least 44px height. The file-selector button has its own
compact treatment. Enabled hover brightens boundaries; disabled fields get a
muted fill. Keep the password field's autocomplete, spellcheck, and capitalization
settings, key-handling disclosure, and honest client-memory/authentication text.

Tics per decision defaults to 6 and applies to both modes; it accepts positive
JavaScript safe integers. Max API attempts defaults to 2, is a separate positive
safe integer, and freezes per continuous run. Tics changes during a run affect
later decisions. The budget includes failed/canceled SDK attempts, has no cap of
20, and is not a successful-decision counter.

### Buttons

Next Decision is the dominant amber action (minimum 56px height, 1.5rem Oswald).
Start Continuous Mode is pale ivory; Stop is outlined with transparent fill
(both minimum 50px, 1.25rem Oswald). All three fill their available control width.

Retain the implemented hover and pressed fills and explicit disabled treatment.
Next Decision exposes `aria-busy` and a wait cursor while busy. Control enablement
comes from controller readiness, active continuous ownership, Stop state, and API
cleanup; visual styling must not bypass these conditions.

Stop closes admission and waits for SDK cleanup or current-action/resulting-frame
verification. It is not instantaneous cancellation. Before dispatch, unchanged
native state must be proved; after dispatch, verification finishes before manual
readiness can return. SDK helpers and the underlying reader must both settle;
an unsettled reader keeps admission locked.

### Latest Outcome

A bordered, slightly raised-in-tone panel sits below the canvas. Its left feature
contains the latest admitted decision number, human-readable action, and evidence.
Its neighboring status region retains the controller's operational guidance and
continuous-run counters. With no AI decisions, it says “No AI decisions yet.”
Preparation's neutral tic is not an AI decision.

This presentation reads controller evidence; it does not independently run native
verification or grant readiness. A healthy completed-tic claim requires a complete
nonterminal action, full selected-tic accounting, consistent cumulative and
assessment tics, and a valid matching native/Canvas result hash. “Current frame
verified” additionally requires linkage to the displayed frame; a verified
terminal-prefix result can also carry that frame label. Verified results that are
not displayed are explicitly labeled; a missing displayed frame is also
distinguished. Incomplete evidence never becomes a completed-tic claim.

Pending choice, unchanged-state checking, stepping, rendering, and stopping remain
truthful stages. A verified terminal prefix reports death and/or “E1M1 exit
pending”, verified versus selected tics, frame availability, and reload guidance.
Exit pending does not prove intermission or E1M2. Uncertain native completion
retains a lower-bound verified count and requires reload; never replay it as if
nothing ran.

### Complete decision history

Every admitted decision retains a stable native disclosure row, newest first.
Rows show number, action or pending/unavailable text, status, and real API latency
or its pending/unavailable state. Only the newest number is amber. Existing
disclosure and focus-bearing nodes survive presentation updates.

Expanded rows show action probabilities only when all seven action values have
validated finite probabilities in range. Values sort descending, with native
meters and explicit percentages; the selected action has a textual Selected tag,
stronger fill, and ivory meter. Missing metrics say “Action probabilities
unavailable.” API confidence appears only when validated and does not establish
native success.

A nested Technical receipt preserves human-selected duration, requested/reported/
independently verified counts, cumulative verified tic (or uncertain lower bound),
observed/resulting tics, and sanitized request ID/latency. Complete history is
neither a rolling subset nor a set of illustrative sample results.

### Disclosures, evidence, and focus

Key handling, limits/stopping, history rows, technical receipts, and advanced
evidence use native `details`/`summary`. Guidance summaries have a minimum 44px
height and a subtle hover surface. Advanced evidence remains below the console,
with SDK status, frame identity/hash, and wrapped evidence text. Keep all evidence
accessible even when collapsed.

Visible focus uses an ice-blue 3px outline with 3px offset on focusable elements,
including the scrollable history list. Links use the focus color with underline
offset. Preserve field labels, described-by guidance, the canvas's accessible
name, and polite live regions for game and continuous status. These are observed
source affordances, not an accessibility certification.

## Do's and Don'ts

### Do:

- Do retain “Game view” and the complete 640×400 framebuffer, full HUD, 8:5 proportions, 640×400 CSS display ceiling, and pixelated rendering.
- Do keep WAD/key inputs, human duration, manual admission, continuous Start/Stop, and the independent attempt budget available in the session rail.
- Do preserve every decision entry, newest first, with truthful status, optional validated metrics, technical receipts, and advanced evidence.
- Do distinguish requested, reported, and independently verified tics, verified prefixes, resulting frames, and the currently displayed frame.
- Do retain native disclosures, visible keyboard focus, meaningful labels, and readable body text when extending the interface.

### Don't:

- Don't promote the concept image's gameplay, fabricated decision results, loaded indicators, or ornamental effects into implemented features.
- Don't substitute “E1M1” for “Game view”, enlarge or crop the canvas, hide its HUD, smooth its pixels, or stretch its proportions.
- Don't replace pending, stopping, failed, unavailable, uncertain, or terminal evidence with a generic success or ready indicator.
- Don't truncate history, invent probability/confidence values, or imply that API confidence proves native execution.
- Don't add Prepare, Reset, or New Game controls, automatic starts or restarts, fake telemetry, credential persistence, or production security claims.

