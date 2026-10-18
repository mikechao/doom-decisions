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
  history-number:
    fontFamily: 'Oswald, "Arial Narrow", "Helvetica Neue", sans-serif'
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  history-action:
    fontFamily: 'Oswald, "Arial Narrow", "Helvetica Neue", sans-serif'
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.015em"
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
  button-signin:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.625rem 0.75rem"
    width: "100%"
  asset-picker:
    backgroundColor: "#1d211b"
    textColor: "{colors.ivory}"
    rounded: "0px"
    padding: "0.5rem 0.75rem"
    width: "100%"
  prompt-dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.control}"
    padding: "clamp(1rem, 4vw, 2rem)"
    width: "min(44rem, calc(100% - 2rem))"
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

This documentation scan was refreshed from the implemented interface on
2026-10-17, preserving the established AI Broadcast language. The repository root
was `/Users/mike/projects/doom-decisions-ui-tweaks`, HEAD
`fe3355692abf2e36dacc4a8af1952845a4dfd664`
(`style: finalize UI polish and remove preview data`). The working tree was
clean before the documentation refresh.

Visual authority is [app/index.html](app/index.html) and
[app/src/style.css](app/src/style.css). Presentation behavior is read from
[decision-history.ts](app/src/decision-history.ts),
[latest-outcome.ts](app/src/latest-outcome.ts), and the display/render paths in
[main.ts](app/src/main.ts), with scroll-cue behavior in
[history-scroll.ts](app/src/history-scroll.ts) and optional metric validation in
[decision.ts](app/src/decision.ts). [PRODUCT.md](PRODUCT.md) and
[AGENTS.md](AGENTS.md) supply durable product constraints.

The committed [ui-experiment.png](ui-experiment.png) was visually inspected for
the original AI Broadcast intent. It is an illustrative concept, not a runtime
capture. Its gameplay, sample completed decisions, “Loaded” indicator, oversized
image, “E1M1” heading, and ornamental surface effects are not implementation
evidence. The current explanatory header, compact history rows, setup choices,
and full-width layout take precedence over that concept. No current runtime
screenshot or visual-regression golden was found in the inspected app sources.

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
The prompt preview shows only its surface and explanatory copy, without invented
request instructions. Sign-in and asset-choice previews have no handlers.
They contain no sample completed decisions and do not constitute gameplay or
verification evidence.

## Colors

The palette is warm, low-saturation olive charcoal with ivory reading text and
one amber emphasis family.

### Primary

- **Broadcast amber** (`amber`): OpenRouter sign-in, Next Decision, the Decision
  controls heading and prerequisite icon, the local-file folder icon, the latest
  history number, and the Latest Outcome number. A selected action is not
  automatically successful.
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
Disabled fields and buttons use explicit muted charcoal treatments; decision
buttons in the current prerequisite treatment use the console surface, muted
text, and boundary-colored borders. Busy/error status text becomes ivory and
heavier; neither gets an invented warning color.

**The Evidence Before Emphasis Rule.** Amber identifies primary actions, setup guidance, and the latest decision number; color alone never establishes completion, readiness, authentication, or game health.

## Typography

**Display Font:** locally hosted Oswald with Arial Narrow, Helvetica Neue, and
sans-serif fallbacks. The single Latin variable WOFF2 supports weights 200–700;
display roles use 400, 500, and 600. It loads with `font-display: swap` from
`app/src/assets/fonts/oswald-latin-wght.woff2`. No runtime font-provider request
is part of this system; retain the OFL notice and footer link.

**Body Font:** system-ui, sans-serif. **Receipt Font:** ui-monospace, monospace.

### Hierarchy

- **Identity:** the fluid display token belongs to Doom Decisions. Its companion
  is a sentence-case system-font explanation, capped at 65ch. AI Broadcast is the
  design's name, not the current visible header label.
- **Game heading:** “Game view” uses the game-heading token and sentence case.
  It is intentionally more prominent than the small section labels.
- **Section labels:** small Oswald labels use uppercase and generous tracking.
  Do not carry that treatment into explanatory paragraphs.
- **Latest Outcome:** fluid display action text with a larger amber number
  (1.2em, weight 600). The empty state is smaller and muted.
- **History:** compact tabular decision numbers use the history-number token,
  paired with the history-action token; status, API latency, and token totals
  stay in the body stack.
  History preserves API action identifiers; Latest Outcome humanizes underscores.
- **Reading:** the body token sets the root baseline. Help is generally smaller;
  rail guidance is denser (0.8125rem, line-height 1.45). Status remains readable
  (0.875rem, line-height 1.6).
- **Evidence:** technical text wraps in monospace. Tic, latency, probability, and
  decision counts use tabular numerals where styled.

**The Readable Evidence Rule.** Use the system body stack for instructions and operational detail, and monospace for technical receipts. Keep condensed display type for identity, headings, actions, and decision numbers.

## Layout

A full-width page container with no maximum width holds the identity header,
console, advanced evidence disclosure, and footer. The console follows
source order: persistent session/control rail, game view with Latest Outcome,
then AI Decision History. Persistent means the controls remain present after
preparation; there is no sticky/fixed positioning in the current CSS.

At viewport widths of at least 1280px, outer gutters are 16px and the console has
three columns. The left rail uses
`minmax(calc(17rem + 10px), calc(50vw - 390px))`; the right history column uses
`minmax(calc(20rem + 10px), calc(50vw - 342px))`; the game occupies the remaining
`minmax(0, 1fr)` space. Thin vertical rules separate them. The outer columns absorb
extra width while the game retains its display ceiling. The rail spans two grid
rows; game and history occupy the first. These are current composition
measurements, not minimum widths for every future surface.

Below that breakpoint, the console stacks in source order. Between 760px and
1279px, WAD/key setup and manual/continuous controls each use two columns within
the rail. Below 760px those groups stack. Ordinary outer gutters are 1.5rem.
At 639px and below, outer gutters tighten to 1rem, game padding becomes 1rem
vertically and 0.5rem horizontally, and the explanatory header text loses its
left divider.
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

History keeps all entries in a bounded scrolling region. On stacked layouts its
panel is capped at `min(42rem, 75dvh)`. On wide layouts size containment lets the
game determine the shared row height; history stretches within that row, with
no independent maximum height and a 1.25rem bottom margin. The list and detail
view each scroll vertically, contain overscroll, and reserve stable scrollbar
gutters. A reserved footer shows “More decisions below” only when the list has
content below its current scroll position; hiding it preserves its space.
A viewport limit must not become an entry limit.

Repeated small gaps, roughly one-rem content spacing, and slightly larger panel
padding form the rhythm captured in frontmatter. Preserve hierarchy and
readability instead of applying every recorded measurement to every component.

## Elevation & Depth

Surfaces are flat: the stylesheet defines no box shadows, gradients, or animated
transitions. Thin rules, a slightly different outcome surface, history-row tonal
fill, and a stronger selected-probability fill provide depth. The stage's
one-pixel outline bounds a black framebuffer. Color changes, native disclosure
markers, and the history-row chevron indicate interaction without animation
tokens. The native prompt dialog uses a translucent black backdrop
(`rgb(0 0 0 / 60%)`) to separate the modal surface; it has no shadow.

**The Rules Before Shadows Rule.** Separate resting surfaces with thin borders, spacing, and tonal changes. Preserve the implemented flat treatment.

## Shapes

Panels and the stage are rectangular. Controls have nearly square corners via
the control radius token. Borders are generally one pixel; the keyboard outline
is deliberately stronger. The tiny Selected tag and meter rounding are local
details (3px), not a universal pill or card language. Native disclosure markers
are retained for guidance and receipts; history buttons use a right-facing CSS
chevron. The local-file affordance uses a small stroked folder SVG; OpenRouter
sign-in uses its inline monochrome logo.

## Components

### Session rail and inputs

Setup is an initially open native disclosure titled “Setup”. It groups account
connection, game-file choice, manual credentials, and privacy guidance. After
preparation and credential readiness, it collapses once when focus and pointer
activity have left setup. Users can reopen it. A prepared local filename appears
inside its picker; other selected-asset status remains below the controls.
Included Freedoom and local IWAD selection each prepare automatically after
explicit choice; refreshing is the way to change a prepared game file.

OpenRouter mode leads with a full-width amber sign-in button and inline logo
(22px square), a compact charge note, and native radio choices for GPT-6 Luna
Decisions and Jev 1.14. The model choices are not a provider menu. The model locks
for the session when committed, with explicit refresh guidance. Underlined muted
text buttons reveal manual API-key entry or return to sign-in. Busy sign-in says
“Connecting…” and uses a wait cursor; completion is explicit text.

The game-file group uses a full-width “Use included Freedoom” button and a
full-width neutral `<doom-button>` for “Choose local IWAD”, with the amber folder
icon immediately left of the label, centered together. During local preparation
it reads “Preparing NAME.WAD…”; after confirmed preparation it shows the filename
and remains disabled until refresh. Long filenames use visual ellipsis while
the full name and loaded/refresh context remain accessible. A hidden, named native
file input is activated synchronously by the trigger and adds no tab stop.
Compact guidance states the bundled download size and local-file behavior.
Neither choice starts on page load.

Use native labeled password and number inputs with visible borders and dark
fill, plus the native file input activated by its custom button. Visible
input controls and file affordances have at least 44px height. Enabled hover
brightens boundaries; disabled fields get a muted fill. Keep the password field's
autocomplete, spellcheck, and capitalization settings, privacy disclosure, and
honest client-memory/authentication text.
Manual entry is secondary in OpenRouter mode; experimental direct OpenAI has
provider-specific copy. Preserve the distinction between clearing local access
on refresh and remotely revoking a minted key.

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

### Complete decision history and detail view

Every admitted decision retains a stable button row, newest first. A compact
three-column grid places the number on the left, action/status/metrics in the
middle, and a small right-facing chevron at the edge. Rows show action or
pending/unavailable text, status, real API latency, and provider-reported total
tokens or explicit pending/unavailable text. Only the newest number is amber.
Focus-bearing nodes survive presentation updates. Hover and selected rows use
the same subtle olive fill.

Selecting a row replaces the list within the same panel with Decision detail.
Its header contains “Back to history” and a sentence-case Oswald title; the body
scrolls independently. Opening detail focuses the title. Returning restores the
originating row's focus and visual offset, including after newer decisions arrive.
This is an in-panel view, not an inline accordion or a modal.

Detail shows returned action probabilities only when all seven action values
have validated finite probabilities in range. Values sort descending, with
native meters and explicit percentages; tiny positive values retain scientific
notation rather than becoming zero. The selected action has a textual Selected
tag, stronger fill, and ivory meter. Missing metrics say “Action probabilities
unavailable.” API confidence appears separately and does not establish native
success or explain the model's reasoning.

Provider, requested model, differing reported model, API latency, and reported
total tokens appear in a compact two-column definition list. The historical
request screenshot is distinct from the currently displayed game frame; it
shrinks proportionally, retains pixelated rendering, and has explicit
pending/unavailable/error text. It is not a decorative placeholder image.

Native Exact request and Technical receipt and diagnostics disclosures preserve
captured instructions/context/actions, human-selected duration, requested/
reported/independently verified counts, cumulative verified tic (or uncertain
lower bound), observed/resulting tics, provider usage breakdown, and sanitized
request metadata. Long identifiers and preformatted request text wrap. Complete
history is neither a rolling subset nor a set of illustrative sample results.

### Decision prompt dialog

“View Prompt” is a full-width outlined body-font button below a thin rule in the
control rail. It opens a native modal dialog containing a sentence-case Oswald
heading, an autofocus Close button, concise explanatory text, and the default
instructions for the current tic selection. Invalid duration produces guidance.
This preview updates with duration edits and does not describe an already
captured in-flight request; Exact request in history supplies that evidence.

The dialog uses the prompt-dialog token, a one-pixel boundary, a viewport-limited
height (`calc(100dvh - 2rem)`), and vertical overflow. The page locks scrolling
while a modal dialog is open. Closing returns focus to View Prompt. Preserve the
native modal behavior and explicit close control.

### Disclosures, evidence, and focus

Privacy/key handling, limits/stopping, exact requests, technical receipts, and
advanced evidence use native `details`/`summary`. Guidance summaries have a
minimum 44px height and a subtle hover surface. Advanced evidence remains below the console,
with SDK status, frame identity/hash, and wrapped evidence text. Keep all evidence
accessible even when collapsed.

Visible focus uses an ice-blue 3px outline with 3px offset on focusable elements.
History rows, history/detail scrollers, and Back to history use an inward offset
(-3px) to keep the outline within their clipped regions. Links use the focus color
with underline offset. Preserve field labels, described-by guidance, the canvas's
accessible name, and polite live regions for game and continuous status. These
are observed source affordances, not an accessibility certification.

## Do's and Don'ts

### Do:

- Do retain “Game view” and the complete 640×400 framebuffer, full HUD, 8:5 proportions, 640×400 CSS display ceiling, and pixelated rendering.
- Do keep account connection, explicit included/local game-file choices, manual credentials, human duration, manual admission, continuous Start/Stop, and the independent attempt budget available in the session rail.
- Do preserve every decision entry, newest first, with truthful status, optional validated metrics, technical receipts, and advanced evidence.
- Do distinguish requested, reported, and independently verified tics, verified prefixes, resulting frames, and the currently displayed frame.
- Do retain native disclosures, visible keyboard focus, meaningful labels, and readable body text when extending the interface.
- Do preserve history list/detail navigation, focus and scroll restoration, and the distinction between prompt previews, captured requests, historical screenshots, and the current game frame.

### Don't:

- Don't promote the concept image's gameplay, fabricated decision results, loaded indicators, or ornamental effects into implemented features.
- Don't substitute “E1M1” for “Game view”, enlarge or crop the canvas, hide its HUD, smooth its pixels, or stretch its proportions.
- Don't replace pending, stopping, failed, unavailable, uncertain, or terminal evidence with a generic success or ready indicator.
- Don't truncate history, invent probability/confidence values, or imply that API confidence proves native execution.
- Don't add Prepare, Reset, or New Game controls, automatic starts or restarts, fake telemetry, credential persistence, or production security claims.

