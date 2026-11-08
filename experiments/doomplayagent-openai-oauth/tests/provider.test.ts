import assert from "node:assert/strict";
import test from "node:test";

test("Responses model construction does not invoke auth or fetch", async (t) => {
	const fetchStub = t.mock.method(globalThis, "fetch", async () => {
		throw new Error("Fetch must not run during import or construction");
	});
	const authStub = t.mock.fn(async () => {
		throw new Error("Auth must not run during construction");
	});

	// Import after installing the fetch guard so import-time fetches also fail.
	const { createOAuthResponsesModel } = await import("../src/provider.ts");
	const model = createOAuthResponsesModel(authStub, "construction-smoke-test");

	assert.equal(model.specificationVersion, "v4");
	assert.equal(model.provider, "openai.responses");
	assert.equal(authStub.mock.callCount(), 0);
	assert.equal(fetchStub.mock.callCount(), 0);
});

test("offline OAuth transport preserves Responses schema and exact inline image", async (t) => {
	const { createOAuthProvider } = await import("../src/provider.ts");
	const { play } = await import("../src/doom-play-agent.ts");
	const { fixture, scenePerception } = await import("./fixtures.ts");
	const f = await fixture(t);
	const previous = process.env.DOOM_REASONING_MODEL;
	process.env.DOOM_REASONING_MODEL = "synthetic";
	t.after(() => {
		if (previous === undefined) delete process.env.DOOM_REASONING_MODEL;
		else process.env.DOOM_REASONING_MODEL = previous;
	});
	let responseCalls = 0;
	t.mock.method(
		globalThis,
		"fetch",
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname === "registry.npmjs.org")
				return Response.json({ version: "0.144.1" });
			if (url.pathname.endsWith("/models"))
				return Response.json({ models: [] });
			assert.ok(url.pathname.endsWith("/responses"));
			responseCalls++;
			const body = JSON.parse(String(init?.body));
			assert.equal(body.model, "synthetic");
			assert.equal(body.store, false);
			assert.equal(
				body.stream,
				true,
				"OAuth transport normalizes nonstreaming SDK calls to SSE",
			);
			assert.equal(body.text.format.type, "json_schema");
			assert.equal(body.text.format.schema.additionalProperties, false);
			assert.equal(
				body.text.format.schema.properties.description.type,
				"string",
			);
			assert.equal(body.text.format.schema.properties.features.type, "array");
			assert.equal(
				body.text.format.schema.properties.uncertainty.type,
				"string",
			);
			const system = body.input.find(
				(message: { role: string }) => message.role === "system",
			);
			assert.match(system.content, /visible Doom scene/i);
			for (const requestedFeature of [
				"geometry",
				"doors or passages",
				"obstacles",
				"enemies",
				"items",
				"distinctive landmarks",
				"uncertainty",
				"unseen rooms",
				"confirmed reachability",
				"routes",
				"recommend actions",
				"configuration changes",
			])
				assert.ok(system.content.includes(requestedFeature));
			const user = body.input.find(
				(message: { role: string }) => message.role === "user",
			);
			const promptText = user.content.find(
				(part: { type: string }) => part.type === "input_text",
			);
			assert.deepEqual(JSON.parse(promptText.text), {
				state: {
					map: { mapSlot: f.base.mapIdentity.mapSlot },
					tic: f.base.tic,
					phase: f.base.phase,
					telemetry: f.base.telemetry,
					facingProbe: f.base.facingProbe,
					previousAction: null,
				},
			});
			assert.doesNotMatch(
				JSON.stringify({
					instructions: system.content,
					promptText: promptText.text,
				}),
				/There may be a doorway nearby|Can a clearer view|navigationObjective|historicalLandmark/,
			);
			const image = user.content.find(
				(part: { type: string }) => part.type === "input_image",
			);
			assert.equal(
				image.image_url,
				`data:image/png;base64,${f.png.toString("base64")}`,
			);
			const response = {
				id: "resp_synthetic",
				object: "response",
				created_at: 1,
				model: "synthetic",
				status: "completed",
				output: [
					{
						type: "message",
						id: "msg_synthetic",
						role: "assistant",
						status: "completed",
						content: [
							{
								type: "output_text",
								text: JSON.stringify(scenePerception),
								annotations: [],
							},
						],
					},
				],
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			};
			return new Response(
				`data: ${JSON.stringify({ type: "response.completed", response })}\n\ndata: [DONE]\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
	);
	const provider = createOAuthProvider(async () => ({
		accessToken: "synthetic-offline-token",
		accountId: "synthetic-offline-account",
	}));
	const result = await play(f.client, f.tools, provider);
	assert.equal(result.outcome, "completed");
	assert.equal(responseCalls, 1);
	assert.equal(f.events.filter((event) => event === "decide").length, 1);
});
