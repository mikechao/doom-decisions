// Static regression check for the raw-source lexical boundary; no native calls.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {classicWorkerSource} from '../app/src/worker-source.js';

const root = new URL('../', import.meta.url);
const raw = fs.readFileSync(new URL('app/src/worker-boundary.js', root), 'utf8');
assert.equal(raw, fs.readFileSync(new URL('experiments/m3-e3/worker-boundary.js', root), 'utf8'),
  'App Worker must retain the proven source verbatim');
const source = classicWorkerSource(raw);
new vm.Script(source); // Parse only; no Worker, WASM or titleWorker execution.
assert.ok(source.endsWith('\ntitleWorker();\n'));
assert.throws(() => classicWorkerSource(raw + '\nexport {};'));
assert.throws(() => classicWorkerSource(raw.replace('export {', 'export  {')));
console.log('Worker packaging static check PASS: exact copy, one export removal, classic payload parses.');
