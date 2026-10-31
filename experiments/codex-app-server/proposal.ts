import type { Marker } from './fixtures.ts';
import { expected } from './fixtures.ts';

export type Proposal = {
  target: string;
  visualEvidence: { markers: Marker[]; recalledNonce: string | null; recalledTarget: string | null };
  uncertainty: string;
  nextExperiment: string;
  recommendedTics: number;
  recommendedInstruction?: string | null;
};
const textSchema = { type: 'string', minLength: 1, maxLength: 800 };
const nullableText = { anyOf: [textSchema, { type: 'null' }] };
const markerProperties = Object.fromEntries(['color', 'shape', 'horizontal', 'vertical'].map(key => [key, textSchema]));
export const outputSchema = {
  type: 'object', additionalProperties: false,
  required: ['target', 'visualEvidence', 'uncertainty', 'nextExperiment', 'recommendedTics', 'recommendedInstruction'],
  properties: {
    target: textSchema,
    visualEvidence: {
      type: 'object', additionalProperties: false,
      required: ['markers', 'recalledNonce', 'recalledTarget'],
      properties: {
        markers: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: Object.keys(markerProperties), properties: markerProperties } },
        recalledNonce: nullableText, recalledTarget: nullableText,
      },
    },
    uncertainty: textSchema, nextExperiment: textSchema,
    recommendedTics: { type: 'integer', minimum: 1, maximum: 35 },
    recommendedInstruction: nullableText,
  },
};
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  const result = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => ![...required, ...optional].includes(key))) throw new Error('Invalid keys');
  return result;
}
function text(value: unknown): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 800) throw new Error('Invalid string');
}
export function validateProposal(raw: string, status: string): Proposal {
  if (status !== 'completed') throw new Error('Unsuccessful terminal status');
  if (Buffer.byteLength(raw) > 8192) throw new Error('Oversize proposal');
  const value = object(JSON.parse(raw), ['target', 'visualEvidence', 'uncertainty', 'nextExperiment', 'recommendedTics'], ['recommendedInstruction']);
  for (const key of ['target', 'uncertainty', 'nextExperiment']) text(value[key]);
  if (!Number.isInteger(value.recommendedTics) || (value.recommendedTics as number) < 1 || (value.recommendedTics as number) > 35) throw new Error('Invalid tics');
  if (value.recommendedInstruction !== undefined && value.recommendedInstruction !== null) text(value.recommendedInstruction);
  const evidence = object(value.visualEvidence, ['markers', 'recalledNonce', 'recalledTarget']);
  for (const key of ['recalledNonce', 'recalledTarget']) if (evidence[key] !== null) text(evidence[key]);
  if (!Array.isArray(evidence.markers) || evidence.markers.length < 1 || evidence.markers.length > 8) throw new Error('Invalid markers');
  for (const marker of evidence.markers) {
    const fields = object(marker, ['color', 'shape', 'horizontal', 'vertical']);
    for (const field of Object.values(fields)) text(field);
  }
  // Refuse low-level action tokens anywhere, including optional instructions.
  if (/\b(neutral|forward|backward|turn_left|turn_right|fire|use)\b/i.test(raw)) throw new Error('Low-level action token');
  return value as Proposal;
}
export function assess(proposal: Proposal, index: number, nonce: string, firstTarget?: string) {
  const observed = proposal.visualEvidence.markers;
  const key = (marker: Marker) => [marker.color, marker.shape, marker.horizontal, marker.vertical].map(x => x.toLowerCase().trim()).join('/');
  const imageMatch = observed.length === expected[index].length && [...observed.map(key)].sort().join('|') === [...expected[index].map(key)].sort().join('|');
  return {
    expected: expected[index], observed, imageMatch,
    contextRetained: index === 1 ? proposal.visualEvidence.recalledNonce === nonce && proposal.visualEvidence.recalledTarget === firstTarget : null,
  };
}
