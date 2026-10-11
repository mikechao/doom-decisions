// Source packaging/import checks only; no Worker or WASM execution.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes, createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Use the parser already locked with Vite, without adding a dependency.
const require = createRequire(new URL('../app/package.json', import.meta.url));
const {parseAst} = await import(pathToFileURL(require.resolve('rolldown/parseAst')).href);
const root = new URL('../app/', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const main = read('src/main.ts');
assert.equal((main.match(/new Worker\(/g) || []).length, 1, 'One app Worker constructor');
assert.match(main, /new Worker\(new URL\('\.\/worker\.ts', import\.meta\.url\),\s*\{\s*type: 'module',?\s*\}\)/);
assert.match(read('vite.config.js'), /worker:\s*\{\s*format: 'es'\s*\}/);
assert.match(read('index.html'), /worker-src 'self';/);

function visit(node, inspect) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') inspect(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, inspect));
    else if (value && typeof value === 'object') visit(value, inspect);
  }
}
for (const file of fs.readdirSync(new URL('src/', root)).filter(file => file.endsWith('.ts'))) {
  const source = read('src/' + file);
  assert.doesNotMatch(source, /\?raw|worker-boundary|worker-source|experiments\/|createObjectURL|new Blob\(/);
  const ast = parseAst(stripTypeScriptTypes(source));
  const imports = [];
  visit(ast, node => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) && node.source) {
      assert.equal(typeof node.source.value, 'string', 'Static module imports only');
      imports.push(node.source.value);
    }
  });
  assert.ok(imports.every(name => !/(?:^|\/)worker(?:\.ts)?(?:\?|$)/.test(name)),
    'Worker entry must only be loaded by its constructor');
  if (file === 'worker.ts') assert.deepEqual(imports, ['./worker-shared.ts']);
  if (file === 'worker-shared.ts') assert.deepEqual(imports, []);
}
console.log('Worker packaging static check PASS: module constructor, ES output, CSP and shared import boundary.');
