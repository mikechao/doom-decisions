import type { z } from 'zod/v4';

export type NearbyMemoryQuery = Readonly<{
  mode?: 'nearby';
  mapNamespace: string;
  x: number;
  y: number;
  angle: number;
  radius: number;
  limit: number;
}>;

export type ActiveLandmarkMemoryQuery = Readonly<{
  mode: 'active-landmarks';
  mapNamespace: string;
  limit: number;
}>;

export type MemoryFindQuery = NearbyMemoryQuery | ActiveLandmarkMemoryQuery;

export const memoryFindSchema: z.ZodType<MemoryFindQuery>;
export function memoryDatabasePath(override?: string): string;
export function findMemory(input: unknown): Promise<unknown>;
