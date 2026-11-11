import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { basename, join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { play } from "../src/doom-play-agent.ts";
import { fixture } from "./fixtures.ts";

const defaultDirectory = fileURLToPath(
	new URL("../.local/runs/", import.meta.url),
);
let directory: string;
let filesystemFailure = false;
let writes = 0;
// Redirect only the helper's two filesystem operations. Production has no path
// override, and tests never access the actual artifact directory.
const registration = test.mock.module("node:fs/promises", {
	namedExports: {
		...fs,
		mkdir: async (path: string, options: Parameters<typeof fs.mkdir>[1]) => {
			assert.equal(path, defaultDirectory);
			assert.deepEqual(options, { recursive: true, mode: 0o700 });
			if (filesystemFailure) throw Error("SECRET filesystem details");
			return fs.mkdir(directory, options);
		},
		writeFile: async (
			path: string,
			data: string,
			options: Parameters<typeof fs.writeFile>[2],
		) => {
			assert.equal(path, join(defaultDirectory, basename(path)));
			assert.deepEqual(options, { encoding: "utf8", flag: "wx", mode: 0o600 });
			writes++;
			return fs.writeFile(join(directory, basename(path)), data, options);
		},
	},
});
after(() => registration.restore());
beforeEach(() => {
	filesystemFailure = false;
	writes = 0;
});
const { persistRun, RunPersistenceError } = await import(
	"../src/run-persistence.ts"
);

test("writes one complete result with byte-faithful Buffer JSON after temporary images disappear", async (t) => {
	const f = await fixture(t, 3);
	const result = await play(f.client, f.tools, f.provider);
	await fs.rm(f.root, { recursive: true, force: true });
	directory = join(f.root, "runs");
	const path = await persistRun(result);
	assert.equal(writes, 1);
	assert.deepEqual(await fs.readdir(directory), [basename(path)]);
	const text = await fs.readFile(join(directory, basename(path)), "utf8");
	assert.ok(text.startsWith('{\n  "schemaVersion": 1,\n'));
	assert.ok(text.endsWith("\n"));
	const saved = JSON.parse(text);
	assert.deepEqual(Object.keys(saved), [
		"schemaVersion",
		"recordedAt",
		"result",
	]);
	assert.equal(new Date(saved.recordedAt).toISOString(), saved.recordedAt);
	assert.equal(
		basename(path),
		`${saved.recordedAt.replaceAll(":", "-")}_${result.runId}.json`,
	);
	assert.deepEqual(saved.result, JSON.parse(JSON.stringify(result)));
	assert.equal(saved.result.runId, result.runId);
	assert.deepEqual(
		saved.result.records.map((r: { ordinal: number }) => r.ordinal),
		[1, 2, 3],
	);
	for (const [index, record] of result.records.entries()) {
		const stored = saved.result.records[index];
		assert.equal(record.decision.kind, "returned");
		if (record.decision.kind !== "returned") throw Error("Expected receipt");
		assert.equal(
			stored.decision.receipt.outcome,
			record.decision.receipt.outcome,
		);
		assert.deepEqual(
			stored.admissionObservation.telemetry,
			record.admissionObservation?.telemetry,
		);
		assert.deepEqual(stored.movement, record.movement);
		assert.deepEqual(stored.recentPoseComparison, record.recentPoseComparison);
		assert.equal(stored.beforePng.type, "Buffer");
		assert.deepEqual(Buffer.from(stored.beforePng.data), record.beforePng);
		assert.equal(stored.decision.afterPng.type, "Buffer");
		assert.deepEqual(
			Buffer.from(stored.decision.afterPng.data),
			record.decision.afterPng,
		);
	}
	if (process.platform !== "win32") {
		assert.equal((await fs.stat(directory)).mode & 0o077, 0);
		assert.equal(
			(await fs.stat(join(directory, basename(path)))).mode & 0o077,
			0,
		);
	}
});

test("preserves null image evidence, retention failure and unavailable diagnostics", async (t) => {
	const f = await fixture(t, 1);
	const decide = f.client.decide;
	f.client.decide = async (input) => {
		const receipt = await decide(input);
		assert.ok(receipt.pngPath);
		receipt.outcome = "terminal";
		assert.ok(receipt.observation);
		receipt.observation.phase = "terminal";
		await fs.unlink(receipt.pngPath);
		return receipt;
	};
	const result = await play(f.client, f.tools, f.provider);
	directory = join(f.root, "runs");
	const path = await persistRun(result);
	const saved = JSON.parse(
		await fs.readFile(join(directory, basename(path)), "utf8"),
	);
	assert.equal(saved.result.records[0].decision.afterPng, null);
	assert.equal(
		saved.result.records[0].decision.imageRetentionFailure.reason,
		"read-failed",
	);
	assert.deepEqual(saved.result.records[0].movement, {
		status: "unavailable",
		reason: "not-completed",
	});
	assert.equal(
		saved.result.records[0].recentPoseComparison.status,
		"unavailable",
	);
	assert.deepEqual(saved.result, JSON.parse(JSON.stringify(result)));
});

test("same timestamp with distinct run IDs is unique; exclusive creation never overwrites", async (t) => {
	const f = await fixture(t, 1);
	const result = await play(f.client, f.tools, f.provider);
	directory = join(f.root, "runs");
	t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 11) });
	const first = await persistRun(result);
	const original = await fs.readFile(join(directory, basename(first)), "utf8");
	const second = await persistRun({ ...result, runId: randomUUID() });
	assert.notEqual(first, second);
	await assert.rejects(persistRun(result), RunPersistenceError);
	assert.equal(
		await fs.readFile(join(directory, basename(first)), "utf8"),
		original,
	);
	assert.equal((await fs.readdir(directory)).length, 2);
});

for (const failure of ["filesystem", "serialization"] as const) {
	test(`${failure} failure exposes only a bounded persistence error`, async (t) => {
		const f = await fixture(t, 1);
		const result = await play(f.client, f.tools, f.provider);
		directory = join(f.root, "runs");
		if (failure === "filesystem") filesystemFailure = true;
		else Object.assign(result, { unsupported: 1n });
		await assert.rejects(persistRun(result), (error) => {
			assert.ok(error instanceof RunPersistenceError);
			assert.match(error.message, /Doom run persistence failed/);
			assert.doesNotMatch(error.message, /SECRET|BigInt/);
			assert.equal(error.cause, undefined);
			return true;
		});
		assert.equal(writes, 0);
	});
}
