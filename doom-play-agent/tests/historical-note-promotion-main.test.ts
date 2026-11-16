import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after, mock } from "node:test";
import { fileURLToPath } from "node:url";
import * as memory from "../../app/doom-memory.mjs";
import { promotionFixture } from "./historical-note-promotion-fixtures.ts";

const noNetwork = mock.method(globalThis, "fetch", async () => {
	throw Error("Network forbidden, including import");
});
const writer = mock.fn(async (_input: unknown) => ({
	noteId: "00000000-0000-4000-8000-000000000999",
	revision: 1,
	status: "unverified" as const,
	replayed: false,
}));
const auth = mock.fn(() => {
	throw Error("OAuth forbidden");
});
const registrations = [
	mock.module("../../app/doom-memory.mjs", {
		namedExports: { ...memory, recordMemory: writer },
	}),
	mock.module("@openai-oauth/local", {
		namedExports: { openaiCredentials: auth },
	}),
];
const { main, runCli } = await import(
	"../src/historical-note-promotion-main.ts"
);
after(() => {
	for (const registration of registrations) registration.restore();
	noNetwork.mock.restore();
});

test("imports without writer, authentication or network calls", () => {
	assert.equal(writer.mock.callCount(), 0);
	assert.equal(auth.mock.callCount(), 0);
	assert.equal(noNetwork.mock.callCount(), 0);
});

for (const args of [
	[],
	["--help"],
	["--draft"],
	["--draft", "relative.json"],
	["--unknown", "/unused"],
	["--draft", "/unused", "--yes"],
	["--draft", "/a", "--draft", "/b"],
]) {
	test(`invalid arguments never prompt or write: ${JSON.stringify(args)}`, async (t) => {
		writer.mock.resetCalls();
		const confirm = t.mock.fn(async () => "yes");
		await assert.rejects(
			main(args, { interactive: true, print: () => {}, confirm }),
			/Usage: approve-note/,
		);
		assert.equal(confirm.mock.callCount(), 0);
		assert.equal(writer.mock.callCount(), 0);
	});
}

for (const answer of ["", "n", "no", "not sure"]) {
	test(`default/declined confirmation ${JSON.stringify(answer)} makes no write`, async (t) => {
		const f = await promotionFixture(t);
		writer.mock.resetCalls();
		const printed: string[] = [];
		const confirm = t.mock.fn(async () => answer);
		const before = await readFile(f.database);
		assert.equal(
			await main(["--draft", f.draft], {
				interactive: true,
				print: (line) => printed.push(line),
				confirm,
			}),
			null,
		);
		assert.match(printed[0], /observer pose, not destination/);
		assert.equal(confirm.mock.callCount(), 1);
		assert.equal(writer.mock.callCount(), 0);
		assert.equal(printed.at(-1), "No note written.");
		assert.deepEqual(await readFile(f.database), before);
	});
}

test("noninteractive input never invokes the confirmation seam or writer", async (t) => {
	const f = await promotionFixture(t);
	writer.mock.resetCalls();
	const confirm = t.mock.fn(async () => "yes");
	await main(["--draft", f.draft], {
		interactive: false,
		print: () => {},
		confirm,
	});
	assert.equal(confirm.mock.callCount(), 0);
	assert.equal(writer.mock.callCount(), 0);
});

test("real CLI with piped yes only previews an explicit temporary DB", async (t) => {
	const f = await promotionFixture(t);
	const before = await readFile(f.database);
	const child = spawnSync(
		process.execPath,
		[
			"--experimental-strip-types",
			"src/historical-note-promotion-main.ts",
			"--draft",
			f.draft,
		],
		{
			cwd: fileURLToPath(new URL("../", import.meta.url)),
			env: { ...process.env, DOOM_MEMORY_DB: f.database },
			input: "yes\n",
			encoding: "utf8",
		},
	);
	assert.equal(child.status, 0, child.stderr);
	assert.match(child.stdout, /Historical note promotion preview/);
	assert.match(child.stdout, /No note written/);
	assert.deepEqual(await readFile(f.database), before);
});

test("approval passes exactly the previewed frozen snapshot once, even if the draft changes", async (t) => {
	const f = await promotionFixture(t);
	const anchor = f.artifact.note.observationAnchor;
	const overlap = await memory.recordMemory({
		operation: "create",
		requestId: "overlap-test",
		mapNamespace: anchor.mapKey,
		x: anchor.rawX,
		y: anchor.rawY,
		angle: anchor.rawAngle,
		source: "Synthetic overlap fixture",
		hypothesis: "A possibly related yard observation",
	});
	writer.mock.resetCalls();
	const printed: string[] = [];
	let reviewed: Record<string, unknown> | undefined;
	const receipt = await main(["--draft", f.draft], {
		interactive: true,
		print: (line) => printed.push(line),
		async confirm(question) {
			assert.equal(writer.mock.callCount(), 0);
			assert.match(question, /distinct active landmark\? \[y\/N\]/);
			reviewed = JSON.parse(printed[0].slice(printed[0].indexOf("\n") + 1));
			assert.ok(reviewed);
			assert.equal(reviewed.databasePath, f.database);
			assert.equal(reviewed.selectionMode, "unspecified");
			assert.ok(printed[0].includes(overlap.noteId));
			assert.ok(printed[0].includes("Review before creating a distinct note"));
			await writeFile(f.draft, "changed after the reviewed snapshot");
			return " YeS ";
		},
	});
	assert.equal(writer.mock.callCount(), 1);
	const payload = writer.mock.calls[0].arguments[0];
	assert.ok(reviewed);
	assert.deepEqual(payload, reviewed.payload);
	assert.equal(Object.isFrozen(payload), true);
	assert.equal(receipt?.status, "unverified");
	assert.equal(receipt?.databasePath, f.database);
	assert.match(printed[1], /does not guarantee selection/);
	assert.match(printed.at(-1) ?? "", /Historical note receipt/);
});

test("uncertain overlap is visible before approval; exact represented content does not prompt/write", async (t) => {
	const f = await promotionFixture(t);
	const { prepareHistoricalNotePromotion } = await import(
		"../src/historical-note-promotion.ts"
	);
	const prepared = await prepareHistoricalNotePromotion(f.draft);
	const existing = await memory.recordMemory({
		...prepared.payload,
		requestId: "existing-test",
		source: "Existing synthetic note",
	});
	writer.mock.resetCalls();
	const printed: string[] = [];
	const confirm = t.mock.fn(async () => "yes");
	await main(["--draft", f.draft], {
		interactive: true,
		print: (line) => printed.push(line),
		confirm,
	});
	assert.ok(printed[0].includes(existing.noteId));
	assert.match(
		printed.at(-1) ?? "",
		/already represents this exact anchor\/content/,
	);
	assert.equal(confirm.mock.callCount(), 0);
	assert.equal(writer.mock.callCount(), 0);
});

test("missing evidence and database removal during approval cannot reach writer", async (t) => {
	const f = await promotionFixture(t);
	writer.mock.resetCalls();
	await assert.rejects(
		main(["--draft", f.draft], {
			interactive: true,
			print: () => {},
			async confirm() {
				await rm(f.database);
				return "yes";
			},
		}),
		{ code: "database" },
	);
	assert.equal(writer.mock.callCount(), 0);
	await assert.rejects(readFile(f.database));
	await rm(join(f.root, "decision-22-before.png"));
	const confirm = t.mock.fn(async () => "yes");
	await assert.rejects(
		main(["--draft", f.draft], { interactive: true, print: () => {}, confirm }),
		{ code: "evidence" },
	);
	assert.equal(confirm.mock.callCount(), 0);
	assert.equal(writer.mock.callCount(), 0);
});

test("same-path database replacement during confirmation cannot reach writer", async (t) => {
	const f = await promotionFixture(t);
	const original = await readFile(f.database);
	const backup = join(f.root, "previewed.sqlite");
	writer.mock.resetCalls();
	await assert.rejects(
		main(["--draft", f.draft], {
			interactive: true,
			print: () => {},
			async confirm() {
				await rename(f.database, backup);
				await writeFile(f.database, "");
				return "yes";
			},
		}),
		{ code: "database" },
	);
	assert.equal(writer.mock.callCount(), 0);
	assert.equal((await readFile(f.database)).length, 0);
	assert.deepEqual(await readFile(backup), original);
});

test("runCli reports bounded failure with nonzero exit code", async (t) => {
	const previous = process.exitCode;
	t.after(() => {
		process.exitCode = previous;
	});
	const error = t.mock.method(console, "error", () => {});
	await runCli([]);
	assert.equal(process.exitCode, 1);
	assert.match(
		String(error.mock.calls[0].arguments[0]),
		/^Usage: approve-note/,
	);
	assert.equal(auth.mock.callCount(), 0);
});
