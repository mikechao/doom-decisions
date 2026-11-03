# ACP vs native CLI provider: SDK 7 comparison

## 1. Executive answer

**Yes: the isolated CLI probe eliminates AI SDK 6 from both its locked dependency closure and its inspected installed SDK tree.** It uses `ai@7.0.159`, provider interface v4 and provider-utils v5 throughout; the ACP experiment still locks nested `ai@6.0.320` and provider v3 alongside v4. The concrete gain is a native SDK 7 model/middleware boundary and an observed SDK-owned callback/result/continuation loop, without rebuilding SDK 6 provider-tool descriptors or initializing ACP tool sessions. This does not remove SDK 6 from the repository or replace the ACP-backed `DoomPlayAgent`; the ordinary browser app is a separate package with no locked `ai` dependency. The CLI path retains substantial adaptation through Hermes text parsing and App Server stateless transcript conversion, and one clean synthetic JSON completion establishes neither reliable finalization nor Doom parity. **Recommendation: RUN ONE NARROWER CHECK**, an offline native-event visibility negative control, while leaving the working ACP integration in place.

### Audit state and boundaries

Inspected on 2026-11-03 in `/Users/mike/projects/doom-decisions-codex-cli-ai-sdk7`:

| Preflight command | Actual outcome |
| --- | --- |
| `pwd` | Expected worktree above; exit 0 |
| `git branch --show-current` | `experiment/codex-cli-ai-sdk7`; exit 0 |
| `git rev-parse HEAD` | `dc8ccf62ecaa4156520c965dc83e31a79a45eb4d`; exit 0 |
| `git status --short` | Empty initially; exit 0 |

This investigation ran only file/source inspection, dependency metadata/resolution queries, `npm ls`, and non-writing diff checks, and created this report. No tests, typecheck, installation, model calls, ACP/App Server subprocess, server, browser, game, SQLite operation, build, commit or push was run. Saved live artifacts are historical local evidence, not new inference or independently authenticated execution records.

Paths below are repository-relative. For readability, **A** means `experiments/codex-acp-ai-sdk7`, **C** means `experiments/codex-cli-ai-sdk7-probe`, **P** means `C/node_modules/ai-sdk-provider-codex-cli/dist/index.js`, and **H** means `C/node_modules/@ai-sdk-tool/parser/dist/src-CnSA-Gcf.js`. Installed/ignored files may be absent in another checkout.

## 2. Dependency evidence

Both experiments currently have their **own** `package.json` and lockfile v3; neither is an npm workspace of a root package. ACP has no local `node_modules`, nor is there a root install to supply it. Resolution from its package scope failed with `MODULE_NOT_FOUND` for `ai` and the ACP packages. The launcher explicitly checks `A/node_modules` versions and launches `A/node_modules/.bin/codex-acp` (`A/src/main.ts:266`, `:292`). Its separate compiler check references `app/node_modules/typescript`; that does not redirect bare runtime imports into the app installation. Thus its intended closure is verifiable from its lockfile, but an operational installed ACP runtime cannot be verified here.

| Package / role | ACP path: declared and resolved | CLI probe: declared and resolved | Installed / runtime evidence |
| --- | --- | --- | --- |
| `ai`: SDK agent, stream and tool APIs | Direct **7.0.159**; ACP provider additionally depends on `ai: ^6.0.0`, resolving nested **6.0.320** | Direct **7.0.159**; sole locked `ai` entry | ACP unavailable on disk; CLI installed **7.0.159**, ESM resolves to `C/node_modules/ai/dist/index.js` |
| `@ai-sdk/provider`: model interface | Transitive **3.0.19** at ACP package root; **4.0.35** nested under top-level `ai` and gateway | Transitive/peer **4.0.35**, deduplicated | CLI installed v4 only in `npm ls`; directly type-imported by `parser-smoke.ts:9` |
| `@ai-sdk/provider-utils`: schema/provider helpers | Transitive **4.0.63** for SDK 6/ACP; **5.0.72** for SDK 7 | Transitive/peer **5.0.72**, deduplicated | CLI installed v5; runtime helper dependency of SDK/provider/parser peer resolution |
| `@mcpc-tech/acp-ai-provider`: ACP adapter, callback registration and provider events | Direct **0.3.9**; dependencies include provider `^3.0.0`, utils `^4.0.0`, `ai ^6.0.0` | Absent from lock and install resolution | Runtime import in `A/src/main.ts:7`, `doom-play-agent.ts:2`; missing locally |
| `@agentclientprotocol/codex-acp`: Codex ACP executable | Direct **2.5.0**; locks `@openai/codex` **0.165.0** | Absent | Launched executable, rather than a TS import, on ACP path; not installed here |
| `ai-sdk-provider-codex-cli`: native App Server model provider | Absent | Direct **2.4.0**; dependencies provider `^4.0.0`, utils `^5.0.0`; Zod peer `^4.1.8` | Installed **2.4.0**, imported by `C/parser-smoke.ts:11`; ESM resolves to its local `dist/index.js` |
| `@ai-sdk-tool/parser`: Hermes v4 middleware | Absent | Direct **5.1.6**; peers provider `^4.0.0`, utils `^5.0.0`; dependencies resolve `dedent` **1.7.2**, `yaml` **2.9.1** | Installed **5.1.6**, imported by `C/parser-smoke.ts:8`; local ESM entry verified |

Lockfile source pointers: `A/package-lock.json:21` (codex-acp), `:111` (provider v3), `:123` (utils v4), `:153` (ACP adapter), `:192` (nested SDK 6), `:434` (SDK 7), `:451` / `:463` (v4/v5); `C/package-lock.json:24` (parser), `:58` / `:70` (v4/v5), `:589` (SDK 7), `:606` (CLI provider). The version numbers of `ai`, provider and provider-utils are different versioning schemes: provider **4** is the SDK **7** interface, not another SDK major.

Peer details matter: `ai@7.0.159` and utils v5 accept Zod `^3.25.76 || ^4.1.8`; CLI's direct `zod@4.6.7` satisfies those and the CLI provider's peer. The ACP adapter's SDK/provider/utils requirements are **dependencies**, not unsatisfied SDK 7 peers; its nested SDK 6 is intentional resolution, not an npm warning. It also depends on Zod `^3.24.2`. The two ACP protocol SDK dependencies differ: codex-acp requires `@agentclientprotocol/sdk ~2.1.0`, while the adapter requires `^0.14.1`. Those boundaries are absent from C.

Read-only commands and interpretation:

- In **C**, `npm ls ai @ai-sdk/provider @ai-sdk/provider-utils @ai-sdk-tool/parser ai-sdk-provider-codex-cli --all` exited **0**, showing SDK 7, provider **4.0.35** and utils **5.0.72**, deduplicated across SDK/gateway/provider/parser. No peer warnings appeared. All matching entries in the complete lockfile `packages` map were also enumerated: exactly one `ai`, version 7; no `ai@6`, ACP adapter or codex-acp entry.
- In **A**, `npm ls ai --all` exited **1**, reporting `(empty)`. Missing installation makes that result uninformative about the locked closure; it is **not** evidence of SDK 6 removal. `ls -ld` likewise reported missing ACP/root/App Server experiment installations.
- Targeted installed package JSON reads verified C's versions and peer ranges. ESM `import.meta.resolve()` verified its actual import entries without importing/executing them. An initial CommonJS `createRequire().resolve()` returned `ERR_PACKAGE_PATH_NOT_EXPORTED` for provider/parser because they expose an `import` entry without a `require` entry; the subsequent successful ESM resolution avoids mistaking that for a missing package.
- Cross-scope lockfile enumeration found SDK 6 still in **A**, SDK 7 alone in **C**, and no `ai` entry in `app/package-lock.json` or `experiments/codex-app-server/package-lock.json`. There is no single repository-wide installed npm tree to declare clean. `app/package.json` uses the OpenRouter/OpenAI Decisions clients separately; the CLI probe has changed neither that app nor the actual ACP-backed agent.

C's provider optionally depends on `@openai/codex ^0.156.1`; the documented install omitted optional packages, while the live source selects an existing external Codex executable (`C/parser-smoke.ts:545`). This external process/configuration boundary is outside the npm closure claim. Dependency cleanliness does not imply a hermetic runtime.

## 3. Control-flow comparison

### ACP-backed DoomPlayAgent

```text
main: attach -> verified observation/PNG -> separate parent + child providers
  acpTools(callbacks) -> original registrations -> provider.initSession()
  rebuilt SDK 7 descriptors -> parent ToolLoopAgent.stream()
    ACP/Codex internal turn chooses MCP tool
      -> adapter delivers host callback
         consultLandmarks -> child ToolLoopAgent -> child ACP findLandmarks callback
         executeGuardedDecision -> guarded controller/Decisions path
      <- explicit MCP text envelope <- host callback
    <- dynamic provider-executed tool events + final text
  drain/correlate events -> validate final JSON/receipts -> cleanup owners
```

`A/src/main.ts:89` allocates two owners; `:135–156` builds tools, applies the bridges and initializes both sessions with the **original** ACP registrations. `rebuildParentTools()` (`A/src/doom-play-agent.ts:78`) and `rebuildSmokeTools()` (`A/src/find-landmarks-acp-smoke.ts:58`) check the dynamic descriptor shape, recreate its schema with SDK 7 `jsonSchema()`, and mark it `isProviderExecuted: true`. These are bounded structural descriptor bridges, not a rewritten provider implementation. The top-level SDK still orchestrates agent calls, streams and completion, but **does not execute these host callbacks via its ordinary tool executor**: ACP/Codex chooses the tool and the adapter delivers the callback through its registered ACP/MCP path. Installed ACP internals cannot be reread here; this boundary is supported by the registration/session wiring, dynamic provider descriptor and explicit callback simulation in `A/tests/doom-play-agent.test.ts:43`.

The parent consultation callback starts/drains the child stream, validates its completion/selection and context, and returns an explicit MCP envelope (`A/src/doom-play-agent.ts:23–72`). ACP provides no callback abort options there; cancellation is host-closure-owned. The child uses `ToolLoopAgent`, zero SDK retries and `isStepCount(2)` (`A/src/landmarks-tool-loop-agent.ts:16`). The parent uses two or three permitted SDK steps (`A/src/doom-play-agent.ts:94`), with separate request counters in `main.ts:130`. **These limits do not bound ACP's internal tool loop**, which can complete callbacks and final text inside one SDK request/step (`A/README.md:127`). `prepareStep` was already an SDK 7 API available to this top-level agent; replacing the provider does not invent it or make it intercept internal ACP actions.

`A/src/agent-stream.ts:55–82` correlates the outer dynamic tool ID/name with the inner MCP title/ID, rejects duplicates/orphans and compares actual envelopes to host receipts. `main.ts:177–203` checks counts, completion metadata, stable distinct sessions and grounded final output. The guarded gameplay callback independently owns one-shot admission, lease/budget claim, prompt CAS, unchanged fresh observation, dispatch, receipt/frame validation and final accounting (`A/src/guarded-decision.ts:94–195`). The model's advisory text does not select the low-level action or tics.

`A/src/agent-lifecycle.ts:10` fences late initialization/auth continuations and requests late cleanup. `main.ts:221` owns cleanup, but neither session clearing nor public cleanup proves subprocess exit or releases browser ownership. These are real safety/lifecycle responsibilities, not merely SDK-version workarounds.

### CLI/Hermes synthetic probe

```text
ToolLoopAgent (SDK 7, getProbeMarker.execute)
  step 1 auto -> Hermes schemas/history as text, provider tools=[]
    -> native v4 App Server provider -> fresh ephemeral thread -> Codex text
    <- Hermes parses <tool_call> -> ordinary SDK tool-call
  SDK validates input -> execute() once -> structured SDK tool-result
  prepareStep(1): replace instructions, toolChoice=none, append completion request
  Hermes: call history as text + result as user <tool_response>
    -> provider flattens stateless history -> fresh ephemeral thread -> final text
  SDK finishes second step; host validates counts, identity and exact returned values
```

The actual construction is `C/parser-smoke.ts:642–657`: `wrapLanguageModel()` with Hermes outside a provider observer, `ToolLoopAgent`, `tool({inputSchema, execute})`, `prepareStep`, zero retries and `isStepCount(2)`. **The model chooses the text tool request; Hermes translates it; the SDK owns callback execution and continuation.** No MCP server carries `getProbeMarker`. The older `C/probe.test.ts:7` instead tests a separate local MCP callback transport and is not the live parser path.

The installed SDK confirms that ownership: `C/node_modules/ai/dist/index.js:7750` queues executable tools only when `providerExecuted !== true`, then runs `executeToolCall()` and emits its result at model-call completion (`:7813–7844`). Its streaming step path applies `prepareStep.instructions` at `:9701` and evaluates stop conditions at `:10158`. Despite the package's CLI name, this probe selects `createCodexAppServer()`, not the separate `codex exec` model path.

Installed Hermes v4 middleware (`H:11762`) strips function descriptors from provider requests, injects schema instructions and rewrites history (`H:11642`). It parses streaming text into ordinary calls and normalizes a tool-producing finish to `tool-calls` (`H:11338`). With `toolChoice: none`, it still converts history but bypasses parsing and calls the provider stream directly (`H:11655`, `:11339`). Consequently a second-step literal `<tool_call>` can escape as **text**, as the older failed artifact demonstrates; disabling SDK tools does not force compliant final text.

The provider declares native `specificationVersion = "v4"` (`P:3906`), defaults to stateless threads (`P:3980`), and starts them ephemeral (`P:4154`). It collects SDK system messages into App Server developer instructions (`P:1043`, `:4083`), converts the full transcript and builds turn input (`P:4503–4521`). The replacement `prepareStep.instructions` (`C/parser-smoke.ts:18`) therefore matters at a higher-priority boundary than merely appending another user request. In contrast, ACP's documented conversion sends `System:` text in initial turn input, then latest-user-only subsequent turns (`A/README.md:385`); installed ACP implementation is unavailable to independently reconfirm that conversion.

The observed controls have precise limits:

- `stopWhen: isStepCount(2)`, step-start assertions and the observer's two-invocation fence bound **outer SDK/provider calls**, with zero SDK retries (`C/parser-smoke.ts:589`, `:644`). They do not independently count or prevent internal Codex actions, network retries or billing.
- `prepareStep` demonstrably changes the second request's instructions/history; `toolChoice: none` prevents another parsed SDK tool request on that path. Only `auto` then `none` was exercised live. Named/required tool-choice paths are not proven; Hermes has a separate generate-based branch and this probe rejects generate calls (`H:11343`, `C/parser-smoke.ts:591`).
- SDK-native `execute()` is evidenced by the callback ledger, matching IDs/output and no provider-executed ownership. Saved events normalize absent `providerExecuted` to **false**, with `providerExecutedEmitted: false`; an explicit false bit was not emitted on the underlying event (`C/parser-smoke.ts:673`). Ownership follows the whole execution path, not that normalized bit alone.
- Read-only sandbox/on-request approval, rejecting server-request handlers and native-event checks remain monitoring/rejection controls (`C/parser-smoke.ts:559–579`). They do not disable all native tools. Native activity can happen within a provider turn before an outer SDK control regains execution.

## 4. Removed vs introduced complexity

**Removed within C's demonstrated path:**

- Nested SDK 6 and parallel provider v3/utils v4 contracts; SDK 6-to-7 dynamic descriptor reconstruction. Strict native v4 typing can check declarations without ACP's `skipLibCheck` setting (`C/tsconfig.json:2`; `A/tsconfig.json:10`).
- ACP executable/protocol adapter, explicit ACP `initSession()` tool registration, dynamic MCP-name envelope correlation and persistent parent/child ACP session bookkeeping for this one synthetic callback. No claim that a real parent/child replacement is implemented.
- Provider ownership of this host callback: SDK now receives an ordinary tool call and can execute/record it before explicitly preparing the next outer step. The saved two-call run exercises that control seam beyond compile-time assignability.

**Introduced or retained:**

- Hermes prompt/tool-call/result serialization, parsing, finish-reason rewriting and instruction discipline. This trades a small structural shim plus ACP transport for a behavioral text protocol; it is not removal of all compatibility/translation layers.
- Stateless history flattening and per-step developer-instruction delivery. Source and traces support the instruction-conflict explanation, but a before/after pair is not a controlled reliability study.
- Codex App Server startup/auth/configuration inheritance, thread/RPC lifecycle, subprocess cleanup and incomplete native-tool visibility. `close()` signals a child without awaiting exit (`P:5296`); saved runs additionally observed exit code 0, which is narrower evidence than a general cleanup guarantee.
- All real Doom lease, Stop, budget, no-retry/uncertain-delivery, image, controller receipt and advisory-grounding requirements. C has none of that integration. No measured latency, cost, navigation-quality or reliability advantage was established; ACP and CLI live configurations also use different model selections.

## 5. Proof matrix and measured evidence

Status meanings: **PROVEN** is a deterministic property of inspected code/metadata for the stated scope; **OBSERVED ONCE** is a bounded saved or explicitly attributed historical result; **NOT PROVEN** means the required behavior lacks sufficient evidence; **INCONCLUSIVE** means observations cannot settle it; **NOT APPLICABLE** means the architecture does not use that execution path. No status implies tests were rerun for this investigation.

| Question | ACP path | CLI probe |
| --- | --- | --- |
| SDK dependency closure | **PROVEN** mixed SDK 7 + nested SDK 6 in lock; installed tree unavailable | **PROVEN** SDK 7 alone in C's lock and inspected installed SDK tree; no repository/runtime-wide claim |
| Strict SDK 7 typecheck without bridge | **NOT APPLICABLE** to unchanged ACP bridge; config uses `skipLibCheck` | **OBSERVED ONCE**, reported in `C/PARSER-SMOKE.md:83–109`; current strict config/native-v4 fixture inspected, compile not rerun and compiler stdout absent |
| SDK-owned tool execution | **NOT APPLICABLE** to these ACP callbacks; provider-executed path | **OBSERVED ONCE** in latest saved run: one callback, matching ordinary SDK call/result |
| Tool result synthesis in model output | **NOT PROVEN** as a dependable real Doom finalization contract; provider callback/receipt path exists, finalization failures reported | **OBSERVED ONCE**: final exact marker/note ID and full result in second provider history |
| Reliable output formatting | **NOT PROVEN**; owner reports guarded-action success followed by JSON/final validation problems | **OBSERVED ONCE** clean two-key JSON; reliability **NOT PROVEN**, earlier saved run failed |
| Native-tool isolation / exhaustive visibility | **NOT PROVEN**; prompt restrictions and read-only mode are not isolation | **INCONCLUSIVE**: zero recognized native signals / mapped calls, but 23 and 20 unclassified chunks and upstream filtering |
| Real Doom parity | **OBSERVED ONCE**, owner-reported guarded `forward`, 6 verified tics, tic 1→7; raw receipt absent here | **NOT PROVEN**: no Doom, image, memory, Decisions or guarded receipt integration exercised |

### Saved CLI artifacts independently inspected as files

`C/.smoke-local/live-report.json` records one agent run, **2 model calls, 2 SDK starts, 2 completed steps, 2 turn starts**, drained stream and **1 callback**. The first completed SDK step is `tool-calls`, the second `stop`; exactly one call/result pair shares its ID/name/input and the result equals callback output. Both provider requests contain zero forwarded tools; the second contains the exact `<tool_response>` data. This audit parsed the final text as JSON and compared both values to callback output: both matched. It does not reproduce the private prompt or identifiers here.

The same artifact reports **FAIL solely at the visibility assertion**, after functional assertions (`C/parser-smoke.ts:698–729`). Raw observations were **57 = 34 recognized + 23 unclassified** and **79 = 59 + 20**, with zero recognized native/retry signals and provider metadata zero mapped tool calls on each invocation. Thus functional success and observability inconclusiveness must be reported separately. `rawEvidenceIssue()` returns a nonempty caveat even for fully classified filtered events (`C/parser-smoke.ts:102–108`): the present PASS criterion cannot certify exhaustive visibility merely by improving the local classifier.

`C/.smoke-local/before-instruction-fix.MFQBsV/live-report.json` likewise records two calls/steps and one callback, with result present in second history, but `markerMatches: false`, non-JSON final text and one literal `<tool_call>` block. Its failure is missing final values, not lost host callback execution. This file verifies one earlier failure; broader intermittency remains user-reported history.

The linked before/after traces, `C/.smoke-local/trace-AiUFS4/boundary.json` and `C/.smoke-local/trace-KjVdAJ/boundary.json`, each have two invocations, zero redactions and no truncation/capture error. Both second provider request bodies contain `<tool_response>`; the earlier second provider text contains a repeated tool block, the later contains none and equals SDK-visible text. Only the later second trace has the completion-specific system/developer-instruction reconstruction. These are provider-returned request bodies and reconstructed instructions, **not intercepted RPC payloads or proof of server receipt** (`C/parser-smoke.ts:111`, `:176`). The latest trace supports the single clean completion after replacing conflicting higher-priority instructions, not a general cure for ACP finalization.

`C/PARSER-SMOKE.md:1` describes an older initialization-blocked attempt, so its live verdict is stale relative to these artifacts. Its recorded strict typecheck/dry-run pass remains historical documentation. Current dry-run source covers strict input/latch rejection, fake two-step SDK flow, raw-inclusion controls, instruction replacement and installed pure history conversion (`C/parser-smoke.ts:313–509`); the trace-specific fixture is optional (`:505`). `C/README.md:48` correctly separates the original local MCP transport test from inference. These sources were read, not executed; retained reports do not establish that every current fixture passed.

### ACP evidence limits and parity gaps

Neither `A/.local` nor `A/.smoke-local` exists here (`rg` exits 2). The guarded forward-6, tic-1→7 result is user-reported history, supported by the documented example at `A/README.md:83–110`, **not independently reverified from a raw receipt**. That example's final JSON error is illustrative diagnostic output; exact historical failure attribution remains limited (`A/README.md:120`). Separate supervisor trial summaries (`A/README.md:285`) concern another flow and cannot substitute for `DoomPlayAgent` parity.

ACP offline test source simulates provider-executed events, actual host receipt validation, duplicate/orphan rejection, late-auth cancellation and one-shot/uncertain dispatch handling (`A/tests/doom-play-agent.test.ts:43`, `:176`, `:233`; `A/tests/main.test.ts:505`, `:916`, `:938`, `:997`). Their presence establishes intended coverage, not a fresh passing suite. C's tiny synchronous marker callback has no adverse I/O, nested agent, meaningful cancellation race, hostile memory data, image delivery, Stop/lease interaction, partial native action or billable Decisions receipt. It therefore cannot establish those functional/safety contracts or solve the ACP agent's finalization problem.

## 6. Recommendation and smallest next experiment

**RUN ONE NARROWER CHECK. Keep ACP in the real Doom experiment while doing so.** SDK 6 removal is a useful dependency/type-boundary improvement, and SDK-owned callback continuation is a measured architectural gain. Neither alone justifies replacing an integration that has already reached guarded Decisions-controlled browser gameplay, which remains the project's primary goal.

The next question is: **Can native activity relevant to this probe be missed before its current observer, even when metadata says zero?** The smallest useful check is one offline source-and-fixture audit of the pinned provider's notification-to-raw/tool-event path, with no model, subprocess, server, game or database. Use a bounded fixture set: a valid same-thread passive message, a valid same-thread `commandExecution` start/completion, an approval request, an unmapped native item such as `imageView`, and foreign-thread/schema-rejected variants. Follow the installed schema admission, thread filtering, `mapTool`, raw emission and the probe classifier; require an explicit detected/dropped/unobservable outcome for each and a failing native positive control. This goes beyond the existing `rawSummary()` unit samples by testing where evidence can disappear upstream (`P:2645`, `:2908`, `:5573`).

Success means an auditable, scoped account of what the current detector can and cannot see, with functional-loop and visibility outcomes assessed independently. It **does not** mean native tools are architecturally disabled, nor can it retroactively classify payloads not saved in the live summaries. If the required boundary remains unobservable, stop this integration line at the synthetic probe and retain ACP; closing that boundary would need a separately justified transport/configuration experiment. No broad rewrite or gameplay integration is proposed or implemented here.

Final non-writing validation: `git diff --check` and the report's explicit whitespace check passed. Final `git status --short` contains only `?? experiments/codex-cli-ai-sdk7-probe/ACP-VS-CLI-SDK7-COMPARISON.md`; no existing source or lockfile was modified.
