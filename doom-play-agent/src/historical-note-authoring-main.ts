import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openaiCredentials } from "@openai-oauth/local";
import {
	authorHistoricalNote,
	HistoricalNoteAuthoringError,
	historicalNoteInputSchema,
} from "./historical-note-authoring.ts";
import { createOAuthProvider } from "./provider.ts";

const usage =
	"Usage: author-note --run-dir /absolute/saved-run --decisions 17,18,19,20,21,22,23 --images 17,20,22 (1–7 text records; 1–3 before images; explicitly invokes paid inference)";

function parseArguments(args: string[]) {
	if (args.length !== 6) throw new Error(usage);
	const values = new Map<string, string>();
	for (let i = 0; i < args.length; i += 2) {
		if (
			!["--run-dir", "--decisions", "--images"].includes(args[i]) ||
			values.has(args[i])
		)
			throw new Error(usage);
		values.set(args[i], args[i + 1]);
	}
	const list = (flag: string) => {
		const value = values.get(flag) ?? "";
		if (!/^[1-9]\d*(,[1-9]\d*)*$/.test(value)) throw new Error(usage);
		return value.split(",").map(Number);
	};
	const parsed = historicalNoteInputSchema.safeParse({
		runDirectory: values.get("--run-dir"),
		decisionOrdinals: list("--decisions"),
		imageOrdinals: list("--images"),
	});
	if (!parsed.success || !isAbsolute(parsed.data.runDirectory))
		throw new Error(usage);
	return parsed.data;
}

export async function main(args = process.argv.slice(2)) {
	const input = parseArguments(args);
	const credentials = openaiCredentials();
	const provider = createOAuthProvider(() => credentials.getSession());
	const result = await authorHistoricalNote(input, { provider });
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
			`${JSON.stringify({ recordedAt, ...result }, null, 2)}\n`,
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
