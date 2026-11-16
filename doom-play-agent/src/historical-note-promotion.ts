import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
	findExactMemory,
	findMemory,
	memoryDatabasePath,
	memoryRecordSchema,
	recordMemory,
} from "../../app/doom-memory.mjs";
import {
	historicalNoteInputSchema,
	historicalNoteOutputSchema,
	loadHistoricalNoteEvidence,
	validateHistoricalNoteDecision,
} from "./historical-note-authoring.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().safe().nullable();
const artifactSchema = historicalNoteOutputSchema.extend({
	schemaVersion: z.literal(1),
	status: z.literal("unapproved"),
	recordedAt: z.iso.datetime(),
	source: z.strictObject({
		runDirectory: z.string().refine(isAbsolute),
		resultSha256: hash,
		decisionOrdinals: historicalNoteInputSchema.shape.decisionOrdinals,
		imageOrdinals: historicalNoteInputSchema.shape.imageOrdinals,
		packet: z.record(z.string(), z.unknown()),
	}),
	request: z.strictObject({
		settings: z.strictObject({
			provider: z.literal(
				"existing createOAuthProvider / OpenAI OAuth Responses",
			),
			requestedModel: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/),
			maxRetries: z.literal(0),
			maxOutputTokens: z.literal(2200),
			timeoutMs: z.literal(120000),
			providerOptions: z.strictObject({
				openai: z.strictObject({
					store: z.literal(false),
					reasoningEffort: z.literal("xhigh"),
				}),
			}),
			modality: z.literal("image-aware"),
			imageOrdinals: historicalNoteInputSchema.shape.imageOrdinals,
		}),
		instructions: z.string().min(1).max(16000),
		packetSha256: hash,
		outputSchemaSha256: hash,
		imageAttachments: z.array(z.record(z.string(), z.unknown())).min(1).max(3),
	}),
	model: z.strictObject({
		reportedModel: z.string().min(1).max(200).nullable(),
		finishReason: z.literal("stop"),
		usage: z.strictObject({
			inputTokens: count,
			outputTokens: count,
			totalTokens: count,
			reasoningTokens: count,
		}),
		durationMs: z.number().nonnegative(),
	}),
	// Older v1 artifacts predate these fields. Absence means unspecified.
	selectionMode: z.enum(["manual", "automatic"]).optional(),
	selectionProvenance: z.record(z.string(), z.unknown()).optional(),
});

type Failure =
	| "draft"
	| "evidence"
	| "database"
	| "duplicate"
	| "write-unconfirmed";
export class HistoricalNotePromotionError extends Error {
	readonly code: Failure;
	constructor(code: Failure) {
		super(
			`Historical note promotion failed (${code}); no automatic retry was made.`,
		);
		this.name = "HistoricalNotePromotionError";
		this.code = code;
	}
}
function requireMatch(ok: unknown, code: Failure): asserts ok {
	if (!ok) throw new HistoricalNotePromotionError(code);
}
const sha256 = (bytes: Buffer | string) =>
	createHash("sha256").update(bytes).digest("hex");

// Read at most the observed size + one byte, rejecting growth, special files and
// oversized inputs. Promotion adds bounds without changing authoring's defaults.
async function readBounded(path: string, maximum: number, parent?: string) {
	const resolved = await realpath(path);
	if (parent) requireMatch(dirname(resolved) === parent, "evidence");
	const file = await open(
		resolved,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const info = await file.stat();
		requireMatch(
			info.isFile() && info.size > 0 && info.size <= maximum,
			"evidence",
		);
		const bytes = Buffer.alloc(info.size + 1);
		let length = 0;
		while (length < bytes.length) {
			const result = await file.read(
				bytes,
				length,
				bytes.length - length,
				length,
			);
			if (result.bytesRead === 0) break;
			length += result.bytesRead;
		}
		requireMatch(length === info.size, "evidence");
		return bytes.subarray(0, length);
	} finally {
		await file.close();
	}
}

async function existingDatabaseIdentity() {
	try {
		const path = await realpath(memoryDatabasePath());
		const info = await stat(path, { bigint: true });
		requireMatch(info.isFile(), "database");
		return Object.freeze({
			path,
			device: info.dev.toString(),
			inode: info.ino.toString(),
		});
	} catch {
		throw new HistoricalNotePromotionError("database");
	}
}

/** Read-only preparation. The returned payload is the exact immutable write preview. */
export async function prepareHistoricalNotePromotion(draftPath: string) {
	let artifact: z.infer<typeof artifactSchema>;
	let draftSha256: string;
	try {
		requireMatch(isAbsolute(draftPath), "draft");
		const bytes = await readBounded(draftPath, 1024 * 1024);
		draftSha256 = sha256(bytes);
		const raw = JSON.parse(bytes.toString("utf8"));
		artifact = artifactSchema.parse(raw);
		requireMatch(
			artifact.decision === "propose" &&
				artifact.reason === null &&
				artifact.note,
			"draft",
		);
		// Reject normalization rather than silently changing reviewed note text.
		requireMatch(isDeepStrictEqual(raw.note, artifact.note), "draft");
	} catch {
		throw new HistoricalNotePromotionError("draft");
	}
	let evidence: Awaited<ReturnType<typeof loadHistoricalNoteEvidence>>;
	try {
		const directory = await realpath(artifact.source.runDirectory);
		evidence = await loadHistoricalNoteEvidence(
			{
				runDirectory: artifact.source.runDirectory,
				decisionOrdinals: artifact.source.decisionOrdinals,
				imageOrdinals: artifact.source.imageOrdinals,
			},
			(path) =>
				readBounded(
					path,
					path.endsWith("/result.json") ? 64 * 1024 * 1024 : 2 * 1024 * 1024,
					directory,
				),
		);
		requireMatch(
			evidence.resultSha256 === artifact.source.resultSha256 &&
				isDeepStrictEqual(evidence.packet, artifact.source.packet) &&
				isDeepStrictEqual(
					evidence.decisionOrdinals,
					artifact.source.decisionOrdinals,
				) &&
				isDeepStrictEqual(
					evidence.imageOrdinals,
					artifact.source.imageOrdinals,
				) &&
				artifact.request.packetSha256 ===
					sha256(JSON.stringify(artifact.source.packet)),
			"evidence",
		);
		const attachments = evidence.packet.records
			.filter((r) => r.imageAttached)
			.map((r) => ({ ordinal: r.ordinal, ...r.before }));
		requireMatch(
			isDeepStrictEqual(attachments, artifact.request.imageAttachments) &&
				isDeepStrictEqual(
					evidence.imageOrdinals,
					artifact.request.settings.imageOrdinals,
				),
			"evidence",
		);
		validateHistoricalNoteDecision(
			{
				decision: artifact.decision,
				reason: artifact.reason,
				note: artifact.note,
			},
			evidence.packet,
		);
		if (artifact.selectionMode === "automatic") {
			const beforeImages = attachments.map((a) => ({
				ordinal: a.ordinal,
				observationId: a.observationId,
				tic: a.tic,
				pngSha256: a.png.sha256,
				nativeSha256: a.frame.nativeSha256,
				canvasSha256: a.frame.canvasSha256,
			}));
			requireMatch(
				isDeepStrictEqual(artifact.selectionProvenance, {
					ruleVersion: "boundary-encounter-v1",
					runId: evidence.packet.runId,
					resultSha256: evidence.resultSha256,
					mapIdentity: evidence.packet.mapIdentity,
					sessionId: attachments[0].sessionId,
					beforeImages,
				}),
				"evidence",
			);
		} else {
			requireMatch(artifact.selectionProvenance === undefined, "evidence");
		}
	} catch {
		throw new HistoricalNotePromotionError("evidence");
	}
	const note = artifact.note;
	requireMatch(note, "draft");
	const anchor = note.observationAnchor;
	const pngSha256 = note.sourceEvidence.find(
		(e) => e.ordinal === anchor.ordinal,
	)?.pngSha256;
	const payload = memoryRecordSchema.parse({
		operation: "create",
		requestId: `approve-note:v1:${draftSha256}`,
		mapNamespace: anchor.mapKey,
		x: anchor.rawX,
		y: anchor.rawY,
		angle: anchor.rawAngle,
		hypothesis: note.hypothesis,
		...(note.nextQuestion === null ? {} : { nextQuestion: note.nextQuestion }),
		source: `Human-approved draft sha256:${draftSha256}; run:${anchor.runId}; D${anchor.ordinal}; observation:${anchor.observationId}; tic:${anchor.tic}; PNG sha256:${pngSha256}; model interpretation, unverified`,
		isLandmark: true,
		isActiveExploration: true,
	});
	requireMatch(payload.operation === "create", "draft");
	Object.freeze(payload);
	const databaseIdentity = await existingDatabaseIdentity();
	const databasePath = databaseIdentity.path;
	try {
		const active = await findMemory({
			mode: "active-landmarks",
			mapNamespace: payload.mapNamespace,
			limit: 10,
		});
		const nearby = await findMemory({
			mapNamespace: payload.mapNamespace,
			x: payload.x,
			y: payload.y,
			angle: payload.angle,
			radius: 67108864,
			limit: 10,
		});
		const sameContent = await findExactMemory(payload);
		requireMatch(
			isDeepStrictEqual(await existingDatabaseIdentity(), databaseIdentity) &&
				"hasMore" in active,
			"database",
		);
		const candidates = [
			...new Map(
				[...active.candidates, ...nearby.candidates].map((n) => [n.noteId, n]),
			).values(),
		];
		return Object.freeze({
			draftSha256,
			databasePath,
			databaseIdentity,
			selectionMode: artifact.selectionMode ?? "unspecified",
			nextQuestion: note.nextQuestion,
			observer: Object.freeze({ ...anchor, pngSha256 }),
			payload,
			representedBy: sameContent?.noteId ?? null,
			overlap: {
				warning:
					"Bounded candidates only; similarity/proximity does not establish the same hypothesis or location. Review before creating a distinct note.",
				activeHasMore: active.hasMore,
				nearbyMayBeTruncated: nearby.candidates.length === 10,
				nearbyRadiusRaw: 67108864,
				candidates: candidates.map((n) => ({
					noteId: n.noteId,
					revision: n.revision,
					anchor: n.anchor,
					hypothesis: n.hypothesis,
					nextQuestion: n.nextQuestion,
					isLandmark: n.isLandmark,
					isActiveExploration: n.isActiveExploration,
					sameDraft: n.source === payload.source,
					latestAssessment: n.entries.at(-1)?.assessment ?? null,
				})),
			},
		});
	} catch {
		throw new HistoricalNotePromotionError("database");
	}
}

export type HistoricalNotePromotion = Awaited<
	ReturnType<typeof prepareHistoricalNotePromotion>
>;

/** Caller owns explicit human approval. No reread/remapping of the reviewed draft. */
export async function promoteHistoricalNote(
	prepared: HistoricalNotePromotion,
	writer: typeof recordMemory = recordMemory,
) {
	requireMatch(!prepared.representedBy, "duplicate");
	requireMatch(
		isDeepStrictEqual(
			await existingDatabaseIdentity(),
			prepared.databaseIdentity,
		),
		"database",
	);
	try {
		const receipt = await writer(prepared.payload);
		return {
			...receipt,
			databasePath: prepared.databasePath,
			requestId: prepared.payload.requestId,
		};
	} catch {
		throw new HistoricalNotePromotionError("write-unconfirmed");
	}
}
