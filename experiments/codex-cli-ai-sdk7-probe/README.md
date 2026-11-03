# Native SDK 7 + local MCP offline probe

This isolated experiment checks two independent boundaries. It does not replace
the working ACP experiment or connect its model fixture to the local MCP tool.

- `native-model.typecheck.ts`: compile-only construction of AI SDK 7
  `ToolLoopAgent` with the candidate App Server provider's native v4 model.
  No casts, ACP dependency, SDK 6 descriptors, or inference calls. The function is
  never invoked or imported by the test. Published provider, model, RPC-client,
  and agent constructors were inspected for lazy startup before runtime imports.
- `probe.test.ts`: one real authenticated HTTP `tools/list`, then exactly one
  `tools/call` to exported `tool()` / `createLocalMcpServer()`. Zod trims the input;
  the callback records it and returns a synthetic domain object. The test compares
  actual MCP text and its decoded object to the complete expected payload,
  including a fresh random marker and note ID. It awaits public `stop()` in
  `finally` and requires a new request to fail specifically with `ECONNREFUSED`.

The endpoint binds only `127.0.0.1` on an OS-selected port. Its generated bearer
token stays in memory and is never printed. HTTP requests use `Connection: close`
and a two-second timeout; the test has a ten-second timeout. No general callback
timeout, cancellation, or child-process cleanup contract is established.

## Reproduce on the tested host

Node **22.20.0**, npm **10.9.3**, macOS ARM64. Direct dependencies are exactly
`ai@7.0.159`, `ai-sdk-provider-codex-cli@2.4.0`, and `zod@4.6.7`. Development
dependencies are exactly `typescript@7.0.2`, `@types/node@22.20.0`,
`@types/json-schema@7.0.15`, and `@typescript/typescript-darwin-arm64@7.0.2`.
The JSON Schema types satisfy the SDK provider's published declaration imports,
allowing full declaration checking without `skipLibCheck`.
The compiler platform package is
explicit because `--omit=optional` otherwise excludes TypeScript 7's executable.
That explicit pin makes this probe's install host-specific.

From the repository root, with owner authorization:

```sh
npm --prefix experiments/codex-cli-ai-sdk7-probe ci --omit=optional --ignore-scripts --no-audit --no-fund --cache /private/tmp/doom-codex-cli-probe-npm-cache
npm --prefix experiments/codex-cli-ai-sdk7-probe run typecheck
npm --prefix experiments/codex-cli-ai-sdk7-probe test
git diff --check
```

The experiment-local lockfile fixes transitive resolutions and integrity hashes.
Optional Codex/platform packages may appear in the lockfile but are omitted from
disk. Install scripts are disabled. There is no Codex binary requirement.

## Evidence boundary

Passing establishes model type assignability and the direct local MCP callback
round trip separately. It does **not** establish App Server tool discovery,
model-visible consumption, AI SDK tool-event correlation, nested sessions, image
delivery, permission handling, child-process shutdown, or gameplay behavior.
There is no App Server simulator, model inference, browser, Doom, SQLite, saved
observation, lease, or Decisions API use. Invalid-input rejection is not exercised.

The next experiment requires separate authorization: one synthetic, non-gameplay
App Server tool call, checking the returned marker and real streamed tool identity.
Do not infer migration readiness from this offline probe.

Candidate source inspected: release `v2.4.0`, commit
`ffb65a54aa55e7e3b985e5f882bc6c4683efeb1f`, plus the installed package's public
README, declarations, and bundled implementation. Direct local HTTP API usage is
documented in that package's README under local MCP security defaults. The
underscore-prefixed `createSdkMcpServer()` lifecycle is deliberately unused.
