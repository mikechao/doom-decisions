import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { createAgentMapIdentity } from "../../app/src/agent-observation.ts";
import { summarizeMovement } from "../src/movement-summary.ts";
import { compareRecentPoses } from "../src/recent-pose-comparison.ts";
import { fixture } from "./fixtures.ts";

const pose = (x: number, angle = 0, y = -65536) => ({ x, y, angle });

async function records(t: TestContext, poses: ReturnType<typeof pose>[]) {
	const f = await fixture(t, poses.length - 1);
	const initial = await f.client.observe();
	const { run } = await f.client.startRun({
		observationId: initial.observationId,
		sessionId: initial.sessionId,
		revision: initial.revision,
	});
	assert.ok(run);
	const result = [];
	for (let ordinal = 1; ordinal < poses.length; ordinal++) {
		const before = await f.client.observe();
		const receipt = await f.client.decide({
			observationId: before.observationId,
			scope: {
				runId: run.runId,
				sessionId: before.sessionId,
				revision: before.revision,
			},
		});
		const after = receipt.observation;
		assert.ok(after);
		Object.assign(before.telemetry, poses[ordinal - 1]);
		Object.assign(after.telemetry, poses[ordinal]);
		const movement = summarizeMovement(before, receipt);
		assert.equal(movement.status, "available");
		result.push({
			ordinal,
			admissionObservation: before,
			decision: {
				kind: "returned" as const,
				receipt: { ...receipt, observation: after },
			},
			movement,
			failure: null,
		});
	}
	return result;
}

test("fresh XY has null matches and one initial checkpoint", async (t) => {
	const [first] = await records(t, [pose(-65536), pose(-65535)]);
	const tic = first.admissionObservation.tic;
	assert.deepEqual(compareRecentPoses([], first), {
		status: "available",
		current: {
			kind: "ending",
			ordinal: 1,
			tic: tic + 6,
			rawX: -65535,
			rawY: -65536,
			rawAngle: 0,
		},
		exactXY: null,
		exactPose: null,
		sameXYDifferentAngle: null,
		recent: [
			{
				kind: "initial",
				ordinal: 1,
				tic,
				rawX: -65536,
				rawY: -65536,
				rawAngle: 0,
			},
		],
	});
});

test("stationary turns and wraparound keep XY and exact heading matches independent", async (t) => {
	const [first, second, third, fourth] = await records(t, [
		pose(7, 0xffffffff),
		pose(7),
		pose(7, 0xffffffff),
		pose(7, 0xffffffff),
		pose(7),
	]);
	assert.equal(first.movement.positionChanged, false);
	assert.equal(first.movement.headingChanged, true);
	const tic = first.admissionObservation.tic;
	const initial = { kind: "initial", ordinal: 1, tic };
	const turn = compareRecentPoses([], first);
	assert.equal(turn.status, "available");
	assert.deepEqual(turn.exactXY, initial);
	assert.equal(turn.exactPose, null);
	assert.deepEqual(turn.sameXYDifferentAngle, initial);
	const repeat = compareRecentPoses([first, second], third);
	assert.equal(repeat.status, "available");
	assert.deepEqual(repeat.exactPose, {
		kind: "ending",
		ordinal: 2,
		tic: tic + 12,
	});
	const latest = compareRecentPoses([first, second, third], fourth);
	assert.equal(latest.status, "available");
	assert.deepEqual(latest.exactXY, {
		kind: "ending",
		ordinal: 3,
		tic: tic + 18,
	});
	assert.deepEqual(latest.sameXYDifferentAngle, latest.exactXY);
	assert.deepEqual(latest.exactPose, {
		kind: "ending",
		ordinal: 1,
		tic: tic + 6,
	});
});

test("return to the initial pose is found beyond the three recent checkpoints", async (t) => {
	const [first, second, third, fourth, fifth] = await records(t, [
		pose(0),
		pose(1),
		pose(2),
		pose(3),
		pose(4),
		pose(0),
	]);
	const result = compareRecentPoses([first, second, third, fourth], fifth);
	assert.equal(result.status, "available");
	assert.equal(fifth.movement.positionChanged, true);
	assert.deepEqual(
		result.recent.map(({ kind, ordinal, tic }) => [kind, ordinal, tic]),
		[
			["ending", 4, first.admissionObservation.tic + 24],
			["ending", 3, first.admissionObservation.tic + 18],
			["ending", 2, first.admissionObservation.tic + 12],
		],
	);
	assert.deepEqual(result.exactXY, {
		kind: "initial",
		ordinal: 1,
		tic: first.admissionObservation.tic,
	});
	assert.deepEqual(result.exactPose, result.exactXY);
	assert.equal(result.sameXYDifferentAngle, null);
});

test("reusing an ending ID for the next same-tic admission invalidates history", async (t) => {
	const [first, second] = await records(t, [pose(0), pose(1), pose(0)]);
	const before = second.admissionObservation;
	const receipt = second.decision.receipt;
	const ending = first.decision.receipt.observation;
	assert.equal(before.tic, ending.tic);
	assert.deepEqual(before.telemetry, ending.telemetry);
	before.observationId = ending.observationId;
	receipt.beforeObservationId = receipt.commandId = before.observationId;
	const movement = summarizeMovement(before, receipt);
	assert.equal(movement.status, "available");
	assert.deepEqual(compareRecentPoses([first], { ...second, movement }), {
		status: "unavailable",
		ordinal: 2,
		reason: "history-discontinuity",
	});
});

test("cross-record identity, tic, order and pose discrepancies make history unavailable", async (t) => {
	const [first, second, third] = await records(t, [
		pose(0),
		pose(1),
		pose(2),
		pose(3),
	]);
	const unavailable = (reason: string) => ({
		status: "unavailable",
		ordinal: 2,
		reason,
	});
	assert.deepEqual(
		compareRecentPoses([second], first),
		unavailable("history-discontinuity"),
	);
	assert.deepEqual(
		compareRecentPoses([first], { ...third, ordinal: 2 }),
		unavailable("history-discontinuity"),
	);
	for (const key of [
		"run",
		"session",
		"map",
		"id",
		"x",
		"y",
		"angle",
	] as const) {
		const altered = structuredClone(second);
		const before = altered.admissionObservation;
		const after = altered.decision.receipt.observation;
		assert.ok(before.run);
		if (key === "run") before.run.runId = randomUUID();
		else if (key === "session")
			before.sessionId = after.sessionId = randomUUID();
		else if (key === "map")
			before.mapIdentity = after.mapIdentity = createAgentMapIdentity(
				"b".repeat(64),
				1,
				1,
			);
		else if (key === "id")
			after.observationId = first.admissionObservation.observationId;
		else before.telemetry[key]++;
		assert.equal(
			summarizeMovement(before, altered.decision.receipt).status,
			"available",
		);
		assert.deepEqual(
			compareRecentPoses([first], altered),
			unavailable(
				key === "x" || key === "y" || key === "angle"
					? "same-tic-pose-mismatch"
					: "history-discontinuity",
			),
			key,
		);
	}
});

test("partial, ineligible and malformed evidence cannot produce a repeat or bridge a gap", async (t) => {
	const [first, second, third] = await records(t, [
		pose(0),
		pose(1),
		pose(2),
		pose(3),
	]);
	const unavailable = (reason: string) => ({
		status: "unavailable",
		ordinal: 2,
		reason,
	});
	assert.deepEqual(
		compareRecentPoses([first], {
			...second,
			failure: { stage: "decision", message: "partial" },
		}),
		unavailable("partial-record"),
	);
	assert.deepEqual(
		compareRecentPoses([first], {
			...second,
			decision: { kind: "unconfirmed" },
			movement: { status: "unavailable", reason: "decision-not-returned" },
		}),
		unavailable("decision-not-returned"),
	);
	for (const [patch, reason] of [
		[{ outcome: "terminal" }, "not-completed"],
		[{ completionUncertain: true }, "completion-uncertain"],
		[{ observation: null }, "missing-checkpoint"],
	] as const) {
		const receipt = { ...second.decision.receipt, ...patch };
		const ineligible = {
			...second,
			decision: { kind: "returned" as const, receipt },
			movement: summarizeMovement(second.admissionObservation, receipt),
		};
		assert.deepEqual(
			compareRecentPoses([first], ineligible),
			unavailable(reason),
		);
		assert.deepEqual(
			compareRecentPoses([first, ineligible], third),
			unavailable(reason),
		);
	}
	const malformed = structuredClone(second);
	malformed.decision.receipt.observation.telemetry.angle = 0x100000000;
	assert.deepEqual(
		compareRecentPoses([first], malformed),
		unavailable("invalid-pose"),
	);
	Reflect.deleteProperty(malformed.decision.receipt.observation, "telemetry");
	assert.deepEqual(
		compareRecentPoses([first], malformed),
		unavailable("invalid-pose"),
	);
});
