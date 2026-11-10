import { after, beforeEach, mock } from "node:test";
import * as clientModule from "../src/doom-client.ts";
import * as playbackModule from "../src/doom-play-agent.ts";
import type { createDoomTools } from "../src/doom-tools.ts";
import type { createOAuthProvider } from "../src/provider.ts";

// One registration per process-isolated test file, before importing main.ts.
// Cached main bindings survive restoration; cases must stay serial and reset
// implementations instead of re-registering modules. Real play is the default.
export function installMainMocks() {
	const unconfigured = () => {
		throw new Error("Main test factory was not configured");
	};
	const makeClient =
		mock.fn<typeof clientModule.createDoomClient>(unconfigured);
	const makeTools = mock.fn<typeof createDoomTools>(unconfigured);
	const makeProvider = mock.fn<typeof createOAuthProvider>(unconfigured);
	const playback = mock.fn(playbackModule.play);
	const getSession = mock.fn(async () => {
		throw new Error("Credential access forbidden in offline tests");
	});
	const credentials = mock.fn(() => ({ getSession }));
	const registrations = [
		mock.module("../src/doom-client.ts", {
			namedExports: { ...clientModule, createDoomClient: makeClient },
		}),
		mock.module("../src/doom-tools.ts", {
			namedExports: { createDoomTools: makeTools },
		}),
		mock.module("../src/provider.ts", {
			namedExports: { createOAuthProvider: makeProvider },
		}),
		mock.module("@openai-oauth/local", {
			namedExports: { openaiCredentials: credentials },
		}),
		mock.module("../src/doom-play-agent.ts", {
			namedExports: { ...playbackModule, play: playback },
		}),
	];
	beforeEach(() => {
		makeClient.mock.mockImplementation(unconfigured);
		makeTools.mock.mockImplementation(unconfigured);
		makeProvider.mock.mockImplementation(unconfigured);
		playback.mock.mockImplementation(playbackModule.play);
		for (const fn of [
			makeClient,
			makeTools,
			makeProvider,
			playback,
			credentials,
			getSession,
		])
			fn.mock.resetCalls();
	});
	after(() => {
		for (const registration of registrations) registration.restore();
	});
	return {
		makeClient,
		makeTools,
		makeProvider,
		playback,
		credentials,
		getSession,
	};
}
