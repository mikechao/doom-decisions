import type {
	DecisionRecord,
	NavigationObjective,
} from "./doom-play-agent-types.ts";
import type { NavigationAssessment } from "./navigation-assessment.ts";
import type { ScenePerception } from "./scene-perception.ts";

export class PlaybackError extends Error {
	readonly records: DecisionRecord[];
	readonly decisionOrdinal: number;
	readonly stage: string;
	readonly navigationAssessment: NavigationAssessment | null;
	readonly decisionMayHaveBeenSent: boolean;
	readonly perception: ScenePerception | null;
	readonly navigationObjective: NavigationObjective | null;
	constructor(
		stage: string,
		decisionMayHaveBeenSent: boolean,
		perception: ScenePerception | null,
		cause: unknown,
		navigationObjective: NavigationObjective | null = null,
		navigationAssessment: NavigationAssessment | null = null,
		records: DecisionRecord[] = [],
		decisionOrdinal: number = 1,
	) {
		super(
			`Doom playback stopped at ${stage} for decision #${decisionOrdinal}. ${decisionMayHaveBeenSent ? `Decision #${decisionOrdinal} outcome may be unknown.` : `Decision #${decisionOrdinal} was not sent.`} No retry was made.`,
			{ cause },
		);
		this.name = "PlaybackError";
		this.stage = stage;
		this.navigationAssessment = navigationAssessment;
		this.decisionMayHaveBeenSent = decisionMayHaveBeenSent;
		this.perception = perception;
		this.navigationObjective = navigationObjective;
		this.records = records;
		this.decisionOrdinal = decisionOrdinal;
	}
}
