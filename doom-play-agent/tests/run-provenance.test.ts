import assert from "node:assert/strict";
import {
	type ExecFileSyncOptionsWithStringEncoding,
	execFileSync,
} from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach, mock, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

let repository: string;
let failedCommands = new Set<string>();
let outputs: { head: string; status: string } | null = null;
const calls: string[][] = [];
// Redirect only the helper's Git calls. No test mutates the actual checkout.
const registration = mock.module("node:child_process", {
	namedExports: {
		execFileSync: (
			file: string,
			args: string[],
			options: ExecFileSyncOptionsWithStringEncoding,
		) => {
			calls.push(args);
			assert.equal(file, "git");
			assert.equal(
				options.cwd,
				fileURLToPath(new URL("../../", import.meta.url)),
			);
			if (failedCommands.has(args[3])) throw Error("SECRET Git failure");
			if (outputs)
				return args[3] === "rev-parse" ? outputs.head : outputs.status;
			return execFileSync(file, args, { ...options, cwd: repository });
		},
	},
});
after(() => registration.restore());
beforeEach(() => {
	calls.length = 0;
	failedCommands = new Set();
	outputs = null;
});
const { captureRunProvenance } = await import("../src/run-provenance.ts");

async function repositoryFixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "doom-provenance-offline-"));
	repository = join(root, "repo");
	const fixtureHome = join(root, "home");
	const fixtureXdg = join(root, "xdg");
	const environment = {
		PATH: process.env.PATH,
		LC_ALL: "C",
		HOME: fixtureHome,
		XDG_CONFIG_HOME: fixtureXdg,
	};
	const originalEnvironment = process.env;
	process.env = {
		...originalEnvironment,
		...environment,
		GIT_DIR: join(root, "wrong-checkout"),
	};
	t.after(() => {
		process.env = originalEnvironment;
		return rm(root, { recursive: true, force: true });
	});
	await Promise.all([
		mkdir(repository),
		mkdir(fixtureHome),
		mkdir(join(fixtureXdg, "git"), { recursive: true }),
	]);
	function git(args: string[]) {
		return execFileSync("git", args, {
			cwd: repository,
			env: environment,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	}
	git(["init", "--quiet", "--template="]);
	await writeFile(join(repository, ".gitignore"), ".local/\n");
	await writeFile(join(repository, "source.txt"), "initial\n");
	git(["add", "--", ".gitignore", "source.txt"]);
	git([
		"-c",
		"user.name=Offline Test",
		"-c",
		"user.email=offline@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"--quiet",
		"-m",
		"fixture",
	]);
	const commit = git(["rev-parse", "HEAD"]);
	return { commit, git, fixtureHome, fixtureXdg };
}

test("captures HEAD and ignored/untracked/unstaged/staged state independent of shell cwd", async (t) => {
	const { commit, git } = await repositoryFixture(t);
	t.mock.method(process, "cwd", () => "/unrelated-working-directory");
	assert.deepEqual(captureRunProvenance(), { git: { commit, dirty: false } });
	assert.equal(calls.length, 2);
	await mkdir(join(repository, ".local"));
	await writeFile(join(repository, ".local", "ignored.txt"), "ignored\n");
	assert.deepEqual(captureRunProvenance(), { git: { commit, dirty: false } });
	await writeFile(join(repository, "untracked.txt"), "untracked\n");
	assert.deepEqual(captureRunProvenance(), { git: { commit, dirty: true } });
	await rm(join(repository, "untracked.txt"));
	await writeFile(join(repository, "source.txt"), "modified\n");
	assert.deepEqual(captureRunProvenance(), { git: { commit, dirty: true } });
	git(["add", "--", "source.txt"]);
	assert.deepEqual(captureRunProvenance(), { git: { commit, dirty: true } });
});

for (const configuration of [
	"global-excludesfile",
	"xdg-ignore",
	"local-tilde",
] as const) {
	test(`respects user-level exclusions (${configuration})`, async (t) => {
		const { commit, git, fixtureHome, fixtureXdg } = await repositoryFixture(t);
		if (configuration === "xdg-ignore") {
			await writeFile(join(fixtureXdg, "git", "ignore"), "excluded.tmp\n");
		} else {
			await writeFile(join(fixtureHome, ".gitignore"), "excluded.tmp\n");
			if (configuration === "global-excludesfile")
				await writeFile(
					join(fixtureHome, ".gitconfig"),
					"[core]\n excludesfile = ~/.gitignore\n",
				);
			else git(["config", "--local", "core.excludesfile", "~/.gitignore"]);
		}
		await writeFile(join(repository, "excluded.tmp"), "ignored\n");
		assert.deepEqual(captureRunProvenance(), { git: { commit, dirty: false } });
		await writeFile(join(repository, "visible.tmp"), "untracked\n");
		assert.deepEqual(captureRunProvenance(), { git: { commit, dirty: true } });
	});
}

for (const failed of [["rev-parse", "status"], ["rev-parse"], ["status"]]) {
	test(`Git failure returns independently nullable metadata (${failed.join(", ")})`, () => {
		failedCommands = new Set(failed);
		outputs = { head: "a".repeat(40), status: "" };
		assert.deepEqual(captureRunProvenance(), {
			git: {
				commit: failedCommands.has("rev-parse") ? null : outputs.head,
				dirty: failedCommands.has("status") ? null : false,
			},
		});
		assert.equal(calls.length, 2);
	});
}
