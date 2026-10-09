// Static inspection of the pinned upstream-shareware interface. Never instantiate.
import fs from 'node:fs';
import crypto from 'node:crypto';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 4096;
const fail = message => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); };
const valueTypes = new Map([[127, 'i32'], [126, 'i64'], [125, 'f32'],
  [124, 'f64'], [112, 'funcref']]);

// Only bounded core metadata sections are decoded; code/data are opaque.
// Unsupported types/limits/constant expressions fail instead of being guessed.
class Metadata {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  take(count) {
    check(count >= 0 && this.offset + count <= this.bytes.length, 'Truncated metadata');
    const result = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return result;
  }
  byte() { return this.take(1)[0]; }
  uint(signed = false) {
    let result = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.byte();
      if (i === 4) check(signed ? (byte & 112) === 0 || (byte & 112) === 112 : byte < 16,
        'Unsupported integer width');
      result += (byte & 127) * 2 ** (7 * i);
      if (byte < 128) {
        if (signed && (byte & 64)) result -= 2 ** (7 * (i + 1));
        return result;
      }
    }
    fail('Oversized LEB integer');
  }
  count() { const n = this.uint(); check(n <= MAX_ITEMS, 'Metadata item limit'); return n; }
  name() {
    const n = this.uint(); check(n <= 1024, 'Metadata name limit');
    return new TextDecoder('utf-8', {fatal: true}).decode(this.take(n));
  }
  type() { const type = valueTypes.get(this.byte()); check(type, 'Unsupported value type'); return type; }
  limits() {
    const flags = this.uint(); check(flags === 0 || flags === 1, 'Unsupported shared/memory64 limits');
    return {minimum: this.uint(), maximum: flags ? this.uint() : null};
  }
  global() {
    const type = this.type(); const mutable = this.byte();
    check(mutable <= 1 && type === 'i32', 'Unsupported global metadata');
    check(this.byte() === 65, 'Unsupported global initializer');
    const value = this.uint(true); check(this.byte() === 11, 'Unsupported constant expression');
    return {type, mutable: Boolean(mutable), initializer: value};
  }
}

const expectedImports = new Map([
  ['console.onErrorMessage', [['i32', 'i32'], []]],
  ['console.onInfoMessage', [['i32', 'i32'], []]],
  ['gameSaving.writeSaveGame', [['i32', 'i32', 'i32'], ['i32']]],
  ['gameSaving.readSaveGame', [['i32', 'i32'], ['i32']]],
  ['gameSaving.sizeOfSaveGame', [['i32'], ['i32']]],
  ['runtimeControl.timeInMilliseconds', [[], ['i64']]],
  ['ui.drawFrame', [['i32'], []]],
  ['loading.readWads', [['i32', 'i32'], []]],
  ['loading.wadSizes', [['i32', 'i32'], []]],
  ['loading.onGameInit', [['i32', 'i32'], []]],
]);
const coreExports = new Map([
  ['initGame', [[], []]], ['tickGame', [[], []]],
  ['reportKeyDown', [['i32'], []]], ['reportKeyUp', [['i32'], []]],
]);
const keys = new Map([
  ['KEY_LEFTARROW', 172], ['KEY_RIGHTARROW', 174], ['KEY_UPARROW', 173],
  ['KEY_DOWNARROW', 175], ['KEY_STRAFE_L', 160], ['KEY_STRAFE_R', 161],
  ['KEY_FIRE', 163], ['KEY_USE', 162], ['KEY_SHIFT', 182], ['KEY_TAB', 9],
  ['KEY_ESCAPE', 27], ['KEY_ENTER', 13], ['KEY_BACKSPACE', 127], ['KEY_ALT', 184],
]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function inspect(bytes) {
  check(WebAssembly.validate(bytes), 'WebAssembly.validate failed');
  const module = new WebAssembly.Module(bytes); // Compilation only; no instance/start.
  const r = new Metadata(bytes);
  check(r.take(8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])), 'Invalid WASM header');
  const types = [], functions = [], imports = [], exports = [], memories = [], tables = [], globals = [];
  while (r.offset < bytes.length) {
    const id = r.byte(); const section = new Metadata(r.take(r.uint()));
    if (id === 8) fail('Unexpected start section');
    if (id < 1 || id > 7) continue;
    const count = section.count();
    for (let i = 0; i < count; i++) {
      if (id === 1) {
        check(section.byte() === 96, 'Unsupported function type');
        const params = Array.from({length: section.count()}, () => section.type());
        const results = Array.from({length: section.count()}, () => section.type());
        types.push([params, results]);
      } else if (id === 2) {
        const module = section.name(), name = section.name();
        check(section.byte() === 0, 'Unexpected non-function import');
        const type = section.uint(); functions.push(type);
        imports.push({module, name, kind: 'function', signature: types[type]});
      } else if (id === 3) functions.push(section.uint());
      else if (id === 4) tables.push({elementType: section.type(), ...section.limits()});
      else if (id === 5) {
        const limits = section.limits();
        memories.push({...limits, shared: false, addressType: 'i32',
          unit: '65536-byte pages', initialBytes: limits.minimum * 65536});
      }
      else if (id === 6) globals.push(section.global());
      else {
        const name = section.name(), kind = ['function', 'table', 'memory', 'global'][section.byte()];
        check(kind, 'Unsupported export kind'); exports.push({name, kind, index: section.uint()});
      }
    }
    check(section.offset === section.bytes.length, 'Trailing metadata bytes');
  }
  for (const item of exports) {
    item.details = item.kind === 'function' ? types[functions[item.index]]
      : {memory: memories, table: tables, global: globals}[item.kind][item.index];
    check(item.details !== undefined, 'Missing export metadata');
  }
  check(same(imports.map(({module, name, kind}) => ({module, name, kind})),
    WebAssembly.Module.imports(module)), 'Import metadata disagreement');
  check(same(exports.map(({name, kind}) => ({name, kind})),
    WebAssembly.Module.exports(module)), 'Export metadata disagreement');
  check(imports.length === expectedImports.size &&
    new Set(imports.map(x => `${x.module}.${x.name}`)).size === expectedImports.size,
  'Unexpected import count/duplicates');
  for (const item of imports) check(same(item.signature, expectedImports.get(`${item.module}.${item.name}`)),
    `Unexpected import/signature: ${item.module}.${item.name}`);
  check(exports.length === 19, 'Expected four functions, memory and fourteen key globals');
  for (const [name, signature] of coreExports) {
    const item = exports.find(x => x.name === name);
    check(item?.kind === 'function' && same(item.details, signature), `Unexpected core export: ${name}`);
  }
  check(exports.find(x => x.name === 'memory')?.kind === 'memory' && memories.length === 1,
    'Expected one exported memory');
  for (const [name, value] of keys) {
    const item = exports.find(x => x.name === name);
    check(item?.kind === 'global' && item.details.type === 'i32' && !item.details.mutable &&
      item.details.initializer === value, `Unexpected key global: ${name}`);
  }
  return {validate: true, instantiated: false, exportsCalled: false, startSection: false,
    imports, exports, memories, tables, globals,
    typedMetadataScope: 'Bounded WASM core sections 1–7; unsupported forms rejected; code/data opaque'};
}

try {
  check(process.argv.length === 3, 'Usage: node scripts/inspect_doom.mjs final.wasm');
  const path = process.argv[2];
  check(fs.statSync(path).size <= MAX_BYTES, 'Final module exceeds 16 MiB inspection limit');
  const bytes = fs.readFileSync(path);
  check(bytes.length <= MAX_BYTES, 'Final module grew beyond inspection limit');
  console.log(JSON.stringify({profile: 'upstream-shareware', bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), ...inspect(bytes)}, null, 2));
} catch (error) {
  console.error(`Static inspection failed: ${error.message}`);
  process.exitCode = 1;
}
