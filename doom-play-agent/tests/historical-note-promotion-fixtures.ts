import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { OpenAIProvider } from "@ai-sdk/openai";
import type { generateText } from "ai";
import { recordMemory } from "../../app/doom-memory.mjs";
import {
	authorHistoricalNote,
	type SelectionProvenance,
	selectHistoricalNoteEvidence,
} from "../src/historical-note-authoring.ts";
import { savedRun } from "./historical-note-fixtures.ts";

export async function promotionFixture(
	t: TestContext,
	mode: "automatic" | "manual" | "unspecified" = "unspecified",
) {
	const f = await savedRun(
		t,
		mode === "automatic" ? { firstOrdinal: 16, distinctFrames: true } : {},
	);
	const database = join(await realpath(f.root), "memory.sqlite");
	const previous = process.env.DOOM_MEMORY_DB;
	process.env.DOOM_MEMORY_DB = database;
	t.after(() => {
		if (previous === undefined) delete process.env.DOOM_MEMORY_DB;
		else process.env.DOOM_MEMORY_DB = previous;
	});
	// Every storage operation uses this explicit throwaway path, including seeding.
	await recordMemory({
		operation: "create",
		requestId: "foreign-fixture",
		source: "Synthetic fixture only",
		mapNamespace: `doom-map:v1:iwad-sha256:${"c".repeat(64)}:E1M1`,
		x: 0,
		y: 0,
		angle: 0,
		hypothesis: "Foreign IWAD fixture",
		isLandmark: true,
		isActiveExploration: true,
	});
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
			output: f.proposal(),
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
	const saveDraft = (value: unknown = artifact) =>
		writeFile(draft, `${JSON.stringify(value, null, 2)}\n`);
	await saveDraft();
	return {
		...f,
		database,
		draft,
		artifact,
		saveDraft,
		readDraft: async () => JSON.parse(await readFile(draft, "utf8")),
	};
}
