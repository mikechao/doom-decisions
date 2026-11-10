import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import { PlaybackError, play } from "../src/doom-play-agent.ts";
import { fixture, scenePerception } from "./fixtures.ts";
import { installMainMocks } from "./main-mocks.ts";

const mocks = installMainMocks();
const { main } = await import("../src/main.ts");

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

test("milestones log objective and perception to stderr and preserve final stdout", async (t) => {
	const f = await fixture(t);
	mocks.makeClient.mock.mockImplementation(() => f.client);
	mocks.makeTools.mock.mockImplementation(() => f.tools);
	mocks.makeProvider.mock.mockImplementation(() => f.provider);
	const { stderr, stdout } = capture(t);
	const selected = {
		...f.note,
		hypothesis: "The selected lead describes a narrow stone arch.",
		nextQuestion: "Can the next view show whether the arch has a blue edge?",
	};
	const unselected = {
		...f.note,
		noteId: "raw-unselected-note-id",
		hypothesis: "Unselected candidate text must stay private.",
		nextQuestion: "Unselected candidate question.",
	};
	f.state.candidates = [selected, unselected];
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
	const result = await main();
	assert.equal(result.outcome, "completed");
	assert.equal(f.events.filter((event) => event === "decide").length, 1);
	const output = stderr.join("");
	assert.match(output, /\[doom\] Attached; observed E1M1 at tic 43/);
	assert.match(output, /lookup: found; 2 returned; more available/);
	const fingerprint = createHash("sha256")
		.update(selected.noteId)
		.digest("hex")
		.slice(0, 12);
	assert.ok(
		output.includes(
			`Objective: investigate historical landmark note#${fingerprint} (revision ${selected.revision})\nHypothesis: ${JSON.stringify(selected.hypothesis)}\nNext question: ${JSON.stringify(selected.nextQuestion)}`,
		),
	);
	assert.ok(
		output.indexOf("Perceiving") < output.indexOf("Scene perception completed"),
	);
	assert.ok(
		output.includes(
			`Description: ${JSON.stringify(scenePerception.description)}`,
		),
	);
	assert.ok(
		output.includes(
			`Visible features: ${scenePerception.features.map((feature) => JSON.stringify(feature)).join(", ")}`,
		),
	);
	assert.ok(
		output.includes(
			`Uncertainty: ${JSON.stringify(scenePerception.uncertainty)}`,
		),
	);
	assert.match(output, /outcome: completed; requested 6, verified 6 tics/);
	assert.match(output, /\[doom\] Lease detached/);
	for (const secret of [
		selected.noteId,
		JSON.stringify(selected.anchor),
		unselected.hypothesis,
		unselected.nextQuestion,
		f.base.configuration.instructionTemplate,
		f.root,
	]) {
		assert.ok(!output.includes(secret ?? ""));
	}
	assert.ok(
		f.state.instructions.startsWith(f.base.configuration.instructionTemplate),
	);
	assert.ok(f.state.instructions.includes(JSON.stringify(selected.hypothesis)));
	assert.ok(
		f.state.instructions.includes(JSON.stringify(selected.nextQuestion)),
	);
	assert.deepEqual(f.state.decisionTemplates, [f.state.instructions]);
	assert.ok(!output.includes(String.fromCharCode(27)));
	assert.match(stdout.join(""), /^Doom one-decision result:/);
	assert.doesNotMatch(
		stdout.join(""),
		/\[doom\]|\[navigation\]|\[perception\]|\[decision\]/,
	);
});

test("perception newlines and ANSI escapes are quoted in stderr without changing results", async (t) => {
	const f = await fixture(t);
	const { stderr, stdout } = capture(t);
	const perception = {
		description: "A room.\u001b[31mRED\u001b[0m\n[forged]",
		features: ["door\u001b[31m\n[forged]"],
		uncertainty: "identity unclear\r\n[forged]",
	};
	f.state.perception = perception;

	const result = await play(f.client, f.tools, f.provider);
	const output = stderr.join("");

	assert.equal(result.perception.description, perception.description);
	assert.deepEqual(result.perception.features, perception.features);
	assert.equal(result.perception.uncertainty, perception.uncertainty);
	assert.ok(
		output.includes(`Description: ${JSON.stringify(perception.description)}`),
	);
	assert.ok(
		output.includes(
			`Visible features: ${perception.features.map((feature) => JSON.stringify(feature)).join(", ")}`,
		),
	);
	assert.ok(
		output.includes(`Uncertainty: ${JSON.stringify(perception.uncertainty)}`),
	);
	assert.ok(!output.includes("\u001b"));
	assert.doesNotMatch(output, /^\[forged\]/m);
	assert.equal(stdout.join(""), "");
	assert.equal(result.outcome, "completed");
	assert.equal(f.events.filter((event) => event === "decide").length, 1);
});

test("historical objective newlines and ANSI escapes are quoted in stderr", async (t) => {
	const f = await fixture(t);
	const { stderr, stdout } = capture(t);
	f.note.hypothesis = "A narrow arch.\n[forged]\u001b[31mRED\u001b[0m";
	f.note.nextQuestion = "Can the edge be seen?\r\n[forged]\u001b[2J";

	const result = await play(f.client, f.tools, f.provider);
	const output = stderr.join("");

	assert.ok(
		output.includes(`Hypothesis: ${JSON.stringify(f.note.hypothesis)}`),
	);
	assert.ok(
		output.includes(`Next question: ${JSON.stringify(f.note.nextQuestion)}`),
	);
	assert.ok(!output.includes("\u001b"));
	assert.doesNotMatch(output, /^\[forged\]/m);
	assert.equal(stdout.join(""), "");
	assert.equal(result.outcome, "completed");
	assert.equal(f.events.filter((event) => event === "decide").length, 1);
});

test("missing historical next question is reported without invention", async (t) => {
	const f = await fixture(t);
	const { stderr } = capture(t);
	f.note.nextQuestion = null;

	await play(f.client, f.tools, f.provider);

	const output = stderr.join("");
	assert.match(output, /Next question: \(none recorded\)/);
	assert.doesNotMatch(output, /Next question: (?!\(none recorded\))/);
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
		assert.doesNotMatch(output, /Hypothesis:|Next question:|note#[0-9a-f]{12}/);
		assert.match(output, /Navigation guidance acknowledged/);
		assert.doesNotMatch(
			output,
			/Base prompt unchanged|total|no active landmarks/,
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
	mocks.makeClient.mock.mockImplementation(() => f.client);
	mocks.makeTools.mock.mockImplementation(() => f.tools);
	mocks.makeProvider.mock.mockImplementation(() => f.provider);
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
	await assert.rejects(main());
	const output = stderr.join("");
	assert.match(
		output,
		/outcome: retired; requested 6, verified unknown tics; completion uncertain/,
	);
	assert.match(output, /Detach unconfirmed; client closed/);
	assert.doesNotMatch(output, /Lease detached|SECRET|raw-error/);
});

test("assessment strings stay escaped in stderr and advisory prompt JSON", async (t) => {
	const f = await fixture(t);
	const { stderr, stdout } = capture(t);
	const assessment = {
		verdict: "insufficient-evidence",
		evidence: "Ambiguous doorway.\u001b[31m\n[forged]",
		uncertainty: "Unknown identity.\r\n[forged]",
	};
	f.state.assessment = assessment;
	const result = await play(f.client, f.tools, f.provider);
	const output = stderr.join("");
	assert.ok(
		output.includes(`evidence: ${JSON.stringify(assessment.evidence)}`),
	);
	assert.ok(
		output.includes(`uncertainty: ${JSON.stringify(assessment.uncertainty)}`),
	);
	assert.ok(
		output.indexOf("Scene perception completed") <
			output.indexOf("Assessment:"),
	);
	assert.ok(
		output.indexOf("Assessment:") < output.indexOf("guidance acknowledged"),
	);
	assert.ok(!output.includes("\u001b"));
	assert.doesNotMatch(output, /^\[forged\]/m);
	assert.ok(
		output.includes(`Hypothesis: ${JSON.stringify(f.note.hypothesis)}`),
	);
	assert.equal(result.navigationAssessment?.evidence, assessment.evidence);
	assert.ok(f.state.instructions.includes(JSON.stringify(assessment.evidence)));
	assert.equal(stdout.length, 0);
});
