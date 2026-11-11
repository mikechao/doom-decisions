import type {
	MaterializedDecision,
	MaterializedObserve,
} from "../../scripts/doom-agent-client.ts";
import { type MovementSummary, validRawPose } from "./movement-summary.ts";

type CheckpointIdentity = {
	kind: "initial" | "ending";
	ordinal: number;
	tic: number;
};
type PoseCheckpoint = CheckpointIdentity & {
	rawX: number;
	rawY: number;
	rawAngle: number;
};
type UnavailableReason =
	| Extract<MovementSummary, { status: "unavailable" }>["reason"]
	| "partial-record"
	| "history-discontinuity"
	| "same-tic-pose-mismatch";

export type RecentPoseComparison =
	| { status: "unavailable"; ordinal: number; reason: UnavailableReason }
	| {
			status: "available";
			current: PoseCheckpoint;
			exactXY: CheckpointIdentity | null;
			exactPose: CheckpointIdentity | null;
			sameXYDifferentAngle: CheckpointIdentity | null;
			recent: PoseCheckpoint[];
	  };

type PoseRecord = {
	ordinal: number;
	admissionObservation: MaterializedObserve | null;
	decision:
		| { kind: "not-called" | "unconfirmed" }
		| { kind: "returned"; receipt: MaterializedDecision };
	movement: MovementSummary;
	failure: { stage: string; message: string } | null;
};

function checkpoint(
	kind: CheckpointIdentity["kind"],
	ordinal: number,
	observation: NonNullable<MaterializedDecision["observation"]>,
): PoseCheckpoint {
	const { x, y, angle } = observation.telemetry;
	return {
		kind,
		ordinal,
		tic: observation.tic,
		rawX: x,
		rawY: y,
		rawAngle: angle,
	};
}

/** Compare a contiguous prefix of retained browser-reported checkpoints. */
export function compareRecentPoses(
	previousRecords: readonly PoseRecord[],
	currentRecord: PoseRecord,
): RecentPoseComparison {
	let ordinal = currentRecord.ordinal;
	const unavailable = (reason: UnavailableReason): RecentPoseComparison => ({
		status: "unavailable",
		ordinal,
		reason,
	});
	try {
		const checkpoints: PoseCheckpoint[] = [];
		const seenObservationIds = new Set<string>();
		let previous:
			| {
					runId: string;
					ending: NonNullable<MaterializedDecision["observation"]>;
			  }
			| undefined;
		for (let index = 0; index <= previousRecords.length; index++) {
			const record =
				index === previousRecords.length
					? currentRecord
					: previousRecords[index];
			const {
				admissionObservation: before,
				decision,
				movement,
				failure,
			} = record;
			ordinal = record.ordinal;
			if (ordinal !== index + 1) return unavailable("history-discontinuity");
			// Experiment A establishes each pair. The history checks join pairs.
			if (movement.status === "unavailable")
				return unavailable(movement.reason);
			if (failure || decision.kind !== "returned")
				return unavailable("partial-record");
			const after = decision.receipt.observation;
			if (!before || !after) return unavailable("missing-checkpoint");
			if (
				!before.telemetry ||
				!after.telemetry ||
				!validRawPose(before.telemetry) ||
				!validRawPose(after.telemetry)
			)
				return unavailable("invalid-pose");
			const runId = before.run?.runId;
			if (
				!runId ||
				before.tic !== movement.startTic ||
				after.tic !== movement.endTic ||
				after.tic <= before.tic
			)
				return unavailable("history-discontinuity");
			for (const { observationId } of [before, after]) {
				if (!observationId || seenObservationIds.has(observationId))
					return unavailable("history-discontinuity");
				seenObservationIds.add(observationId);
			}
			if (previous) {
				const ending = previous.ending;
				if (
					previous.runId !== runId ||
					ending.sessionId !== before.sessionId ||
					ending.mapIdentity.mapKey !== before.mapIdentity.mapKey ||
					ending.tic !== before.tic
				)
					return unavailable("history-discontinuity");
				if (
					ending.telemetry.x !== before.telemetry.x ||
					ending.telemetry.y !== before.telemetry.y ||
					ending.telemetry.angle !== before.telemetry.angle
				)
					return unavailable("same-tic-pose-mismatch");
			} else {
				checkpoints.push(checkpoint("initial", ordinal, before));
			}
			checkpoints.push(checkpoint("ending", ordinal, after));
			previous = { runId, ending: after };
		}

		const current = checkpoints.pop();
		if (!current) return unavailable("missing-checkpoint");
		let exactXY: CheckpointIdentity | null = null;
		let exactPose: CheckpointIdentity | null = null;
		let sameXYDifferentAngle: CheckpointIdentity | null = null;
		checkpoints.reverse();
		for (const { kind, ordinal, tic, rawX, rawY, rawAngle } of checkpoints) {
			if (rawX !== current.rawX || rawY !== current.rawY) continue;
			const match = { kind, ordinal, tic };
			exactXY ??= match;
			if (rawAngle === current.rawAngle) exactPose ??= match;
			else sameXYDifferentAngle ??= match;
			if (exactPose && sameXYDifferentAngle) break;
		}
		return {
			status: "available",
			current,
			exactXY,
			exactPose,
			sameXYDifferentAngle,
			recent: checkpoints.slice(0, 3),
		};
	} catch {
		return unavailable("diagnostic-error");
	}
}
