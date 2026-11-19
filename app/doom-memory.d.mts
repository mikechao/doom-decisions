import type { z } from 'zod/v4';

type MemoryPose = {
  x: number;
  y: number;
  angle: number;
};

export type NearbyMemoryQuery = Readonly<
  MemoryPose & {
    mode?: 'nearby';
    mapNamespace: string;
    radius: number;
    limit: number;
  }
>;

export type ActiveLandmarkMemoryQuery = Readonly<{
  mode: 'active-landmarks';
  mapNamespace: string;
  limit: number;
}>;

export type MemoryFindQuery = NearbyMemoryQuery | ActiveLandmarkMemoryQuery;

type MemoryFlags = {
  isLandmark: boolean;
  isActiveExploration: boolean;
};

type WorldXY = readonly [number, number];
type SectorSide = Readonly<{ sector: number; floor: number }>;
export type MemoryGeometry = Readonly<{
  kind: 'two-sided-linedefs';
  provenance: Readonly<{ method: 'wad-lump-audit-v1'; artifactSha256: string }>;
  segments: readonly Readonly<{
    linedefOrdinal: number;
    endpoints: readonly [WorldXY, WorldXY];
    front: SectorSide;
    back: SectorSide;
  }>[];
}>;
export type MemoryRecognition = Readonly<{
  reference: Readonly<{
    runId: string;
    ordinal: number;
    observationId: string;
    tic: number;
    runResultSha256: string;
    pngSha256: string;
    frameSha256: string;
  }>;
  geometry: MemoryGeometry;
}>;

type DefaultedMemoryFlagsInput = {
  [Flag in keyof MemoryFlags]?: MemoryFlags[Flag] | undefined;
};

type CreateMemoryRecord = MemoryPose & {
  operation: 'create';
  mapNamespace: string;
  hypothesis: string;
  nextQuestion: string;
  recognition: MemoryRecognition;
};

type AppendMemoryRecord = {
  operation: 'append';
  noteId: string;
  expectedRevision: number;
  assessment: string;
  flags?: MemoryFlags | undefined;
};

type MemoryRecordRequest = { requestId: string; source: string };

type MemoryEntry = MemoryFlags & {
  revision: number;
  source: string;
  assessment: string;
  createdAt: string;
};

type MemoryCandidate = MemoryFlags & {
  noteId: string;
  revision: number;
  mapNamespace: string;
  anchor: MemoryPose;
  source: string;
  hypothesis: string;
  nextQuestion: string;
  recognition: MemoryRecognition;
  createdAt: string;
  status: 'unverified';
  entries: MemoryEntry[];
};

type MemoryFindResult =
  | {
      mode?: never;
      caution: string;
      candidates: (MemoryCandidate & {
        distance: number;
        angleDifference: number;
      })[];
    }
  | {
      mode: 'active-landmarks';
      mapNamespace: string;
      caution: string;
      candidates: (MemoryCandidate & {
        isLandmark: true;
        isActiveExploration: true;
      })[];
      hasMore: boolean;
    };

type MemoryRecordResult = {
  noteId: string;
  revision: number;
  status: 'unverified';
  replayed: boolean;
};

export const memoryFindSchema: z.ZodType<MemoryFindQuery>;
export const memoryMapKeySchema: z.ZodType<string>;
export const memoryGeometrySchema: z.ZodType<MemoryGeometry>;
export const memoryNextQuestionSchema: z.ZodType<string>;
export const memoryRecognitionSchema: z.ZodType<MemoryRecognition>;
export const memoryAppendSchema: z.ZodType<MemoryRecordRequest & AppendMemoryRecord>;
export const memoryApplicationId: number;
export const memorySchemaVersion: 4;
export const memoryRecordSchema: z.ZodType<
  MemoryRecordRequest & ((CreateMemoryRecord & MemoryFlags) | AppendMemoryRecord),
  MemoryRecordRequest & ((CreateMemoryRecord & DefaultedMemoryFlagsInput) | AppendMemoryRecord)
>;
export function memoryDatabasePath(override?: string): string;
export function memoryError(error: unknown): {
  error:
    | 'memory-invalid-path'
    | 'memory-schema-unsupported'
    | 'memory-note-not-found'
    | 'memory-note-invalid'
    | 'memory-reference-invalid'
    | 'memory-reference-missing'
    | 'memory-revision-conflict'
    | 'memory-request-conflict'
    | 'memory-storage-unavailable';
};
export function findMemory(input: unknown): Promise<MemoryFindResult>;
export function findExactMemory(input: unknown): Promise<{ noteId: string } | null>;
export function initializeMemoryDatabase(databasePath: string): Promise<void>;
type MemoryReferenceHashes = Pick<MemoryRecognition['reference'], 'pngSha256' | 'frameSha256'>;
export function verifyMemoryReferencePng(bytes: unknown, reference: MemoryReferenceHashes): void;
export function readMemoryReferencePng(reference: MemoryReferenceHashes, databasePath?: string): Buffer;
export function recordMemory(
  input: MemoryRecordRequest & AppendMemoryRecord,
): Promise<MemoryRecordResult>;
export function recordMemory(input: unknown, referencePng: Buffer): Promise<MemoryRecordResult>;
