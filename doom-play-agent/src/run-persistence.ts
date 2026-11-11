import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlayResult } from "./doom-play-agent.ts";

export class RunPersistenceError extends Error {
	constructor() {
		super(
			"Doom run persistence failed; artifact was not confirmed saved. No gameplay retry was made.",
		);
		this.name = "RunPersistenceError";
	}
}

/** Save the existing result once; temporary PNG paths are provenance only. */
export async function persistRun(result: PlayResult): Promise<string> {
	try {
		const recordedAt = new Date().toISOString();
		const json = `${JSON.stringify({ schemaVersion: 1, recordedAt, result }, null, 2)}\n`;
		const directory = fileURLToPath(
			new URL("../.local/runs/", import.meta.url),
		);
		const filename = `${recordedAt.replaceAll(":", "-")}_${encodeURIComponent(result.runId)}.json`;
		const path = join(directory, filename);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await writeFile(path, json, { encoding: "utf8", flag: "wx", mode: 0o600 });
		return path;
	} catch {
		// Never publish raw filesystem/serialization errors or their sensitive causes.
		throw new RunPersistenceError();
	}
}
