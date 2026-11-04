import assert from "node:assert/strict";
import test from "node:test";
import { createDoomTools } from "../src/doom-tools.ts";
import { fixture } from "./fixtures.ts";

test("host lookup preserves world conversion, radius and limit", async (t) => {
	const f = await fixture(t);
	const result = await f.tools.findMemory(f.base);
	assert.deepEqual(f.state.queries, [
		{
			mode: "nearby",
			mapNamespace: f.base.mapIdentity.mapKey,
			x: 2,
			y: -3,
			headingDeg: 90,
			radius: 128,
			limit: 3,
		},
	]);
	assert.equal(Object.isFrozen(f.state.queries[0]), true);
	assert.equal(result.status, "found");
	assert.match(result.caution, /unverified/);
});

test("unavailable, failed and successful empty lookups are distinct and never retried", async (t) => {
	const f = await fixture(t);
	for (const expected of ["unavailable", "lookup_failed", "empty"] as const) {
		let calls = 0;
		const tools = createDoomTools({
			lookupMemory: async () => {
				calls++;
				if (expected === "lookup_failed")
					throw new Error("sensitive storage exception");
				return {
					available: expected !== "unavailable",
					caution: "test",
					candidates: [],
				};
			},
		});
		const result = await tools.findMemory(f.base);
		assert.equal(result.status, expected);
		assert.equal(calls, 1);
		assert.doesNotMatch(JSON.stringify(result), /sensitive/);
	}
});

test("malformed or wrong-map candidates fail validation; non-landmarks are not offered", async (t) => {
	const f = await fixture(t);
	for (const note of [
		{ ...f.note, mapNamespace: "wrong" },
		{ ...f.note, anchor: { x: Infinity, y: 1, headingDeg: 0 } },
	]) {
		const tools = createDoomTools({
			lookupMemory: async () => ({ caution: "test", candidates: [note] }),
		});
		await assert.rejects(tools.findMemory(f.base));
	}
	f.state.candidates = [{ ...f.note, isLandmark: false }];
	assert.equal((await f.tools.findMemory(f.base)).status, "empty");
});
