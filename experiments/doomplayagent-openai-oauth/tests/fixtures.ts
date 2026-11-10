import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { OpenAIProvider } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type {
	AgentObserveResult,
	AgentRunState,
} from "../../../app/src/agent-control.ts";
import { createAgentMapIdentity } from "../../../app/src/agent-observation.ts";
import type {
	AttachedLease,
	MaterializedDecision,
} from "../../../scripts/doom-agent-client.ts";
import type { DoomClient } from "../src/doom-client.ts";
import type { DoomMemoryCandidate, DoomTools } from "../src/doom-tools.ts";

export const scenePerception = {
	description: "A stone corridor is visible ahead.",
	features: ["A doorway is visible at the far end."],
	uncertainty: "The image does not establish what lies beyond the doorway.",
};
export const navigationAssessment = {
	verdict: "possible-match",
	evidence:
		"The visible doorway supports the doorway hypothesis; no specific conflict is described.",
	uncertainty: "A generic doorway does not establish landmark identity.",
};
export async function fixture(t: TestContext) {
	t.mock.method(globalThis, "fetch", async () => {
		throw new Error("External network forbidden");
	});
	const root = await mkdtemp(join(tmpdir(), "doom-play-offline-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const lease: AttachedLease = {
		pageId: randomUUID(),
		epoch: randomUUID(),
		ownerId: randomUUID(),
		configuredDecisionBudget: 1,
		budgetUnclaimedAtAttach: true,
		leaseFile: join(root, "lease.json"),
	};
	// Synthetic header exercises the same PNG admission as the shared protocol.
	// It is not evidence of decoding, native rendering, or live browser behavior.
	const png = Buffer.alloc(33);
	png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
	png.writeUInt32BE(640, 16);
	png.writeUInt32BE(400, 20);
	const base: AgentObserveResult = {
		observationId: randomUUID(),
		sessionId: randomUUID(),
		tic: 43,
		phase: "ready",
		mapIdentity: createAgentMapIdentity("a".repeat(64), 1, 1),
		frame: {
			tic: 43,
			nativeSha256: "c".repeat(64),
			canvasSha256: "c".repeat(64),
		},
		counters: { gametic: 43, leveltime: 43, render: 44, frame: 44 },
		telemetry: {
			health: 100,
			x: 131072,
			y: -196608,
			angle: 0x40000000,
			weaponId: null,
			bullets: null,
			shells: null,
			cells: null,
			rockets: null,
			readyWeapon: null,
			ammo: null,
		},
		facingProbe: null,
		previousAction: null,
		png: `data:image/png;base64,${png.toString("base64")}`,
		pngSha256: createHash("sha256").update(png).digest("hex"),
		revision: 4,
		run: null,
		configuration: {
			instructionTemplate:
				"Base rules: use {{tics}} tics; preserve {{tics}}.\nChoose safely.",
			tics: 6,
			includeReadyWeapon: true,
			includeAmmo: true,
			includeHealth: true,
			includeFacingProbe: true,
			includePreviousAction: true,
		},
	};
	const note: DoomMemoryCandidate = {
		noteId: randomUUID(),
		revision: 2,
		mapNamespace: base.mapIdentity.mapKey,
		status: "unverified",
		isLandmark: true,
		isActiveExploration: true,
		anchor: { x: 262144, y: -196608, angle: 0x40000000 },
		hypothesis: "There may be a doorway nearby.",
		nextQuestion: "Can a clearer view test the doorway hypothesis?",
	};
	const events: string[] = [];
	const state = {
		revision: base.revision,
		configuration: structuredClone(base.configuration),
		run: null as AgentRunState | null,
		perception: scenePerception as unknown,
		assessment: navigationAssessment as unknown,
		assessmentInput: null as unknown,
		candidates: [note],
		memoryObservations: [] as Parameters<DoomTools["findActiveLandmarks"]>[0][],
		modelCalls: 0,
		modelInput: null as unknown,
		instructions: "",
		decisionTemplates: [] as string[],
		observeCalls: 0,
		lastId: base.observationId,
	};
	const correlation = () => ({
		pageId: lease.pageId,
		epoch: lease.epoch,
		commandId: randomUUID(),
	});
	const config = () => ({
		...correlation(),
		sessionId: base.sessionId,
		revision: state.revision,
		configuration: structuredClone(state.configuration),
		run: structuredClone(state.run),
	});
	const prompt = () => {
		const { configuration, ...rest } = config();
		return { ...rest, instructions: configuration.instructionTemplate };
	};
	async function materialize(o: AgentObserveResult) {
		const { png: _png, ...rest } = o;
		const c = correlation();
		const pngPath = join(root, `${c.commandId}.png`);
		await writeFile(pngPath, png);
		return { ...c, ...rest, pngPath };
	}
	const client = {
		async attach() {
			events.push("attach");
			return lease;
		},
		async detach() {
			events.push("detach");
			return { ...lease, commandId: randomUUID(), released: true as const };
		},
		async observe() {
			events.push("observe");
			const o = structuredClone(base);
			o.observationId = state.observeCalls++
				? randomUUID()
				: base.observationId;
			o.revision = state.revision;
			o.configuration = structuredClone(state.configuration);
			o.run = structuredClone(state.run);
			state.lastId = o.observationId;
			return materialize(o);
		},
		async getConfig() {
			events.push("getConfig");
			return config();
		},
		async getPrompt() {
			events.push("getPrompt");
			return prompt();
		},
		async startRun(input) {
			events.push("startRun");
			if (
				input.sessionId !== base.sessionId ||
				input.revision !== state.revision ||
				input.observationId !== state.lastId ||
				state.run
			)
				throw new Error("stale claim");
			state.run = {
				runId: randomUUID(),
				active: true,
				limit: 1,
				reserved: 0,
				sdkInvoked: 0,
				remaining: 1,
			};
			return config();
		},
		async setPrompt(input) {
			events.push("setPrompt");
			if (
				input.sessionId !== base.sessionId ||
				input.revision !== state.revision ||
				input.runId !== state.run?.runId
			)
				throw new Error("stale CAS");
			state.instructions = input.instructions;
			state.configuration = {
				...state.configuration,
				instructionTemplate: state.instructions,
			};
			state.revision++;
			return prompt();
		},
		async setConfig() {
			throw new Error("Config mutation forbidden");
		},
		async decide(input): Promise<MaterializedDecision> {
			events.push("decide");
			if (
				input.observationId !== state.lastId ||
				input.scope.sessionId !== base.sessionId ||
				input.scope.revision !== state.revision ||
				input.scope.runId !== state.run?.runId
			)
				throw new Error("stale decision");
			state.decisionTemplates.push(state.configuration.instructionTemplate);
			state.run = {
				...state.run,
				active: false,
				reserved: 1,
				sdkInvoked: 1,
				remaining: 0,
			};
			const {
				revision: _r,
				configuration: _c,
				run: _run,
				png: _png,
				...after
			} = structuredClone(base);
			after.observationId = randomUUID();
			after.tic += state.configuration.tics;
			after.frame.tic = after.tic;
			after.counters.gametic = after.tic;
			after.counters.leveltime = after.tic;
			const pngPath = join(root, `${input.observationId}.png`);
			await writeFile(pngPath, png);
			return {
				...correlation(),
				commandId: input.observationId,
				pngPath,
				beforeObservationId: input.observationId,
				outcome: "completed",
				reason: null,
				sdkInvoked: true,
				action: "forward",
				requestedTics: 6,
				reportedTics: 6,
				verifiedTics: 6,
				cumulativeTics: after.tic,
				completionUncertain: false,
				requestIdentity: {
					provider: "OpenRouter",
					requestedModel: "synthetic",
				},
				responseMetadata: null,
				observation: after,
			};
		},
	} satisfies DoomClient;
	const model: Extract<LanguageModel, { specificationVersion: "v4" }> = {
		specificationVersion: "v4",
		provider: "synthetic",
		modelId: "synthetic",
		supportedUrls: {},
		async doGenerate(input) {
			const assessment = !input.prompt.some(
				(message) =>
					message.role === "user" &&
					message.content.some((part) => part.type === "file"),
			);
			events.push(assessment ? "assessment" : "model");
			state.modelCalls++;
			if (assessment) state.assessmentInput = input;
			else state.modelInput = input;
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							assessment ? state.assessment : state.perception,
						),
					},
				],
				finishReason: { unified: "stop", raw: "stop" },
				usage: {
					inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 0, text: 0, reasoning: 0 },
				},
				warnings: [],
			};
		},
		async doStream() {
			throw new Error("No streaming in fake");
		},
	};
	const provider = { responses: () => model } as unknown as OpenAIProvider;
	const tools: DoomTools = {
		async findActiveLandmarks(observation) {
			events.push("memory");
			state.memoryObservations.push(structuredClone(observation));
			return {
				status: state.candidates.length ? "found" : "empty",
				caution: "Synthetic unverified notes only",
				query: {
					mode: "active-landmarks",
					mapNamespace: base.mapIdentity.mapKey,
					limit: 3,
				},
				candidates: structuredClone(state.candidates),
				hasMore: false,
			};
		},
	};
	return {
		root,
		lease,
		png,
		base,
		note,
		events,
		state,
		client,
		model,
		provider,
		tools,
	};
}
