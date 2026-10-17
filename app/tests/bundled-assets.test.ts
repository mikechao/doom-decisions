// Offline source/staging/emission verification with real pinned gzip; no native engine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, it } from 'vitest';
import { stageFreedoom, verifyFreedoom } from '../../scripts/stage_web.mjs';
import identity from '../src/freedoom-identity.json';

let temporary, source, target;
beforeEach(() => {
  temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doom-freedoom-test-')));
  source = path.join(temporary, 'source');
  target = path.join(temporary, 'public');
  fs.cpSync(new URL('../../third_party/freedoom/0.13.0/', import.meta.url), source, { recursive: true });
});
afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

it('stages only the pinned gzip/notices and verifies identical source/public/dist bytes', () => {
  stageFreedoom(target, source);
  const dist = path.join(temporary, 'dist');
  fs.cpSync(target, dist, { recursive: true }); // Vite's static copy boundary, no Vite/native execution.
  for (const directory of [target, dist]) {
    verifyFreedoom(directory, source);
    assert.deepEqual(fs.readFileSync(path.join(directory, identity.gzip.path)), fs.readFileSync(path.join(source, 'freedoom1.wad.gz')));
    for (const notice of identity.notices) assert.deepEqual(
      fs.readFileSync(path.join(directory, 'notices/freedoom', notice.name)),
      fs.readFileSync(path.join(source, notice.name)),
    );
  }
  assert.deepEqual(fs.readdirSync(path.join(target, 'iwads')), ['freedoom1.wad.gz']);
  assert.ok(identity.gzip.bytes < 25 * 1024 * 1024);
});

for (const fault of ['missing', 'corrupt', 'truncated', 'directory', 'symlink']) {
  it(`rejects ${fault} source gzip before staging`, () => {
    const file = path.join(source, 'freedoom1.wad.gz');
    const original = fs.readFileSync(file);
    fs.unlinkSync(file);
    if (fault === 'corrupt') { original[100] ^= 1; fs.writeFileSync(file, original); }
    if (fault === 'truncated') fs.writeFileSync(file, original.subarray(0, -1));
    if (fault === 'directory') fs.mkdirSync(file);
    if (fault === 'symlink') { fs.writeFileSync(path.join(temporary, 'other.gz'), original); fs.symlinkSync(path.join(temporary, 'other.gz'), file); }
    assert.throws(() => stageFreedoom(target, source));
    assert.equal(fs.existsSync(target), false);
  });
}

for (const relative of ['other.wad', 'nested/OTHER.WAD', 'other.wad.gz', 'nested/freedoom1.wad.gz', 'iwads/FREEDOOM1.WAD.GZ']) {
  it(`rejects unexpected static asset ${relative}`, () => {
    stageFreedoom(target, source);
    const file = path.join(target, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Create the uppercase directory entry even on case-insensitive filesystems.
    if (relative === 'iwads/FREEDOOM1.WAD.GZ') fs.unlinkSync(path.join(target, identity.gzip.path));
    fs.writeFileSync(file, 'unexpected');
    assert.throws(() => verifyFreedoom(target, source), /Raw IWAD|Unexpected compressed IWAD/);
    assert.throws(() => stageFreedoom(target, source), /Raw IWAD|Unexpected compressed IWAD/);
  });
}

it('rejects missing/changed gzip and notices in both public and dist', () => {
  stageFreedoom(target, source);
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

it('rejects changed source notices, extra source WADs and symlinks', () => {
  const notice = path.join(source, 'COPYING.txt');
  const original = fs.readFileSync(notice);
  const changed = Buffer.from(original); changed[0] ^= 1;
  fs.writeFileSync(notice, changed);
  assert.throws(() => stageFreedoom(target, source), /hash mismatch/);
  fs.writeFileSync(notice, original);
  const extra = path.join(source, 'alternate.wad.gz');
  fs.writeFileSync(extra, 'extra');
  assert.throws(() => stageFreedoom(target, source), /Unexpected compressed IWAD/);
  fs.unlinkSync(extra);
  stageFreedoom(target, source);
  fs.symlinkSync(source, path.join(target, 'linked'));
  assert.throws(() => verifyFreedoom(target, source), /symlinks/);
});
