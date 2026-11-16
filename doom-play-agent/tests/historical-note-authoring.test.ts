import assert from "node:assert/strict";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { generateText, UserContent } from "ai";
import {
	authorHistoricalNote,
	HistoricalNoteAuthoringError,
} from "../src/historical-note-authoring.ts";
import { createOAuthProvider } from "../src/provider.ts";
import { savedRun, sha } from "./historical-note-fixtures.ts";

function model(t: Parameters<typeof savedRun>[0], output: unknown) {
	const auth = t.mock.fn(async () => {
		throw Error("Auth forbidden");
	});
	const provider = createOAuthProvider(auth);
	const generate = t.mock.fn(async (_options: unknown) => ({
		finishReason: "stop",
		output,
		response: {
			modelId: "synthetic-reported",
			headers: { authorization: "EXCLUDED_SECRET" },
		},
		usage: {
			inputTokens: 10,
			outputTokens: 20,
			totalTokens: 30,
			outputTokenDetails: { reasoningTokens: 15 },
			raw: "EXCLUDED_SECRET",
		},
	}));
	return {
		auth,
		provider,
		generate,
		dependencies: {
			provider,
			generate: generate as unknown as typeof generateText,
		},
	};
}

test("projects D17–D23, attaches sorted D17/D20/D22 before Buffers, and anchors D22 exactly", async (t) => {
	const f = await savedRun(t);
	const m = model(t, f.proposal());
	const result = await authorHistoricalNote(
		{
			...f.input,
			imageOrdinals: [22, 17, 20],
			decisionOrdinals: [...f.input.decisionOrdinals].reverse(),
		},
		m.dependencies,
	);
	assert.equal(m.auth.mock.callCount(), 0);
	assert.equal(m.generate.mock.callCount(), 1);
	assert.equal(result.decision, "propose");
	assert.deepEqual(result.note, f.proposal().note);
	assert.equal(result.note?.nextQuestion, null);
	assert.equal(result.note?.observationAnchor.tic, 127);
	assert.equal(result.note?.observationAnchor.rawX, 84595626);
	assert.notEqual(
		result.note?.observationAnchor.observationId,
		f.records[5].admissionObservation.observationId,
	);
	assert.notEqual(
		result.note?.observationAnchor.observationId,
		f.records[5].decision.receipt.observation.observationId,
	);
	const request = m.generate.mock.calls[0].arguments[0] as {
		maxRetries: number;
		maxOutputTokens: number;
		providerOptions: unknown;
		instructions: string;
		messages: { content: UserContent }[];
	};
	assert.equal(request.maxRetries, 0);
	assert.equal(request.maxOutputTokens, 2200);
	assert.deepEqual(request.providerOptions, {
		openai: { store: false, reasoningEffort: "xhigh" },
	});
	assert.match(request.instructions, /after D23/);
	assert.match(request.instructions, /Otherwise|null/i);
	assert.doesNotMatch(JSON.stringify(request), /EXCLUDED_SECRET/);
	const content = request.messages[0].content;
	assert.ok(Array.isArray(content));
	assert.equal(content.length, 7);
	assert.equal(content[0].type, "text");
	if (content[0].type !== "text") throw Error("Expected packet");
	const packet = JSON.parse(content[0].text);
	assert.deepEqual(packet, result.source.packet);
	assert.deepEqual(
		packet.records.map((r: { ordinal: number }) => r.ordinal),
		f.input.decisionOrdinals,
	);
	for (const [i, n] of [17, 20, 22].entries()) {
		const label: Exclude<UserContent, string>[number] = content[1 + i * 2];
		const image: Exclude<UserContent, string>[number] = content[2 + i * 2];
		assert.equal(label.type, "text");
		if (label.type !== "text" || image.type !== "file")
			throw Error("Expected label/file pair");
		assert.match(
			label.text,
			new RegExp(`ordinal ${n},.*decision-${n}-before.png`),
		);
		assert.equal(image.mediaType, "image/png");
		assert.ok(Buffer.isBuffer(image.data));
		assert.deepEqual(
			image.data,
			await readFile(join(f.root, `decision-${n}-before.png`)),
		);
		assert.notDeepEqual(
			image.data,
			await readFile(join(f.root, `decision-${n}-after.png`)),
		);
	}
	assert.equal(
		result.source.resultSha256,
		sha(await readFile(join(f.root, "result.json"))),
	);
	assert.equal(result.request.packetSha256, sha(content[0].text));
	assert.equal(result.model.reportedModel, "synthetic-reported");
	assert.deepEqual(result.model.usage, {
		inputTokens: 10,
		outputTokens: 20,
		totalTokens: 30,
		reasoningTokens: 15,
	});
	assert.ok(result.model.durationMs >= 0);
	assert.doesNotMatch(
		JSON.stringify(result),
		/EXCLUDED_SECRET|authorization|headers/,
	);
});

test("allows another attached anchor without forcing D22", async (t) => {
	const f = await savedRun(t);
	const result = await authorHistoricalNote(
		f.input,
		model(t, f.proposal(17)).dependencies,
	);
	assert.equal(result.note?.observationAnchor.ordinal, 17);
});

test("valid abstention contains no note", async (t) => {
	const f = await savedRun(t);
	const result = await authorHistoricalNote(
		f.input,
		model(t, {
			decision: "no_note",
			reason: "The view is not distinctive enough.",
			note: null,
		}).dependencies,
	);
	assert.equal(result.decision, "no_note");
	assert.equal(result.note, null);
	assert.equal(result.reason, "The view is not distinctive enough.");
});

const failures: [
	string,
	(f: Awaited<ReturnType<typeof savedRun>>) => void | Promise<void>,
][] = [
	["missing PNG", (f) => rm(join(f.root, "decision-22-before.png"))],
	[
		"bad PNG header with matching digest",
		async (f) => {
			const bytes = Buffer.alloc(33);
			await writeFile(join(f.root, "decision-22-before.png"), bytes);
			f.records[5].reasoningObservation.pngSha256 = sha(bytes);
			f.records[5].admissionObservation.pngSha256 = sha(bytes);
		},
	],
	[
		"digest mismatch",
		async (f) => {
			const bytes = f.png(22);
			bytes[32] = 99;
			await writeFile(join(f.root, "decision-22-before.png"), bytes);
		},
	],
	[
		"missing after PNG used by packet",
		(f) => rm(join(f.root, "decision-20-after.png")),
	],
	[
		"unsafe path",
		(f) => {
			f.records[5].beforePng.file = "../decision-22-before.png";
		},
	],
	[
		"wrong image role",
		(f) => {
			f.records[5].beforePng.file = "decision-22-after.png";
		},
	],
	[
		"duplicate selection",
		(f) => {
			f.input.decisionOrdinals.push(22);
		},
	],
	[
		"duplicate image selection",
		(f) => {
			f.input.imageOrdinals = [22, 22];
		},
	],
	[
		"image outside text window",
		(f) => {
			f.input.imageOrdinals = [16];
		},
	],
	[
		"missing ordinal",
		(f) => {
			f.saved.result.records.splice(5, 1);
		},
	],
	[
		"duplicate record",
		(f) => {
			f.saved.result.records.push(f.records[5]);
		},
	],
	[
		"wrong schema",
		(f) => {
			f.saved.schemaVersion = 2;
		},
	],
	[
		"wrong map",
		(f) => {
			f.records[5].reasoningObservation.mapIdentity = createMap();
		},
	],
	[
		"wrong session",
		(f) => {
			f.records[5].reasoningObservation.sessionId =
				"00000000-0000-4000-8000-000000000099";
		},
	],
	[
		"wrong run",
		(f) => {
			f.records[5].decision.input.scope.runId =
				"00000000-0000-4000-8000-000000000099";
		},
	],
	[
		"admission ID confused with reasoning ID",
		(f) => {
			f.records[5].decision.receipt.beforeObservationId =
				f.records[5].reasoningObservation.observationId;
		},
	],
	[
		"invalid observation ID",
		(f) => {
			f.records[5].reasoningObservation.observationId = "fabricated";
		},
	],
	[
		"reused observation ID",
		(f) => {
			f.records[5].reasoningObservation.observationId =
				f.records[4].reasoningObservation.observationId;
		},
	],
	[
		"invalid raw pose",
		(f) => {
			f.records[5].reasoningObservation.telemetry.x = 2147483648;
		},
	],
	[
		"wrong checkpoint tic",
		(f) => {
			f.records[5].reasoningObservation.frame.tic++;
		},
	],
	[
		"wrong tics",
		(f) => {
			f.records[5].decision.receipt.verifiedTics++;
		},
	],
	[
		"wrong movement",
		(f) => {
			f.records[5].movement.dxRaw++;
		},
	],
	[
		"uncertain completion",
		(f) => {
			f.records[5].decision.receipt.completionUncertain = true;
		},
	],
];
// Keep mutation fixtures independent; no historical run or database is accessed.
function createMap() {
	return {
		iwadSha256: "c".repeat(64),
		episode: 1 as const,
		map: 1 as const,
		mapSlot: "E1M1" as const,
		mapKey: `doom-map:v1:iwad-sha256:${"c".repeat(64)}:E1M1`,
	};
}
for (const [name, mutate] of failures) {
	test(`rejects ${name} before any generation`, async (t) => {
		const f = await savedRun(t);
		const m = model(t, f.proposal());
		await mutate(f);
		await f.save();
		await assert.rejects(
			authorHistoricalNote(f.input, m.dependencies),
			HistoricalNoteAuthoringError,
		);
		assert.equal(m.generate.mock.callCount(), 0);
		assert.equal(m.auth.mock.callCount(), 0);
	});
}

test("rejects a sidecar symlink escaping the run", async (t) => {
	const f = await savedRun(t);
	const other = await savedRun(t);
	await rm(join(f.root, "decision-22-before.png"));
	await symlink(
		join(other.root, "decision-22-before.png"),
		join(f.root, "decision-22-before.png"),
	);
	const m = model(t, f.proposal());
	await assert.rejects(authorHistoricalNote(f.input, m.dependencies), {
		code: "png-read",
	});
	assert.equal(m.generate.mock.callCount(), 0);
});

for (const name of [
	"nonattached anchor",
	"after anchor",
	"fabricated pose",
	"wrong source digest",
	"empty evidence",
	"missing anchor evidence",
	"proposal reason",
	"proposal without note",
	"abstention note",
	"abstention without reason",
	"empty abstention reason",
] as const) {
	test(`rejects ${name} response with exactly one attempt`, async (t) => {
		const f = await savedRun(t);
		const output: {
			decision: string;
			reason: string | null;
			note: ReturnType<typeof f.proposal>["note"] | null;
		} = f.proposal();
		const note = output.note;
		assert.ok(note);
		switch (name) {
			case "nonattached anchor":
				output.note = f.proposal(18).note;
				break;
			case "after anchor":
				note.observationAnchor.observationId =
					f.records[5].decision.receipt.observation.observationId;
				break;
			case "fabricated pose":
				note.observationAnchor.rawX++;
				break;
			case "wrong source digest":
				note.sourceEvidence[0].pngSha256 = "f".repeat(64);
				break;
			case "empty evidence":
				note.sourceEvidence = [];
				break;
			case "missing anchor evidence":
				note.sourceEvidence = f.proposal(17).note.sourceEvidence;
				break;
			case "proposal reason":
				output.reason = "Unexpected";
				break;
			case "proposal without note":
				output.note = null;
				break;
			case "abstention note":
				output.decision = "no_note";
				output.reason = "No note";
				break;
			case "abstention without reason":
				output.decision = "no_note";
				output.note = null;
				break;
			case "empty abstention reason":
				output.decision = "no_note";
				output.reason = " ";
				output.note = null;
				break;
		}
		const m = model(t, output);
		await assert.rejects(authorHistoricalNote(f.input, m.dependencies), {
			code: "response",
		});
		assert.equal(m.generate.mock.callCount(), 1);
	});
}

test("generation failure is sanitized and not retried or called abstention", async (t) => {
	const f = await savedRun(t);
	const m = model(t, null);
	m.generate.mock.mockImplementation(async () => {
		throw Error("SECRET auth details");
	});
	await assert.rejects(
		authorHistoricalNote(f.input, m.dependencies),
		(error: unknown) =>
			error instanceof HistoricalNoteAuthoringError &&
			error.code === "generation" &&
			!error.message.includes("SECRET"),
	);
	assert.equal(m.generate.mock.callCount(), 1);
});
