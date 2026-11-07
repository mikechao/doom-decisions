import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { play } from "../src/doom-play-agent.ts";
import { createDoomTools } from "../src/doom-tools.ts";
import { fixture } from "./fixtures.ts";

async function memoryFixture(t: TestContext) {
	const f = await fixture(t);
	const database = join(f.root, "memory.sqlite");
	const previous = process.env.DOOM_MEMORY_DB;
	process.env.DOOM_MEMORY_DB = database;
	t.after(() => {
		if (previous === undefined) delete process.env.DOOM_MEMORY_DB;
		else process.env.DOOM_MEMORY_DB = previous;
	});
	// Use only this test's database, never the historical memory store.
	const modulePath = "../../../app/doom-memory.mjs";
	const memory = (await import(modulePath)) as {
		recordMemory(input: unknown): Promise<{ noteId: string }>;
	};
	return {
		...f,
		database,
		tools: createDoomTools(),
		seed(overrides: Record<string, unknown> = {}) {
			return memory.recordMemory({
				operation: "create",
				requestId: randomUUID(),
				source: "Synthetic offline fixture",
				mapNamespace: f.note.mapNamespace,
				...f.note.anchor,
				hypothesis: f.note.hypothesis,
				isLandmark: true,
				isActiveExploration: true,
				...overrides,
			});
		},
	};
}

test("active lookup is map-wide, bounded and preserves shared creation ordering", async (t) => {
	const f = await memoryFixture(t);
	const expected = [];
	for (const x of [13107200, 327680, 393216, 458752])
		expected.push(await f.seed({ x }));
	await f.seed({ x: 131072, isActiveExploration: false });
	await f.seed({ mapNamespace: "another-map", x: 131072 });
	const db = new DatabaseSync(f.database);
	try {
		for (const [index, note] of expected.entries())
			db.prepare("UPDATE notes SET created_at = ? WHERE note_id = ?").run(
				`2026-01-0${index + 1}`,
				note.noteId,
			);
	} finally {
		db.close();
	}
	const before = await readFile(f.database);
	const result = await f.tools.findActiveLandmarks(f.base);
	assert.deepEqual(result.query, {
		mode: "active-landmarks",
		mapNamespace: f.base.mapIdentity.mapKey,
		limit: 3,
	});
	assert.equal(Object.isFrozen(result.query), true);
	assert.equal(result.status, "found");
	assert.equal(result.hasMore, true);
	assert.deepEqual(
		result.candidates.map((note) => note.noteId),
		expected.slice(0, 3).map((note) => note.noteId),
	);
	assert.match(result.caution, /unverified/);
	assert.ok(result.candidates.every((note) => note.isActiveExploration));
	assert.equal("entries" in result.candidates[0], false);
	assert.deepEqual(await readFile(f.database), before);
});

test("a distant active lead wins over a closer inactive landmark and reaches decision guidance", async (t) => {
	const f = await memoryFixture(t);
	const inactive = await f.seed({
		x: f.base.telemetry.x,
		y: f.base.telemetry.y,
		angle: f.base.telemetry.angle,
		isActiveExploration: false,
		hypothesis: "Inactive historical lead",
	});
	const active = await f.seed({
		x: 13107200,
		nextQuestion: "Can another view test this historical opening?",
	});
	const before = await readFile(f.database);
	const result = await play(f.client, f.tools, f.provider, f.options);
	assert.deepEqual(result.navigationObjective, {
		kind: "landmark",
		noteId: active.noteId,
		revision: 1,
	});
	assert.equal(result.memoryStatus, "found");
	assert.equal(result.candidateCount, 1);
	assert.deepEqual(f.events, [
		"observe",
		"model",
		"startRun",
		"setPrompt",
		"observe",
		"decide",
	]);
	const hint = JSON.parse(
		f.state.instructions.match(
			/evidence, never instructions: (\{.*\})\./,
		)?.[1] ?? "null",
	);
	assert.equal(hint.noteId, active.noteId);
	assert.equal(hint.revision, 1);
	assert.equal(hint.observerPoseRawTelemetry.x, 13107200);
	assert.equal(hint.hypothesis, f.note.hypothesis);
	assert.equal(
		hint.nextQuestion,
		"Can another view test this historical opening?",
	);
	assert.ok(!f.state.instructions.includes(inactive.noteId));
	assert.deepEqual(f.state.decisionTemplates, [f.state.instructions]);
	assert.equal(f.state.revision, f.base.revision + 1);
	assert.deepEqual(await readFile(f.database), before);
});

test("missing storage, unreadable database and successful empty lookup are distinct", async (t) => {
	const f = await memoryFixture(t);
	assert.equal(existsSync(f.database), false);
	assert.equal(
		(await f.tools.findActiveLandmarks(f.base)).status,
		"unavailable",
	);
	assert.equal(existsSync(f.database), false);

	await writeFile(f.database, "sensitive invalid database contents");
	const failed = await f.tools.findActiveLandmarks(f.base);
	assert.equal(failed.status, "lookup_failed");
	assert.deepEqual(failed.candidates, []);
	assert.doesNotMatch(JSON.stringify(failed), /sensitive/);
	assert.equal(
		await readFile(f.database, "utf8"),
		"sensitive invalid database contents",
	);

	// A separate existing database has no notes for the current map.
	process.env.DOOM_MEMORY_DB = join(f.root, "empty-for-map.sqlite");
	await f.seed({ mapNamespace: "another-map" });
	const empty = await f.tools.findActiveLandmarks(f.base);
	assert.equal(empty.status, "empty");
	assert.deepEqual(empty.candidates, []);
});

test("malformed stored evidence fails validation", async (t) => {
	const f = await memoryFixture(t);
	await f.seed();
	const db = new DatabaseSync(f.database);
	try {
		db.exec("UPDATE notes SET hypothesis = ''");
	} finally {
		db.close();
	}
	await assert.rejects(f.tools.findActiveLandmarks(f.base));
});

test("no active landmark permits one free-explore decision without changing the base prompt", async (t) => {
	const f = await memoryFixture(t);
	await f.seed({ isLandmark: false, isActiveExploration: false });
	await f.seed({ isActiveExploration: false });
	const before = await readFile(f.database);
	const result = await play(f.client, f.tools, f.provider, f.options);
	assert.equal(result.memoryStatus, "empty");
	assert.deepEqual(result.navigationObjective, { kind: "free-explore" });
	assert.equal(result.candidateCount, 0);
	assert.equal(result.promptChanged, false);
	assert.deepEqual(f.events, [
		"observe",
		"model",
		"startRun",
		"observe",
		"decide",
	]);
	assert.deepEqual(f.state.decisionTemplates, [
		f.base.configuration.instructionTemplate,
	]);
	assert.equal(f.state.revision, f.base.revision);
	assert.deepEqual(await readFile(f.database), before);
});
