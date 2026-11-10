import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { PlaybackError } from "../src/doom-play-agent.ts";
import { fixture, scenePerception } from "./fixtures.ts";
import { installMainMocks } from "./main-mocks.ts";

const mocks = installMainMocks();
const { main } = await import("../src/main.ts");

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
		"Doom two-decision result:",
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
	[1, true, "mismatched"],
	[3, true, "larger"],
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
				/Doom two-decision preflight failed/.test(error.message),
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
		assert.deepEqual(args, [f.client, f.tools, f.provider]);
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
		"Doom two-decision result:",
		summary,
	]);
	assert.doesNotMatch(
		JSON.stringify(output.mock.calls[0].arguments),
		/records|beforePng|afterPng|pngPath|Buffer/,
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
