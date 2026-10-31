# ACP + AI SDK 7 two-image trial — INCONCLUSIVE

## Connection-only diagnostic — FAILED (2026-10-31)

The separately authorized `npm run diagnose-connect` was executed **once**.
`provider.connect()` rejected in **521 ms**. The caught exception included ACP
error code **1001**, **Codex process exit code 1**, and permission-denial wording.
Sanitized detail: “Codex process has exited; App Server exited or terminated;
Permission denied or operation not permitted.” Installed adapter source defines
1001 as `CODEX_PROCESS_EXITED_ERROR_CODE`, confirming an underlying App Server
failure rather than an unlocated `codex-acp` executable or missing fixture cwd.
The exact denied operation/resource was not preserved by the allowlisted
classifier; a host sandbox restriction is a hypothesis, not an established cause.

The executable was readable/executable, resolved to this installation's adapter,
and `.local/fixture-cwd/` existed as a directory. Args were `[]`. Installed
versions matched the lock: AI SDK **7.0.159**, provider **0.3.9**, adapter **2.5.0**,
bundled Codex **0.165.0**, Node **22.20.0**. ACP initialization was **not confirmed**;
public `connect()` never returned successfully. The public API provides no
separate initialize-success receipt on this failure path. No session was created
and **0 inference turns** occurred. Public cleanup returned and the local session
ID was null; descendant termination remains unverified.

```sh
cd /Users/mike/projects/doom-decisions-app-server/experiments/codex-acp-ai-sdk7
npm run diagnose-connect
```

This command's authorization is consumed. Its separate exclusive marker is
`.local/connect-diagnostic-1-started`; repeats require explicit authorization
and a fresh attempt identifier. Neither marker is automatically removed.
[connect-diagnostic-evidence.json](connect-diagnostic-evidence.json) contains only
allowlisted phrases/codes, relative setup labels, versions, and observations.
Raw stderr is suppressed and not retained. Overlapping matches were classified
as App Server exit before generic permission wording after the run, without a
second invocation or new observation.

[diagnose-connect.ts](diagnose-connect.ts) imports only the provider, performs
one public connection call with a 45-second host wait, and cleans up in `finally`.
It never calls session creation, authentication, inference, or tools. TypeScript,
Biome lint, and `git diff --check` passed before execution and after reporting
edits. `runner.ts`, the trial marker/evidence, static preflight, dependency lock,
and sibling experiment remain unchanged. The preexisting edit to static
preflight evidence is preserved. Historical `preflight` is intentionally blocked,
not a live startup test. Known auto-permission/inherited-tool limitations remain;
this connection failure says nothing about AI SDK generation viability.

**Smallest next action:** identify the denied App Server startup operation in a
separately authorized connection diagnostic with narrowly allowlisted operation
context. No executable/cwd correction, package upgrade, or global configuration
change is justified by this result alone. No further runtime attempt was made.

## Previous two-image trial result

2026-10-31. The static hard stop has been replaced by a real runtime trial.
**`npm run trial` was executed exactly once. `provider.connect()` failed during
ACP initialization after 576 ms. Zero inference turns were attempted, admitted,
or completed; no session was created.** No second invocation, alternate CLI,
provider fallback, login, or configuration repair was attempted. The exclusive
ignored `.local/trial-started` marker remains, including after this failure.

| Check | Observed result |
| --- | --- |
| Provider/model construction | Reached using the real installed public API |
| ACP initialization | Failed: `ACP_INITIALIZATION_FAILED` |
| Session startup/persistence | Not reached |
| Image A / image B | Neither submitted |
| JSON validity / exact marker comparisons | Not run |
| Nonce / exact previous-target recall | Not run |
| Finish reasons / usage | No results; usage absent, not zero |
| Tools / authorization operations | `NOT_OBSERVABLE` |
| Cleanup | Public cleanup returned; local session ID cleared; child/descendant exit unverified |
| Host runner exit | Code 1 |

See [trial-evidence.json](trial-evidence.json) for exact versions and fixture
hashes. The failure happened before AI SDK `generateText`, so it is **not evidence
of an AI SDK 7 generation interoperability failure**. Raw adapter stderr and
arbitrary error messages were discarded rather than logged; the exact startup
cause is unresolved. This run did not identify an interactive-login request.

## Implemented path

[runner.ts](runner.ts) constructs `createACPProvider`, calls `languageModel()`
once, then public `connect()` and `initSession()`. It uses
`INITIAL_AGENT_MODE=read-only`, a dedicated `.local/fixture-cwd`, `mcpServers: []`,
and `persistSession: true`. Startup recovery and normal existing-login behavior
inside the adapter are permitted by the updated task. The previous static gate
is preserved in [preflight.ts](preflight.ts) and never gates `--trial`.

The runnable generation path sends existing sibling PNG **bytes**, not paths,
as AI SDK image parts to `generateText({ maxRetries: 0 })`. There are at most two
sequential calls on the same model/provider; each submits only one new user
message/image and a fresh explicitly synthetic, unverified DTO. A alone includes
the nonce; B includes neither that nonce, A's image, nor A's chosen target.
Session IDs must match before and after each call. Prompts forbid tools, shell,
file operations, browsing, approvals, authentication operations, memory writes,
and gameplay. No proposal is executed.

JSON is prompt-guided, **not native schema enforcement**. The unchanged sibling
`validateProposal` and `assess` are imported read-only; expected marker locations
are never included in prompts. Only SDK `stop` with raw ACP `end_turn` translates
to `completed`. Actual reasons are recorded. A requires null recall fields and
an exact marker match before B can proceed. B's nonce and exact previous-target
recall are checked separately from its exact current marker set. Invalid,
truncated, ambiguous, or failed A responses stop the trial without another call.

The exclusive marker is created before even startup; a repeated invocation stops
without starting a provider or overwriting original evidence. Manual removal
requires **fresh explicit authorization**, and the program never removes it.
Cleanup is in `finally`; connection/session waits are bounded at 45 seconds each,
generation waits at 120 seconds each. Abort/timeout/cleanup do not prove remote
processing or billing stopped. The npm trial script redirects stderr to
`/dev/null` because this provider otherwise forwards arbitrary child stderr.

## Commands and validation

From this prepared checkout, the following non-inference checks passed before
the trial and again after the final reporting edits:

```sh
cd /Users/mike/projects/doom-decisions-app-server/experiments/codex-acp-ai-sdk7
node /Users/mike/projects/doom-decisions/app/node_modules/typescript/bin/tsc -p .
/Users/mike/projects/doom-decisions/app/node_modules/.bin/biome lint runner.ts preflight.ts
git diff --check
```

The one runtime command executed was:

```sh
npm run trial
```

Do not rerun it under this task's consumed authorization. `npm run preflight`
remains a historical **static** `BLOCKED` diagnostic (exit 1), not a prerequisite
for the runtime command. It was not rerun. No install, upgrade, build, app test,
browser, Doom, Decisions API, commit, push, or credential/configuration edit was
performed. The preexisting `preflight-evidence.json` edit remains untouched.
Earlier README material is retained below as historical findings.

## Cost, comparison, and limits

Authored physical TypeScript LOC, including comments/blanks: **163 runtime
runner + 67 historical static preflight = 230 implementation LOC; 0 new test
LOC**. The runtime imports the existing 68-line sibling proposal module, which
imports the 70-line fixture module without invoking its file-writing entry point.
Counting all reused source gives 301 runtime-path LOC, or 368 with the historical
preflight. The direct App Server baseline is **389 implementation + 50 test LOC**
and also admitted zero turns; neither result is an equivalent successful runtime
proof. No bespoke RPC client or transport was added here. The smaller authored
runner establishes less lifecycle/tool evidence than that baseline.

Unchanged direct dependencies: `ai@7.0.159`, provider `0.3.9`, adapter `2.5.0`,
plus dev-only Node types. Bundled Codex is `0.165.0`; the provider additionally
installs **AI SDK 6.0.320** transitively. Static SDK 7/V3 compatibility passes;
runtime generation interoperability remains untested. The layers are host AI
SDK 7 → community provider → ACP adapter → bundled Codex/App Server, compared
with the baseline's host RPC → App Server. Fewer authored lines come with more
dependencies and indirection, not demonstrated runtime simplification yet.

The provider's first-option auto-permission policy, inherited environment/tools
and MCP authority, and lazy authentication remain prototype limitations. Empty
`mcpServers` and read-only mode do not establish tool denial or complete isolation.
The public provider has no permission interception callback. Returned SDK tool
calls are checked before the next turn, but internal activity/permissions are not
fully observable or preventable during generation; `NOT_OBSERVABLE` is not zero.
Public cleanup returns void and cannot certify descendant exit. Synthetic vision
or a future PASS would not establish safe tool isolation or live Doom navigation.

**Previous proposed next experiment (now executed above):** under fresh authorization, run one startup-only
ACP connection with a narrowly allowlisted error code/diagnostic, so the observed
initialization failure has an actionable cause. No dependency upgrade, alternate
framework, configuration repair, or further inference is justified yet. This is
a response to an observed runtime failure, not a new static prerequisite gate.

---

## Historical static-only attempts (superseded runtime status)

The remainder records prior task policies and their unexecuted plans. Statements
that `runner.ts` is static-only or that `trial` cannot start are historical;
the implementation and actual result above supersede them. All preexisting
historical text, including the connection-only investigation, is retained.

### Original report: BLOCKED before process startup

2026-10-31. **Gate A did not pass. Two-turn trial: NOT RUN; zero inference
admissions.** Static package/API inspection found an unsupported permission
boundary. No adapter/Codex process was started, so there are no startup, auth,
session, model, tool-execution, usage or billing observations. This route has not
demonstrated the two-image, same-session proof.

Worktree: `/Users/mike/projects/doom-decisions-app-server`, branch
`experiment/codex-app-server-loop`; initial status was clean. All additions are
inside this directory. No existing experiment, app, engine, skill or MCP files
were changed; no branch changes, commits, global configuration/auth inspection,
game execution or inference. Dependencies were installed with scripts disabled.

## First concrete blocker

Installed `@mcpc-tech/acp-ai-provider` 0.3.9's `index.mjs:847` handles ACP
permission requests by selecting `params.options[0]?.optionId || "allow"`.
It does not choose by permission kind or enforce denial. The internal client has
a setter for a permission callback, but the public settings and model/provider
interfaces expose no way to install one. The setter has no call site in this
package. This can select an allow option; it cannot implement the required
stop-on-permission-request boundary through the documented API.

Separately, `initSession()` uses `ensureConnected()` / `withLazyAuthRetry()`
(`index.mjs:1235–1288`): auth-required errors can trigger authentication and one
retry, including when no auth method is explicitly configured. There is no
documented disable-auto-auth setting. `connect()` initializes without starting
a session, but was also withheld after the first blocker, as required by the
task's stop condition. No private-field access, monkeypatch, custom transport,
provider fork or invalid-auth-method workaround was attempted.

The adapter's installed `dist/index.js:40438` maps `read-only` to read-only /
network-disabled sandbox requests **and approval policy `on-request`**, not
denial of every tool or permission. `mcpServers: []` is only a list of requested
servers: `createSessionConfig()` returns its existing configuration unchanged
when that list is empty (`:41921`). It does not disable inherited MCP entries.
The provider also merges the entire parent environment into its subprocess
environment (`index.mjs:1064`) and forwards child stderr to host stderr (`:1083`).
No private configuration or environment values were inspected to audit those
inheritances. These are source findings, not observed privilege escalation.

## Installed versions and interfaces

| Package | Exact version |
| --- | --- |
| `ai` | 7.0.159 |
| `@mcpc-tech/acp-ai-provider` | 0.3.9 |
| `@agentclientprotocol/codex-acp` | 2.5.0 |
| Adapter dependency `@openai/codex` | 0.165.0 (locked) |
| Dev-only `@types/node` | 22.20.0 |

Node 22.20.0 / npm 10.9.3. Bundled Codex's package version differs from the
baseline's previously observed system **codex-cli 0.166.0**; the bundled
executable was not launched, including for `--version`. No `CODEX_PATH` override
was applied. The adapter resolves its bundled dependency when that override is
absent (`dist/index.js:28103`), consistent with its
[installation documentation](https://github.com/agentclientprotocol/codex-acp#installation).

- **AI SDK 7 compatibility: static PASS.** The provider implements
  `LanguageModelV3` despite stale V2 comments. AI SDK 7's installed `LanguageModel`
  union accepts V3, and `runner.ts` typechecks that actual assignability without
  a cast or compatibility layer. Provider 0.3.9 depends on `ai ^6.0.0` rather than
  declaring a v7 peer: the lock consequently includes a separate nested AI SDK
  6. No inference established runtime interoperability; the top-level SDK stays 7.
- **Lifecycle APIs: present.** Installed exports expose `createACPProvider`,
  `connect`, `initSession`, `getSessionId`, `cleanup` and V3 `doGenerate`.
  [Published API docs](https://jsr.io/@mcpc/acp-ai-provider/doc) document these and
  `persistSession`. `connect` combines spawning and ACP initialization; there
  is no separate public process-connected receipt.
- **Images: source path inspected, runtime UNVERIFIED.**
  [AI SDK's documented image input](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)
  accepts binary Buffer/Uint8Array. Its installed normalization produces a file
  part; provider `index.mjs:578–594` converts image bytes to an ACP image block
  with base64 data and MIME type. Adapter `dist/index.js:42240–42273` maps that to
  an inline image input. Neither fixture was submitted. The preflight only reads
  the baseline PNGs **by path** to record their bytes/hashes; it never regenerates
  or copies them.
- **Session reuse: source-supported, runtime UNVERIFIED.** `persistSession`
  retains the model/session, `getSessionId()` exposes identity, and subsequent
  prompts select only the last user message (`index.mjs:532`). Same-session
  context retention and B-only image/DTO submission have not been demonstrated.
- **Structured output: prompt guidance only.** `doGenerate` turns JSON response
  format/schema into prompt text, not native constrained output. A future trial
  would import sibling `validateProposal` and `assess` read-only; neither was
  copied, weakened or exercised here.
- **Cleanup: API inspected, runtime UNVERIFIED.** `cleanup()` calls
  `forceCleanup()` despite `persistSession`; that sends kill/ends/destroys the
  adapter streams and clears local state (`index.mjs:1464`). It returns void,
  without a child-exit receipt or descendant-cleanup proof. A host timeout would
  not establish a hard remote-token or billing cap. No child existed to clean up.

## Commands and Gate A evidence

From this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache .local/npm-cache
npm run preflight
```

Installation succeeded (136 installed package entries). Preflight deliberately
exits **1 / BLOCKED / UNSUPPORTED_PERMISSION_BOUNDARY**, recording sanitized
`preflight-evidence.json`. Its elapsed time measures static inspection only.
Process connected / ACP initialized / session started are separately `NOT_RUN`.
The runner contains no `generateText()` or `streamText()` invocation, provider
construction, authentication, subprocess startup, retry or asynchronous wait.
Its exported settings are **unapplied plans**: read-only initial mode, local
fixture cwd, no requested MCP servers, persistent session. They prove no isolation.

Offline validation completed successfully using existing repo tools read-only:

```sh
node /Users/mike/projects/doom-decisions/app/node_modules/typescript/bin/tsc -p .
/Users/mike/projects/doom-decisions/app/node_modules/.bin/biome lint runner.ts
git diff --check
```

No new test tooling or tests were added for this static diagnostic. No app tests,
build, browser, Worker/WASM or game assets were run. Both baseline PNG hashes
match the baseline report (2195 / 2198 bytes); full hashes are in the evidence.

**Future trial requires separate inference authorization and resolution of the
blocker.** `npm run trial` is currently a fail-closed diagnostic, not an inference
implementation. Gate B implementation was stopped under the explicit safety stop
condition. It cannot admit even a first turn. No two-turn result or trial evidence
file exists. Terminal validity, A markers, B markers, B nonce recall, B A-target
recall, session identity and tool-activity criteria are each **UNVERIFIED**.

## Comparison with the direct App Server baseline

| Dimension | Direct `../codex-app-server/` | This ACP experiment |
| --- | --- | --- |
| Authored TypeScript implementation LOC | 389 (includes 70 fixture-generation lines) | 67 (blocked static diagnostic only) |
| Authored test LOC | 50 | 0 |
| Direct dependencies | 0 runtime + 1 dev | 3 runtime + 1 dev |
| Transitive package entries in lock | 1 | 137; 132 installed (5 optional platform entries absent) |
| Layers/processes if launched | Host RPC → Codex App Server; host + Codex | AI SDK → community provider → ACP adapter → Codex App Server; host + adapter + bundled Node CLI launcher/native Codex |
| Startup complexity | Maintained RPC, inventory/config/read/account/thread checks | Public connect/session API, but inherited authority and auto-auth/permissions block use here |
| Structured output | Native per-turn schema requested + host validation; untested | Prompt JSON/schema guidance + same host validation planned; untested |
| Isolation/tool evidence | Effective config checked; thread/runtime checks never reached | Static unsafe permission default; read-only plan unapplied; no runtime inventory |
| Real result | `account/read` workspace-requirements error; no thread/inference | Stopped before process start; no session/inference |

LOC is physical lines, including comments/blanks, excluding generated output,
dependencies, lockfiles, JSON and Markdown. Direct implementation counts
`runner.ts`, `rpc.ts`, `proposal.ts`, `fixtures.ts`; tests count `proof.test.ts`.
Package counts include duplicate nested installations and optional platforms,
not unique package names. No conclusion about lower maintained code is justified:
the ACP diagnostic does not implement the baseline's trial or safeguards.

The direct baseline also records an earlier stock App Server failure before
`initialize`, with unknown stderr cause. Nothing here shows ACP fixes either
that failure or the later `account/read` blocker.

## Connection-only source gate — STATIC_GATE_BLOCKED

A subsequent connection-only task authorized one handshake, conditional on source
inspection, with no retry or fallback. **No connection test was implemented or
launched.** The installed package versions still match the table and lockfile.
The command symlink resolves to this experiment's installed
`@agentclientprotocol/codex-acp/dist/index.js`; the planned child cwd is this
experiment's `.local/fixture-cwd/` (not created). `INITIAL_AGENT_MODE=read-only`
and `mcpServers: []` remain planned, unapplied settings. Parent-environment
inheritance and inherited MCP authority remain unaudited; no environment values
or private configuration/auth files were read.

Installed-source trace (paths below are relative to this directory):

- Provider `node_modules/@mcpc-tech/acp-ai-provider/index.mjs:2200` constructs the
  provider; `:2118` calls `connectClient()` directly. `:1051–1122` spawns the
  configured command and awaits ACP `initialize`; it does not call lazy auth,
  `initSession`, `session/new`, prompt APIs or permission selection. Its nested
  `@agentclientprotocol/sdk/dist/acp.js:436` sends one initialize request.
- Adapter `node_modules/@agentclientprotocol/codex-acp/dist/index.js:54222`
  starts the App Server and constructs the ACP router. `:28097` selects bundled
  Codex unless `CODEX_PATH` is inherited. No override was supplied or inspected.
  `:49695–49708` handles ACP initialize, calls `ensureAppServer()`, then forwards
  native initialize through `:41138` and `:42913`.
- **Blocking retry path:** adapter `:51092` delegates `ensureAppServer()` to
  recovery `ensureRunning()` (`:44020`). If the initial App Server has died,
  it calls `respawn()` (`:44288`), then `restart()` (`:44308`), which reaches
  `spawnClient()` (`:44251`, called at `:44331`) and supervisor `spawn()` (`:44660`). Thus one public
  `connect()` invocation can relaunch the native process before initialization.
  This is a conditional, source-derived recovery path, **not an observed crash
  or retry**. No public provider setting disables it. The no-retry constraint
  cannot be established with the permitted public interface and unchanged
  adapter configuration, so the static gate stops the launch.
- No explicit login, authentication or token-refresh call was found on this
  connection path. There is an **explicit post-response status read**, beyond
  the handshake: `:49708` schedules `publishFirstAuthStatusAfterResponse()`
  (`:51201`), which reaches `readAgentAuthIdentity()` (`:51238`), possibly
  `config/read` (`:41518`) and `getAccount()` (`:41488`, `refreshToken: false`).
  These are status reads, not token-refresh requests. Incidental Codex-managed
  state reads/network behavior are not established by this JavaScript trace.

Observed process/handshake outcomes: **NOT RUN**; cleanup **NOT NEEDED**.
Session requests and model-turn admissions: **0**. No runtime session ID exists
to inspect. No `connect-evidence.json` was created because the conditional
implementation/launch gate was not satisfied. Typecheck, lint and diff checks
passed; no dependencies or lockfile changed. The preexisting timing-only edit
to `preflight-evidence.json` was preserved. `preflight` remains blocked and
`trial` remains fail-closed; neither command was executed for this diagnostic.
Tool isolation, permission denial, session startup, image delivery, context
retention and structured proposals remain untested.

**Single next action:** review whether the adapter's conditional pre-initialize
process respawn is acceptable for a future, separately authorized connection-only
invocation. The current no-retry authorization was not used to launch anything.
