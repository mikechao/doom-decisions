import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { PlaybackError } from "../src/doom-play-agent.ts";
import { main } from "../src/main.ts";
import { fixture, scenePerception } from "./fixtures.ts";

for (const modelId of [undefined, "synthetic-reasoning-override", ""]) {
	test(`reasoning model selection through main preserves ${modelId === undefined ? "the default" : modelId === "" ? "an empty override" : "an explicit override"}`, async (t) => {
		const f = await fixture(t);
		const previous = process.env.DOOM_REASONING_MODEL;
		t.after(() => {
			if (previous === undefined) delete process.env.DOOM_REASONING_MODEL;
			else process.env.DOOM_REASONING_MODEL = previous;
		});
		if (modelId === undefined) delete process.env.DOOM_REASONING_MODEL;
		else process.env.DOOM_REASONING_MODEL = modelId;
		const responses = t.mock.method(f.provider, "responses");
		t.mock.method(console, "log", () => {});
		const result = await main(() => f.client, {
			makeTools: () => f.tools,
			makeProvider: () => f.provider,
		});
		assert.equal(responses.mock.callCount(), 2);
		assert.deepEqual(responses.mock.calls[0].arguments, [
			modelId ?? "gpt-6-luna",
		]);
		assert.equal(f.state.modelCalls, 2);
		assert.equal(result.outcome, "completed");
		assert.equal(
			result.perception.description,
			"A stone corridor is visible ahead.",
		);
		assert.deepEqual(result.perception.features, scenePerception.features);
		assert.equal(result.perception.usage.totalTokens, 0);
		assert.equal(f.events.filter((event) => event === "decide").length, 1);
	});
}

test("main constructs dependencies, attaches once, awaits one complete play, then detaches", async (t) => {
	const f = await fixture(t);
	const output = t.mock.method(console, "log", () => {});
	const detach = f.client.detach;
	f.client.detach = async () => {
		// Retained evidence does not rely on any executor-directory lifetime.
		await rm(f.root, { recursive: true, force: true });
		return detach();
	};
	const result = await main(() => f.client, {
		makeTools: () => f.tools,
		makeProvider: () => f.provider,
	});
	assert.equal(result.outcome, "completed");
	assert.equal(
		result.perception.description,
		"A stone corridor is visible ahead.",
	);
	assert.deepEqual(result.perception.features, scenePerception.features);
	assert.equal(result.perception.usage.totalTokens, 0);
	assert.deepEqual(result.record.beforePng, f.png);
	assert.equal(result.record.decision.kind, "returned");
	if (result.record.decision.kind !== "returned")
		throw Error("Expected receipt");
	assert.deepEqual(result.record.decision.afterPng, f.png);
	const { record: _record, ...summary } = result;
	assert.deepEqual(output.mock.calls[0].arguments, [
		"Doom one-decision result:",
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
		"detach",
	]);
});

for (const [budget, unclaimed, label] of [
	[null, false, "absent"],
	[1, false, "already claimed"],
	[2, true, "mismatched"],
	[0, true, "invalid zero"],
] as const) {
	test(`main rejects ${label} budget before playback and detaches`, async (t) => {
		const f = await fixture(t);
		const attach = f.client.attach;
		f.client.attach = async () => ({
			...(await attach()),
			configuredDecisionBudget: budget,
			budgetUnclaimedAtAttach: unclaimed,
		});
		let playbackCalls = 0;
		const responses = t.mock.method(f.provider, "responses");
		await assert.rejects(
			main(() => f.client, {
				makeTools: () => f.tools,
				makeProvider: () => f.provider,
				playback: async () => {
					playbackCalls++;
					throw new Error("playback must not run");
				},
			}),
			(error: unknown) =>
				error instanceof Error &&
				/Doom one-decision preflight failed/.test(error.message),
		);
		assert.equal(playbackCalls, 0);
		assert.equal(responses.mock.callCount(), 0);
		assert.equal(f.state.modelCalls, 0);
		assert.deepEqual(f.events, ["attach", "detach"]);
	});
}

test("main does not detach while playback is pending", async (t) => {
	const f = await fixture(t);
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
	const running = main(() => f.client, {
		makeTools: () => f.tools,
		makeProvider: () => f.provider,
		playback: async (...args) => {
			assert.deepEqual(args, [f.client, f.tools, f.provider]);
			entered();
			await pending;
			throw failure;
		},
	});
	await started;
	assert.deepEqual(f.events, ["attach"]);
	const rejected = assert.rejects(running, (error) => error === failure);
	release();
	await rejected;
	assert.deepEqual(f.events, ["attach", "detach"]);
});

test("both playback and detach failures remain available in the AggregateError", async (t) => {
	const f = await fixture(t);
	t.mock.method(console, "log", () => {});
	const playbackFailure = new Error("synthetic playback");
	const detachFailure = new Error("synthetic detach");
	f.client.detach = async () => {
		f.events.push("detach");
		throw detachFailure;
	};
	await assert.rejects(
		main(() => f.client, {
			makeTools: () => f.tools,
			makeProvider: () => f.provider,
			playback: async () => {
				throw playbackFailure;
			},
		}),
		(error) => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [playbackFailure, detachFailure]);
			return true;
		},
	);
	assert.deepEqual(f.events, ["attach", "detach"]);
});

test("main detaches after an uncertain real playback transaction", async (t) => {
	const f = await fixture(t);
	t.mock.method(console, "log", () => {});
	const decide = f.client.decide;
	const cause = new Error("lost decision acknowledgment");
	f.client.decide = async (input) => {
		await decide(input);
		throw cause;
	};
	await assert.rejects(
		main(() => f.client, {
			makeTools: () => f.tools,
			makeProvider: () => f.provider,
		}),
		(error) => {
			assert.ok(error instanceof PlaybackError);
			assert.equal(error.cause, cause);
			assert.equal(error.decisionMayHaveBeenSent, true);
			assert.equal(error.record?.decision.kind, "unconfirmed");
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
		},
	);
	assert.equal(f.events.filter((event) => event === "decide").length, 1);
	assert.equal(f.events.at(-1), "detach");
});
