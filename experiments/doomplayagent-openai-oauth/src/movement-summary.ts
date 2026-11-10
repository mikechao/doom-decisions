import { createAgentMapIdentity } from "../../../app/src/agent-observation.ts";
import { masks } from "../../../app/src/decision.ts";
import type {
	MaterializedDecision,
	MaterializedObserve,
} from "../../../scripts/doom-agent-client.ts";

export type MovementSummary =
	| {
			status: "unavailable";
			reason:
				| "decision-not-returned"
				| "not-completed"
				| "completion-uncertain"
				| "sdk-not-invoked"
				| "invalid-action-or-tics"
				| "missing-checkpoint"
				| "checkpoint-mismatch"
				| "invalid-pose"
				| "diagnostic-error";
	  }
	| {
			status: "available";
			startTic: number;
			endTic: number;
			dxRaw: number;
			dyRaw: number;
			/** Net endpoint displacement in Doom map units, not path length. */
			dx: number;
			dy: number;
			distance: number;
			/** Degrees in [-180, 180); an exact half-turn maps to -180. */
			headingDelta: number;
			positionChanged: boolean;
			headingChanged: boolean;
	  };

const unavailable = (
	reason: Extract<MovementSummary, { status: "unavailable" }>["reason"],
): MovementSummary => ({ status: "unavailable", reason });
const inRange = (value: number, min: number, max: number) =>
	Number.isSafeInteger(value) && value >= min && value <= max;

/** Passive diagnostics only: browser-reported poses, not native pose attestation.
 * The controller/executor own execution and image verification. These checks
 * only decide whether arithmetic on their retained checkpoints is meaningful.
 */
export function summarizeMovement(
	before: MaterializedObserve | null,
	receipt: MaterializedDecision,
): MovementSummary {
	try {
		if (receipt.completionUncertain) return unavailable("completion-uncertain");
		if (receipt.outcome !== "completed") return unavailable("not-completed");
		if (!receipt.sdkInvoked) return unavailable("sdk-not-invoked");
		const tics = receipt.verifiedTics;
		if (
			receipt.action === null ||
			!Object.hasOwn(masks, receipt.action) ||
			tics === null ||
			!Number.isSafeInteger(tics) ||
			tics <= 0 ||
			receipt.requestedTics !== tics ||
			receipt.reportedTics !== tics
		)
			return unavailable("invalid-action-or-tics");
		const after = receipt.observation;
		if (!before || !after) return unavailable("missing-checkpoint");
		const canonical = createAgentMapIdentity(
			before.mapIdentity.iwadSha256,
			before.mapIdentity.episode,
			before.mapIdentity.map,
		);
		if (
			before.phase !== "ready" ||
			after.phase !== "ready" ||
			receipt.reason !== null ||
			receipt.beforeObservationId !== before.observationId ||
			!before.observationId ||
			after.observationId === before.observationId ||
			!before.sessionId ||
			before.sessionId !== after.sessionId ||
			!Object.entries(canonical).every(
				([key, value]) =>
					before.mapIdentity[key as keyof typeof canonical] === value &&
					after.mapIdentity[key as keyof typeof canonical] === value,
			) ||
			!Number.isSafeInteger(before.tic) ||
			before.tic < 1 ||
			!Number.isSafeInteger(after.tic) ||
			after.tic !== before.tic + tics ||
			receipt.cumulativeTics !== after.tic ||
			before.frame?.tic !== before.tic ||
			before.counters?.gametic !== before.tic ||
			after.frame?.tic !== after.tic ||
			after.counters?.gametic !== after.tic
		)
			return unavailable("checkpoint-mismatch");
		const start = before.telemetry;
		const end = after.telemetry;
		if (
			![start, end].every(
				(pose) =>
					inRange(pose.x, -2147483648, 2147483647) &&
					inRange(pose.y, -2147483648, 2147483647) &&
					inRange(pose.angle, 0, 0xffffffff),
			)
		)
			return unavailable("invalid-pose");
		const dxRaw = end.x - start.x;
		const dyRaw = end.y - start.y;
		const revolution = 4294967296;
		// Nonnegative modulo, with the half-turn tie represented as negative.
		const delta = end.angle - start.angle + revolution / 2;
		const headingRaw =
			(((delta % revolution) + revolution) % revolution) - revolution / 2;
		return {
			status: "available",
			startTic: before.tic,
			endTic: after.tic,
			dxRaw,
			dyRaw,
			dx: dxRaw / 65536,
			dy: dyRaw / 65536,
			distance: Math.hypot(dxRaw, dyRaw) / 65536,
			headingDelta: (headingRaw * 360) / revolution,
			positionChanged: dxRaw !== 0 || dyRaw !== 0,
			headingChanged: headingRaw !== 0,
		};
	} catch {
		// A malformed diagnostic input must never become a gameplay failure.
		return unavailable("diagnostic-error");
	}
}
