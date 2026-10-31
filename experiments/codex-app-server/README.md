# Phase 1 direct App Server fixture spike — INCONCLUSIVE

Date: 2026-10-30. Starting and finishing committed main:
`a4a7680e82544659fd36a9304556f4fac57b9cf3`.
Branch: `experiment/codex-app-server-loop`.
Worktree: `/Users/mike/projects/doom-decisions-app-server`.
No commits, staging, pushes, merges, production edits, Doom execution, browser,
lease connection, or Decisions requests. Main remains clean; the experimental
checkout has only the untracked `experiments/` addition. Git's existing checkout
hook copied six ignored local tooling/config inputs into the new worktree; they
were left intact and not executed by this proof. Its source is
`scripts/setup_worktree.mjs`.

## Result and narrow blocker

**Zero inference turns were admitted. No thread was created.** The hypothesis
therefore remains untested, rather than disproved. `account/read` failed with
JSON-RPC `-32603`: **“failed to load workspace requirements: invalid data”**.
There was no login/approval request, and no login, credential inspection/copying,
configuration repair outside this experiment, or inference workaround was tried.
The final zero-inference diagnostic exited cleanly on stdin EOF, code 0, no
signal, in 111 ms. See `preflight-evidence.json` for its correlated ledger.

Recommendation: **fix the demonstrated account/workspace-requirements loading
blocker, then rerun the zero-inference preflight**. Do not loosen permissions or
copy credentials to get past it. No further App Server runs were made after the
final diagnosis. A future two-turn fixture trial is separate and unexecuted;
future live Doom integration is also separate and unexecuted.

## Toolchain and protocol provenance

Observed: `codex-cli 0.166.0`, Node `v22.20.0`, npm `10.9.3`, TypeScript `7.0.2`,
Biome `2.5.15`. Existing main-checkout TypeScript/Biome executables were used
read-only; app manifests and dependencies were not changed. The only essential
isolated added dependency is dev-only `@types/node` **22.20.0**, with
`undici-types` pinned transitively by this experiment's package lock. There is no
runtime package dependency. Auth uses Codex's normal existing account path;
the host does not request token/auth-status secrets.

Official rolling docs retrieved on this date:

- [App Server](https://developers.openai.com/codex/app-server), redirected to
  [ChatGPT Learn](https://learn.chatgpt.com/docs/app-server).
- [Configuration reference](https://developers.openai.com/codex/config-reference),
  redirected to [ChatGPT Learn](https://learn.chatgpt.com/docs/config-file/config-reference).

Installed version-specific TypeScript and JSON schemas were generated with
`codex app-server generate-ts --experimental` and `generate-json-schema
--experimental` into ignored `.local/protocol` and `.local/schema`. Relevant
0.166.0 generated TypeScript SHA-256 identities:

| File under `.local/protocol/v2/` | SHA-256 |
| --- | --- |
| `UserInput.ts` | `c033ab3da70c17ceae32e8b4770a2557f8ef9f59c07c5419387a45c55193fc59` |
| `ThreadStartParams.ts` | `dc8bebec4181a5502fc141b0122cc48e066b3b5c77d9fd2a4de875fcd6d66a68` |
| `TurnStartParams.ts` | `64583b9d553a89984453ed0de44651728b57dd4fd51dfad0f6ceedccee823b9a` |

Compatibility findings from static protocol inspection and zero-inference calls:

- Inline `{type:'image',url:'data:image/png;base64,...'}` and per-turn
  `outputSchema` exist in installed types, but neither was exercised by inference.
- Installed `UserInput` text includes `text_elements`; sandbox uses
  `{type:'readOnly',networkAccess:false}`. Rolling docs include additional read
  access fields absent from these installed types. The runner uses installed
  shapes, not those newer examples.
- `disabledPluginIds` explicitly does not yet filter capabilities in the installed
  response documentation. This is not used as an isolation mechanism.
- Built-in `model_providers.openai` overrides are rejected by 0.166.0. A named
  `fixture-openai` Responses provider with `requires_openai_auth=true` and both
  retry counts zero passed configuration loading. Its actual inference/auth
  routing is **unverified** because of the prerequisite failure.
- CLI `-c` MCP key components must be passed as bare, validated identifiers here.
  Quoted names created spurious transport-less entries and produced “invalid
  transport”. This was a host bug, not proof of a stdio limitation. Default stdio
  initialization subsequently succeeded.
- `features.code_mode` normalizes to an object; the runner sets `.enabled=false`
  and clears inherited `direct_only_tool_namespaces`. `tools.view_image` was
  reported ignored; the installed `features.view_image=false` flag replaces it.

## Isolation evidence and limits

`config/read` returned read-only sandbox mode, approval policy `never` (deny
interactive escalation; not automatic approval), reviewer `user`, disabled web
search, and disabled shell/unified execution, hooks, apps, plugins, remote
plugins, multi-agent, code mode/host, goals, memories, browsers/computer use,
image generation, skill search/dependency installation, shell snapshots, daemon
autostart, sleep and unbounded connection retries. Provider request and stream
retry counts were both 0. Project instruction byte budget was 0.

The CLI inventory found **four inherited MCP servers**. The host overrides each
server's `enabled=false` by name, rather than assuming an empty map erases merged
configuration. Effective `config/read` confirmed all four disabled. An inherited
Doom namespace hint was found during configuration checking and explicitly
cleared. No server commands, URLs, environment values or credentials are
persisted in the host ledger.

The child cwd is the empty `.local/fixture-cwd`; log and SQLite runtime directories
are redirected under `.local/`, confirmed by configuration. The runner requests
no environments, dynamic tools or selected capability roots. Planned thread
checks require matching cwd/roots, read-only/no-network policy, denied approvals,
no loaded instruction sources, and an empty complete thread-runtime MCP inventory.
**Those thread/runtime checks were never reached.** This is configured isolation,
not proof of tool exclusion, OS enforcement or a security boundary. No global
Codex settings or installation were changed. Normal Codex-managed authentication
internals and potential incidental CLI caches were not audited.

Observed model tool executions: **0**. Server approval/auth/tool/input requests:
**0**. Last diagnostic stderr bytes: **0**. No thread ID, turn IDs, turn terminal
statuses, proposals, usage/token figures or charges are available. Zero inference
turn admissions do not establish that all prerequisite networking was offline.
The final ledger records initialize, config/read and failed account/read only.
Earlier zero-inference configuration diagnostics are summarized above; the JSON
is the last diagnostic, not a cumulative ledger of every bootstrap attempt.

## Deterministic fixtures and evaluation

Both checked-in PNGs are 640×400 RGB, generated by about 70 lines of Node-only
flat-shape/PNG code. They were visually inspected locally. This local inspection
is **not App Server model vision evidence**. Expected markers are never put into
turn text or output-schema descriptions; the host assesses them after completion.

| Fixture | Expected scene | Model observation |
| --- | --- | --- |
| A | Red circle upper left; blue square upper right; green triangle lower left | Not submitted |
| B | Green triangle upper right; blue square lower left; red circle lower right | Not submitted |

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `fixture-a.png` | 2195 | `59598686d50e9a65fc29f2c303d7b47dfb977b07a21174013d3ab7a72b8cfd76` |
| `fixture-b.png` | 2198 | `a339a39d477c51e74d1e46aa061939f539c207532060a873451e9b15ae27e03e` |

The unexecuted trial sends real PNG bytes inline and explicitly synthetic,
unverified DTO fields. A contains a short arbitrary nonce. B supplies neither
that nonce nor A's target/history; it submits the new image on the same thread
ID. The host compares exact nonce and first-target recall separately from the
current-image marker triples/quadrants. This would test in-process conversation
retention: `ephemeral:true` avoids saving a rollout while reusing one live thread.
It does **not** test disk persistence, restart or thread/resume. If durable
persistence is required, this runner does not prove it.

The native schema requests the six proposal fields. `recommendedInstruction` is
required-but-nullable there to accommodate strict-output conventions, and
optional-or-nullable in the independent host validator. Host validation checks
required/extra keys recursively, nonempty bounded strings, total 8192-byte bound,
markers, integer tics 1–35 and terminal status `completed`. It conservatively
rejects any low-level action token in the entire JSON, including ordinary uses
of ambiguous words such as `use`; false rejections are possible. It never applies
proposals. JSON validity alone cannot establish visual accuracy or safety.

## Commands and checks

From the existing prepared worktree, **offline only**:

```sh
cd /Users/mike/projects/doom-decisions-app-server/experiments/codex-app-server
npm run fixtures
npm test
node /Users/mike/projects/doom-decisions/app/node_modules/typescript/bin/tsc -p .
/Users/mike/projects/doom-decisions/app/node_modules/.bin/biome lint ./*.ts
```

All four completed successfully after the final code changes: six unit tests,
strict typecheck, lint, deterministic fixture generation. Tests cover validation,
failed/interrupted status rejection, thread/turn terminal correlation, out-of-order
response IDs, and separate image/context scoring. No test calls Codex or pretends
a mocked image answer proves inference. `git diff --check` passed in both
checkouts; new files were also checked for trailing whitespace. No app-wide
check/build or live gameplay was run. Rough authored TypeScript size: **439 lines**,
including tests; generated protocol/schema output and dependencies are excluded.

To restore only this experiment's pinned type dependency if needed:

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache .local/npm-cache
```

**Not offline**, zero inference; rerun only after the demonstrated prerequisite
blocker is resolved:

```sh
npm run preflight
```

**Optional inference trial, NOT RUN in this task:**

```sh
npm run trial
```

It independently rechecks preflight and can admit at most two sequential turns.
An exclusive `.local/trial-started` marker prevents a repeat in this worktree.
There are no host retries. Provider HTTP/stream retries are configured to zero.
The turn-completion wait is 120 seconds after the turn/start acknowledgement;
RPC acknowledgement timeout is 20 seconds. These are host waiting bounds, **not
hard inference, billing, model-token or remote-processing limits**. On failure it
attempts interruption when a turn ID is known, then stdin EOF, with bounded
SIGTERM/SIGKILL fallback and recorded child exit. Timeout/unknown completion or
unexpected tool activity stops the trial; it does not admit another turn.

## Exact additions

All additions are under `experiments/codex-app-server/`:
`README.md`, `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`,
`fixtures.ts`, `fixture-a.png`, `fixture-b.png`, `proposal.ts`, `rpc.ts`, `runner.ts`,
`proof.test.ts`, `preflight-evidence.json`. Ignored `.local/` holds generated
protocol/schema files, local npm cache and CLI runtime state; ignored
`node_modules/` holds only the two installed type packages. No trial evidence file
or trial-started marker exists because the live trial was not admitted.
