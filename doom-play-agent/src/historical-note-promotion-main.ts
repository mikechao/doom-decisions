import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
	HistoricalNotePromotionError,
	prepareHistoricalNotePromotion,
	promoteHistoricalNote,
} from "./historical-note-promotion.ts";

const usage =
	"Usage: approve-note --draft /absolute/path/draft.json --geometry /absolute/path/geometry.json (interactive approval required)";
type Terminal = {
	interactive: boolean;
	print: (text: string) => void;
	confirm: (question: string) => Promise<string>;
};
const terminal: Terminal = {
	interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
	print: (text) => console.log(text),
	async confirm(question) {
		const input = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			return await new Promise<string>((resolve) => {
				input.once("close", () => resolve(""));
				input.once("SIGINT", () => resolve(""));
				input.question(question, resolve);
			});
		} finally {
			input.close();
		}
	},
};

export async function main(args = process.argv.slice(2), io = terminal) {
	if (
		args.length !== 4 ||
		args[0] !== "--draft" ||
		!isAbsolute(args[1]) ||
		args[2] !== "--geometry" ||
		!isAbsolute(args[3])
	)
		throw new Error(usage);
	const prepared = await prepareHistoricalNotePromotion(args[1], args[3]);
	io.print(
		`Historical note promotion preview (observer pose, not destination):\n${JSON.stringify(prepared, null, 2)}`,
	);
	io.print(
		"Both proposed flags are true. The note remains unverified. Active eligibility does not guarantee selection.",
	);
	if (prepared.representedBy) {
		io.print(
			`Existing note ${prepared.representedBy} already represents this exact anchor/content; no note written.`,
		);
		return null;
	}
	if (
		!io.interactive ||
		!/^(y|yes)$/i.test(
			(
				await io.confirm("Create this as a distinct active landmark? [y/N] ")
			).trim(),
		)
	) {
		io.print("No note written.");
		return null;
	}
	const receipt = await promoteHistoricalNote(prepared);
	io.print(`Historical note receipt:\n${JSON.stringify(receipt, null, 2)}`);
	if (receipt.replayed)
		io.print(
			"Original request receipt replayed; this does not establish current flags, current revision or reactivation.",
		);
	return receipt;
}

export async function runCli(args = process.argv.slice(2)) {
	try {
		return await main(args);
	} catch (error) {
		console.error(
			error instanceof HistoricalNotePromotionError ||
				(error instanceof Error && error.message === usage)
				? error.message
				: "Historical note promotion was not confirmed; no automatic retry was made.",
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
