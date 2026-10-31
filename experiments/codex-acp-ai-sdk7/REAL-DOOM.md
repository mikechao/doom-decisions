# One real Doom observation → one advisory proposal

**One owner-run real-observation inference completed; human review is recorded below.**
This is a separate experiment from the successful synthetic trial recorded in
`trial-evidence.json`. Its runner and historical markers/evidence stay unchanged.

Offline checks from the repository root, using existing installed dependencies:

```sh
cd experiments/codex-acp-ai-sdk7
npm run doom:test
npm run doom:validate
```

Both commands are offline. Validation only reads the three ignored files under
`.local/real-doom/` and installed package manifests/lock. Missing fixtures fail;
there is no download, capture, generated replacement, ACP import, connection or
model call. Tests use the real local fixture, in-memory mutations, a temporary
attempt marker, and a Node child that forbids ACP/AI/process/network imports and
network globals during validation. No Doom runtime or game asset is opened.

Replay removes **exactly** `pngPath`, `pageId`, `epoch`, `commandId`, restores
`png` from the local PNG bytes only in memory, and calls the existing
`parseAgentObserveResult` → `parseAgentObservation` / `agentPngBytes` contracts.
It checks the supplied PNG-byte SHA-256 pin, ready/E1M1/tic-1 identity, and
cross-file provenance consistency, including the metadata-file digest. The
historical path is never followed. PNG encoded-byte hashes are compared only
with encoded-byte hashes; recorded decoded RGBA hashes are checked separately
against the extraction attestation. Replay does not repeat PNG decoding or the
historical native/Canvas/lease capture fences. Provenance is a local historical
attestation, not independently authenticated capture proof.
An integrity digest preserves the exact expected historical correlation identity
without publishing its session/call/observation identifiers in source.

The shared preparation path supplies exactly one PNG byte buffer and an explicit
state allowlist: historical-replay label; map identity (IWAD hash, episode, map,
slot, key); tic/phase; gametic/leveltime/render/frame counters; telemetry health,
weapon ID, ammo totals, ready-weapon ID/name/ammo type, per-ammo current/max,
x/y/angle; facingProbe tic/kind/door/distance; previousAction (required null).
No IDs, correlation/lease values, paths, configuration, provenance, transcript,
credentials, frame hashes or WAD bytes enter the model message. Raw pose/probe
values are not presented as decoded map knowledge.

## Completed trial — 2026-10-31 (owner-reported)

The owner reports running `npm run doom:infer` exactly once in a normal macOS
terminal. Codex did not rerun inference to document or commit this result.
Host outcome: `AWAITING_HUMAN_REVIEW`, `completed: true`,
`structuralValidation: PASS`, `errorCategory: null`. There was one
`generateTextInvocations` and one `providerCallStarts`; finish reasons were
`stop` / `end_turn`, with elapsed time **12,987 ms**.

Input was historical DOOM1.WAD E1M1 at tic 1, phase `ready`: a 640×400 PNG,
73,244 file bytes, SHA-256
`eee1533d7ef43bc0f65f33fd682f46340ef32b25c9cd68ad4d96298994678e79`.
Snapshot hash matching, DTO validation and provenance consistency passed.
Capture proofs remain historical, not fresh gameplay admission.

The proposal targeted clarifying the layout beyond a narrow opening at the far
right. Its visual evidence described a small blue patch in that opening and a
larger blue area framed by tan pillars ahead. It expressed uncertainty about
traversability and continuity, and asked whether another perspective could
establish continuity. Human review of the uploaded `observation.png` confirmed
those visible features and found the descriptions substantially accurate.
Calling the blue areas floor is a visual interpretation, not proof of
traversability. Other details were omitted; exhaustive description was not asked.

Owner-supplied evaluation: technical integration **PASS**, visual grounding
**PASS for this single frame**, and a plausible high-level exploratory objective
**initial PASS**. Telemetry grounding was **factually correct but shallow**:
only map/tic/phase were cited. **No improvement in gameplay or objective
completion was tested.**

Cleanup reported `PUBLIC_CLEANUP_RETURNED_SESSION_CLEARED_EXIT_UNVERIFIED`.
`toolCallsObserved: 0` covers only AI SDK-visible calls; internal activity was
not observable. Token usage was null, not a measured zero. Local evidence and
the consumed attempt marker remain ignored; this report does not establish
strict internal tool isolation or descendant-process exit.

## Consumed manual inference invocation

Historical command, from the repository root; **do not rerun**:

```sh
cd experiments/codex-acp-ai-sdk7 && npm run doom:infer
```

Do not run this as a preflight. It can incur model charges. The npm script
suppresses inherited provider/adapter stderr; only fixed host error categories
are printed. Do not bypass it to collect raw stderr. No auth/config/model changes
are made; the existing Codex model configuration is inherited and uninspected.

After repeating all offline validation/version checks, exclusive `wx` creation
of `.local/real-doom-once/started.json` consumes this namespace **before ACP
imports or startup**. Concurrent/repeated invocations fail closed. Startup,
timeout, ambiguous completion, invalid output, cleanup failure and interruption
never remove the marker. Validation does not reserve an attempt. Do not delete
the marker to retry; further attempts require separate review/authorization.
One host `generateText()` invocation, `maxRetries: 0`, one message/image, no
fallback, replay or loop. This bounds host attempts, not internal adapter recovery
or remote processing/billing. Connect/session host waits are 45 seconds each;
inference wait is 120 seconds. Abort/timeouts cannot certify remote cancellation.

The runner reuses `createACPProvider` → `connect()` → `initSession()` →
`generateText()` → host validation → `cleanup()`. It requests read-only agent
mode, a fresh empty fixture-only cwd under `.local/real-doom-once/fixture-cwd/`,
and explicit `mcpServers: []`, with no Doom tools added. These requests do **not**
prove absence of inherited/internal Codex tools, auto-permission handling or
lazy authentication behavior. Observed AI SDK tool calls cannot establish full
isolation. Any returned tool call, non-stop/non-`end_turn` completion, changed
session, or provider-call count other than one rejects the result.

Local sanitized evidence is written exclusively to
`.local/real-doom-once/evidence.json`: snapshot summary, installed versions,
stage/completion counts, normalized finish reasons, optional numeric usage,
observed SDK tool-call count, fixed error/cleanup categories, and only the
bounded validated proposal. No raw response, raw errors, provider/session IDs
or image base64 are saved. A basic text privacy guard rejects obvious paths,
URLs, data URLs, UUIDs and credential-like prefixes before saving a proposal;
it does not prove internal-tool privacy. Hard termination can leave only the
started marker; that remains a consumed, ambiguous attempt. Public cleanup
returns no descendant-process exit receipt. Null usage means unavailable,
not zero. `AWAITING_HUMAN_REVIEW` means structurally accepted, not navigation PASS.

## Manual review of the proposal

The exact output has five required fields and rejects missing/extra fields:
`target`, `visualEvidence`, `telemetryEvidence`, `uncertainty`, `nextExperiment`.
Target/uncertainty/nextExperiment are nonblank strings of at most 800 characters;
each evidence array has 1–5 nonblank strings of at most 400 characters. Total
JSON is at most 8 KiB; Markdown wrappers and control characters are rejected.
Host validation checks structure, **not factual grounding**.

Review the local image and validated state beside the proposal:

- Does the target identify one sensible, observable navigation feature/question?
- Is each visual claim visible in this PNG, rather than supplied by remembered E1M1 layout?
- Does every telemetry claim match an actually supplied field, without invented units or enum meanings?
- Does uncertainty acknowledge that one tic-1 perspective cannot prove passage traversability, a route or arrival?
- Is nextExperiment exactly one useful observable question, without buttons, tics, gameplay execution, tools or settings changes?

Record PASS / FAIL / INCONCLUSIVE with concrete discrepancies; valid JSON alone
does not answer the experiment's question. This historical single tic-1 still
cannot demonstrate live supervision, movement, a gameplay loop or production
readiness. Native/Canvas/lease proofs remain historical; internal tool isolation,
model usage availability and descendant exit remain unverified.
