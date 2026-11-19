import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createAgentMapIdentity } from "../../app/src/agent-observation.ts";
import {
	memoryFixtureFrameSha256,
	memoryFixturePng,
} from "../../app/tests/fixtures/doom-memory.ts";
import type { HistoricalNoteDraft } from "../src/historical-note-authoring.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const sha = (bytes: Buffer | string) =>
	createHash("sha256").update(bytes).digest("hex");

export async function savedRun(
	t: TestContext,
	options: {
		firstOrdinal?: number;
		count?: number;
		distinctFrames?: boolean;
		replacementAt22?: Buffer;
	} = {},
) {
	t.mock.method(globalThis, "fetch", async () => {
		throw Error("Network forbidden");
	});
	const root = await mkdtemp(join(tmpdir(), "doom-note-offline-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const runId = id(1);
	const sessionId = id(2);
	const mapIdentity = createAgentMapIdentity("a".repeat(64), 1, 1);
	const frames = new Map<number, Buffer>();
	const png = (n: number) => {
		if (n === 22 && options.replacementAt22) return options.replacementAt22;
		let bytes = frames.get(n);
		if (!bytes) {
			bytes = memoryFixturePng(options.distinctFrames ? n : 0, n);
			frames.set(n, bytes);
		}
		return bytes;
	};
	const checkpoint = (n: number, observationId: string) => {
		const tic = 97 + (n - 17) * 6;
		const frameHash = memoryFixtureFrameSha256(options.distinctFrames ? n : 0);
		return {
			observationId,
			sessionId,
			tic,
			phase: "ready" as const,
			mapIdentity,
			telemetry: {
				x: 84595626 + (n - 22) * 65536,
				y: -215789052,
				angle: 3837788160,
			},
			frame: {
				tic,
				nativeSha256: frameHash,
				canvasSha256: frameHash,
			},
			counters: { gametic: tic },
			pngSha256: sha(png(n)),
			facingProbe: { tic, kind: 1, door: 0, distance: -1 },
			run: { runId },
			configuration: { instructionTemplate: "EXCLUDED_SECRET" },
			previousAction: { text: "EXCLUDED_SECRET" },
		};
	};
	const records = await Promise.all(
		Array.from({ length: options.count ?? 7 }, async (_, i) => {
			const ordinal = (options.firstOrdinal ?? 17) + i;
			const before = checkpoint(
				ordinal,
				ordinal === 22
					? "0728dad7-969d-464c-bc02-847bdc44e4c2"
					: id(ordinal + 100),
			);
			const admission = checkpoint(ordinal, id(ordinal + 200));
			const after = checkpoint(ordinal + 1, id(ordinal + 300));
			const beforePng = { file: `decision-${ordinal}-before.png` };
			const afterPng = { file: `decision-${ordinal}-after.png` };
			await writeFile(join(root, beforePng.file), png(ordinal));
			await writeFile(join(root, afterPng.file), png(ordinal + 1));
			return {
				ordinal,
				reasoningObservation: before,
				beforePng,
				perception: {
					description: "A ledge meets a ribbed wall.",
					features: ["A dark floor lies beside the wall."],
					uncertainty: "Connectivity is unclear.",
					raw: "EXCLUDED_SECRET",
				},
				admissionObservation: admission,
				decision: {
					kind: "returned",
					input: {
						observationId: admission.observationId,
						scope: { runId, sessionId },
					},
					receipt: {
						beforeObservationId: admission.observationId,
						action: "forward",
						outcome: "completed",
						reason: null,
						sdkInvoked: true,
						completionUncertain: false,
						requestedTics: 6,
						reportedTics: 6,
						verifiedTics: 6,
						cumulativeTics: after.tic,
						observation: after,
						responseMetadata: "EXCLUDED_SECRET",
					},
					afterPng,
					imageRetentionFailure: null,
				},
				movement: {
					status: "available",
					startTic: before.tic,
					endTic: after.tic,
					dxRaw: 65536,
					dyRaw: 0,
					dx: 1,
					dy: 0,
					distance: 1,
					headingDelta: 0,
					positionChanged: true,
					headingChanged: false,
				},
				failure: null,
				selection: {
					target: {
						hypothesis: "EXCLUDED_SECRET",
						nextQuestion: "EXCLUDED_SECRET",
					},
				},
				landmarkLookup: "EXCLUDED_SECRET",
				navigationAssessment: "EXCLUDED_SECRET",
				guidance: "EXCLUDED_SECRET",
				promptAcknowledged: "EXCLUDED_SECRET",
				navigationObjective: "EXCLUDED_SECRET",
			};
		}),
	);
	const saved = {
		schemaVersion: 3,
		result: { runId, records, extraneous: "EXCLUDED_SECRET" },
	};
	const save = () =>
		writeFile(join(root, "result.json"), `${JSON.stringify(saved, null, 2)}\n`);
	await save();
	const input = {
		runDirectory: root,
		decisionOrdinals: [17, 18, 19, 20, 21, 22, 23],
		imageOrdinals: [17, 20, 22],
	};
	const proposal = (ordinal = 22) => {
		const record = records.find((r) => r.ordinal === ordinal);
		if (!record) throw Error("Invalid synthetic ordinal");
		const o = record.reasoningObservation;
		const note: HistoricalNoteDraft = {
			observationAnchor: {
				runId,
				ordinal,
				observationId: o.observationId,
				tic: o.tic,
				mapKey: mapIdentity.mapKey,
				rawX: o.telemetry.x,
				rawY: o.telemetry.y,
				rawAngle: o.telemetry.angle,
			},
			visibleFeatures: ["A ledge meets a ribbed wall."],
			verifiedHistory: [],
			uncertainInterpretation: "Connectivity is unclear.",
			hypothesis: "A yard-side ledge meets a ribbed wall beside a dark floor.",
			nextQuestion:
				"Does the dark floor continue past the end of the ribbed wall, or terminate there?",
			sourceEvidence: [
				{ ordinal, observationId: o.observationId, pngSha256: o.pngSha256 },
			],
			reuseReason: "The spatial arrangement may support recognition.",
		};
		return { decision: "propose" as const, reason: null, note };
	};
	return { root, input, saved, records, save, proposal, png };
}
