import { facingObservationValid, type Observation } from './worker-shared.ts';

export type FacingProbe = Readonly<{
  tic: number;
  kind: number;
  door: number;
  distance: number;
}>;

// Call only at the controller's verified observation/render checkpoint.
export function facingProbeAt(
  observation: Observation,
): FacingProbe | undefined {
  if (!facingObservationValid(observation) || observation.counters.gametic < 1)
    return undefined;
  const p = observation.native;
  return Object.freeze({
    tic: p.collisionSampleTic,
    kind: p.facingKind,
    door: p.facingDoor,
    distance: p.facingDistance,
  });
}

export function formatFacingProbe(tic: number, probe?: FacingProbe): string {
  const unavailable = 'Facing probe: unavailable at this verified frame.';
  if (!probe || probe.tic !== tic || probe.kind < 1 || probe.kind > 5)
    return unavailable;
  if (probe.kind === 1)
    return 'Facing probe: no relevant line detected on the forward center ray within 64 Doom units; full player clearance unknown.';
  if (
    !Number.isInteger(probe.distance) ||
    probe.distance < 0 ||
    probe.distance > 64
  )
    return unavailable;
  const descriptions: Record<number, string> = {
    2: 'solid line',
    3: 'opening/clearance restriction',
    4: 'recognized manual-door boundary',
    5: 'other special line; physical meaning unknown',
  };
  let text = `Facing probe (within 64 Doom units): ${descriptions[probe.kind]} about ${probe.distance} units ahead.`;
  if (probe.door === 1 && probe.kind !== 4)
    text += ' Recognized manual-door metadata; usability unknown.';
  else if (probe.door === 1) text += ' Usability unknown.';
  else if (probe.door === 2)
    text +=
      ' Front-side manual-door use candidate; use may be possible, keys and door activity unknown.';
  return `${text} Center ray only; full player clearance unknown.`;
}
