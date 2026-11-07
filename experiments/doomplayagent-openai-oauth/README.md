# One Doom decision experiment

Running `src/main.ts` with no arguments now authorizes **one** guarded gameplay
request. It is no longer a passive observation command. Do not run it as a check.
The Decisions API chooses the actual action. TypeScript selects the first-turn
navigation objective; the reasoning model interprets the current scene in light
of that objective and reports diagnostic interpretation/uncertainty.

The experiment uses the installed AI SDK 7, official `@ai-sdk/openai` Responses
provider and existing local OAuth transport. `DOOM_REASONING_MODEL` selects the
reasoning model (default `gpt-6-luna`); this is separate from the browser's
Decisions provider/model. OAuth model availability and structured-output/image
support remain unverified against a live account. There is no automatic fallback
or model retry.

`play()` owns observation, active-landmark lookup, objective selection and scene
interpretation. Its private `executeOneDecision()` helper owns the handoff: prompt
composition, run claiming, revision CAS, fresh observation and one decision.

The host sequence is:

1. `main.ts` composes the provider/tools/client, attaches once, awaits `play()`,
   and detaches in `finally`. `DoomClient` owns the acknowledged lease.
2. Obtain the executor-validated observation. Re-read its materialized PNG and
   hash those owned bytes against the validated digest before submitting them
   to inference. Later file changes cannot change the inference image.
3. Query map-wide `active-landmarks` using the verified map key, limit 3;
   no pose/radius restriction can hide a distant active lead. Memory schema v3
   stores raw poses; older databases are rejected without migration. The model
   cannot select the query namespace. Existing storage opens read-only;
   unavailable, failed and empty results stay distinct.
4. Select a `NavigationObjective`: the first active landmark's ID/revision in the
   shared creation-time/ID order, or `free-explore` for no active result. This is a
   deterministic tie policy, not a closest/best ranking. Active means unfinished
   historical exploration, not ownership or verified current geometry. Failed,
   unavailable and successfully empty lookups remain distinct in `memoryStatus`;
   all three retain the existing free-exploration fallback.
   Ask the model to interpret the verified screenshot/state with only this
   selected lead. Its strict output contains interpretation/uncertainty, with no
   objective-selection or prompt-update authority. Model prose stays diagnostic.
5. For a landmark, compose bounded guidance from the initial validated template,
   selected ID/revision, observer pose, hypothesis and optional next question
   before claiming the run. Historical text is labeled untrusted advisory data;
   the anchor is an observer pose, never a guaranteed reachable waypoint.
   Free exploration leaves the existing template unchanged, without `setPrompt`.
   No extra `getPrompt` is needed: revision CAS protects that template snapshot.
6. Claim the run using the initial observation/session/revision. Require the
   broker-selected budget to be exactly one. Optionally `setPrompt` using the
   claimed run and current revision; use the acknowledged revision afterward.
7. Observe afresh. Require a new observation ID, the same session/map/tic, and
   the expected revision so the judgment still applies. Send `decide` once with
   that fresh ID and the claimed scope. Browser/controller gates remain decisive.
8. Report the executor-validated receipt directly, including terminal prefixes,
   declined admission and native uncertainty. No final accounting call or PNG
   reread is needed: there is no next action to authorize.

A failed claim, prompt update or decision stops the sequence without retry.
Before calling `decide`, an error means no decision was sent. During `decide`,
errors are conservatively unconfirmed: the client has only textual pre/post-send
errors, so `play()` does not infer dispatch certainty from error-message parsing.
The failure stage identifies a possibly unacknowledged run/prompt mutation;
original causes remain available to programmatic callers. CLI output uses only
bounded host messages and objective/judgment diagnostics, never raw model/transport
exceptions. Prompt updates pass strings directly to the shared executor; no
temporary prompt file is created. Playback and detach failures remain separate
members of an `AggregateError` when both fail.

There is no second action slot, config write, autonomous loop or subagent. The
lease-owned prompt amendment is not restored through another mutation; the flow
ends by detaching.

Free exploration preserves whatever base template the lease inherited from the
human settings; it does not reset a customized template to the default exploration
instructions. Likewise, prompt wording about the next decision has no automatic
expiry within a lease. This experiment supports one attach/play/detach transaction,
without same-lease restoration or an objective lifecycle. Several notes may remain
active; only the first is selected, even if the bounded lookup reports `hasMore`.

## Responsibility audit

This experiment trusts the existing executor/browser stack; it is not an
independent security boundary.

| Ownership | Actual enforcement and simplification |
| --- | --- |
| Already guaranteed below `play()` | [`executeAgentOperation`](../../scripts/doom-agent-client.ts) validates wire commands, lease/page/epoch/command correlation, calls `parseAgentObserveResult`, `parseAgentConfigResult`, `parseAgentPromptResult` and `parseAgentDecisionResult`, and verifies PNG bytes/hashes before materializing. It checks settings session/run correlation, exact submitted prompt echo and revision + 1, start-run active/revision acknowledgment, and decision `beforeObservationId`. Removed duplicate envelopes, parsers, path/header checks, CAS echoes and receipt correlation. `DoomClient` delegates these guarantees rather than implementing DTO parsing itself; its own responsibility is lease lifecycle and rejecting overlapping calls. |
| Already guaranteed by browser/controller | [`startAgentRun`, `agentConfig`/`agentPrompt`, `agentNext`](../../app/src/session-controller.ts) enforce one-shot claim, session/run/revision CAS, fresh observation admission and nonrefundable reservations. `decide` fences one SDK create; `runOneDecision`, `action` and `captureAgentObservation` verify native stepping, resulting frame and Canvas linkage. [`agent-bridge.mjs`](../../app/agent-bridge.mjs) issues the process budget once and rejects duplicate commands; [`agent-browser.ts`](../../app/src/agent-browser.ts) also rejects duplicates and fences Stop/revocation. Removed repeated run counters/active checks, config equality and native receipt arithmetic. |
| Required across operations | `play()` owns the initial PNG rehash and deterministic first-active objective selection. Its private `executeOneDecision()` helper owns prompt-size preflight, the one-slot budget requirement, a fresh post-CAS observation and continuity with the judgment's session/map/tic/revision. It calls `decide` once and never retries an ambiguous mutation. The initial PNG rehash remains necessary because the file is reread after executor validation. [`doom-tools.ts`](src/doom-tools.ts) owns the verified-map-key query and validates bounded active-landmark evidence, namespace isolation, raw poses and unverified-memory labeling. The AI SDK validates the strict interpretation schema. |
| Nice-to-have / overly strict | Full equality of frames, telemetry, facing probes, previous actions, counters, PNG hashes, configurations and entire run snapshots is unnecessary for this one-step flow. A passive capture may change capture counters. Same session/map/tic retains the simulation checkpoint; revision and browser admission handle configuration. Removed final-accounting readback and resulting-image rereads, since neither controls another dispatch. |

The decision parser is not a complete independent native verifier: for example,
terminal prefix bounds and before/after cumulative arithmetic are not all checked
by that parser. Those guarantees come from the trusted controller/native pipeline.
This experiment now reports that evidence instead of recreating a verifier. No
lower-layer defect blocked this simplification; independent verification would be
a different scope. Static/offline checks do not establish live native correctness.

Offline verification, from this directory with existing dependencies:

```sh
npm run typecheck
node --experimental-strip-types --test tests/*.test.ts
../../app/node_modules/.bin/biome check src/main.ts src/provider.ts src/doom-play-agent.ts src/doom-tools.ts tests
```

Tests use fake Doom clients/transports, fake model responses, fake tools for agent
tests, and isolated temporary SQLite databases for real memory lookup tests.
PNG fixtures exercise protocol header/hash checks, not decoding or native
rendering. These checks do not use OAuth credentials, the historical memory DB,
a browser, Doom/WASM or a paid API. The client tests verify string/file prompt
convergence and the shared executor through an injected fake HTTP transport.
Existing agent, CLI and MCP callers retain absolute-file prompt inputs and the
same validated wire command.

## Suggested live smoke, requiring separate operator authorization

1. Approve browser/game-asset use, OAuth/model inference, read-only access to the
   intended memory DB, and exactly one Decisions API attempt. Choose an
   OAuth-accessible Responses model; it must support image input and structured
   output. The default has not been live-certified by this change.
2. Set `AGENT_DECISION_BUDGET=1` in the root app's ignored `app/.env.agent.local`.
   Start a fresh authorized `dev:agent` process and manually open its page at
   `http://127.0.0.1:5174`. Wait for verified E1M1 readiness. Do not grant a
   separate browser run or start Continuous Mode. Use the existing local OAuth
   setup; never paste keys or tokens into prompts, output or artifacts.
3. From this directory, run once:
   `DOOM_REASONING_MODEL=<approved-model> node --experimental-strip-types src/main.ts`.
   Memory absence/lookup failure may continue with free exploration and a valid
   scene interpretation; malformed evidence or failed inference must result in
   no claim/decision.
4. Inspect the compact result, browser receipts and Console/Network: at most one
   Decisions invocation, matching requested/reported/verified tics or an explicit
   terminal prefix/uncertainty and acknowledged detach. Record evidence without
   credentials. Confirm the result's `navigationObjective` matches the first
   active note and revision, and its historical guidance reaches the Decisions
   request. Without an active note, confirm the base prompt is unchanged.
5. On uncertainty, stop and inspect the browser; use Stop Agent to release possible
   ownership. Do not rerun automatically. A new live attempt needs fresh explicit
   operator authorization and a deliberately renewed process budget.
