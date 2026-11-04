import { createOpenAI } from "@ai-sdk/openai";
import {
	createOpenAIOAuthTransport,
	type OpenAIOAuthSession,
} from "@openai-oauth/core";

export function createOAuthProvider(
	auth: () => Promise<OpenAIOAuthSession | null | undefined>,
) {
	const transport = createOpenAIOAuthTransport({ auth });
	return createOpenAI({
		apiKey: "nonsecret-oauth-transport-placeholder",
		baseURL: transport.baseURL,
		fetch: transport.fetch,
	});
}

export function createOAuthResponsesModel(
	auth: () => Promise<OpenAIOAuthSession | null | undefined>,
	modelId: string,
) {
	return createOAuthProvider(auth).responses(modelId);
}
