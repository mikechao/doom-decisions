import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { play } from "../src/doom-play-agent.ts";
import { fixture } from "./fixtures.ts";

const defaultDirectory = fileURLToPath(
	new URL("../.local/runs/", import.meta.url),
);
let directory: string;
let failure: "mkdir" | "image" | "json" | null = null;
let writes: string[] = [];
// Redirect only persistence operations into each fixture's temporary directory.
// Production has no path override; tests never access historical artifacts.
function redirected(path: string) {
	const suffix = relative(defaultDirectory, path);
	assert.ok(!isAbsolute(suffix) && !suffix.startsWith(".."));
	return join(directory, suffix);
}
const registration = test.mock.module("node:fs/promises", {
	namedExports: {
		...fs,
		mkdir: async (path: string, options: Parameters<typeof fs.mkdir>[1]) => {
			assert.deepEqual(
				options,
				path === defaultDirectory
					? { recursive: true, mode: 0o700 }
					: { mode: 0o700 },
			);
			if (failure === "mkdir") throw Error("SECRET filesystem details");
			return fs.mkdir(redirected(path), options);
		},
		writeFile: async (
			path: string,
			data: string | Buffer,
			options: Parameters<typeof fs.writeFile>[2],
		) => {
			const json = basename(path) === "result.json";
			assert.deepEqual(
				options,
				json
					? { encoding: "utf8", flag: "wx", mode: 0o600 }
					: { flag: "wx", mode: 0o600 },
			);
			writes.push(basename(path));
			if (
				(failure === "image" && writes.length === 2) ||
				(failure === "json" && json)
			)
				throw Error("SECRET filesystem details");
			return fs.writeFile(redirected(path), data, options);
		},
	},
});
after(() => registration.restore());
beforeEach(() => {
	failure = null;
	writes = [];
});
const { persistRun, RunPersistenceError } = await import(
	"../src/run-persistence.ts"
);

test("writes one v2 directory with full non-image evidence and byte-faithful sidecars after temporary images disappear", async (t) => {
	const f = await fixture(t, 3);
	const result = await play(f.client, f.tools, f.provider);
	const original = JSON.stringify(result);
	const expected = JSON.parse(original);
	const originals = result.records.map((record) => ({
		record,
		decision: record.decision,
		beforePng: record.beforePng,
		afterPng:
			record.decision.kind === "returned" ? record.decision.afterPng : null,
	}));
	await fs.rm(f.root, { recursive: true, force: true });
	directory = join(f.root, "runs");
	const path = await persistRun(result);
	const runDirectory = redirected(dirname(path));
	assert.equal(basename(path), "result.json");
	assert.deepEqual(await fs.readdir(directory), [basename(dirname(path))]);
	assert.equal(writes.length, 7);
	assert.equal(writes.at(-1), "result.json");
	const text = await fs.readFile(redirected(path), "utf8");
	assert.ok(text.startsWith('{\n  "schemaVersion": 2,\n'));
	assert.ok(text.endsWith("\n"));
	assert.doesNotMatch(
		text,
		/"type": "Buffer"|"data": \[|data:image\/png;base64/,
	);
	const saved = JSON.parse(text);
	assert.deepEqual(Object.keys(saved), [
		"schemaVersion",
		"recordedAt",
		"result",
	]);
	assert.equal(new Date(saved.recordedAt).toISOString(), saved.recordedAt);
	assert.equal(
		basename(dirname(path)),
		`${saved.recordedAt.replaceAll(":", "-")}_${result.runId}`,
	);
	const names = ["result.json"];
	for (const [index, record] of result.records.entries()) {
		assert.equal(record.decision.kind, "returned");
		if (record.decision.kind !== "returned") throw Error("Expected receipt");
		for (const [role, bytes, digest, ref] of [
			[
				"before",
				record.beforePng,
				record.reasoningObservation?.pngSha256,
				saved.result.records[index].beforePng,
			],
			[
				"after",
				record.decision.afterPng,
				record.decision.receipt.observation?.pngSha256,
				saved.result.records[index].decision.afterPng,
			],
		] as const) {
			const file = `decision-${index + 1}-${role}.png`;
			assert.deepEqual(ref, { file });
			assert.equal(isAbsolute(ref.file), false);
			assert.equal(basename(ref.file), ref.file);
			const retained = await fs.readFile(join(runDirectory, ref.file));
			assert.deepEqual(retained, bytes);
			assert.equal(createHash("sha256").update(retained).digest("hex"), digest);
			names.push(file);
		}
		expected.records[index].beforePng = saved.result.records[index].beforePng;
		expected.records[index].decision.afterPng =
			saved.result.records[index].decision.afterPng;
		assert.equal(record.beforePng?.constructor, Buffer);
		assert.equal(record.decision.afterPng?.constructor, Buffer);
		assert.equal(record, originals[index].record);
		assert.equal(record.decision, originals[index].decision);
		assert.equal(record.beforePng, originals[index].beforePng);
		assert.equal(record.decision.afterPng, originals[index].afterPng);
	}
	assert.deepEqual(await fs.readdir(runDirectory), names.sort());
	assert.deepEqual(saved.result, expected);
	assert.equal(JSON.stringify(result), original);
	if (process.platform !== "win32") {
		for (const entry of [
			directory,
			runDirectory,
			...names.map((n) => join(runDirectory, n)),
		])
			assert.equal((await fs.stat(entry)).mode & 0o077, 0);
	}
});

test("preserves retention failure and unavailable diagnostics without an after-image reference", async (t) => {
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
	const saved = JSON.parse(await fs.readFile(redirected(path), "utf8"));
	const expected = JSON.parse(JSON.stringify(result));
	expected.records[0].beforePng = { file: "decision-1-before.png" };
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
	assert.deepEqual(saved.result, expected);
	assert.deepEqual(await fs.readdir(redirected(dirname(path))), [
		"decision-1-before.png",
		"result.json",
	]);
});

for (const missing of [null, undefined, "absent"] as const) {
	test(`preserves ${String(missing)} image evidence without sidecars`, async (t) => {
		const f = await fixture(t, 1);
		const result = await play(f.client, f.tools, f.provider);
		const source = result.records[0];
		assert.equal(source.decision.kind, "returned");
		if (source.decision.kind !== "returned") throw Error("Expected receipt");
		const record = { ...source, decision: { ...source.decision } };
		if (missing === "absent") {
			Reflect.deleteProperty(record, "beforePng");
			Reflect.deleteProperty(record.decision, "afterPng");
		} else {
			Object.assign(record, { beforePng: missing });
			Object.assign(record.decision, { afterPng: missing });
		}
		result.records[0] = record;
		directory = join(f.root, "runs");
		const path = await persistRun(result);
		const saved = JSON.parse(await fs.readFile(redirected(path), "utf8"));
		assert.deepEqual(saved.result, JSON.parse(JSON.stringify(result)));
		assert.equal(
			Object.hasOwn(saved.result.records[0], "beforePng"),
			missing === null,
		);
		assert.equal(
			Object.hasOwn(saved.result.records[0].decision, "afterPng"),
			missing === null,
		);
		assert.deepEqual(await fs.readdir(redirected(dirname(path))), [
			"result.json",
		]);
	});
}

for (const kind of ["not-called", "unconfirmed"] as const) {
	test(`preserves ${kind} decision evidence without inventing an after-image`, async (t) => {
		const f = await fixture(t, 1);
		const result = await play(f.client, f.tools, f.provider);
		const source = result.records[0];
		if (source.decision.kind !== "returned") throw Error("Expected receipt");
		result.records[0] = {
			...source,
			beforePng: null,
			decision:
				kind === "not-called"
					? { kind }
					: { kind, input: source.decision.input },
		};
		directory = join(f.root, "runs");
		const path = await persistRun(result);
		const saved = JSON.parse(await fs.readFile(redirected(path), "utf8"));
		assert.deepEqual(saved.result, JSON.parse(JSON.stringify(result)));
		assert.deepEqual(await fs.readdir(redirected(dirname(path))), [
			"result.json",
		]);
	});
}

test("same timestamp with distinct run IDs is unique; exclusive creation never overwrites", async (t) => {
	const f = await fixture(t, 1);
	const result = await play(f.client, f.tools, f.provider);
	directory = join(f.root, "runs");
	t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 11) });
	const first = await persistRun(result);
	const originals = await Promise.all(
		writes.map((name) => fs.readFile(join(redirected(dirname(first)), name))),
	);
	const firstNames = [...writes];
	const second = await persistRun({ ...result, runId: randomUUID() });
	assert.notEqual(first, second);
	await assert.rejects(persistRun(result), RunPersistenceError);
	for (const [index, name] of firstNames.entries())
		assert.deepEqual(
			await fs.readFile(join(redirected(dirname(first)), name)),
			originals[index],
		);
	assert.equal((await fs.readdir(directory)).length, 2);
});

test("encodes run IDs and rejects unsafe ordinals without writing an image", async (t) => {
	const f = await fixture(t, 1);
	const result = await play(f.client, f.tools, f.provider);
	directory = join(f.root, "runs");
	const path = await persistRun({ ...result, runId: "../unsafe/name" });
	assert.equal(dirname(dirname(path)), defaultDirectory.replace(/\/$/, ""));
	assert.match(basename(dirname(path)), /_\.\.%2Funsafe%2Fname$/);
	writes = [];
	result.records[0] = { ...result.records[0], ordinal: NaN };
	await assert.rejects(persistRun(result), RunPersistenceError);
	assert.deepEqual(writes, []);
});

for (const stage of ["mkdir", "image", "json", "serialization"] as const) {
	test(`${stage} failure exposes a bounded error and never publishes complete JSON`, async (t) => {
		const f = await fixture(t, 1);
		const result = await play(f.client, f.tools, f.provider);
		directory = join(f.root, "runs");
		if (stage === "serialization") Object.assign(result, { unsupported: 1n });
		else failure = stage;
		await assert.rejects(persistRun(result), (error) => {
			assert.ok(error instanceof RunPersistenceError);
			assert.match(error.message, /Doom run persistence failed/);
			assert.doesNotMatch(error.message, /SECRET|BigInt/);
			assert.equal(error.cause, undefined);
			return true;
		});
		if (stage === "mkdir") assert.deepEqual(writes, []);
		else {
			const entries = await fs.readdir(directory);
			assert.equal(entries.length, 1);
			const files = await fs.readdir(join(directory, entries[0]));
			assert.equal(files.includes("result.json"), false);
			assert.ok(files.includes("decision-1-before.png"));
		}
	});
}
