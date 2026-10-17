// Verify engine provenance/bytes and stage static assets.
// No downloads, engine instantiation, or frontend compilation here.
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {root, check, hash, read, write, inputs, outputPath, manifest, inspect} from './build_engine.mjs';

const currentFile = path.join(root, 'engine/doom/build/m4b-current.json');
const same = isDeepStrictEqual;
const freedoom = read(path.join(root, 'app/src/freedoom-identity.json'));
const freedoomSource = path.join(root, 'third_party/freedoom/0.13.0');

function pinnedFile(file, expected) {
  check(fs.lstatSync(file).isFile() && fs.realpathSync(file) === file,
    `Expected regular asset without symlink ancestry: ${file}`);
  check(fs.statSync(file).size === expected.bytes, `Asset size mismatch: ${file}`);
  const bytes = fs.readFileSync(file);
  check(hash(bytes) === expected.sha256, `Asset hash mismatch: ${file}`);
  return bytes;
}
function pinnedGzip(file) {
  const bytes = pinnedFile(file, freedoom.gzip);
  const wad = gunzipSync(bytes, {maxOutputLength: freedoom.wad.bytes});
  check(wad.length === freedoom.wad.bytes && hash(wad) === freedoom.wad.sha256,
    'Included Freedoom decompressed identity mismatch.');
  return bytes;
}
function visitAssets(directory, allowedGzip, base = directory) {
  check(fs.lstatSync(directory).isDirectory() && fs.realpathSync(directory) === directory,
    'Static asset directories must not contain symlinks.');
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const full = path.join(directory, entry.name);
    check(!entry.isSymbolicLink(), 'Static assets must not contain symlinks.');
    if (entry.isDirectory()) visitAssets(full, allowedGzip, base);
    else {
      check(entry.isFile(), 'Static assets must be regular files.');
      check(!/\.wad$/i.test(entry.name), 'Raw IWAD must not be shipped.');
      check(!/\.wad\.gz$/i.test(entry.name) || path.relative(base, full) === allowedGzip,
        'Unexpected compressed IWAD; only the pinned Freedoom asset may ship.');
    }
  }
}
function sourceFreedoom(source) {
  visitAssets(source, 'freedoom1.wad.gz');
  return [
    ['freedoom1.wad.gz', freedoom.gzip.path, pinnedGzip(path.join(source, 'freedoom1.wad.gz'))],
    ...freedoom.notices.map(notice => [notice.name, `notices/freedoom/${notice.name}`,
      pinnedFile(path.join(source, notice.name), notice)]),
  ];
}
// These are also exercised offline without requiring a generated native receipt.
export function verifyFreedoom(target, source = freedoomSource) {
  const assets = sourceFreedoom(source);
  visitAssets(target, freedoom.gzip.path);
  pinnedGzip(path.join(target, freedoom.gzip.path));
  for (const [, relative, bytes] of assets) {
    const emitted = pinnedFile(path.join(target, relative), {bytes: bytes.length, sha256: hash(bytes)});
    check(emitted.equals(bytes), 'Freedoom source/output bytes differ.');
  }
}
export function stageFreedoom(target, source = freedoomSource) {
  const assets = sourceFreedoom(source); // Verify all source bytes before copying.
  fs.mkdirSync(target, {recursive: true});
  visitAssets(target, freedoom.gzip.path);
  for (const [, relative, bytes] of assets) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    // Recheck ancestry before writes, including any existing target file.
    check(fs.realpathSync(path.dirname(destination)) === path.dirname(destination), 'Symlink asset ancestry.');
    const existing = fs.lstatSync(destination, {throwIfNoEntry: false});
    check(!existing || existing.isFile(), 'Expected regular asset destination.');
    fs.writeFileSync(destination, bytes);
  }
  verifyFreedoom(target, source);
}
function artifact(selected) {
  const viteVersion = read(path.join(root, 'app/package.json')).devDependencies?.vite;
  check(typeof viteVersion === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(viteVersion),
    'app/package.json devDependencies.vite must be an exact x.y.z version pin.');
  check(selected.inputsSha256 === inputs(), 'Engine inputs changed; run ./build.sh.');
  check(typeof selected.output === 'string' && !path.isAbsolute(selected.output) &&
    !selected.output.split('/').includes('..'), 'Unexpected current engine path.');
  const out = outputPath(path.resolve(root, selected.output));
  const receipt = manifest(out, 'BUILD PASS');
  check(receipt.inputsSha256 === selected.inputsSha256, 'Engine receipt input identity mismatch.');
  const wasm = path.join(out, 'doom.wasm');
  check(fs.lstatSync(wasm).isFile() && fs.realpathSync(wasm) === wasm, 'WASM must be a regular generated file.');
  const bytes = fs.readFileSync(wasm);
  check(bytes.length === receipt.final.bytes && hash(bytes) === receipt.final.sha256,
    'Engine bytes differ from build receipt. Run ./build.sh.');
  const inspected = inspect(out);
  check(same(inspected, receipt.interface), 'Static interface differs from build receipt.');
  return {bytes, metadata: {profile: receipt.profile, a1Fixtures: true, embeddedIwad: false,
    bytes: bytes.length, sha256: inspected.sha256, engineInputsSha256: selected.inputsSha256,
    sourceHead: receipt.sources.head, sdkVersion: '7.32.0', viteVersion,
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
function verify(directory, selected = current()) {
  check(['public', 'dist'].includes(directory), 'Usage: verify public|dist');
  const target = path.join(root, 'app', directory);
  const {metadata} = artifact(selected);
  check(same(read(path.join(target, 'doom-build.json')), metadata), 'Generated web identity differs from current engine.');
  const bytes = fs.readFileSync(path.join(target, 'doom.wasm'));
  check(bytes.length === metadata.bytes && hash(bytes) === metadata.sha256, 'Staged/emitted WASM identity mismatch.');
  verifyFreedoom(target);
  check(fs.existsSync(path.join(target, 'notices/doom-LICENSE.txt')) &&
    fs.existsSync(path.join(target, 'notices/openai/LICENSE')), 'Missing license notices.');
  console.log(`${directory} WASM verified: ${metadata.bytes} bytes, SHA-256 ${metadata.sha256}; pinned Freedoom gzip/notices verified; no raw .wad files.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
try {
  const [command, output, ...extra] = process.argv.slice(2);
  check(extra.length === 0, 'Unexpected staging arguments.');
  if (command === 'inputs') console.log(inputs());
  else if (command === 'stage') {
    const selected = output ? {output: path.relative(root, outputPath(output)),
      inputsSha256: manifest(outputPath(output), 'BUILD PASS').inputsSha256} : current();
    const {bytes, metadata} = artifact(selected);
    for (const [name, version] of [['openai', '7.32.0'], ['vite', metadata.viteVersion]]) {
      check(read(path.join(root, 'app/node_modules', name, 'package.json')).version === version,
        `Run npm --prefix app ci; require ${name}@${version}.`);
    }
    const target = path.join(root, 'app/public');
    stageFreedoom(target);
    fs.mkdirSync(path.join(target, 'notices'), {recursive: true});
    fs.writeFileSync(path.join(target, 'doom.wasm'), bytes);
    fs.copyFileSync(path.join(root, 'engine/doom/LICENSE'), path.join(target, 'notices/doom-LICENSE.txt'));
    copyLicenses(path.join(root, 'app/node_modules/openai'), path.join(target, 'notices/openai'));
    write(path.join(target, 'doom-build.json'), metadata);
    verify('public', selected);
    write(currentFile, selected);
  } else if (command === 'verify') verify(output);
  else throw Error('Usage: stage_web.mjs inputs|stage [verified-output]|verify public|dist');
} catch (error) {
  console.error(`Web handoff refused: ${error.message}`);
  process.exitCode = 1;
}
}
