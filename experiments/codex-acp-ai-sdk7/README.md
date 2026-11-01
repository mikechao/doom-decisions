# One-action Doom supervisor

This directory contains one active prototype: Codex through ACP and Vercel AI
SDK 7 proposes high-level navigation guidance over browser Doom. The existing
Decisions API selects the low-level action; the application retains lease,
budget, Stop and native/frame verification authority. One invocation admits at
most one Decisions action, with an initial ACP proposal and a final advisory
reassessment in the same observed ACP session. The two-decision experiment is
on hold.

| File | Responsibility |
| --- | --- |
| `supervisor.ts` | Gated live entry, installed/lock version admission, exclusive trial setup, signals, port composition, report publication and cleanup scheduling; stable workflow re-exports. |
| `supervisor-workflow.ts` | Injectable one-action policy, evidence/report ledger, ACP checkpoints, session checks, cancellation/deadlines and ACP cleanup ownership. |
| `supervisor-cli.ts` | In-process Doom CLI calls, lease tracking, sanitized numbered receipts, PNG reads, temporary instruction-file creation and removal. |
| `supervisor-acp.ts` | Lazy AI SDK/ACP imports, provider/model configuration and session/generation/cleanup methods. |
| `live-observation.ts` | Strict live DTO, PNG and correlation validation. |
| `doom-proposal.ts` | Strict advisory proposal/reassessment schemas and validators. |
| `supervisor.test.ts` | Fake-only offline regressions, compatibility exports and guarded inert imports/entry paths. |

The entrypoint composes CLI ports with the ACP factory's `createACP` port and
passes them to `supervise()`. Adapters import only workflow types; the workflow
does not import adapters. `supervisor-cli.ts` reuses `scripts/doom-agent.mjs` via
`runAgentCli()` in the same Node process, without a CLI/MCP subprocess. The browser
remains authoritative for gameplay; Codex ACP supplies advisory navigation guidance
only. Both adapter factories are inert until their ports are invoked.

The CLI adapter owns the temporary instruction-file path, recording it before the
exclusive write so cleanup also covers partial write failure. The entrypoint calls
its cleanup in `finally` after report publication (or failure), after removing signal
listeners. Cleanup failures propagate as before; hard interruption may leave the
file. The workflow separately owns ACP cleanup before returning its report.

`package.json`, `package-lock.json`, `tsconfig.json` and `.gitignore` retain pinned
dependencies, offline test/typecheck setup and ignored artifacts. See
[SUPERVISOR.md](SUPERVISOR.md) for live invocation, accounting, Stop and evidence limits.

From the repository root, with existing installed tools, safe offline checks are:

```sh
node --experimental-strip-types --test experiments/codex-acp-ai-sdk7/supervisor.test.ts
node app/node_modules/typescript/bin/tsc -p experiments/codex-acp-ai-sdk7
```

`npm test` from this directory runs the same fake-only suite. It requires no
ignored real-Doom fixture, broker, browser, WAD, network or model inference.
`node --experimental-strip-types supervisor.ts --help` is inert. There is no
npm live-run script; use only the explicit gated invocation in
[SUPERVISOR.md](SUPERVISOR.md#human-invocation-after-separate-approval), with fresh
human approval, a new trial ID and stderr suppressed as documented.

The owner reports that Trial 001 executed `turn_right` for six verified tics
(cumulative tic 7), then failed only at final reassessment validation. Trial 002
completed the one-action cycle: two ACP checkpoints in the same observed session
ID, one verified Decisions action, accepted advisory reassessment and exhausted
limit 1. These are owner-supplied live reports, not independent verification by
this cleanup. Private trial evidence and consumed markers remain untouched under
ignored `.local/`; never reuse a consumed ID or commit/upload that evidence.

Earlier startup diagnostics, the successful synthetic two-image session/recall
proof, and a one-shot historical Doom observation established narrower integration
and visual-grounding evidence. The owner found the single-frame visual grounding
substantially accurate, with shallow telemetry grounding and no gameplay progress
tested. Their superseded runners, replay-specific tests and tracked reports are
available in Git history; they are no longer supported entry points here.

This remains a prototype. Valid JSON and advisory status do not prove navigation
success. Read-only mode and empty MCP configuration do not establish full Codex
internal-tool isolation. Public cleanup does not guarantee descendant termination
or remote cancellation/billing cessation; missing usage is unavailable, not zero.
Offline tests do not independently establish live browser/WASM correctness.
