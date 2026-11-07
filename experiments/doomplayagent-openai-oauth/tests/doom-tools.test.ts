import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
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
				...overrides,
			});
		},
	};
}

test("real lookup converts pose and bounds nearby results by map, radius and limit", async (t) => {
	const f = await memoryFixture(t);
	const expected = [];
	for (const x of [4, 5, 6, 7]) expected.push(await f.seed({ x }));
	await f.seed({ x: 200 });
	await f.seed({ mapNamespace: "another-map", x: 2 });
	const before = await readFile(f.database);
	const result = await f.tools.findNearbyLandmarks(f.base);
	assert.deepEqual(result.query, {
		mode: "nearby",
		mapNamespace: f.base.mapIdentity.mapKey,
		x: 2,
		y: -3,
		headingDeg: 90,
		radius: 128,
		limit: 3,
	});
	assert.equal(Object.isFrozen(result.query), true);
	assert.equal(result.status, "found");
	assert.deepEqual(
		result.candidates.map((note) => note.noteId),
		expected.slice(0, 3).map((note) => note.noteId),
	);
	assert.match(result.caution, /unverified/);
	assert.equal("entries" in result.candidates[0], false);
	assert.deepEqual(await readFile(f.database), before);
});

test("missing storage, unreadable database and successful empty lookup are distinct", async (t) => {
	const f = await memoryFixture(t);
	assert.equal(existsSync(f.database), false);
	assert.equal(
		(await f.tools.findNearbyLandmarks(f.base)).status,
		"unavailable",
	);
	assert.equal(existsSync(f.database), false);

	await writeFile(f.database, "sensitive invalid database contents");
	const failed = await f.tools.findNearbyLandmarks(f.base);
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
	const empty = await f.tools.findNearbyLandmarks(f.base);
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
	await assert.rejects(f.tools.findNearbyLandmarks(f.base));
});

test("ordinary nearby notes are not offered as landmarks", async (t) => {
	const f = await memoryFixture(t);
	await f.seed({ isLandmark: false });
	const result = await f.tools.findNearbyLandmarks(f.base);
	assert.equal(result.status, "empty");
	assert.deepEqual(result.candidates, []);
});
