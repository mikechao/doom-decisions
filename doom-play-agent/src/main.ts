import { pathToFileURL } from "node:url";
import { openaiCredentials } from "@openai-oauth/local";
import { validAgentLimit } from "../../app/src/agent-control.ts";
import {
	type AttachedLease,
	createDoomClient,
	DoomAttachError,
	type DoomAttachErrorCode,
	type DoomClient,
} from "./doom-client.ts";
import { PlaybackError, type PlayResult, play } from "./doom-play-agent.ts";
import { createDoomTools } from "./doom-tools.ts";
import { progress } from "./progress.ts";
import { createOAuthProvider } from "./provider.ts";
import { persistRun, RunPersistenceError } from "./run-persistence.ts";

const usage =
	"Usage: main.ts (takes no arguments; no arguments authorizes the broker-issued bounded Doom run)";
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

function authenticatedProvider() {
	const credentials = openaiCredentials();
	return createOAuthProvider(() => credentials.getSession());
}

export async function main() {
	const args = process.argv.slice(2);
	if (args.length !== 0) throw new Error(usage);

	const doomClient: DoomClient = createDoomClient();
	const doomTools = createDoomTools();
	const provider = authenticatedProvider();
	let attached = false;
	let failed = false;
	let playbackError: unknown;
	let cleanupFailed = false;
	let cleanupError: unknown;
	let result!: PlayResult;
	try {
		let attachedLease: AttachedLease;
		try {
			attachedLease = await doomClient.attach();
		} catch (error) {
			progress.withTag("doom").info("Attach unconfirmed");
			throw safeAttachError(error);
		}
		attached = true;
		if (!validAgentLimit(attachedLease.configuredDecisionBudget))
			throw new Error(
				"Doom bounded-run preflight failed: the broker needs a positive safe-integer decision budget. Set AGENT_DECISION_BUDGET in app/.env.agent.local and fully restart dev:agent.",
			);
		if (attachedLease.budgetUnclaimedAtAttach !== true)
			throw new Error(
				"Doom bounded-run preflight failed: the broker allowance was already claimed or closed at attach. Fully stop and restart dev:agent.",
			);
		result = await play(
			doomClient,
			doomTools,
			provider,
			attachedLease.configuredDecisionBudget,
		);
		const { records: _records, ...summary } = result;
		console.log("Doom bounded-run result:", summary);
	} catch (error) {
		failed = true;
		playbackError = error;
	} finally {
		if (attached) {
			try {
				const detached = await doomClient.detach();
				progress
					.withTag("doom")
					.info(
						detached.released
							? "Lease detached"
							: "Detach acknowledged; lease not released",
					);
			} catch (detachError) {
				progress.withTag("doom").info("Detach unconfirmed; client closed");
				cleanupFailed = true;
				cleanupError = detachError;
			}
		}
	}
	let persistenceError: RunPersistenceError | undefined;
	if (result) {
		let artifactPath: string | undefined;
		try {
			artifactPath = await persistRun(result);
		} catch {
			persistenceError = new RunPersistenceError();
			if (failed || cleanupFailed)
				progress.withTag("persistence").error(persistenceError.message);
		}
		if (artifactPath)
			progress
				.withTag("persistence")
				.info(`Run artifact saved: ${artifactPath}`);
	}
	if (failed && cleanupFailed)
		throw new AggregateError(
			[playbackError, cleanupError],
			"Doom playback and detach both failed.",
		);
	if (failed) throw playbackError;
	if (cleanupFailed) throw cleanupError;
	if (persistenceError) throw persistenceError;
	return result;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error: unknown) => {
		const args = process.argv.slice(2);
		const safeDoomMessage =
			error instanceof DoomAttachError ||
			error instanceof RunPersistenceError ||
			(error instanceof Error &&
				[
					"Doom observation unconfirmed. No retry was made.",
					"Doom detach unconfirmed; client is closed. Use Stop Agent in the browser before another attach. No retry was made.",
				].includes(error.message));
		if (error instanceof AggregateError) {
			console.error(error.message);
			for (const failure of error.errors) {
				if (failure instanceof PlaybackError)
					console.error(failure.message, {
						navigationObjective: failure.navigationObjective,
						perception: failure.perception,
						navigationAssessment: failure.navigationAssessment,
					});
				else
					console.error(
						"Doom operation or cleanup unconfirmed. Use Stop Agent before another attach.",
					);
			}
		} else if (error instanceof PlaybackError)
			console.error(error.message, {
				navigationObjective: error.navigationObjective,
				perception: error.perception,
				navigationAssessment: error.navigationAssessment,
			});
		else if (error instanceof Error && error.message === usage)
			console.error(usage);
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
