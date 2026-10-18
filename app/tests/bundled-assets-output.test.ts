// Offline source/staging/emission verification with real pinned gzip; no native engine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, it } from 'vitest';
import { stageFreedoom, verifyFreedoom } from '../../scripts/stage_web.mjs';
import identity from '../src/freedoom-identity.json';

let baselineTemporary, baseline;
beforeAll(() => {
  baselineTemporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doom-freedoom-baseline-')));
  baseline = path.join(baselineTemporary, 'public');
  stageFreedoom(baseline);
});
afterAll(() => {
  if (baselineTemporary) fs.rmSync(baselineTemporary, { recursive: true, force: true });
});

let temporary, source, target;
beforeEach(() => {
  temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doom-freedoom-test-')));
  source = path.join(temporary, 'source');
  target = path.join(temporary, 'public');
  fs.cpSync(new URL('../../third_party/freedoom/0.13.0/', import.meta.url), source, { recursive: true });
});
afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

it('rejects missing/changed gzip and notices in both public and dist', () => {
  fs.cpSync(baseline, target, { recursive: true });
  for (const directory of [target, path.join(temporary, 'dist')]) {
    if (directory !== target) fs.cpSync(target, directory, { recursive: true });
    for (const relative of [identity.gzip.path, ...identity.notices.map(n => 'notices/freedoom/' + n.name)]) {
      const file = path.join(directory, relative);
      const original = fs.readFileSync(file);
      fs.unlinkSync(file);
      assert.throws(() => verifyFreedoom(directory, source));
      const changed = Buffer.from(original); changed[0] ^= 1;
      fs.writeFileSync(file, changed);
      assert.throws(() => verifyFreedoom(directory, source), /hash mismatch/);
      fs.writeFileSync(file, original);
    }
    verifyFreedoom(directory, source);
  }
});
