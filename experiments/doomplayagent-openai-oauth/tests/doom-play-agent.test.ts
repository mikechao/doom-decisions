import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import {
	PlaybackError,
	play,
	type ScenePerception,
} from "../src/doom-play-agent.ts";
import { fixture, navigationAssessment, scenePerception } from "./fixtures.ts";

// The fake model reports zero raw token counts; the SDK normalizes these to
// this complete LanguageModelUsage shape on the returned perception.
const zeroModelUsage: ScenePerception["usage"] = {
	inputTokens: 0,
	inputTokenDetails: {
		noCacheTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	},
	outputTokens: 0,
	outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
	totalTokens: 0,
};

function perceptionWithZeroUsage(value: unknown): ScenePerception {
	return {
		...(value as Pick<
			ScenePerception,
			"description" | "features" | "uncertainty"
		>),
		usage: zeroModelUsage,
	};
}

test("landmark lookup precedes objective-independent perception of exact bytes and compact state", async (t) => {
	const f = await fixture(t);
	f.state.candidates = [];
	const result = await play(f.client, f.tools, f.provider);
	assert.deepEqual(f.events, [
		"observe",
		"memory",
		"model",
		"startRun",
		"observe",
		"decide",
	]);
	assert.equal(result.outcome, "completed");
	assert.equal(result.promptChanged, false);
	assert.equal(result.navigationAssessment, null);
	assert.equal(f.state.modelCalls, 1);
	assert.deepEqual(result.tics, { requested: 6, reported: 6, verified: 6 });
	const input = f.state.modelInput as Parameters<typeof f.model.doGenerate>[0];
	const user = input.prompt.find((message) => message.role === "user");
	assert.ok(user);
	const image = user.content.find((part) => part.type === "file");
	assert.ok(
		image &&
			image.data.type === "data" &&
			image.data.data instanceof Uint8Array,
	);
	assert.equal(image.mediaType, "image/png");
	assert.deepEqual(Buffer.from(image.data.data), f.png);
	assert.match(JSON.stringify(input), /visible|uncertainty/);
	assert.doesNotMatch(
		JSON.stringify(input),
		/leaseFile|instructionTemplate|nativeSha256/,
	);
	assert.equal(input.tools?.length ?? 0, 0);
	assert.equal(input.responseFormat?.type, "json");
	assert.equal(f.state.memoryObservations.length, 1);
	assert.deepEqual(
		f.state.memoryObservations[0].mapIdentity,
		f.base.mapIdentity,
	);
	assert.deepEqual(result.navigationObjective, { kind: "free-explore" });
	const text = user.content.find((part) => part.type === "text");
	assert.ok(text && text.type === "text");
	const context = JSON.parse(text.text);
	assert.deepEqual(context, {
		state: {
			map: { mapSlot: f.base.mapIdentity.mapSlot },
			tic: f.base.tic,
			phase: f.base.phase,
			telemetry: f.base.telemetry,
			facingProbe: f.base.facingProbe,
			previousAction: null,
		},
	});
	assert.doesNotMatch(
		text.text,
		/navigationObjective|historicalLandmark|hypothesis/,
	);
	assert.deepEqual(
		result.perception,
		perceptionWithZeroUsage(f.state.perception),
	);
});

test("host selection preserves base and substitution through CAS, then decides once", async (t) => {
	const f = await fixture(t);
	f.state.perception = {
		description: "A wall and an open passage are visible.",
		features: ["A red keycard is visible."],
		uncertainty: "The passage's destination is not visible.",
	};
	// The host keeps tool ordering rather than letting the model choose another.
	f.state.candidates.push({
		...f.note,
		noteId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
		revision: 1,
	});
	const result = await play(f.client, f.tools, f.provider);
	assert.deepEqual(f.events, [
		"observe",
		"memory",
		"model",
		"assessment",
		"startRun",
		"setPrompt",
		"observe",
		"decide",
	]);
	assert.equal(result.promptChanged, true);
	assert.deepEqual(result.navigationObjective, {
		kind: "landmark",
		noteId: f.note.noteId,
		revision: f.note.revision,
	});
	assert.deepEqual(
		result.perception,
		perceptionWithZeroUsage(f.state.perception),
	);
	assert.ok(
		f.state.instructions.startsWith(f.base.configuration.instructionTemplate),
	);
	assert.equal(f.state.instructions.match(/\{\{tics\}\}/g)?.length, 2);
	assert.match(f.state.instructions, new RegExp(f.note.noteId));
	assert.match(f.state.instructions, /Reachability and geometry are uncertain/);
	assert.match(f.state.instructions, /observer pose/);
	assert.ok(f.state.instructions.includes(JSON.stringify(f.note.hypothesis)));
	assert.ok(f.state.instructions.includes(JSON.stringify(f.note.nextQuestion)));
	assert.doesNotMatch(
		f.state.instructions,
		/red keycard|destination is not visible/,
	);
	assert.doesNotMatch(f.state.instructions, /ffffffff-ffff/);
	assert.deepEqual(f.state.decisionTemplates, [f.state.instructions]);
	const input = f.state.modelInput as Parameters<typeof f.model.doGenerate>[0];
	const user = input.prompt.find((message) => message.role === "user");
	const text = user?.content.find((part) => part.type === "text");
	assert.ok(text && text.type === "text");
	const context = JSON.parse(text.text);
	assert.deepEqual(Object.keys(context), ["state"]);
	assert.doesNotMatch(
		text.text,
		/navigationObjective|historicalLandmark|doorway nearby/,
	);
	assert.equal(f.state.revision, f.base.revision + 1);
});

test("an empty feature list remains valid and reaches the play result", async (t) => {
	const f = await fixture(t);
	f.state.perception = {
		...scenePerception,
		features: [],
	};

	const result = await play(f.client, f.tools, f.provider);

	assert.deepEqual(result.perception.features, []);
	assert.equal(result.outcome, "completed");
	assert.equal(f.events.filter((event) => event === "decide").length, 1);
});

for (const status of ["empty", "unavailable", "lookup_failed"] as const) {
	test(`${status} active memory reports free exploration and preserves the base prompt`, async (t) => {
		const f = await fixture(t);
		const findActiveLandmarks = f.tools.findActiveLandmarks;
		f.tools.findActiveLandmarks = async (observation) => ({
			...(await findActiveLandmarks(observation)),
			status,
			candidates: [],
		});
		const result = await play(f.client, f.tools, f.provider);
		assert.equal(result.memoryStatus, status);
		assert.deepEqual(result.navigationObjective, { kind: "free-explore" });
		assert.equal(result.promptChanged, false);
		assert.equal(result.navigationAssessment, null);
		assert.equal(f.state.modelCalls, 1);
		assert.equal(f.events.filter((event) => event === "decide").length, 1);
		assert.equal(f.events.includes("setPrompt"), false);
		assert.deepEqual(f.state.decisionTemplates, [
			f.base.configuration.instructionTemplate,
		]);
	});
}

for (const perception of [
	{ ...scenePerception, navigationObjective: { kind: "free-explore" } },
	{ ...scenePerception, targetNoteId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
	{ ...scenePerception, description: "" },
	{ ...scenePerception, features: Array(9).fill("visible feature") },
]) {
	test("invalid or fabricated scene perception never claims a run", async (t) => {
		const f = await fixture(t);
		f.state.perception = perception;
		await assert.rejects(play(f.client, f.tools, f.provider), PlaybackError);
		assert.deepEqual(f.events, ["observe", "memory", "model"]);
	});
}

test("no candidates cannot authorize a fabricated landmark amendment", async (t) => {
	const f = await fixture(t);
	f.state.candidates = [];
	f.state.perception = {
		...scenePerception,
		targetNoteId: f.note.noteId,
	};
	await assert.rejects(play(f.client, f.tools, f.provider), PlaybackError);
	assert.equal(f.events.includes("startRun"), false);
});

test("landmark tool rejection prevents inference and run claim", async (t) => {
	const f = await fixture(t);
	f.tools.findActiveLandmarks = async () => {
		f.events.push("memory");
		throw Error("Invalid landmark evidence.");
	};
	await assert.rejects(play(f.client, f.tools, f.provider), PlaybackError);
	assert.deepEqual(f.events, ["observe", "memory"]);
});

for (const operation of ["startRun", "setPrompt", "decide"] as const) {
	test(`lost ${operation} acknowledgment is uncertain and never replayed`, async (t) => {
		const f = await fixture(t);
		const original = f.client[operation].bind(f.client);
		Object.assign(f.client, {
			[operation]: async (input: never) => {
				await original(input);
				throw Error("response lost");
			},
		});
		await assert.rejects(
			play(f.client, f.tools, f.provider),
			(error: unknown) => {
				assert.ok(error instanceof PlaybackError);
				assert.equal(error.decisionMayHaveBeenSent, operation === "decide");
				assert.equal(
					error.stage,
					operation === "startRun"
						? "start-run"
						: operation === "setPrompt"
							? "prompt-cas"
							: "decision",
				);
				assert.match(String(error.cause), /response lost/);
				assert.deepEqual(error.navigationAssessment, {
					...navigationAssessment,
					usage: zeroModelUsage,
				});
				assert.deepEqual(
					error.perception,
					perceptionWithZeroUsage(f.state.perception),
				);
				assert.deepEqual(error.navigationObjective, {
					kind: "landmark",
					noteId: f.note.noteId,
					revision: f.note.revision,
				});
				return true;
			},
		);
		assert.equal(f.events.filter((event) => event === operation).length, 1);
		assert.equal(
			f.events.filter((event) => event === "decide").length,
			operation === "decide" ? 1 : 0,
		);
	});
}

for (const fault of [
	"revision",
	"session",
	"map",
	"tic",
	"observation-id",
] as const) {
	test(`observation continuity: fresh ${fault} mismatch prevents decide`, async (t) => {
		const f = await fixture(t);
		const original = f.client.observe;
		f.client.observe = async () => {
			const o = await original();
			if (f.state.observeCalls > 1) {
				if (fault === "revision") o.revision++;
				if (fault === "session") o.sessionId = f.lease.ownerId;
				if (fault === "map") o.mapIdentity.mapKey = "another-verified-map";
				if (fault === "tic") o.tic++;
				if (fault === "observation-id") o.observationId = f.base.observationId;
			}
			return o;
		};
		await assert.rejects(play(f.client, f.tools, f.provider), PlaybackError);
		assert.equal(f.events.includes("decide"), false);
	});
}

test("fresh observation does not require full snapshot equality or reread its PNG", async (t) => {
	const f = await fixture(t);
	const original = f.client.observe;
	f.client.observe = async () => {
		const o = await original();
		if (f.state.observeCalls > 1) {
			// Valid passive capture metadata may vary without advancing simulation.
			o.counters.render++;
			o.counters.frame++;
			o.pngPath = "/unused-fresh-observation.png";
		}
		return o;
	};
	assert.equal(
		(await play(f.client, f.tools, f.provider)).outcome,
		"completed",
	);
	assert.equal(f.events.filter((event) => event === "decide").length, 1);
});

test("a terminal prefix is reported directly without final accounting", async (t) => {
	const f = await fixture(t);
	const decide = f.client.decide;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		assert.ok(receipt.observation && receipt.pngPath && f.state.run);
		receipt.outcome = "terminal";
		receipt.reportedTics = 2;
		receipt.verifiedTics = 2;
		receipt.cumulativeTics = f.base.tic + 2;
		receipt.observation.phase = "terminal";
		receipt.observation.tic = receipt.cumulativeTics;
		receipt.observation.frame.tic = receipt.cumulativeTics;
		receipt.observation.counters.gametic = receipt.cumulativeTics;
		return receipt;
	};
	const result = await play(f.client, f.tools, f.provider);
	assert.equal(result.outcome, "terminal");
	assert.deepEqual(result.tics, { requested: 6, reported: 2, verified: 2 });
});

test("uncertain retired receipt is diagnostic and cannot trigger replay", async (t) => {
	const f = await fixture(t);
	const decide = f.client.decide;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		assert.ok(receipt.observation && receipt.pngPath && f.state.run);
		return {
			...receipt,
			outcome: "retired",
			completionUncertain: true,
			observation: null,
			pngPath: null,
			verifiedTics: null,
			cumulativeTics: null,
		};
	};
	const result = await play(f.client, f.tools, f.provider);
	assert.equal(result.completionUncertain, true);
	assert.equal(f.events.filter((event) => event === "decide").length, 1);
});

test("model failure has no retry or browser mutation", async (t) => {
	const f = await fixture(t);
	const cause = Error("SECRET_MODEL_FAILURE");
	const generate = t.mock.method(f.model, "doGenerate", async () => {
		throw cause;
	});
	await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
		assert.ok(error instanceof PlaybackError);
		assert.equal(error.cause, cause);
		assert.equal(error.stage, "perception");
		assert.equal(error.decisionMayHaveBeenSent, false);
		assert.match(error.message, /No decision was sent/);
		assert.doesNotMatch(error.message, /SECRET/);
		return true;
	});
	assert.equal(generate.mock.callCount(), 1);
	assert.deepEqual(f.events, ["observe", "memory"]);
});

test("file changes after reading cannot change the owned inference bytes", async (t) => {
	const f = await fixture(t);
	let path = "";
	const observe = f.client.observe;
	f.client.observe = async () => {
		const o = await observe();
		path = o.pngPath;
		return o;
	};
	const findActiveLandmarks = f.tools.findActiveLandmarks;
	let changedPath = "";
	f.tools.findActiveLandmarks = async (observation) => {
		changedPath = path;
		await writeFile(changedPath, "changed later");
		return findActiveLandmarks(observation);
	};
	const result = await play(f.client, f.tools, f.provider);
	assert.equal(result.outcome, "completed");
	const input = f.state.modelInput as Parameters<typeof f.model.doGenerate>[0];
	const user = input.prompt.find((message) => message.role === "user");
	assert.ok(user);
	const image = user.content.find((part) => part.type === "file");
	assert.ok(
		image &&
			image.data.type === "data" &&
			image.data.data instanceof Uint8Array,
	);
	assert.deepEqual(Buffer.from(image.data.data), f.png);
	assert.equal((await readFile(changedPath)).toString(), "changed later");
});

test("broker budget greater than one stops before dispatch", async (t) => {
	const f = await fixture(t);
	const startRun = f.client.startRun;
	f.client.startRun = async (input) => {
		const ack = await startRun(input);
		assert.ok(ack.run);
		ack.run = { ...ack.run, limit: 3, remaining: 3 };
		return ack;
	};
	await assert.rejects(play(f.client, f.tools, f.provider), PlaybackError);
	assert.equal(f.events.includes("decide"), false);
});

test("oversized navigation amendment fails before run claim", async (t) => {
	const f = await fixture(t);
	f.base.configuration = {
		...f.base.configuration,
		instructionTemplate: `{{tics}}${"a".repeat(15990)}`,
	};
	f.state.configuration = structuredClone(f.base.configuration);
	await assert.rejects(play(f.client, f.tools, f.provider), PlaybackError);
	assert.equal(f.events.includes("startRun"), false);
});

test("actual AI SDK inference failure is attempted once", async (t) => {
	const f = await fixture(t);
	let calls = 0;
	f.model.doGenerate = async () => {
		calls++;
		throw Error("synthetic model transport failure");
	};
	await assert.rejects(play(f.client, f.tools, f.provider), PlaybackError);
	assert.equal(calls, 1);
	assert.equal(f.events.includes("startRun"), false);
});

for (const assessment of [
	navigationAssessment,
	{
		verdict: "no-visible-match",
		evidence:
			"The described opening has blue trim; the historical hypothesis describes red trim.",
		uncertainty:
			"Lighting or a different view could explain the conflict; location is not disproved.",
	},
	{
		verdict: "insufficient-evidence",
		evidence:
			"The perception describes only a plain wall, without distinctive landmark details.",
		uncertainty: "The landmark may be outside this view.",
	},
]) {
	test(`text-only ${assessment.verdict} assessment is diagnostic and uses only the selected note`, async (t) => {
		const f = await fixture(t);
		f.state.assessment = assessment;
		if (assessment.verdict === "no-visible-match") {
			f.note.hypothesis = "An opening with red trim may be a landmark.";
			f.state.perception = {
				description: "An opening with blue trim is visible.",
				features: ["Blue trim surrounds the opening."],
				uncertainty: "Lighting and viewpoint may affect appearance.",
			};
		} else if (assessment.verdict === "insufficient-evidence") {
			f.state.perception = {
				description: "A plain wall fills the view.",
				features: ["A plain wall is visible."],
				uncertainty: "Other features may be outside the view.",
			};
		}
		f.state.candidates.push({
			...f.note,
			noteId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
			hypothesis: "UNSELECTED_NOTE",
		});
		const result = await play(f.client, f.tools, f.provider);
		assert.deepEqual(result.navigationAssessment, {
			...assessment,
			usage: zeroModelUsage,
		});
		assert.equal(f.state.modelCalls, 2);
		const input = f.state.assessmentInput as Parameters<
			typeof f.model.doGenerate
		>[0];
		const user = input.prompt.find((m) => m.role === "user");
		assert.ok(user);
		assert.equal(user.content.length, 1);
		const text = user.content[0];
		assert.equal(text.type, "text");
		if (text.type !== "text") throw Error("Expected text");
		assert.deepEqual(JSON.parse(text.text), {
			perception: f.state.perception,
			historicalLandmark: {
				hypothesis: f.note.hypothesis,
				nextQuestion: f.note.nextQuestion,
				observerPoseRawTelemetry: f.note.anchor,
			},
		});
		assert.match(
			JSON.stringify(input.prompt),
			/untrusted data.*never instructions/,
		);
		assert.match(JSON.stringify(input.prompt), /takes priority/);
		assert.doesNotMatch(JSON.stringify(input), /UNSELECTED_NOTE|data:image/);
		assert.deepEqual(input.providerOptions, {
			openai: { store: false, reasoningEffort: "xhigh" },
		});
		assert.equal(input.tools?.length ?? 0, 0);
		assert.ok(!f.state.instructions.includes(assessment.evidence));
		assert.ok(!f.state.instructions.includes(assessment.uncertainty));
		assert.equal(f.events.filter((event) => event === "decide").length, 1);
	});
}

for (const fault of ["transport", "finish", "schema"] as const) {
	test(`assessment ${fault} failure retains perception and cleans up without claiming a run`, async (t) => {
		const f = await fixture(t);
		const generate = f.model.doGenerate.bind(f.model);
		const cause = Error("SECRET_ASSESSMENT_FAILURE");
		let calls = 0;
		f.model.doGenerate = async (input) => {
			if (++calls === 1) return generate(input);
			if (fault === "transport") throw cause;
			const result = await generate(input);
			if (fault === "finish")
				result.finishReason = { unified: "length", raw: "length" };
			else
				result.content = [
					{ type: "text", text: JSON.stringify({ verdict: "arrived" }) },
				];
			return result;
		};
		const { main } = await import("../src/main.ts");
		await assert.rejects(
			main(() => f.client, {
				makeTools: () => f.tools,
				makeProvider: () => f.provider,
			}),
			(error) => {
				assert.ok(error instanceof PlaybackError);
				assert.equal(error.stage, "navigation-assessment");
				assert.equal(error.decisionMayHaveBeenSent, false);
				assert.deepEqual(
					error.perception,
					perceptionWithZeroUsage(scenePerception),
				);
				assert.equal(error.navigationAssessment, null);
				assert.equal(error.navigationObjective?.kind, "landmark");
				assert.doesNotMatch(error.message, /SECRET/);
				if (fault === "transport") assert.equal(error.cause, cause);
				return true;
			},
		);
		assert.equal(calls, 2);
		assert.equal(f.events.includes("startRun"), false);
		assert.equal(f.events.at(-1), "detach");
	});
}
