import type { OpenAIProvider } from "@ai-sdk/openai";
import type { DoomClient } from "./doom-client.ts";
import type { DoomTools } from "./doom-tools.ts";

export async function play(
	doomClient: DoomClient,
	doomTools: DoomTools,
	openAIProvider: OpenAIProvider,
): Promise<void> {}
