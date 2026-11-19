import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import test, { after, beforeEach, mock } from "node:test";
import { fileURLToPath } from "node:url";
import type { generateText } from "ai";
import { savedRun } from "./historical-note-fixtures.ts";

const importFetch = mock.method(globalThis, "fetch", async () => {
	throw Error("Network forbidden, including during import");
});
const authoring = await import("../src/historical-note-authoring.ts");
const { createOAuthProvider } = await import("../src/provider.ts");
const getSession = mock.fn(async () => {
	throw Error("Credential access forbidden");
});
const credentials = mock.fn(() => ({ getSession }));
const provider = mock.fn(createOAuthProvider);
let output: unknown;
const generate = mock.fn(async (_input: unknown) => ({
	finishReason: "stop",
	output,
	response: { modelId: "synthetic" },
	usage: {},
}));
const author = mock.fn<typeof authoring.authorHistoricalNote>((input, deps) =>
	authoring.authorHistoricalNote(input, {
		...deps,
		generate: generate as unknown as typeof generateText,
	}),
);
const select = mock.fn(authoring.selectHistoricalNoteEvidence);
const base = fileURLToPath(new URL("../.local/note-drafts/", import.meta.url));
let outputRoot: string;
const writes: string[] = [];
function redirected(path: string) {
	const suffix = relative(base, path);
	assert.ok(!isAbsolute(suffix) && !suffix.startsWith(".."));
	assert.ok(outputRoot);
	return join(outputRoot, suffix);
}
const registrations = [
	mock.module("@openai-oauth/local", {
		namedExports: { openaiCredentials: credentials },
	}),
	mock.module("../src/provider.ts", {
		namedExports: { createOAuthProvider: provider },
	}),
	mock.module("../src/historical-note-authoring.ts", {
		namedExports: {
			...authoring,
			authorHistoricalNote: author,
			selectHistoricalNoteEvidence: select,
		},
	}),
	mock.module("node:fs/promises", {
		namedExports: {
			...fs,
			mkdir: async (path: string, options: Parameters<typeof fs.mkdir>[1]) => {
				assert.deepEqual(
					options,
					path === base ? { recursive: true, mode: 0o700 } : { mode: 0o700 },
				);
				return fs.mkdir(redirected(path), options);
			},
			writeFile: async (
				path: string,
				data: string,
				options: Parameters<typeof fs.writeFile>[2],
			) => {
				assert.deepEqual(options, {
					encoding: "utf8",
					flag: "wx",
					mode: 0o600,
				});
				writes.push(path);
				return fs.writeFile(redirected(path), data, options);
			},
		},
	}),
];
after(() => {
	for (const registration of registrations) registration.restore();
	importFetch.mock.restore();
});
beforeEach(() => {
	for (const fn of [
		getSession,
		credentials,
		provider,
		author,
		generate,
		select,
	])
		fn.mock.resetCalls();
	select.mock.mockImplementation(authoring.selectHistoricalNoteEvidence);
	generate.mock.mockImplementation(async () => ({
		finishReason: "stop",
		output,
		response: { modelId: "synthetic" },
		usage: {},
	}));
	writes.length = 0;
});

test("imports the function and CLI without auth, model, filesystem writes or network", async (t) => {
	const fetch = t.mock.method(globalThis, "fetch", async () => {
		throw Error("Network forbidden");
	});
	await import("../src/historical-note-authoring-main.ts");
	assert.equal(credentials.mock.callCount(), 0);
	assert.equal(provider.mock.callCount(), 0);
	assert.equal(author.mock.callCount(), 0);
	assert.equal(generate.mock.callCount(), 0);
	assert.equal(select.mock.callCount(), 0);
	assert.equal(fetch.mock.callCount(), 0);
	assert.equal(importFetch.mock.callCount(), 0);
	assert.deepEqual(writes, []);
});

for (const args of [
	[],
	["--help"],
	["--run-dir", "/unused", "--decisions", "17"],
	["--run-dir", "/unused", "--images", "17"],
	["--decisions", "17", "--images", "17"],
	["--unknown", "/unused"],
	["--run-dir", "/unused", "--unknown", "17", "--images", "17"],
	["--run-dir", "/unused", "--run-dir", "/unused", "--images", "17"],
	["--run-dir", "relative"],
	["--run-dir"],
	["--run-dir", "/unused", "--decisions", "0", "--images", "0"],
	["--run-dir", "/unused", "--decisions", "17,", "--images", "17"],
	["--run-dir", "/unused", "--decisions", "17,17", "--images", "17"],
	["--run-dir", "relative", "--decisions", "17", "--images", "17"],
	["--run-dir", "/unused", "--decisions", "17", "--images", "18"],
]) {
	test(`invalid CLI arguments fail before credentials: ${JSON.stringify(args)}`, async (t) => {
		const { runCli } = await import("../src/historical-note-authoring-main.ts");
		const previous = process.exitCode;
		t.after(() => {
			process.exitCode = previous;
		});
		const stderr = t.mock.method(console, "error", () => {});
		await runCli(args);
		assert.equal(process.exitCode, 1);
		assert.match(
			String(stderr.mock.calls[0].arguments[0]),
			/^Usage: author-note/,
		);
		assert.equal(credentials.mock.callCount(), 0);
		assert.equal(provider.mock.callCount(), 0);
		assert.equal(author.mock.callCount(), 0);
		assert.equal(generate.mock.callCount(), 0);
		assert.equal(select.mock.callCount(), 0);
		assert.deepEqual(writes, []);
	});
}

for (const decision of ["propose", "no_note"] as const) {
	test(`CLI saves one exclusive unapproved ${decision} artifact`, async (t) => {
		const f = await savedRun(t);
		outputRoot = join(f.root, "drafts");
		output =
			decision === "propose"
				? f.proposal()
				: {
						decision,
						reason: "Insufficient distinguishing detail.",
						note: null,
					};
		t.mock.method(
			Date.prototype,
			"toISOString",
			() => "2026-11-16T20:00:00.000Z",
		);
		const log = t.mock.method(console, "log", () => {});
		const { main } = await import("../src/historical-note-authoring-main.ts");
		const args = [
			"--run-dir",
			f.root,
			"--decisions",
			"23,22,21,20,19,18,17",
			"--images",
			"22,20,17",
		];
		const path = await main(args);
		assert.ok(path);
		assert.equal(writes.length, 1);
		assert.equal(writes[0], path);
		const bytes = await fs.readFile(redirected(path), "utf8");
		const artifact = JSON.parse(bytes);
		assert.equal(artifact.schemaVersion, 1);
		assert.equal(artifact.status, "unapproved");
		assert.equal(artifact.selectionMode, "manual");
		assert.equal(artifact.selectionProvenance, undefined);
		assert.equal(select.mock.callCount(), 0);
		assert.equal(artifact.decision, decision);
		assert.deepEqual(
			artifact.note,
			decision === "propose" ? f.proposal().note : null,
		);
		assert.equal(artifact.recordedAt, "2026-11-16T20:00:00.000Z");
		assert.deepEqual(
			artifact.source.decisionOrdinals,
			f.input.decisionOrdinals,
		);
		assert.deepEqual(artifact.source.imageOrdinals, f.input.imageOrdinals);
		assert.equal(generate.mock.callCount(), 1);
		assert.equal(getSession.mock.callCount(), 0);
		assert.equal(log.mock.callCount(), 1);
		assert.doesNotMatch(
			bytes,
			/EXCLUDED_SECRET|authorization|headers|data:image/,
		);
		assert.equal((await fs.readdir(outputRoot)).length, 1);
		await assert.rejects(main(args), /artifact was not confirmed saved/);
		assert.equal(await fs.readFile(redirected(path), "utf8"), bytes);
		assert.equal(
			generate.mock.callCount(),
			2,
			"second explicit invocation only; no internal retry",
		);
		assert.equal(writes.length, 1, "exclusive directory prevents an overwrite");
		assert.equal(select.mock.callCount(), 0);
	});
}

for (const decision of ["propose", "no_note"] as const) {
	test(`run-dir alone selects evidence and saves an unapproved ${decision} with provenance`, async (t) => {
		const f = await savedRun(t, { distinctFrames: true });
		for (const r of f.records.slice(2, 4)) {
			r.reasoningObservation.facingProbe.kind = 2;
			r.reasoningObservation.facingProbe.distance = 32;
		}
		await f.save();
		const expected = await authoring.selectHistoricalNoteEvidence(f.root);
		assert.equal(expected.kind, "selected");
		if (expected.kind !== "selected")
			throw Error("Expected synthetic selection");
		outputRoot = join(f.root, "drafts");
		output =
			decision === "propose"
				? f.proposal(20)
				: { decision, reason: "Synthetic model abstention.", note: null };
		t.mock.method(console, "log", () => {});
		const { main } = await import("../src/historical-note-authoring-main.ts");
		const path = await main(["--run-dir", f.root]);
		assert.ok(path);
		assert.equal(select.mock.callCount(), 1);
		assert.deepEqual(select.mock.calls[0].arguments, [f.root]);
		assert.equal(author.mock.callCount(), 1);
		assert.deepEqual(author.mock.calls[0].arguments[0], {
			runDirectory: f.root,
			decisionOrdinals: [17, 18, 19, 20, 21, 22, 23],
			imageOrdinals: [17, 20, 23],
		});
		assert.equal(generate.mock.callCount(), 1);
		assert.equal(credentials.mock.callCount(), 1);
		assert.equal(provider.mock.callCount(), 1);
		assert.equal(getSession.mock.callCount(), 0);
		assert.equal(writes.length, 1);
		const bytes = await fs.readFile(redirected(path), "utf8");
		const artifact = JSON.parse(bytes);
		assert.equal(artifact.status, "unapproved");
		assert.equal(artifact.decision, decision);
		assert.equal(artifact.selectionMode, "automatic");
		assert.deepEqual(artifact.selectionProvenance, expected.provenance);
		assert.equal(
			artifact.source.resultSha256,
			artifact.selectionProvenance.resultSha256,
		);
		assert.deepEqual(
			artifact.source.decisionOrdinals,
			expected.decisionOrdinals,
		);
		assert.deepEqual(artifact.source.imageOrdinals, expected.imageOrdinals);
		assert.doesNotMatch(
			bytes,
			/EXCLUDED_SECRET|authorization|headers|data:image/,
		);
	});
}

test("no_candidate is a successful selection outcome without auth, authoring or drafts", async (t) => {
	const f = await savedRun(t);
	outputRoot = join(f.root, "drafts");
	const before = (await fs.readdir(f.root)).sort();
	const previous = process.exitCode;
	process.exitCode = 0;
	t.after(() => {
		process.exitCode = previous;
	});
	const log = t.mock.method(console, "log", () => {});
	const stderr = t.mock.method(console, "error", () => {});
	const { runCli } = await import("../src/historical-note-authoring-main.ts");
	await runCli(["--run-dir", f.root]);
	assert.equal(process.exitCode, 0);
	assert.equal(select.mock.callCount(), 1);
	assert.equal(stderr.mock.callCount(), 0);
	assert.match(String(log.mock.calls[0].arguments[0]), /No sustained 1-to-2/);
	assert.match(
		String(log.mock.calls[0].arguments[0]),
		/--decisions and --images/,
	);
	for (const fn of [credentials, provider, getSession, author, generate])
		assert.equal(fn.mock.callCount(), 0);
	assert.deepEqual(writes, []);
	assert.deepEqual((await fs.readdir(f.root)).sort(), before);
});

for (const corruption of ["unsupported schema", "malformed JSON"]) {
	test(`automatic ${corruption} fails safely before credentials or inference`, async (t) => {
		const f = await savedRun(t);
		if (corruption === "unsupported schema") {
			f.saved.schemaVersion = 2;
			await f.save();
		} else {
			await fs.writeFile(join(f.root, "result.json"), "SECRET invalid JSON");
		}
		const previous = process.exitCode;
		t.after(() => {
			process.exitCode = previous;
		});
		const stderr = t.mock.method(console, "error", () => {});
		const { runCli } = await import("../src/historical-note-authoring-main.ts");
		await runCli(["--run-dir", f.root]);
		assert.equal(process.exitCode, 1);
		assert.match(String(stderr.mock.calls[0].arguments[0]), /saved-run/);
		assert.doesNotMatch(String(stderr.mock.calls[0].arguments[0]), /SECRET/);
		for (const fn of [credentials, provider, getSession, author, generate])
			assert.equal(fn.mock.callCount(), 0);
		assert.deepEqual(writes, []);
	});
}

test("a changed result snapshot cannot be saved with stale selector provenance", async (t) => {
	const f = await savedRun(t, { distinctFrames: true });
	for (const r of f.records.slice(2, 4)) {
		r.reasoningObservation.facingProbe.kind = 2;
		r.reasoningObservation.facingProbe.distance = 32;
	}
	await f.save();
	select.mock.mockImplementation(async (directory) => {
		const selection = await authoring.selectHistoricalNoteEvidence(directory);
		f.saved.result.extraneous = "Changed after selection, before authoring";
		await f.save();
		return selection;
	});
	output = { decision: "no_note", reason: "Synthetic output.", note: null };
	const previous = process.exitCode;
	t.after(() => {
		process.exitCode = previous;
	});
	const stderr = t.mock.method(console, "error", () => {});
	const { runCli } = await import("../src/historical-note-authoring-main.ts");
	await runCli(["--run-dir", f.root]);
	assert.equal(process.exitCode, 1);
	assert.match(String(stderr.mock.calls[0].arguments[0]), /source changed/);
	assert.equal(select.mock.callCount(), 1);
	assert.equal(author.mock.callCount(), 1);
	assert.equal(
		generate.mock.callCount(),
		1,
		"no retry after snapshot mismatch",
	);
	assert.deepEqual(writes, []);
});

test("CLI prints a safe error and writes nothing after a mocked model failure", async (t) => {
	const f = await savedRun(t);
	outputRoot = join(f.root, "drafts");
	generate.mock.mockImplementation(async () => {
		throw Error("SECRET refreshed token and auth response");
	});
	const previous = process.exitCode;
	t.after(() => {
		process.exitCode = previous;
	});
	const stderr = t.mock.method(console, "error", () => {});
	const { runCli } = await import("../src/historical-note-authoring-main.ts");
	await runCli(["--run-dir", f.root, "--decisions", "17", "--images", "17"]);
	assert.equal(process.exitCode, 1);
	const message = String(stderr.mock.calls[0].arguments[0]);
	assert.match(message, /generation/);
	assert.doesNotMatch(message, /SECRET|token|response/);
	assert.equal(generate.mock.callCount(), 1);
	assert.equal(getSession.mock.callCount(), 0);
	assert.deepEqual(writes, []);
});

test("CLI reports a null-question proposal rejected by the SDK as a response error", async (t) => {
	const f = await savedRun(t);
	outputRoot = join(f.root, "drafts");
	const proposal = f.proposal(17);
	generate.mock.mockImplementation(async (options) => {
		const { output: structuredOutput } = options as Parameters<
			typeof generateText
		>[0];
		assert.ok(structuredOutput);
		const finishReason = "stop";
		const response = {
			id: "synthetic-response",
			timestamp: new Date(0),
			modelId: "synthetic",
		};
		const usage = {
			inputTokens: 0,
			inputTokenDetails: {
				noCacheTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
			outputTokens: 0,
			outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
			totalTokens: 0,
		};
		const parsed = await structuredOutput.parseCompleteOutput(
			{
				text: JSON.stringify({
					...proposal,
					note: { ...proposal.note, nextQuestion: null },
				}),
			},
			{ finishReason, response, usage },
		);
		return { finishReason, output: parsed, response, usage };
	});
	const previous = process.exitCode;
	t.after(() => {
		process.exitCode = previous;
	});
	const stderr = t.mock.method(console, "error", () => {});
	const { runCli } = await import("../src/historical-note-authoring-main.ts");
	await runCli(["--run-dir", f.root, "--decisions", "17", "--images", "17"]);
	assert.equal(process.exitCode, 1);
	assert.match(
		String(stderr.mock.calls[0].arguments[0]),
		/failed \(response\)/,
	);
	assert.equal(generate.mock.callCount(), 1);
	assert.equal(getSession.mock.callCount(), 0);
	assert.deepEqual(writes, []);
	await assert.rejects(fs.stat(outputRoot), { code: "ENOENT" });
});
