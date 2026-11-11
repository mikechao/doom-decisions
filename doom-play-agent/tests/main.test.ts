import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import test from "node:test";
import { PlaybackError } from "../src/playback-error.ts";
import { RunPersistenceError } from "../src/run-persistence.ts";
import { fixture, scenePerception } from "./fixtures.ts";
import { installMainMocks } from "./main-mocks.ts";

const mocks = installMainMocks();
const { main } = await import("../src/main.ts");

test("logs the result.json path only after post-detach persistence completes", async (t) => {
	const f = await fixture(t, 1);
	mocks.makeClient.mock.mockImplementation(() => f.client);
	mocks.makeTools.mock.mockImplementation(() => f.tools);
	mocks.makeProvider.mock.mockImplementation(() => f.provider);
	t.mock.method(console, "log", () => {});
	const stderr: string[] = [];
	t.mock.method(process.stderr, "write", (chunk: unknown) => {
		stderr.push(String(chunk));
		return true;
	});
	let complete!: (path: string) => void;
	let entered!: () => void;
	const pending = new Promise<string>((resolve) => {
		complete = resolve;
	});
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	mocks.persist.mock.mockImplementation(async () => {
		assert.equal(f.events.at(-1), "detach");
		entered();
		return pending;
	});
	const transaction = main();
	await started;
	assert.doesNotMatch(stderr.join(""), /Run artifact saved:/);
	complete("/synthetic/run/result.json");
	await transaction;
	assert.match(
		stderr.join(""),
		/Run artifact saved: \/synthetic\/run\/result.json/,
	);
	assert.equal(f.events.filter((event) => event === "decide").length, 1);
});

for (const outcome of [
	"completed",
	"not-admitted",
	"api-failure",
	"stopped",
	"terminal",
	"retired",
] as const) {
	test(`persists resolved ${outcome} evidence once, after detach`, async (t) => {
		const f = await fixture(t, outcome === "completed" ? 1 : 3);
		mocks.makeClient.mock.mockImplementation(() => f.client);
		mocks.makeTools.mock.mockImplementation(() => f.tools);
		mocks.makeProvider.mock.mockImplementation(() => f.provider);
		t.mock.method(console, "log", () => {});
		const decide = f.client.decide;
		f.client.decide = async (input) => {
			const receipt = await decide(input);
			receipt.outcome = outcome;
			receipt.completionUncertain = outcome === "retired";
			if (outcome === "terminal" && receipt.observation)
				receipt.observation.phase = "terminal";
			else if (outcome !== "completed") {
				receipt.observation = null;
				receipt.pngPath = null;
			}
			return receipt;
		};
		mocks.persist.mock.mockImplementation(async (result) => {
			assert.equal(f.events.at(-1), "detach");
			assert.equal(result.outcome, outcome);
			assert.equal(result.records[0].decision.kind, "returned");
			return "/synthetic/run/result.json";
		});
		const result = await main();
		assert.equal(mocks.persist.mock.callCount(), 1);
		assert.equal(mocks.persist.mock.calls[0].arguments[0], result);
		assert.equal(f.events.filter((e) => e === "decide").length, 1);
	});
}

for (const detachFails of [false, true]) {
	for (const persistenceFails of [false, true]) {
		test(`resolved playback: detach failure=${detachFails}, persistence failure=${persistenceFails}`, async (t) => {
			const f = await fixture(t, 1);
			mocks.makeClient.mock.mockImplementation(() => f.client);
			mocks.makeTools.mock.mockImplementation(() => f.tools);
			mocks.makeProvider.mock.mockImplementation(() => f.provider);
			t.mock.method(console, "log", () => {});
			const stderr: string[] = [];
			t.mock.method(process.stderr, "write", (chunk: unknown) => {
				stderr.push(String(chunk));
				return true;
			});
			const cleanupError = new Error("original detach error");
			if (detachFails)
				f.client.detach = async () => {
					f.events.push("detach");
					throw cleanupError;
				};
			mocks.persist.mock.mockImplementation(async () => {
				assert.equal(f.events.at(-1), "detach");
				f.events.push("persist");
				if (persistenceFails) throw Error("SECRET storage error");
				return "/synthetic/run/result.json";
			});
			if (detachFails || persistenceFails)
				await assert.rejects(main(), (error) => {
					if (detachFails) assert.equal(error, cleanupError);
					else assert.ok(error instanceof RunPersistenceError);
					return true;
				});
			else await main();
			assert.equal(mocks.persist.mock.callCount(), 1);
			assert.deepEqual(f.events.slice(-2), ["detach", "persist"]);
			assert.equal(f.events.filter((e) => e === "decide").length, 1);
			assert.equal(
				stderr.join("").includes("Run artifact saved:"),
				!persistenceFails,
			);
			assert.doesNotMatch(stderr.join(""), /SECRET/);
			if (detachFails && persistenceFails)
				assert.match(stderr.join(""), /Doom run persistence failed/);
		});
	}
}

for (const detachFails of [false, true]) {
	test(`throwing playback never persists partial records (detach failure=${detachFails})`, async (t) => {
		const f = await fixture(t, 1);
		mocks.makeClient.mock.mockImplementation(() => f.client);
		mocks.makeTools.mock.mockImplementation(() => f.tools);
		mocks.makeProvider.mock.mockImplementation(() => f.provider);
		const cause = Error("lost decision acknowledgment");
		const cleanupError = Error("detach failed");
		f.client.decide = async () => {
			throw cause;
		};
		if (detachFails)
			f.client.detach = async () => {
				throw cleanupError;
			};
		await assert.rejects(main(), (error) => {
			const playback = detachFails
				? (error as AggregateError).errors[0]
				: error;
			assert.ok(playback instanceof PlaybackError);
			assert.equal(playback.cause, cause);
			assert.equal(playback.records[0].decision.kind, "unconfirmed");
			if (detachFails)
				assert.equal((error as AggregateError).errors[1], cleanupError);
			return true;
		});
		assert.equal(mocks.persist.mock.callCount(), 0);
	});
}

test("executable reports persistence failure safely and exits nonzero after detach", () => {
	const child = spawnSync(
		process.execPath,
		[
			"--experimental-strip-types",
			"--experimental-test-module-mocks",
			"--input-type=module",
			"-e",
			`
import assert from "node:assert/strict";
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
let detached = false;
let plays = 0;
const client = await import(${JSON.stringify(new URL("../src/doom-client.ts", import.meta.url).href)});
mock.module(${JSON.stringify(new URL("../src/doom-client.ts", import.meta.url).href)}, {
  namedExports: { ...client, createDoomClient: () => ({
    attach: async () => ({ configuredDecisionBudget: 1, budgetUnclaimedAtAttach: true }),
    detach: async () => { detached = true; return { released: true }; },
  }) },
});
mock.module(${JSON.stringify(new URL("../src/doom-tools.ts", import.meta.url).href)}, { namedExports: { createDoomTools: () => ({}) } });
mock.module(${JSON.stringify(new URL("../src/provider.ts", import.meta.url).href)}, { namedExports: { createOAuthProvider: () => ({}) } });
mock.module("@openai-oauth/local", {
  namedExports: { openaiCredentials: () => ({ getSession() { throw Error("Credentials forbidden"); } }) },
});
const playback = await import(${JSON.stringify(new URL("../src/doom-play-agent.ts", import.meta.url).href)});
mock.module(${JSON.stringify(new URL("../src/doom-play-agent.ts", import.meta.url).href)}, {
  namedExports: { ...playback, play: async () => { plays++; return { records: [], runId: "synthetic" }; } },
});
const persistence = await import(${JSON.stringify(new URL("../src/run-persistence.ts", import.meta.url).href)});
mock.module(${JSON.stringify(new URL("../src/run-persistence.ts", import.meta.url).href)}, {
  namedExports: { ...persistence, persistRun: async () => {
    assert.equal(detached, true);
    assert.equal(plays, 1);
    throw Error("SECRET prompt and filesystem error");
  } },
});
process.argv = [process.execPath, fileURLToPath(${JSON.stringify(new URL("../src/main.ts", import.meta.url).href)})];
await import(${JSON.stringify(new URL("../src/main.ts", import.meta.url).href)});
`,
		],
		{ encoding: "utf8", timeout: 10_000 },
	);
	assert.equal(child.error, undefined);
	assert.equal(child.status, 1, child.stdout + child.stderr);
	assert.match(child.stderr, /Doom run persistence failed/);
	assert.doesNotMatch(
		child.stdout + child.stderr,
		/SECRET|Run artifact saved:/,
	);
	assert.match(child.stderr, /Lease detached/);
});

for (const detachFails of [false, true]) {
	test(`executable recognizes PlaybackError safely (detach failure=${detachFails})`, () => {
		const child = spawnSync(
			process.execPath,
			[
				"--experimental-strip-types",
				"--experimental-test-module-mocks",
				"--input-type=module",
				"-e",
				`
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { PlaybackError } from ${JSON.stringify(new URL("../src/playback-error.ts", import.meta.url).href)};
const failure = new PlaybackError("decision", true, null, Error("SECRET_CAUSE"), null, null, [
  { ordinal: 2, guidance: "SECRET_RECORD", beforePng: Buffer.from("SECRET_IMAGE") },
], 2);
const client = await import(${JSON.stringify(new URL("../src/doom-client.ts", import.meta.url).href)});
mock.module(${JSON.stringify(new URL("../src/doom-client.ts", import.meta.url).href)}, {
  namedExports: { ...client, createDoomClient: () => ({
    attach: async () => ({ configuredDecisionBudget: 2, budgetUnclaimedAtAttach: true }),
    detach: async () => {
      if (${detachFails}) throw Error("SECRET_DETACH");
      return { released: true };
    },
  }) },
});
mock.module(${JSON.stringify(new URL("../src/doom-tools.ts", import.meta.url).href)}, { namedExports: { createDoomTools: () => ({}) } });
mock.module(${JSON.stringify(new URL("../src/provider.ts", import.meta.url).href)}, { namedExports: { createOAuthProvider: () => ({}) } });
mock.module("@openai-oauth/local", {
  namedExports: { openaiCredentials: () => ({ getSession() { throw Error("SECRET_CREDENTIAL_ACCESS"); } }) },
});
mock.module(${JSON.stringify(new URL("../src/doom-play-agent.ts", import.meta.url).href)}, {
  namedExports: { play: async () => { throw failure; } },
});
const persistence = await import(${JSON.stringify(new URL("../src/run-persistence.ts", import.meta.url).href)});
mock.module(${JSON.stringify(new URL("../src/run-persistence.ts", import.meta.url).href)}, {
  namedExports: { ...persistence, persistRun: async () => { throw Error("SECRET_PERSISTENCE_CALL"); } },
});
process.argv = [process.execPath, fileURLToPath(${JSON.stringify(new URL("../src/main.ts", import.meta.url).href)})];
await import(${JSON.stringify(new URL("../src/main.ts", import.meta.url).href)});
`,
			],
			{ encoding: "utf8", timeout: 10_000 },
		);
		assert.equal(child.error, undefined);
		assert.equal(child.status, 1, child.stdout + child.stderr);
		assert.equal(child.stdout, "");
		assert.match(
			child.stderr,
			/Doom playback stopped at decision for decision #2/,
		);
		assert.match(
			child.stderr,
			/Decision #2 outcome may be unknown\. No retry was made\./,
		);
		assert.match(child.stderr, /navigationObjective: null/);
		assert.match(child.stderr, /perception: null/);
		assert.match(child.stderr, /navigationAssessment: null/);
		assert.doesNotMatch(
			child.stderr,
			/SECRET|records|beforePng|Buffer|Run artifact saved:/,
		);
		if (detachFails) {
			assert.match(child.stderr, /Doom playback and detach both failed\./);
			assert.match(child.stderr, /Doom operation or cleanup unconfirmed\./);
			assert.match(child.stderr, /Detach unconfirmed; client closed/);
		} else {
			assert.match(child.stderr, /Lease detached/);
			assert.doesNotMatch(child.stderr, /Doom playback and detach both failed/);
		}
	});
}

for (const modelId of [undefined, "synthetic-reasoning-override", ""]) {
	test(`reasoning model selection through main preserves ${modelId === undefined ? "the default" : modelId === "" ? "an empty override" : "an explicit override"}`, async (t) => {
		const f = await fixture(t);
		mocks.makeClient.mock.mockImplementation(() => f.client);
		mocks.makeTools.mock.mockImplementation(() => f.tools);
		mocks.makeProvider.mock.mockImplementation(() => f.provider);
		const previous = process.env.DOOM_REASONING_MODEL;
		t.after(() => {
			if (previous === undefined) delete process.env.DOOM_REASONING_MODEL;
			else process.env.DOOM_REASONING_MODEL = previous;
		});
		if (modelId === undefined) delete process.env.DOOM_REASONING_MODEL;
		else process.env.DOOM_REASONING_MODEL = modelId;
		const responses = t.mock.method(f.provider, "responses");
		t.mock.method(console, "log", () => {});
		const result = await main();
		assert.equal(responses.mock.callCount(), 4);
		assert.deepEqual(responses.mock.calls[0].arguments, [
			modelId ?? "gpt-6-luna",
		]);
		assert.equal(f.state.modelCalls, 4);
		assert.equal(result.outcome, "completed");
		assert.equal(
			result.perception.description,
			"A stone corridor is visible ahead.",
		);
		assert.deepEqual(result.perception.features, scenePerception.features);
		assert.equal(result.perception.usage.totalTokens, 0);
		assert.equal(f.events.filter((event) => event === "decide").length, 2);
	});
}

test("main constructs dependencies, attaches once, awaits one complete play, then detaches", async (t) => {
	const f = await fixture(t);
	mocks.makeClient.mock.mockImplementation(() => f.client);
	mocks.makeTools.mock.mockImplementation(() => f.tools);
	mocks.makeProvider.mock.mockImplementation(() => f.provider);
	const output = t.mock.method(console, "log", () => {});
	const detach = f.client.detach;
	f.client.detach = async () => {
		// Retained evidence does not rely on any executor-directory lifetime.
		await rm(f.root, { recursive: true, force: true });
		return detach();
	};
	const result = await main();
	for (const factory of [
		mocks.makeClient,
		mocks.makeTools,
		mocks.makeProvider,
		mocks.credentials,
	])
		assert.equal(factory.mock.callCount(), 1);
	assert.equal(mocks.playback.mock.callCount(), 1);
	const [client, tools, provider] = mocks.playback.mock.calls[0].arguments;
	assert.equal(client, f.client);
	assert.equal(tools, f.tools);
	assert.equal(provider, f.provider);
	assert.equal(mocks.getSession.mock.callCount(), 0);
	assert.equal(result.outcome, "completed");
	assert.equal(
		result.perception.description,
		"A stone corridor is visible ahead.",
	);
	assert.deepEqual(result.perception.features, scenePerception.features);
	assert.equal(result.perception.usage.totalTokens, 0);
	assert.deepEqual(result.records[0].beforePng, f.png);
	assert.equal(result.records[0].decision.kind, "returned");
	if (result.records[0].decision.kind !== "returned")
		throw Error("Expected receipt");
	assert.deepEqual(result.records[0].decision.afterPng, f.state.images[1]);
	const { records: _records, ...summary } = result;
	assert.deepEqual(output.mock.calls[0].arguments, [
		"Doom bounded-run result:",
		summary,
	]);
	assert.deepEqual(f.events, [
		"attach",
		"observe",
		"memory",
		"model",
		"assessment",
		"startRun",
		"setPrompt",
		"observe",
		"decide",
		"observe",
		"model",
		"assessment",
		"setPrompt",
		"observe",
		"decide",
		"detach",
	]);
});

for (const [budget, unclaimed, label] of [
	[null, false, "absent"],
	[2, false, "already claimed"],
	[-1, true, "negative"],
	[1.5, true, "fractional"],
	[Infinity, true, "infinite"],
	[NaN, true, "NaN"],
	[Number.MAX_SAFE_INTEGER + 1, true, "unsafe"],
	[0, true, "invalid zero"],
] as const) {
	test(`main rejects ${label} budget before playback and detaches`, async (t) => {
		const f = await fixture(t);
		mocks.makeClient.mock.mockImplementation(() => f.client);
		mocks.makeTools.mock.mockImplementation(() => f.tools);
		mocks.makeProvider.mock.mockImplementation(() => f.provider);
		const attach = f.client.attach;
		f.client.attach = async () => ({
			...(await attach()),
			configuredDecisionBudget: budget,
			budgetUnclaimedAtAttach: unclaimed,
		});
		let playbackCalls = 0;
		const responses = t.mock.method(f.provider, "responses");
		mocks.playback.mock.mockImplementation(async () => {
			playbackCalls++;
			throw new Error("playback must not run");
		});
		await assert.rejects(
			main(),
			(error: unknown) =>
				error instanceof Error &&
				/Doom bounded-run preflight failed/.test(error.message),
		);
		assert.equal(playbackCalls, 0);
		assert.equal(responses.mock.callCount(), 0);
		assert.equal(f.state.modelCalls, 0);
		assert.deepEqual(f.events, ["attach", "detach"]);
	});
}

test("main does not detach while playback is pending", async (t) => {
	const f = await fixture(t);
	mocks.makeClient.mock.mockImplementation(() => f.client);
	mocks.makeTools.mock.mockImplementation(() => f.tools);
	mocks.makeProvider.mock.mockImplementation(() => f.provider);
	t.mock.method(console, "log", () => {});
	let release!: () => void;
	let entered!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const failure = new Error("synthetic playback failure");
	mocks.playback.mock.mockImplementation(async (...args) => {
		assert.deepEqual(args, [f.client, f.tools, f.provider, 2]);
		entered();
		await pending;
		throw failure;
	});
	const running = main();
	await started;
	assert.deepEqual(f.events, ["attach"]);
	const rejected = assert.rejects(running, (error) => error === failure);
	release();
	await rejected;
	assert.deepEqual(f.events, ["attach", "detach"]);
});

test("both playback and detach failures remain available in the AggregateError", async (t) => {
	const f = await fixture(t);
	mocks.makeClient.mock.mockImplementation(() => f.client);
	mocks.makeTools.mock.mockImplementation(() => f.tools);
	mocks.makeProvider.mock.mockImplementation(() => f.provider);
	t.mock.method(console, "log", () => {});
	const playbackFailure = new Error("synthetic playback");
	const detachFailure = new Error("synthetic detach");
	f.client.detach = async () => {
		f.events.push("detach");
		throw detachFailure;
	};
	mocks.playback.mock.mockImplementation(async () => {
		throw playbackFailure;
	});
	await assert.rejects(main(), (error) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [playbackFailure, detachFailure]);
		return true;
	});
	assert.deepEqual(f.events, ["attach", "detach"]);
});

test("main detaches after an uncertain real playback transaction", async (t) => {
	const f = await fixture(t);
	mocks.makeClient.mock.mockImplementation(() => f.client);
	mocks.makeTools.mock.mockImplementation(() => f.tools);
	mocks.makeProvider.mock.mockImplementation(() => f.provider);
	t.mock.method(console, "log", () => {});
	const decide = f.client.decide;
	const cause = new Error("lost decision acknowledgment");
	f.client.decide = async (input) => {
		await decide(input);
		throw cause;
	};
	await assert.rejects(main(), (error) => {
		assert.ok(error instanceof PlaybackError);
		assert.equal(error.cause, cause);
		assert.equal(error.decisionMayHaveBeenSent, true);
		assert.equal(error.records[0]?.decision.kind, "unconfirmed");
		assert.equal(
			error.perception?.description,
			"A stone corridor is visible ahead.",
		);
		assert.deepEqual(error.perception?.features, scenePerception.features);
		assert.equal(error.perception?.usage.totalTokens, 0);
		assert.deepEqual(error.navigationObjective, {
			kind: "landmark",
			noteId: f.note.noteId,
			revision: f.note.revision,
		});
		return true;
	});
	assert.equal(f.events.filter((event) => event === "decide").length, 1);
	assert.equal(f.events.at(-1), "detach");
});

test("main waits for second decision, retains both images through detach, and prints only its summary", async (t) => {
	const f = await fixture(t);
	mocks.makeClient.mock.mockImplementation(() => f.client);
	mocks.makeTools.mock.mockImplementation(() => f.tools);
	mocks.makeProvider.mock.mockImplementation(() => f.provider);
	const output = t.mock.method(console, "log", () => {});
	let release!: () => void;
	let entered!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const secondEntered = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const decide = f.client.decide;
	let calls = 0;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		if (++calls === 2) {
			entered();
			await pending;
		}
		return receipt;
	};
	const detach = f.client.detach;
	f.client.detach = async () => {
		await rm(f.root, { recursive: true, force: true });
		return detach();
	};
	const work = main();
	await secondEntered;
	assert.equal(f.events.includes("detach"), false);
	release();
	const result = await work;
	assert.equal(result.decisionOrdinal, 2);
	assert.equal(result.records.length, 2);
	for (const [i, record] of result.records.entries()) {
		assert.deepEqual(record.beforePng, f.state.images[i]);
		assert.equal(record.decision.kind, "returned");
		if (record.decision.kind !== "returned") throw Error("Expected receipt");
		assert.deepEqual(record.decision.afterPng, f.state.images[i + 1]);
	}
	const { records: _records, ...summary } = result;
	assert.deepEqual(output.mock.calls[0].arguments, [
		"Doom bounded-run result:",
		summary,
	]);
	assert.doesNotMatch(
		JSON.stringify(output.mock.calls[0].arguments),
		/records|beforePng|afterPng|pngPath|Buffer|recentPoseComparison/,
	);
	assert.equal(f.events.at(-1), "detach");
});

test("second-slot playback and detach failures preserve both records in AggregateError", async (t) => {
	const f = await fixture(t);
	mocks.makeClient.mock.mockImplementation(() => f.client);
	mocks.makeTools.mock.mockImplementation(() => f.tools);
	mocks.makeProvider.mock.mockImplementation(() => f.provider);
	const cause = new Error("second decision response lost");
	const cleanup = new Error("detach response lost");
	const decide = f.client.decide;
	let calls = 0;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		if (++calls === 2) throw cause;
		return receipt;
	};
	f.client.detach = async () => {
		f.events.push("detach");
		throw cleanup;
	};
	await assert.rejects(main(), (error) => {
		assert.ok(error instanceof AggregateError);
		const [playback, detach] = error.errors;
		assert.ok(playback instanceof PlaybackError);
		assert.equal(playback.cause, cause);
		assert.equal(playback.decisionOrdinal, 2);
		assert.equal(playback.decisionMayHaveBeenSent, true);
		assert.deepEqual(
			playback.records.map((r) => r.decision.kind),
			["returned", "unconfirmed"],
		);
		assert.equal(detach, cleanup);
		return true;
	});
	assert.equal(calls, 2);
	assert.equal(f.events.filter((e) => e === "startRun").length, 1);
	assert.equal(f.events.at(-1), "detach");
});

for (const budget of [1, 3, 5]) {
	test(`main accepts hint ${budget}, waits through the issued run and prints no records`, async (t) => {
		const f = await fixture(t, budget);
		mocks.makeClient.mock.mockImplementation(() => f.client);
		mocks.makeTools.mock.mockImplementation(() => f.tools);
		mocks.makeProvider.mock.mockImplementation(() => f.provider);
		const output = t.mock.method(console, "log", () => {});
		const result = await main();
		assert.equal(result.decisionOrdinal, budget);
		assert.equal(result.records.length, budget);
		assert.equal(mocks.playback.mock.calls[0].arguments[3], budget);
		assert.equal(f.events.filter((e) => e === "attach").length, 1);
		assert.equal(f.events.filter((e) => e === "startRun").length, 1);
		assert.equal(f.events.at(-1), "detach");
		assert.doesNotMatch(
			JSON.stringify(output.mock.calls[0].arguments),
			/records|beforePng|afterPng|pngPath|Buffer/,
		);
	});
}

for (const issued of [1, 5]) {
	test(`main rejects issued ${issued} differing from attach hint 3 and detaches without dispatch`, async (t) => {
		const f = await fixture(t, 3);
		mocks.makeClient.mock.mockImplementation(() => f.client);
		mocks.makeTools.mock.mockImplementation(() => f.tools);
		mocks.makeProvider.mock.mockImplementation(() => f.provider);
		const start = f.client.startRun;
		f.client.startRun = async (input) => {
			const ack = await start(input);
			assert.ok(ack.run);
			ack.run = { ...ack.run, limit: issued, remaining: issued };
			return ack;
		};
		await assert.rejects(main(), (error) => {
			assert.ok(error instanceof PlaybackError);
			assert.equal(error.stage, "start-run");
			assert.equal(error.decisionMayHaveBeenSent, false);
			assert.equal(error.records[0].runStarted?.run?.limit, issued);
			return true;
		});
		assert.equal(f.events.filter((e) => e === "startRun").length, 1);
		assert.equal(f.events.includes("setPrompt"), false);
		assert.equal(f.events.includes("decide"), false);
		assert.equal(f.events.at(-1), "detach");
	});
}
