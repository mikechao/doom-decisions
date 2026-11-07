import assert from "node:assert/strict";
import test from "node:test";
import { PlaybackError } from "../src/doom-play-agent.ts";
import { main } from "../src/main.ts";
import { fixture } from "./fixtures.ts";

test("main constructs dependencies, attaches once, awaits one complete play, then detaches", async (t) => {
	const f = await fixture(t);
	t.mock.method(console, "log", () => {});
	const result = await main(() => f.client, {
		makeTools: () => f.tools,
		makeProvider: () => f.provider,
	});
	assert.equal(result.outcome, "completed");
	assert.deepEqual(f.events, [
		"attach",
		"observe",
		"memory",
		"model",
		"startRun",
		"setPrompt",
		"observe",
		"decide",
		"detach",
	]);
});

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
		playback: async () => {
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
