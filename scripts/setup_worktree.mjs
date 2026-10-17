#!/usr/bin/env node
// Doom Decisions local worktree setup hook. Installed as a self-contained copy.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const label = 'doom-worktree';
const notice = (message) => console.error(`${label}: ${message}`);
// Only these local inputs are shared; never copy tools/ or .impeccable/ wholesale.
const inputs = [
  'tools/wasi-sdk-24.0',
  'tools/binaryen-119',
  '.agents/skills/impeccable',
  '.codex/hooks.json',
  '.impeccable/config.json',
  '.impeccable/config.local.json',
];

// Hook-provided Git environment must not redirect queries about another worktree.
const gitEnv = { ...process.env };
for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'], {
  encoding: 'utf8',
}).trim().split('\n')) delete gitEnv[name];
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {
  env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const commonDir = (cwd) => fs.realpathSync(git(cwd,
  'rev-parse', '--path-format=absolute', '--git-common-dir').trim());
const exists = (file) => {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
};
const tracked = (cwd) => new Set(git(cwd, 'ls-files', '-z').split('\0'));

function prepare(target) {
  target = fs.realpathSync(git(target, 'rev-parse', '--show-toplevel').trim());
  const common = commonDir(target);
  const first = git(target, 'worktree', 'list', '--porcelain', '-z').split('\0')[0];
  if (!first.startsWith('worktree ')) throw Error('Cannot locate the primary worktree.');
  const source = fs.realpathSync(first.slice('worktree '.length));
  if (source === target) throw Error('Choose a linked worktree, not the primary worktree.');
  if (commonDir(source) !== common) throw Error('Worktrees must belong to the same repository.');
  const sourceTracked = tracked(source);
  const targetTracked = tracked(target);
  let copied = 0;

  // Refuse symlink parents rather than writing outside the destination worktree.
  function mkdir(relative) {
    if (relative === '.') return;
    mkdir(path.dirname(relative));
    const directory = path.join(target, relative);
    const entry = exists(directory);
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
      throw Error(`Destination parent is not a directory: ${relative}`);
    }
    if (!entry) fs.mkdirSync(directory);
  }

  for (const relative of inputs) {
    const from = path.join(source, relative);
    const to = path.join(target, relative);
    if (!exists(from)) { notice(`optional source missing: ${relative}`); continue; }
    // A preexisting directory is deliberately left as a unit, even if incomplete.
    if (exists(to) || targetTracked.has(relative)) continue;
    mkdir(path.dirname(relative));
    fs.cpSync(from, to, {
      recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
      // Preserve the SDK's internal relative aliases, never links back to source.
      verbatimSymlinks: true,
      filter: (entry) => {
        const name = path.basename(entry);
        const local = path.relative(source, entry);
        if (name === '.env' || name.startsWith('.env.') ||
            ['node_modules', '.git', '.DS_Store'].includes(name) ||
            sourceTracked.has(local) || targetTracked.has(local)) return false;
        if (fs.lstatSync(entry).isSymbolicLink()) {
          const link = fs.readlinkSync(entry);
          const resolved = path.resolve(path.dirname(entry), link);
          if (path.isAbsolute(link) || !resolved.startsWith(`${from}${path.sep}`)) {
            throw Error(`Refusing an external source symlink: ${local}`);
          }
        }
        return true;
      },
    });
    if (exists(to)) copied++;
  }
  notice(`${copied} local inputs copied to ${target}; existing destinations preserved.`);
}

function install() {
  // An override could hide the shared hook, including in linked worktrees.
  let hooksPath;
  try { hooksPath = git(process.cwd(), 'config', '--get', 'core.hooksPath'); }
  catch (error) { if (error.status !== 1) throw error; }
  if (hooksPath !== undefined) throw Error('core.hooksPath is set; leave it intact and resolve it before installing.');
  const hooks = path.join(commonDir(process.cwd()), 'hooks');
  const destination = path.join(hooks, 'post-checkout');
  const signature = '#!/usr/bin/env node\n// Doom Decisions local worktree setup hook.';
  if (exists(destination) && (fs.lstatSync(destination).isSymbolicLink() ||
      !fs.readFileSync(destination, 'utf8').startsWith(signature))) {
    throw Error(`Existing post-checkout preserved: ${destination}. Integrate it explicitly before installing.`);
  }
  fs.mkdirSync(hooks, { recursive: true });
  fs.copyFileSync(fileURLToPath(import.meta.url), destination);
  fs.chmodSync(destination, 0o755);
  notice(`installed ${destination}; no Git configuration changed.`);
}

function checkout(args) {
  const [oldHead, newHead, branchCheckout] = args;
  if (branchCheckout !== '1' || !/^0{40,64}$/.test(oldHead) || /^0+$/.test(newHead)) return;
  // worktree add explicitly clears these for its hook. Ordinary checkout in a
  // linked worktree exports GIT_DIR, even when leaving an unborn branch (which
  // also supplies a zero old HEAD). Arguments alone cannot distinguish that.
  if (process.env.GIT_DIR !== undefined || process.env.GIT_WORK_TREE !== undefined) return;
  const cwd = process.cwd();
  const admin = fs.realpathSync(git(cwd, 'rev-parse', '--absolute-git-dir').trim());
  if (admin === commonDir(cwd) || newHead !== git(cwd, 'rev-parse', 'HEAD').trim()) return;
  // One attempt per linked worktree, including partial/missing-source outcomes.
  // Manual preparation is the explicit recovery path, never later checkouts.
  const marker = path.join(admin, 'doom-local-setup-attempted');
  try { fs.closeSync(fs.openSync(marker, 'wx', 0o600)); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  prepare(cwd);
}

const args = process.argv.slice(2);
const isHook = args.length === 3 && /^[0-9a-f]{40,64}$/.test(args[0]);
try {
  if (isHook) checkout(args);
  else if (args.length === 1 && args[0] === '--install') install();
  else if (args.length === 2 && args[0] === '--prepare') prepare(path.resolve(args[1]));
  else throw Error('Usage: node scripts/setup_worktree.mjs --install | --prepare /path/to/linked-worktree');
} catch (error) {
  notice(error.message);
  // Setup must never turn an otherwise successful Git checkout into a failure.
  if (!isHook) process.exitCode = 1;
}
