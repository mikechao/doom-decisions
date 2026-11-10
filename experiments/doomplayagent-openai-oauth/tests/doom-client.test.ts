import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { OpenAIProvider } from "@ai-sdk/openai";
import type { AgentObserveResult } from "../../../app/src/agent-control.ts";
import { createAgentMapIdentity } from "../../../app/src/agent-observation.ts";
import {
	type AgentOperation,
	executeAgentOperation,
} from "../../../scripts/doom-agent-client.ts";
import {
	createDoomClient,
	DoomAttachError,
	type DoomClient,
} from "../src/doom-client.ts";
import { installMainMocks } from "./main-mocks.ts";

const mocks = installMainMocks();
function configureOfflineMain(factory: () => DoomClient) {
	mocks.makeClient.mock.mockImplementation(factory);
	mocks.makeTools.mock.mockImplementation(() => ({
		async findActiveLandmarks() {
			throw Error("Memory access forbidden");
		},
	}));
	mocks.makeProvider.mock.mockImplementation(() => ({}) as OpenAIProvider);
	mocks.playback.mock.mockImplementation(offlinePlayback);
}

type Operation = AgentOperation["op"];
type Fault =
	| "rejected"
	| "transport"
	| "transport-code"
	| "lost"
	| "malformed"
	| "invalid";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("imports and synchronous factory are inert and expose a frozen client", async (t) => {
	const network = t.mock.method(globalThis, "fetch", async () => {
		throw new Error("Real network access is forbidden");
	});
	const originalArgv = process.argv;
	process.argv = [process.execPath, "/inert-import.ts"];
	t.after(() => {
		process.argv = originalArgv;
	});

	const { main } = await import("../src/main.ts");
	const temporaryRoot = await mkdtemp(join(tmpdir(), "doom-client-inert-"));
	t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const client = createDoomClient({ temporaryRoot });

	assert.equal(
		typeof (client as unknown as { then?: unknown }).then,
		"undefined",
		"factory returns synchronously",
	);
	assert.equal(Object.isFrozen(client), true);
	assert.deepEqual(Object.keys(client).sort(), [
		"attach",
		"decide",
		"detach",
		"getConfig",
		"getPrompt",
		"observe",
		"setConfig",
		"setPrompt",
		"startRun",
	]);
	assert.equal(typeof createDoomClient, "function");
	assert.equal(typeof main, "function");
	assert.deepEqual(await readdir(temporaryRoot), []);
	for (const arg of ["--unknown", "--attach-doom"]) {
		process.argv = [process.execPath, "/inert-import.ts", arg];
		await assert.rejects(main(), /Usage:/);
	}
	process.argv = [process.execPath, "/inert-import.ts"];
	assert.equal(mocks.makeClient.mock.callCount(), 0);
	assert.equal(network.mock.callCount(), 0);
});

async function broker(
	t: TestContext,
	options: {
		faults?: Partial<Record<Operation, Fault>>;
		blocked?: Operation;
		attachRejection?: string;
		attachMetadata?: Record<string, unknown>;
		mutateResponse?: (op: Operation, body: Record<string, unknown>) => void;
	} = {},
) {
	t.mock.method(globalThis, "fetch", async () => {
		throw new Error("Only the injected fake transport may be used");
	});
	const temporaryRoot = await mkdtemp(join(tmpdir(), "doom-client-test-"));
	t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const pageId = randomUUID(),
		epoch = randomUUID();
	const calls: Operation[] = [];
	const commands: Array<{ op: Operation; command: Record<string, unknown> }> =
		[];
	const pendingStarted = deferred();
	const pendingRelease = deferred();
	let ownerId: string | undefined;

	// Minimal synthetic 640x400 IHDR for the executor's header and hash checks.
	// This tests parser/hash/materialization boundaries, not PNG decoding.
	const png = Buffer.alloc(33);
	png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
	png.writeUInt32BE(640, 16);
	png.writeUInt32BE(400, 20);
	const observation: AgentObserveResult = {
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
			x: 0,
			y: 0,
			angle: 0,
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
		revision: 0,
		run: null,
		configuration: {
			instructionTemplate: "Synthetic {{tics}}.",
			tics: 6,
			includeReadyWeapon: false,
			includeAmmo: false,
			includeHealth: false,
			includeFacingProbe: false,
			includePreviousAction: false,
		},
	};
	const configuration = {
		instructionTemplate: "Synthetic {{tics}}.",
		tics: 6,
		includeReadyWeapon: false,
		includeAmmo: false,
		includeHealth: false,
		includeFacingProbe: false,
		includePreviousAction: false,
	};
	const sessionId = observation.sessionId;
	const baseRun = {
		runId: randomUUID(),
		active: true,
		limit: 3,
		reserved: 0,
		sdkInvoked: 0,
		remaining: 3,
	};
	const decisionObservation = (() => {
		const {
			revision: _revision,
			configuration: _configuration,
			run: _run,
			...base
		} = observation;
		return {
			...base,
			observationId: randomUUID(),
			tic: 44,
			frame: { ...base.frame, tic: 44 },
			counters: { ...base.counters, gametic: 44, leveltime: 44 },
		};
	})();
	const transport: typeof fetch = async (url, init) => {
		const op = String(url).split("/").at(-1);
		assert.ok(
			[
				"attach",
				"observe",
				"detach",
				"get-config",
				"get-prompt",
				"start-run",
				"set-config",
				"set-prompt",
				"decide",
			].includes(String(op)),
		);
		const operation = op as Operation;
		assert.equal(String(url), `http://127.0.0.1:5174/__doom_agent/${op}`);
		assert.equal(init?.method, "POST");
		const command = JSON.parse(String(init?.body));
		calls.push(operation);
		commands.push({ op: operation, command });
		const fault = options.faults?.[operation];
		if (operation === "attach") {
			assert.deepEqual(Object.keys(command), ["ownerId"]);
			if (fault === "transport") throw new Error("SECRET_TRANSPORT_SENTINEL");
			if (fault === "transport-code") throw new Error("no-ready-page");
			if (options.attachRejection)
				return Response.json(
					{ error: options.attachRejection },
					{ status: 409 },
				);
			if (fault === "rejected")
				return Response.json({ error: "lease-revoked" }, { status: 409 });
			ownerId = command.ownerId;
		} else {
			const expectedFields = {
				observe: ["commandId", "epoch", "ownerId", "pageId"],
				detach: ["commandId", "epoch", "ownerId", "pageId"],
				"get-config": ["commandId", "epoch", "ownerId", "pageId", "sessionId"],
				"get-prompt": ["commandId", "epoch", "ownerId", "pageId", "sessionId"],
				"start-run": [
					"commandId",
					"epoch",
					"observationId",
					"ownerId",
					"pageId",
					"revision",
					"sessionId",
				],
				"set-config": [
					"commandId",
					"configuration",
					"epoch",
					"ownerId",
					"pageId",
					"revision",
					"runId",
					"sessionId",
				],
				"set-prompt": [
					"commandId",
					"epoch",
					"instructions",
					"ownerId",
					"pageId",
					"revision",
					"runId",
					"sessionId",
				],
				decide: [
					"commandId",
					"epoch",
					"observationId",
					"ownerId",
					"pageId",
					"revision",
					"runId",
					"sessionId",
				],
				attach: [],
			} satisfies Record<Operation, string[]>;
			assert.deepEqual(Object.keys(command).sort(), expectedFields[operation]);
			assert.ok(typeof command.commandId === "string");
			assert.equal(command.ownerId, ownerId);
			assert.equal(command.pageId, pageId);
			assert.equal(command.epoch, epoch);
		}
		if (operation === options.blocked) {
			pendingStarted.resolve();
			await pendingRelease.promise;
		}
		if (fault === "transport") throw new Error("SECRET_TRANSPORT_SENTINEL");
		if (fault === "transport-code") throw new Error("no-ready-page");
		if (fault === "lost") throw new Error("SECRET_LOST_RESPONSE_SENTINEL");
		if (fault === "rejected")
			return Response.json({ error: "lease-revoked" }, { status: 409 });
		if (fault === "malformed")
			return new Response("{broken json", { status: 200 });
		if (operation === "attach")
			return Response.json({
				pageId,
				epoch,
				ownerId: fault === "invalid" ? randomUUID() : ownerId,
				configuredDecisionBudget: 2,
				budgetUnclaimedAtAttach: true,
				...options.attachMetadata,
			});
		if (operation === "detach")
			return Response.json({ ...command, released: fault !== "invalid" });
		const correlation = {
			pageId,
			epoch,
			commandId: fault === "invalid" ? randomUUID() : command.commandId,
		};
		if (operation === "observe")
			return Response.json({ ...correlation, observation });
		if (operation === "get-config")
			return Response.json({
				...correlation,
				config: {
					sessionId: command.sessionId,
					revision: 4,
					configuration,
					run: null,
				},
			});
		if (operation === "get-prompt")
			return Response.json({
				...correlation,
				prompt: {
					sessionId: command.sessionId,
					revision: 4,
					instructions: "Synthetic instructions.",
					run: null,
				},
			});
		if (operation === "start-run")
			return Response.json({
				...correlation,
				config: {
					sessionId: command.sessionId,
					revision: command.revision,
					configuration,
					run: baseRun,
				},
			});
		if (operation === "set-config")
			return Response.json({
				...correlation,
				config: {
					sessionId: command.sessionId,
					revision: Number(command.revision) + 1,
					configuration: command.configuration,
					run: { ...baseRun, runId: command.runId },
				},
			});
		if (operation === "set-prompt")
			return Response.json({
				...correlation,
				prompt: {
					sessionId: command.sessionId,
					revision: Number(command.revision) + 1,
					instructions: command.instructions,
					run: { ...baseRun, runId: command.runId },
				},
			});
		return Response.json({
			...correlation,
			decision: {
				outcome: "completed",
				reason: null,
				beforeObservationId: command.observationId,
				sdkInvoked: true,
				action: "turn_left",
				requestedTics: 6,
				reportedTics: 6,
				verifiedTics: 6,
				cumulativeTics: 44,
				completionUncertain: false,
				requestIdentity: {
					provider: "OpenRouter",
					requestedModel: "openai/gpt-6-luna-decisions",
				},
				responseMetadata: {
					reportedModel: null,
					usage: { input: null, output: null, total: null },
				},
				observation: decisionObservation,
			},
		});
	};
	return {
		create: (root = temporaryRoot) =>
			createDoomClient({
				transport: options.mutateResponse
					? async (url, init) => {
							const response = await transport(url, init);
							const body = (await response.json()) as Record<string, unknown>;
							options.mutateResponse?.(
								String(url).split("/").at(-1) as Operation,
								body,
							);
							return Response.json(body, { status: response.status });
						}
					: transport,
				temporaryRoot: root,
			}),
		temporaryRoot,
		transport,
		calls,
		commands,
		observation,
		sessionId,
		runId: baseRun.runId,
		configuration,
		png,
		pendingStarted: pendingStarted.promise,
		releasePending: () => pendingRelease.resolve(),
	};
}

for (const instructions of [
	" \tExplore for {{tics}} tics.\r\n  Preserve spacing.\t \n",
	"  尋找出口 — café 🛡️ {{tics}}.\n",
	"界".repeat(16000),
]) {
	test(`string and file prompt sources converge exactly, length ${instructions.length}`, async (t) => {
		const fake = await broker(t);
		const client = fake.create();
		const lease = await client.attach();
		const scope = {
			leaseFile: lease.leaseFile,
			sessionId: fake.sessionId,
			runId: fake.runId,
			revision: 7,
		};
		const instructionsFile = join(fake.temporaryRoot, "instructions.txt");
		await writeFile(instructionsFile, instructions);
		const fromFile = await executeAgentOperation(
			{ op: "set-prompt", ...scope, instructionsFile },
			{
				transport: async (url, init) => {
					const response = await fake.transport(url, init);
					// Acknowledgment must use the submitted snapshot, not a reread.
					await writeFile(instructionsFile, "Changed after submission.");
					return response;
				},
			},
		);
		const fromString = await client.setPrompt({ ...scope, instructions });
		const { commandId: fileId, ...fileCommand } = fake.commands[1].command;
		const { commandId: stringId, ...stringCommand } = fake.commands[2].command;
		assert.notEqual(fileId, stringId);
		assert.deepEqual(stringCommand, fileCommand);
		assert.equal(JSON.stringify(stringCommand), JSON.stringify(fileCommand));
		assert.equal(stringCommand.instructions, instructions);
		assert.equal(fromFile.instructions, instructions);
		assert.equal(fromString.instructions, instructions);
		assert.equal(fromString.revision, scope.revision + 1);
		assert.equal(fromString.run?.runId, scope.runId);
		assert.deepEqual(fake.calls, ["attach", "set-prompt", "set-prompt"]);
	});
}

test("invalid prompt sources and file constraints reject before transport", async (t) => {
	const fake = await broker(t);
	const lease = await fake.create().attach();
	const scope = {
		leaseFile: lease.leaseFile,
		sessionId: fake.sessionId,
		runId: fake.runId,
		revision: 0,
	};
	const instructionsFile = join(fake.temporaryRoot, "instructions.txt");
	await writeFile(instructionsFile, "Explore {{tics}}.");
	for (const source of [
		{},
		{ instructions: "Explore", instructionsFile },
		{ instructions: "Explore", instructionsFile: undefined },
		{ instructions: undefined, instructionsFile },
		{ instructions: undefined },
		{ instructions: null },
		{ instructions: 123 },
		{ instructions: "" },
		{ instructions: " \t\r\n" },
		{ instructions: "x".repeat(16001) },
		{ instructionsFile: undefined },
		{ instructionsFile: 123 },
		{ instructionsFile: "relative.txt" },
		{ instructionsFile: `file://${instructionsFile}` },
		{ instructionsFile: join(fake.temporaryRoot, ".env") },
		{ instructionsFile: join(fake.temporaryRoot, ".env.agent.local") },
	]) {
		await assert.rejects(
			executeAgentOperation(
				{ op: "set-prompt", ...scope, ...source } as Extract<
					AgentOperation,
					{ op: "set-prompt" }
				>,
				{ transport: fake.transport },
			),
			/Invalid (command|settings file)\./,
		);
	}
	await assert.rejects(
		executeAgentOperation(
			{
				op: "set-prompt",
				...scope,
				instructionsFile: join(fake.temporaryRoot, "missing.txt"),
			},
			{ transport: fake.transport },
		),
		{ code: "ENOENT" },
	);
	for (const [length, error] of [
		[64000, /Invalid command\./],
		[64001, /Invalid settings file\./],
	] as const) {
		await writeFile(instructionsFile, "x".repeat(length));
		await assert.rejects(
			executeAgentOperation(
				{ op: "set-prompt", ...scope, instructionsFile },
				{ transport: fake.transport },
			),
			error,
		);
	}
	assert.deepEqual(fake.calls, ["attach"]);
});

test("unattached observe and detach fail without dispatch", async (t) => {
	const fake = await broker(t);
	const client = fake.create();
	await assert.rejects(client.observe(), /not attached/);
	await assert.rejects(client.detach(), /not attached/);
	const sessionId = fake.sessionId;
	const unavailable = [
		() => client.getConfig(sessionId),
		() => client.getPrompt(sessionId),
		() =>
			client.startRun({
				observationId: fake.observation.observationId,
				sessionId,
				revision: 0,
			}),
		() =>
			client.setConfig({
				sessionId,
				runId: fake.runId,
				revision: 0,
				configFile: "/missing/config.json",
			}),
		() =>
			client.setPrompt({
				sessionId,
				runId: fake.runId,
				revision: 0,
				instructions: "Explore {{tics}}.",
			}),
		() =>
			client.decide({
				observationId: fake.observation.observationId,
				scope: { sessionId, runId: fake.runId, revision: 0 },
			}),
	];
	for (const call of unavailable) await assert.rejects(call(), /not attached/);
	assert.deepEqual(fake.calls, []);
});

test("all typed operations use the held lease and return parsed results", async (t) => {
	const fake = await broker(t);
	const client: DoomClient = fake.create();
	const sessionId = fake.sessionId;
	const runId = fake.runId;
	const configFile = join(fake.temporaryRoot, "settings.json");
	await writeFile(configFile, JSON.stringify(fake.configuration));

	const lease = await client.attach();
	const config = await client.getConfig(sessionId);
	assert.equal(config.sessionId, sessionId);
	assert.equal(config.revision, 4);
	assert.deepEqual(config.configuration, fake.configuration);
	assert.equal(config.run, null);

	const prompt = await client.getPrompt(sessionId);
	assert.equal(prompt.sessionId, sessionId);
	assert.equal(prompt.revision, 4);
	assert.equal(prompt.instructions, "Synthetic instructions.");
	assert.equal(prompt.run, null);

	const observationId = fake.observation.observationId;
	const started = await client.startRun({
		observationId,
		sessionId,
		revision: 7,
	});
	assert.equal(started.sessionId, sessionId);
	assert.equal(started.revision, 7);
	assert.deepEqual(started.run, {
		runId,
		active: true,
		limit: 3,
		reserved: 0,
		sdkInvoked: 0,
		remaining: 3,
	});

	const configured = await client.setConfig({
		sessionId,
		runId,
		revision: 7,
		configFile,
	});
	assert.equal(configured.revision, 8);
	assert.deepEqual(configured.configuration, fake.configuration);
	assert.equal(configured.run?.runId, runId);

	const prompted = await client.setPrompt({
		sessionId,
		runId,
		revision: 8,
		instructions: "Use the nearest doorway.",
	});
	assert.equal(prompted.revision, 9);
	assert.equal(prompted.instructions, "Use the nearest doorway.");
	assert.equal(prompted.run?.runId, runId);

	const decisionId = randomUUID();
	const decision = await client.decide({
		observationId: decisionId,
		scope: { sessionId, runId, revision: 9 },
	});
	assert.deepEqual(
		{
			outcome: decision.outcome,
			reason: decision.reason,
			beforeObservationId: decision.beforeObservationId,
			sdkInvoked: decision.sdkInvoked,
			action: decision.action,
			requestedTics: decision.requestedTics,
			reportedTics: decision.reportedTics,
			verifiedTics: decision.verifiedTics,
			cumulativeTics: decision.cumulativeTics,
			completionUncertain: decision.completionUncertain,
			requestIdentity: decision.requestIdentity,
			responseMetadata: decision.responseMetadata,
		},
		{
			outcome: "completed",
			reason: null,
			beforeObservationId: decisionId,
			sdkInvoked: true,
			action: "turn_left",
			requestedTics: 6,
			reportedTics: 6,
			verifiedTics: 6,
			cumulativeTics: 44,
			completionUncertain: false,
			requestIdentity: {
				provider: "OpenRouter",
				requestedModel: "openai/gpt-6-luna-decisions",
			},
			responseMetadata: {
				reportedModel: null,
				usage: { input: null, output: null, total: null },
			},
		},
	);
	assert.equal(decision.observation?.tic, 44);
	assert.ok(decision.pngPath);
	assert.deepEqual(await readFile(decision.pngPath), fake.png);

	const requests = fake.commands.filter(({ op }) => op !== "attach");
	assert.deepEqual(
		requests.map(({ op }) => op),
		[
			"get-config",
			"get-prompt",
			"start-run",
			"set-config",
			"set-prompt",
			"decide",
		],
	);
	for (const { command } of requests) {
		assert.equal(command.pageId, lease.pageId);
		assert.equal(command.ownerId, lease.ownerId);
		assert.equal(command.epoch, lease.epoch);
		assert.equal(Object.hasOwn(command, "leaseFile"), false);
	}
	assert.equal(requests[0].command.sessionId, sessionId);
	assert.equal(requests[1].command.sessionId, sessionId);
	assert.deepEqual(
		{
			observationId: requests[2].command.observationId,
			sessionId: requests[2].command.sessionId,
			revision: requests[2].command.revision,
		},
		{ observationId, sessionId, revision: 7 },
	);
	assert.deepEqual(
		requests[3].command.configuration,
		fake.configuration,
		"the shared executor reads the supplied config file",
	);
	assert.equal(
		requests[4].command.instructions,
		"Use the nearest doorway.",
		"the shared executor preserves the supplied instructions string",
	);
	assert.deepEqual(
		{
			observationId: requests[5].command.observationId,
			sessionId: requests[5].command.sessionId,
			runId: requests[5].command.runId,
			revision: requests[5].command.revision,
		},
		{ observationId: decisionId, sessionId, runId, revision: 9 },
	);
	assert.equal((await client.detach()).released, true);
	const countAfterDetach = fake.calls.length;
	const closed = [
		() => client.getConfig(sessionId),
		() => client.getPrompt(sessionId),
		() => client.startRun({ observationId, sessionId, revision: 0 }),
		() => client.setConfig({ sessionId, runId, revision: 0, configFile }),
		() =>
			client.setPrompt({
				sessionId,
				runId,
				revision: 0,
				instructions: "Explore {{tics}}.",
			}),
		() =>
			client.decide({
				observationId,
				scope: { sessionId, runId, revision: 0 },
			}),
	];
	for (const call of closed) await assert.rejects(call(), /closed/);
	assert.equal(
		fake.calls.length,
		countAfterDetach,
		"closed calls do not dispatch",
	);
});

test("attach, observe, and detach use the acknowledged lease and materialize the PNG", async (t) => {
	const fake = await broker(t);
	const client: DoomClient = fake.create();
	const lease = await client.attach();
	assert.deepEqual(fake.calls, ["attach"]);
	assert.ok(lease.leaseFile);
	assert.equal(lease.configuredDecisionBudget, 2);
	assert.equal(lease.budgetUnclaimedAtAttach, true);
	assert.deepEqual(JSON.parse(await readFile(lease.leaseFile, "utf8")), {
		pageId: lease.pageId,
		ownerId: lease.ownerId,
		epoch: lease.epoch,
	});

	const observed = await client.observe();
	const { png: _png, ...metadata } = fake.observation;
	assert.deepEqual(
		{
			...metadata,
			pageId: observed.pageId,
			epoch: observed.epoch,
			commandId: observed.commandId,
			pngPath: observed.pngPath,
		},
		observed,
	);
	assert.deepEqual(await readFile(observed.pngPath), fake.png);

	const detached = await client.detach();
	assert.equal(detached.released, true);
	assert.equal(detached.pageId, observed.pageId);
	assert.equal(detached.epoch, observed.epoch);
	await assert.rejects(client.observe(), /closed/);
	await assert.rejects(client.detach(), /closed/);
	assert.deepEqual(fake.calls, ["attach", "observe", "detach"]);
});

test("attach returns budget metadata as information without adding request authority", async (t) => {
	const fake = await broker(t, {
		attachMetadata: {
			configuredDecisionBudget: 2,
			budgetUnclaimedAtAttach: false,
		},
	});
	const client = fake.create();
	const lease = await client.attach();
	assert.equal(lease.configuredDecisionBudget, 2);
	assert.equal(lease.budgetUnclaimedAtAttach, false);
	assert.deepEqual(fake.commands[0], {
		op: "attach",
		command: { ownerId: lease.ownerId },
	});
});

for (const [label, attachMetadata] of [
	["missing configured allowance", { configuredDecisionBudget: undefined }],
	["missing unclaimed snapshot", { budgetUnclaimedAtAttach: undefined }],
	["string configured allowance", { configuredDecisionBudget: "1" }],
	["zero configured allowance", { configuredDecisionBudget: 0 }],
	["non-boolean availability", { budgetUnclaimedAtAttach: "true" }],
	[
		"unclaimed without a configured allowance",
		{ configuredDecisionBudget: null, budgetUnclaimedAtAttach: true },
	],
] as const) {
	test(`attach fails closed for ${label} metadata without claiming success`, async (t) => {
		const fake = await broker(t, { attachMetadata });
		const client = fake.create();
		await assert.rejects(client.attach(), {
			message:
				"Doom attach unconfirmed; ownership may be held. Use Stop Agent in the browser before another attach. No retry was made.",
		});
		await assert.rejects(client.detach(), /ownership may be held/);
		assert.deepEqual(fake.calls, ["attach"]);
	});
}

for (const fault of [
	"transport",
	"transport-code",
	"lost",
	"malformed",
	"invalid",
] as const) {
	test(`${fault} attach is uncertain, surfaced safely, and never retried`, async (t) => {
		const fake = await broker(t, { faults: { attach: fault } });
		const client = fake.create();
		const expected = {
			message:
				"Doom attach unconfirmed; ownership may be held. Use Stop Agent in the browser before another attach. No retry was made.",
		};
		await assert.rejects(client.attach(), expected);
		await assert.rejects(client.attach(), expected);
		await assert.rejects(client.observe(), expected);
		await assert.rejects(client.detach(), expected);
		assert.deepEqual(fake.calls, ["attach"]);
		assert.doesNotMatch(expected.message, /SECRET_|no-ready-page/);
	});
}

for (const fault of ["rejected", "lost", "malformed", "invalid"] as const) {
	test(`${fault} detach is unconfirmed, closes the client, and is never retried`, async (t) => {
		const fake = await broker(t, { faults: { detach: fault } });
		const client = fake.create();
		await client.attach();
		const expected = {
			message:
				"Doom detach unconfirmed; client is closed. Use Stop Agent in the browser before another attach. No retry was made.",
		};
		await assert.rejects(client.detach(), expected);
		await assert.rejects(client.detach(), expected);
		await assert.rejects(client.observe(), expected);
		await assert.rejects(client.attach(), expected);
		assert.deepEqual(fake.calls, ["attach", "detach"]);
	});

	test(`${fault} observation is surfaced once and still permits explicit detach`, async (t) => {
		const fake = await broker(t, { faults: { observe: fault } });
		const client = fake.create();
		await client.attach();
		await assert.rejects(client.observe(), {
			message: "Doom observation unconfirmed. No retry was made.",
		});
		assert.equal((await client.detach()).released, true);
		assert.deepEqual(fake.calls, ["attach", "observe", "detach"]);
	});
}

for (const code of [
	"no-ready-page",
	"owner-already-attached",
	"multiple-pages",
	"forbidden",
	"invalid-request",
	"lease-revoked",
] as const) {
	test(`attach preserves the exact whitelisted broker rejection ${code}`, async (t) => {
		const fake = await broker(t, { attachRejection: code });
		const client = fake.create();
		await assert.rejects(client.attach(), (error: unknown) => {
			assert.ok(error instanceof DoomAttachError);
			assert.equal(error.code, code);
			assert.equal(error.message, `Doom attach rejected by broker (${code}).`);
			return true;
		});
		await assert.rejects(client.attach(), /ownership may be held/);
		await assert.rejects(client.observe(), /ownership may be held/);
		await assert.rejects(client.detach(), /ownership may be held/);
		assert.deepEqual(fake.calls, ["attach"]);
	});
}

test("a non-whitelisted broker response remains unconfirmed", async (t) => {
	const fake = await broker(t, { attachRejection: "no-ready-page-extra" });
	const client = fake.create();
	await assert.rejects(client.attach(), (error: unknown) => {
		assert.ok(error instanceof DoomAttachError);
		assert.equal(error.code, null);
		assert.match(error.message, /attach unconfirmed; ownership may be held/);
		assert.doesNotMatch(error.message, /no-ready-page-extra/);
		return true;
	});
	assert.deepEqual(fake.calls, ["attach"]);
});

test("an attach acknowledgment followed by local lease-file failure stays unconfirmed", async (t) => {
	const fake = await broker(t);
	const client = fake.create(join(fake.temporaryRoot, "missing-parent"));
	await assert.rejects(client.attach(), /ownership may be held/);
	await assert.rejects(client.attach(), /ownership may be held/);
	await assert.rejects(client.observe(), /ownership may be held/);
	await assert.rejects(client.detach(), /ownership may be held/);
	assert.deepEqual(fake.calls, ["attach"]);
});

test("overlapping attach and observation operations do not dispatch", async (t) => {
	const attachFake = await broker(t, { blocked: "attach" });
	const attaching = attachFake.create();
	const attachment = attaching.attach();
	await attachFake.pendingStarted;
	await assert.rejects(attaching.attach(), /busy/);
	await assert.rejects(attaching.observe(), /busy/);
	await assert.rejects(attaching.detach(), /busy/);
	assert.deepEqual(attachFake.calls, ["attach"]);
	attachFake.releasePending();
	await attachment;
	await assert.rejects(attaching.attach(), /already attached/);
	assert.deepEqual(attachFake.calls, ["attach"]);

	const observeFake = await broker(t, { blocked: "observe" });
	const observing = observeFake.create();
	await observing.attach();
	const observation = observing.observe();
	await observeFake.pendingStarted;
	await assert.rejects(observing.observe(), /busy/);
	await assert.rejects(observing.detach(), /busy/);
	await assert.rejects(observing.attach(), /busy/);
	assert.deepEqual(observeFake.calls, ["attach", "observe"]);
	observeFake.releasePending();
	await observation;
	assert.equal((await observing.detach()).released, true);
	assert.deepEqual(observeFake.calls, ["attach", "observe", "detach"]);
});

test("overlapping typed operations are rejected without a second dispatch", async (t) => {
	const fake = await broker(t, { blocked: "get-config" });
	const client = fake.create();
	await client.attach();
	const request = client.getConfig(fake.sessionId);
	await fake.pendingStarted;
	await assert.rejects(client.getPrompt(fake.sessionId), /busy/);
	await assert.rejects(
		client.startRun({
			observationId: fake.observation.observationId,
			sessionId: fake.sessionId,
			revision: 0,
		}),
		/busy/,
	);
	await assert.rejects(client.detach(), /busy/);
	assert.deepEqual(fake.calls, ["attach", "get-config"]);
	fake.releasePending();
	assert.equal((await request).sessionId, fake.sessionId);
	assert.equal((await client.detach()).released, true);
	assert.deepEqual(fake.calls, ["attach", "get-config", "detach"]);
});

test("uncertain mutation is safely surfaced once and explicit detach remains available", async (t) => {
	const fake = await broker(t, { faults: { "set-prompt": "lost" } });
	const client = fake.create();
	await client.attach();
	await assert.rejects(
		client.setPrompt({
			sessionId: fake.sessionId,
			runId: fake.runId,
			revision: 0,
			instructions: "Try the western corridor.",
		}),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.equal(
				error.message,
				"Doom setPrompt unconfirmed; outcome may be unknown. No retry was made.",
			);
			assert.doesNotMatch(
				error.message,
				/SECRET_|stack|response body|Try the western corridor/,
			);
			return true;
		},
	);
	assert.deepEqual(fake.calls, ["attach", "set-prompt"]);
	assert.equal((await client.detach()).released, true);
	assert.deepEqual(fake.calls, ["attach", "set-prompt", "detach"]);
});

test("overlapping detach and calls after detach do not dispatch", async (t) => {
	const fake = await broker(t, { blocked: "detach" });
	const client = fake.create();
	await client.attach();
	const detach = client.detach();
	await fake.pendingStarted;
	await assert.rejects(client.detach(), /busy/);
	await assert.rejects(client.observe(), /busy/);
	await assert.rejects(client.attach(), /busy/);
	assert.deepEqual(fake.calls, ["attach", "detach"]);
	fake.releasePending();
	await detach;
	await assert.rejects(client.observe(), /closed/);
	await assert.rejects(client.detach(), /closed/);
	await assert.rejects(client.attach(), /closed/);
	assert.deepEqual(fake.calls, ["attach", "detach"]);
});

test("main awaits offline playback and then detaches", async (t) => {
	const { main } = await import("../src/main.ts");
	const fake = await broker(t);
	configureOfflineMain(() => fake.create());
	const messages: string[] = [];
	t.mock.method(console, "log", (message?: unknown) =>
		messages.push(String(message)),
	);
	await main();
	assert.deepEqual(fake.calls, ["attach", "observe", "detach"]);
	assert.ok(messages.includes("Doom bounded-run result:"));
});

// Legacy transport tests mock playback so they never invoke real memory/model.
const offlinePlayback: typeof import("../src/doom-play-agent.ts").play = async (
	client,
) => {
	const observed = await client.observe();
	return {
		decisionOrdinal: 1,
		records: [
			{
				ordinal: 1,
				reasoningObservation: observed,
				beforePng: null,
				landmarkLookup: null,
				selection: null,
				perception: null,
				navigationAssessment: null,
				guidance: null,
				runStarted: null,
				promptAcknowledged: null,
				admissionObservation: null,
				decision: { kind: "not-called" },
				failure: null,
			},
		],
		memoryStatus: "empty",
		navigationObjective: { kind: "free-explore" },
		candidateCount: 0,
		navigationAssessment: null,
		perception: {
			description: "synthetic",
			features: [],
			uncertainty: "synthetic",
			// This injected lifecycle-only playback bypasses inference entirely.
			usage: {
				inputTokens: 0,
				inputTokenDetails: {
					noCacheTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
				outputTokens: 0,
				outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
				totalTokens: 0,
			},
		},
		promptChanged: false,
		runId: randomUUID(),
		outcome: "not-admitted",
		reason: null,
		action: null,
		sdkInvoked: false,
		completionUncertain: false,
		cumulativeTics: null,
		tics: { requested: null, reported: null, verified: null },
	};
};

test("main rejects --oauth-smoke, obsolete, and unknown args inertly", async () => {
	const { main } = await import("../src/main.ts");

	const originalArgv = process.argv;
	try {
		for (const arg of ["--oauth-smoke", "--attach-doom", "--unknown"]) {
			process.argv = [process.execPath, "/main-args-test.ts", arg];
			await assert.rejects(main(), /Usage:/);
		}
	} finally {
		process.argv = originalArgv;
	}
	assert.equal(mocks.makeClient.mock.callCount(), 0);
});

for (const [code, guidance] of [
	["no-ready-page", "npm --prefix app run dev:agent"],
	["owner-already-attached", "This client did not acquire ownership."],
	["multiple-pages", "reload the intended page"],
	["forbidden", "rejected the attach as forbidden"],
	["invalid-request", "rejected the attach request as invalid"],
	["lease-revoked", "page lease was revoked"],
] as const) {
	test(`main gives bounded operator guidance for ${code}`, async (t) => {
		const { main } = await import("../src/main.ts");
		const fake = await broker(t, { attachRejection: code });
		configureOfflineMain(() => fake.create());
		await assert.rejects(main(), (error: unknown) => {
			assert.ok(error instanceof DoomAttachError);
			assert.equal(error.code, code);
			assert.match(error.message, new RegExp(guidance));
			assert.doesNotMatch(
				error.message,
				/SECRET_|sensitive raw|response body/i,
			);
			return true;
		});
		assert.deepEqual(fake.calls, ["attach"]);
	});
}

test("main keeps ambiguous attach errors unconfirmed and hides raw transport details", async (t) => {
	const { main } = await import("../src/main.ts");
	const fake = await broker(t, { faults: { attach: "transport" } });
	configureOfflineMain(() => fake.create());
	await assert.rejects(main(), (error: unknown) => {
		assert.ok(error instanceof DoomAttachError);
		assert.equal(error.code, null);
		assert.match(error.message, /attach unconfirmed; ownership may be held/);
		assert.match(error.message, /npm --prefix app run dev:agent/);
		assert.match(error.message, /http:\/\/127\.0\.0\.1:5174/);
		assert.match(error.message, /Stop Agent/);
		assert.match(error.message, /No automatic retry/);
		assert.doesNotMatch(error.message, /SECRET_TRANSPORT_SENTINEL/);
		return true;
	});
	assert.deepEqual(fake.calls, ["attach"]);
});

test("main detaches after observation failure and reports release only after acknowledgment", async (t) => {
	const { main } = await import("../src/main.ts");
	const fake = await broker(t, { faults: { observe: "rejected" } });
	configureOfflineMain(() => fake.create());
	const messages: string[] = [];
	t.mock.method(process.stderr, "write", (chunk: unknown) => {
		messages.push(String(chunk));
		return true;
	});
	await assert.rejects(main(), /Doom observation unconfirmed/);
	assert.deepEqual(fake.calls, ["attach", "observe", "detach"]);
	assert.match(messages.join(""), /\[doom\] Lease detached/);
});

test("main does not claim lease release when detach acknowledgment fails", async (t) => {
	const { main } = await import("../src/main.ts");
	const fake = await broker(t, { faults: { detach: "lost" } });
	configureOfflineMain(() => fake.create());
	const messages: string[] = [];
	t.mock.method(console, "log", () => {});
	t.mock.method(process.stderr, "write", (chunk: unknown) => {
		messages.push(String(chunk));
		return true;
	});
	await assert.rejects(main(), /Doom detach unconfirmed/);
	assert.deepEqual(fake.calls, ["attach", "observe", "detach"]);
	assert.doesNotMatch(messages.join(""), /Lease detached/);
	assert.match(messages.join(""), /Detach unconfirmed/);
});

for (const fault of [
	"map-identity",
	"png-hash",
	"prompt-echo",
	"cas-revision",
	"receipt-correlation",
	"receipt-tics",
] as const) {
	test(`DoomClient's shared executor owns ${fault} rejection`, async (t) => {
		const op =
			fault.startsWith("prompt") || fault === "cas-revision"
				? "set-prompt"
				: fault.startsWith("receipt")
					? "decide"
					: "observe";
		const fake = await broker(t, {
			mutateResponse: (operation, body) => {
				if (operation !== op) return;
				if (op === "observe") {
					const observation = body.observation as AgentObserveResult;
					if (fault === "map-identity")
						observation.mapIdentity.mapKey = "wrong";
					else observation.pngSha256 = "0".repeat(64);
				} else if (op === "set-prompt") {
					const prompt = body.prompt as {
						revision: number;
						instructions: string;
					};
					if (fault === "prompt-echo") prompt.instructions = "Wrong echo";
					else prompt.revision++;
				} else {
					const receipt = body.decision as {
						beforeObservationId: string;
						verifiedTics: number;
					};
					if (fault === "receipt-correlation")
						receipt.beforeObservationId = randomUUID();
					else receipt.verifiedTics = 5;
				}
			},
		});
		const client = fake.create();
		await client.attach();
		const scope = { sessionId: fake.sessionId, runId: fake.runId, revision: 0 };
		const request =
			op === "observe"
				? client.observe()
				: op === "set-prompt"
					? client.setPrompt({ ...scope, instructions: "Explore {{tics}}." })
					: client.decide({
							observationId: fake.observation.observationId,
							scope,
						});
		await assert.rejects(request);
		assert.deepEqual(fake.calls, ["attach", op]);
		await client.detach();
	});
}
