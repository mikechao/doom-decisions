// Controlled-title admission/evidence only. Bash runs Make in the foreground.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';

export const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const sources = ['engine/doom', 'build.sh', 'scripts/build_engine.mjs',
  'scripts/stage_web.mjs', 'scripts/inspect_doom.mjs'];
const environment = {PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', TZ: 'UTC'};
export const check = (ok, message) => { if (!ok) throw Error(message); };
export const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function write(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  fs.renameSync(temporary, file);
}
function git(args) {
  return execFileSync('/usr/bin/git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
    {cwd: root, env: environment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
}
function safePath(value) {
  check(typeof value === 'string' && /^[A-Za-z0-9_./@+-]+$/.test(value) &&
    !value.split('/').includes('..'), `Unsupported Make path: ${value}`);
  return path.resolve(value);
}
export function outputPath(value, fresh = false) {
  const out = safePath(value);
  check(/^engine\/doom\/build\/m4b-runs\/run\.[A-Za-z0-9]+\/engine$/.test(path.relative(root, out)),
    'Output must be a fresh m4b-runs/run.*/engine directory.');
  const parent = path.dirname(out);
  check(fs.realpathSync(parent) === parent, 'Symlink output ancestry.');
  const stat = fs.lstatSync(out, {throwIfNoEntry: false});
  check(fresh ? !stat : stat?.isDirectory() && !stat.isSymbolicLink(),
    fresh ? 'Output already exists; choose a fresh run.' : 'Missing engine output directory.');
  return out;
}
function regular(file) {
  check(fs.lstatSync(file).isFile() && fs.realpathSync(file) === file,
    `Expected regular file without symlink ancestry: ${file}`);
}
function identity(invokedPath) {
  invokedPath = safePath(invokedPath);
  const target = safePath(fs.realpathSync(invokedPath));
  check(fs.statSync(target).isFile(), `Missing tool/SDK file: ${target}`);
  const bytes = fs.readFileSync(target);
  return {invokedPath, path: target, bytes: bytes.length, sha256: hash(bytes)};
}
export function inputs() {
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...sources])
    .split('\0').filter(Boolean);
  return hash(JSON.stringify([...new Set([...files, ...sources.slice(1)])].sort().map(file => {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) return [file, 'missing'];
    regular(full);
    return [file, hash(fs.readFileSync(full))];
  })));
}
export function manifest(out, status) {
  const file = path.join(out, 'evidence/manifest.json');
  regular(file);
  const result = read(file);
  check(result.schema === 1 && result.status === status && result.profile === 'controlled-title' &&
    result.a1Fixtures === true && result.embeddedIwad === false &&
    result.output === path.relative(root, out) && result.configuration?.jobs === 2,
    'Require a matching controlled-title receipt with fixtures and no embedded IWAD. Run ./build.sh.');
  return result;
}
export function inspect(out) {
  const wasm = path.join(out, 'doom.wasm');
  regular(wasm);
  return JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts/inspect_doom.mjs'),
    wasm, '--profile', 'controlled-title'], {env: environment, encoding: 'utf8', timeout: 10000}));
}
function admit(output, sdkArgument, binaryenArgument) {
  safePath(root);
  const out = outputPath(output, true);
  check(git(['check-ignore', '--', path.join(out, 'probe')]).trim(), 'Output must be Git-ignored.');
  const sdk = safePath(fs.realpathSync(safePath(sdkArgument)));
  const binaryen = safePath(fs.realpathSync(safePath(binaryenArgument)));
  const tools = [
    ['/usr/bin/make', /^GNU Make 3\.81\b/m], [process.execPath, /^v22\.20\.0\s*$/],
    [path.join(sdk, 'bin/clang'), /^clang version 18\.1\.2-wasi-sdk\b/m],
    [path.join(sdk, 'bin/wasm-ld'), /^LLD 18\.1\.2\b/m],
    ...['wasm-as', 'wasm-merge', 'wasm-metadce'].map(name =>
      [path.join(binaryen, name), new RegExp(`^${name} version 119\\b`, 'm')]),
  ].map(([file, pattern]) => {
    fs.accessSync(file, fs.constants.X_OK);
    const result = identity(file);
    const version = execFileSync(file, ['--version'], {env: environment, encoding: 'utf8'});
    check(pattern.test(version), `Unsupported tool version: ${file}: ${version.trim()}`);
    return {...result, version};
  });
  const builtins = fs.readdirSync(path.join(sdk, 'lib/clang')).map(version =>
    path.join(sdk, 'lib/clang', version, 'lib/wasi/libclang_rt.builtins-wasm32.a')).filter(file => fs.existsSync(file));
  check(builtins.length === 1, 'Expected one WASI compiler builtins library.');
  const sdkInputs = [...['include/wasm32-wasi/stdio.h', 'lib/wasm32-wasi/libc.a',
    'lib/wasm32-wasi/libm.a', 'lib/wasm32-wasi/crt1-reactor.o'].map(file =>
    path.join(sdk, 'share/wasi-sysroot', file)), ...builtins].map(identity);
  const receipt = {schema: 1, status: 'PENDING', profile: 'controlled-title',
    a1Fixtures: true, embeddedIwad: false, output: path.relative(root, out),
    inputsSha256: inputs(), tools, sdkInputs, startedUtc: new Date().toISOString(),
    configuration: {jobs: 2, wasiSdk: sdk, binaryenBin: binaryen,
      environment: {...environment, TMPDIR: path.join(out, 'tmp'), BINARYEN_CORES: '2'}},
    sources: {head: git(['rev-parse', 'HEAD']).trim(), status: git(['status', '--porcelain=v1'])}};
  fs.mkdirSync(out);
  fs.mkdirSync(path.join(out, 'evidence'));
  fs.mkdirSync(path.join(out, 'tmp'));
  fs.writeFileSync(path.join(out, 'evidence/local.patch'),
    git(['diff', 'HEAD', '--binary', '--no-ext-diff', '--no-textconv', '--', ...sources]), {flag: 'wx'});
  const file = path.join(out, 'evidence/manifest.json');
  write(file, receipt);
  // All fields are restricted paths/hex, so Bash can read this without parsing JSON.
  console.log([hash(fs.readFileSync(file)), sdk, binaryen].join('\t'));
}
function closeout(output, admission) {
  const out = outputPath(output);
  const receipt = manifest(out, 'PENDING');
  const file = path.join(out, 'evidence/manifest.json');
  check(hash(fs.readFileSync(file)) === admission, 'Pending admission changed.');
  const makePass = path.join(out, 'evidence/make-pass');
  regular(makePass);
  check(fs.readFileSync(makePass, 'utf8') === admission + '\n', 'Missing matching Make success marker.');
  const inspected = inspect(out);
  const final = identity(path.join(out, 'doom.wasm'));
  check(inspected.validate === true && inspected.instantiated === false && inspected.exportsCalled === false &&
    inspected.startSection === false && inspected.a1Fixtures === true &&
    inspected.bytes === final.bytes && inspected.sha256 === final.sha256, 'Invalid WASM inspection receipt.');
  check(receipt.inputsSha256 === inputs(), 'Engine inputs changed during build.');
  for (const {version, ...previous} of [...receipt.tools, ...receipt.sdkInputs]) {
    check(isDeepStrictEqual(identity(previous.invokedPath), previous),
      `Tool/SDK input changed during build: ${previous.invokedPath}`);
  }
  write(file, {...receipt, status: 'BUILD PASS', final: {bytes: final.bytes, sha256: final.sha256},
    interface: inspected});
  console.log(`Engine verified: ${out}; evidence: ${file}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'admit' && args.length === 3) admit(...args);
    else if (command === 'closeout' && args.length === 2) closeout(...args);
    else throw Error('Usage: build_engine.mjs admit output wasi-sdk binaryen-bin | closeout output admission');
  } catch (error) {
    console.error(`Engine build refused: ${error.message}`);
    process.exitCode = 1;
  }
}
