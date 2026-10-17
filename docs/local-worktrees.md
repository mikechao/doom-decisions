# Local worktree setup

Once per clone, from the repository root with Node on PATH:

```bash
node scripts/setup_worktree.mjs --install
git worktree add ../doom-feature -b feature
```

Installation copies the self-contained Node script to the **shared Git
directory's `hooks/post-checkout`**, with executable permissions. No Git config
changes, global hooks, packages, or downloads are involved. It works even when
the checked-out branch does not contain this script. Reinstall after changing
the script. An existing unrelated hook or any `core.hooksPath` setting causes
installation to stop without replacing it; integrate existing hooks explicitly.

Only a branch checkout with an all-zero previous HEAD in a linked worktree
and Git's worktree-add hook environment triggers setup. [Git clears `GIT_DIR`
and `GIT_WORK_TREE` for that invocation](https://github.com/git/git/blob/v2.54.0/builtin/worktree.c);
ordinary linked-worktree checkout exports `GIT_DIR`, including when leaving an
unborn branch. A marker in the worktree's Git administration directory limits
automatic setup to one attempt. Ordinary branch and file checkouts do nothing.
`git worktree add --no-checkout` does not run the hook; use manual preparation
after checking out the files. This hook is preparation, not synchronization.

The source is the primary worktree (the first entry in `git worktree list`). The
fixed copy list contains only these local, untracked inputs:

| Input | Purpose |
| --- | --- |
| `tools/wasi-sdk-24.0/` | Local compiler and WASI sysroot |
| `tools/binaryen-119/` | Local WASM processing tools |
| `.agents/skills/impeccable/` | Skill, references, scripts, and bundled platform executable |
| `.codex/hooks.json` | Project-relative Impeccable detector commands |
| `.impeccable/config.json` | Project Impeccable settings |
| `.impeccable/config.local.json` | Existing local hook consent/settings |

These are independent copies with executable modes preserved. The SDK's internal
relative symlinks (for example `clang -> clang-18`) stay internal to its copied
directory; external/absolute symlinks are refused. No directory links back to the
primary worktree. The inspected configs use relative paths and need no rewrite.
Use the **new worktree's** absolute skill launcher path for Impeccable commands.

Tracked files are excluded from copying. `PRODUCT.md`, `DESIGN.md`,
`.impeccable/design.json`, and `app/.impeccable/live/config.json` already arrive
through Git on current branches. No extra copy is made for older branches.
Caches, critique reports, Live roots/session state/injection, old tool reports,
`node_modules`, build outputs, WADs, and `.env` files are not provisioned. Keep
credentials outside the allowlisted tooling/config inputs. The existing shared
`info/exclude` already ignores local Impeccable inputs for all these worktrees.

Missing inputs produce diagnostics. Existing destinations (including whole
directories) are skipped, never merged or overwritten. A partial failed copy is
also left alone for inspection. For an existing worktree or a missed automatic
setup, run from the primary worktree:

```bash
node scripts/setup_worktree.mjs --prepare "/absolute/path/to/doom worktree"
```

Rerunning is harmless but does not repair or update existing inputs. The shared
hook copy also supports `--prepare`, even if the target branch lacks the script.
Git-hook errors are diagnostic only; manual setup/installation reports failures
with a nonzero exit code. No tools, game, browser, server, or API are run.

Frontend dependencies still require `npm --prefix app ci --no-audit --no-fund`
in the new worktree, with owner authorization, followed by separately authorized
builds as needed. A fresh worktree requires a full `./build.sh` before
`./build.sh --frontend-only` can reuse verified local output.

To deactivate, remove only the installed `hooks/post-checkout` copy after
confirming it still has the Doom Decisions signature. Other hooks are untouched.
