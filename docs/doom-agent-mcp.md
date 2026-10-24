# Optional local Doom MCP adapter

This is a transport-parity experiment for the existing `$doom-decisions play`
workflow. CLI remains the default and the optimized CLI-10 baseline is already
recorded by the owner. No performance or live acceptance result is claimed here.

`app/agent-mcp.mjs` imports `runAgentCli` directly. It creates no HTTP listener,
controller, grant, lease cache or budget ledger. Initializing/listing/closing the
MCP connection calls no agent operation. The existing `dev:agent` broker and
browser/controller remain authoritative; neither an MCP restart nor reconnection
renews their process allowance. The human's **Stop Agent** browser button remains
the only Stop entry point. There is no MCP Stop/reset/rearm tool.

The app-local development dependencies pin MCP server/client **2.4.0** and Zod
**4.6.7**. SDK v2 requires Node >=20; the project uses Node **22.20.0**, ESM and
native TypeScript stripping for the existing CLI imports. The server uses the
official `serveStdio` entry, including its legacy-client handshake support.
There are no startup downloads. These dependencies are not imported by the web
application or bundled into its browser/Worker modules.

## Operation parity

Every input rejects unknown keys and invalid types. File paths are absolute,
IDs use the existing agent UUID validator and revision is a nonnegative safe
integer. There are no MCP duration/model/action defaults or overrides.

| MCP tool | Inputs | Existing operation / complete output |
| --- | --- | --- |
| `doom_attach` | `{}` | `attach`; `{ownerId,pageId,epoch,leaseFile}` |
| `doom_observe` | `leaseFile` | `observe --lease`; full verified observation and local `pngPath` |
| `doom_get_config` | `leaseFile,sessionId` | `get-config --lease --session`; full configuration/revision/run result |
| `doom_get_prompt` | `leaseFile,sessionId` | `get-prompt --lease --session`; full instructions/revision/run result |
| `doom_start_run` | `leaseFile,observationId,sessionId,revision` | `start-run --lease --observation --session --revision`; full initial configuration/run result |
| `doom_set_config` | `leaseFile,sessionId,runId,revision,configFile` | `set-config --lease --session --run --revision --config-file`; full updated configuration/run result |
| `doom_set_prompt` | `leaseFile,sessionId,runId,revision,instructionsFile` | `set-prompt --lease --session --run --revision --instructions-file`; full updated instructions/run result |
| `doom_decide` | `leaseFile,observationId` plus all-or-none `sessionId,runId,revision` | `decide --lease --observation [--session --run --revision]`; full decision receipt and resulting observation/PNG |

All non-attach outputs preserve `pageId,epoch,commandId`. Configuration/prompt
outputs preserve `sessionId,revision,configuration` or `instructions`, and `run`
with every counter. Observations retain every telemetry, native/Canvas hash,
PNG hash, facing probe and previous-action field. Decisions preserve outcome,
reason, input observation ID, SDK invocation, action, all requested/reported/
verified/cumulative tics, uncertainty, provider/model/usage metadata and the
complete after-action observation. No fields are summarized or removed.
The source of truth is [the shared CLI](../scripts/doom-agent.mjs),
[observation/decision DTOs](../app/src/agent-observation.ts) and
[configuration DTOs](../app/src/agent-control.ts).

MCP returns compact JSON text plus the same complete object as
`structuredContent`. `isError:false` means a valid receipt was delivered, matching
CLI exit 0; it does not turn `not-admitted`, `api-failure`, `stopped`, `retired` or
`terminal` into completed gameplay. Existing verification/termination rules apply.
CLI exceptions use the same exported sanitizer, with `{error}` in an MCP
`isError:true` result instead of CLI stderr/exit 1. SDK input-schema rejection
uses its own `isError:true` validation message before the CLI runs. Protocol or
connection failure can instead mean no tool result. None permits an automatic
retry. Diagnostics go to stderr; stdout is JSON-RPC only.

Temporary `configFile`/`instructionsFile` inputs remain required. PNG creation and
exclusive file writes are the CLI's existing implementation. `decide.pngPath`
contains the verified **after-action** image; `beforeObservationId` identifies
the input, even though the PNG filename uses that command/input ID.

## Human-only project registration and acceptance

Nothing registers/enables MCP automatically. Do not use global `codex mcp add`
for this experiment. On the tested host, the human can add this table to
**this worktree's** `.codex/config.toml` (create the directory/file if absent):

```toml
[mcp_servers.doom_decisions]
command = "/Users/mike/.nvm/versions/node/v22.20.0/bin/node"
args = ["/Users/mike/projects/doom-decisions-agent-control/app/agent-mcp.mjs"]
cwd = "/Users/mike/projects/doom-decisions-agent-control"
enabled = false
required = true
startup_timeout_sec = 10
tool_timeout_sec = 60
```

1. Review the table, then set `enabled = true` for the MCP arm. No credential
   environment variables belong in this table. The project must be trusted for
   project configuration to load. Do not alter global configuration.
2. Start a **fresh Codex session from this worktree**, using the same Codex
   model/effort as the recorded CLI-10 baseline. Check `/mcp` for the eight tools.
   Registration in an existing session is not evidence that tools reloaded.
3. The human configures the existing private agent settings, chooses a finite
   5–10-attempt budget, starts `npm --prefix app run dev:agent`, opens
   `http://127.0.0.1:5174/` manually and waits for verified readiness. Keep the
   Decisions provider/model and gameplay/observation policy consistent with the
   recorded baseline. Do not rerun or invent that baseline's metrics.
4. In the new Codex session request **`$doom-decisions play using MCP`**. No other
   skill behavior changes: Codex chooses 1–35 tics (default 6), explains every
   nondefault decision before submission, and the Decisions API chooses actions.
   Inspect every completed/terminal decision PNG and use the existing observation
   hash/run-identity reuse rules. A missing MCP tool or failed call ends play;
   never fall back to CLI inside that invocation.
5. To disable, set `enabled = false` or remove only this table and start another
   fresh Codex session. `$doom-decisions play` then uses CLI by default. If a prior
   run ended ambiguously, inspect/Stop it in the browser first. A separate play
   requires the existing human process-restart procedure; switching transports
   never replenishes an allowance or retries an old observation.

Codex's installed CLI was **0.164.0** during implementation. Configuration follows
[official Codex MCP guidance](https://developers.openai.com/codex/mcp);
the server API follows [SDK v2 stdio guidance](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html).
Actual Codex catalog loading/rendering remains a human acceptance check.

## Evidence and limits

Offline tests use the existing synthetic broker/controller, fake provider
transport and synthetic PNG fixture. The matrix replays actual validated broker
responses through CLI and MCP with identical generated IDs and file paths, then
compares the entire result and written PNG bytes. Other cases cover schema/file
errors, CAS conflicts, stale scope/observation, exhaustion, Stop, terminal prefixes,
uncertain retirement, lost responses and cancellation/restart without replay.
Real child-process stdio tests exercise SDK legacy and automatic negotiation,
initialization/listing without bridge calls, complete result/error framing and
stdin EOF exit. This proves neither Chrome, real native Doom nor paid Decisions
correctness.

The SDK test client surfaces both compact text and structured output. The tested
wire includes **two copies** of a successful domain payload. Measure actual
Codex-visible output and token accounting in the fresh acceptance session;
structured output is not automatically a token saving. The serialized eight-tool
catalog measured **3,096 UTF-8 bytes** in both tested negotiations; there are no
server instructions. Include that catalog, result
wrappers/duplication, shell file operations and image views in the comparison.

Cancellation/connection close aborts the adapter's owned fetch through the SDK
request/lifetime signals, preserving the CLI's 15-second/35-second deadlines.
It does not prove a provider stopped processing/billing. A lost response after a
consumed action returns a sanitized unknown-completion error, never a fabricated
success or second attempt. The fake cancellation test demonstrates signal/close
propagation and retained controller reader ownership; real host cancellation and
transport delivery timing remain unverified. After idle MCP exit, the existing
browser lease is not proactively revoked by a new tool; the human uses Stop.

The pre-existing startup image-reuse wording across `start-run` is unchanged.
Apply the same conservative interpretation in both arms: prior inspection outside
the active run cannot establish unchanged run ownership for post-start reuse.
Do not introduce a startup reuse exception during this experiment.

For the human smoke, record per-operation counts, polls/continuations per decision,
input/cached/uncached/output tokens, catalog and model-facing result sizes, unique
PNG hashes, elapsed/provider/local time, errors and workflow friction. Gameplay
and model nondeterminism limit comparison. Offline byte parity does not predict
model-continuation savings.
