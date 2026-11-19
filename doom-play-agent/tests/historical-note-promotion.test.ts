import assert from "node:assert/strict";
import {
	readFile,
	rename,
	rm,
	stat,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
	findExactMemory,
	findMemory,
	readMemoryReferencePng,
	recordMemory,
} from "../../app/doom-memory.mjs";
import { memoryFixturePng } from "../../app/tests/fixtures/doom-memory.ts";
import { play } from "../src/doom-play-agent.ts";
import { createDoomTools } from "../src/doom-tools.ts";
import {
	prepareHistoricalNotePromotion,
	promoteHistoricalNote,
} from "../src/historical-note-promotion.ts";
import { fixture } from "./fixtures.ts";
import { savedRun, sha } from "./historical-note-fixtures.ts";
import { promotionFixture } from "./historical-note-promotion-fixtures.ts";

test("exact mapping, byte-based identity, deterministic attribution and immutable payload", async (t) => {
	const f = await promotionFixture(t);
	const original = await readFile(f.draft);
	const dbBefore = await readFile(f.database);
	const prepared = await prepareHistoricalNotePromotion(f.draft, f.geometry);
	assert.equal(prepared.selectionMode, "unspecified");
	assert.equal(prepared.draftSha256, sha(original));
	assert.deepEqual(prepared.payload, {
		operation: "create",
		requestId: `approve-note:v2:${sha(`${sha(original)}:${sha(await readFile(f.geometry))}`)}`,
		mapNamespace: f.artifact.note.observationAnchor.mapKey,
		x: 84595626,
		y: -215789052,
		angle: 3837788160,
		hypothesis: f.artifact.note.hypothesis,
		nextQuestion: f.artifact.note.nextQuestion,
		recognition: {
			reference: {
				runId: f.artifact.note.observationAnchor.runId,
				ordinal: 22,
				observationId: "0728dad7-969d-464c-bc02-847bdc44e4c2",
				tic: 127,
				runResultSha256: sha(await readFile(join(f.root, "result.json"))),
				pngSha256: sha(f.referencePng),
				frameSha256: f.records[5].reasoningObservation.frame.nativeSha256,
			},
			geometry: f.geometryArtifact.geometry,
		},
		source: prepared.payload.source,
		isLandmark: true,
		isActiveExploration: true,
	});
	assert.equal(prepared.geometrySha256, sha(await readFile(f.geometry)));
	assert.equal(
		Reflect.set(
			prepared.payload.recognition.geometry.segments[0].front,
			"floor",
			999,
		),
		false,
	);
	assert.equal("selectionProvenance" in prepared, false);
	for (const value of [
		sha(original),
		f.artifact.note.observationAnchor.runId,
		"D22",
		"tic:127",
		"0728dad7-969d-464c-bc02-847bdc44e4c2",
		f.artifact.note.sourceEvidence[0].pngSha256,
	])
		assert.ok(prepared.payload.source.includes(value));
	assert.ok(prepared.payload.source.length <= 512);
	assert.ok(!prepared.payload.source.includes(f.root));
	assert.equal(Reflect.set(prepared.payload, "hypothesis", "Changed"), false);
	assert.deepEqual(
		(await prepareHistoricalNotePromotion(f.draft, f.geometry)).payload,
		prepared.payload,
	);
	const relocated = join(f.root, "relocated.json");
	await writeFile(relocated, original);
	assert.deepEqual(
		(await prepareHistoricalNotePromotion(relocated, f.geometry)).payload,
		prepared.payload,
	);
	assert.deepEqual(await readFile(f.draft), original);
	assert.deepEqual(await readFile(f.database), dbBefore);
});

test("first approved note in a fresh v4 store retains the exact reference and geometry", async (t) => {
	const f = await promotionFixture(t);
	const anchor = f.artifact.note.observationAnchor;
	const query = { mode: "active-landmarks", mapNamespace: anchor.mapKey };
	assert.deepEqual((await findMemory(query)).candidates, []);
	const prepared = await prepareHistoricalNotePromotion(f.draft, f.geometry);
	const receipt = await promoteHistoricalNote(prepared);
	const beforeRead = await readFile(f.database);
	const { candidates } = await findMemory(query);
	assert.equal(candidates.length, 1);
	const [note] = candidates;
	assert.equal(note.noteId, receipt.noteId);
	assert.equal(note.revision, 1);
	assert.equal(note.mapNamespace, anchor.mapKey);
	assert.deepEqual(note.anchor, {
		x: anchor.rawX,
		y: anchor.rawY,
		angle: anchor.rawAngle,
	});
	assert.equal(note.nextQuestion, f.artifact.note.nextQuestion);
	assert.deepEqual(note.recognition, prepared.payload.recognition);
	const host = await createDoomTools().findActiveLandmarks({
		mapIdentity: f.records[0].reasoningObservation.mapIdentity,
	});
	assert.deepEqual(
		host.candidates.map(({ noteId, nextQuestion, recognition }) => ({
			noteId,
			nextQuestion,
			recognition,
		})),
		[
			{
				noteId: note.noteId,
				nextQuestion: note.nextQuestion,
				recognition: note.recognition,
			},
		],
	);
	assert.deepEqual(
		readMemoryReferencePng(note.recognition.reference),
		f.referencePng,
	);
	assert.deepEqual(await readFile(f.database), beforeRead);
});

test("promotion checks the pinned audit bytes, exact map and selected linedef records", async (t) => {
	const f = await promotionFixture(t);
	const before = await readFile(f.database);
	const originalAudit = await readFile(f.auditPath);
	const source = f.geometryArtifact;
	const [segment, second] = source.geometry.segments;
	await f.saveGeometry({
		...source,
		geometry: {
			...source.geometry,
			segments: [
				{
					...segment,
					back: { ...segment.back, floor: segment.back.floor + 1 },
				},
				second,
			],
		},
	});
	const rejectsAudit = () =>
		assert.rejects(prepareHistoricalNotePromotion(f.draft, f.geometry), {
			code: "geometry",
		});
	await rejectsAudit();
	await f.saveGeometry();
	await writeFile(
		f.auditPath,
		Buffer.concat([originalAudit, Buffer.from("\n")]),
	);
	await rejectsAudit();
	const foreignAudit = JSON.stringify({
		...f.auditArtifact,
		mapKey: source.mapKey.replace("a".repeat(64), "b".repeat(64)),
	});
	await writeFile(f.auditPath, foreignAudit);
	await f.saveGeometry({
		...source,
		geometry: {
			...source.geometry,
			provenance: {
				...source.geometry.provenance,
				artifactSha256: sha(foreignAudit),
			},
		},
	});
	await rejectsAudit();
	assert.deepEqual(await readFile(f.database), before);
	await assert.rejects(stat(`${f.database}.refs`), { code: "ENOENT" });
});

test("promotion rejects a correctly hashed replacement PNG whose pixels differ from the frame receipt", async (t) => {
	const replacement = memoryFixturePng(123);
	const f = await promotionFixture(t, "unspecified", replacement);
	assert.equal(f.geometryArtifact.pngSha256, sha(replacement));
	const before = await readFile(f.database);
	await assert.rejects(prepareHistoricalNotePromotion(f.draft, f.geometry), {
		code: "evidence",
	});
	assert.deepEqual(await readFile(f.database), before);
	await assert.rejects(stat(`${f.database}.refs`), { code: "ENOENT" });
});

test("missing or invalid geometry and an unresolved-question omission fail before writes", async (t) => {
	const f = await promotionFixture(t);
	const before = await readFile(f.database);
	const source = f.geometryArtifact;
	const geometry = source.geometry;
	const segment = geometry.segments[0];
	for (const value of [
		{
			...source,
			mapKey: source.mapKey.replace("a".repeat(64), "b".repeat(64)),
		},
		{ ...source, observationId: "00000000-0000-4000-8000-000000000999" },
		{ ...source, pngSha256: "0".repeat(64) },
		{ ...source, geometry: undefined },
		{
			...source,
			geometry: {
				...geometry,
				provenance: { ...geometry.provenance, method: "model-guess" },
			},
		},
		{
			...source,
			geometry: {
				...geometry,
				provenance: { ...geometry.provenance, artifactSha256: "A".repeat(64) },
			},
		},
		{
			...source,
			geometry: {
				...geometry,
				segments: [
					segment,
					{ ...geometry.segments[1], linedefOrdinal: segment.linedefOrdinal },
				],
			},
		},
		{
			...source,
			geometry: {
				...geometry,
				segments: [
					{
						...segment,
						endpoints: [
							[0, 0],
							[0, 0],
						],
					},
				],
			},
		},
		{
			...source,
			geometry: {
				...geometry,
				segments: [{ ...segment, front: { ...segment.front, floor: 32768 } }],
			},
		},
	]) {
		await f.saveGeometry(value);
		await assert.rejects(prepareHistoricalNotePromotion(f.draft, f.geometry), {
			code: "geometry",
		});
	}
	await rm(f.geometry);
	await assert.rejects(prepareHistoricalNotePromotion(f.draft, f.geometry), {
		code: "geometry",
	});
	await f.saveGeometry();
	for (const nextQuestion of [undefined, null, " \t"]) {
		await f.saveDraft({
			...f.artifact,
			note: { ...f.artifact.note, nextQuestion },
		});
		await assert.rejects(prepareHistoricalNotePromotion(f.draft, f.geometry), {
			code: "draft",
		});
	}
	assert.deepEqual(await readFile(f.database), before);
	await assert.rejects(stat(`${f.database}.refs`), { code: "ENOENT" });
});

for (const mode of ["automatic", "manual", "unspecified"] as const) {
	test(`accepts ${mode} artifact without manufacturing metadata`, async (t) => {
		const f = await promotionFixture(t, mode);
		f.artifact.note.nextQuestion =
			"Does a clearer view show a terminating wall?";
		await f.saveDraft();
		const prepared = await prepareHistoricalNotePromotion(f.draft, f.geometry);
		assert.equal(prepared.selectionMode, mode);
		assert.equal(prepared.payload.nextQuestion, f.artifact.note.nextQuestion);
		assert.equal("selectionProvenance" in prepared, false);
	});
}

const corruptions: [
	string,
	(f: Awaited<ReturnType<typeof promotionFixture>>) => Promise<unknown>,
][] = [
	[
		"unsupported draft",
		async (f) => {
			const a = await f.readDraft();
			a.schemaVersion = 2;
			await f.saveDraft(a);
		},
	],
	[
		"wrong status",
		async (f) => {
			const a = await f.readDraft();
			a.status = "approved";
			await f.saveDraft(a);
		},
	],
	[
		"no_note",
		async (f) => {
			const a = await f.readDraft();
			a.decision = "no_note";
			a.note = null;
			a.reason = "No distinctive scene";
			await f.saveDraft(a);
		},
	],
	[
		"proposal reason",
		async (f) => {
			const a = await f.readDraft();
			a.reason = "Unexpected";
			await f.saveDraft(a);
		},
	],
	[
		"missing metadata",
		async (f) => {
			const a = await f.readDraft();
			delete a.request;
			await f.saveDraft(a);
		},
	],
	[
		"empty hypothesis",
		async (f) => {
			const a = await f.readDraft();
			a.note.hypothesis = " ";
			await f.saveDraft(a);
		},
	],
	[
		"normalized text",
		async (f) => {
			const a = await f.readDraft();
			a.note.hypothesis += " ";
			await f.saveDraft(a);
		},
	],
	[
		"anchor pose",
		async (f) => {
			const a = await f.readDraft();
			a.note.observationAnchor.rawX++;
			await f.saveDraft(a);
		},
	],
	[
		"anchor after image",
		async (f) => {
			const a = await f.readDraft();
			a.note.observationAnchor.observationId =
				f.records[5].decision.receipt.observation.observationId;
			await f.saveDraft(a);
		},
	],
	[
		"anchor map",
		async (f) => {
			const a = await f.readDraft();
			a.note.observationAnchor.mapKey = a.note.observationAnchor.mapKey.replace(
				/a/g,
				"c",
			);
			await f.saveDraft(a);
		},
	],
	[
		"source evidence PNG hash",
		async (f) => {
			const a = await f.readDraft();
			a.note.sourceEvidence[0].pngSha256 = "f".repeat(64);
			await f.saveDraft(a);
		},
	],
	[
		"missing anchor reference",
		async (f) => {
			const a = await f.readDraft();
			a.note.sourceEvidence = [];
			await f.saveDraft(a);
		},
	],
	[
		"packet hash",
		async (f) => {
			const a = await f.readDraft();
			a.request.packetSha256 = "f".repeat(64);
			await f.saveDraft(a);
		},
	],
	[
		"packet tampering with updated hash",
		async (f) => {
			const a = await f.readDraft();
			a.source.packet.runId = "00000000-0000-4000-8000-000000000999";
			a.request.packetSha256 = sha(JSON.stringify(a.source.packet));
			await f.saveDraft(a);
		},
	],
	[
		"attachment identity",
		async (f) => {
			const a = await f.readDraft();
			a.request.imageAttachments[0].png.sha256 = "f".repeat(64);
			await f.saveDraft(a);
		},
	],
	["missing run", async (f) => rm(join(f.root, "result.json"))],
	["missing sidecar", async (f) => rm(join(f.root, "decision-22-before.png"))],
	[
		"changed sidecar",
		async (f) => writeFile(join(f.root, "decision-22-after.png"), f.png(255)),
	],
	[
		"changed result bytes",
		async (f) =>
			writeFile(
				join(f.root, "result.json"),
				`${await readFile(join(f.root, "result.json"), "utf8")} `,
			),
	],
	[
		"source version",
		async (f) => {
			f.saved.schemaVersion = 2;
			await f.save();
		},
	],
	[
		"source full map identity",
		async (f) => {
			f.records[0].reasoningObservation.mapIdentity.mapKey += "wrong";
			await f.save();
		},
	],
	["malformed JSON", async (f) => writeFile(f.draft, "{")],
	["oversized draft", async (f) => truncate(f.draft, 1024 * 1024 + 1)],
	[
		"oversized result",
		async (f) => truncate(join(f.root, "result.json"), 64 * 1024 * 1024 + 1),
	],
	[
		"oversized sidecar",
		async (f) =>
			truncate(join(f.root, "decision-22-before.png"), 2 * 1024 * 1024 + 1),
	],
	[
		"unexpected selection provenance",
		async (f) => {
			const a = await f.readDraft();
			a.selectionProvenance = {};
			await f.saveDraft(a);
		},
	],
];
for (const [name, corrupt] of corruptions) {
	test(`rejects ${name} before writing`, async (t) => {
		const f = await promotionFixture(t);
		await corrupt(f);
		const before = await readFile(f.database);
		const writer = t.mock.fn(recordMemory);
		await assert.rejects(async () =>
			promoteHistoricalNote(
				await prepareHistoricalNotePromotion(f.draft, f.geometry),
				writer,
			),
		);
		assert.equal(writer.mock.callCount(), 0);
		assert.deepEqual(await readFile(f.database), before);
	});
}

test("rejects mismatched automatic provenance without running selection again", async (t) => {
	const f = await promotionFixture(t, "automatic");
	const a = await f.readDraft();
	a.selectionProvenance.beforeImages[0].pngSha256 = "f".repeat(64);
	await f.saveDraft(a);
	await assert.rejects(prepareHistoricalNotePromotion(f.draft, f.geometry), {
		code: "evidence",
	});
});

test("selected-evidence validation ignores an unrelated unselected damaged record", async (t) => {
	const f = await promotionFixture(t);
	const path = join(f.root, "result.json");
	const saved = JSON.parse(await readFile(path, "utf8"));
	saved.result.records.push({ ordinal: 999, damaged: true });
	const bytes = `${JSON.stringify(saved)}\n`;
	await writeFile(path, bytes);
	f.artifact.source.resultSha256 = sha(bytes);
	await f.saveDraft();
	assert.equal(
		(await prepareHistoricalNotePromotion(f.draft, f.geometry)).payload
			.hypothesis,
		f.artifact.note.hypothesis,
	);
});

test("rejects escaped source files and non-regular draft files", async (t) => {
	const f = await promotionFixture(t);
	const other = await savedRun(t);
	await rm(join(f.root, "decision-22-before.png"));
	await symlink(
		join(other.root, "decision-22-before.png"),
		join(f.root, "decision-22-before.png"),
	);
	await assert.rejects(prepareHistoricalNotePromotion(f.draft, f.geometry), {
		code: "evidence",
	});
	await assert.rejects(prepareHistoricalNotePromotion(f.root, f.geometry), {
		code: "draft",
	});
	await rm(join(f.root, "result.json"));
	await symlink(join(other.root, "result.json"), join(f.root, "result.json"));
	await assert.rejects(prepareHistoricalNotePromotion(f.draft, f.geometry), {
		code: "evidence",
	});
});

test("requires existing supported database and refuses deletion or path changes before write", async (t) => {
	const f = await promotionFixture(t);
	const prepared = await prepareHistoricalNotePromotion(f.draft, f.geometry);
	const writer = t.mock.fn(recordMemory);
	process.env.DOOM_MEMORY_DB = join(f.root, "missing.sqlite");
	await assert.rejects(prepareHistoricalNotePromotion(f.draft, f.geometry), {
		code: "database",
	});
	await assert.rejects(promoteHistoricalNote(prepared, writer), {
		code: "database",
	});
	await assert.rejects(readFile(process.env.DOOM_MEMORY_DB));
	process.env.DOOM_MEMORY_DB = f.database;
	await rm(f.database);
	await assert.rejects(promoteHistoricalNote(prepared, writer), {
		code: "database",
	});
	assert.equal(writer.mock.callCount(), 0);
	await assert.rejects(readFile(f.database));
	await writeFile(f.database, "not a database");
	await assert.rejects(prepareHistoricalNotePromotion(f.draft, f.geometry), {
		code: "database",
	});
	assert.equal(await readFile(f.database, "utf8"), "not a database");
});

for (const replacement of ["empty", "valid SQLite copy"] as const) {
	test(`rejects same-path database replacement with ${replacement} before invoking writer`, async (t) => {
		const f = await promotionFixture(t);
		const prepared = await prepareHistoricalNotePromotion(f.draft, f.geometry);
		const original = await readFile(f.database);
		const info = await stat(f.database, { bigint: true });
		assert.deepEqual(prepared.databaseIdentity, {
			path: f.database,
			device: info.dev.toString(),
			inode: info.ino.toString(),
		});
		assert.equal(Object.isFrozen(prepared.databaseIdentity), true);
		// Keep the original inode allocated so the replacement cannot reuse it.
		const backup = join(f.root, "previewed.sqlite");
		await rename(f.database, backup);
		const replacedBytes = replacement === "empty" ? Buffer.alloc(0) : original;
		await writeFile(f.database, replacedBytes);
		assert.notEqual((await stat(f.database, { bigint: true })).ino, info.ino);
		const writer = t.mock.fn(recordMemory);
		await assert.rejects(promoteHistoricalNote(prepared, writer), {
			code: "database",
		});
		assert.equal(writer.mock.callCount(), 0);
		assert.deepEqual(await readFile(f.database), replacedBytes);
		assert.deepEqual(await readFile(backup), original);
	});
}

test("exact lookup checks full equality, ignores flags, permits same-source replay and is read-only", async (t) => {
	const f = await promotionFixture(t);
	const { payload } = await prepareHistoricalNotePromotion(f.draft, f.geometry);
	const existingPayload = {
		...payload,
		requestId: "exact-existing",
		source: "Existing synthetic source",
		isLandmark: false,
		isActiveExploration: false,
	};
	const existing = await recordMemory(existingPayload, f.referencePng);
	const before = await readFile(f.database);
	assert.deepEqual(await findExactMemory(payload), { noteId: existing.noteId });
	assert.equal(await findExactMemory(existingPayload), null);
	for (const difference of [
		{ mapNamespace: `doom-map:v1:iwad-sha256:${"b".repeat(64)}:E1M1` },
		{ x: payload.x + 1 },
		{ y: payload.y + 1 },
		{ angle: payload.angle + 1 },
		{ hypothesis: "Different hypothesis" },
		{ nextQuestion: "Different question?" },
	])
		assert.equal(await findExactMemory({ ...payload, ...difference }), null);
	assert.deepEqual(await readFile(f.database), before);
});

for (const active of [true, false]) {
	test(`exact duplicate hidden beyond both preview limits is rejected (active ${active})`, async (t) => {
		const f = await promotionFixture(t);
		const first = await prepareHistoricalNotePromotion(f.draft, f.geometry);
		const notes = [];
		for (let i = 0; i < 11; i++)
			notes.push(
				await recordMemory(
					{
						...first.payload,
						requestId: `crowded-${i}`,
						source: "Synthetic crowded fixture",
						hypothesis: `Other hypothesis ${i}`,
					},
					f.referencePng,
				),
			);
		// Nearby ties break by note ID. Hide the exact match eleventh in that order
		// and behind ten older active notes (or make it inactive in the string case).
		const hidden = notes.sort((a, b) => (a.noteId < b.noteId ? -1 : 1)).at(-1);
		assert.ok(hidden);
		const db = new DatabaseSync(f.database);
		try {
			db.exec("UPDATE notes SET created_at = '2000-01-01'");
			db.prepare(`UPDATE notes SET hypothesis = ?, next_question = ?, source = ?,
				created_at = '2100-01-01', is_active_exploration = ? WHERE note_id = ?`).run(
				first.payload.hypothesis,
				first.payload.nextQuestion,
				first.payload.source,
				Number(active),
				hidden.noteId,
			);
		} finally {
			db.close();
		}
		await writeFile(f.draft, `${await readFile(f.draft, "utf8")}\n`);
		const before = await readFile(f.database);
		const duplicate = await prepareHistoricalNotePromotion(f.draft, f.geometry);
		assert.notEqual(duplicate.payload.requestId, first.payload.requestId);
		assert.equal(duplicate.overlap.candidates.length, 10);
		assert.equal(
			duplicate.overlap.candidates.some((n) => n.noteId === hidden.noteId),
			false,
		);
		assert.equal(duplicate.overlap.activeHasMore, active);
		assert.equal(duplicate.overlap.nearbyMayBeTruncated, true);
		assert.equal(duplicate.representedBy, hidden.noteId);
		const writer = t.mock.fn(recordMemory);
		await assert.rejects(promoteHistoricalNote(duplicate, writer), {
			code: "duplicate",
		});
		assert.equal(writer.mock.callCount(), 0);
		assert.deepEqual(await readFile(f.database), before);
	});
}

test("one disposable round trip, exact replay, distinct-byte duplicate protection and oldest selection", async (t) => {
	const f = await promotionFixture(t);
	const first = await prepareHistoricalNotePromotion(f.draft, f.geometry);
	const older = await recordMemory(
		{
			...first.payload,
			requestId: "older",
			source: "Synthetic older lead",
			hypothesis: "A separate earlier hypothesis",
			x: 100,
		},
		f.referencePng,
	);
	const db = new DatabaseSync(f.database);
	try {
		db.prepare("UPDATE notes SET created_at = ? WHERE note_id = ?").run(
			"2000-01-01",
			older.noteId,
		);
	} finally {
		db.close();
	}
	const reviewed = await prepareHistoricalNotePromotion(f.draft, f.geometry);
	assert.ok(reviewed.overlap.candidates.some((n) => n.noteId === older.noteId));
	const receipt = await promoteHistoricalNote(reviewed);
	assert.equal(receipt.replayed, false);
	assert.equal(receipt.status, "unverified");
	assert.equal(receipt.revision, 1);
	const again = await prepareHistoricalNotePromotion(f.draft, f.geometry);
	assert.equal(again.representedBy, null);
	assert.ok(again.overlap.candidates.some((n) => n.sameDraft));
	assert.deepEqual(await promoteHistoricalNote(again), {
		...receipt,
		replayed: true,
	});
	const lookup = await createDoomTools().findActiveLandmarks({
		mapIdentity: f.records[0].reasoningObservation.mapIdentity,
	});
	assert.deepEqual(
		lookup.candidates.map((n) => n.noteId),
		[older.noteId, receipt.noteId],
	);
	assert.equal(lookup.candidates[1].nextQuestion, first.payload.nextQuestion);
	assert.deepEqual(lookup.candidates[1].anchor, {
		x: first.payload.x,
		y: first.payload.y,
		angle: first.payload.angle,
	});
	assert.equal(lookup.candidates[1].hypothesis, first.payload.hypothesis);
	const beforePlay = await readFile(f.database);
	const run = await fixture(t, 1);
	const result = await play(run.client, createDoomTools(), run.provider);
	assert.equal(result.navigationObjective.kind, "landmark");
	assert.equal(
		result.navigationObjective.kind === "landmark" &&
			result.navigationObjective.noteId,
		older.noteId,
	);
	assert.deepEqual(await readFile(f.database), beforePlay);
	await recordMemory({
		operation: "append",
		noteId: receipt.noteId,
		expectedRevision: 1,
		requestId: "retire-test",
		source: "Synthetic retirement only",
		assessment: "Fixture retirement",
		flags: { isLandmark: true, isActiveExploration: false },
	});
	assert.deepEqual(
		await promoteHistoricalNote(
			await prepareHistoricalNotePromotion(f.draft, f.geometry),
		),
		{ ...receipt, replayed: true },
	);
	assert.deepEqual(
		(
			await createDoomTools().findActiveLandmarks({
				mapIdentity: f.records[0].reasoningObservation.mapIdentity,
			})
		).candidates.map((n) => n.noteId),
		[older.noteId],
	);
	// Same content, different original bytes: do not create a second note.
	await writeFile(f.draft, `${await readFile(f.draft, "utf8")}\n`);
	const duplicate = await prepareHistoricalNotePromotion(f.draft, f.geometry);
	assert.equal(duplicate.representedBy, receipt.noteId);
	const writer = t.mock.fn(recordMemory);
	await assert.rejects(promoteHistoricalNote(duplicate, writer), {
		code: "duplicate",
	});
	assert.equal(writer.mock.callCount(), 0);
});

test("writes the same frozen payload once and sanitizes uncertain writer failures", async (t) => {
	const f = await promotionFixture(t);
	const prepared = await prepareHistoricalNotePromotion(f.draft, f.geometry);
	const writer = t.mock.fn(async (payload: unknown) => {
		assert.equal(payload, prepared.payload);
		throw Error("SECRET writer failure after possible commit");
	});
	await assert.rejects(
		promoteHistoricalNote(prepared, writer),
		(error: Error) =>
			!error.message.includes("SECRET") &&
			error.message.includes("write-unconfirmed"),
	);
	assert.equal(writer.mock.callCount(), 1);
});
