import type { AgentScope } from "../../../app/src/agent-control.ts";
import {
	type AgentClientOptions,
	type AgentOperation,
	type AttachedLease,
	type ConfigResult,
	type DetachedLease,
	executeAgentOperation,
	type MaterializedDecision,
	type MaterializedObserve,
	type PromptResult,
} from "../../../scripts/doom-agent-client.ts";

type StartRunInput = Omit<
	Extract<AgentOperation, { op: "start-run" }>,
	"op" | "leaseFile"
>;
type SetConfigInput = Omit<
	Extract<AgentOperation, { op: "set-config" }>,
	"op" | "leaseFile"
>;
type SetPromptInput = AgentScope & { instructions: string };
type DecideInput = { observationId: string; scope: AgentScope };

export type DoomClient = Readonly<{
	attach(): Promise<AttachedLease>;
	observe(): Promise<MaterializedObserve>;
	getConfig(sessionId: string): Promise<ConfigResult>;
	getPrompt(sessionId: string): Promise<PromptResult>;
	startRun(input: StartRunInput): Promise<ConfigResult>;
	setConfig(input: SetConfigInput): Promise<ConfigResult>;
	setPrompt(input: SetPromptInput): Promise<PromptResult>;
	decide(input: DecideInput): Promise<MaterializedDecision>;
	detach(): Promise<DetachedLease>;
}>;

export type DoomAttachErrorCode =
	| "forbidden"
	| "invalid-request"
	| "no-ready-page"
	| "multiple-pages"
	| "owner-already-attached"
	| "lease-revoked";

const attachErrorCodes = new Set<DoomAttachErrorCode>([
	"forbidden",
	"invalid-request",
	"no-ready-page",
	"multiple-pages",
	"owner-already-attached",
	"lease-revoked",
]);

const recovery =
	"Use Stop Agent in the browser before another attach. No retry was made.";
const unconfirmedAttach = `Doom attach unconfirmed; ownership may be held. ${recovery}`;

export class DoomAttachError extends Error {
	readonly code: DoomAttachErrorCode | null;

	constructor(code: DoomAttachErrorCode | null, message?: string) {
		super(
			message ??
				(code
					? `Doom attach rejected by broker (${code}).`
					: unconfirmedAttach),
		);
		this.name = "DoomAttachError";
		this.code = code;
	}
}

function knownBrokerCode(value: unknown): DoomAttachErrorCode | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const code = (value as { error?: unknown }).error;
	return typeof code === "string" &&
		attachErrorCodes.has(code as DoomAttachErrorCode)
		? (code as DoomAttachErrorCode)
		: undefined;
}

type State =
	| "new"
	| "attaching"
	| "ready"
	| "observing"
	| "operating"
	| "detaching"
	| "attach-failed"
	| "detached"
	| "detach-failed";

export function createDoomClient(options: AgentClientOptions = {}): DoomClient {
	const clientOptions = { ...options };
	let state: State = "new";
	let lease: AttachedLease | undefined;

	function requireReady(): AttachedLease {
		if (state === "attach-failed") throw new DoomAttachError(null);
		if (state === "detach-failed")
			throw new Error(`Doom detach unconfirmed; client is closed. ${recovery}`);
		if (state === "new") throw new Error("Doom client is not attached.");
		if (
			state === "attaching" ||
			state === "observing" ||
			state === "operating" ||
			state === "detaching"
		)
			throw new Error("Doom client is busy.");
		if (state === "detached") throw new Error("Doom client is closed.");
		return lease!;
	}

	async function operate<T>(
		name: string,
		operation: (leaseFile: string, options: AgentClientOptions) => Promise<T>,
	): Promise<T> {
		const attached = requireReady();
		state = "operating";
		let dispatched = false;
		try {
			const underlyingTransport = clientOptions.transport ?? fetch;
			const operationOptions: AgentClientOptions = {
				...clientOptions,
				transport: async (input, init) => {
					dispatched = true;
					return underlyingTransport(input, init);
				},
			};
			return await operation(attached.leaseFile, operationOptions);
		} catch {
			throw new Error(
				dispatched
					? `Doom ${name} unconfirmed; outcome may be unknown. No retry was made.`
					: `Doom ${name} failed before dispatch. No retry was made.`,
			);
		} finally {
			state = "ready";
		}
	}

	return Object.freeze({
		async attach(): Promise<AttachedLease> {
			if (state === "attach-failed") throw new DoomAttachError(null);
			if (state === "detach-failed")
				throw new Error(
					`Doom detach unconfirmed; client is closed. ${recovery}`,
				);
			if (
				state === "attaching" ||
				state === "observing" ||
				state === "operating" ||
				state === "detaching"
			)
				throw new Error("Doom client is busy.");
			if (state === "ready")
				throw new Error("Doom client is already attached.");
			if (state !== "new") throw new Error("Doom client is closed.");

			state = "attaching";
			let rejectedCode: DoomAttachErrorCode | undefined;
			try {
				const underlyingTransport = clientOptions.transport ?? fetch;
				const attachOptions: AgentClientOptions = {
					...clientOptions,
					transport: async (input, init) => {
						const response = await underlyingTransport(input, init);
						if (!response.ok) {
							try {
								rejectedCode = knownBrokerCode(await response.clone().json());
							} catch {
								// The executor owns response parsing; an unreadable body is uncertain.
							}
						}
						return response;
					},
				};
				const attached = await executeAgentOperation(
					{ op: "attach" },
					attachOptions,
				);
				lease = attached;
				state = "ready";
				return attached;
			} catch {
				state = "attach-failed";
				throw new DoomAttachError(rejectedCode ?? null);
			}
		},
		async observe(): Promise<MaterializedObserve> {
			const attached = requireReady();
			state = "observing";
			try {
				return await executeAgentOperation(
					{ op: "observe", leaseFile: attached.leaseFile },
					clientOptions,
				);
			} catch {
				throw new Error("Doom observation unconfirmed. No retry was made.");
			} finally {
				state = "ready";
			}
		},
		getConfig(sessionId: string): Promise<ConfigResult> {
			return operate("getConfig", (leaseFile, operationOptions) =>
				executeAgentOperation(
					{ op: "get-config", sessionId, leaseFile },
					operationOptions,
				),
			);
		},
		getPrompt(sessionId: string): Promise<PromptResult> {
			return operate("getPrompt", (leaseFile, operationOptions) =>
				executeAgentOperation(
					{ op: "get-prompt", sessionId, leaseFile },
					operationOptions,
				),
			);
		},
		startRun(input: StartRunInput): Promise<ConfigResult> {
			return operate("startRun", (leaseFile, operationOptions) =>
				executeAgentOperation(
					{
						op: "start-run",
						observationId: input.observationId,
						sessionId: input.sessionId,
						revision: input.revision,
						leaseFile,
					},
					operationOptions,
				),
			);
		},
		setConfig(input: SetConfigInput): Promise<ConfigResult> {
			return operate("setConfig", (leaseFile, operationOptions) =>
				executeAgentOperation(
					{
						op: "set-config",
						sessionId: input.sessionId,
						runId: input.runId,
						revision: input.revision,
						configFile: input.configFile,
						leaseFile,
					},
					operationOptions,
				),
			);
		},
		setPrompt(input: SetPromptInput): Promise<PromptResult> {
			return operate("setPrompt", (leaseFile, operationOptions) =>
				executeAgentOperation(
					{
						op: "set-prompt",
						sessionId: input.sessionId,
						runId: input.runId,
						revision: input.revision,
						instructions: input.instructions,
						leaseFile,
					},
					operationOptions,
				),
			);
		},
		decide(input: DecideInput): Promise<MaterializedDecision> {
			return operate("decide", (leaseFile, operationOptions) =>
				executeAgentOperation(
					{
						op: "decide",
						observationId: input.observationId,
						scope: {
							sessionId: input.scope.sessionId,
							runId: input.scope.runId,
							revision: input.scope.revision,
						},
						leaseFile,
					},
					operationOptions,
				),
			);
		},
		async detach(): Promise<DetachedLease> {
			const attached = requireReady();
			state = "detaching";
			try {
				const released = await executeAgentOperation(
					{ op: "detach", leaseFile: attached.leaseFile },
					clientOptions,
				);
				state = "detached";
				return released;
			} catch {
				state = "detach-failed";
				throw new Error(
					`Doom detach unconfirmed; client is closed. ${recovery}`,
				);
			}
		},
	});
}
