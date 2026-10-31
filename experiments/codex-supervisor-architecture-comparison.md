# Codex supervisor: prototype comparison and decision

**Status: provisional prototype choice · 2026-10-31.** Continue with **AI SDK 7 +
`codex-acp`** for the next prototype; retain **direct Codex App Server** as a
reference/fallback. This is **not approval for autonomous Doom integration or
production use**.

## Scope and evidence

Read-only inspection started on `experiment/codex-app-server-loop` with a clean
working tree and no relevant diffs. No experiments were rerun for this record.
Paths below are relative to this document in `experiments/`.

**ACP:** [codex-acp-ai-sdk7/trial-evidence.json](codex-acp-ai-sdk7/trial-evidence.json)
records **PASS**: two attempted/admitted/completed inference turns, total elapsed
**12,716 ms**. Both images' markers matched and both proposals passed host
validation in the same session. B recalled `m7Q-violet` and A's exact target,
`blue square in the top-right quadrant`. Here, “admitted” means provider-call
start, not an independent remote-acceptance receipt. Versions recorded there and
in [package-lock.json](codex-acp-ai-sdk7/package-lock.json): `ai` **7.0.159**,
`@mcpc-tech/acp-ai-provider` **0.3.9**, `@agentclientprotocol/codex-acp` **2.5.0**,
bundled `@openai/codex` **0.165.0**, nested `ai` **6.0.320**. This demonstrates
the tested generation path across those versions, not general compatibility.

**Direct:** [codex-app-server/preflight-evidence.json](codex-app-server/preflight-evidence.json)
records **INCONCLUSIVE**, using `codex-cli 0.166.0`: `initialize` and `config/read`
succeeded; `account/read` failed with JSON-RPC **-32603**, “failed to load
workspace requirements: invalid data”. Inference admissions were **0**; no thread
was created, so thread isolation and image inference remain **UNVERIFIED**.

**Discrepancy and environment:** [ACP README](codex-acp-ai-sdk7/README.md) still
reports failed connection/inference startup and untested generation. Current
[connect-diagnostic-evidence.json](codex-acp-ai-sdk7/connect-diagnostic-evidence.json)
instead records **CONNECTED**, and the trial records **PASS**. Earlier failures
are preserved in ignored local artifacts
[.local/diagnostic-archive/connect-diagnostic-1-evidence.json](codex-acp-ai-sdk7/.local/diagnostic-archive/connect-diagnostic-1-evidence.json)
and [.local/diagnostic-archive/trial-evidence-initial-failure.json](codex-acp-ai-sdk7/.local/diagnostic-archive/trial-evidence-initial-failure.json).
The user identifies those failures as Codex-environment runs and the successes as
regular macOS terminal runs; JSON does not independently attest the launch
environment. The exact denied operation/root cause remains **UNVERIFIED**.
The historical [preflight-evidence.json](codex-acp-ai-sdk7/preflight-evidence.json)
is a static **BLOCKED** permission-boundary check, not a failed inference trial.

The ACP README also reports a separate stock App Server probe exiting before
`initialize`, cause unknown. The user reports a separate ordinary Codex CLI
two-image success; no corresponding artifact was located in these experiments,
so it is **UNVERIFIED here**. Neither is the configured direct runner's result.

| Dimension | Direct App Server | AI SDK 7 + `codex-acp` |
| --- | --- | --- |
| Startup / real two-image inference | Configured preflight reached account error; inference UNVERIFIED. | Connection and two-image trial succeeded; synthetic fixtures only. |
| Session / vision / validation | Same-thread design exists; unexecuted. | Same-session marker matches, exact recall and host-valid JSON demonstrated; restart/resume UNVERIFIED. |
| Owned code / dependencies | Host owns RPC correlation, configuration checks and child lifecycle; no runtime package dependency. | Smaller authored integration through public provider APIs; reuses sibling validation/fixtures, adds SDK/provider/adapter and bundled Codex layers. |
| Output constraints | Runner requests native per-turn `outputSchema` plus host validation; enforcement UNVERIFIED by inference. | Schema is prompt guidance plus host validation; no native schema enforcement. |
| Tools / permissions | Effective configuration restrictions confirmed; runtime isolation UNVERIFIED. RPC host denies server requests. | Provider auto-selects first permission option; read-only mode and empty MCP list do not prove isolation. |
| Observability / usage | RPC ledger exists; no inference usage collected. | **0 observed AI SDK tool calls**; internal Codex tools/permissions **NOT_OBSERVABLE**, not proven zero. Usage `null`. |
| Lifecycle | Recorded child exit after stdin EOF; descendant exit UNVERIFIED. | Public cleanup returned and cleared local session state; descendant exit UNVERIFIED. |
| Environment | Account blocker in tested configuration; stock-probe cause unknown. | Terminal success does not resolve prior execution-environment failure or prove portability. |

Source basis: direct [README](codex-app-server/README.md),
[runner.ts](codex-app-server/runner.ts), [rpc.ts](codex-app-server/rpc.ts),
[proposal.ts](codex-app-server/proposal.ts); ACP [runner.ts](codex-acp-ai-sdk7/runner.ts),
[preflight.ts](codex-acp-ai-sdk7/preflight.ts),
[diagnose-connect.ts](codex-acp-ai-sdk7/diagnose-connect.ts) and README's installed-source
findings. Local installed provider `node_modules/@mcpc-tech/acp-ai-provider/index.mjs`
confirms first-option permission selection; adapter
`node_modules/@agentclientprotocol/codex-acp/dist/index.js` confirms read-only uses
`on-request` approvals and an empty MCP list preserves existing configuration.
Both paths are under `experiments/codex-acp-ai-sdk7/`.

## Why this choice; when to revisit

ACP has the demonstrated two-image session and lower authored integration code
for those capabilities. Raw LOC does not prove maintainability: the direct runner
owns more safeguards and observability. Its blocked test does not disprove the
approach, and the versions/configurations differ.

Revisit direct App Server if permission denial/interception, inherited MCP/tool
authority isolation, native output constraints, usage reporting, dependency
compatibility (top-level V7 with nested V6), or verified process teardown become
blockers. ACP's public API has no permission interception callback; prompts and
post-response validation cannot establish an execution boundary. Neither experiment
demonstrates live Doom integration.

## Next smallest experiment

Under separate runtime authorization, pass **one real, verified Doom observation**
— screenshot pixels, matching telemetry and verified map identity — to ACP for
**one host-validated advisory proposal only**. Test whether it grounds a high-level
target, uncertainty and next question in real evidence. Reject invalid output or
unsupported claims; no autonomous provider actions, settings writes, browser/game
authority changes or loop.

Follow the authority split in
[docs/architecture/doom-decisions-play-loop.md](../docs/architecture/doom-decisions-play-loop.md)
and [.agents/skills/doom-decisions/SKILL.md](../.agents/skills/doom-decisions/SKILL.md):
the application retains lease/budget, freshness/revision, Stop and native/frame
verification; the Decisions provider selects low-level actions. Real-observation
proposal validation and effective permission/tool boundaries must be established
before live operation. A successful advisory answer would test grounding, not
authorize gameplay or prove safe autonomy.
