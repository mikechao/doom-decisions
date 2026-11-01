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
  if (Object.keys(record).length !== fields.length || fields.some((key) => !Object.hasOwn(record, key)))
    throw new Error('INVALID_PROPOSAL');
  const text = (item: unknown, max: number) =>
    typeof item === 'string' &&
    item.trim().length > 0 &&
    item.length <= max &&
    Array.from(item).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
  for (const key of ['target', 'uncertainty', 'nextExperiment']) {
    if (!text(record[key], 800)) throw new Error('INVALID_PROPOSAL');
  }
  for (const key of ['visualEvidence', 'telemetryEvidence']) {
    const items = record[key];
    if (!Array.isArray(items) || items.length < 1 || items.length > 5 || items.some((item) => !text(item, 400)))
      throw new Error('INVALID_PROPOSAL');
  }
  return record as DoomProposal;
}

export type DoomReassessment = {
  status: 'continue' | 'revise' | 'achieved' | 'uncertain';
  visualEvidence: string[];
  telemetryEvidence: string[];
  uncertainty: string;
  nextGuidance: { target: string; nextExperiment: string } | null;
};

export const reassessmentShape = {
  status: 'continue | revise | achieved | uncertain (advisory only)',
  visualEvidence: ['A visible change or lack of change in the new image'],
  telemetryEvidence: ['A supplied before/after fact or lack of change'],
  uncertainty: 'Limits on assessing the ORIGINAL objective from this evidence',
  nextGuidance: {
    target: 'For continue/revise: one high-level observable objective; otherwise nextGuidance must be null',
    nextExperiment: 'One defensible next observable question; uncertain means none can be offered',
  },
};

export function validateDoomReassessment(raw: string): DoomReassessment {
  if (Buffer.byteLength(raw) > 8192) throw new Error('INVALID_REASSESSMENT');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REASSESSMENT');
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).sort().join(',') !== 'nextGuidance,status,telemetryEvidence,uncertainty,visualEvidence' ||
    typeof result.status !== 'string' ||
    !['continue', 'revise', 'achieved', 'uncertain'].includes(result.status)
  )
    throw new Error('INVALID_REASSESSMENT');
  const continuing = result.status === 'continue' || result.status === 'revise';
  const guidance = result.nextGuidance;
  if (continuing) {
    if (
      !guidance ||
      typeof guidance !== 'object' ||
      Array.isArray(guidance) ||
      Object.keys(guidance).sort().join(',') !== 'nextExperiment,target'
    )
      throw new Error('INVALID_REASSESSMENT');
  } else if (guidance !== null) throw new Error('INVALID_REASSESSMENT');
  const next = guidance as DoomReassessment['nextGuidance'];
  // Reuse the same bounded text/evidence rules; this validates structure only.
  validateDoomProposal(
    JSON.stringify({
      target: continuing ? next?.target : 'Reassess original objective',
      visualEvidence: result.visualEvidence,
      telemetryEvidence: result.telemetryEvidence,
      uncertainty: result.uncertainty,
      nextExperiment: continuing ? next?.nextExperiment : 'No further gameplay authorized',
    }),
  );
  return result as DoomReassessment;
}
