import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import test from "node:test";
import { PlaybackError, play } from "../src/doom-play-agent.ts";
import { fixture, scenePerception } from "./fixtures.ts";

const secondScene = {
	description: "SECOND_ONLY: a closer doorway is visible.",
	features: ["Blue trim surrounds the doorway."],
	uncertainty: "The next room is unseen.",
};

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
	test(`second reasoning rejects ${fault} before inference or prompt mutation`, async (t) => {
		const f = await fixture(t);
		const observe = f.client.observe;
		f.client.observe = async () => {
			const o = await observe();
			if (f.state.observeCalls === 3) {
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
			assert.equal(error.decisionOrdinal, 2);
			assert.equal(error.decisionMayHaveBeenSent, false);
			assert.deepEqual(
				error.records.map((r) => r.decision.kind),
				["returned", "not-called"],
			);
			assert.ok(error.records[1].reasoningObservation);
			assert.equal(error.records[1].beforePng, null);
			assert.equal(error.records[1].landmarkLookup, null);
			assert.equal(error.records[1].runStarted, null);
			assert.deepEqual(error.records[1].selection, error.records[0].selection);
			return true;
		});
		assert.equal(f.state.modelInputs.length, 1);
		assert.equal(f.events.filter((e) => e === "startRun").length, 1);
		assert.equal(f.events.filter((e) => e === "setPrompt").length, 1);
		assert.equal(f.events.filter((e) => e === "decide").length, 1);
	});
}

for (const fault of ["inactive", "revision", "tic", "reused-id"] as const) {
	test(`second post-CAS admission rejects ${fault} without dispatch`, async (t) => {
		const f = await fixture(t);
		const observe = f.client.observe;
		let reasoningId = "";
		f.client.observe = async () => {
			const o = await observe();
			if (f.state.observeCalls === 3) reasoningId = o.observationId;
			if (f.state.observeCalls === 4) {
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
			assert.equal(error.decisionOrdinal, 2);
			assert.equal(error.decisionMayHaveBeenSent, false);
			assert.equal(error.records[0].decision.kind, "returned");
			assert.ok(
				error.records[1].promptAcknowledged &&
					error.records[1].admissionObservation,
			);
			assert.equal(error.records[1].decision.kind, "not-called");
			return true;
		});
		assert.equal(f.events.filter((e) => e === "decide").length, 1);
	});
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

test("second guidance overflow preserves the first decision without another prompt or claim", async (t) => {
	const f = await fixture(t);
	f.state.candidates = [];
	f.base.configuration = {
		...f.base.configuration,
		instructionTemplate: "B".repeat(14500),
	};
	f.state.configuration = structuredClone(f.base.configuration);
	f.state.perception = {
		description: "First.",
		features: [],
		uncertainty: "None.",
	};
	const decide = f.client.decide;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		f.state.perception = {
			description: "D".repeat(300),
			features: Array(8).fill("F".repeat(120)),
			uncertainty: "U".repeat(300),
		};
		return receipt;
	};
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
