import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlayResult } from "./doom-play-agent-types.ts";
import {
	estimateRunCost,
	type PricingSnapshot,
	unavailableCostSummary,
} from "./run-cost.ts";
import type { RunProvenance } from "./run-provenance.ts";

export class RunPersistenceError extends Error {
	constructor() {
		super(
			"Doom run persistence failed; artifact was not confirmed saved. No gameplay retry was made.",
		);
		this.name = "RunPersistenceError";
	}
}

/** Save the existing result once; temporary PNG paths are provenance only. */
export async function persistRun(
	result: PlayResult,
	provenance: RunProvenance = { git: { commit: null, dirty: null } },
): Promise<string> {
	try {
		const recordedAt = new Date().toISOString();
		const base = fileURLToPath(new URL("../.local/runs/", import.meta.url));
		const directory = join(
			base,
			`${recordedAt.replaceAll(":", "-")}_${encodeURIComponent(result.runId)}`,
		);
		await mkdir(base, { recursive: true, mode: 0o700 });
		await mkdir(directory, { mode: 0o700 });

		async function saveImage(image: Buffer | null | undefined, file: string) {
			if (image === null || image === undefined) return image;
			if (!Buffer.isBuffer(image)) throw Error("Invalid retained image.");
			await writeFile(join(directory, file), image, {
				flag: "wx",
				mode: 0o600,
			});
			return { file };
		}

		const records = [];
		for (const record of result.records) {
			if (!Number.isSafeInteger(record.ordinal) || record.ordinal < 1)
				throw Error("Invalid decision ordinal.");
			const beforePng = await saveImage(
				record.beforePng,
				`decision-${record.ordinal}-before.png`,
			);
			const decision =
				record.decision.kind === "returned"
					? {
							...record.decision,
							afterPng: await saveImage(
								record.decision.afterPng,
								`decision-${record.ordinal}-after.png`,
							),
						}
					: record.decision;
			records.push({ ...record, beforePng, decision });
		}
		// Snapshot loading and costing are optional; filesystem/serialization failures aren't.
		let pricing: PricingSnapshot | null = null;
		try {
			pricing = await import("@opencode-ai/models/snapshot");
		} catch {
			// No network fallback or updater. Dependency updates refresh the bundled data.
		}
		let costSummary:
			| ReturnType<typeof estimateRunCost>
			| typeof unavailableCostSummary;
		try {
			costSummary = estimateRunCost(result.records, pricing);
		} catch {
			costSummary = unavailableCostSummary;
		}
		const json = `${JSON.stringify(
			{
				schemaVersion: 3,
				recordedAt,
				provenance,
				costSummary,
				result: { ...result, records },
			},
			null,
			2,
		)}\n`;
		const path = join(directory, "result.json");
		await writeFile(path, json, { encoding: "utf8", flag: "wx", mode: 0o600 });
		return path;
	} catch {
		// Never publish raw filesystem/serialization errors or their sensitive causes.
		throw new RunPersistenceError();
	}
}
