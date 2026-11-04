# One Doom decision experiment

Running `src/main.ts` with no arguments now authorizes **one** guarded gameplay
request. It is no longer a passive observation command. Do not run it as a check.
The Decisions API chooses the actual action. The reasoning model only judges
whether one retrieved historical landmark merits navigation guidance.

The experiment uses the installed AI SDK 7, official `@ai-sdk/openai` Responses
provider and existing local OAuth transport. `DOOM_REASONING_MODEL` selects the
reasoning model (default `gpt-6-luna`); this is separate from the browser's
Decisions provider/model. OAuth model availability and structured-output/image
support remain unverified against a live account. There is no automatic fallback
or model retry.

The host sequence is:

1. Attach once; retain the acknowledged page/epoch/lease identity.
2. Observe once for reasoning. Re-read the materialized PNG, hash the owned bytes,
   and validate observation, canonical map identity, telemetry and PNG header/
   dimensions with the shared protocol parsers. Those exact bytes enter inference.
3. Query historical memory using that verified map key and pose: 16.16 coordinates
   become world units; unsigned angle becomes degrees; radius 128, limit 3.
   Existing storage opens read-only. Missing storage, lookup failure and successful
   empty results are distinct. Malformed evidence stops the experiment. Only
   landmark candidates are offered; note text is untrusted advisory data.
4. Make one structured model inference with image, compact game state and bounded
   candidates. Host validation rejects invented IDs and inconsistent judgments.
5. If guidance is approved, `getPrompt` before claim must match the initial
   session/revision/template. Compose the amendment and prepare its private
   temporary file before claiming. The amendment uses only the selected note ID
   and numeric anchor; free model prose remains diagnostic. The base template,
   including every `{{tics}}`, remains intact. Oversized amendments stop early.
6. `startRun` uses the initial observation/session/revision. **The broker owns
   the configured budget**; the experiment requires the acknowledgment to show
   exactly one available attempt. Claiming does not increment the revision.
   `setPrompt` requires this active run ID, uses revision CAS, and must echo the
   exact instructions at revision + 1. Without guidance, no prompt write occurs.
7. Observe afresh after claim/optional CAS. Verify unchanged game/map/pose/tic/
   image and expected configuration/run/revision, then `decide` exactly once with
   this fresh observation ID and `{ sessionId, runId, revision }`.
8. Validate correlated receipt, resulting PNG/hash/identity, requested/reported/
   verified tic semantics and cumulative tic. A completed decision additionally
   requires final accounting: one reserved and one SDK invocation, zero remaining.
   Terminal and unsuccessful outcomes report final accounting as unavailable.
9. Report compact diagnostics and detach in `finally`. Playback and detach
   failures remain separate members of an `AggregateError` when both fail.

A thrown/lost claim, prompt CAS or decision acknowledgment is uncertain and never
retried. A valid declined guidance judgment still permits the one decision. Stop
and lease revocation remain enforced by the browser's admission and dispatch
fences. There is no second action slot, config write, autonomous loop or subagent.
The prompt amendment is lease-owned and is not restored through an extra mutation;
the flow ends by detaching.

Offline verification, from this directory with existing dependencies:

```sh
npm run typecheck
node --experimental-strip-types --test tests/*.test.ts
../../app/node_modules/.bin/biome check src/main.ts src/provider.ts src/doom-play-agent.ts src/doom-tools.ts tests
```

Tests use fake Doom clients/transports, fake model responses, fake memory and
temporary files. PNG fixtures exercise protocol header/hash checks, not decoding
or native rendering. These checks do not use OAuth credentials, an actual memory
DB, a browser, Doom/WASM or a paid API. The legacy client tests still verify the
shared executor through an injected fake HTTP transport.

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
   Memory absence/lookup failure may continue with valid no-update judgment;
   malformed evidence or failed inference must result in no claim/decision.
4. Inspect the compact result, browser receipts and Console/Network: at most one
   Decisions invocation, matching requested/reported/verified tics or an explicit
   terminal prefix/uncertainty, final accounting where available, and acknowledged
   detach. Record evidence without credentials. A model may decline guidance even
   with candidates; that is a valid outcome.
5. On uncertainty, stop and inspect the browser; use Stop Agent to release possible
   ownership. Do not rerun automatically. A new live attempt needs fresh explicit
   operator authorization and a deliberately renewed process budget.
