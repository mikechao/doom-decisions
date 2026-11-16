import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openaiCredentials } from "@openai-oauth/local";
import {
	authorHistoricalNote,
	HistoricalNoteAuthoringError,
	type HistoricalNoteInput,
	historicalNoteInputSchema,
	type SelectionProvenance,
	selectHistoricalNoteEvidence,
} from "./historical-note-authoring.ts";
import { createOAuthProvider } from "./provider.ts";

const usage =
	"Usage: author-note --run-dir /absolute/saved-run [--decisions 17,18,19,20,21,22,23 --images 17,20,22] (omit both lists for automatic selection; otherwise provide both: 1–7 text records, 1–3 before images; explicitly invokes paid inference when evidence is selected)";
const sourceChanged =
	"Historical note source changed between selection and authoring; no artifact saved and no automatic retry was made.";

function parseArguments(args: string[]) {
	if (args.length !== 2 && args.length !== 6) throw new Error(usage);
	const values = new Map<string, string>();
	for (let i = 0; i < args.length; i += 2) {
		if (
			!["--run-dir", "--decisions", "--images"].includes(args[i]) ||
			values.has(args[i])
		)
			throw new Error(usage);
		values.set(args[i], args[i + 1]);
	}
	const runDirectory = values.get("--run-dir");
	if (!runDirectory || !isAbsolute(runDirectory)) throw new Error(usage);
	if (args.length === 2)
		return { selectionMode: "automatic" as const, runDirectory };
	const list = (flag: string) => {
		const value = values.get(flag) ?? "";
		if (!/^[1-9]\d*(,[1-9]\d*)*$/.test(value)) throw new Error(usage);
		return value.split(",").map(Number);
	};
	const parsed = historicalNoteInputSchema.safeParse({
		runDirectory,
		decisionOrdinals: list("--decisions"),
		imageOrdinals: list("--images"),
	});
	if (!parsed.success) throw new Error(usage);
	return { selectionMode: "manual" as const, input: parsed.data };
}

export async function main(args = process.argv.slice(2)) {
	const parsed = parseArguments(args);
	let input: HistoricalNoteInput;
	let selectionProvenance: SelectionProvenance | undefined;
	if (parsed.selectionMode === "automatic") {
		const selection = await selectHistoricalNoteEvidence(parsed.runDirectory);
		if (selection.kind === "no_candidate") {
			console.log(
				`No automatic evidence candidate: ${selection.reason} Choose another run or provide both --decisions and --images. No inference or draft was created.`,
			);
			return;
		}
		input = {
			runDirectory: parsed.runDirectory,
			decisionOrdinals: selection.decisionOrdinals,
			imageOrdinals: selection.imageOrdinals,
		};
		selectionProvenance = selection.provenance;
	} else {
		input = parsed.input;
	}
	const credentials = openaiCredentials();
	const provider = createOAuthProvider(() => credentials.getSession());
	const result = await authorHistoricalNote(input, { provider });
	// Both loaders validate sidecars against their result snapshot. Only associate
	// selector provenance with authoring of the exact same result.json bytes.
	if (
		selectionProvenance &&
		selectionProvenance.resultSha256 !== result.source.resultSha256
	)
		throw new Error(sourceChanged);
	let path: string;
	try {
		const recordedAt = new Date().toISOString();
		const base = fileURLToPath(
			new URL("../.local/note-drafts/", import.meta.url),
		);
		const directory = join(
			base,
			`${recordedAt.replaceAll(":", "-")}_${encodeURIComponent(result.source.packet.runId)}`,
		);
		await mkdir(base, { recursive: true, mode: 0o700 });
		await mkdir(directory, { mode: 0o700 });
		path = join(directory, "draft.json");
		await writeFile(
			path,
			`${JSON.stringify(
				{
					recordedAt,
					...result,
					selectionMode: parsed.selectionMode,
					...(selectionProvenance ? { selectionProvenance } : {}),
				},
				null,
				2,
			)}\n`,
			{ encoding: "utf8", flag: "wx", mode: 0o600 },
		);
	} catch {
		throw new Error(
			"Historical note artifact was not confirmed saved. No automatic inference retry was made.",
		);
	}
	console.log(`Historical note artifact saved: ${path}`);
	return path;
}

export async function runCli(args = process.argv.slice(2)) {
	try {
		await main(args);
	} catch (error) {
		console.error(
			error instanceof HistoricalNoteAuthoringError ||
				(error instanceof Error &&
					[
						usage,
						sourceChanged,
						"Historical note artifact was not confirmed saved. No automatic inference retry was made.",
					].includes(error.message))
				? error.message
				: "Historical note authoring failed. No automatic retry was made.",
		);
		process.exitCode = 1;
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	await runCli();
}
