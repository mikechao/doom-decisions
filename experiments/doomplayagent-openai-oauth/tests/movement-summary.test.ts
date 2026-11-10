import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import type { MaterializedDecision } from "../../../scripts/doom-agent-client.ts";
import { summarizeMovement } from "../src/movement-summary.ts";
import { fixture } from "./fixtures.ts";

async function checkpoints(t: TestContext) {
	const f = await fixture(t, 1);
	const before = await f.client.observe();
	const after = structuredClone(before);
	after.observationId = randomUUID();
	after.tic += 6;
	after.frame.tic = after.counters.gametic = after.tic;
	const receipt: MaterializedDecision = {
		pageId: before.pageId,
		epoch: before.epoch,
		commandId: before.observationId,
		beforeObservationId: before.observationId,
		outcome: "completed",
		reason: null,
		sdkInvoked: true,
		action: "forward",
		requestedTics: 6,
		reportedTics: 6,
		verifiedTics: 6,
		cumulativeTics: after.tic,
		completionUncertain: false,
		requestIdentity: null,
		responseMetadata: null,
		observation: after,
		pngPath: null,
	};
	return { before, after, receipt };
}

test("net XY preserves signed fractional units and wide raw subtraction", async (t) => {
	const { before, after, receipt } = await checkpoints(t);
	after.telemetry.x += 196608;
	after.telemetry.y -= 262144;
	assert.deepEqual(summarizeMovement(before, receipt), {
		status: "available",
		startTic: before.tic,
		endTic: after.tic,
		dxRaw: 196608,
		dyRaw: -262144,
		dx: 3,
		dy: -4,
		distance: 5,
		headingDelta: 0,
		positionChanged: true,
		headingChanged: false,
	});
	after.telemetry.x = before.telemetry.x - 1;
	after.telemetry.y = before.telemetry.y;
	const fractional = summarizeMovement(before, receipt);
	assert.equal(fractional.status, "available");
	if (fractional.status !== "available") throw Error("Expected measurement");
	assert.equal(fractional.dx, -1 / 65536);
	assert.equal(fractional.distance, 1 / 65536);
	assert.equal(fractional.positionChanged, true);
	before.telemetry.x = -2147483648;
	after.telemetry.x = 2147483647;
	const wide = summarizeMovement(before, receipt);
	assert.equal(wide.status, "available");
	if (wide.status === "available") assert.equal(wide.dxRaw, 4294967295);
});

test("reused ending observation ID is unavailable despite consistent advanced tics", async (t) => {
	const { before, after, receipt } = await checkpoints(t);
	assert.notEqual(after.observationId, before.observationId);
	assert.equal(summarizeMovement(before, receipt).status, "available");
	after.observationId = before.observationId;
	assert.deepEqual(summarizeMovement(before, receipt), {
		status: "unavailable",
		reason: "checkpoint-mismatch",
	});
});

test("turning and translation are independent exact endpoint changes", async (t) => {
	const { before, after, receipt } = await checkpoints(t);
	const stationary = summarizeMovement(before, receipt);
	assert.equal(stationary.status, "available");
	if (stationary.status !== "available") throw Error("Expected measurement");
	assert.equal(stationary.distance, 0);
	assert.equal(stationary.positionChanged, false);
	assert.equal(stationary.headingChanged, false);
	receipt.action = "turn_left";
	after.telemetry.angle += 0x40000000;
	for (const translates of [false, true]) {
		if (translates) after.telemetry.x++;
		const result = summarizeMovement(before, receipt);
		assert.equal(result.status, "available");
		if (result.status !== "available") throw Error("Expected measurement");
		assert.equal(result.positionChanged, translates);
		assert.equal(result.headingChanged, true);
		assert.equal(result.headingDelta, 90);
	}
	assert.doesNotMatch(JSON.stringify(stationary), /wall|collision|blocked/);
});

test("binary angle wraparound and half-turn tie use signed minimal degrees", async (t) => {
	const { before, after, receipt } = await checkpoints(t);
	for (const [start, end, raw] of [
		[0xffffffff, 0, 1],
		[0, 0xffffffff, -1],
		[123, 123, 0],
		[0, 0x80000000, -0x80000000],
		[0x80000000, 0, -0x80000000],
	]) {
		before.telemetry.angle = start;
		after.telemetry.angle = end;
		const result = summarizeMovement(before, receipt);
		assert.equal(result.status, "available");
		if (result.status !== "available") throw Error("Expected measurement");
		assert.equal(result.headingDelta, (raw * 360) / 4294967296);
		assert.equal(result.headingChanged, raw !== 0);
	}
});

test("invalid native pose values are unavailable without coercion", async (t) => {
	const { before, receipt } = await checkpoints(t);
	for (const endpoint of [before, receipt.observation]) {
		assert.ok(endpoint);
		for (const [key, values] of [
			["x", [-2147483649, 2147483648, 0.5, Number.NaN]],
			["y", [-2147483649, 2147483648, Number.POSITIVE_INFINITY]],
			["angle", [-1, 4294967296, 0.5]],
		] as const) {
			const original = endpoint.telemetry[key];
			for (const value of values) {
				endpoint.telemetry[key] = value;
				assert.deepEqual(summarizeMovement(before, receipt), {
					status: "unavailable",
					reason: "invalid-pose",
				});
			}
			endpoint.telemetry[key] = original;
		}
	}
});

test("noncompleted or malformed evidence never fabricates zero movement", async (t) => {
	const original = await checkpoints(t);
	const cases: [string, (data: typeof original) => void][] = [
		[
			"completion-uncertain",
			({ receipt }) => {
				receipt.completionUncertain = true;
			},
		],
		[
			"sdk-not-invoked",
			({ receipt }) => {
				receipt.sdkInvoked = false;
			},
		],
		[
			"invalid-action-or-tics",
			({ receipt }) => {
				receipt.action = null;
			},
		],
		[
			"invalid-action-or-tics",
			({ receipt }) => {
				receipt.verifiedTics = 0;
			},
		],
		[
			"invalid-action-or-tics",
			({ receipt }) => {
				receipt.reportedTics = 5;
			},
		],
		[
			"missing-checkpoint",
			({ receipt }) => {
				receipt.observation = null;
			},
		],
		[
			"checkpoint-mismatch",
			({ receipt }) => {
				receipt.beforeObservationId = "";
			},
		],
		[
			"checkpoint-mismatch",
			({ receipt }) => {
				receipt.beforeObservationId = "other";
			},
		],
		[
			"checkpoint-mismatch",
			({ after }) => {
				after.sessionId = "other";
			},
		],
		[
			"checkpoint-mismatch",
			({ after }) => {
				after.mapIdentity.iwadSha256 = "b".repeat(64);
			},
		],
		[
			"checkpoint-mismatch",
			({ after }) => {
				after.mapIdentity.mapKey = "other";
			},
		],
		[
			"checkpoint-mismatch",
			({ before }) => {
				before.mapIdentity.mapSlot = "E1M2" as "E1M1";
			},
		],
		[
			"checkpoint-mismatch",
			({ after }) => {
				after.tic++;
			},
		],
		[
			"checkpoint-mismatch",
			({ after }) => {
				after.frame.tic++;
			},
		],
		[
			"checkpoint-mismatch",
			({ after }) => {
				after.counters.gametic++;
			},
		],
		[
			"checkpoint-mismatch",
			({ receipt }) => {
				receipt.cumulativeTics = 0;
			},
		],
		[
			"checkpoint-mismatch",
			({ after }) => {
				after.phase = "terminal";
			},
		],
	];
	for (const [reason, mutate] of cases) {
		const data = structuredClone(original);
		mutate(data);
		assert.deepEqual(summarizeMovement(data.before, data.receipt), {
			status: "unavailable",
			reason,
		});
	}
	for (const outcome of [
		"not-admitted",
		"stopped",
		"terminal",
		"retired",
		"api-failure",
	] as const) {
		assert.deepEqual(
			summarizeMovement(original.before, { ...original.receipt, outcome }),
			{
				status: "unavailable",
				reason: "not-completed",
			},
		);
	}
	assert.deepEqual(summarizeMovement(null, original.receipt), {
		status: "unavailable",
		reason: "missing-checkpoint",
	});
	// Unexpected malformed DTOs are also diagnostic failures, never exceptions.
	const malformed = structuredClone(original);
	Reflect.deleteProperty(malformed.after, "telemetry");
	assert.deepEqual(summarizeMovement(malformed.before, malformed.receipt), {
		status: "unavailable",
		reason: "diagnostic-error",
	});
});
