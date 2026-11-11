import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type RunProvenance = {
	git: { commit: string | null; dirty: boolean | null };
};

/** Best-effort checkout snapshot; never read ignored artifacts or retain paths. */
export function captureRunProvenance(): RunProvenance {
	function git(args: string[]): string | null {
		try {
			return execFileSync(
				"git",
				["--no-optional-locks", "-c", "core.fsmonitor=false", ...args],
				{
					cwd: fileURLToPath(new URL("../../", import.meta.url)),
					// Preserve user-level ignores without inheriting checkout redirects.
					env: {
						PATH: process.env.PATH,
						HOME: process.env.HOME,
						XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
						LC_ALL: "C",
					},
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
				},
			).trim();
		} catch {
			return null;
		}
	}

	const head = git(["rev-parse", "--verify", "HEAD"]);
	const status = git(["status", "--porcelain=v1", "--untracked-files=normal"]);
	return {
		git: {
			commit:
				head !== null && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)
					? head
					: null,
			dirty: status === null ? null : status !== "",
		},
	};
}
