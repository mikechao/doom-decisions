import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';

const text = (max) => z.string().trim().min(1).max(max);
const coordinate = z.number().min(-32768).max(32768);
const heading = z.number().min(0).lt(360);
const pose = { x: coordinate, y: coordinate, headingDeg: heading };
const request = { requestId: text(128), source: text(512) };
const limit = z.number().int().min(1).max(10).default(3);
const validFlags = (flags) => !flags.isActiveExploration || flags.isLandmark;
const flagsSchema = z
  .strictObject({ isLandmark: z.boolean(), isActiveExploration: z.boolean() })
  .refine(validFlags, 'Active exploration requires a landmark.');

export const memoryFindSchema = z.union([
  z.strictObject({
    mode: z.literal('nearby').optional(),
    mapNamespace: text(128),
    ...pose,
    radius: z.number().positive().max(1024).default(64),
    limit,
  }),
  z.strictObject({
    mode: z.literal('active-landmarks'),
    mapNamespace: text(128),
    limit,
  }),
]);
export const memoryRecordSchema = z.discriminatedUnion('operation', [
  z
    .strictObject({
      operation: z.literal('create'),
      ...request,
      mapNamespace: text(128),
      ...pose,
      hypothesis: text(2000),
      nextQuestion: text(512).optional(),
      isLandmark: z.boolean().default(false),
      isActiveExploration: z.boolean().default(false),
    })
    .refine(validFlags, 'Active exploration requires a landmark.'),
  z.strictObject({
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
  }),
]);

const applicationId = 0x444f4f4d;
const schemaVersion = 2;
const caution =
  'Advisory, unverified memory. Source text does not authenticate claims or IWAD identity. Proximity does not prove the same viewpoint, map identity, passability or navigation success.';
const errors = new Set([
  'memory-invalid-path',
  'memory-schema-unsupported',
  'memory-note-not-found',
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
  if (version === schemaVersion && owner === applicationId) return;
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
      x REAL NOT NULL, y REAL NOT NULL, heading_deg REAL NOT NULL,
      hypothesis TEXT NOT NULL, next_question TEXT,
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
    PRAGMA application_id = ${applicationId};
    PRAGMA user_version = ${schemaVersion};
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

function flagsFromRow(row) {
  return {
    isLandmark: row.is_landmark === 1,
    isActiveExploration: row.is_active_exploration === 1,
  };
}

function noteFromRow(row) {
  return {
    noteId: row.note_id,
    revision: row.revision,
    mapNamespace: row.map_namespace,
    anchor: { x: row.x, y: row.y, headingDeg: row.heading_deg },
    source: row.source,
    hypothesis: row.hypothesis,
    nextQuestion: row.next_question,
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
      const { mapNamespace, x, y, headingDeg, radius, limit } = query;
      const rows = db
        .prepare(`SELECT * FROM notes WHERE map_namespace = ?
          AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?`)
        .all(mapNamespace, x - radius, x + radius, y - radius, y + radius);
      const candidates = rows
        .map((row) => {
          const difference = Math.abs(row.heading_deg - headingDeg);
          return {
            ...noteFromRow(row),
            distance: Math.hypot(row.x - x, row.y - y),
            headingDifferenceDeg: Math.min(difference, 360 - difference),
          };
        })
        .filter((note) => note.distance <= radius)
        .sort(
          (a, b) =>
            a.distance - b.distance ||
            a.headingDifferenceDeg - b.headingDifferenceDeg ||
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

export async function recordMemory(input) {
  const record = memoryRecordSchema.parse(input);
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
        noteId = randomUUID();
        revision = 1;
        flags = record;
        db.prepare(
          `INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          noteId,
          record.mapNamespace,
          record.x,
          record.y,
          record.headingDeg,
          record.hypothesis,
          record.nextQuestion ?? null,
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
