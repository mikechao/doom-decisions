import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { frameRgbaSha256 } from './frame-png.mjs';

const text = (max) => z.string().trim().min(1).max(max);
// Match native telemetry exactly: signed 16.16 XY and unsigned binary angle.
const coordinate = z.number().int().min(-2147483648).max(2147483647);
const angle = z.number().int().min(0).max(0xffffffff);
const pose = { x: coordinate, y: coordinate, angle };
const request = { requestId: text(128), source: text(512) };
const limit = z.number().int().min(1).max(10).default(3);
const validFlags = (flags) => !flags.isActiveExploration || flags.isLandmark;
const flagsSchema = z
  .strictObject({ isLandmark: z.boolean(), isActiveExploration: z.boolean() })
  .refine(validFlags, 'Active exploration requires a landmark.');
export const memoryMapKeySchema = z
  .string()
  .length('doom-map:v1:iwad-sha256::E1M1'.length + 64)
  .regex(/^doom-map:v1:iwad-sha256:[a-f0-9]{64}:E1M1$/);
const sha256 = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);
const worldUnit = z.number().int().min(-32768).max(32767);
const wadIndex = z.number().int().min(0).max(65534);
const worldXY = z.tuple([worldUnit, worldUnit]).readonly();
const side = z.strictObject({ sector: wadIndex, floor: worldUnit }).readonly();
const segment = z
  .strictObject({
    linedefOrdinal: wadIndex,
    endpoints: z.tuple([worldXY, worldXY]).readonly(),
    front: side,
    back: side,
  })
  .refine(
    ({ endpoints: [[ax, ay], [bx, by]] }) => ax !== bx || ay !== by,
    'A linedef must have distinct endpoints.',
  )
  .readonly();

export const memoryGeometrySchema = z
  .strictObject({
    kind: z.literal('two-sided-linedefs'),
    provenance: z
      .strictObject({
        method: z.literal('wad-lump-audit-v1'),
        artifactSha256: sha256,
      })
      .readonly(),
    segments: z
      .array(segment)
      .min(1)
      .max(32)
      .refine(
        (segments) =>
          new Set(segments.map(({ linedefOrdinal }) => linedefOrdinal)).size ===
          segments.length,
        'Linedef ordinals must be unique.',
      )
      .readonly(),
  })
  .readonly();

export const memoryNextQuestionSchema = text(512);
const referenceHashesSchema = z.object({
  pngSha256: sha256,
  frameSha256: sha256,
});
export const memoryRecognitionSchema = z
  .strictObject({
    reference: z
      .strictObject({
        runId: z.uuid(),
        ordinal: z.number().int().positive(),
        observationId: z.uuid(),
        tic: z.number().int().nonnegative(),
        runResultSha256: sha256,
        ...referenceHashesSchema.shape,
      })
      .readonly(),
    geometry: memoryGeometrySchema,
  })
  .readonly();

const noteContent = {
  mapNamespace: memoryMapKeySchema,
  ...pose,
  hypothesis: text(2000),
  nextQuestion: memoryNextQuestionSchema,
  recognition: memoryRecognitionSchema,
};
const noteContentSchema = z.strictObject(noteContent);

export const memoryFindSchema = z.union([
  z.strictObject({
    mode: z.literal('nearby').optional(),
    mapNamespace: memoryMapKeySchema,
    ...pose,
    // Raw fixed-point radius; default 64 map units, maximum 1024.
    radius: z.number().int().positive().max(67108864).default(4194304),
    limit,
  }),
  z.strictObject({
    mode: z.literal('active-landmarks'),
    mapNamespace: memoryMapKeySchema,
    limit,
  }),
]);
export const memoryAppendSchema = z.strictObject({
  operation: z.literal('append'),
  ...request,
  noteId: z.uuid(),
  expectedRevision: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER - 1),
  assessment: text(2000),
  flags: flagsSchema.optional(),
});
export const memoryRecordSchema = z.discriminatedUnion('operation', [
  z
    .strictObject({
      operation: z.literal('create'),
      ...request,
      ...noteContent,
      isLandmark: z.boolean().default(false),
      isActiveExploration: z.boolean().default(false),
    })
    .refine(validFlags, 'Active exploration requires a landmark.'),
  memoryAppendSchema,
]);

export const memoryApplicationId = 0x444f4f4d;
export const memorySchemaVersion = 4;
const caution =
  'Advisory, unverified memory. Source text does not authenticate claims or IWAD identity. Proximity does not prove the same viewpoint, map identity, passability or navigation success.';
const errors = new Set([
  'memory-invalid-path',
  'memory-schema-unsupported',
  'memory-note-not-found',
  'memory-note-invalid',
  'memory-reference-invalid',
  'memory-reference-missing',
  'memory-revision-conflict',
  'memory-request-conflict',
]);
let sqlite;

export function memoryDatabasePath(override = process.env.DOOM_MEMORY_DB) {
  if (override !== undefined) {
    if (!isAbsolute(override)) throw Error('memory-invalid-path');
    return override;
  }
  return fileURLToPath(
    new URL('../.local/doom-memory.sqlite', import.meta.url),
  );
}

export function memoryError(error) {
  return {
    error: errors.has(error?.message)
      ? error.message
      : 'memory-storage-unavailable',
  };
}

function exists(path) {
  try {
    if (!statSync(path).isFile()) throw Error('Not a regular file.');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function checkSchema(db, allowEmpty = false) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const owner = db.prepare('PRAGMA application_id').get().application_id;
  if (version === memorySchemaVersion && owner === memoryApplicationId) return;
  if (
    allowEmpty &&
    version === 0 &&
    owner === 0 &&
    !db
      .prepare("SELECT 1 FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'")
      .get()
  )
    return;
  throw Error('memory-schema-unsupported');
}

function initialize(db) {
  checkSchema(db, true);
  if (db.prepare('PRAGMA user_version').get().user_version !== 0) return;
  db.exec(`
    CREATE TABLE notes (
      note_id TEXT PRIMARY KEY,
      map_namespace TEXT NOT NULL,
      x INTEGER NOT NULL CHECK (x BETWEEN -2147483648 AND 2147483647),
      y INTEGER NOT NULL CHECK (y BETWEEN -2147483648 AND 2147483647),
      angle INTEGER NOT NULL CHECK (angle BETWEEN 0 AND 4294967295),
      hypothesis TEXT NOT NULL,
      next_question TEXT NOT NULL CHECK (length(trim(next_question)) > 0),
      recognition_json TEXT NOT NULL CHECK (json_valid(recognition_json)),
      source TEXT NOT NULL, created_at TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      is_landmark INTEGER NOT NULL DEFAULT 0 CHECK (is_landmark IN (0, 1)),
      is_active_exploration INTEGER NOT NULL DEFAULT 0 CHECK (is_active_exploration IN (0, 1)),
      CHECK (is_active_exploration <= is_landmark)
    ) STRICT;
    CREATE INDEX notes_namespace_xy ON notes (map_namespace, x, y);
    CREATE TABLE entries (
      note_id TEXT NOT NULL REFERENCES notes(note_id),
      revision INTEGER NOT NULL,
      request_id TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      source TEXT NOT NULL,
      assessment TEXT,
      created_at TEXT NOT NULL,
      is_landmark INTEGER NOT NULL CHECK (is_landmark IN (0, 1)),
      is_active_exploration INTEGER NOT NULL CHECK (is_active_exploration IN (0, 1)),
      CHECK (is_active_exploration <= is_landmark),
      PRIMARY KEY (note_id, revision)
    ) STRICT;
    PRAGMA application_id = ${memoryApplicationId};
    PRAGMA user_version = ${memorySchemaVersion};
  `);
}

async function open(path, readOnly) {
  // Import/list/gameplay-only use must neither load SQLite nor emit its warning.
  sqlite ??= import('node:sqlite');
  const { DatabaseSync } = await sqlite;
  const db = new DatabaseSync(path, { readOnly });
  try {
    db.exec('PRAGMA busy_timeout = 100; PRAGMA foreign_keys = ON;');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function transaction(db, mode, work) {
  db.exec(mode);
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function initializeMemoryDatabase(databasePath) {
  const path = memoryDatabasePath(databasePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = await open(path, false);
  try {
    transaction(db, 'BEGIN IMMEDIATE', () => initialize(db));
  } finally {
    db.close();
  }
}

const maxReferencePngBytes = 2 * 1024 * 1024;
export function verifyMemoryReferencePng(bytes, reference) {
  if (
    Buffer.isBuffer(bytes) &&
    bytes.length <= maxReferencePngBytes &&
    createHash('sha256').update(bytes).digest('hex') === reference.pngSha256
  ) {
    try {
      if (frameRgbaSha256(bytes) === reference.frameSha256) return;
    } catch {
      // Report malformed image contents through the same bounded storage error.
    }
  }
  throw Error('memory-reference-invalid');
}

function referenceFile(databasePath, hash, createDirectory = false) {
  const directory = `${realpathSync(databasePath)}.refs`;
  if (createDirectory) {
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  if (!lstatSync(directory).isDirectory())
    throw Error('memory-reference-invalid');
  return join(directory, `${hash}.png`);
}

function readReferenceFile(path, reference) {
  const file = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = fstatSync(file);
    if (!info.isFile() || info.size > maxReferencePngBytes)
      throw Error('memory-reference-invalid');
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(file, bytes, size, bytes.length - size, size);
      if (!count) break;
      size += count;
    }
    if (size !== info.size) throw Error('memory-reference-invalid');
    const png = bytes.subarray(0, size);
    verifyMemoryReferencePng(png, reference);
    return png;
  } finally {
    closeSync(file);
  }
}

export function readMemoryReferencePng(
  reference,
  databasePath = memoryDatabasePath(),
) {
  const hashes = referenceHashesSchema.parse(reference);
  try {
    return readReferenceFile(
      referenceFile(memoryDatabasePath(databasePath), hashes.pngSha256),
      hashes,
    );
  } catch (error) {
    if (error.message === 'memory-invalid-path') throw error;
    throw Error(
      error.code === 'ENOENT'
        ? 'memory-reference-missing'
        : 'memory-reference-invalid',
    );
  }
}

function publishReference(databasePath, bytes, reference) {
  const path = referenceFile(databasePath, reference.pngSha256, true);
  try {
    readReferenceFile(path, reference);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = join(dirname(path), `${randomUUID()}.tmp`);
  const file = openSync(temporary, 'wx', 0o600);
  try {
    try {
      writeFileSync(file, bytes, { flush: true });
    } finally {
      closeSync(file);
    }
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      readReferenceFile(path, reference);
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // The staging filename is never referenced by the database.
    }
  }
}

function flagsFromRow(row) {
  return {
    isLandmark: row.is_landmark === 1,
    isActiveExploration: row.is_active_exploration === 1,
  };
}

function noteFromRow(row) {
  let content;
  try {
    content = noteContentSchema.parse({
      mapNamespace: row.map_namespace,
      x: row.x,
      y: row.y,
      angle: row.angle,
      hypothesis: row.hypothesis,
      nextQuestion: row.next_question,
      recognition: JSON.parse(row.recognition_json),
    });
  } catch {
    throw Error('memory-note-invalid');
  }
  return {
    noteId: row.note_id,
    revision: row.revision,
    mapNamespace: content.mapNamespace,
    anchor: { x: content.x, y: content.y, angle: content.angle },
    source: row.source,
    hypothesis: content.hypothesis,
    nextQuestion: content.nextQuestion,
    recognition: content.recognition,
    createdAt: row.created_at,
    status: 'unverified',
    ...flagsFromRow(row),
  };
}

function withEntries(db, note) {
  return {
    ...note,
    entries: db
      .prepare(`SELECT revision, source, assessment, created_at AS createdAt,
        is_landmark, is_active_exploration
        FROM entries WHERE note_id = ? AND assessment IS NOT NULL
        ORDER BY revision`)
      .all(note.noteId)
      .map(({ is_landmark, is_active_exploration, ...entry }) => ({
        ...entry,
        ...flagsFromRow({ is_landmark, is_active_exploration }),
      })),
  };
}

export async function findMemory(input) {
  const query = memoryFindSchema.parse(input);
  const path = memoryDatabasePath();
  const active = query.mode === 'active-landmarks';
  const result = active
    ? { mode: query.mode, mapNamespace: query.mapNamespace, caution }
    : { caution };
  if (!exists(path))
    return { ...result, candidates: [], ...(active ? { hasMore: false } : {}) };
  const db = await open(path, true);
  try {
    return transaction(db, 'BEGIN', () => {
      checkSchema(db);
      if (active) {
        const rows = db
          .prepare(`SELECT * FROM notes WHERE map_namespace = ?
            AND is_landmark = 1 AND is_active_exploration = 1
            ORDER BY created_at ASC, note_id ASC LIMIT ?`)
          .all(query.mapNamespace, query.limit + 1);
        return {
          ...result,
          candidates: rows
            .slice(0, query.limit)
            .map((row) => withEntries(db, noteFromRow(row))),
          hasMore: rows.length > query.limit,
        };
      }
      const { mapNamespace, x, y, angle, radius, limit } = query;
      const rows = db
        .prepare(`SELECT * FROM notes WHERE map_namespace = ?
          AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?`)
        .all(mapNamespace, x - radius, x + radius, y - radius, y + radius);
      const candidates = rows
        .map((row) => {
          const difference = Math.abs(row.angle - angle);
          return {
            ...noteFromRow(row),
            distance: Math.hypot(row.x - x, row.y - y),
            angleDifference: Math.min(difference, 4294967296 - difference),
          };
        })
        .filter((note) => note.distance <= radius)
        .sort(
          (a, b) =>
            a.distance - b.distance ||
            a.angleDifference - b.angleDifference ||
            (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0),
        )
        .slice(0, limit)
        .map((note) => withEntries(db, note));
      return { caution, candidates };
    });
  } finally {
    db.close();
  }
}

// Promotion's exact-equality guard is independent of the bounded navigation
// previews. Accept a create payload so normalization matches the eventual write.
// Identical-source requests remain eligible for the writer's existing replay.
export async function findExactMemory(input) {
  const record = memoryRecordSchema.parse(input);
  if (record.operation !== 'create')
    throw new TypeError('Exact memory lookup requires a create record.');
  const path = memoryDatabasePath();
  if (!exists(path)) return null;
  const db = await open(path, true);
  try {
    return transaction(db, 'BEGIN', () => {
      checkSchema(db);
      const row = db
        .prepare(`SELECT note_id FROM notes WHERE map_namespace = ?
          AND x = ? AND y = ? AND angle = ? AND hypothesis = ?
          AND next_question = ? AND source <> ?
          ORDER BY note_id ASC LIMIT 1`)
        .get(
          record.mapNamespace,
          record.x,
          record.y,
          record.angle,
          record.hypothesis,
          record.nextQuestion,
          record.source,
        );
      return row ? { noteId: row.note_id } : null;
    });
  } finally {
    db.close();
  }
}

export async function recordMemory(input, referencePng) {
  const record = memoryRecordSchema.parse(input);
  const reference =
    record.operation === 'create' ? record.recognition.reference : null;
  let bytes;
  if (reference !== null) {
    verifyMemoryReferencePng(referencePng, reference);
    bytes = Buffer.from(referencePng);
  }
  const path = memoryDatabasePath();
  const present = exists(path);
  if (!present && record.operation === 'append')
    throw Error('memory-note-not-found');
  // All input/path validation precedes storage creation. Never seed implicitly.
  if (!present) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = await open(path, false);
  try {
    checkSchema(db, record.operation === 'create');
    db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
    return transaction(db, 'BEGIN IMMEDIATE', () => {
      if (record.operation === 'create') initialize(db);
      else checkSchema(db);
      const requestHash = createHash('sha256')
        .update(JSON.stringify(record))
        .digest('hex');
      const previous = db
        .prepare('SELECT * FROM entries WHERE request_id = ?')
        .get(record.requestId);
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw Error('memory-request-conflict');
        if (reference !== null) readMemoryReferencePng(reference, path);
        return {
          noteId: previous.note_id,
          revision: previous.revision,
          status: 'unverified',
          replayed: true,
        };
      }
      const createdAt = new Date().toISOString();
      let noteId;
      let revision;
      let flags;
      if (record.operation === 'create') {
        // Publish before the row. A failed SQL write can leave an unreferenced
        // sidecar, which another identical create can safely reuse.
        publishReference(path, bytes, reference);
        noteId = randomUUID();
        revision = 1;
        flags = record;
        db.prepare(
          `INSERT INTO notes (note_id, map_namespace, x, y, angle, hypothesis,
            next_question, recognition_json, source, created_at, revision,
            is_landmark, is_active_exploration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          noteId,
          record.mapNamespace,
          record.x,
          record.y,
          record.angle,
          record.hypothesis,
          record.nextQuestion,
          JSON.stringify(record.recognition),
          record.source,
          createdAt,
          revision,
          Number(flags.isLandmark),
          Number(flags.isActiveExploration),
        );
      } else {
        noteId = record.noteId;
        const note = db
          .prepare('SELECT * FROM notes WHERE note_id = ?')
          .get(noteId);
        if (!note) throw Error('memory-note-not-found');
        if (note.revision !== record.expectedRevision)
          throw Error('memory-revision-conflict');
        revision = note.revision + 1;
        flags = record.flags ?? flagsFromRow(note);
        db.prepare(`UPDATE notes SET revision = ?, is_landmark = ?,
          is_active_exploration = ? WHERE note_id = ?`).run(
          revision,
          Number(flags.isLandmark),
          Number(flags.isActiveExploration),
          noteId,
        );
      }
      // Revision 1 also holds the create request receipt; later rows are assessments.
      db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        noteId,
        revision,
        record.requestId,
        requestHash,
        record.source,
        record.operation === 'append' ? record.assessment : null,
        createdAt,
        Number(flags.isLandmark),
        Number(flags.isActiveExploration),
      );
      return { noteId, revision, status: 'unverified', replayed: false };
    });
  } finally {
    db.close();
  }
}
