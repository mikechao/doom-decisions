import type { OpenAIProvider } from "@ai-sdk/openai";
import { generateText, type LanguageModelUsage, Output } from "ai";
import { z } from "zod";
import type { AgentObserveResult } from "../../app/src/agent-control.ts";

const scenePerceptionSchema = z.strictObject({
	description: z.string().trim().min(1).max(300),
	features: z.array(z.string().trim().min(1).max(120)).max(8),
	uncertainty: z.string().trim().min(1).max(300),
});

export type ScenePerception = z.infer<typeof scenePerceptionSchema> & {
	usage: LanguageModelUsage;
	durationMs: number;
};

export type ScenePerceptionState = Pick<
	AgentObserveResult,
	"tic" | "phase" | "telemetry" | "facingProbe"
> & {
	map: Pick<AgentObserveResult["mapIdentity"], "mapSlot">;
	previousAction: Omit<
		NonNullable<AgentObserveResult["previousAction"]>,
		"text"
	> | null;
};

export type ScenePerceptionInput = {
	image: Buffer;
	state: ScenePerceptionState;
};

export async function perceiveScene(
	openAIProvider: OpenAIProvider,
	input: ScenePerceptionInput,
): Promise<ScenePerception> {
	const modelId = process.env.DOOM_REASONING_MODEL ?? "gpt-6-luna";
	const model = openAIProvider.responses(modelId);
	const startedAt = performance.now();
	const result = await generateText({
		model,
		maxRetries: 0,
		abortSignal: AbortSignal.timeout(60_000),
		output: Output.object({ schema: scenePerceptionSchema }),
		providerOptions: {
			openai: {
				store: false,
				reasoningEffort: "xhigh",
			},
		},
		instructions: [
			"Describe only the visible Doom scene using the verified screenshot and compact game state.",
			"Write description as one concise, complete sentence, preferably 200 characters or fewer.",
			"Populate features with up to eight distinct, independently useful details that are clearly visible, such as room geometry, floor or wall appearance, platforms, doors or openings, enemies, pickups, and notable colors or objects. Keep each entry brief and grounded; use an empty array only if no detail is confidently recognizable.",
			'Use uncertainty only for ambiguity in visible evidence, such as unclear object identity or what lies beyond an opening; if none is material, say "None." Do not guess specific objects, unseen geometry, reachability, or routes from one image.',
			"Do not recommend actions, select objectives, or propose control or configuration changes. This is diagnostic scene perception only.",
		].join(" "),
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: JSON.stringify({ state: input.state }),
					},
					{ type: "file", data: input.image, mediaType: "image/png" },
				],
			},
		],
	});
	const durationMs = performance.now() - startedAt;
	if (result.finishReason !== "stop")
		throw new Error("Scene perception did not finish.");
	return {
		...result.output,
		usage: result.usage,
		durationMs,
	};
}
