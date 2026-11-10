import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Each case owns a process: a broken progress channel stays disabled for the
// remaining lease, and must not contaminate other tests or the test runner.
for (const mode of ["throw", "callback-and-event"] as const) {
	for (const operationFails of [false, true]) {
		test(`${mode} progress failure preserves ${operationFails ? "original operation errors" : "playback"} and detach`, () => {
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
  const { main } = await import(${JSON.stringify(import.meta.resolve("../src/main.ts"))});
  // Let the experimental mock warning settle before breaking stderr.
  await new Promise((resolve) => setImmediate(resolve));
  const outputError = Object.assign(new Error("synthetic closed pipe"), { code: "EPIPE" });
  const operationError = new Error("original operation failure");
  const detachError = new Error("original detach failure");
  const mode = ${JSON.stringify(mode)};
  const operationFails = ${operationFails};
  let writes = 0;
  t.mock.method(process.stderr, "write", (_chunk, callback) => {
    // Fail in the error-reporting path too: logging must not replace the
    // original uncertain-dispatch error before finally can detach.
    if (operationFails && !String(_chunk).includes("Stopped at decision")) return true;
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
      assert.equal(cleanup, detachError);
      return true;
    });
  } else {
    assert.equal((await running).outcome, "completed");
  }
  // Allow any asynchronous error event to run before asserting completion.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 1);
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
