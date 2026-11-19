// Real MCP stdio children, isolated SQLite files, and a fail-on-use fetch.
// No browser, Doom, provider, game asset, or network listener.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { it } from 'vitest';
import { initializeMemoryDatabase, memoryDatabasePath, readMemoryReferencePng, recordMemory } from '../doom-memory.mjs';
import { memoryFixturePng, memoryFixtureRecognition } from './fixtures/doom-memory.ts';

const serverPath = fileURLToPath(new URL('../agent-mcp.mjs', import.meta.url));
const mapKey = (digit: string) => `doom-map:v1:iwad-sha256:${digit.repeat(64)}:E1M1`;
const mapNamespace = mapKey('1');
const referencePng = memoryFixturePng();
const a = { mapNamespace, x: 71761920, y: -194576384, angle: 0xf0000000 };
const d = { mapNamespace, x: 73662464, y: -195428352, angle: 0x10000000 };
const seed = {
  operation: 'create', requestId: 'seed-a', ...a,
  source: 'Run A, decision 22, tic 133; docs/navigation/doom1-e1m1-session-01a179df.md; archived Codex visual interpretation',
  hypothesis: 'The apparent recess beside the tan column might continue beyond the pool room; traversability is unverified.',
  nextQuestion: 'Does a clearer view reveal continuous player-width floor beyond the wall end?',
  recognition: memoryFixtureRecognition(referencePng),
};
// Synthetic canonical namespace only; these tests do not verify a live map.
const activeQuery = {
  mode: 'active-landmarks',
  mapNamespace: mapKey('a'),
};
const activeSeed = {
  ...seed, mapNamespace: activeQuery.mapNamespace, requestId: 'landmark',
  x: 211, y: 0, angle: 90,
  isLandmark: true, isActiveExploration: true,
};

async function create(database: string, input: unknown = seed, png = referencePng) {
  const previous = process.env.DOOM_MEMORY_DB;
  process.env.DOOM_MEMORY_DB = database;
  try {
    return await recordMemory(input, png);
  } finally {
    if (previous === undefined) delete process.env.DOOM_MEMORY_DB;
    else process.env.DOOM_MEMORY_DB = previous;
  }
}

const appendProbe = {
  operation: 'append', requestId: 'append-probe', noteId: '11111111-1111-4111-8111-111111111111',
  expectedRevision: 1, source: 'Synthetic fixture', assessment: 'Schema probe',
};

it('round-trips raw telemetry unchanged and rejects fractional, out-of-range and degree-field inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-memory-raw-'));
  const database = join(directory, 'memory.sqlite');
  try {
    await withServer(database, directory, async client => {
      for (const invalid of [
        { x: -2147483649 }, { x: 2147483648 }, { x: 1.5 },
        { y: -2147483649 }, { y: 2147483648 }, { y: -1.5 },
        { angle: -1 }, { angle: 4294967296 }, { angle: 0.5 },
        { headingDeg: 90 },
      ]) {
        await rejects(client, 'doom_memory_find', { ...a, ...invalid });
        await assert.rejects(create(database, { ...seed, ...invalid }));
      }
      assert.equal(existsSync(database), false);
      const raw = { x: -2147483648, y: 2147483647, angle: 0xffffffff };
      const created = await create(database, { ...seed, ...raw });
      const found = await invoke(client, 'doom_memory_find', { ...a, ...raw });
      assert.equal(found.candidates.length, 1);
      assert.equal(found.candidates[0].noteId, created.noteId);
      assert.deepEqual(found.candidates[0].anchor, raw);
      assert.equal(found.candidates[0].distance, 0);
      assert.equal(found.candidates[0].angleDifference, 0);
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(database, { readOnly: true });
      try {
        assert.deepEqual({ ...db.prepare('SELECT x, y, angle FROM notes').get() }, raw);
      } finally { db.close(); }
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 10000);

async function withServer(databasePath, directory, work) {
  const preload = join(directory, 'no-network.mjs');
  const networkLog = join(directory, 'unexpected-network.txt');
  await writeFile(preload, `
    import { appendFileSync } from 'node:fs';
    globalThis.fetch = () => {
      appendFileSync(${JSON.stringify(networkLog)}, 'unexpected fetch\\n');
      throw Error('Offline test forbids network');
    };
  `);
  const child = spawn(process.execPath, ['--import', preload, serverPath], {
    // Deliberately outside the repository; database selection is cwd-independent.
    cwd: directory, env: { DOOM_MEMORY_DB: databasePath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'offline-memory', version: '1' }, {
    versionNegotiation: { mode: 'legacy' },
  });
  try {
    await client.connect(new StdioServerTransport(child.stdout, child.stdin));
    await work(client, child.pid, () => stderr);
    await client.close(); child.stdin.end();
    const [code] = await exit;
    assert.equal(code, 0, stderr);
    assert.equal(existsSync(networkLog), false, 'Memory must not call fetch');
    assert.doesNotMatch(stderr.replace(/\(node:\d+\) ExperimentalWarning: SQLite[^\n]*\n|\(Use `node --trace-warnings[^\n]*\n/g, ''), /\S/);
  } finally {
    await client.close().catch(() => {});
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exit;
  }
}

async function invoke(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}

async function rejects(client, name, args, error) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true);
  if (error) assert.deepEqual(result.structuredContent, { error });
}

it('requires complete recognition evidence before creating storage and verifies immutable PNG sidecars', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-memory-reference-'));
  const database = join(directory, 'memory.sqlite');
  const { reference } = seed.recognition;
  const { pngSha256 } = reference;
  const path = join(`${database}.refs`, `${pngSha256}.png`);
  try {
    const { recognition: _recognition, ...oldCreate } = seed;
    const { nextQuestion: _question, ...withoutQuestion } = seed;
    for (const input of [oldCreate, withoutQuestion, { ...seed, nextQuestion: ' \t' },
      { ...seed, mapNamespace: `${mapNamespace}\n` },
      { ...seed, recognition: { ...seed.recognition, reference: { ...seed.recognition.reference, pngSha256: `${pngSha256}\n` } } },
      { ...seed, recognition: { ...seed.recognition, geometry: { ...seed.recognition.geometry, segments: [] } } },
    ]) await assert.rejects(create(database, input));
    const truncated = referencePng.subarray(0, 33);
    await assert.rejects(create(database, { ...seed, recognition: memoryFixtureRecognition(truncated) }, truncated), /memory-reference-invalid/);
    const brokenIdat = memoryFixturePng(0, undefined, Buffer.from('invalid compressed payload'));
    await assert.rejects(create(database, { ...seed, recognition: memoryFixtureRecognition(brokenIdat) }, brokenIdat), /memory-reference-invalid/);
    const wrongPixels = memoryFixturePng(1);
    await assert.rejects(create(database, { ...seed, recognition: memoryFixtureRecognition(wrongPixels) }, wrongPixels), /memory-reference-invalid/);
    await assert.rejects(create(database, seed, Buffer.alloc(0)), /memory-reference-invalid/);
    // No host-only PNG argument. A fully formed JSON create cannot provide it.
    const previous = process.env.DOOM_MEMORY_DB;
    process.env.DOOM_MEMORY_DB = database;
    try {
      await assert.rejects(Reflect.apply(recordMemory, undefined, [seed]), /memory-reference-invalid/);
    } finally {
      if (previous === undefined) delete process.env.DOOM_MEMORY_DB;
      else process.env.DOOM_MEMORY_DB = previous;
    }
    assert.equal(existsSync(database), false);
    assert.equal(existsSync(`${database}.refs`), false);

    await create(database);
    assert.deepEqual(await readFile(path), referencePng);
    const resolved = readMemoryReferencePng(reference, database);
    assert.deepEqual(resolved, referencePng);
    assert.deepEqual([resolved.readUInt32BE(16), resolved.readUInt32BE(20)], [640, 400]);
    assert.throws(() => readMemoryReferencePng({ ...reference, pngSha256: 'f'.repeat(64) }, database), /memory-reference-missing/);
    const wrongImage = memoryFixturePng(1);
    await writeFile(path, wrongImage);
    assert.throws(() => readMemoryReferencePng(reference, database), /memory-reference-invalid/);
    const before = await readFile(database);
    await assert.rejects(create(database, { ...seed, requestId: 'second-create' }), /memory-reference-invalid/);
    await assert.rejects(create(database), /memory-reference-invalid/);
    assert.deepEqual(await readFile(path), wrongImage);
    assert.deepEqual(await readFile(database), before);
    await rm(path);
    assert.throws(() => readMemoryReferencePng(reference, database), /memory-reference-missing/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects a symlinked reference directory for both resolution and publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-memory-symlink-'));
  const database = join(directory, 'memory.sqlite');
  const external = join(directory, 'other-notebook');
  const { reference } = seed.recognition;
  const filename = `${reference.pngSha256}.png`;
  try {
    await initializeMemoryDatabase(database);
    await mkdir(external);
    await symlink(external, `${database}.refs`, 'dir');
    const externalPng = join(external, filename);
    await writeFile(externalPng, referencePng);
    assert.throws(() => readMemoryReferencePng(reference, database), /memory-reference-invalid/);
    const before = await readFile(database);
    await assert.rejects(create(database), /memory-reference-invalid/);
    assert.deepEqual(await readFile(externalPng), referencePng);
    await rm(externalPng);
    await assert.rejects(create(database), /memory-reference-invalid/);
    assert.deepEqual(await readdir(external), []);
    assert.deepEqual(await readFile(database), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('rolls back the note when its receipt fails after PNG publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-memory-rollback-'));
  const database = join(directory, 'memory.sqlite');
  try {
    await initializeMemoryDatabase(database);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(database);
    try {
      db.exec(`CREATE TRIGGER fail_create_receipt BEFORE INSERT ON entries
        BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END`);
      await assert.rejects(create(database), /synthetic receipt failure/);
      assert.deepEqual(readMemoryReferencePng(seed.recognition.reference, database), referencePng);
      assert.equal(db.prepare('SELECT count(*) AS count FROM notes').get().count, 0);
      assert.equal(db.prepare('SELECT count(*) AS count FROM entries').get().count, 0);
      db.exec('DROP TRIGGER fail_create_receipt');
      const receipt = await create(database);
      assert.equal(receipt.replayed, false);
      assert.equal(db.prepare('SELECT count(*) AS count FROM entries WHERE note_id = ?').get(receipt.noteId).count, 1);
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('finds and reconciles one advisory regional note across three independent MCP processes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-memory-mcp-'));
  const storage = join(directory, 'storage');
  const database = join(storage, 'memory.sqlite');
  const pids = [];
  let created;
  const append = {
    operation: 'append', requestId: 'later-assessment', expectedRevision: 1,
    source: 'Offline acceptance examination; no gameplay was performed',
    assessment: 'Later examination is inconclusive; passage still not established.',
  };
  try {
    await withServer(database, directory, async (client, pid, stderr) => {
      pids.push(pid);
      const catalog = await client.listTools();
      assert.equal(catalog.tools.length, 10);
      assert.deepEqual(catalog.tools.filter(tool => tool.name.startsWith('doom_memory_')).map(tool => tool.name).sort(),
        ['doom_memory_find', 'doom_memory_record']);
      assert.equal(existsSync(storage), false);
      const empty = await invoke(client, 'doom_memory_find', a);
      assert.deepEqual(empty.candidates, []);
      assert.match(empty.caution, /unverified/);
      assert.equal(existsSync(storage), false, 'Find must not create even the directory');
      assert.equal(stderr(), '', 'Missing lookup must not load SQLite');
      const { recognition: _recognition, ...oldCreate } = seed;
      await rejects(client, 'doom_memory_record', oldCreate);
      await rejects(client, 'doom_memory_record', seed);
      await rejects(client, 'doom_memory_record', {
        ...append, noteId: '11111111-1111-4111-8111-111111111111',
      }, 'memory-note-not-found');
      assert.equal(existsSync(storage), false, 'Rejected records must not initialize storage');
      created = await create(database);
      assert.equal(created.revision, 1); assert.equal(created.status, 'unverified');
      assert.equal(created.replayed, false);
      assert.equal(existsSync(database), true);
    });

    await withServer(database, directory, async (client, pid) => {
      pids.push(pid);
      // No historical session ID or note ID is part of either lookup.
      const foundA = await invoke(client, 'doom_memory_find', a);
      const note = foundA.candidates[0];
      assert.equal(foundA.candidates.length, 1);
      assert.equal(note.noteId, created.noteId);
      assert.equal(note.distance, 0); assert.equal(note.angleDifference, 0);
      assert.equal(note.source, seed.source); assert.equal(note.hypothesis, seed.hypothesis);
      assert.equal(note.nextQuestion, seed.nextQuestion);
      assert.deepEqual(note.recognition, seed.recognition);
      assert.equal(note.mapNamespace, mapNamespace); assert.equal(note.status, 'unverified');
      assert.equal(note.isLandmark, false); assert.equal(note.isActiveExploration, false);
      assert.deepEqual(note.entries, []);
      assert.match(foundA.caution, /does not authenticate/);
      assert.match(foundA.caution, /same viewpoint/);

      const foundD = await invoke(client, 'doom_memory_find', d);
      assert.equal(foundD.candidates.length, 1);
      assert.equal(foundD.candidates[0].noteId, created.noteId);
      assert.ok(foundD.candidates[0].distance === Math.hypot(a.x - d.x, a.y - d.y));
      assert.equal(foundD.candidates[0].angleDifference, 0x20000000);
      assert.equal(foundD.candidates[0].status, 'unverified');
      console.info(JSON.stringify({ a: { distance: note.distance, angleDifference: note.angleDifference },
        d: { distance: foundD.candidates[0].distance, angleDifference: foundD.candidates[0].angleDifference },
        status: note.status }));

      for (const query of [
        { ...a, x: a.x + 8388608 },
        { ...a, x: a.x + 4194304, y: a.y + 4194304 },
        { ...a, mapNamespace: mapKey('f') },
      ]) assert.deepEqual((await invoke(client, 'doom_memory_find', query)).candidates, []);
      assert.equal((await invoke(client, 'doom_memory_find', { ...a, x: a.x + 4194304 })).candidates.length, 1);
      for (const invalid of [{ radius: 0 }, { radius: 67108865 }, { limit: 11 }, { angle: 4294967296 }, { x: 2147483648 }, { status: 'verified_traversed' }])
        await rejects(client, 'doom_memory_find', { ...a, ...invalid });

      const replay = await create(database);
      assert.deepEqual(replay, { ...created, replayed: true });
      await assert.rejects(create(database, { ...seed, hypothesis: 'Different claim' }), /memory-request-conflict/);
      const entry = { ...append, noteId: created.noteId };
      const added = await invoke(client, 'doom_memory_record', entry);
      assert.equal(added.revision, 2); assert.equal(added.replayed, false);
      // Equivalent JSON key order still identifies the same request.
      const reordered = Object.fromEntries(Object.entries(entry).reverse());
      assert.deepEqual(await invoke(client, 'doom_memory_record', reordered), { ...added, replayed: true });
      await rejects(client, 'doom_memory_record', { ...entry, requestId: 'stale' }, 'memory-revision-conflict');
      await rejects(client, 'doom_memory_record', { ...entry, assessment: 'Conflicting reuse' }, 'memory-request-conflict');
      await rejects(client, 'doom_memory_record', { ...entry, requestId: 'seed-a' }, 'memory-request-conflict');
      await rejects(client, 'doom_memory_record', { ...entry, status: 'verified_traversed' });
    });

    await withServer(database, directory, async (client, pid) => {
      pids.push(pid);
      const note = (await invoke(client, 'doom_memory_find', a)).candidates[0];
      assert.equal(note.revision, 2); assert.equal(note.hypothesis, seed.hypothesis);
      assert.equal(note.source, seed.source); assert.equal(note.status, 'unverified');
      assert.equal(note.entries.length, 1);
      assert.equal(note.entries[0].source, append.source);
      assert.equal(note.entries[0].assessment, append.assessment);
      assert.equal(note.entries[0].revision, 2);
      assert.ok(Number.isFinite(Date.parse(note.entries[0].createdAt)));
      // Free text is never parsed into an authoritative status.
      await invoke(client, 'doom_memory_record', { ...append, noteId: note.noteId,
        requestId: 'text-only', expectedRevision: 2,
        assessment: 'A person calls this verified traversed; that assertion is advisory and unverified here.' });
      const final = (await invoke(client, 'doom_memory_find', a)).candidates[0];
      assert.equal(final.status, 'unverified'); assert.equal(final.revision, 3);
      assert.deepEqual(final.entries.map(entry => entry.revision), [2, 3]);
      assert.equal(final.hypothesis, seed.hypothesis);
      assert.deepEqual(await create(database), { ...created, replayed: true });
    });
    assert.equal(new Set(pids).size, 3);
    console.info(`SQLite memory persistence: distinct MCP PIDs ${pids.join(', ')}; create r1 → reopened append r2 → reopened retrieval; all unverified.`);
    assert.equal(existsSync(`${database}-wal`), false);
    assert.equal(existsSync(`${database}-shm`), false);
    assert.equal(existsSync(`${database}-journal`), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);

it('discovers a distant active landmark and its evidence across three independent processes without pose or known ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-memory-landmark-'));
  const storage = join(directory, 'storage');
  const database = join(storage, 'memory.sqlite');
  const pids = [];
  let created;
  try {
    await withServer(database, directory, async (client, pid, stderr) => {
      pids.push(pid);
      const empty = await invoke(client, 'doom_memory_find', activeQuery);
      assert.deepEqual(empty, { ...activeQuery, caution: empty.caution, candidates: [], hasMore: false });
      assert.equal(existsSync(storage), false);
      assert.equal(stderr(), '');
      created = await create(database, activeSeed);
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(database, { readOnly: true });
      try {
        assert.deepEqual({ ...db.prepare('SELECT is_landmark, is_active_exploration FROM entries WHERE revision = 1').get() },
          { is_landmark: 1, is_active_exploration: 1 });
      } finally { db.close(); }
    });
    await withServer(database, directory, async (client, pid) => {
      pids.push(pid);
      const found = await invoke(client, 'doom_memory_find', activeQuery);
      assert.equal(found.hasMore, false);
      assert.equal(found.candidates.length, 1);
      const note = found.candidates[0];
      assert.equal(note.noteId, created.noteId);
      assert.equal(note.revision, 1);
      assert.deepEqual(note.anchor, { x: 211, y: 0, angle: 90 });
      assert.equal(note.isLandmark, true); assert.equal(note.isActiveExploration, true);
      assert.equal('distance' in note, false); assert.equal('angleDifference' in note, false);
      assert.deepEqual(note.entries, []);
      const nearby = await invoke(client, 'doom_memory_find', {
        mapNamespace: activeQuery.mapNamespace, x: 0, y: 0, angle: 0, radius: 128,
      });
      assert.deepEqual(nearby.candidates, []);
      const appended = await invoke(client, 'doom_memory_record', {
        operation: 'append', requestId: 'bounded-attempt', noteId: note.noteId, expectedRevision: note.revision,
        assessment: 'Attempt: rightward approach. Observed result: target not reached in this bounded attempt. Limits: route remains unproven. Suggested next experiment: seek a clearer left-side sightline.',
        source: 'Synthetic session B observation; no gameplay performed',
        flags: { isLandmark: true, isActiveExploration: true },
      });
      assert.equal(appended.revision, 2);
    });
    await withServer(database, directory, async (client, pid) => {
      pids.push(pid);
      const note = (await invoke(client, 'doom_memory_find', activeQuery)).candidates[0];
      assert.equal(note.noteId, created.noteId); assert.equal(note.revision, 2);
      assert.equal(note.hypothesis, activeSeed.hypothesis);
      assert.equal(note.nextQuestion, activeSeed.nextQuestion);
      assert.equal(note.source, activeSeed.source);
      assert.match(note.entries[0].assessment, /not reached in this bounded attempt/);
      assert.equal(note.entries[0].source, 'Synthetic session B observation; no gameplay performed');
      assert.equal(note.entries[0].isLandmark, true); assert.equal(note.entries[0].isActiveExploration, true);
      assert.ok(Number.isFinite(Date.parse(note.entries[0].createdAt)));
      await invoke(client, 'doom_memory_record', {
        operation: 'append', requestId: 'follow-up', noteId: note.noteId, expectedRevision: note.revision,
        assessment: 'Prior rightward test was inconclusive; a clearer sightline is the next suggested test, not proof of a route.',
        source: 'Synthetic session C; no gameplay performed',
      });
      const updated = (await invoke(client, 'doom_memory_find', activeQuery)).candidates[0];
      assert.equal(updated.revision, 3);
      assert.deepEqual(updated.entries.map(entry => entry.revision), [2, 3]);
      assert.ok(updated.entries.every(entry => entry.isLandmark && entry.isActiveExploration));
    });
    assert.equal(new Set(pids).size, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 20000);

it('validates flag pairs in MCP and SQLite and preserves atomic revisioned transitions, conflicts and replays', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-memory-flags-'));
  const database = join(directory, 'memory.sqlite');
  try {
    await withServer(database, directory, async client => {
      for (const invalid of [
        { isLandmark: false, isActiveExploration: true }, { isActiveExploration: true },
        { isLandmark: 1 }, { isLandmark: 'true' }, { isActiveExploration: null },
      ]) await assert.rejects(create(database, { ...seed, ...invalid }));
      assert.equal(existsSync(database), false);
      const created = await create(database);
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(database);
      try {
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
        assert.equal(db.prepare('PRAGMA application_id').get().application_id, 0x444f4f4d);
        for (const table of ['notes', 'entries']) {
          assert.deepEqual({ ...db.prepare(`SELECT is_landmark, is_active_exploration FROM ${table}`).get() },
            { is_landmark: 0, is_active_exploration: 0 });
          for (const pair of [[0, 1], [2, 0], [-1, 0], [1, 2], [null, 0], [1, null], ['true', 0]])
            assert.throws(() => db.prepare(`UPDATE ${table} SET is_landmark = ?, is_active_exploration = ?`).run(...pair));
        }
      } finally { db.close(); }
      const append = {
        operation: 'append', noteId: created.noteId, expectedRevision: 1,
        requestId: 'invalid-flags', assessment: 'Attributed flag change', source: 'Offline flags test',
      };
      for (const flags of [
        {}, { isLandmark: true }, { isActiveExploration: false },
        { isLandmark: false, isActiveExploration: true },
        { isLandmark: 1, isActiveExploration: false },
        { isLandmark: true, isActiveExploration: 'true' },
        { isLandmark: true, isActiveExploration: false, extra: true },
      ]) await rejects(client, 'doom_memory_record', { ...append, flags });
      await rejects(client, 'doom_memory_record', { ...append, assessment: '', flags: { isLandmark: true, isActiveExploration: true } });
      const transitions = [
        { isLandmark: true, isActiveExploration: false }, // promotion
        { isLandmark: true, isActiveExploration: true }, // activation
        undefined, // preservation
        { isLandmark: true, isActiveExploration: false }, // deactivation
        { isLandmark: true, isActiveExploration: true }, // reopening
        { isLandmark: false, isActiveExploration: false }, // explicit downgrade
      ];
      let firstWrite;
      let firstReceipt;
      for (const [index, flags] of transitions.entries()) {
        const write = { ...append, requestId: `transition-${index}`, expectedRevision: index + 1,
          ...(flags === undefined ? {} : { flags }) };
        const receipt = await invoke(client, 'doom_memory_record', write);
        if (index === 0) { firstWrite = write; firstReceipt = receipt; }
        const note = (await invoke(client, 'doom_memory_find', a)).candidates[0];
        const effective = flags ?? transitions[index - 1];
        assert.equal(note.revision, index + 2);
        assert.equal(note.isLandmark, effective.isLandmark);
        assert.equal(note.isActiveExploration, effective.isActiveExploration);
        const active = await invoke(client, 'doom_memory_find', { mode: 'active-landmarks', mapNamespace });
        assert.deepEqual(active.candidates.map(candidate => candidate.noteId), effective.isActiveExploration ? [created.noteId] : []);
        assert.equal(note.hypothesis, seed.hypothesis); assert.equal(note.nextQuestion, seed.nextQuestion);
        assert.equal(note.source, seed.source);
        assert.deepEqual(note.anchor, { x: a.x, y: a.y, angle: a.angle });
        assert.deepEqual(note.entries.map(entry => entry.revision), Array.from({ length: index + 1 }, (_, i) => i + 2));
        assert.deepEqual(note.entries.map(entry => [entry.isLandmark, entry.isActiveExploration]),
          transitions.slice(0, index + 1).map((pair, i) => {
            const snapshot = pair ?? transitions[i - 1];
            return [snapshot.isLandmark, snapshot.isActiveExploration];
          }));
      }
      await rejects(client, 'doom_memory_record', {
        ...firstWrite, flags: { isLandmark: true, isActiveExploration: true },
      }, 'memory-request-conflict');
      await rejects(client, 'doom_memory_record', { ...firstWrite, requestId: 'stale-flags' }, 'memory-revision-conflict');
      assert.deepEqual(await invoke(client, 'doom_memory_record', firstWrite), { ...firstReceipt, replayed: true });
      assert.deepEqual(await create(database, { ...seed, isLandmark: false, isActiveExploration: false }),
        { ...created, replayed: true });
      let note = (await invoke(client, 'doom_memory_find', a)).candidates[0];
      assert.equal(note.revision, 7); assert.equal(note.isLandmark, false); assert.equal(note.isActiveExploration, false);
      await withServer(database, directory, async competitor => {
        const writes = [
          { ...append, requestId: 'competitor-a', expectedRevision: note.revision,
            flags: { isLandmark: true, isActiveExploration: true } },
          { ...append, requestId: 'competitor-b', expectedRevision: note.revision,
            flags: { isLandmark: true, isActiveExploration: false } },
        ];
        const results = await Promise.all([client, competitor].map((connection, i) =>
          connection.callTool({ name: 'doom_memory_record', arguments: writes[i] })));
        assert.equal(results.filter(result => result.isError === false).length, 1);
        assert.deepEqual(results.find(result => result.isError).structuredContent, { error: 'memory-revision-conflict' });
        const winner = results.findIndex(result => result.isError === false);
        note = (await invoke(client, 'doom_memory_find', a)).candidates[0];
        assert.equal(note.revision, 8); assert.equal(note.entries.length, 7);
        assert.equal(note.isActiveExploration, writes[winner].flags.isActiveExploration);
        assert.equal(note.entries.at(-1).isActiveExploration, note.isActiveExploration);
      });
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 20000);

it('bounds active discovery by exact namespace and deterministic creation order while retaining nearby ordering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-memory-query-'));
  const database = join(directory, 'memory.sqlite');
  try {
    await withServer(database, directory, async client => {
      const anchors = [[0, 0, 0xffffffff], [0, 0, 5], [10, 0, 1], [300, 0, 1]];
      const notes = [];
      for (const [index, [x, y, angle]] of anchors.entries())
        notes.push(await create(database, {
          ...activeSeed, requestId: `ordered-${index}`, x, y, angle,
        }));
      await create(database, { ...activeSeed, requestId: 'inactive', x: 500, isActiveExploration: false });
      await create(database, { ...activeSeed, requestId: 'ordinary', x: 600, isLandmark: false, isActiveExploration: false });
      const otherNamespace = activeQuery.mapNamespace.replace('a'.repeat(64), 'b'.repeat(64));
      const foreign = await create(database, { ...activeSeed, requestId: 'other-map', mapNamespace: otherNamespace });
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(database);
      const dates = ['2026-01-03', '2026-01-02', '2026-01-02', '2026-01-01'];
      try {
        for (const [index, note] of notes.entries())
          db.prepare('UPDATE notes SET created_at = ? WHERE note_id = ?').run(dates[index], note.noteId);
      } finally { db.close(); }
      const expected = notes.map((note, index) => ({ ...note, date: dates[index] }))
        .sort((left, right) => left.date.localeCompare(right.date) || left.noteId.localeCompare(right.noteId))
        .map(note => note.noteId);
      for (const limit of [1, 2, 3, 4, 10]) {
        const found = await invoke(client, 'doom_memory_find', { ...activeQuery, limit });
        assert.deepEqual(found.candidates.map(note => note.noteId), expected.slice(0, limit));
        assert.equal(found.hasMore, limit < 4);
        assert.ok(found.candidates.every(note => note.mapNamespace === activeQuery.mapNamespace && note.isLandmark && note.isActiveExploration));
      }
      assert.equal((await invoke(client, 'doom_memory_find', activeQuery)).candidates.length, 3);
      assert.deepEqual((await invoke(client, 'doom_memory_find', { ...activeQuery, mapNamespace: otherNamespace })).candidates.map(note => note.noteId), [foreign.noteId]);
      const missing = await invoke(client, 'doom_memory_find', { ...activeQuery, mapNamespace: mapKey('f') });
      assert.deepEqual(missing.candidates, []); assert.equal(missing.hasMore, false);
      for (const invalid of [{ x: 0 }, { y: 0 }, { angle: 0 }, { radius: 128 }, { limit: 0 }, { limit: 11 }, { limit: 1.5 }, { mapNamespace: '' }, { mode: 'all' }])
        await rejects(client, 'doom_memory_find', { ...activeQuery, ...invalid });
      const nearbyQuery = { mapNamespace: activeQuery.mapNamespace, x: 0, y: 0, angle: 1, radius: 128 };
      const nearby = await invoke(client, 'doom_memory_find', nearbyQuery);
      assert.deepEqual(nearby.candidates.map(note => note.noteId), notes.slice(0, 3).map(note => note.noteId));
      assert.deepEqual(nearby.candidates.map(note => note.angleDifference), [2, 4, 0]);
      assert.deepEqual(await invoke(client, 'doom_memory_find', { ...nearbyQuery, mode: 'nearby' }), nearby);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 20000);

it('keeps path selection explicit and module-relative, and rejects unsupported schemas and locked writes', async () => {
  assert.equal(memoryDatabasePath(), process.env.DOOM_MEMORY_DB ?? fileURLToPath(new URL('../../.local/doom-memory.sqlite', import.meta.url)));
  assert.throws(() => memoryDatabasePath('relative.sqlite'), /memory-invalid-path/);
  const directory = await mkdtemp(join(tmpdir(), 'doom-memory-safety-'));
  const database = join(directory, 'memory.sqlite');
  try {
    await withServer('relative.sqlite', directory, async client => {
      await rejects(client, 'doom_memory_find', a, 'memory-invalid-path');
      await rejects(client, 'doom_memory_record', appendProbe, 'memory-invalid-path');
      assert.equal(existsSync(join(directory, 'relative.sqlite')), false);
    });
    await withServer(database, directory, async client => {
      const created = await create(database);
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(database);
      try {
        assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
        db.exec('BEGIN IMMEDIATE');
        try {
          await rejects(client, 'doom_memory_record', { operation: 'append', requestId: 'locked',
            noteId: created.noteId, expectedRevision: 1, source: 'Lock test', assessment: 'Not stored' },
          'memory-storage-unavailable');
        } finally { db.exec('ROLLBACK'); }
        assert.equal((await invoke(client, 'doom_memory_find', a)).candidates[0].revision, 1);
        db.exec('PRAGMA user_version = 99');
        await rejects(client, 'doom_memory_find', a, 'memory-schema-unsupported');
        await rejects(client, 'doom_memory_record', appendProbe, 'memory-schema-unsupported');
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, 99);
      } finally { db.close(); }
    });
    const { DatabaseSync } = await import('node:sqlite');
    const foreignPath = join(directory, 'foreign.sqlite');
    const foreign = new DatabaseSync(foreignPath);
    try {
      // The underscore in SQLite's reserved sqlite_ prefix must be literal.
      foreign.exec('CREATE TABLE sqlitex_custom (value TEXT)');
      foreign.exec("INSERT INTO sqlitex_custom VALUES ('preserve foreign content')");
      const before = await readFile(foreignPath);
      await withServer(foreignPath, directory, async client => {
        await rejects(client, 'doom_memory_find', a, 'memory-schema-unsupported');
        await rejects(client, 'doom_memory_find', activeQuery, 'memory-schema-unsupported');
        await rejects(client, 'doom_memory_record', appendProbe, 'memory-schema-unsupported');
      });
      assert.deepEqual(await readFile(foreignPath), before);
      assert.equal(foreign.prepare('PRAGMA user_version').get().user_version, 0);
      assert.deepEqual(foreign.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(row => row.name), ['sqlitex_custom']);
    } finally { foreign.close(); }
    const legacyPath = join(directory, 'legacy.sqlite');
    const legacy = new DatabaseSync(legacyPath);
    try {
      legacy.exec(`
        CREATE TABLE notes (
          note_id TEXT PRIMARY KEY, map_namespace TEXT NOT NULL,
          x REAL NOT NULL, y REAL NOT NULL, heading_deg REAL NOT NULL,
          hypothesis TEXT NOT NULL, next_question TEXT,
          source TEXT NOT NULL, created_at TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1)
        ) STRICT;
        CREATE INDEX notes_namespace_xy ON notes (map_namespace, x, y);
        CREATE TABLE entries (
          note_id TEXT NOT NULL REFERENCES notes(note_id), revision INTEGER NOT NULL,
          request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
          source TEXT NOT NULL, assessment TEXT, created_at TEXT NOT NULL,
          PRIMARY KEY (note_id, revision)
        ) STRICT;
        INSERT INTO notes VALUES ('old-note', 'old-map', 0, 0, 0,
          'Preserve old hypothesis', 'Preserve old question', 'Old source', '2026-01-01', 1);
        INSERT INTO entries VALUES ('old-note', 1, 'old-request', 'old-hash',
          'Old source', NULL, '2026-01-01');
        PRAGMA application_id = 1146048333;
        PRAGMA user_version = 1;
      `);
    } finally { legacy.close(); }
    for (const version of [1, 2, 3]) {
      const legacyVersion = new DatabaseSync(legacyPath);
      try { legacyVersion.exec(`PRAGMA user_version = ${version}`); }
      finally { legacyVersion.close(); }
      const before = await readFile(legacyPath);
      await withServer(legacyPath, directory, async client => {
        await rejects(client, 'doom_memory_find', a, 'memory-schema-unsupported');
        await rejects(client, 'doom_memory_find', activeQuery, 'memory-schema-unsupported');
        await rejects(client, 'doom_memory_record', appendProbe, 'memory-schema-unsupported');
        await rejects(client, 'doom_memory_record', {
          operation: 'append', requestId: 'old-append', noteId: '11111111-1111-4111-8111-111111111111',
          expectedRevision: 1, source: 'Offline rejection test', assessment: 'Must not be stored',
        }, 'memory-schema-unsupported');
      });
      await assert.rejects(create(legacyPath), /memory-schema-unsupported/);
      await assert.rejects(initializeMemoryDatabase(legacyPath), /memory-schema-unsupported/);
      assert.equal(existsSync(`${legacyPath}.refs`), false);
      assert.deepEqual(await readFile(legacyPath), before, `Version-${version} schema, records and bytes must stay unchanged`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
