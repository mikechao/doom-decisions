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
