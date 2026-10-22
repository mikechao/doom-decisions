# Doom Decisions app guide

The owner-accepted **v0.2.0 Continuous Mode MVP** uses vanilla DOM APIs with
TypeScript **7.0.2**, Vite **8.3.4**, plain CSS, and official
**@openrouter/sdk 1.4.25** by default, with **openai 7.32.0** for the explicit
experimental direct OpenAI alternative. The HTML entry loads `src/main.ts`;
TypeScript checks types without emitting JavaScript, and Vite owns bundling.
In ordinary modes the app prepares real E1M1 on explicit included-Freedoom or local
IWAD selection and verifies exactly one mandatory neutral first tic. Each
**Next Decision** click then makes at most one official SDK Decisions request using
the current rendered image, executes
one allowlisted action on the same Worker, and returns to idle. **Start Continuous
Mode** explicitly authorizes sequential decisions through that same pipeline,
until Stop, budget exhaustion, a terminal boundary, or a failure.
The human owns duration: **Tics per decision** accepts any **positive JavaScript
safe integer**, initially **6**. **35 tics = 1 Doom second**: N/35 is simulated
Doom time, not API or browser wall time. Very large batches may exhaust memory,
trip the existing 2-second Worker watchdog or native counter guards, and require
reload; acceptance does not guarantee completion. The captured duration cannot
change during a pending decision. The model selects only `neutral`, `forward`,
`turn_right`, `backward`, `turn_left`, `fire`, or `use`; it never selects duration
or combined actions.

## Local IWAD support

Select a user-provided **Local Doom IWAD**, between **12 and 33,554,432 bytes
(32 MiB), inclusive**. The browser checks size before reading; the Worker checks
the received size independently before WASM compilation. Both hash the actual
bytes and require matching digests for that preparation, without a fixed WAD
size/hash identity allowlist. WASM size/hash/interface verification is unchanged.

Compatibility is **best-effort**: native IWAD/header/directory/resource checks and
controlled Doom E1M1 preparation must succeed, including the single neutral tic,
frame/Canvas verification and passive/idle proofs. Freedoom **0.13.0 Phase 1** and
the owner's local Doom shareware **DOOM1.WAD** have worked in owner-run trials.
This does not promise support for Doom II, PWADs, mods or every IWAD variant.
**Use included Freedoom** downloads the pinned official Phase 1 v0.13.0 gzip file
only when clicked (10,304,935 bytes, about 9.83 MiB). The browser uses native
`DecompressionStream('gzip')`, verifies compressed and original byte identities,
and passes the original 28,795,076-byte WAD through the same preparation interface.
No WAD download, Worker or game preparation starts on page load. Unsupported
decompression, fetch, or asset identity failures allow another explicit included
choice or local selection; failed WASM verification or Worker/native work requires
reload. Existing retirement clears in-memory credentials even on retryable asset
failure; sign-in after admission requires refresh, or use BYOK after preparation.
Local files stay in the browser and are never staged or uploaded.

The reviewed source is `third_party/freedoom/0.13.0/freedoom1.wad.gz`; the
[provenance record](../third_party/freedoom/0.13.0/PROVENANCE.md) records the pinned
archive, WAD, gzip, compression command and distribution notices. Only this gzip
may ship, with complete BSD 3-Clause license, credits and music credits under
`notices/freedoom/`. Raw WADs and alternate/duplicate compressed WADs are rejected.
Normal builds never acquire or recompress game assets. The engine still embeds
no IWAD; the existing local-file admission has no fixed identity allowlist.

Serve `.wad.gz` as a gzip **file**, not by labeling those stored bytes with
`Content-Encoding: gzip`. Fetch performs HTTP decoding before the adapter sees
bytes; the adapter requires the pinned compressed bytes before decompressing
once. Incorrect transparent decoding fails safely. Vite's dev/preview header hook
serves only this asset as `application/gzip` with `Content-Encoding: identity`,
overriding Vite's default `.gz` HTTP decoding behavior. It adds no production
middleware or CSP allowances. Verify response headers and
delivered bytes in local preview and the actual deployed host. The 10,304,935-byte
asset is below the 25 MiB (26,214,400-byte) Cloudflare individual-file limit;
compression/build checks do not prove browser or deployed configuration behavior.

Native lump consumers still have unchecked malformed-input paths. Worker isolation,
retirement and the existing two-second request watchdog provide best-effort failure
containment, not a memory-safety guarantee for arbitrary/untrusted files. Browser
fetch/read/hash work before Worker creation has no application deadline. Parser
hardening and an end-to-end preparation deadline are outside this prototype change.

## Continuous mode

**Max API attempts** defaults to **2** and accepts any positive JavaScript safe
integer (up to 9,007,199,254,740,991), including 100, 500, or 1000. This is separate
from the **tics per decision** duration. Start validates and freezes the budget
for that run; neither the budget nor credentials are persisted. One unit is charged
immediately before each `decisions.create` invocation, including failed, refused, invalid,
timed-out, or canceled calls. Pre-request failures and preparation's neutral tic
consume no units. There are no refunds, automatic retries, or automatic restarts.
The status shows attempts used/limit, stop reason, and cumulative verified tics.
Another explicit Start is required after exhaustion.

Each iteration captures N separately at admission. You can edit N during a
continuous wait; this affects only later decisions. Ordinary successes preserve
the Worker/game and observe the preceding verified resulting frame. Only a fully
verified action and resulting frame permit another iteration. Manual Next Decision
is locked while a continuous run owns admission or cleanup.

**Stop** before native dispatch closes future admission, best-effort aborts the
SDK operation, ignores late choices, and proves unchanged native state before
returning to manual readiness. An underlying SDK response/read must settle before
any new request is admitted, even if Abort is ignored. A never-settling read leaves
controls locked with a waiting status; Abort does not prove remote processing or
billing stopped. Stop after native dispatch says **Stopping after current decision**
and finishes receipt and resulting-frame verification. It cannot interrupt or roll
back a synchronous native tic/batch. A healthy verified result preserves manual
play; unsupported state, uncertain completion, or unverifiable frames retire the
session and require reload.

Verified death or **E1M1 exit pending** stops at its independently verified prefix
(`N/k/k`) and retires after the terminal frame is verified. Exit pending is not
completed intermission or permission to advance to E1M2. A verified terminal
boundary with an unavailable resulting frame is reported separately; the prior
frame is not terminal imagery. Prototype acceptance includes owner-observed death
detection, but independently instrumented browser/WASM terminal evidence remains
uncollected, including exit-pending and early-prefix proof. Synthetic tests do not
establish that runtime evidence; see [prototype evidence](#prototype-acceptance-and-evidence).

## Decision history inspector

Choose a history row to open its detail in the same rail. **Back to history**
stays above the scrolling detail and restores focus and approximate row position.
Rows include provider-reported total tokens; totals are never calculated from
input/output counts. The image, instructions, context and ordered permitted
actions come from that decision's immutable request, not the current Canvas or tic setting.
Request preparation and SDK invocation are shown separately. Pending, failed,
canceled and terminal entries remain inspectable with unavailable fields labeled.
The requested provider/model is recorded during encoding; a provider-reported
model is shown separately. Only validated action probabilities/confidence and
reported nonnegative safe-integer token counts are displayed. Missing counts
are **Unavailable**, including total tokens for OpenRouter and direct Jev;
**Pending** is reserved for an in-progress SDK request without response data.
The app does not calculate a total or estimate usage. A real reported zero stays zero.

The light-DOM `<decision-history>` element owns the list/detail views and list
scroll cue. Opening a row focuses its detail heading; new entries do not change
the inspected decision. Probabilities and execution evidence precede model/usage
and historical input. Exact request text and technical receipts start collapsed.
Inspection does not pause continuous play or block access to Stop. It never
captures another frame, starts a request or advances Doom.

Requests live only in the current Run's memory, outside Advanced evidence JSON.
Refresh clears them. History is unbounded for this prototype: base64 adds roughly
one third to compressed PNG size before JavaScript string overhead, and a decoded
640×400 RGBA image needs about 0.98 MiB. Only the selected image is assigned to an
`img`, its source is removed on return to history, and no historical RGBA arrays
are retained.
Snapshots share frozen references across presentation updates. Long sessions can
therefore consume substantial memory; real-game PNG sizes have not been measured
for this change. The CSP permits `data:` images only, with other directives unchanged.

### AI Agent development startup

For agent play, first create **this worktree's** gitignored `app/.env.agent.local` yourself:

```dotenv
AGENT_OPENROUTER_API_KEY=your-local-openrouter-key
AGENT_MODEL=jev
AGENT_DECISION_BUDGET=3
```

With frontend dependencies and verified staged engine/game assets already available
in this worktree, run from its repository root:

```sh
npm --prefix app run dev:agent
```

Equivalently, run `npm run dev:agent` from `app/`. Open `http://127.0.0.1:5174/`
manually. After normal initialization, this mode selects included Freedoom once,
using the same path as **Use included Freedoom**. No setup clicks or API key are
required. Wait for **Ready at tic 1 — neutral 1/1/1; passive checks unchanged.**
The existing frame/Canvas hash checks and five-second idle proof remain mandatory;
Advanced evidence stays available. Failures use the existing error/retry controls,
with no automatic retry loop. Refresh starts one fresh preparation.

Agent mode defaults to `jev` (`typesafe/jev-1.14` via OpenRouter) when the file or
`AGENT_MODEL` is missing, or the value is blank. Set `AGENT_MODEL=gpt6` for
`openai/gpt-6-luna-decisions`. Other nonempty values block agent startup with a
configuration error. This is separate from the direct `--mode jev` proxy.
The setting is read only from this file in agent mode; there is no command-line
override. Ordinary dev and production keep the GPT-6 Luna Decisions default.
The model can still be changed with the existing UI radios before the first
provider client is created for inference; creation locks it for the session.

Fully stop and launch a new dev-server process after changing the file. Missing, empty, unreadable, or
unusable keys leave inference unavailable while the game still prepares. A usable
key is held in page memory for a later **human-initiated** Next Decision, Continuous Mode,
or a configured agent run claimed through `start-run`;
startup neither constructs a provider client nor requests inference. Manual keys
and OAuth keys take precedence. Model access/authentication remain unverified.
The optional key applies only to the OpenRouter provider.

`AGENT_DECISION_BUDGET` is a positive JavaScript safe integer: start with **3**
for a small trial; larger finite limits are supported. It caps agent Decisions API
attempts, **not dollars or gameplay tics**. Missing/blank disables agent starting;
malformed or unsafe values fail startup with a nonsecret configuration error.
No paid budget is inferred. The broker snapshots this value once per actual Node
process and issues it at most once, bound to the current lease/session/checkpoint.
Failed or ambiguously delivered claims are not refunded. Exhaustion, Stop,
disconnect, refresh, extra tabs and Vite internal restart cannot replenish it.
A separate run requires the human to fully stop and launch a new `dev:agent`
process. This local prototype does not defend against deliberate code changes or
process restarts and does not cap separate Manual/Continuous spending.

This is browser-direct BYOK: the key is visible in the locally served bootstrap
JavaScript, browser/devtools and potentially development caches. Agent responses
use `Cache-Control: no-store`. The key is not secret
from the local browser. It is not put into DOM fields, browser storage, history or
receipts. Page retirement clears the pending key; refresh deliberately reloads it
from local configuration. Never capture/share the bootstrap response or devtools
with a real key. Do not use `VITE_*` variables for credentials.

Agent mode binds only to `127.0.0.1` and rejects agent-mode builds and preview.
Ordinary dev, preview and production use an inert bootstrap and do not read the private file
through this credential loader or auto-select a game. Standard OAuth/manual BYOK
behavior and production CSP stay unchanged.

#### Agent control: one-command bounded play and Stop

Agent mode uses strict port **5174** and the existing same-origin, in-memory
bridge. An occupied port fails. Close extra agent tabs. No extra server, browser
automation, provider proxy, or dependency is involved. Only `dev:agent` registers
a verified ready page; ordinary dev/production have no agent command routes.

In a second terminal, from the repository root:

```sh
node scripts/doom-agent.mjs attach
# Copy the absolute leaseFile from that JSON:
node scripts/doom-agent.mjs observe --lease /absolute/path/to/lease.json
```

Actually open the returned `pngPath`. Observation takes fresh passive snapshots,
renders, verifies native/Canvas RGBA hashes, hashes PNG bytes, and proves unchanged
native state around capture. It consumes zero gameplay tics and never constructs a
provider. Its `observationId` binds the controller's latest observation, game
session/tic, lease epoch, effective model, human and agent settings, revision and tics.
Observation payloads contain no prompt text or credentials; dedicated prompt commands
return only effective agent instructions/settings and nonsecret control state. Another observation supersedes the
previous identity. A manual decision or saved configuration change invalidates it.
`phase: ready` describes the capture boundary, not guaranteed future readiness.

Agent observations expose all five eligible Game State signals independently of
Decisions inclusion settings. Normal requests use human saved settings;
agent requests use the attached lease's ephemeral configuration described below.
Both use the existing Decisions request formatter and eligibility rules.

- `telemetry.readyWeapon` is the normalized nullable `{id, name, ammoType}`;
  `telemetry.ammo` is nullable inventory with `bullets`, `shells`, `cells`, and
  `rockets`, each `{current, max}`. Zero quantities/capacities are preserved;
  values are not clamped or converted to percentages. Ammo type is sampled
  independently of weapon name (`none`/`unknown` remain valid). Legacy weapon ID
  and current-count scalars remain alongside these structures.
- `telemetry.health` retains native numeric player health and existing
  ready/terminal eligibility. XY remains native fixed-point and angle raw bits.
- `facingProbe` is `{tic, kind, door, distance}` qualified for the verified frame.
  Unavailable/unknown kind 0, ineligible and terminal evidence exports as `null`.
  Kind 1 is a valid **no relevant line** sample (`door: 0, distance: -1`),
  distinct from unavailable. Kinds 2–5 mean solid line, opening/clearance
  restriction, recognized manual-door boundary, and other special line of unknown
  physical meaning. Door values 0/1/2 mean no recognized manual-door metadata,
  recognized metadata with unknown usability, and a front-side manual-door use
  candidate. Distances for kinds 2–5 are approximate integer Doom units, 0–64.
  This forward center ray within 64 units cannot prove player-radius clearance,
  traversability, keys, door activity or successful use. See the
  [native enum contract](../docs/issue-18-facing-probe.md).
- `previousAction` adds the existing outcome `text` to `{action, tics, endTic}`.
  Receipt-derived text retains signed displacement/intermediate/stationary
  meaning without rederivation. Matching resulting frame/tic/XY eligibility is
  mandatory; initial, ineligible and terminal outcomes are `null`. Neither the
  text nor XY endpoints prove collision, hits, door activation or why movement
  did not occur.

These fields come from the existing verified capture, with no additional Worker
operations or gameplay tics. Payloads are deeply detached; the shared broker/CLI
parser requires exact keys at every object boundary. The CLI carries all evidence
unchanged, replacing PNG data only with a verified local file path.

**Attach, observe and get-config never authorize charges.** After viewing the
verified PNG, read configuration and claim the process allowance exactly once:

```sh
node scripts/doom-agent.mjs get-config --lease /absolute/path/to/lease.json --session SESSION_ID
node scripts/doom-agent.mjs start-run --lease /absolute/path/to/lease.json --observation OBSERVATION_ID --session SESSION_ID --revision REVISION
```

Use the actual IDs/revision from the fresh observation and configuration. The CLI
cannot choose the numeric limit. A successful start returns the effective
configuration, revision and active run with its frozen limit and counters. There
are no browser Allow controls or follow-up chat acknowledgment. The skill then
observes/views afresh, optionally updates its navigation instructions, and requests
one Decisions-selected legal action at a time:

```sh
node scripts/doom-agent.mjs decide --lease /absolute/path/to/lease.json --observation OBSERVATION_ID --session SESSION_ID --run RUN_ID --revision REVISION
```

Never retry `start-run`, including after a rejected or ambiguous claim.
`budget-unavailable` requires explicit configuration and a full process restart;
`budget-closed` means no new claim is available; `claim-failed` ends play
conservatively. Other preflight errors also burn an already-issued claim. Browser
reload and Vite internal restart cannot rearm it. Normal gameplay operations cannot
change the cap. Ordinary manual controls retain their credential/readiness gates.

The CLI returns a structured `outcome`: `completed`, `stopped` (before native
dispatch), `terminal`, `retired`, `api-failure`, or `not-admitted` with a fixed
reason. It includes the preceding observation ID, whether SDK create started,
selected action, requested/reported/independently verified tics, cumulative tic,
uncertainty flag, and sanitized provider/model/usage when available. Completed
and terminal results include a newly verified observation plus an absolute
`pngPath`; open it and compare with the preceding scene. A completed result
already includes the just-verified action in `observation.previousAction`
(action, tics and ending tic), consistent with a later passive observation. Terminal output reports
the verified prefix and retained terminal frame before retirement; exit pending
does not prove intermission. Other outcomes carry no speculative/stale PNG.
Temp lease/PNG files contain no provider key; delete their printed temp directory
when finished. PNG bytes stay out of stdout.

The observation ID is also the CLI decision command ID. The broker reserves it
before delivery and rejects duplicates, even after errors. **Never retry a paid
command after timeout/lost output.** Transport failures can mean unknown execution;
a consumed action cannot safely be replayed. There is no result-recovery/job API
in this slice. The bridge revokes disconnected/timed-out leases (30-second result
window for decisions; 10 seconds for observations), and the browser immediately
fences further agent work when notified. A completed result accepted before
revocation stays completed; cross-process notifications have no absolute ordering
guarantee.

**Stop Agent** stays separate from Continuous Stop. It synchronously revokes the
browser lease and calls controller Agent Stop before closing streams, aborting
uploads or notifying the broker. The controller checks the agent owner/Stop fence
at `beforeCreate` and immediately before native dispatch. Pending SDK readers,
including readers that outlive SDK helper cancellation, must settle and pass the
existing unchanged-state proof before manual readiness returns. Work already
dispatched finishes action receipts, rendering and PNG proof. Uncertain native
outcomes or unverifiable frames retire the session. Stop never claims to undo an
action or remote billing. It affects agent ownership only; it does not stop an
independent manual/Continuous attempt. No automatic reconnect or grant occurs.
Another playable run after Stop/disconnect requires a fresh dev-server process;
reload alone does not restore its allowance. A second page revokes the existing
attachment rather than taking it over.

After local Stop, the browser attempts a `user-requested` revoke before explicitly
closing its stream, bounded to one second. A validated revoke returns HTTP 409
`{"error":"agent-stopped"}` to a pending CLI command independently of SDK/native
cleanup. The broker remembers only the most recently closed lease's identity and
terminal error, so the next old-lease command also receives it, including while
a replacement page is attached. This record contains no authorization or settings.
Disconnects, deadlines and failed reason delivery remain `lease-revoked`; they
must not be described as a human Stop. An accepted result before revoke remains
valid; the next command discovers termination. Exhaustion retains its normal run
counters and is distinct from revocation.

`$doom-decisions play` checks every CLI result before continuing. On `agent-stopped`
it ends with `Agent stopped by user. Ending play.` and makes no further calls.
This is cooperative cancellation at the next tool-result boundary, not forced
preemption while Codex is thinking. One next old-lease call may discover Stop
between commands; local/controller fences prevent another gameplay admission.
No recovery, reattachment or replenishment occurs within the stopped invocation.

While an agent decision owns the controller, manual Next, Continuous, observation,
second agent decisions and saved prompt/model changes are rejected at controller
boundaries. Tics and the selected policy's configuration are frozen before asynchronous work;
unsaved prompt drafts do not change the request. Controls return only after safe
settlement, with the ordinary credential gates still applied.

##### Codex foreground play

Two terminals, one existing dev server: the human runs `npm --prefix app run dev:agent`
and manually opens `http://127.0.0.1:5174/`. In Codex, from this worktree, invoke
`$doom-decisions play`. Codex attaches, observes and actually opens every exported
PNG with its image-viewing tool. It retains a short navigation hypothesis and
updates ephemeral high-level instructions and Game State inclusion when useful. The Decisions API still chooses
every low-level action. No browser driving, second server, daemon or persistent map
is involved. `play` is skill routing, not a CLI subcommand.

Invoke the skill once after preparation. Codex views the initial verified PNG,
reads get-config, invokes start-run once and uses the returned run ID, revision and
frozen limit. It proceeds without a browser authorization click or another human
message. The browser is for watching and **Stop Agent**, with actual remaining,
reserved and SDK-invoked counts. Claiming permission never itself calls a provider.
No invocation, prompt change, lost response or reattachment can replenish the
process allowance. The skill never restarts the server or falls back to legacy
single-decision grants.

The CLI provides effective configuration/prompt commands and scoped decision arguments:

```sh
node scripts/doom-agent.mjs get-prompt --lease /absolute/lease.json --session SESSION_ID
node scripts/doom-agent.mjs set-prompt --lease /absolute/lease.json --session SESSION_ID --run RUN_ID --revision REVISION --instructions-file /absolute/instructions.txt
node scripts/doom-agent.mjs get-config --lease /absolute/lease.json --session SESSION_ID
node scripts/doom-agent.mjs set-config --lease /absolute/lease.json --session SESSION_ID --run RUN_ID --revision REVISION --config-file /absolute/configuration.json
node scripts/doom-agent.mjs observe --lease /absolute/lease.json
# Codex must actually view the new pngPath before deciding.
node scripts/doom-agent.mjs decide --lease /absolute/lease.json --observation OBSERVATION_ID --session SESSION_ID --run RUN_ID --revision REVISION
```

`get-prompt` returns `{sessionId, revision, instructions, run}` with controller-owned
`runId`, `active`, the frozen configured `limit`, `reserved`, `sdkInvoked`, and `remaining`, or a
fixed error. Reading never grants permission. Instruction text is the effective agent template,
with `{{tics}}` resolved only when the normal request is built. Prompt commands carry
no key, client, provider configuration or human draft.

Attachment initializes one frozen lease-owned configuration: copy human saved
instructions once and enable all five inclusion flags, independently of human
checkboxes. Authorization and decisions do not reset these values. Ordinary
Manual/Continuous requests always use human saved configuration. Agent changes
never save into human settings or load/change human drafts.

`get-config` returns `{sessionId, revision, configuration, run}`. The run state is
the same as get-prompt. Configuration has exactly six fields; a JSON file for a
full replacement contains only this object, not the response envelope:

```json
{
  "instructionTemplate": "Explore the visible opening for {{tics}} tics.",
  "includeReadyWeapon": true,
  "includeAmmo": false,
  "includeHealth": true,
  "includeFacingProbe": true,
  "includePreviousAction": true
}
```

Read/edit/CAS: get current configuration, change selected fields, write all six
fields to an absolute UTF-8 JSON file, then set-config with the returned revision
and session/run. Missing/extra keys and nonboolean flags are rejected. Instructions
must be nonblank and at most 16000 characters. The wire command includes the existing
`pageId`, `ownerId`, `epoch`, `commandId`, `sessionId`, `runId`, `revision`, plus
`configuration`; get-config omits run/revision/configuration. Broker responses use
`{pageId, epoch, commandId, config: ...}`; CLI validates and flattens that envelope.
Fixed errors include `invalid-configuration`, `revision-conflict`, `session-mismatch`,
`run-unavailable`, `not-ready`, `editor-open`, and `lease-revoked` (malformed wire
commands fail as `invalid-request`). No credentials/provider objects cross this boundary.

Both setters require a ready idle controller, current active bounded run and
expected monotonic revision. **Any open human prompt editor** rejects writes.
`set-prompt` updates only instructions in that same ephemeral configuration;
set-config fully replaces it. Successful edits increment the shared revision,
invalidate old observations and update the authorized run's expected
identity while preserving run ID, remaining budget and reserved/SDK-invoked counts.
Codex must observe and **view a fresh PNG** before the next decision. Rejected
stale/malformed/busy writes leave settings, revision and counters unchanged.
Human saves/model/tics/options changes and detected external identity mismatches
still end the bounded run. Already admitted requests retain their frozen settings.

Budget exhaustion retains configuration for read-only inspection under the same
lease, with zero allowance and no rearming. Stop/disconnect/page exit removes it;
terminal or uncertain retirement discards configuration while retaining the ended
authorization record for attempt evidence. No browser reconnect/rearming is added:
refresh starts a new page-memory session but cannot restore the process allowance.

Each valid scoped decision admission synchronously reserves one slot before any await.
A reservation is never refunded, including missing credentials or pre-create failure.
Actual SDK invocation is counted separately at the existing `beforeCreate` boundary;
it is not proof of remote billing. Retries and fallback remain disabled. Each next
cycle requires an independently verified observation matching current effective configuration.
Only healthy action AND resulting-frame verification permit continuation. Manual
gameplay ends the run; it does not silently borrow its authorization. Failures,
terminal/uncertain results, lease loss and Stop end remaining admission. At the frozen
reservation limit the run ends; no further create or automatic restart is permitted.

The skill reasons in the foreground between individual calls, reads actual allowance
with get-config and stops at exhaustion, goal completion, conflicts or ambiguity. It
does not choose action identifiers or treat unchanged XY, screenshots or previousAction
as proof of collision/door availability. Qualified facing evidence and existing
previous-action text are exported as documented above; movement-event collision
masks remain browser-only. Prompt changes provide a feedback channel for persistent context; this
small experiment does not establish that context improves navigation statistically.
Start a fresh Codex conversation here if the skill picker is stale.

Human acceptance (Codex must not operate Chrome or make provider calls during
implementation):

1. After review and separate authorization for up to three possibly billable
   attempts, set `AGENT_DECISION_BUDGET=3`, start a fresh `dev:agent` process,
   manually open `http://127.0.0.1:5174/`, and wait for verified neutral-first
   tic **1/1/1**.
2. Invoke `$doom-decisions play` once. Confirm there are no Allow controls and no
   second chat message is needed. Codex attaches, views the PNG, reads config,
   claims once, then autonomously performs at most three decisions with individual
   reasoning and verified image inspection. Record actual page/epoch/session/run
   identity, revision, N, counters, action/tic/frame receipts and visual progress.
3. Confirm exhaustion shows zero remaining and three reservations, without another
   paid decision. Offline tests cover fourth-attempt rejection and rearming fences.
   If agent-effective settings change, confirm human saved settings/drafts remain
   separate; no deliberate settings edit is required for this smoke test.
4. Fully stop the server and launch a fresh `dev:agent` process for a separate
   authorized Stop trial. Prepare, invoke the skill once, then click **Stop Agent**.
   Confirm further admission ends, safe cleanup completes and, when Stop attribution
   succeeds, Codex replies `Agent stopped by user. Ending play.` without more calls.
   Do not add a recovery/discovery call after that acknowledgment. Browser reload
   must not replenish the allowance. Stop cannot undo an invoked request or ensure
   it was uncharged; deliberate in-flight races remain offline coverage unless
   separately approved.
5. Bring sanitized receipts and human browser observations back for review. Live
   death/exit and terminal-image failure acceptance remain separate from this
   small smoke test; their provider-free synthetic coverage is retained.

Offline tests use synthetic native boundaries and fake SDK transport, including
held readers, pre-create/pre-dispatch Stop, dispatched settlement, terminal prefixes,
lease invalidation, aborted uploads, and CLI PNG delivery. No runtime sleep hook
is added. These are not Chrome, real WASM gameplay, or authenticated provider
acceptance evidence; real browser/visual/provider acceptance remains human-run.

### Impeccable Live

With frontend dependencies already installed, run from the repository root:

```sh
npm --prefix app run dev:impeccable
```

Keep this Vite instance running, send `$impeccable live` in Codex chat, and
manually open `http://127.0.0.1:5173/` in Chrome to select interface elements
and review variants. Stop Vite with **Ctrl+C** when finished.

## Prerequisites and clean checkout

Provision tools yourself; the build never installs them. The supported engine
build requires Bash (macOS **3.2** syntax), Node **22.20.0**/npm on PATH,
GNU Make **3.81** at `/usr/bin/make`, WASI SDK **24.0** (Clang/LLD 18.1.2),
Binaryen **119**, and Git. Python is not required for a fresh build or preview. See
[engine build documentation](../docs/doom-build.md) for the wrapper's constraints.
Its tested host is macOS; the Bash entrypoint does not establish support for
other hosts whose Make/tool versions differ. Paths passed to the engine wrapper
must satisfy its restrictions (including no whitespace or symlink ancestry).

For **macOS arm64**, explicitly install missing pinned WASI SDK/Binaryen tools,
or check existing tools offline (both commands use macOS Bash 3.2):

```sh
bash scripts/setup_toolchain.sh install
bash scripts/setup_toolchain.sh verify
```

These commands use only `tools/wasi-sdk-24.0/` and `tools/binaryen-119/`, under
ignored `tools/`; they do not provision Node/npm or other prerequisites. Valid
existing installations are left unchanged without downloading. Invalid or symlink
destinations fail without repair: inspect and manually move/remove only the affected
destination before retrying. Normal `./build.sh` and `--frontend-only` never invoke
setup or fetch tools. See [setup integrity and recovery](../docs/doom-build.md#explicit-toolchain-setup)
for checksum provenance and limits.

From a checkout containing the app-local lockfile, install frontend dependencies:

```sh
npm --prefix app ci --no-audit --no-fund
./build.sh
```

In agent sessions, follow [AGENTS.md](../AGENTS.md) and task-specific execution
authorizations. Obtain owner approval before dependency resolution/downloads,
installation, builds, servers, browser execution or billable API calls.
Source inspection alone does not verify a build.

The default build uses Node admission, foreground Make, Node closeout and verified
staging, with `controlled-title`, fixtures enabled, two jobs and no embedded WAD.
Default tool locations are `tools/wasi-sdk-24.0` and `tools/binaryen-119/bin`;
optional `WASI_SDK` and `BINARYEN_BIN` environment variables select provisioned tools.
Node and npm come from PATH. No owner-specific absolute path is hard-coded.

Each build uses a new `engine/doom/build/m4b-runs/run.*/engine/` directory;
failed attempts and their evidence are retained. A deterministic ignored
`engine/doom/build/m4b-current.json` selects the current successful engine output.
It records that output's relative path and a hash of engine inputs, including
unignored additions/deletions, `build.sh`, Node build/staging helpers and inspector.
It deliberately does not require the repository HEAD to stay unchanged for frontend-only work.
The original build manifest remains beside the engine artifact. Keep it for
source/toolchain provenance; it is not published with private host paths.
Admission writes a pending receipt; only successful Make followed by closeout's
source/tool rechecks and WASM inspection permits a success receipt. Pending output
is rejected. The new receipt schema requires one full build before reusing an old
Python-generated cache; no old artifacts are deleted or silently adopted.

The handoff rechecks the successful manifest, controlled profile, enabled
fixtures, absent embedded IWAD, bytes/hash, source-input fingerprint, and typed
interface with `scripts/inspect_doom.mjs`. It stages `doom.wasm`, a sanitized
`doom-build.json`, and licenses under ignored `app/public/`. Vite copies these
to `app/dist/`; the handoff verifies emitted bytes and refuses raw `.wad` files.
The same handoff copies/verifies the pinned Freedoom gzip and release notices,
including gzip integrity and original WAD identity, in source, `public` and `dist`.
Staging verifies the candidate and `public` before atomically selecting current.
Current certifies the native engine; a later failed frontend build still exits
nonzero and does not certify a fresh `dist`.
Generated app/native outputs and installed dependencies are ignored. Historical
ignored builds are never selected as fallback inputs; old `references/doom.wasm/build/`
receipts cited in evidence records are unavailable in this checkout. Tracked
upstream example assets remain subject to the vendor-provenance caveats below.

For subsequent frontend-only changes:

```sh
./build.sh --frontend-only
```

This skips engine compilation and reuses only the current verified native artifact.
Missing files/evidence, changed engine inputs, mismatched bytes, or failed
interface checks require a full `./build.sh`. A clean checkout has no current
artifact and cannot use frontend-only mode first. Changed frontend dependencies
require `npm ci` again. The app build runs `npm run typecheck` before `vite build`
and retains the staging/output verification; the root wrapper also checks Worker
packaging. Every failure exits nonzero; an old `app/dist/` may still
exist after an early failure and is **not** a successful new build. Concurrent
builds in one checkout are unsupported.

Make runs in the foreground with no global timeout or process-tree supervisor.
The owner reports successful full and frontend-only builds with the same WASM
SHA-256, verified fixture-enabled WASM and `public`/`dist`, no bundled IWAD, and
Ctrl+C stopping compilation in a macOS terminal. These are owner-run observations;
the deliberate compilation-failure experiment was skipped for this milestone.
Shell INT/TERM traps exit rather than continue; they do not guarantee descendant
cleanup when only the wrapper receives a signal. A hung tool may require manual intervention. The old
512 MiB disk-space admission check and output-size accounting are omitted.

## Temporary browser-direct credentials

OpenRouter is the default in development and production. Sign in before selecting
a WAD, or reveal the manual OpenRouter password field and enter a temporary key
after preparation. The browser sends prompts/screenshots through OpenRouter,
which may route model input to its downstream provider. Decisions can incur
charges. Authorization creates a remote OpenRouter API key; refreshing this page
clears local access without revoking that key. See the sign-in flow below.

The operator-only direct OpenAI alternative sends requests to
`https://api.openai.com/v1/decisions` using the pinned SDK and `gpt-6-luna`, browser
opt-in, zero retries, and a 10-second deadline including response-body reading.
Earlier direct OpenAI trials encountered CORS restrictions; deployed browser
access remains unverified. SDK availability and builds do not establish access.
No provider error selects OpenAI or automatically retries a request.

The field clears when captured; the SDK client remains only in memory for later
clicks. An empty field can therefore mean a client is already available. During a
healthy idle session, enter a replacement key before the next click to replace
the client without restarting Doom. No key goes into storage, a URL, Worker
messages, diagnostics, or build artifacts. Page exit or fatal retirement drops
client references and clears the field. JavaScript cannot securely erase every
browser heap copy.

This prototype requires trust in the served page, all deployed scripts, the SDK,
and browser/DevTools access. CSP does not remove that trust requirement. It has
no account system, backend, proxy, or persistent credential. A deadline/abort does
not prove that upstream processing or billing stopped.

API failures/refusals/invalid choices dispatch no native action. If a fresh
snapshot proves the native state unchanged, the game returns to ready for another
explicit click; there are no automatic retries or fallback actions. Partial or
uncertain native completion, or failed render verification, retires the Worker:
**reload to restart**, with no reconstruction or replay. A bad IWAD can be
corrected before native preparation begins. Once preparation is admitted, the
picker is locked; changing the selected file never restarts a prepared game.
There are no Prepare, Reset or New Game buttons. Refresh starts a new game
and clears the in-memory credential; it does not resume prior state.

## Provider selection and static hosting

Provider selection is fixed at dev startup or production build time. It is a
nonsecret operator setting, with no in-app provider menu:

| Configuration | Provider |
| --- | --- |
| Missing/empty `VITE_DECISION_PROVIDER`, or `openrouter` | OpenRouter in DEV and PROD |
| `VITE_DECISION_PROVIDER=openai` | Experimental direct OpenAI; manual key only, no OpenRouter OAuth/storage access |
| Development `--mode jev`, missing/empty setting or `openrouter` | Retained direct Jev experiment via local Vite proxy |
| Development `--mode jev` with `openai` | Startup error: conflicting configuration |
| Any other nonempty setting | Startup error; no provider selected |

`--mode impeccable` retains its dev helper allowances and uses the same provider
setting. `--mode openrouter` remains compatible but is no longer necessary.
Production never selects direct Jev or enables its proxy, even with `--mode jev`.
OpenRouter offers the two session model choices described below. Direct OpenAI
and the legacy direct Jev experiment have no model selector.

For an explicitly experimental OpenAI session/build, with separate execution approval:

```sh
VITE_DECISION_PROVIDER=openai npm --prefix app run dev
VITE_DECISION_PROVIDER=openai npm --prefix app run build
```

The production setting is compiled into the assets; changing a hosting environment
variable after building does not switch providers. Never put an API key in a
`VITE_` variable: these values are public client configuration.

Static hosting must use HTTPS for Web Crypto (loopback HTTP is suitable locally).
Serve the entry page at the exact callback **origin + pathname**, including its
query parameters, without changing hostname or path on return. Prefer a canonical
directory URL ending in `/`, such as `https://example.test/doom/`, or explicit
`/doom/index.html`. The relative Vite asset base supports subpaths; an extensionless
`/doom` rewrite without a trailing slash can resolve assets against the wrong
directory. Canonicalize before sign-in. `/doom` and `/doom/` are distinct callbacks.
The same tab/origin must retain its pending `sessionStorage` record through return.
The host must serve the app at `?code=...&state=...`; no backend exchange is added.

The strict source/production CSP permits only same-origin connections and
`https://openrouter.ai` / `https://api.openai.com`. Both exact API origins are
permitted regardless of selected provider; this avoids separate CSP builds and
does not enable automatic fallback. Host response CSP must also permit the
selected endpoint. Production has no inline-style, localhost-helper or proxy
allowances. Keep host logs and analytics from recording callback query secrets;
client-side URL scrubbing cannot erase prior host logs. Do not log/export keys,
codes, verifiers, screenshots or response bodies. Deployed callback serving,
exchange CORS and model access remain unverified for this change.

## OpenRouter sign-in and Decisions

With dependencies and verified staged engine assets already available, launch:

```sh
npm --prefix app run dev
```

The default provider in development and production uses official `@openrouter/sdk` **1.4.25**,
`alpha.decisions.create`, with two model choices using the same OpenRouter key:
**GPT-6 Luna Decisions** (`openai/gpt-6-luna-decisions`, default) or
**Jev 1.14** (`typesafe/jev-1.14`). The radio group below sign-in becomes editable
after OAuth returns a key or you choose manual-key entry. Choose before your
first decision. Returning from manual entry to sign-in without an OAuth key
restores the default; choose again after connecting. Selection is held only in
memory and never added to OAuth storage. Refresh restores the default.

The first successfully constructed provider client freezes the model for the
game session, including after API errors, Stop, continuous play and replacement
keys. SDK status/evidence describe the configured model; the inert SDK probe
does not prove remote model access. Selection and OAuth completion never admit
a Decisions request or prepare a Worker. Only Next Decision or Start admits a
billable request, with no automatic provider or model fallback.

**Sign in with OpenRouter** is the primary connection option, available only
before selecting a WAD. Authorizing creates an OpenRouter API key for this page;
it does not establish an application account or a persistent login session.
**Use an API key instead** reveals the existing password field, editable after
successful preparation. **Use sign-in instead** hides it and discards any
unsubmitted manual edit. After WAD selection, sign-in stays unavailable; refresh
for a fresh sign-in, or use a manual replacement during a healthy idle game.

The browser-only [PKCE S256 flow](https://openrouter.ai/docs/guides/overview/auth/oauth)
uses Web Crypto for a 32-byte random verifier and an independent random state.
One namespaced `sessionStorage` record temporarily holds those values, the exact
callback target and non-auth query/hash restoration details. Blocked storage
prevents redirect. The same-tab callback is **current origin + pathname**, with
no query/hash: `127.0.0.1` and `localhost`, ports and paths are distinct. Keep the
same development server or static deployment available through authorization
and return.

Only a pending flow at its expected callback with one nonempty code and exactly
matching state can exchange. Pending metadata is consumed once, and owned
callback parameters are removed with `history.replaceState` before networking,
preserving history state, saved non-auth query/hash and additional unrelated
return parameters. Unsolicited or uncorrelated `code` parameters are left alone
and never exchanged; a deliberate new sign-in excludes reserved auth parameters
from its restoration metadata. Returns without a code clear pending metadata
and show a non-success message, including denial without echoed state. The
exact denial return shape remains unverified. Stale/malformed attempts require
an explicit fresh sign-in; there is no exchange replay on reload.

The verified code is exchanged once with plain browser fetch to
`POST https://openrouter.ai/api/v1/auth/keys`, with JSON `code`, `code_verifier`
and `code_challenge_method: S256`, no bearer key/cookies, no retries and a separate
10-second timeout covering fetch and JSON reading. Errors are fixed local
messages; response bodies, credentials and account identity are not displayed.
Page exit aborts and fences late results. The temporary verifier survives the
outgoing redirect, then is consumed on return; tab storage can survive browser
restoration, so tab close is not a secure-erasure guarantee. Remote authorization
codes expire ten minutes after issuance according to the guide.

The minted API key is **memory only**, never placed in either storage area or the
password input. The next explicit Next/Start consumes it through the existing
key port; the provider then retains its client. A nonempty manual key wins and
discards an unused sign-in key, even if that manual candidate is invalid. Blank
input keeps the current client. Refresh, page exit or fatal retirement clears
local access, without revoking the remote key or logging out of OpenRouter.
Timeout, cancellation or a lost response does not prove no key was created.
Repeated sign-in can create additional keys; manage/delete them in
[OpenRouter key settings](https://openrouter.ai/settings/keys). Trust in the page,
scripts and browser remains necessary; JavaScript cannot securely erase heap copies.

Authorization navigation ends the current page; no WAD, Worker or Doom state is
restored. On return, select the local WAD for a **fresh** verified preparation,
then explicitly choose Next Decision or Start. Authentication never prepares the
game or issues Decisions. The key, original Canvas PNG, context, unchanged
instructions and seven choices go directly to
`https://openrouter.ai/api/alpha/decisions`; OpenRouter may forward model input
to its downstream provider. There is no application proxy or persistent API key.

SDK retries and provider fallbacks are disabled. One charged SDK invocation is
not proof of one remote computation or billing outcome. The existing 10-second
budget includes request construction and body reading; canceled work retains
admission until the underlying SDK operation settles. Keep `OPENROUTER_DEBUG`
unset: this provider rejects SDK debug logging. SDK success exposes a sanitized
body ID when available; HTTP status may remain null without response metadata.
Choice keys are emitted in the existing order; downstream ordering is not promised.

Ordinary development and strict production CSP permit the OpenRouter origin;
only the direct Jev development experiment removes external API connections.
The owner previously reported successful browser-direct Decisions HTTP 200 and
four verified/rendered `forward` decisions at N=6, cumulative tic 25, then successful
localhost browser sign-in followed by Next Decision at the OAuth milestone.
The owner also reports tests, build and independent P0–P2 review passed for that
milestone. These are prior owner-reported results, not verification of this
default-provider patch or of a deployed static host. No tests/builds or live trials
have been run for this change yet.
The generated auth endpoint reference marks bearer authorization as required,
contradicting the OAuth guide/reference helper; this implementation follows the
guide without adding a credential, proxy or workaround.

**Separately authorized deployed acceptance:** after offline checks, build and
independent review, serve the built assets at the intended HTTPS static URL
(including its real subpath). Click Sign in before WAD selection, and obtain owner
approval to authorize/mint a key. Verify exact hostname/path return, auth endpoint
preflight/CORS and one readable exchange response, URL cleanup and no Decisions
or Worker preparation during auth. Do not export HARs, bodies, headers or codes.
Then select the approved local WAD and verify fresh neutral 1/1/1 preparation.
After separate approval for one potentially billable Next Decision, use N=6:
expect one legal choice, unchanged native state while waiting, healthy 6/6/6 tics,
cumulative tic 7 and matching resulting native/Canvas hashes (or existing verified
terminal-prefix handling). Do not start continuous mode. Deployed auth CORS,
unauthenticated exchange, exact callback path serving and denial behavior remain
live gates. Successful localhost OAuth does not prove static-host acceptance.

## Prototype acceptance and evidence

The owner accepted v0.2.0 with known evidence gaps. Prior observations are
**owner-reported**, not browser/API trials personally run by Codex:

- Earlier Chrome preparation showed real E1M1, neutral-first requested/reported/
  verified **1/1/1**, matching native/Canvas RGBA hashes, and no simulation
  advancement during passive snapshots/rendering or five-second startup idle.
- During the temporary identity-gate bypass, the owner reported shareware
  `DOOM1.WAD` loading with the complete original HUD and multiple AI forward
  decisions (reported screenshot: decision #6, verified tic 73), using the existing
  WASM. The file's exact identity was not independently inspected by Codex. This
  is compatibility evidence for that local file, not universal IWAD support or
  a browser verification of the permanent admission patch.
- The accepted manual trial reported **14 successful Decisions API decisions**,
  with five supplied receipt summaries and a duration change from **6 to 2**.
  Full Worker-instance/frame linkage, payload hashes, exact network accounting,
  and instrumented post-decision idle equality were not collected for that trial.
- The owner subsequently reported real Doom death detection at decision **#48**,
  with **N=20** and cumulative **tic 961**. This is not independently captured
  exact Worker/frame linkage or proof of every terminal path.

Controller "independently verified" counts mean receipt rechecking, not an
independent browser run. Independently instrumented terminal proof, including
E1M1 exit-pending and early-prefix behavior, remains uncollected. Synthetic offline
tests and builds do not fill those gaps. Detailed historical reports remain in
Git history; historical ignored raw artifacts cannot be recovered from Git.

## Owner-run isolated Chrome/API trial (not executed by Codex)

After separate build/runtime approval, run `./build.sh --frontend-only` if the
current verified native artifact can be reused, then serve **only** `app/dist/`.
From the repository root:

```sh
(cd app && ./node_modules/.bin/vite preview --host 127.0.0.1 --port 8000 --strictPort)
```

Open `http://127.0.0.1:8000/` in Chrome. Use loopback or HTTPS for Web Crypto.
Relative Vite URLs support canonical subpaths as described above. The app uses local
static assets and one Vite-packaged ES module Worker. CSP permits same-origin
Workers and both precise API origins. Inspect any Worker response CSP headers as
well as the page policy. The noncredential SDK probes never invoke Decisions.

1. Confirm default OpenRouter SDK **1.4.25** and sign-in UI (or explicitly selected
   experimental OpenAI SDK **7.32.0**). Inspect Console/Network;
   record Chrome version, errors and local resource URLs. Select known-good local
   **Freedoom 0.13.0 Phase 1** `freedoom1.wad` (28,795,076 bytes; SHA-256
   `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`).
   Selection automatically loads bundled WASM and prepares real E1M1. No API
   request occurs. This is a known-working example, not a required identity pin.
   Repeat in a fresh page session with the owner's local shareware `DOOM1.WAD`,
   leaving the key blank; require the same preparation proofs and complete HUD.
   Invalid/incompatible input must not produce an admitted gameplay session;
   retain its exact error. Do not use hostile files as a safety test.
2. Confirm zero gameplay work before the mandatory neutral action and neutral
   requested / reported / independently verified **1 / 1 / 1** afterward. Expect
   the real 640×400 frame and matching native/Canvas RGBA hashes at **tic 1**.
   Wait for the five-second startup idle check to complete. Expand evidence:
   repeated snapshots preserve every counter and native field; the passive render
   changes only render/frame/intercept bookkeeping. No keyboard input drives Doom.
3. Choose **Use an API key instead** and enter a temporary OpenRouter key (or the
   OpenAI key field for explicit OpenAI builds); set **N1=2**; click **Next Decision** once. Expect exactly
   one Decisions POST (OPTIONS preflight is separate), action **2 / 2 / 2**,
   cumulative **tic 3**, a verified resulting frame, and the same Worker/game.
4. Wait without clicking. Expect no new API request or native tic. Set **N2=5**;
   click once more. Verify the API observes the actual frame from **tic 3** (its
   captured checkpoint/hash equals decision 1's result). Expect **5 / 5 / 5**,
   cumulative **tic 8**, same Worker and initialization counters still one.
   Network-wait snapshots must be unchanged. Actions may be neutral; motion and
   differing frame hashes are not requirements.
5. Inspect accumulating history and advanced evidence for selected N, action,
   native requested/reported/verified counts, cumulative checkpoint, observation
   and result RGBA hashes, sanitized request IDs, API latency and honest failures.
   Missing receipts/timeouts after dispatch are uncertain completion, never proof
   of zero execution. A verified action with a failed resulting render is not
   replayed. Refresh to start over.

Keep build/WASM identity, sanitized request IDs, hashes and receipt projections.
Inspect the current image request locally without exporting secrets, authorization
headers, raw HARs or unredacted request content. Record owner Console/Network and
browser observations separately from Codex source inspection. These steps are a
verification procedure, **not evidence that this exact sequence was executed**.

Record the generated WASM size/hash and manifest path. Compare the hash with the
preflight reference `cc86ed8884ec04dbace3c541e8528a9f91839b79816cc79ce988af939d42dcb8`
(360,156 bytes), without treating it as a fixed requirement for modified engines.
See [prototype evidence](#prototype-acceptance-and-evidence) for prior owner reports
and their limits. Builds/static inspection do not establish Chrome, native or API
runtime success.

## Owner-run continuous trial (separate authorization required)

After an authorized build and isolated Chrome setup above, explicitly authorize a
**two-attempt** continuous run. Select N=2, Start, and change N to 5 during the first
API wait. Confirm receipts **2/2/2** then **5/5/5**, cumulative tics **3** then **8**,
and decision 2's observation checkpoint/hash equal to decision 1's verified result.
Record the persistent DevTools Worker target, initialization counters, local
observation payload, and exactly two Decisions POSTs (preflight is separate).
Expect **Budget exhausted, 2/2**, no third call, and manual readiness.

Separately authorize **one further attempt**, set the budget to 1, Start, and Stop
while its API response is pending. Confirm no late native action, no replacement
request while response cleanup remains pending, unchanged native checkpoint, and
manual readiness only after cleanup/passive proof. This trial admits at most three
potentially paid requests. Also record native-counter equality during SDK waits
and an idle interval, Console/Network observations, and keyboard/narrow-screen
control behavior. If Stop cannot be timed before dispatch, record that gap; a
completed action is not evidence of pre-dispatch cancellation.

A separately authorized one-attempt API-failure trial should stop without retry
or native dispatch and retain manual readiness only after passive proof.
Independently instrumented terminal proof, including E1M1 exit-pending and
early-prefix behavior, remains separate and uncollected despite the owner's
reported death observation. None of these browser/API/WASM trials has been
executed by Codex for this implementation.

## Offline tests, static checks and source boundary

Biome **2.5.15** is the app's sole linter and formatter, exact-pinned in the
app-local package and lockfile. Vitest **5.0.4** is the exact-pinned application
test runner. With dependencies already installed and offline test execution
separately authorized, run either command from the repository root:

```sh
npm --prefix app test
npm --prefix app run check
```

`npm --prefix app run lint` checks without writing.
**`npm --prefix app run format` writes changes** to included files.
`test` runs the complete offline application regression suite: all nine
`tests/*.test.ts` files in the default Node environment, with isolated files and
serial cases within each file. No additional Vitest configuration is needed.
`check` runs DOM and Worker TypeScript checks, static Worker packaging/import
checks, that complete suite once (including Worker-entry smoke), and non-writing
Biome lint/format checks in sequence, stopping on failure. Builds retain their
asset checks and never format source automatically.

The suite covers whole-body request fidelity and fresh request trees; admission,
frozen N, stale fences, choice validation and receipt accounting; Latest Outcome
truth gates; pinned SDK transport, deadlines, charging and helper/underlying-reader
ownership; and passive Worker imports/unknown-operation retirement. The ordinary-import
`session-controller.test.ts` initializes the real controller, prepares synthetic
receipts through neutral 1/1/1 and passive/idle checks, and completes one verified
SDK decision with local fake transport and native/Canvas hash agreement. IWAD,
terminal and continuous tests retain source extraction, Node type stripping and
VM contexts with mocked DOM, SDK, Worker responses and native receipts. They
cover synthetic size/digest admission, initialization failures, sequential frame
checkpoints, request/budget ownership, Stop before/after dispatch, delayed
success/rejection, timeout cleanup, failures without retry, and terminal/unsupported/
uncertain boundaries. These legacy loaders now read the moved controller and (for terminal/continuous)
the browser renderer; their prepared-state and VM Error/timer seams remain for
Stage 3. Extraction remains fragile when production source changes.

All fixtures are synthetic/offline. They use no game assets and demonstrate no
real Chrome, paid Decisions API, native Doom/WASM or live gameplay correctness,
successful browser preparation, or malicious-IWAD safety.

`biome.json` includes app source TypeScript (including `.d.ts`), app-owned
JavaScript and CSS, `biome.json`, `package.json`, both TypeScript configs, and
`vite.config.js`. It force-ignores `dist/`, `public/`, `node_modules/`, and
`package-lock.json`. The app-owned Worker is checked and formatted normally.
Vendored engine code and root scripts are outside this scope.

```sh
bash -n build.sh
npm --prefix app run typecheck
node --check scripts/build_engine.mjs
node --check scripts/stage_web.mjs
npm --prefix app run check
git diff --check
```

`src/session-controller.ts` is inert on import and construction. Its factory owns
session/attempt identity, readiness, preparation/proofs, decisions, continuous
admission, Stop/SDK reader cleanup, recovery and retirement. Explicit commands
start work. `src/main.ts` composes DOM rendering, synchronous input and Canvas
ports, local resource fetch, the Worker factory and page events. Presentation
receives detached read-only evidence and controller-decided controls, never mutable
session state, clients or cancellation hooks. Canvas ports return pixels; the
controller checks their digests and native receipts between the session fences.

`src/worker.ts` is the sole app-owned Worker entrypoint, loaded with Vite's literal
Worker constructor and explicit ES output format. `worker-shared.ts` contains
receipt types and one native step verifier reused by the Worker and controller;
importing it starts no Worker. There is no raw-source/Blob assembly or experiment
file dependency. Retired experiments are available in Git history; native engine
semantics are unchanged.

`tsconfig.json` checks the browser entry, session controller and shared code; `tsconfig.worker.json`
checks the Worker and shared code with WebWorker globals. Explicit `.ts` imports
also resolve in the Vitest tests. The packaging check parses
stripped source with Vite's already-installed parser and checks the constructor,
ES format, CSP and import boundary. The offline entry smoke imports the actual
modules, checks that only the entry installs a handler, and checks retirement on
a removed operation, without instantiating WASM or creating a real Worker.

Worker replies enter the controller as `unknown`; it checks the operation
envelope and uses the shared receipt contract while retaining native
completion/hash/idle checks. Types, offline checks and production builds do not
establish Chrome, native gameplay or authenticated API success. Follow the
owner-run procedure above after separate browser/server and billed-call approval.

## Licenses and deployment

The generated output includes the engine GPL license and SDK license files,
including bundled vendor notices. Existing source copyright/notices stay in
`engine/doom/`; see [vendor provenance](../docs/doom-vendor-provenance.md).
Included Freedoom ships as the pinned gzip with its complete release BSD 3-Clause
notice, contributor credits and music credits, linked in the page footer. It does
not imply endorsement by Freedoom or its contributors. Inclusion of licenses alone does not establish redistribution
compliance. Review GPL corresponding-source/build-provenance obligations,
third-party notices, and unresolved vendored asset rights **before public
deployment**. This guide does not establish publication or redistribution clearance.
