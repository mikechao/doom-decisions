export type DoomProposal = {
  target: string;
  visualEvidence: string[];
  telemetryEvidence: string[];
  uncertainty: string;
  nextExperiment: string;
};

export const proposalShape = {
  target: 'One high-level observable target or question',
  visualEvidence: ['A fact actually visible in the PNG'],
  telemetryEvidence: ['A fact actually supplied in the validated state'],
  uncertainty: 'What a single screenshot cannot establish',
  nextExperiment: 'One observation/question to test next',
};

// Structural acceptance only. A human must assess grounding and usefulness.
export function validateDoomProposal(raw: string): DoomProposal {
  if (Buffer.byteLength(raw) > 8192) throw new Error('INVALID_PROPOSAL');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PROPOSAL');
  const record = value as Record<string, unknown>;
  const fields = Object.keys(proposalShape);
  if (Object.keys(record).length !== fields.length || fields.some(key => !Object.hasOwn(record, key))) throw new Error('INVALID_PROPOSAL');
  const text = (item: unknown, max: number) =>
    typeof item === 'string' && item.trim().length > 0 && item.length <= max &&
    Array.from(item).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
  for (const key of ['target', 'uncertainty', 'nextExperiment']) {
    if (!text(record[key], 800)) throw new Error('INVALID_PROPOSAL');
  }
  for (const key of ['visualEvidence', 'telemetryEvidence']) {
    const items = record[key];
    if (!Array.isArray(items) || items.length < 1 || items.length > 5 || items.some(item => !text(item, 400))) throw new Error('INVALID_PROPOSAL');
  }
  return record as DoomProposal;
}
