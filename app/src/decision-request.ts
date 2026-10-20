import type { ActionName } from './decision.ts';
import { masks } from './decision.ts';
import type { DecisionRequest } from './decision-provider.ts';
import { type FacingProbe, formatFacingProbe } from './facing-probe.ts';
import type { PreviousActionOutcome } from './previous-action.ts';
import type { NativeObservation } from './worker-shared.ts';

export const defaultDecisionInstructionTemplate =
  'Explore the Doom level, find the exit, and survive. Choose one useful action based on the current screenshot and any verified game-state observations. Favor progress and survival over movement for its own sake. Choose neutral when waiting is tactically useful. The human has selected exactly {{tics}} gameplay tics for this action. Choose only the action, not its duration. The game does not advance while you are deciding. Do not assume unseen or unverified game state.';

export type DecisionConfiguration = Readonly<{
  instructionTemplate: string;
  includeReadyWeapon: boolean;
  includeAmmo: boolean;
  includeHealth: boolean;
  includePreviousAction: boolean;
  includeFacingProbe: boolean;
}>;

export const defaultDecisionConfiguration: DecisionConfiguration =
  Object.freeze({
    instructionTemplate: defaultDecisionInstructionTemplate,
    includeReadyWeapon: false,
    includeAmmo: false,
    includeHealth: false,
    includePreviousAction: false,
    includeFacingProbe: false,
  });

type StateTelemetry = Pick<
  NativeObservation,
  'readyWeapon' | 'ammo' | 'health'
>;

const quantity = (value: number | undefined): string =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : 'unavailable';

function formatReadyWeapon(weapon: StateTelemetry['readyWeapon']): string {
  if (!weapon) return 'unavailable';
  const name = weapon.name === 'unknown' ? 'unavailable' : weapon.name;
  const ammoType =
    weapon.ammoType === 'unknown' ? 'unavailable' : weapon.ammoType;
  return `${name} (id: ${quantity(weapon.id)}; ammo type: ${ammoType})`;
}

function formatAmmo(ammo: StateTelemetry['ammo']): string {
  if (!ammo) return 'unavailable';
  return (
    (['bullets', 'shells', 'cells', 'rockets'] as const)
      .filter((type) => ammo[type].current > 0)
      .map(
        (type) =>
          `${type} ${quantity(ammo[type].current)}/${quantity(ammo[type].max)}`,
      )
      .join('; ') || 'none'
  );
}

export function resolveDecisionInstructions(
  tics: number,
  template = defaultDecisionInstructionTemplate,
): string {
  return template.replace(/\{\{tics\}\}/g, String(tics));
}

export function formatDecisionState(
  verifiedTic: number,
  configuration: Pick<
    DecisionConfiguration,
    | 'includeReadyWeapon'
    | 'includeAmmo'
    | 'includeHealth'
    | 'includePreviousAction'
    | 'includeFacingProbe'
  > = defaultDecisionConfiguration,
  telemetry?: StateTelemetry,
  previousAction?: PreviousActionOutcome,
  facingProbe?: FacingProbe,
): string {
  const context = [
    `Current rendered Doom frame at verified tic ${verifiedTic}.`,
  ];
  if (configuration.includeReadyWeapon)
    context.push(
      `Ready weapon: ${formatReadyWeapon(telemetry?.readyWeapon ?? null)}`,
    );
  if (configuration.includeAmmo)
    context.push(`Ammo: ${formatAmmo(telemetry?.ammo ?? null)}`);
  if (configuration.includeHealth)
    context.push(`Health: ${quantity(telemetry?.health)}`);
  if (
    configuration.includePreviousAction &&
    previousAction?.endTic === verifiedTic
  )
    context.push(previousAction.text);
  if (configuration.includeFacingProbe)
    context.push(formatFacingProbe(verifiedTic, facingProbe));
  return context.join('\n');
}

export function buildDefaultDecisionRequest(
  verifiedTic: number,
  tics: number,
  png: string,
  permittedActions: readonly ActionName[] = Object.keys(masks) as ActionName[],
  configuration = defaultDecisionConfiguration,
  telemetry?: StateTelemetry,
  previousAction?: PreviousActionOutcome,
  facingProbe?: FacingProbe,
): DecisionRequest {
  return Object.freeze({
    instructions: resolveDecisionInstructions(
      tics,
      configuration.instructionTemplate,
    ),
    context: formatDecisionState(
      verifiedTic,
      configuration,
      telemetry,
      previousAction,
      facingProbe,
    ),
    png,
    permittedActions: Object.freeze([...permittedActions]),
  });
}
