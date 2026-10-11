// Shell handoff only: verify engine provenance/bytes and stage static assets.
// No downloads, engine instantiation, or frontend compilation here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const currentFile = path.join(root, 'engine/doom/build/m4b-current.json');
const check = (ok, message) => { if (!ok) throw Error(message); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
// Python writes sorted JSON keys; compare values, not serializer key order.
const same = isDeepStrictEqual;
function write(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}
function inputs() {
  const files = execFileSync('git', ['--no-optional-locks', 'ls-files', '-z',
    '--cached', '--others', '--exclude-standard', '--', 'engine/doom',
    'scripts/build_doom.py', 'scripts/inspect_doom.mjs'], {cwd: root, encoding: 'utf8'})
    .split('\0').filter(Boolean);
  return hash(JSON.stringify([...new Set(files)].sort().map(file => {
    const full = path.join(root, file);
    // A removed input must invalidate reuse too.
    if (!fs.existsSync(full)) return [file, 'missing'];
    check(!fs.lstatSync(full).isSymbolicLink(), `Symlink engine input: ${file}`);
    return [file, hash(fs.readFileSync(full))];
  })));
}
function artifact(selected) {
  check(selected.inputsSha256 === inputs(), 'Engine inputs changed; run ./build.sh.');
  check(typeof selected.output === 'string' && selected.output.startsWith('engine/doom/build/m4b-runs/'),
    'Current artifact must be an M4-B engine build. Run ./build.sh.');
  const out = path.resolve(root, selected.output);
  check(fs.existsSync(out), 'Current engine output missing; run ./build.sh.');
  check(out.startsWith(path.join(root, 'engine/doom/build/m4b-runs/')) &&
    fs.realpathSync(out) === out, 'Unexpected engine output path/symlink.');
  check(fs.existsSync(path.join(out, 'evidence/manifest.json')) && fs.existsSync(path.join(out, 'doom.wasm')),
    'Current engine artifact/evidence missing; run ./build.sh.');
  const manifest = read(path.join(out, 'evidence/manifest.json'));
  check(manifest.status === 'BUILD PASS' && manifest.profile === 'controlled-title' &&
    manifest.controlled_title?.a1_fixtures === true && manifest.asset === null &&
    manifest.executables_revalidated_at_closeout === true, 'Require successful controlled-title build with fixtures and no embedded IWAD.');
  const wasm = path.join(out, 'doom.wasm');
  check(!fs.lstatSync(wasm).isSymbolicLink(), 'WASM must be a regular generated file.');
  const bytes = fs.readFileSync(wasm);
  check(bytes.length === manifest.final.bytes && hash(bytes) === manifest.final.sha256,
    'Engine bytes differ from build receipt. Run ./build.sh.');
  const inspected = JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts/inspect_doom.mjs'),
    wasm, '--profile', 'controlled-title'], {encoding: 'utf8', timeout: 10000}));
  check(same(inspected, manifest.interface), 'Static interface differs from build receipt.');
  return {bytes, metadata: {profile: manifest.profile, a1Fixtures: true, embeddedIwad: false,
    bytes: bytes.length, sha256: inspected.sha256, engineInputsSha256: selected.inputsSha256,
    sourceHead: manifest.sources.head, sdkVersion: '7.32.0', viteVersion: '7.3.6',
    interface: {imports: inspected.imports, exports: inspected.exports}}};
}
function current() {
  check(fs.existsSync(currentFile), 'No M4-B current engine receipt; run ./build.sh before --frontend-only.');
  return read(currentFile);
}
function copyLicenses(source, destination) {
  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyLicenses(from, to);
    else if (/^licen[cs]e(?:\.|$)/i.test(entry.name)) {
      fs.mkdirSync(destination, {recursive: true});
      fs.copyFileSync(from, to);
    }
  }
}
function verify(directory) {
  check(['public', 'dist'].includes(directory), 'Usage: verify public|dist');
  const target = path.join(root, 'app', directory);
  const {metadata} = artifact(current());
  check(same(read(path.join(target, 'doom-build.json')), metadata), 'Generated web identity differs from current engine.');
  const bytes = fs.readFileSync(path.join(target, 'doom.wasm'));
  check(bytes.length === metadata.bytes && hash(bytes) === metadata.sha256, 'Staged/emitted WASM identity mismatch.');
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      check(!entry.isSymbolicLink(), 'Static assets must not contain symlinks.');
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else check(!/\.wad$/i.test(entry.name), 'IWAD must not be shipped.');
    }
  }
  visit(target);
  check(fs.existsSync(path.join(target, 'notices/doom-LICENSE.txt')) &&
    fs.existsSync(path.join(target, 'notices/openai/LICENSE')), 'Missing license notices.');
  console.log(`${directory} WASM verified: ${metadata.bytes} bytes, SHA-256 ${metadata.sha256}; no .wad files.`);
}
try {
  const [command, output, expected] = process.argv.slice(2);
  if (command === 'inputs') console.log(inputs());
  else if (command === 'stage') {
    const selected = output ? {output: path.relative(root, path.resolve(output)), inputsSha256: expected} : current();
    const {bytes, metadata} = artifact(selected);
    for (const [name, version] of [['openai', '7.32.0'], ['vite', '7.3.6']]) {
      check(read(path.join(root, 'app/node_modules', name, 'package.json')).version === version,
        `Run npm --prefix app ci; require ${name}@${version}.`);
    }
    const target = path.join(root, 'app/public');
    fs.mkdirSync(path.join(target, 'notices'), {recursive: true});
    fs.writeFileSync(path.join(target, 'doom.wasm'), bytes);
    fs.copyFileSync(path.join(root, 'engine/doom/LICENSE'), path.join(target, 'notices/doom-LICENSE.txt'));
    copyLicenses(path.join(root, 'app/node_modules/openai'), path.join(target, 'notices/openai'));
    write(path.join(target, 'doom-build.json'), metadata);
    write(currentFile, selected);
    verify('public');
  } else if (command === 'verify') verify(output);
  else throw Error('Usage: stage_web.mjs inputs|stage [fresh-output input-fingerprint]|verify public|dist');
} catch (error) {
  console.error(`Web handoff refused: ${error.message}`);
  process.exitCode = 1;
}
