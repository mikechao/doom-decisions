import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { PlaybackError, play } from "../src/doom-play-agent.ts";
import { main } from "../src/main.ts";
import { fixture, scenePerception } from "./fixtures.ts";

function capture(t: TestContext) {
	const stderr: string[] = [];
	const stdout: string[] = [];
	t.mock.method(process.stderr, "write", (chunk: unknown) => {
		stderr.push(String(chunk));
		return true;
	});
	t.mock.method(process.stdout, "write", (chunk: unknown) => {
		stdout.push(String(chunk));
		return true;
	});
	return { stderr, stdout };
}

test("milestones use stderr, preserve final stdout and omit advisory/model data", async (t) => {
	const f = await fixture(t);
	const { stderr, stdout } = capture(t);
	const find = f.tools.findActiveLandmarks;
	f.tools.findActiveLandmarks = async (o) => ({
		...(await find(o)),
		hasMore: true,
	});
	const setPrompt = f.client.setPrompt;
	f.client.setPrompt = async (input) => {
		assert.doesNotMatch(stderr.join(""), /guidance acknowledged/);
		return setPrompt(input);
	};
	const decide = f.client.decide;
	f.client.decide = async (input) => {
		assert.match(stderr.join(""), /guidance acknowledged/);
		return decide(input);
	};
	await main(() => f.client, {
		makeTools: () => f.tools,
		makeProvider: () => f.provider,
	});
	const output = stderr.join("");
	assert.match(output, /\[doom\] Attached; observed E1M1 at tic 43/);
	assert.match(output, /lookup: found; 1 returned; more available/);
	assert.match(output, /Objective: landmark note#[0-9a-f]{12} \(revision 2\)/);
	assert.ok(
		output.indexOf("Perceiving") < output.indexOf("Scene perception completed"),
	);
	assert.match(output, /outcome: completed; requested 6, verified 6 tics/);
	assert.match(output, /\[doom\] Lease detached/);
	for (const secret of [
		f.note.noteId,
		f.note.hypothesis,
		f.note.nextQuestion,
		f.base.configuration.instructionTemplate,
		scenePerception.description,
		f.root,
	]) {
		assert.ok(!output.includes(secret ?? ""));
	}
	assert.ok(!output.includes(String.fromCharCode(27)));
	assert.match(stdout.join(""), /^Doom one-decision result:/);
	assert.doesNotMatch(
		stdout.join(""),
		/\[doom\]|\[navigation\]|\[perception\]|\[decision\]/,
	);
});

for (const status of ["empty", "unavailable", "lookup_failed"] as const) {
	test(`${status} logs the distinct fallback without asserting an active total`, async (t) => {
		const f = await fixture(t);
		const { stderr, stdout } = capture(t);
		const find = f.tools.findActiveLandmarks;
		f.tools.findActiveLandmarks = async (o) => ({
			...(await find(o)),
			status,
			candidates: [],
		});
		await play(f.client, f.tools, f.provider);
		const output = stderr.join("");
		assert.ok(output.includes(`lookup: ${status}; 0 returned`));
		assert.match(output, /Objective: free explore/);
		assert.match(output, /Base prompt unchanged/);
		assert.doesNotMatch(
			output,
			/guidance acknowledged|total|no active landmarks/,
		);
		assert.equal(stdout.length, 0);
	});
}

for (const operation of ["setPrompt", "decide"] as const) {
	test(`lost ${operation} acknowledgment is never logged as success`, async (t) => {
		const f = await fixture(t);
		const { stderr } = capture(t);
		const original = f.client[operation].bind(f.client);
		Object.assign(f.client, {
			[operation]: async (input: never) => {
				await original(input);
				throw Error("SECRET /private/raw-error");
			},
		});
		await assert.rejects(play(f.client, f.tools, f.provider), PlaybackError);
		const output = stderr.join("");
		assert.doesNotMatch(output, /Action:|SECRET|raw-error/);
		if (operation === "setPrompt")
			assert.doesNotMatch(
				output,
				/guidance acknowledged|Base prompt unchanged/,
			);
		else assert.match(output, /decision outcome unconfirmed/);
	});
}

test("uncertain receipt and detach failure stay explicit and bounded", async (t) => {
	const f = await fixture(t);
	const { stderr } = capture(t);
	const decide = f.client.decide;
	f.client.decide = async (input) => ({
		...(await decide(input)),
		outcome: "retired",
		completionUncertain: true,
		verifiedTics: null,
	});
	f.client.detach = async () => {
		throw Error("SECRET /private/raw-error");
	};
	await assert.rejects(
		main(() => f.client, {
			makeTools: () => f.tools,
			makeProvider: () => f.provider,
		}),
	);
	const output = stderr.join("");
	assert.match(
		output,
		/outcome: retired; requested 6, verified unknown tics; completion uncertain/,
	);
	assert.match(output, /Detach unconfirmed; client closed/);
	assert.doesNotMatch(output, /Lease detached|SECRET|raw-error/);
});
