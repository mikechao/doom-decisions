# SDK-owned parser tool smoke — BLOCKED

Run date: 2026-11-03. The central live hypothesis remains untested. One live
entrypoint invocation stopped during App Server initialization, before model
discovery, agent construction, or inference. No retry or fallback was attempted.

## Preflight and preservation

- Worktree: `/Users/mike/projects/doom-decisions-codex-cli-ai-sdk7`.
- Branch: `experiment/codex-cli-ai-sdk7`.
- HEAD: `73e041a20721fed4bfd4065e99408f55bef2bffb`.
- `git worktree list` also showed the original main worktree at the same commit.
  It was not modified.
- Initial status: only the seven existing untracked probe files; no tracked diff.
  Initial `git diff --check` passed.
- Node `v22.20.0`, npm `10.9.3`, existing Codex CLI `0.166.0` at the explicit
  local binary path used in the entrypoint. No Codex install or auto-download.
- Read-only `codex login status` returned `Logged in using ChatGPT`; this did not
  establish App Server readiness. No credential material was read or copied.
- The existing configured model was `gpt-6.1-sol`. Availability was to be checked
  with provider `listModels()` before inference, but initialization failed first.
- All original files remain. `README.md`, `native-model.typecheck.ts`, and
  `probe.test.ts` are byte-identical to preflight. Original versions of all seven
  files are retained under ignored `.smoke-local/baseline/`.

Modified baseline files: `package.json` and `package-lock.json` add only the
parser and its two new transitive packages; `tsconfig.json` includes the new
entrypoint; `.gitignore` additionally ignores `.smoke-local/`. New ordinary
files: `parser-smoke.ts` and this report. No app, engine, other experiment,
ACP integration, Doom, asset, browser, memory database, or Decisions code changed.

## Exact dependencies and installation

Direct runtime pins: `ai@7.0.159`, `ai-sdk-provider-codex-cli@2.4.0`,
`@ai-sdk-tool/parser@5.1.6`, `zod@4.6.7`. Existing compiler/type pins remain
`typescript@7.0.2`, `@typescript/typescript-darwin-arm64@7.0.2`,
`@types/node@22.20.0`, and `@types/json-schema@7.0.15`.
New lockfile resolutions are `dedent@1.7.2` and `yaml@2.9.1`.

The sole install command, from this probe directory, was:

```sh
npm install --save-exact @ai-sdk-tool/parser@5.1.6 --omit=optional --ignore-scripts --no-audit --no-fund --cache /private/tmp/doom-codex-cli-probe-npm-cache
```

It added three packages. `npm ls --depth=0` confirmed all exact direct versions.
No unrelated package resolution changed.

## Installed-source findings and implementation

The installed parser's `hermesToolMiddleware` is native v4 middleware. Its
`transformParams` removes SDK tool descriptors from the provider request, injects
schema instructions, converts assistant tool-call history to Hermes text, and
converts tool-result messages to user history containing `<tool_response>`.
The default auto stream path calls `doStream`, parses model text, emits ordinary
SDK tool calls, and normalizes a successful tool step to `tool-calls`.

The installed App Server provider exposes native `LanguageModelV4`, supports
`sandboxPolicy: 'read-only'` and `approvalPolicy: 'on-request'`, and defaults to
stateless ephemeral threads. It does not make read-only execution tool-free.
Raw notifications can be requested with `includeRawChunks`. Its tool tracker
maps native command/file/MCP/dynamic/web activity into provider tool events.
The App Server factory has no execution fallback to `codex exec` on this path.

The entrypoint uses Hermes followed by an observer directly around the real
provider model. It fences actual provider streaming invocations at two, rejects
unexpected generate calls, uses SDK `maxRetries: 0`, `isStepCount(2)`, a step
hook, and a 120-second abort deadline. The second step disables further SDK
tools while preserving Hermes result-history conversion. The callback has a
strict Zod input and one-shot latch; both unpredictable values are created
inside that callback, with no callback filesystem/network access.

It records SDK call/result identity and ownership, step reasons, exact callback
payload, final marker matches, raw method/type counts, and provider finish
metadata. It checks the exact result is present in the second provider prompt
without logging that prompt. Native tool events, approval requests, and observed
provider retries fail the probe. No MCP server or undocumented tool-disable
override is configured. Existing user Codex configuration remains inherited.

The persistent ignored `live-once.lock` prevents another invocation from
starting this smoke again. It is intentionally retained.

## Offline verification

Commands from the probe directory:

```sh
npm run typecheck
node --experimental-strip-types parser-smoke.ts --dry-run
```

The final strict typecheck passed with full declaration checking, no SDK 6
bridge, unsafe casts, suppressions, or `skipLibCheck`. The focused dry run passed
strict input rejection, the one-shot latch, sample native-event detection, and
the installed Hermes history transformation. It started no App Server or
inference. The previous MCP test was preserved and was not rerun.

Two preliminary local errors were corrected before the live attempt: a snapshot
command used an out-of-range `copyFileSync` flag and copied nothing; the corrected
snapshot preserves all baseline files. The dependency manifests were recovered
from their post-install copies by removing only the added entries, and their
SHA-256 hashes exactly matched pre-install measurements:

- Original package: `d2f494ea9dfc78ba57508634b564b8d19679ad04e616e5d5132a75c54a0fb53b`.
- Original lockfile: `c992f6da7f4f88fa82cf877d327eb2f0a38776f3d29aaa433ee34ac9e9fa853b`.

The initial typecheck rejected Zod's broad JSON-schema return type in the dry-run
fixture. Using AI SDK's typed `asSchema(inputSchema).jsonSchema` resolved this;
the second compile passed without changing Zod or weakening types.

## Single live invocation and evidence

```sh
node --experimental-strip-types parser-smoke.ts --live
```

The command exited 1. Intended configuration: configured `gpt-6.1-sol` model,
App Server transport, stateless threads, temporary empty working directory,
read-only sandbox, on-request approvals, `autoApprove: false`, raw chunks,
15-second RPC/connection timeouts, zero SDK retries, and at most two model calls.
The model was never reached or verified as available.

First startup failure, with unrelated local paths redacted:

```text
AI_APICallError: Failed to initialize codex app-server:
Request 1 failed after app-server crash:
Error: codex app-server exited (code=1, signal=null)
stderr: WARNING: proceeding, even though we could not create PATH aliases:
Operation not permitted (os error 1);
Error: failed to initialize sqlite state runtime under [local-path]
failed to initialize state runtime at [local-path]
```

This is Codex's own startup state runtime, before any model or synthetic tool
action. No auth repair, state relocation, permission escalation, model/prompt
change, transport switch, second launch, or speculative code fix followed it.

| Evidence | Observed |
| --- | --- |
| Live entrypoint invocations | 1 |
| `agent.stream()` runs | 0 |
| Provider model invocations | 0 |
| SDK step starts / completions | 0 / 0 |
| App Server turn starts | 0 |
| SDK tool calls / results | 0 / 0 |
| JavaScript live callback executions | 0 |
| Callback input / output | none |
| Final model text / marker match | none / not established |
| Raw native tool events | none; no inference ran |
| SDK finish reasons | none |

The strongest evidence is the initialization crash before even `model/list`
could finish. Absence of native tools in this attempt proves nothing about
their behavior during inference. The central SDK-owned two-step execution
hypothesis is neither proved nor disproved. Offline compatibility and previous
MCP/ACP results are not substituted for live evidence.

## Cleanup and focused self-review

The deadline was cleared, `provider.close()` resolved, and recursive removal of
the one probe-created temporary directory resolved. The invocation itself exited.
Installed source shows RPC close clears timers/pending requests/reader state,
sends SIGTERM to a referenced child, then drops the reference; it does not await
child exit. A resolved close alone is insufficient process-exit evidence.

The automatic report conservatively says `child-exit-unverified`: its dedicated
exit watcher accepts info-level expected-exit messages only. Separately, the
recorded warning says `codex app-server exited (code=1, signal=null)`. Source
inspection identifies that warning as emitted by the actual child `exit` handler
for an unexpected startup exit. Thus the startup child's exit is evidenced by
that warning, not by `close()`. No PID was exposed or independent descendant
process audit performed; no broader process-cleanup claim is made. This reporting
limitation was documented without patching or rerunning the probe.

Original-file comparisons and lockfile review confirmed isolated changes and
unchanged existing pins. Root `git diff --check` and explicit no-index whitespace
checks cover the untracked files. The final root status remains untracked probe
files only; no tracked changes, commit, push, or other Git mutation occurred.

An overly broad directory no-index whitespace check also traversed ignored
`node_modules` and reported dependency whitespace (exit 3). No dependency source
was edited. It was replaced with explicit checks of each changed/new probe file;
these emitted no whitespace diagnostics (no-index exit 1 reflects differing
files). Root `git diff --check` exited 0.

Remaining limitations from self-review: model availability and the complete live
stream path are untested; native tooling is monitored rather than disabled;
raw-event classification is protocol-dependent; SDK/provider invocation counts
cannot independently count hidden server/network attempts; error redaction is
targeted rather than a universal secret scrubber. No actual prompt/credential
was logged in this blocked attempt. No next experiment is proposed because this
attempt did not PASS.

Ignored local evidence: `.smoke-local/live-report.json`, `live-once.lock`, and
baseline copies. The JSON report is preserved exactly as emitted by the run.
