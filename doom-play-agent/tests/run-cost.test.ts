import assert from "node:assert/strict";
import test from "node:test";
import { generatedAt, providers } from "@opencode-ai/models/snapshot";
import type { DecisionRecord } from "../src/doom-play-agent-types.ts";
import { estimateRunCost, type PricingSnapshot } from "../src/run-cost.ts";

const pricing = { providers, generatedAt };
const close = (actual: number | null, expected: number) => {
	assert.notEqual(actual, null);
	assert.ok(
		Math.abs(Number(actual) - expected) < 1e-15,
		`${actual} != ${expected}`,
	);
};
function usage(input: number, output: number) {
	return {
		inputTokens: input,
		inputTokenDetails: {
			noCacheTokens: input,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		outputTokens: output,
		outputTokenDetails: { textTokens: output - 2, reasoningTokens: 2 },
		totalTokens: input + output,
	};
}
function record(ordinal = 1): DecisionRecord {
	return {
		ordinal,
		reasoningObservation: null,
		beforePng: null,
		landmarkLookup: null,
		selection: { navigationObjective: { kind: "free-explore" }, target: null },
		perception: {
			description: "Synthetic scene",
			features: [],
			uncertainty: "Unknown",
			modelId: "gpt-6-luna",
			durationMs: 1,
			usage: usage(100, 10),
		},
		navigationAssessment: null,
		guidance: null,
		runStarted: null,
		promptAcknowledged: null,
		admissionObservation: null,
		decision: {
			kind: "returned",
			input: {
				observationId: "before",
				scope: { sessionId: "session", runId: "run", revision: 1 },
			},
			afterPng: null,
			imageRetentionFailure: null,
			receipt: {
				pageId: "page",
				epoch: "epoch",
				commandId: "command",
				pngPath: null,
				beforeObservationId: "before",
				outcome: "completed",
				reason: null,
				sdkInvoked: true,
				action: "neutral",
				requestedTics: 6,
				reportedTics: 6,
				verifiedTics: 6,
				cumulativeTics: 7,
				completionUncertain: false,
				requestIdentity: {
					provider: "OpenRouter",
					requestedModel: "typesafe/jev-1.14",
				},
				responseMetadata: {
					reportedModel: "typesafe/jev-1.14-20261014",
					usage: { input: 100, output: 10, total: null },
				},
				observation: null,
			},
		},
		movement: { status: "unavailable", reason: "decision-not-returned" },
		failure: null,
		recentPoseComparison: {
			status: "unavailable",
			ordinal,
			reason: "decision-not-returned",
		},
	};
}
function onlyPerception() {
	return { ...record(), decision: { kind: "not-called" } } as DecisionRecord;
}
function mutablePricing(): PricingSnapshot {
	return structuredClone(pricing);
}

test("offline snapshot prices 30 C1-shaped calls per task, then aggregates without per-call rounding", (t) => {
	t.mock.method(globalThis, "fetch", () => {
		throw Error("Network forbidden");
	});
	const share = (total: number, i: number) =>
		Math.floor(total / 30) + (i < total % 30 ? 1 : 0);
	const records = Array.from({ length: 30 }, (_, i) => {
		const r = record(i + 1);
		assert.ok(r.perception);
		r.perception.usage = usage(share(21139, i), share(9376, i));
		if (r.decision.kind !== "returned") throw Error("Expected receipt");
		r.decision.receipt.responseMetadata = {
			reportedModel: "typesafe/jev-1.14-20261014",
			usage: { input: share(62386, i), output: share(2112, i), total: null },
		};
		return {
			...r,
			navigationAssessment: {
				verdict: "no-visible-match" as const,
				investigationGuidance: null,
				evidence: "Synthetic",
				uncertainty: "Unknown",
				modelId: "gpt-6-luna",
				durationMs: 1,
				usage: usage(share(14300, i), share(8573, i)),
			},
		};
	});
	const original = JSON.stringify(records);
	const summary = estimateRunCost(records, pricing);
	assert.equal(summary.coverage, "complete");
	assert.equal(summary.coveredSubtotal.isPartial, false);
	assert.equal(summary.source.sdkVersion, "0.0.133");
	assert.equal(summary.source.generatedAt, generatedAt);
	for (const [task, input, output, usd] of [
		["perception", 21139, 9376, 0.0068019],
		["navigationAssessment", 14300, 8573, 0.0057165],
		["decisions", 62386, 2112, 0.002620212],
	] as const) {
		const bucket = summary.tasks[task];
		assert.equal(bucket.calls, 30);
		assert.equal(bucket.pricedCalls, 30);
		assert.equal(bucket.unpricedCalls, 0);
		assert.equal(bucket.inputTokens, input);
		assert.equal(bucket.outputTokens, output);
		close(bucket.estimatedUsd, usd);
	}
	close(summary.estimatedUsd, 0.015138612);
	close(
		summary.coveredSubtotal.estimatedUsd,
		((97825 - 62386) * 0.1) / 1e6 +
			((20061 - 2112) * 0.5) / 1e6 +
			(62386 * 0.042) / 1e6,
	);
	assert.deepEqual(summary.tasks.decisions.models, [
		{
			provider: "OpenRouter",
			providerKey: "openrouter",
			requestedModel: "typesafe/jev-1.14",
			reportedModel: "typesafe/jev-1.14-20261014",
			canonicalModelId: "typesafe/jev-1.14.0",
			rates: { input: 0.042, output: 0 },
			calls: 30,
		},
	]);
	assert.match(summary.assumptions.join(" "), /base input\/output rates/);
	assert.equal(JSON.stringify(records), original);
});

test("inclusive cache and reasoning partitions are counted once; raw and total counters aren't added", () => {
	const r = onlyPerception();
	assert.ok(r.perception);
	r.perception.usage = {
		...usage(100, 20),
		inputTokenDetails: {
			noCacheTokens: 50,
			cacheReadTokens: 30,
			cacheWriteTokens: 20,
		},
		outputTokenDetails: { textTokens: 5, reasoningTokens: 15 },
		totalTokens: 999999,
		raw: { input_tokens: 999999, output_tokens: 999999 },
	};
	const summary = estimateRunCost([r], pricing);
	close(
		summary.estimatedUsd,
		(50 * 0.1 + 30 * 0.01 + 20 * 0.125 + 20 * 0.5) / 1e6,
	);
	assert.deepEqual(summary.tasks.perception.models[0].rates, {
		input: 0.1,
		output: 0.5,
		cache_read: 0.01,
		cache_write: 0.125,
	});
	assert.equal(summary.tasks.navigationAssessment.calls, 0);
	assert.equal(summary.tasks.navigationAssessment.estimatedUsd, null);
});

test("missing/invalid totals and partitions produce unknowns, not zero or a complete known-only total", () => {
	for (const bad of [
		undefined,
		null,
		NaN,
		Infinity,
		-1,
		0.5,
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		const r = onlyPerception();
		assert.ok(r.perception);
		Object.assign(r.perception.usage, { inputTokens: bad });
		const summary = estimateRunCost([r], pricing);
		assert.equal(summary.tasks.perception.inputTokens, null);
		assert.equal(summary.tasks.perception.estimatedUsd, null);
		assert.equal(
			summary.tasks.perception.unknownReasons["missing-or-invalid-usage"],
			1,
		);
		assert.equal(summary.estimatedUsd, null);
		assert.equal(summary.coveredSubtotal.estimatedUsd, null);
	}
	for (const update of [
		{
			inputTokenDetails: {
				noCacheTokens: 100,
				cacheReadTokens: undefined,
				cacheWriteTokens: 0,
			},
		},
		{
			inputTokenDetails: {
				noCacheTokens: 100,
				cacheReadTokens: 1,
				cacheWriteTokens: 0,
			},
		},
		{ outputTokenDetails: { textTokens: 10, reasoningTokens: 2 } },
		{ outputTokenDetails: { textTokens: 0, reasoningTokens: -1 } },
	]) {
		const r = onlyPerception();
		assert.ok(r.perception);
		Object.assign(r.perception.usage, update);
		const summary = estimateRunCost([onlyPerception(), r], pricing);
		assert.equal(summary.coverage, "partial");
		assert.equal(summary.tasks.perception.pricedCalls, 1);
		assert.equal(summary.tasks.perception.unpricedCalls, 1);
		assert.equal(
			summary.tasks.perception.unknownReasons["missing-or-invalid-partitions"],
			1,
		);
		assert.equal(summary.tasks.perception.estimatedUsd, null);
		close(summary.coveredSubtotal.estimatedUsd, 0.000015);
		assert.equal(summary.estimatedUsd, null);
	}
});

test("missing/invalid rates, unknown cache pricing, separate reasoning rates and reached tiers are unknown", () => {
	for (const edit of [
		(cost: Record<string, unknown>) => {
			cost.input = undefined;
		},
		(cost: Record<string, unknown>) => {
			cost.output = NaN;
		},
		(cost: Record<string, unknown>) => {
			cost.input = -1;
		},
		(cost: Record<string, unknown>) => {
			cost.reasoning = 1;
		},
		(cost: Record<string, unknown>) => {
			cost.tiers = [
				{ input: 2, output: 3, tier: { type: "context", size: 100 } },
			];
		},
	]) {
		const p = mutablePricing();
		const cost = p.providers.openai.models["gpt-6-luna"].cost;
		assert.ok(cost);
		edit(cost as unknown as Record<string, unknown>);
		assert.equal(estimateRunCost([onlyPerception()], p).estimatedUsd, null);
	}
	const p = mutablePricing();
	delete p.providers.openai.models["gpt-6-luna"].cost;
	assert.equal(estimateRunCost([onlyPerception()], p).estimatedUsd, null);
	const cached = onlyPerception();
	assert.ok(cached.perception);
	cached.perception.usage.inputTokenDetails = {
		noCacheTokens: 99,
		cacheReadTokens: 1,
		cacheWriteTokens: 0,
	};
	const noCacheRate = mutablePricing();
	assert.ok(noCacheRate.providers.openai.models["gpt-6-luna"].cost);
	delete noCacheRate.providers.openai.models["gpt-6-luna"].cost.cache_read;
	assert.equal(
		estimateRunCost([cached], noCacheRate).tasks.perception.unknownReasons[
			"missing-or-invalid-cache-rate"
		],
		1,
	);
});

test("requested offering is exact and provider-scoped; reported IDs never become aliases", () => {
	const r = record();
	if (r.decision.kind !== "returned") throw Error("Expected receipt");
	const receipt = r.decision.receipt;
	for (const identity of [
		{ provider: "OpenRouter", requestedModel: "typesafe/jev-1.14-20261014" },
		{ provider: "OpenAI", requestedModel: "typesafe/jev-1.14" },
		{ provider: "TypeSafe / Jev", requestedModel: "typesafe/jev-1.14" },
	] as const) {
		receipt.requestIdentity = identity;
		const summary = estimateRunCost([r], pricing);
		assert.equal(summary.tasks.decisions.estimatedUsd, null);
		assert.equal(
			summary.tasks.decisions.models[0].requestedModel,
			identity.requestedModel,
		);
		assert.equal(summary.estimatedUsd, null);
	}
	receipt.requestIdentity = {
		provider: "OpenRouter",
		requestedModel: "typesafe/jev-1.14",
	};
	const p = mutablePricing();
	assert.ok(p.providers.openrouter.models["typesafe/jev-1.14"].cost);
	p.providers.openrouter.models["typesafe/jev-1.14"].cost.cache_read = 0.001;
	assert.equal(
		estimateRunCost([r], p).tasks.decisions.unknownReasons[
			"missing-cache-breakdown"
		],
		1,
	);
	receipt.sdkInvoked = false;
	assert.equal(estimateRunCost([r], pricing).tasks.decisions.calls, 0);
});

test("unavailable/throwing snapshot is nonfatal and retains counts and partial coverage", () => {
	const unavailable = estimateRunCost([record()], null);
	assert.equal(unavailable.coverage, "unknown");
	assert.equal(unavailable.tasks.perception.calls, 1);
	assert.equal(unavailable.tasks.decisions.calls, 1);
	assert.equal(unavailable.tasks.navigationAssessment.calls, 0);
	assert.equal(unavailable.estimatedUsd, null);
	assert.equal(unavailable.source.generatedAt, null);
	const p = mutablePricing();
	Object.defineProperty(p.providers.openai.models, "gpt-6-luna", {
		get() {
			throw Error("SECRET lookup failure");
		},
	});
	const partial = estimateRunCost([record()], p);
	assert.equal(
		partial.tasks.perception.unknownReasons["pricing-lookup-failed"],
		1,
	);
	assert.equal(partial.tasks.decisions.pricedCalls, 1);
	assert.equal(partial.coverage, "partial");
	assert.equal(partial.estimatedUsd, null);
	assert.doesNotMatch(JSON.stringify(partial), /SECRET/);
});

test("base-tier eligibility is per call, and unsupported model/modalities stay unknown", () => {
	const p = mutablePricing();
	const model = p.providers.openai.models["gpt-6-luna"];
	assert.ok(model.cost);
	model.cost.tiers = [
		{ input: 1, output: 2, tier: { type: "context", size: 150 } },
	];
	const summary = estimateRunCost([onlyPerception(), onlyPerception()], p);
	assert.equal(summary.tasks.perception.pricedCalls, 2);
	close(summary.estimatedUsd, 0.00003);
	model.modalities.input = ["text"];
	assert.equal(
		estimateRunCost([onlyPerception()], p).tasks.perception.unknownReasons[
			"unsupported-model-or-modality"
		],
		1,
	);
	model.modalities.input = ["text", "image"];
	model.type = "image";
	assert.equal(estimateRunCost([onlyPerception()], p).estimatedUsd, null);
});

test("explicit zero usage is a priced zero; missing Decisions usage and unconfirmed attempts are unknown", () => {
	const r = onlyPerception();
	assert.ok(r.perception);
	r.perception.usage = {
		...usage(0, 0),
		outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
	};
	const zero = estimateRunCost([r], pricing);
	assert.equal(zero.tasks.perception.pricedCalls, 1);
	assert.equal(zero.estimatedUsd, 0);
	for (const kind of ["returned", "unconfirmed"] as const) {
		const missing = record();
		if (missing.decision.kind !== "returned") throw Error("Expected receipt");
		missing.decision.receipt.responseMetadata = null;
		const decision =
			kind === "returned"
				? missing.decision
				: { kind, input: missing.decision.input };
		const summary = estimateRunCost([{ ...missing, decision }], pricing);
		assert.equal(summary.tasks.decisions.calls, 1);
		assert.equal(summary.tasks.decisions.unpricedCalls, 1);
		assert.equal(summary.tasks.decisions.inputTokens, null);
		assert.equal(summary.tasks.decisions.estimatedUsd, null);
		assert.equal(summary.coverage, "partial");
		assert.equal(summary.estimatedUsd, null);
	}
});
