import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import { PlaybackError, play } from "../src/doom-play-agent.ts";
import { progress } from "../src/progress.ts";
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

function decisionBoundaries(output: string) {
	return Array.from(
		output.matchAll(/^\[info\] \[decision\] (?:Start|End) of Decision \d+$/gm),
		(match) => match[0],
	);
}

function assertPromptBlock(
	output: string,
	ordinal: number,
	instructions: string,
) {
	const startLabel = `[info] [decision] Start of Decisions API Prompt for Decision ${ordinal}`;
	const endLabel = `End of Decisions API Prompt for Decision ${ordinal}`;
	const start = output.indexOf(startLabel);
	assert.ok(start >= 0, `missing prompt start for decision ${ordinal}`);
	assert.equal(output.indexOf(startLabel, start + startLabel.length), -1);
	const instructionsStart = start + startLabel.length + 1;
	const end = output.indexOf(endLabel, instructionsStart);
	assert.ok(
		end > instructionsStart,
		`missing prompt end for decision ${ordinal}`,
	);
	assert.equal(output[end - 1], "\n");
	assert.equal(output.slice(instructionsStart, end - 1), instructions);
	return { start, end: end + endLabel.length };
}

test("one-decision run logs a start and end around its progress", async (t) => {
	const f = await fixture(t, 1);
	const { stderr } = capture(t);
	const prompted = t.mock.method(f.client, "setPrompt");

	const result = await play(f.client, f.tools, f.provider);

	assert.equal(result.records.length, 1);
	const output = stderr.join("");
	assert.equal(prompted.mock.callCount(), 1);
	const instructions = prompted.mock.calls[0].arguments[0].instructions;
	assert.equal(result.records[0].guidance, instructions);
	assert.equal(
		result.records[0].promptAcknowledged?.instructions,
		instructions,
	);
	const prompt = assertPromptBlock(output, 1, instructions);
	assert.deepEqual(decisionBoundaries(output), [
		"[info] [decision] Start of Decision 1",
		"[info] [decision] End of Decision 1",
	]);
	const decisionOutput = output.slice(
		output.indexOf("Start of Decision 1"),
		output.indexOf("End of Decision 1"),
	);
	assert.match(decisionOutput, /Perceiving current scene/);
	assert.match(decisionOutput, /Navigation guidance acknowledged/);
	assert.match(decisionOutput, /Action: forward; outcome: completed/);
	assert.ok(
		output.indexOf("Navigation guidance acknowledged") < prompt.start &&
			prompt.end < output.indexOf("End of Decision 1"),
	);
});

test("a prompt acknowledgment with a mismatched echo is not logged as successful", async (t) => {
	const f = await fixture(t, 1);
	const { stderr } = capture(t);
	const setPrompt = f.client.setPrompt;
	f.client.setPrompt = async (input) => ({
		...(await setPrompt(input)),
		instructions: "untrusted prompt echo",
	});

	const result = await play(f.client, f.tools, f.provider);

	assert.equal(result.outcome, "completed");
	assert.equal(result.records[0].guidance, f.state.instructions);
	assert.equal(
		result.records[0].promptAcknowledged?.instructions,
		"untrusted prompt echo",
	);
	assert.doesNotMatch(
		stderr.join(""),
		/Navigation guidance acknowledged|Start of Decisions API Prompt|End of Decisions API Prompt/,
	);
});

test("three-decision run interleaves one boundary pair with each decision", async (t) => {
	const f = await fixture(t, 3);
	const { stderr } = capture(t);
	const prompted = t.mock.method(f.client, "setPrompt");

	const result = await play(f.client, f.tools, f.provider);

	assert.equal(result.records.length, 3);
	const output = stderr.join("");
	assert.equal(prompted.mock.callCount(), 3);
	assert.deepEqual(decisionBoundaries(output), [
		"[info] [decision] Start of Decision 1",
		"[info] [decision] End of Decision 1",
		"[info] [decision] Start of Decision 2",
		"[info] [decision] End of Decision 2",
		"[info] [decision] Start of Decision 3",
		"[info] [decision] End of Decision 3",
	]);
	for (let ordinal = 1; ordinal <= 3; ordinal++) {
		const start = output.indexOf(`Start of Decision ${ordinal}`);
		const end = output.indexOf(`End of Decision ${ordinal}`);
		const decisionOutput = output.slice(start, end);
		assert.ok(start >= 0 && end > start);
		assert.match(decisionOutput, /Perceiving current scene/);
		assert.match(decisionOutput, /Navigation guidance acknowledged/);
		assert.match(decisionOutput, /Action: forward; outcome: completed/);
		const diagnostic = `Decision ${ordinal} (forward; verified 6 tics): net reported pose deltas; distance=1 Doom units; headingDelta=0 degrees`;
		assert.equal(decisionOutput.split(diagnostic).length - 1, 1);
		assert.equal(result.records[ordinal - 1].movement.status, "available");
		const instructions =
			prompted.mock.calls[ordinal - 1].arguments[0].instructions;
		assert.equal(result.records[ordinal - 1].guidance, instructions);
		assert.equal(
			result.records[ordinal - 1].promptAcknowledged?.instructions,
			instructions,
		);
		assert.ok(
			instructions.startsWith(
				`${f.base.configuration.instructionTemplate}\n\nNavigation amendment for the next decision:`,
			),
		);
		assert.equal(
			instructions.match(/Navigation amendment for the next decision:/g)
				?.length,
			1,
		);
		const prompt = assertPromptBlock(output, ordinal, instructions);
		assert.ok(
			output.indexOf("Navigation guidance acknowledged", start) <
				prompt.start && prompt.end < end,
		);
	}
	const promptStarts = Array.from(
		output.matchAll(/Start of Decisions API Prompt for Decision (\d+)/g),
		(match) => Number(match[1]),
	);
	assert.deepEqual(promptStarts, [1, 2, 3]);
	assert.deepEqual(f.events, [
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
		"observe",
		"model",
		"assessment",
		"setPrompt",
		"observe",
		"decide",
	]);
	for (const record of result.records) {
		assert.doesNotMatch(
			record.guidance ?? "",
			/net reported pose|headingDelta|dxRaw/,
		);
		if (record.decision.kind !== "returned") throw Error("Expected receipt");
		assert.equal(
			record.decision.receipt.observation?.previousAction?.text,
			"Synthetic forward action.",
		);
	}
});

test("movement logger exceptions cannot affect retention or continuation", async (t) => {
	const f = await fixture(t, 3);
	const withTag = progress.withTag.bind(progress);
	let attempts = 0;
	t.mock.method(progress, "withTag", (tag: string) => {
		const logger = withTag(tag);
		const info = logger.info.bind(logger);
		t.mock.method(logger, "info", (...args: unknown[]) => {
			if (String(args[0]).includes("net reported pose deltas")) {
				attempts++;
				throw Error("Synthetic diagnostic logging failure");
			}
			info(args[0], ...args.slice(1));
		});
		return logger;
	});
	const result = await play(f.client, f.tools, f.provider);
	assert.equal(attempts, 3);
	assert.equal(result.outcome, "completed");
	assert.deepEqual(
		result.records.map((r) => r.ordinal),
		[1, 2, 3],
	);
	for (const record of result.records) {
		assert.equal(record.movement.status, "available");
		assert.equal(record.failure, null);
		if (record.decision.kind !== "returned") throw Error("Expected receipt");
		assert.ok(record.decision.afterPng);
	}
});

test("a non-continuable second receipt ends decision 2 without starting decision 3", async (t) => {
	const f = await fixture(t, 3);
	const { stderr } = capture(t);
	const decide = f.client.decide;
	let calls = 0;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		if (++calls === 2) receipt.outcome = "terminal";
		return receipt;
	};

	const result = await play(f.client, f.tools, f.provider);

	assert.equal(result.decisionOrdinal, 2);
	assert.equal(result.records.length, 2);
	assert.deepEqual(result.records[1].movement, {
		status: "unavailable",
		reason: "not-completed",
	});
	const output = stderr.join("");
	assert.deepEqual(decisionBoundaries(output), [
		"[info] [decision] Start of Decision 1",
		"[info] [decision] End of Decision 1",
		"[info] [decision] Start of Decision 2",
		"[info] [decision] End of Decision 2",
	]);
	assert.match(
		output,
		/Decision 2 \(forward; verified 6 tics\): net reported pose deltas; unavailable: not-completed/,
	);
	assert.deepEqual(
		Array.from(
			output.matchAll(/Start of Decisions API Prompt for Decision (\d+)/g),
			(match) => Number(match[1]),
		),
		[1, 2],
	);
});

test("a third-decision exception ends its boundary and preserves the cause and records", async (t) => {
	const f = await fixture(t, 3);
	const { stderr } = capture(t);
	const cause = new Error("third decision failed");
	const decide = f.client.decide;
	let calls = 0;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		if (++calls === 3) throw cause;
		return receipt;
	};

	await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
		assert.ok(error instanceof PlaybackError);
		assert.equal(error.cause, cause);
		assert.equal(error.decisionOrdinal, 3);
		assert.equal(error.records.length, 3);
		assert.deepEqual(
			error.records.map((record) => record.decision.kind),
			["returned", "returned", "unconfirmed"],
		);
		assert.equal(error.records[2].failure?.stage, "decision");
		assert.deepEqual(error.records[2].movement, {
			status: "unavailable",
			reason: "decision-not-returned",
		});
		return true;
	});

	const output = stderr.join("");
	assert.deepEqual(decisionBoundaries(output), [
		"[info] [decision] Start of Decision 1",
		"[info] [decision] End of Decision 1",
		"[info] [decision] Start of Decision 2",
		"[info] [decision] End of Decision 2",
		"[info] [decision] Start of Decision 3",
		"[info] [decision] End of Decision 3",
	]);
	assert.ok(
		output.indexOf("Stopped at decision for decision #3") <
			output.indexOf("End of Decision 3"),
	);
	const thirdDecisionOutput = output.slice(
		output.indexOf("Start of Decision 3"),
		output.indexOf("End of Decision 3"),
	);
	assert.doesNotMatch(thirdDecisionOutput, /Action: /);
});

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
		if (f.state.decisionTemplates.length === 0)
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
	assert.equal(f.events.filter((event) => event === "decide").length, 2);
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
		unselected.hypothesis,
		unselected.nextQuestion,
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
	assert.deepEqual(f.state.decisionTemplates, [
		f.state.instructions,
		f.state.instructions,
	]);
	assert.ok(output.includes(f.state.instructions));
	assert.ok(!output.includes(String.fromCharCode(27)));
	assert.match(stdout.join(""), /^Doom bounded-run result:/);
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
	assert.equal(f.events.filter((event) => event === "decide").length, 2);
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
	assert.equal(f.events.filter((event) => event === "decide").length, 2);
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
		const prompted = t.mock.method(f.client, "setPrompt");
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
		assert.equal(prompted.mock.callCount(), 2);
		for (const [index, call] of prompted.mock.calls.entries()) {
			const instructions = call.arguments[0].instructions;
			assert.match(
				instructions,
				/Current objective: free explore \(free-explore\)/,
			);
			assertPromptBlock(output, index + 1, instructions);
		}
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
		if (operation === "setPrompt")
			assert.doesNotMatch(
				output,
				/Start of Decisions API Prompt|End of Decisions API Prompt/,
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
