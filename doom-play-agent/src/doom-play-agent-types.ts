import type { AgentDecisionResult } from "../../app/src/agent-observation.ts";
import type {
	ConfigResult,
	MaterializedDecision,
	MaterializedObserve,
	PromptResult,
} from "../../scripts/doom-agent-client.ts";
import type { DoomClient } from "./doom-client.ts";
import type { DoomMemoryCandidate, DoomTools } from "./doom-tools.ts";
import type { MovementSummary } from "./movement-summary.ts";
import type { NavigationAssessment } from "./navigation-assessment.ts";
import type { RecentPoseComparison } from "./recent-pose-comparison.ts";
import type { ScenePerception } from "./scene-perception.ts";

export type NavigationObjective =
	| { kind: "free-explore" }
	| { kind: "landmark"; noteId: string; revision: number };
export type Memory = Awaited<ReturnType<DoomTools["findActiveLandmarks"]>>;
export type NavigationSelection = {
	navigationObjective: NavigationObjective;
	target: DoomMemoryCandidate | null;
};

export type DecisionAttempt =
	| { kind: "not-called" }
	| {
			kind: "unconfirmed";
			input: Parameters<DoomClient["decide"]>[0];
	  }
	| {
			kind: "returned";
			input: Parameters<DoomClient["decide"]>[0];
			receipt: MaterializedDecision;
			afterPng: Buffer | null;
			imageRetentionFailure: {
				reason: "read-failed" | "digest-mismatch";
				message: string;
			} | null;
	  };

export type DecisionEvidence = {
	ordinal: number;
	reasoningObservation: MaterializedObserve | null;
	beforePng: Buffer | null;
	landmarkLookup: Memory | null;
	selection: NavigationSelection | null;
	perception: ScenePerception | null;
	navigationAssessment: NavigationAssessment | null;
	guidance: string | null;
	runStarted: ConfigResult | null;
	promptAcknowledged: PromptResult | null;
	admissionObservation: MaterializedObserve | null;
	decision: DecisionAttempt;
	movement: MovementSummary;
	failure: { stage: string; message: string } | null;
};

/**
 * Passive evidence for one attempt, including unreached/failed stages. DTOs are
 * detached at capture; PNG Buffers transfer ownership without another copy.
 * Readonly/freeze protect the top level only: callers must treat nested DTOs and
 * Buffers as immutable too. No mutable control/result aliases are published. pngPath
 * fields are ephemeral source paths; only the Buffers retain image evidence.
 * Records never authorize gameplay; eligible published history may inform guidance.
 */
export type DecisionRecord = Readonly<
	DecisionEvidence & { recentPoseComparison: RecentPoseComparison }
>;

export type PlayResult = {
	readonly records: DecisionRecord[];
	decisionOrdinal: number;
	navigationObjective: NavigationObjective;
	memoryStatus: Memory["status"];
	candidateCount: number;
	navigationAssessment: NavigationAssessment | null;
	perception: ScenePerception;
	promptChanged: boolean;
	runId: string;
	outcome: AgentDecisionResult["outcome"];
	reason: AgentDecisionResult["reason"];
	action: AgentDecisionResult["action"];
	sdkInvoked: boolean;
	completionUncertain: boolean;
	cumulativeTics: number | null;
	tics: {
		requested: number | null;
		reported: number | null;
		verified: number | null;
	};
};
