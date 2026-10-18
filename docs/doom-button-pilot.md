# Static Doom buttons

All ten static action controls use `<doom-button>`. The original View Prompt
pilot remains part of this implementation. Dynamic `.decision-row` history
buttons, the IWAD label/input, and the GitHub link retain their native elements.

## Component contract

- `appearance="primary|secondary|outline|text|neutral"` selects styling; omission
  defaults to outline. No appearance property or form/navigation/toggle API.
- One native `<button type="button">` in an open, focus-delegating shadow root
  receives the default label slot and optional `slot="start"` decorative SVG.
  OpenRouter's SVG and dynamic label span retain their original IDs and content.
- `.disabled` is a synchronous reflected boolean. Attribute presence, including
  `disabled="false"`, disables the native button. `.click()` delegates to its native
  method; `.focus(options?)` forwards focus options unchanged. The host has no
  extra role or tabindex. There are no key handlers or redispatched clicks.
- `aria-busy`/`.ariaBusy` forwards busy state and selects the wait cursor. It is
  presentational only: neither busy nor clearing busy changes disabled or owns
  admission, Stop fencing, SDK cleanup, or credentials. There is no loading API.
- `autofocus`, `aria-haspopup`, `aria-expanded`, `aria-busy`, `aria-controls`, and
  `aria-describedby` synchronize on connection and attribute changes. Scalar
  values go to the actual native button. Host `hidden` hides the whole component.
- Registration is idempotent and runs before controller property assignments.
  Assigning custom properties before upgrade is outside the app's supported order.

## Accessibility and focus boundaries

The host's `ariaControlsElements` and `ariaDescribedByElements` getters resolve
light-DOM IDs; the component assigns their element references to the native
button. It never copies external IDREF strings into the shadow root. This follows
the [HTML reflection rules](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflecting-content-attributes-in-idl-attributes).
Both native properties are required; missing support rejects registration and
stops app startup, with no fallback. The static targets are parsed before module
startup. Replacing a target node without changing the referring attribute is not
supported. Updating the existing status node's text preserves its reference.

Inspect inner relationship properties and the accessibility tree; property
assignment can leave an empty IDREF attribute on the inner button. Do not infer
accessible parity from DOM readback or synthetic tests alone.

Close keeps `autofocus` on the host and forwards it to the inner native button.
The existing native dialog opening/closing and focus-return handlers are retained.
Outside the shadow tree, `document.activeElement` identifies the focused host;
`host.shadowRoot.activeElement` identifies the inner native button. Dialog
autofocus, keyboard defaults, focus order, and screen-reader behavior require
Chrome verification. History-row identity, selection, scroll restoration, and
native focus restoration are unchanged; only Back to history becomes a component.

## Styles and maintenance cost

`doom-button.css` owns shared base, five appearances, hover/pressed, effective
disabled palette, busy cursor, native focus ring, and decorative icon sizing.
It is linked as same-origin external CSS through Vite `?url&no-inline`. Production
CSP, dependency versions, lockfile, and bundler configuration are unchanged.
Production asset emission/CSP behavior and potential initial unstyled paint remain
unverified. The shadow stylesheet's single, documented `!important` suppresses an
extra host outline from the document's global focus rule.

Application CSS keeps width, typography, placement, and three geometry variables:
`--doom-button-padding`, `--doom-button-min-height`, and
`--doom-button-focus-offset`. No per-ID button color/state recipes remain.
The `button-signin` modifier preserves sign-in's pale hover/amber pressed borders,
distinct from Next's brighter hover/darker pressed fill. `button-history` preserves
Back to history's absence of a separate pressed fill; its focus offset stays inset.

One disabled palette replaces sign-in/control duplication and the overridden
decision palette. Text buttons retain transparent disabled styling. Newly
reachable disabled prompt/navigation states use the same muted palette; their
normal app flow does not disable them. Freedoom deliberately gains a neutral
olive fill/border and explicit disabled appearance instead of browser defaults.

The migration centralizes styling ownership but adds reference-property forwarding,
focus/autofocus delegation, shadow CSS loading and related tests. Shared CSS classes
could consolidate the same recipes with less compatibility code. The component's
benefit is a uniform typed boundary; it has not yet earned an unconditional runtime
acceptance or a claim of lower total maintenance cost.

## Evidence and remaining owner checks

The original pilot passed `npm --prefix app run check`: 217 tests in 24 files,
three TypeScript configurations, static Worker packaging and Biome checks. The
owner reports View Prompt visual/interaction parity. Those observations apply
to the pilot, not to this expanded migration or production CSP/accessibility.

For this migration, source/diff inspection and whitespace checks passed. After
fresh owner authorization, `npm --prefix app run check` passed all three TypeScript
configurations, static Worker packaging, 225 tests across 25 files, and Biome.
The first run failed one new test because Vitest stubs CSS imports to an empty
string. That test now uses an explicit URL fixture to check link wiring; the
second full check passed. Node emitted its experimental `stripTypeScriptTypes`
warning. No additional installation or dependency changes were needed.

Component tests use fake DOM/native boundaries and check registration, slots,
reference forwarding, reflection, busy independence, method delegation, single
delivered activation and markup/type contracts. Mock presentation/inspector tests
retain controller wiring coverage. None establish real browser propagation,
rendering, keyboard, production asset emission/CSP, or accessibility. No browser,
development server, production build, game assets, gameplay, authenticated or
billable API calls were run. Synthetic servers/Worker-entry fixtures are part of
the authorized offline suite, not native Doom/WASM runtime evidence.

Owner browser checklist (after separately authorized build/serving; Codex does not
launch Chrome):

1. Check all ten controls at desktop and narrow widths: resting, hover, focus,
   pressed, disabled and busy states; spacing, Oswald sizes, text alignment, one
   tab stop/focus ring, and no flash or clipping. Compare sign-in versus Next's
   distinct amber recipes. Preview unavailable states in an isolated inert UI;
   do not force-enable live admission controls.
2. Confirm the official OpenRouter icon and dynamic Connecting/complete label,
   disabled/wait states, manual-key reveal, `aria-expanded`, hidden toggling and
   focus destinations. Real sign-in and authenticated calls require separate
   authorization; synthetic state presentation alone is not OAuth evidence.
3. Check Freedoom's enabled/disabled neutral appearance. Actual selection fetches
   the asset and prepares WASM, requiring separate asset/runtime authorization.
4. Check Next/Start/Stop readiness and disabled behavior without credentials or
   API calls. Exercise enabled/busy/Stop presentation in an inert fixture or the
   authorized offline mocks. Live gameplay and billable requests are separate.
5. Open View Prompt by mouse, Enter, Space and `.click()`. Confirm Close's inner
   button autofocus. Close by button, Enter/Space, Escape and native dismissal;
   confirm return to View Prompt's inner button, with exactly one activation.
6. With separately authorized real history or synthetic inert history, check Back
   to history and restored focus/scroll on the originating native history row.
7. Inspect actual inner buttons in Chrome's accessibility tree: names, button
   roles, disabled/busy/expanded states, popup type, control and description
   relationships. Check dialog, manual-key controls, Stop note, auth note/status,
   Freedoom asset note, and history target. Verify property readback as well.
8. Under strict production CSP, inspect same-origin CSS requests and Console:
   no inline/data styles, violations, missing styles or duplicate focus outlines.
   A development-server observation does not establish production CSP compatibility.

Keep changes uncommitted until the owner decides whether these results justify
the component's compatibility cost. No browser, build, game or API proof is implied.
