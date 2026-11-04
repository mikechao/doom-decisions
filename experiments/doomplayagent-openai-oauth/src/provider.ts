import { createOpenAI } from "@ai-sdk/openai";
import {
	createOpenAIOAuthTransport,
	type OpenAIOAuthSession,
} from "@openai-oauth/core";

export function createOAuthResponsesModel(
	auth: () => Promise<OpenAIOAuthSession | null | undefined>,
	modelId: string,
) {
	const transport = createOpenAIOAuthTransport({ auth });
	const provider = createOpenAI({
		apiKey: "nonsecret-oauth-transport-placeholder",
		baseURL: transport.baseURL,
		fetch: transport.fetch,
	});
	return provider.responses(modelId);
}
