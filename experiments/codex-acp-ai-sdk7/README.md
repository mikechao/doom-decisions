# ACP + AI SDK 7 comparison — BLOCKED before process startup

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

**Recommendation / single next experiment:** investigate a published provider
API/version that exposes fail-closed permission handling and disables automatic
authentication/retry, then rerun zero-inference connect/session preflight with
sanitized output. Do not authorize the image trial on the present evidence.
Synthetic vision/context results, even if later successful, would not establish
Doom gameplay or navigation success.
