import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Each case owns a process: a broken progress channel stays disabled for the
// remaining lease, and must not contaminate other tests or the test runner.
for (const failurePoint of ["existing-path", "prompt"] as const) {
	for (const mode of ["throw", "callback-and-event"] as const) {
		for (const operationFails of [false, true]) {
			test(`${mode} ${failurePoint} progress failure preserves ${operationFails ? "original operation errors" : "playback"} and detach`, () => {
				const child = spawnSync(
					process.execPath,
					[
						"--experimental-strip-types",
						"--experimental-test-module-mocks",
						"--input-type=module",
						"-e",
						`
import assert from "node:assert/strict";
import test from "node:test";
import { PlaybackError } from ${JSON.stringify(import.meta.resolve("../src/doom-play-agent.ts"))};
import { fixture } from ${JSON.stringify(import.meta.resolve("./fixtures.ts"))};

test("broken progress channel", async (t) => {
  const f = await fixture(t);
  const clientModule = await import(${JSON.stringify(import.meta.resolve("../src/doom-client.ts"))});
  t.mock.module(${JSON.stringify(import.meta.resolve("../src/doom-client.ts"))}, {
    namedExports: { ...clientModule, createDoomClient: () => f.client },
  });
  t.mock.module(${JSON.stringify(import.meta.resolve("../src/doom-tools.ts"))}, {
    namedExports: { createDoomTools: () => f.tools },
  });
  t.mock.module(${JSON.stringify(import.meta.resolve("../src/provider.ts"))}, {
    namedExports: { createOAuthProvider: () => f.provider },
  });
  t.mock.module(${JSON.stringify(import.meta.resolve("@openai-oauth/local"))}, {
    namedExports: { openaiCredentials: () => ({ getSession() { throw Error("Credential access forbidden"); } }) },
  });
  const persistenceModule = await import(${JSON.stringify(import.meta.resolve("../src/run-persistence.ts"))});
  t.mock.module(${JSON.stringify(import.meta.resolve("../src/run-persistence.ts"))}, {
    namedExports: { ...persistenceModule, persistRun: async () => "/synthetic/run.json" },
  });
  const { main } = await import(${JSON.stringify(import.meta.resolve("../src/main.ts"))});
  // Let the experimental mock warning settle before breaking stderr.
  await new Promise((resolve) => setImmediate(resolve));
  const outputError = Object.assign(new Error("synthetic closed pipe"), { code: "EPIPE" });
  const operationError = new Error("original operation failure");
  const detachError = new Error("original detach failure");
  const mode = ${JSON.stringify(mode)};
  const failurePoint = ${JSON.stringify(failurePoint)};
  const operationFails = ${operationFails};
  let writes = 0;
  let failedPrompt = "";
  let failedChunk = "";
  t.mock.method(process.stderr, "write", (_chunk, callback) => {
    const chunk = String(_chunk);
    if (failurePoint === "prompt") {
      if (!chunk.includes("Start of Decisions API Prompt")) return true;
      failedPrompt = chunk;
    } else if (operationFails) {
      // Preserve coverage of a broken write while reporting the original
      // uncertain-dispatch error before finally detaches.
      if (!chunk.includes("Stopped at decision")) return true;
    } else if (writes > 0) {
      return true;
    }
    failedChunk = chunk;
    writes++;
    if (mode === "throw") throw outputError;
    queueMicrotask(() => {
      callback(outputError);
      process.stderr.emit("error", outputError);
    });
    return false;
  });
  t.mock.method(console, "log", () => {});
  if (operationFails) {
    f.client.decide = async () => {
      f.events.push("decide");
      throw operationError;
    };
    f.client.detach = async () => {
      f.events.push("detach");
      throw detachError;
    };
  }
  const running = main();
  if (operationFails) {
    await assert.rejects(running, (error) => {
      assert.ok(error instanceof AggregateError);
      const [playback, cleanup] = error.errors;
      assert.ok(playback instanceof PlaybackError);
      assert.equal(playback.cause, operationError);
      assert.equal(playback.decisionMayHaveBeenSent, true);
      assert.equal(playback.records.length, 1);
      assert.equal(playback.records[0].guidance, f.state.instructions);
      assert.equal(playback.records[0].promptAcknowledged?.instructions, f.state.instructions);
      assert.equal(playback.records[0].decision.kind, "unconfirmed");
      assert.equal(cleanup, detachError);
      return true;
    });
  } else {
    const result = await running;
    assert.equal(result.outcome, "completed");
    assert.equal(result.records.length, 2);
    assert.ok(result.records.every((record) => record.promptAcknowledged !== null));
  }
  // Allow any asynchronous error event to run before asserting completion.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 1);
  if (failurePoint === "prompt") {
    assert.ok(failedPrompt.includes("Start of Decisions API Prompt for Decision 1"));
    assert.ok(failedPrompt.includes(f.state.instructions));
    assert.ok(failedPrompt.includes("End of Decisions API Prompt for Decision 1"));
  } else if (operationFails) {
    assert.ok(failedChunk.includes("Stopped at decision"));
  }
  assert.equal(f.events.filter((event) => event === "decide").length, operationFails ? 1 : 2);
  assert.equal(f.events.at(-1), "detach");
});
`,
					],
					{ encoding: "utf8", timeout: 10_000 },
				);
				assert.equal(child.status, 0, child.stdout + child.stderr);
				assert.equal(child.error, undefined);
			});
		}
	}
}
