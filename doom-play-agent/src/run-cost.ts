import type { ModelCost, ProviderMap } from "@opencode-ai/models";
import type { LanguageModelUsage } from "ai";
import type { DecisionRecord } from "./doom-play-agent-types.ts";

export type PricingSnapshot = { providers: ProviderMap; generatedAt: string };
type Task = "perception" | "navigationAssessment" | "decisions";
type Rates = Pick<ModelCost, "input" | "output" | "cache_read" | "cache_write">;
type Identity = {
	provider: string | null;
	providerKey: "openai" | "openrouter" | null;
	requestedModel: string | null;
	reportedModel: string | null;
};
type Invocation = Identity & {
	input: unknown;
	output: unknown;
	reasoningUsage?: LanguageModelUsage;
};
type TaskCost = {
	calls: number;
	pricedCalls: number;
	unpricedCalls: number;
	inputTokens: number | null;
	outputTokens: number | null;
	estimatedUsd: number | null;
	coveredSubtotalUsd: number | null;
	unknownReasons: Record<string, number>;
	models: (Identity & {
		canonicalModelId: string | null;
		rates: Rates | null;
		calls: number;
	})[];
};

// Keep the version aligned with the exact dependency pin. The SDK exposes no hash.
const source = {
	id: "@opencode-ai/models/snapshot",
	sdkVersion: "0.0.133",
	rateUnits: "USD per million tokens",
};
const assumptions = [
	"Public standard API-equivalent pricing, not OAuth charges or a historical invoice; snapshot dates are not price-effective dates.",
	"Text and screenshot input use published token rates; no additional image surcharge is estimated. Standard mode is assumed; experimental/priority charges are not estimated.",
	"Decisions use the exact requested provider offering; reported model IDs are diagnostic, not aliases. Missing cache/reasoning detail uses base input/output rates only when no differentiated rates are published.",
	"Only recorded invocations in records[] are counted; skipped tasks and duplicate final summaries are excluded. Unretained usage cannot reconstruct spend.",
];

export const unavailableCostSummary = {
	kind: "api-equivalent-estimate",
	currency: "USD",
	source: { ...source, generatedAt: null },
	assumptions,
	coverage: "unknown",
	reason: "cost-estimation-unavailable",
	tasks: null,
	coveredSubtotal: { estimatedUsd: null, isPartial: true },
	estimatedUsd: null,
} as const;

const count = (n: unknown): n is number =>
	typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const rate = (n: unknown): n is number =>
	typeof n === "number" && Number.isFinite(n) && n >= 0;
const addTokens = (total: number | null, n: unknown) =>
	total !== null && count(n) && count(total + n) ? total + n : null;

function invocations(record: DecisionRecord): [Task, Invocation][] {
	const calls: [Task, Invocation][] = [];
	for (const task of ["perception", "navigationAssessment"] as const) {
		const result = record[task];
		if (!result) continue;
		calls.push([
			task,
			{
				provider: "OpenAI", // Both reasoning tasks use the OpenAI Responses route.
				providerKey: "openai",
				requestedModel: result.modelId,
				reportedModel: null,
				input: result.usage?.inputTokens,
				output: result.usage?.outputTokens,
				reasoningUsage: result.usage,
			},
		]);
	}
	const decision = record.decision;
	if (decision.kind === "not-called") return calls;
	if (decision.kind === "returned" && !decision.receipt.sdkInvoked)
		return calls;
	const receipt = decision.kind === "returned" ? decision.receipt : null;
	const provider = receipt?.requestIdentity?.provider ?? null;
	calls.push([
		"decisions",
		{
			provider,
			providerKey:
				provider === "OpenRouter"
					? "openrouter"
					: provider === "OpenAI"
						? "openai"
						: null,
			requestedModel: receipt?.requestIdentity?.requestedModel ?? null,
			reportedModel: receipt?.responseMetadata?.reportedModel ?? null,
			input: receipt?.responseMetadata?.usage?.input,
			output: receipt?.responseMetadata?.usage?.output,
		},
	]);
	return calls;
}

function price(task: Task, call: Invocation, pricing: PricingSnapshot | null) {
	const unknown = (reason: string) => ({ usd: null, rates: null, reason });
	if (!count(call.input) || !count(call.output))
		return unknown("missing-or-invalid-usage");
	if (!pricing) return unknown("snapshot-unavailable");
	if (!call.providerKey) return unknown("unsupported-provider");
	if (typeof call.requestedModel !== "string" || !call.requestedModel)
		return unknown("missing-model");
	const provider = pricing.providers[call.providerKey];
	const model = provider?.models[call.requestedModel];
	if (provider?.id !== call.providerKey || model?.id !== call.requestedModel)
		return unknown("offering-not-found");
	const cost = model.cost;
	if (!cost || !rate(cost.input) || !rate(cost.output))
		return unknown("missing-or-invalid-rates");
	if (
		(task === "decisions"
			? model.type !== "decision"
			: model.type && model.type !== "chat") ||
		!model.modalities.input.includes("text") ||
		(task !== "navigationAssessment" &&
			!model.modalities.input.includes("image")) ||
		!model.modalities.output.includes("text")
	)
		return unknown("unsupported-model-or-modality");
	// No tier engine: conservatively require even input + output below every threshold.
	if (
		(cost.context_over_200k && !cost.tiers?.length) ||
		cost.tiers?.some(
			({ tier }) =>
				tier.type !== "context" ||
				!count(tier.size) ||
				tier.size === 0 ||
				Number(call.input) + Number(call.output) >= tier.size,
		)
	)
		return unknown("unsupported-context-tier");
	if (cost.reasoning !== undefined)
		return unknown("unsupported-separate-reasoning-rate");
	let inputCost = call.input * cost.input;
	const rates: Rates = { input: cost.input, output: cost.output };
	if (task === "decisions") {
		if (cost.cache_read !== undefined || cost.cache_write !== undefined)
			return unknown("missing-cache-breakdown");
	} else {
		const u = call.reasoningUsage;
		const read = u?.inputTokenDetails?.cacheReadTokens;
		const write = u?.inputTokenDetails?.cacheWriteTokens;
		const noCache = u?.inputTokenDetails?.noCacheTokens;
		const reasoning = u?.outputTokenDetails?.reasoningTokens;
		const text = u?.outputTokenDetails?.textTokens;
		if (
			!count(read) ||
			!count(write) ||
			read + write > call.input ||
			(noCache !== undefined &&
				(!count(noCache) || noCache + read + write !== call.input)) ||
			(reasoning !== undefined &&
				(!count(reasoning) || reasoning > call.output)) ||
			(text !== undefined &&
				(!count(text) ||
					text > call.output ||
					(reasoning !== undefined && text + reasoning !== call.output)))
		)
			return unknown("missing-or-invalid-partitions");
		if (
			(read > 0 && !rate(cost.cache_read)) ||
			(write > 0 && !rate(cost.cache_write))
		)
			return unknown("missing-or-invalid-cache-rate");
		inputCost = (call.input - read - write) * cost.input;
		if (read > 0) {
			rates.cache_read = cost.cache_read;
			inputCost += read * Number(cost.cache_read);
		}
		if (write > 0) {
			rates.cache_write = cost.cache_write;
			inputCost += write * Number(cost.cache_write);
		}
	}
	// Output already includes reasoning. Never add detail/raw/total counters again.
	const usd = (inputCost + call.output * cost.output) / 1_000_000;
	return rate(usd)
		? {
				usd,
				rates,
				canonicalModelId:
					typeof model.canonical_model_id === "string"
						? model.canonical_model_id
						: null,
				reason: null,
			}
		: unknown("cost-overflow");
}

/** Pure, per-invocation calculation. No snapshot import, I/O or provider clients. */
export function estimateRunCost(
	records: readonly DecisionRecord[],
	pricing: PricingSnapshot | null,
) {
	const empty = (): TaskCost => ({
		calls: 0,
		pricedCalls: 0,
		unpricedCalls: 0,
		inputTokens: 0,
		outputTokens: 0,
		estimatedUsd: null,
		coveredSubtotalUsd: null,
		unknownReasons: {},
		models: [],
	});
	const tasks = {
		perception: empty(),
		navigationAssessment: empty(),
		decisions: empty(),
	};
	let subtotal = 0;
	let priced = 0;
	let unpriced = 0;
	for (const record of records) {
		for (const [task, call] of invocations(record)) {
			const bucket = tasks[task];
			bucket.calls++;
			bucket.inputTokens = addTokens(bucket.inputTokens, call.input);
			bucket.outputTokens = addTokens(bucket.outputTokens, call.output);
			let result: ReturnType<typeof price>;
			try {
				result = price(task, call, pricing);
			} catch {
				result = { usd: null, rates: null, reason: "pricing-lookup-failed" };
			}
			if (
				result.usd !== null &&
				(!rate(subtotal + result.usd) ||
					!rate((bucket.coveredSubtotalUsd ?? 0) + result.usd))
			)
				result = { usd: null, rates: null, reason: "cost-overflow" };
			const {
				input: _input,
				output: _output,
				reasoningUsage: _usage,
				...identity
			} = call;
			const evidence = {
				...identity,
				canonicalModelId:
					"canonicalModelId" in result ? result.canonicalModelId : null,
				rates: result.rates,
			};
			const existing = bucket.models.find(
				({ calls: _calls, ...model }) =>
					JSON.stringify(model) === JSON.stringify(evidence),
			);
			if (existing) existing.calls++;
			else bucket.models.push({ ...evidence, calls: 1 });
			if (result.usd === null) {
				bucket.unpricedCalls++;
				unpriced++;
				const reason = result.reason ?? "pricing-unavailable";
				bucket.unknownReasons[reason] =
					(bucket.unknownReasons[reason] ?? 0) + 1;
			} else {
				bucket.pricedCalls++;
				priced++;
				bucket.coveredSubtotalUsd =
					(bucket.coveredSubtotalUsd ?? 0) + result.usd;
				subtotal += result.usd;
			}
		}
	}
	for (const bucket of Object.values(tasks))
		bucket.estimatedUsd =
			bucket.unpricedCalls === 0 ? bucket.coveredSubtotalUsd : null;
	return {
		kind: "api-equivalent-estimate",
		currency: "USD",
		source: {
			...source,
			generatedAt:
				typeof pricing?.generatedAt === "string" ? pricing.generatedAt : null,
		},
		assumptions,
		coverage: unpriced === 0 ? "complete" : priced > 0 ? "partial" : "unknown",
		tasks,
		coveredSubtotal: {
			estimatedUsd: priced > 0 ? subtotal : null,
			isPartial: unpriced > 0,
		},
		estimatedUsd: unpriced === 0 && priced > 0 ? subtotal : null,
	};
}
