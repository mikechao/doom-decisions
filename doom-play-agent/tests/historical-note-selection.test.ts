import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import test, { after, afterEach, mock, type TestContext } from "node:test";
import { savedRun, sha } from "./historical-note-fixtures.ts";

const network = mock.method(globalThis, "fetch", async () => {
	throw Error("Network forbidden, including during import");
});
const ai = await import("ai");
const forbidden = mock.fn(() => {
	throw Error("Inference, credentials and selector writes forbidden");
});
const registrations = [
	mock.module("ai", { namedExports: { ...ai, generateText: forbidden } }),
	mock.module("@openai-oauth/local", {
		namedExports: { openaiCredentials: forbidden },
	}),
	mock.module("node:fs/promises", {
		namedExports: {
			...fs,
			writeFile: forbidden,
			appendFile: forbidden,
			mkdir: forbidden,
			rm: forbidden,
		},
	}),
];
const { selectHistoricalNoteEvidence, HistoricalNoteAuthoringError } =
	await import("../src/historical-note-authoring.ts");
afterEach(() => {
	assert.equal(forbidden.mock.callCount(), 0);
	assert.equal(network.mock.callCount(), 0);
});
after(() => {
	for (const registration of registrations) registration.restore();
	network.mock.restore();
});

async function selectionRun(t: TestContext, events = [4, 10]) {
	const f = await savedRun(t, {
		firstOrdinal: 1,
		count: 16,
		distinctFrames: true,
	});
	for (const r of f.records) {
		for (const [n, o] of [
			[r.ordinal, r.reasoningObservation],
			[r.ordinal, r.admissionObservation],
			[r.ordinal + 1, r.decision.receipt.observation],
		] as const) {
			const kind = events.some((d) => n === d || n === d + 1) ? 2 : 1;
			o.facingProbe = {
				tic: o.tic,
				kind,
				door: 0,
				distance: kind === 1 ? -1 : 32,
			};
		}
	}
	await f.save();
	return f;
}

test("earliest sustained event selects exact ordinals and verified before provenance", async (t) => {
	const f = await selectionRun(t);
	// Selection follows ordinals, not persistence array order or historical prose.
	f.records.reverse();
	await f.save();
	const result = await selectHistoricalNoteEvidence(f.root);
	assert.equal(result.kind, "selected");
	if (result.kind !== "selected") throw Error("Expected selected packet");
	assert.deepEqual(result.decisionOrdinals, [2, 3, 4, 5, 6, 7, 8]);
	assert.deepEqual(result.imageOrdinals, [2, 5, 8]);
	assert.deepEqual(result.provenance, {
		ruleVersion: "boundary-encounter-v1",
		runId: f.saved.result.runId,
		resultSha256: sha(await fs.readFile(join(f.root, "result.json"))),
		mapIdentity: f.records[0].reasoningObservation.mapIdentity,
		sessionId: f.records[0].reasoningObservation.sessionId,
		beforeImages: [2, 5, 8].map((n) => {
			const o = f.records.find((r) => r.ordinal === n)?.reasoningObservation;
			assert.ok(o);
			return {
				ordinal: n,
				observationId: o.observationId,
				tic: o.tic,
				pngSha256: o.pngSha256,
				nativeSha256: o.frame.nativeSha256,
				canvasSha256: o.frame.canvasSha256,
			};
		}),
	});
	assert.doesNotMatch(JSON.stringify(result), /EXCLUDED_SECRET/);
});

test("isolated kind 2 is skipped in favor of the first sustained event", async (t) => {
	const f = await selectionRun(t, [10]);
	f.records[3].reasoningObservation.facingProbe = {
		tic: f.records[3].reasoningObservation.tic,
		kind: 2,
		door: 0,
		distance: 32,
	};
	await f.save();
	const result = await selectHistoricalNoteEvidence(f.root);
	assert.equal(result.kind, "selected");
	if (result.kind !== "selected") throw Error("Expected selected packet");
	assert.deepEqual(result.decisionOrdinals, [8, 9, 10, 11, 12, 13, 14]);
	assert.deepEqual(result.imageOrdinals, [8, 11, 14]);
});

for (const scenario of ["all-one", "all-two", "isolated", "null", "gap"]) {
	test(`no sustained transition: ${scenario}`, async (t) => {
		const f = await selectionRun(t, scenario === "gap" ? [4] : []);
		if (scenario === "all-two")
			for (const r of f.records) {
				r.reasoningObservation.facingProbe.kind = 2;
				r.reasoningObservation.facingProbe.distance = 32;
			}
		if (scenario === "isolated") {
			f.records[3].reasoningObservation.facingProbe.kind = 2;
			f.records[3].reasoningObservation.facingProbe.distance = 32;
		}
		if (scenario === "null")
			for (const r of f.records)
				Object.assign(r.reasoningObservation, { facingProbe: null });
		if (scenario === "gap") f.records.splice(2, 1);
		await f.save();
		assert.deepEqual(await selectHistoricalNoteEvidence(f.root), {
			kind: "no_candidate",
			reason: "No sustained 1-to-2 boundary encounter.",
		});
	});
}

for (const scenario of ["start", "end", "missing-record"]) {
	test(`incomplete earliest window does not shift or fall back: ${scenario}`, async (t) => {
		const events =
			scenario === "end" ? [14] : scenario === "start" ? [2, 10] : [4, 10];
		const f = await selectionRun(t, events);
		if (scenario === "missing-record") {
			// Event 4 survives, but its first context record (D2) is absent.
			f.records.splice(1, 1);
			await f.save();
		}
		assert.deepEqual(await selectHistoricalNoteEvidence(f.root), {
			kind: "no_candidate",
			reason:
				"Earliest boundary encounter lacks a complete seven-record window.",
		});
	});
}

for (const identity of ["png", "frame"]) {
	test(`duplicate selected ${identity} identity abstains without replacement`, async (t) => {
		const f = await selectionRun(t);
		const original = f.records[1].reasoningObservation;
		// Maintain all checkpoint joins so duplicate detection follows validation.
		for (const o of [
			f.records[4].reasoningObservation,
			f.records[4].admissionObservation,
			f.records[3].decision.receipt.observation,
		]) {
			if (identity === "png") o.pngSha256 = original.pngSha256;
			else {
				o.frame.nativeSha256 = original.frame.nativeSha256;
				o.frame.canvasSha256 = original.frame.canvasSha256;
			}
		}
		if (identity === "png") {
			await fs.writeFile(join(f.root, "decision-5-before.png"), f.png(2));
			await fs.writeFile(join(f.root, "decision-4-after.png"), f.png(2));
		}
		await f.save();
		assert.deepEqual(await selectHistoricalNoteEvidence(f.root), {
			kind: "no_candidate",
			reason:
				"Selected before images contain duplicate PNG or frame identities.",
		});
	});
}

const corruptions: [
	string,
	(f: Awaited<ReturnType<typeof selectionRun>>) => void | Promise<void>,
][] = [
	[
		"schema v2",
		(f) => {
			f.saved.schemaVersion = 2;
		},
	],
	["missing selected PNG", (f) => fs.rm(join(f.root, "decision-5-before.png"))],
	[
		"missing unattached after PNG",
		(f) => fs.rm(join(f.root, "decision-3-after.png")),
	],
	[
		"PNG digest mismatch",
		(f) => fs.writeFile(join(f.root, "decision-5-before.png"), f.png(6)),
	],
	[
		"uncertain receipt",
		(f) => {
			Object.assign(f.records[3].decision.receipt, {
				completionUncertain: true,
			});
		},
	],
	[
		"bad receipt tics",
		(f) => {
			f.records[3].decision.receipt.verifiedTics++;
		},
	],
	[
		"bad movement",
		(f) => {
			f.records[3].movement.distance++;
		},
	],
	[
		"bad probe tic",
		(f) => {
			f.records[3].reasoningObservation.facingProbe.tic++;
		},
	],
	[
		"wrong session",
		(f) => {
			f.records[3].reasoningObservation.sessionId = f.saved.result.runId;
		},
	],
	[
		"wrong run",
		(f) => {
			f.records[3].reasoningObservation.run.runId =
				f.records[3].reasoningObservation.sessionId;
		},
	],
	[
		"wrong map",
		(f) => {
			f.records[3].reasoningObservation.mapIdentity = {
				...f.records[3].reasoningObservation.mapIdentity,
				mapKey: "wrong",
			};
		},
	],
	[
		"duplicate ordinal",
		(f) => {
			f.records.push(f.records[3]);
		},
	],
	[
		"reused observation ID",
		(f) => {
			f.records[3].reasoningObservation.observationId =
				f.records[2].reasoningObservation.observationId;
		},
	],
	[
		"broken checkpoint join",
		(f) => {
			f.records[3].decision.receipt.observation.telemetry.x++;
		},
	],
];
for (const [name, mutate] of corruptions) {
	test(`required evidence corruption throws, not no_candidate: ${name}`, async (t) => {
		const f = await selectionRun(t);
		await mutate(f);
		await f.save();
		await assert.rejects(
			selectHistoricalNoteEvidence(f.root),
			HistoricalNoteAuthoringError,
		);
	});
}

test("invalid scan metadata throws even without an event", async (t) => {
	const f = await selectionRun(t, []);
	f.records[3].reasoningObservation.facingProbe.distance = 32;
	await f.save();
	await assert.rejects(selectHistoricalNoteEvidence(f.root), {
		code: "checkpoint",
	});
});

test("unreadable or malformed saved JSON fails without returning no_candidate", async (t) => {
	const f = await selectionRun(t);
	await fs.writeFile(join(f.root, "result.json"), "not JSON");
	await assert.rejects(selectHistoricalNoteEvidence(f.root), {
		code: "saved-run",
	});
	await fs.rm(join(f.root, "result.json"));
	await assert.rejects(selectHistoricalNoteEvidence(f.root), {
		code: "saved-run",
	});
});

test("deterministic, read-only selection leaves fixture bytes unchanged", async (t) => {
	const f = await selectionRun(t);
	const snapshot = async () =>
		Promise.all(
			(await fs.readdir(f.root))
				.sort()
				.map(async (file) => [
					file,
					sha(await fs.readFile(join(f.root, file))),
				]),
		);
	const before = await snapshot();
	const first = await selectHistoricalNoteEvidence(f.root);
	assert.deepEqual(await selectHistoricalNoteEvidence(f.root), first);
	assert.deepEqual(await snapshot(), before);
});
