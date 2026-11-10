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

type DefaultedMemoryFlagsInput = {
  [Flag in keyof MemoryFlags]?: MemoryFlags[Flag] | undefined;
};

type CreateMemoryRecord = MemoryPose & {
  operation: 'create';
  mapNamespace: string;
  hypothesis: string;
  nextQuestion?: string | undefined;
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
  nextQuestion: string | null;
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
    | 'memory-revision-conflict'
    | 'memory-request-conflict'
    | 'memory-storage-unavailable';
};
export function findMemory(input: unknown): Promise<MemoryFindResult>;
export function recordMemory(input: unknown): Promise<MemoryRecordResult>;
