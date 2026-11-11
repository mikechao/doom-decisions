import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import test from "node:test";
import { maxAgentInstructions } from "../../app/src/agent-control.ts";
import { play } from "../src/doom-play-agent.ts";
import { PlaybackError } from "../src/playback-error.ts";
import { fixture, scenePerception } from "./fixtures.ts";

const secondScene = {
	description: "SECOND_ONLY: a closer doorway is visible.",
	features: ["Blue trim surrounds the doorway."],
	uncertainty: "The next room is unseen.",
};

function recentHistory(instructions: string | null) {
	assert.ok(instructions);
	const label = "Recent verified history (JSON): ";
	assert.equal(instructions.split(label).length, 2);
	return JSON.parse(
		instructions.slice(instructions.indexOf(label) + label.length),
	);
}

function sceneInput(
	input: Awaited<ReturnType<typeof fixture>>["state"]["modelInputs"][number],
) {
	const user = input.prompt.find((m) => m.role === "user");
	assert.ok(user);
	const text = user.content.find((p) => p.type === "text");
	const image = user.content.find((p) => p.type === "file");
	assert.ok(
		text?.type === "text" &&
			image?.type === "file" &&
			image.data.type === "data",
	);
	return { state: JSON.parse(text.text).state, image: image.data.data };
}

for (const landmark of [true, false]) {
	test(`two informed ${landmark ? "landmark" : "free-explore"} decisions share one run and original base`, async (t) => {
		const f = await fixture(t);
		if (!landmark) f.state.candidates = [];
		f.state.perception = {
			...scenePerception,
			description: "FIRST_ONLY: a distant doorway is visible.",
		};
		const beforeScene = structuredClone(f.state.perception);
		const observations = t.mock.method(f.client, "observe");
		const started = t.mock.method(f.client, "startRun");
		const prompts = t.mock.method(f.client, "setPrompt");
		const decide = f.client.decide;
		f.client.decide = async (input) => {
			const receipt = await decide(input);
			f.state.perception = secondScene;
			// A changed candidate list cannot cause re-selection or another lookup.
			f.state.candidates = [
				{ ...f.note, noteId: randomUUID(), hypothesis: "UNSELECTED" },
			];
			return receipt;
		};
		const decisions = t.mock.method(f.client, "decide");
		const result = await play(f.client, f.tools, f.provider);
		assert.deepEqual(f.events, [
			"observe",
			"memory",
			"model",
			...(landmark ? ["assessment"] : []),
			"startRun",
			"setPrompt",
			"observe",
			"decide",
			"observe",
			"model",
			...(landmark ? ["assessment"] : []),
			"setPrompt",
			"observe",
			"decide",
		]);
		assert.equal(started.mock.callCount(), 1);
		assert.equal(observations.mock.callCount(), 4);
		assert.equal(prompts.mock.callCount(), 2);
		assert.equal(decisions.mock.callCount(), 2);
		assert.equal(f.state.memoryObservations.length, 1);
		assert.deepEqual(
			result.records.map((r) => r.ordinal),
			[1, 2],
		);
		assert.equal(result.decisionOrdinal, 2);
		assert.equal(result.cumulativeTics, f.base.tic + 12);
		assert.deepEqual(result.perception.description, secondScene.description);
		const [r1, r2] = result.records;
		assert.deepEqual(recentHistory(r1.guidance), {
			status: "no-history",
			window: 4,
			rows: [],
		});
		assert.deepEqual(recentHistory(r2.guidance), {
			status: "available",
			window: 4,
			columns: [
				"ordinal",
				"action",
				"verifiedTics",
				"netXYUnits",
				"headingDeltaDeg",
				"preSolidRayUnits",
			],
			rows: [[1, "forward", 6, "1.00", "0.00", null]],
		});
		assert.doesNotMatch(
			JSON.stringify(f.state.modelInputs),
			/Recent verified history/,
		);
		assert.doesNotMatch(
			JSON.stringify(f.state.assessmentInputs),
			/Recent verified history/,
		);
		assert.deepEqual(r2.selection, r1.selection);
		assert.equal(r2.landmarkLookup, null);
		assert.equal(r2.runStarted, null);
		assert.deepEqual(
			r1.perception?.description,
			(beforeScene as typeof scenePerception).description,
		);
		assert.deepEqual(started.mock.calls[0].arguments[0], {
			observationId: r1.reasoningObservation?.observationId,
			sessionId: f.base.sessionId,
			revision: f.base.revision,
		});
		const captures = await Promise.all(
			observations.mock.calls.map((c) => c.result),
		);
		assert.equal(new Set(captures.map((o) => o?.observationId)).size, 4);
		for (const [index, r] of result.records.entries()) {
			assert.ok(r.reasoningObservation && r.admissionObservation);
			assert.equal(Object.isFrozen(r), true);
			assert.equal(r.admissionObservation.tic, r.reasoningObservation.tic);
			assert.equal(
				r.admissionObservation.revision,
				f.base.revision + index + 1,
			);
			assert.equal(
				prompts.mock.calls[index].arguments[0].revision,
				f.base.revision + index,
			);
			assert.equal(prompts.mock.calls[index].arguments[0].runId, result.runId);
			assert.equal(
				decisions.mock.calls[index].arguments[0].observationId,
				r.admissionObservation.observationId,
			);
			assert.deepEqual(r.admissionObservation.run, {
				runId: result.runId,
				active: true,
				limit: 2,
				reserved: index,
				sdkInvoked: index,
				remaining: 2 - index,
			});
			assert.equal(r.decision.kind, "returned");
			if (r.decision.kind !== "returned") throw Error("Expected receipt");
			assert.deepEqual(r.beforePng, f.state.images[index]);
			assert.deepEqual(r.decision.afterPng, f.state.images[index + 1]);
			assert.equal(r.beforePng, sceneInput(f.state.modelInputs[index]).image);
		}
		assert.equal(r1.decision.kind, "returned");
		if (r1.decision.kind !== "returned") throw Error("Expected receipt");
		assert.equal(
			r2.reasoningObservation?.tic,
			r1.decision.receipt.observation?.tic,
		);
		assert.notEqual(
			r2.reasoningObservation?.observationId,
			r1.decision.receipt.observation?.observationId,
		);
		assert.deepEqual(r2.reasoningObservation?.run, {
			runId: result.runId,
			active: true,
			limit: 2,
			reserved: 1,
			sdkInvoked: 1,
			remaining: 1,
		});
		const input1 = sceneInput(f.state.modelInputs[0]);
		const input2 = sceneInput(f.state.modelInputs[1]);
		assert.notDeepEqual(input1.image, input2.image);
		assert.equal(input2.state.tic, input1.state.tic + 6);
		assert.equal(input2.state.telemetry.x, input1.state.telemetry.x + 65536);
		assert.equal(input2.state.previousAction.endTic, input2.state.tic);
		assert.equal(f.state.assessmentInputs.length, landmark ? 2 : 0);
		if (landmark) {
			const payloads = f.state.assessmentInputs.map((input) => {
				const user = input.prompt.find((m) => m.role === "user");
				const text = user?.content.find((p) => p.type === "text");
				assert.ok(text?.type === "text");
				return JSON.parse(text.text);
			});
			assert.deepEqual(
				payloads[0].historicalLandmark,
				payloads[1].historicalLandmark,
			);
			assert.deepEqual(
				payloads[1].historicalLandmark.observerPoseRawTelemetry,
				f.note.anchor,
			);
			assert.equal(payloads[1].perception.description, secondScene.description);
		}
		for (const template of f.state.decisionTemplates) {
			assert.ok(template.startsWith(f.base.configuration.instructionTemplate));
			assert.equal(
				template.match(/Navigation amendment for the next decision:/g)?.length,
				1,
			);
			assert.doesNotMatch(template, /UNSELECTED/);
		}
		assert.match(f.state.decisionTemplates[0], /FIRST_ONLY/);
		assert.doesNotMatch(f.state.decisionTemplates[1], /FIRST_ONLY/);
		assert.match(f.state.decisionTemplates[1], /SECOND_ONLY/);
		assert.deepEqual(f.state.run, {
			runId: result.runId,
			active: false,
			limit: 2,
			reserved: 2,
			sdkInvoked: 2,
			remaining: 0,
		});
		// Both records survive deletion of all materialized paths and mutable DTO aliases.
		await rm(f.root, { recursive: true, force: true });
		const original = await observations.mock.calls[2].result;
		assert.ok(original);
		original.telemetry.health = 0;
		result.perception.features.push("later edit");
		assert.equal(r2.reasoningObservation?.telemetry.health, 100);
		assert.deepEqual(r2.perception?.features, secondScene.features);
		assert.deepEqual(r1.decision.afterPng, f.state.images[1]);
	});
}

test("six decisions receive only the preceding four scalar rows with presentation rounding", async (t) => {
	const f = await fixture(t, 6);
	const actions = [
		"turn_right",
		"forward",
		"turn_right",
		"turn_left",
		"backward",
		"neutral",
	] as const;
	const distances = [0.5, 1.25, 2.5, 3.75, 4.5, 5.25];
	const probes = [
		{ kind: 2, door: 0, distance: 17 },
		{ kind: 1, door: 0, distance: -1 },
		null,
		{ kind: 2, door: 0, distance: 65 }, // Invalid, never presented as solid.
		{ kind: 4, door: 1, distance: 64 },
		{ kind: 3, door: 0, distance: 32 },
	];
	const observe = f.client.observe;
	f.client.observe = async () => {
		const o = await observe();
		if (f.state.observeCalls % 2 === 0) {
			const probe = probes[f.state.observeCalls / 2 - 1];
			o.facingProbe = probe && { ...probe, tic: o.tic };
		}
		return o;
	};
	const decide = f.client.decide;
	let returned = 0;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		assert.ok(receipt.observation && f.state.after);
		const after = receipt.observation;
		after.telemetry.x += (distances[returned] - 1) * 65536;
		after.telemetry.angle -= 0x08c00000;
		receipt.action = actions[returned++];
		assert.ok(after.previousAction);
		after.previousAction.action = receipt.action;
		f.state.after = { ...structuredClone(after), png: f.state.after.png };
		return receipt;
	};
	const result = await play(f.client, f.tools, f.provider);
	const expected = [
		[1, "turn_right", 6, "0.50", "-12.30", 17],
		[2, "forward", 6, "1.25", "-12.30", "not-solid"],
		[3, "turn_right", 6, "2.50", "-12.30", null],
		[4, "turn_left", 6, "3.75", "-12.30", null],
		[5, "backward", 6, "4.50", "-12.30", "not-solid"],
	];
	for (const [i, record] of result.records.entries()) {
		const history = recentHistory(record.guidance);
		assert.equal(history.status, i ? "available" : "no-history");
		assert.equal(history.window, 4);
		assert.deepEqual(history.rows, expected.slice(Math.max(0, i - 4), i));
		assert.equal(record.guidance, f.state.decisionTemplates[i]);
		assert.equal(record.promptAcknowledged?.instructions, record.guidance);
		assert.equal(record.movement.status, "available");
		if (record.movement.status !== "available")
			throw Error("Expected movement");
		assert.equal(record.movement.distance, distances[i]);
		assert.equal(record.movement.headingDelta, -12.3046875);
	}
	assert.deepEqual(
		recentHistory(result.records[5].guidance).rows,
		expected.slice(1),
	);
	assert.equal(f.state.observeCalls, 12);
	assert.equal(f.events.filter((e) => e === "startRun").length, 1);
});

for (const fault of [
	"invalid-pose",
	"missing-pose",
	"receipt-correlation",
	"receipt-tics",
] as const) {
	test(`ineligible ${fault} history recovers once the faulty row leaves the window`, async (t) => {
		const f = await fixture(t, 6);
		const observe = f.client.observe;
		f.client.observe = async () => {
			const o = await observe();
			if (f.state.observeCalls === 2) {
				if (fault === "invalid-pose") o.telemetry.angle = -1;
				if (fault === "missing-pose") Reflect.deleteProperty(o, "telemetry");
			}
			return o;
		};
		const decide = f.client.decide;
		let calls = 0;
		f.client.decide = async (input) => {
			const receipt = await decide(input);
			if (++calls === 1) {
				if (fault === "receipt-correlation")
					receipt.beforeObservationId = randomUUID();
				if (fault === "receipt-tics") receipt.reportedTics = 5;
			}
			return receipt;
		};
		const result = await play(f.client, f.tools, f.provider);
		for (const record of result.records.slice(1, 5)) {
			assert.deepEqual(recentHistory(record.guidance), {
				status: "unavailable",
				window: 4,
				reason: "ineligible-history",
				rows: [],
			});
		}
		const recovered = recentHistory(result.records[5].guidance);
		assert.equal(recovered.status, "available");
		assert.deepEqual(
			recovered.rows.map((row: unknown[]) => row[0]),
			[2, 3, 4, 5],
		);
		assert.ok(
			result.records.every(
				(r) => r.recentPoseComparison.status === "unavailable",
			),
		);
		assert.equal(result.outcome, "completed");
		assert.equal(calls, 6);
		assert.equal(f.state.run?.reserved, 6);
	});
}

for (const field of ["x", "y", "angle", "missing-pose"] as const) {
	test(`current reasoning ${field} mismatch suppresses only history`, async (t) => {
		const f = await fixture(t);
		const observe = f.client.observe;
		f.client.observe = async () => {
			const o = await observe();
			if (f.state.observeCalls === 3) {
				if (field === "missing-pose") Reflect.deleteProperty(o, "telemetry");
				else o.telemetry[field]++;
			}
			return o;
		};
		const result = await play(f.client, f.tools, f.provider);
		assert.deepEqual(recentHistory(result.records[1].guidance), {
			status: "unavailable",
			window: 4,
			reason: "checkpoint-mismatch",
			rows: [],
		});
		assert.equal(result.outcome, "completed");
		assert.equal(result.records[1].recentPoseComparison.status, "available");
		assert.equal(f.state.run?.sdkInvoked, 2);
	});
}

for (const fault of [
	"limit-1",
	"limit-3",
	"inactive",
	"missing",
	"session",
	"revision",
] as const) {
	test(`actual claim ${fault} stops without a prompt or replacement claim`, async (t) => {
		const f = await fixture(t);
		const start = f.client.startRun;
		f.client.startRun = async (input) => {
			const ack = await start(input);
			if (fault === "missing") ack.run = null;
			else if (fault === "session") ack.sessionId = randomUUID();
			else if (fault === "revision") ack.revision++;
			else {
				assert.ok(ack.run);
				if (fault === "inactive") ack.run.active = false;
				else ack.run = { ...ack.run, limit: fault === "limit-1" ? 1 : 3 };
			}
			return ack;
		};
		await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
			assert.ok(error instanceof PlaybackError);
			assert.equal(error.stage, "start-run");
			assert.equal(error.decisionOrdinal, 1);
			assert.equal(error.records.length, 1);
			assert.equal(error.records[0].decision.kind, "not-called");
			return true;
		});
		assert.equal(f.events.filter((e) => e === "startRun").length, 1);
		assert.equal(f.events.includes("setPrompt"), false);
	});
}

for (const fault of [
	"not-admitted",
	"api-failure",
	"stopped",
	"terminal",
	"retired",
	"uncertain",
	"missing-end",
	"terminal-end",
] as const) {
	test(`first ${fault} receipt never starts second preparation`, async (t) => {
		const f = await fixture(t);
		const decide = f.client.decide;
		f.client.decide = async (input) => {
			const receipt = await decide(input);
			if (fault === "uncertain") receipt.completionUncertain = true;
			else if (fault === "missing-end") receipt.observation = null;
			else if (fault === "terminal-end") {
				assert.ok(receipt.observation);
				receipt.observation.phase = "terminal";
			} else receipt.outcome = fault;
			return receipt;
		};
		const result = await play(f.client, f.tools, f.provider);
		assert.equal(result.decisionOrdinal, 1);
		assert.equal(result.records.length, 1);
		assert.equal(f.state.observeCalls, 2);
		assert.equal(f.state.modelInputs.length, 1);
		assert.equal(f.events.filter((e) => e === "decide").length, 1);
	});
}

for (const ordinal of [2, 3]) {
	for (const fault of [
		"missing-run",
		"run-id",
		"inactive",
		"limit",
		"reserved",
		"sdk",
		"remaining",
		"session",
		"map",
		"tic",
		"revision",
		"phase",
		"observation-id",
	] as const) {
		test(`decision ${ordinal} reasoning rejects ${fault} before inference or prompt mutation`, async (t) => {
			const f = await fixture(t, 5);
			const observe = f.client.observe;
			f.client.observe = async () => {
				const o = await observe();
				if (f.state.observeCalls === 2 * ordinal - 1) {
					assert.ok(o.run && f.state.after);
					if (fault === "missing-run") o.run = null;
					else if (fault === "run-id") o.run.runId = randomUUID();
					else if (fault === "inactive") o.run.active = false;
					else if (fault === "limit") o.run = { ...o.run, limit: 3 };
					else if (fault === "reserved") o.run.reserved++;
					else if (fault === "sdk") o.run.sdkInvoked = 0;
					else if (fault === "remaining") o.run.remaining = 0;
					else if (fault === "session") o.sessionId = randomUUID();
					else if (fault === "map") o.mapIdentity.mapKey = "other-map";
					else if (fault === "tic") o.tic++;
					else if (fault === "revision") o.revision++;
					else if (fault === "phase") Object.assign(o, { phase: "terminal" });
					else o.observationId = f.state.after.observationId;
				}
				return o;
			};
			await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
				assert.ok(error instanceof PlaybackError);
				assert.equal(error.stage, "continuation-check");
				assert.equal(error.decisionOrdinal, ordinal);
				assert.equal(error.decisionMayHaveBeenSent, false);
				assert.deepEqual(
					error.records.map((r) => r.decision.kind),
					[...Array(ordinal - 1).fill("returned"), "not-called"],
				);
				assert.ok(error.records[ordinal - 1].reasoningObservation);
				assert.equal(error.records[ordinal - 1].beforePng, null);
				assert.equal(error.records[ordinal - 1].landmarkLookup, null);
				assert.equal(error.records[ordinal - 1].runStarted, null);
				assert.deepEqual(
					error.records[ordinal - 1].selection,
					error.records[0].selection,
				);
				return true;
			});
			assert.equal(f.state.modelInputs.length, ordinal - 1);
			assert.equal(f.events.filter((e) => e === "startRun").length, 1);
			assert.equal(
				f.events.filter((e) => e === "setPrompt").length,
				ordinal - 1,
			);
			assert.equal(f.events.filter((e) => e === "decide").length, ordinal - 1);
		});
	}

	for (const fault of ["inactive", "revision", "tic", "reused-id"] as const) {
		test(`decision ${ordinal} post-CAS admission rejects ${fault} without dispatch`, async (t) => {
			const f = await fixture(t, 5);
			const observe = f.client.observe;
			let reasoningId = "";
			f.client.observe = async () => {
				const o = await observe();
				if (f.state.observeCalls === 2 * ordinal - 1)
					reasoningId = o.observationId;
				if (f.state.observeCalls === 2 * ordinal) {
					if (fault === "inactive") {
						assert.ok(o.run);
						o.run.active = false;
					} else if (fault === "revision") o.revision++;
					else if (fault === "tic") o.tic++;
					else o.observationId = reasoningId;
				}
				return o;
			};
			await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
				assert.ok(error instanceof PlaybackError);
				assert.equal(error.stage, "dispatch-observation");
				assert.equal(error.decisionOrdinal, ordinal);
				assert.equal(error.decisionMayHaveBeenSent, false);
				assert.equal(error.records[0].decision.kind, "returned");
				assert.ok(
					error.records[ordinal - 1].promptAcknowledged &&
						error.records[ordinal - 1].admissionObservation,
				);
				assert.equal(error.records[ordinal - 1].decision.kind, "not-called");
				return true;
			});
			assert.equal(f.events.filter((e) => e === "decide").length, ordinal - 1);
		});
	}
}

for (const fault of [
	"observation",
	"perception",
	"navigation-assessment",
	"prompt-cas",
	"dispatch-observation",
	"decision",
] as const) {
	test(`second ${fault} failure preserves the first receipt and original cause`, async (t) => {
		const f = await fixture(t);
		const cause = new Error("SECRET_SECOND_FAILURE");
		if (fault === "observation" || fault === "dispatch-observation") {
			const observe = f.client.observe;
			f.client.observe = async () => {
				const o = await observe();
				if (f.state.observeCalls === (fault === "observation" ? 3 : 4))
					throw cause;
				return o;
			};
		} else if (fault === "perception" || fault === "navigation-assessment") {
			const generate = f.model.doGenerate.bind(f.model);
			f.model.doGenerate = async (input) => {
				if (f.state.modelCalls === (fault === "perception" ? 2 : 3)) {
					// The already-retained first images cannot depend on their source paths.
					await rm(f.root, { recursive: true, force: true });
					throw cause;
				}
				return generate(input);
			};
		} else if (fault === "prompt-cas") {
			const prompt = f.client.setPrompt;
			let calls = 0;
			f.client.setPrompt = async (input) => {
				const ack = await prompt(input);
				if (++calls === 2) throw cause; // Acknowledgment lost after mutation.
				return ack;
			};
		} else {
			const decide = f.client.decide;
			let calls = 0;
			f.client.decide = async (input) => {
				const receipt = await decide(input);
				if (++calls === 2) throw cause; // Dispatch may have completed; never replay.
				return receipt;
			};
		}
		await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
			assert.ok(error instanceof PlaybackError);
			assert.equal(error.decisionOrdinal, 2);
			assert.equal(error.stage, fault);
			assert.equal(error.cause, cause);
			assert.equal(error.decisionMayHaveBeenSent, fault === "decision");
			assert.match(error.message, /decision #2/i);
			assert.doesNotMatch(error.message, /SECRET|No decision was sent/);
			assert.equal(error.records.length, 2);
			const [first, second] = error.records;
			assert.equal(first.failure, null);
			assert.equal(first.decision.kind, "returned");
			if (first.decision.kind !== "returned")
				throw Error("Expected first receipt");
			assert.equal(first.decision.receipt.outcome, "completed");
			assert.deepEqual(first.beforePng, f.png);
			assert.deepEqual(first.decision.afterPng, f.state.images[1]);
			assert.equal(
				second.decision.kind,
				fault === "decision" ? "unconfirmed" : "not-called",
			);
			assert.equal(second.failure?.stage, fault);
			if (second.decision.kind === "unconfirmed") {
				assert.equal(
					second.decision.input.observationId,
					second.admissionObservation?.observationId,
				);
				assert.equal("receipt" in second.decision, false);
			}
			assert.equal(Object.isFrozen(first), true);
			assert.equal(Object.isFrozen(second), true);
			return true;
		});
		assert.equal(f.events.filter((e) => e === "startRun").length, 1);
		assert.equal(
			f.events.filter((e) => e === "decide").length,
			fault === "decision" ? 2 : 1,
		);
	});
}

test("history alone overflows second guidance before CAS and preserves the first record", async (t) => {
	const calibration = await fixture(t, 1);
	calibration.state.candidates = [];
	const baseline = await play(
		calibration.client,
		calibration.tools,
		calibration.provider,
	);
	const firstLength = baseline.records[0].guidance?.length;
	assert.ok(firstLength);
	const f = await fixture(t);
	f.state.candidates = [];
	f.base.configuration = {
		...f.base.configuration,
		instructionTemplate:
			f.base.configuration.instructionTemplate +
			"B".repeat(maxAgentInstructions - firstLength),
	};
	f.state.configuration = structuredClone(f.base.configuration);
	await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
		assert.ok(error instanceof PlaybackError);
		assert.equal(error.stage, "guidance");
		assert.equal(error.decisionOrdinal, 2);
		assert.equal(error.decisionMayHaveBeenSent, false);
		assert.deepEqual(
			error.records.map((r) => r.decision.kind),
			["returned", "not-called"],
		);
		assert.ok(error.records[1].perception);
		assert.equal(error.records[0].guidance?.length, maxAgentInstructions);
		assert.deepEqual(
			error.records[0].perception?.description,
			error.records[1].perception?.description,
		);
		assert.equal(error.records[1].guidance, null);
		return true;
	});
	assert.equal(f.events.filter((e) => e === "startRun").length, 1);
	assert.equal(f.events.filter((e) => e === "setPrompt").length, 1);
	assert.equal(f.events.filter((e) => e === "decide").length, 1);
});

test("live first receipt and passive snapshots are isolated from later client aliases", async (t) => {
	const f = await fixture(t);
	const decide = f.client.decide;
	let clientReceipt: Awaited<ReturnType<typeof decide>> | null = null;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		clientReceipt ??= receipt;
		return receipt;
	};
	const observe = f.client.observe;
	f.client.observe = async () => {
		const observation = await observe();
		if (f.state.observeCalls === 3) {
			assert.ok(clientReceipt?.observation);
			clientReceipt.observation.tic = 999;
			clientReceipt.outcome = "retired";
		}
		return observation;
	};
	const result = await play(f.client, f.tools, f.provider);
	assert.equal(result.decisionOrdinal, 2);
	const first = result.records[0].decision;
	assert.equal(first.kind, "returned");
	if (first.kind !== "returned") throw Error("Expected first receipt");
	assert.equal(first.receipt.outcome, "completed");
	assert.equal(first.receipt.observation?.tic, f.base.tic + 6);
});

test("second reasoning image read failure retains its observation and all first image bytes", async (t) => {
	const f = await fixture(t);
	const observe = f.client.observe;
	f.client.observe = async () => {
		const observation = await observe();
		if (f.state.observeCalls === 3) await rm(observation.pngPath);
		return observation;
	};
	await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
		assert.ok(error instanceof PlaybackError);
		assert.equal(error.decisionOrdinal, 2);
		assert.equal(error.stage, "observation");
		assert.equal(error.decisionMayHaveBeenSent, false);
		const [first, second] = error.records;
		assert.ok(second.reasoningObservation);
		assert.equal(second.beforePng, null);
		assert.equal(second.decision.kind, "not-called");
		assert.equal(first.decision.kind, "returned");
		if (first.decision.kind !== "returned")
			throw Error("Expected first receipt");
		assert.deepEqual(first.beforePng, f.png);
		assert.deepEqual(first.decision.afterPng, f.state.images[1]);
		return true;
	});
	assert.equal(f.events.filter((e) => e === "setPrompt").length, 1);
	assert.equal(f.events.filter((e) => e === "decide").length, 1);
});

for (const budget of [1, 2, 3, 5]) {
	for (const landmark of [true, false]) {
		test(`${budget} informed ${landmark ? "landmark" : "free-explore"} slots exhaust exactly one issued run`, async (t) => {
			const f = await fixture(t, budget);
			if (!landmark) f.state.candidates = [];
			const decide = f.client.decide;
			let returned = 0;
			f.state.perception = { ...scenePerception, description: "SCENE_1" };
			f.client.decide = async (input) => {
				const receipt = await decide(input);
				f.state.perception = {
					...scenePerception,
					description: `SCENE_${++returned + 1}`,
				};
				f.state.candidates = [];
				return receipt;
			};
			const result = await play(f.client, f.tools, f.provider, budget);
			assert.equal(result.decisionOrdinal, budget);
			assert.deepEqual(
				result.records.map((r) => r.ordinal),
				Array.from({ length: budget }, (_, i) => i + 1),
			);
			assert.equal(result.cumulativeTics, f.base.tic + budget * 6);
			assert.equal(result.perception.description, `SCENE_${budget}`);
			assert.equal(f.state.observeCalls, 2 * budget);
			assert.equal(f.state.modelInputs.length, budget);
			assert.equal(f.state.assessmentInputs.length, landmark ? budget : 0);
			assert.equal(f.state.memoryObservations.length, 1);
			assert.equal(f.events.filter((e) => e === "startRun").length, 1);
			for (const event of ["decide", "setPrompt"])
				assert.equal(f.events.filter((e) => e === event).length, budget);
			for (const [i, record] of result.records.entries()) {
				assert.deepEqual(record.selection, result.records[0].selection);
				assert.equal(record.perception?.description, `SCENE_${i + 1}`);
				assert.deepEqual(record.beforePng, f.state.images[i]);
				const history = record.recentPoseComparison;
				assert.equal(history.status, "available");
				assert.equal(history.current.tic, f.base.tic + (i + 1) * 6);
				assert.deepEqual(
					history.recent.map((checkpoint) => checkpoint.tic),
					Array.from(
						{ length: Math.min(3, i + 1) },
						(_, j) => f.base.tic + (i - j) * 6,
					),
				);
				assert.equal(history.exactXY, null);
				const input = sceneInput(f.state.modelInputs[i]);
				assert.equal(input.image, record.beforePng);
				assert.equal(input.state.tic, f.base.tic + i * 6);
				assert.equal(input.state.telemetry.x, f.base.telemetry.x + i * 65536);
				assert.deepEqual(record.admissionObservation?.run, {
					runId: result.runId,
					active: true,
					limit: budget,
					reserved: i,
					sdkInvoked: i,
					remaining: budget - i,
				});
				assert.equal(
					record.admissionObservation?.revision,
					f.base.revision + i + 1,
				);
				assert.ok(
					record.guidance?.startsWith(f.base.configuration.instructionTemplate),
				);
				assert.equal(
					record.guidance?.match(/Navigation amendment for the next decision:/g)
						?.length,
					1,
				);
				assert.match(record.guidance ?? "", new RegExp(`SCENE_${i + 1}`));
				if (i)
					assert.doesNotMatch(record.guidance ?? "", new RegExp(`SCENE_${i}`));
				if (landmark) {
					const user = f.state.assessmentInputs[i].prompt.find(
						(m) => m.role === "user",
					);
					const text = user?.content.find((p) => p.type === "text");
					assert.ok(text?.type === "text");
					assert.equal(
						JSON.parse(text.text).historicalLandmark.hypothesis,
						f.note.hypothesis,
					);
				}
				assert.equal(record.decision.kind, "returned");
				if (record.decision.kind !== "returned")
					throw Error("Expected receipt");
				assert.deepEqual(record.decision.afterPng, f.state.images[i + 1]);
			}
			assert.equal(f.state.run?.active, false);
			assert.equal(f.state.run?.remaining, 0);
		});
	}
}

for (const fault of ["pose-mismatch", "reused-id"] as const) {
	test(`window join ${fault} suppresses history only while the join is inside the window`, async (t) => {
		const f = await fixture(t, 6);
		const observe = f.client.observe;
		f.client.observe = async () => {
			const observation = await observe();
			if (f.state.observeCalls === 4) {
				if (fault === "pose-mismatch") observation.telemetry.angle++;
				else {
					assert.ok(f.state.after);
					observation.observationId = f.state.after.observationId;
					f.state.lastId = observation.observationId;
				}
			}
			return observation;
		};
		const result = await play(f.client, f.tools, f.provider);
		assert.equal(result.outcome, "completed");
		assert.equal(result.action, "forward");
		assert.equal(result.decisionOrdinal, 6);
		assert.equal(result.records[0].recentPoseComparison.status, "available");
		for (const record of result.records.slice(1)) {
			assert.equal(record.movement.status, "available");
			assert.equal(record.failure, null);
			assert.deepEqual(record.recentPoseComparison, {
				status: "unavailable",
				ordinal: 2,
				reason:
					fault === "pose-mismatch"
						? "same-tic-pose-mismatch"
						: "history-discontinuity",
			});
		}
		assert.equal(recentHistory(result.records[1].guidance).status, "available");
		for (const record of result.records.slice(2, 5)) {
			assert.deepEqual(recentHistory(record.guidance), {
				status: "unavailable",
				window: 4,
				reason: "checkpoint-mismatch",
				rows: [],
			});
		}
		const recovered = recentHistory(result.records[5].guidance);
		assert.equal(recovered.status, "available");
		assert.deepEqual(
			recovered.rows.map((row: unknown[]) => row[0]),
			[2, 3, 4, 5],
		);
		assert.equal(f.state.observeCalls, 12);
		assert.equal(f.state.modelInputs.length, 6);
		assert.equal(f.events.filter((event) => event === "setPrompt").length, 6);
		assert.equal(f.events.filter((event) => event === "decide").length, 6);
		assert.equal(f.state.run?.sdkInvoked, 6);
		assert.equal(f.state.run?.remaining, 0);
	});
}

for (const outcome of [
	"stopped",
	"terminal",
	"not-admitted",
	"api-failure",
	"retired",
	"uncertain",
] as const) {
	test(`third ${outcome} return stops a five-slot run without fourth preparation`, async (t) => {
		const f = await fixture(t, 5);
		const decide = f.client.decide;
		let calls = 0;
		f.client.decide = async (input) => {
			const receipt = await decide(input);
			if (++calls === 3) {
				if (outcome === "uncertain") receipt.completionUncertain = true;
				else receipt.outcome = outcome;
			}
			return receipt;
		};
		const result = await play(f.client, f.tools, f.provider);
		assert.equal(result.decisionOrdinal, 3);
		assert.equal(result.records.length, 3);
		assert.equal(
			result.outcome,
			outcome === "uncertain" ? "completed" : outcome,
		);
		assert.equal(result.completionUncertain, outcome === "uncertain");
		assert.equal(result.records[2].recentPoseComparison.status, "unavailable");
		assert.equal(f.state.modelInputs.length, 3);
		assert.equal(f.state.decisionTemplates.length, 3);
		assert.deepEqual(
			recentHistory(result.records[2].guidance).rows.map(
				(row: unknown[]) => row[0],
			),
			[1, 2],
		);
		assert.equal(f.state.observeCalls, 6);
		assert.equal(calls, 3);
		assert.equal(f.events.filter((e) => e === "startRun").length, 1);
	});
}

for (const ordinal of [3, 5]) {
	for (const fault of [
		"image",
		"perception",
		"navigation-assessment",
		"guidance",
		"prompt-cas",
		"dispatch-observation",
		"decision",
	] as const) {
		test(`decision ${ordinal} ${fault} failure retains every earlier receipt and image`, async (t) => {
			const f = await fixture(t, 5);
			const cause = new Error("LATER_FAILURE");
			if (fault === "guidance") {
				f.base.configuration = {
					...f.base.configuration,
					instructionTemplate: "B".repeat(13000),
				};
				f.state.configuration = structuredClone(f.base.configuration);
				f.state.perception = {
					description: "First.",
					features: [],
					uncertainty: "None.",
				};
				const decide = f.client.decide;
				let calls = 0;
				f.client.decide = async (input) => {
					const receipt = await decide(input);
					if (++calls === ordinal - 1)
						f.state.perception = {
							description: "D".repeat(300),
							features: Array(8).fill("F".repeat(120)),
							uncertainty: "U".repeat(300),
						};
					return receipt;
				};
			} else if (fault === "perception" || fault === "navigation-assessment") {
				const generate = f.model.doGenerate.bind(f.model);
				f.model.doGenerate = async (input) => {
					if (
						f.state.modelCalls ===
						2 * (ordinal - 1) + (fault === "navigation-assessment" ? 1 : 0)
					)
						throw cause;
					return generate(input);
				};
			} else if (fault === "image" || fault === "dispatch-observation") {
				const observe = f.client.observe;
				f.client.observe = async () => {
					const o = await observe();
					if (
						f.state.observeCalls ===
						2 * ordinal - (fault === "image" ? 1 : 0)
					) {
						if (fault === "image") await rm(o.pngPath);
						else throw cause;
					}
					return o;
				};
			} else if (fault === "prompt-cas") {
				const prompt = f.client.setPrompt;
				let calls = 0;
				f.client.setPrompt = async (input) => {
					const ack = await prompt(input);
					if (++calls === ordinal) throw cause;
					return ack;
				};
			} else {
				const decide = f.client.decide;
				let calls = 0;
				f.client.decide = async (input) => {
					const receipt = await decide(input);
					if (++calls === ordinal) throw cause;
					return receipt;
				};
			}
			await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
				assert.ok(error instanceof PlaybackError);
				assert.equal(error.decisionOrdinal, ordinal);
				assert.equal(error.stage, fault === "image" ? "observation" : fault);
				assert.equal(error.decisionMayHaveBeenSent, fault === "decision");
				assert.equal(error.records.length, ordinal);
				if (fault !== "guidance" && fault !== "image")
					assert.equal(error.cause, cause);
				else assert.ok(error.cause instanceof Error);
				for (const [i, record] of error.records.slice(0, -1).entries()) {
					assert.equal(record.decision.kind, "returned");
					if (record.decision.kind !== "returned")
						throw Error("Expected prior receipt");
					assert.equal(record.decision.receipt.outcome, "completed");
					assert.deepEqual(record.beforePng, f.state.images[i]);
					assert.deepEqual(record.decision.afterPng, f.state.images[i + 1]);
					assert.equal(record.recentPoseComparison.status, "available");
				}
				const current = error.records[ordinal - 1];
				assert.deepEqual(current.recentPoseComparison, {
					status: "unavailable",
					ordinal,
					reason: "decision-not-returned",
				});
				assert.equal(
					current.decision.kind,
					fault === "decision" ? "unconfirmed" : "not-called",
				);
				if (fault === "image") {
					assert.equal(error.perception, null);
					assert.equal(error.navigationAssessment, null);
					assert.equal(current.beforePng, null);
				}
				if (current.decision.kind === "unconfirmed") {
					assert.equal(
						current.decision.input.observationId,
						current.admissionObservation?.observationId,
					);
					assert.equal("receipt" in current.decision, false);
				}
				return true;
			});
			assert.equal(f.events.filter((e) => e === "startRun").length, 1);
			assert.equal(
				f.events.filter((e) => e === "decide").length,
				ordinal - (fault === "decision" ? 0 : 1),
			);
		});
	}
}

for (const limit of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
	test(`invalid issued limit ${limit} stops before first CAS`, async (t) => {
		const f = await fixture(t);
		const start = f.client.startRun;
		f.client.startRun = async (input) => {
			const ack = await start(input);
			assert.ok(ack.run);
			ack.run = { ...ack.run, limit, remaining: limit };
			return ack;
		};
		await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
			assert.ok(error instanceof PlaybackError);
			assert.equal(error.stage, "start-run");
			assert.equal(error.decisionOrdinal, 1);
			return true;
		});
		assert.equal(f.events.filter((e) => e === "startRun").length, 1);
		assert.equal(f.events.includes("setPrompt"), false);
		assert.equal(f.events.includes("decide"), false);
	});
}

for (const timing of ["reasoning", "after-admission"] as const) {
	test(`lease loss during third ${timing} cannot authorize another dispatch`, async (t) => {
		const f = await fixture(t, 5);
		const cause = new Error("lease-revoked");
		if (timing === "reasoning") {
			const generate = f.model.doGenerate.bind(f.model);
			f.model.doGenerate = async (input) => {
				const response = await generate(input);
				if (f.state.modelInputs.length === 3) f.state.run = null;
				return response;
			};
		} else {
			const decide = f.client.decide;
			f.client.decide = async (input) => {
				if (f.state.modelInputs.length === 3) throw cause;
				return decide(input);
			};
		}
		await assert.rejects(play(f.client, f.tools, f.provider), (error) => {
			assert.ok(error instanceof PlaybackError);
			assert.equal(error.decisionOrdinal, 3);
			assert.equal(
				error.stage,
				timing === "reasoning" ? "prompt-cas" : "decision",
			);
			assert.equal(error.decisionMayHaveBeenSent, timing === "after-admission");
			assert.equal(error.records.length, 3);
			return true;
		});
		assert.equal(f.events.filter((e) => e === "decide").length, 2);
		assert.equal(f.events.filter((e) => e === "startRun").length, 1);
	});
}

test("third result-image retention failure does not block fresh fourth and fifth reasoning images", async (t) => {
	const f = await fixture(t, 5);
	const decide = f.client.decide;
	let calls = 0;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		if (++calls === 3) {
			assert.ok(receipt.pngPath);
			await rm(receipt.pngPath);
		}
		return receipt;
	};
	const result = await play(f.client, f.tools, f.provider);
	assert.equal(result.decisionOrdinal, 5);
	assert.equal(result.outcome, "completed");
	assert.equal(result.records.length, 5);
	const third = result.records[2].decision;
	assert.equal(third.kind, "returned");
	if (third.kind !== "returned") throw Error("Expected receipt");
	assert.equal(third.receipt.outcome, "completed");
	assert.equal(third.imageRetentionFailure?.reason, "read-failed");
	assert.equal(third.afterPng, null);
	assert.ok(
		result.records.every(
			(record) => record.recentPoseComparison.status === "available",
		),
	);
	assert.deepEqual(result.records[3].beforePng, f.state.images[3]);
	assert.deepEqual(result.records[4].beforePng, f.state.images[4]);
	assert.equal(f.state.observeCalls, 10);
	assert.equal(calls, 5);
	assert.equal(f.events.filter((e) => e === "startRun").length, 1);
});
