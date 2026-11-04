import { pathToFileURL } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAIOAuthTransport } from "@openai-oauth/core";
import { openaiCredentials } from "@openai-oauth/local";
import {
	createDoomClient,
	DoomAttachError,
	type DoomAttachErrorCode,
	type DoomClient,
} from "./doom-client.ts";
import { play } from "./doom-play-agent.ts";
import { createDoomTools } from "./doom-tools.ts";

const usage =
	"Usage: main.ts (takes no arguments; no arguments performs passive Doom attach)";
const unconfirmedAttachGuidance =
	"Doom attach unconfirmed; ownership may be held. If the local page is not running, from the repository root run `npm --prefix app run dev:agent`, open `http://127.0.0.1:5174`, and wait for the Doom page to be ready. If a page is already open, check its connection and use Stop Agent to release possible ownership before a fresh operator-initiated attempt. No automatic retry was made.";

const attachGuidance: Record<DoomAttachErrorCode, string> = {
	"no-ready-page":
		"The broker reports that no browser page is ready. From the repository root, start the local Doom page with `npm --prefix app run dev:agent`, open `http://127.0.0.1:5174`, and wait for the page to be ready before a fresh operator-initiated attempt. This response does not indicate whether npm is running.",
	"owner-already-attached":
		"Another client already holds the browser page. Stop or release the existing agent before trying again. This client did not acquire ownership.",
	"multiple-pages":
		"The browser reports a registration conflict. Resolve duplicate Doom pages, reload the intended page, then make a fresh operator-initiated attempt.",
	forbidden:
		"The broker rejected the attach as forbidden. Check the local dev server and browser setup before a fresh operator-initiated attempt.",
	"invalid-request":
		"The broker rejected the attach request as invalid. Check the local dev server and browser setup before a fresh operator-initiated attempt.",
	"lease-revoked":
		"The broker reported that the page lease was revoked during attach. Reload the intended Doom page before a fresh operator-initiated attempt.",
};

function safeAttachError(error: unknown): DoomAttachError {
	if (error instanceof DoomAttachError && error.code !== null)
		return new DoomAttachError(error.code, attachGuidance[error.code]);
	return new DoomAttachError(null, unconfirmedAttachGuidance);
}

const credentials = openaiCredentials();
const transport = createOpenAIOAuthTransport({
	auth: () => credentials.getSession(),
});

const codexProvider = createOpenAI({
	apiKey: "openai-oauth", // Placeholder string required by the SDK constructor
	baseURL: transport.baseURL,
	fetch: transport.fetch,
});

export async function main(
	makeDoomClient: typeof createDoomClient = createDoomClient,
) {
	const args = process.argv.slice(2);
	if (args.length !== 0) throw new Error(usage);

	const doomClient: DoomClient = makeDoomClient();
	const doomTools = createDoomTools();
	let attached = false;
	try {
		try {
			console.log("Attaching to Doom...");
			await doomClient.attach();
		} catch (error) {
			throw safeAttachError(error);
		}
		attached = true;
		console.log("Doom attached successfully.");
		console.log("Starting Doom play...");
		play(doomClient, doomTools, codexProvider);
	} finally {
		if (attached) {
			const detached = await doomClient.detach();
			console.log("Doom lease detached:", { released: detached.released });
		}
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error: unknown) => {
		const args = process.argv.slice(2);
		const safeDoomMessage =
			error instanceof DoomAttachError ||
			(error instanceof Error &&
				[
					"Doom observation unconfirmed. No retry was made.",
					"Doom detach unconfirmed; client is closed. Use Stop Agent in the browser before another attach. No retry was made.",
				].includes(error.message));
		if (error instanceof Error && error.message === usage) console.error(usage);
		else if (args.length === 0 && safeDoomMessage && error instanceof Error)
			console.error(error.message);
		else if (args.length === 0)
			console.error(
				"Doom operation failed; ownership or cleanup may be uncertain. Check the local dev server and browser.",
			);
		else console.error("Experiment failed.");
		process.exitCode = 1;
	});
}
