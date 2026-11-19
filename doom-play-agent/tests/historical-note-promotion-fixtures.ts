import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { OpenAIProvider } from "@ai-sdk/openai";
import type { generateText } from "ai";
import {
	initializeMemoryDatabase,
	recordMemory,
} from "../../app/doom-memory.mjs";
import {
	memoryFixtureGeometry,
	memoryFixtureRecognition,
} from "../../app/tests/fixtures/doom-memory.ts";
import {
	authorHistoricalNote,
	type SelectionProvenance,
	selectHistoricalNoteEvidence,
} from "../src/historical-note-authoring.ts";
import { savedRun, sha } from "./historical-note-fixtures.ts";

export async function promotionFixture(
	t: TestContext,
	mode: "automatic" | "manual" | "unspecified" = "unspecified",
	replacementAt22?: Buffer,
) {
	const f = await savedRun(t, {
		...(mode === "automatic" ? { firstOrdinal: 16, distinctFrames: true } : {}),
		replacementAt22,
	});
	const database = join(await realpath(f.root), "memory.sqlite");
	const previous = process.env.DOOM_MEMORY_DB;
	process.env.DOOM_MEMORY_DB = database;
	t.after(() => {
		if (previous === undefined) delete process.env.DOOM_MEMORY_DB;
		else process.env.DOOM_MEMORY_DB = previous;
	});
	await initializeMemoryDatabase(database);
	let input = f.input;
	let provenance: SelectionProvenance | undefined;
	if (mode === "automatic") {
		for (const ordinal of [18, 19]) {
			const probe = f.records.find((r) => r.ordinal === ordinal)
				?.reasoningObservation.facingProbe;
			if (!probe) throw Error("Missing synthetic probe");
			probe.kind = 2;
			probe.distance = 20;
		}
		await f.save();
		const selection = await selectHistoricalNoteEvidence(f.root);
		if (selection.kind !== "selected")
			throw Error("Missing synthetic selection");
		input = {
			...input,
			decisionOrdinals: selection.decisionOrdinals,
			imageOrdinals: selection.imageOrdinals,
		};
		provenance = selection.provenance;
	}
	// Exercise the real serializer contract with fake generation; never OAuth/inference.
	const audit = await authorHistoricalNote(input, {
		provider: { responses: () => ({}) } as unknown as OpenAIProvider,
		generate: (async () => ({
			finishReason: "stop",
			output: {
				...f.proposal(),
				note: {
					...f.proposal().note,
					nextQuestion: "Does the dark floor continue?",
				},
			},
			usage: {},
			response: {},
		})) as unknown as typeof generateText,
	});
	if (audit.decision !== "propose" || !audit.note)
		throw Error("Missing synthetic note");
	const artifact = {
		recordedAt: "2026-11-16T20:00:00.000Z",
		...audit,
		note: audit.note,
		...(mode === "unspecified" ? {} : { selectionMode: mode }),
		...(provenance ? { selectionProvenance: provenance } : {}),
	};
	const draft = join(f.root, "draft.json");
	const geometry = join(f.root, "geometry.json");
	const anchor = artifact.note.observationAnchor;
	const referencePng = f.png(anchor.ordinal);
	const reference = f.records.find(
		({ ordinal }) => ordinal === anchor.ordinal,
	)?.reasoningObservation;
	if (!reference) throw Error("Missing synthetic before frame");
	const auditPath = join(f.root, "linedefs-audit.json");
	const auditArtifact = {
		mapKey: anchor.mapKey,
		segments: memoryFixtureGeometry.segments,
	};
	const auditBytes = Buffer.from(JSON.stringify(auditArtifact));
	await writeFile(auditPath, auditBytes);
	const geometryArtifact = {
		mapKey: anchor.mapKey,
		observationId: anchor.observationId,
		pngSha256: artifact.note.sourceEvidence[0].pngSha256,
		auditFile: "linedefs-audit.json",
		geometry: {
			...memoryFixtureGeometry,
			provenance: {
				...memoryFixtureGeometry.provenance,
				artifactSha256: sha(auditBytes),
			},
		},
	};
	const saveDraft = (value: unknown = artifact) =>
		writeFile(draft, `${JSON.stringify(value, null, 2)}\n`);
	const saveGeometry = (value: unknown = geometryArtifact) =>
		writeFile(geometry, `${JSON.stringify(value, null, 2)}\n`);
	await saveDraft();
	await saveGeometry();
	return {
		...f,
		database,
		draft,
		geometry,
		geometryArtifact,
		auditPath,
		auditArtifact,
		referencePng,
		args: ["--draft", draft, "--geometry", geometry],
		seed(overrides: Record<string, unknown> = {}) {
			return recordMemory(
				{
					operation: "create",
					requestId: "synthetic-fixture",
					source: "Synthetic fixture only",
					mapNamespace: anchor.mapKey,
					x: anchor.rawX,
					y: anchor.rawY,
					angle: anchor.rawAngle,
					hypothesis: "A separate synthetic lead",
					nextQuestion: "Does a clearer view establish a boundary?",
					recognition: memoryFixtureRecognition(
						referencePng,
						reference.frame.nativeSha256,
					),
					...overrides,
				},
				referencePng,
			);
		},
		artifact,
		saveDraft,
		saveGeometry,
		readDraft: async () => JSON.parse(await readFile(draft, "utf8")),
	};
}
