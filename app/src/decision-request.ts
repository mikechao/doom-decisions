import type { ActionName } from './decision.ts';
import { masks } from './decision.ts';
import type { DecisionRequest } from './decision-provider.ts';
import type { NativeObservation } from './worker-shared.ts';

export const defaultDecisionInstructionTemplate =
  'Explore the level and progress toward the exit while surviving. Choose one useful action from the screenshot; moving or turning to explore is generally preferable to standing still. Choose neutral when waiting has a tactical benefit. The human selected exactly {{tics}} gameplay tics for this action. Choose only the action, never its duration. The game advances only through verified actions admitted by manual steps or explicitly started continuous mode; API waits do not advance gameplay. Do not assume unseen game state.';

export type DecisionConfiguration = Readonly<{
  instructionTemplate: string;
  includeReadyWeapon: boolean;
  includeAmmo: boolean;
}>;

export const defaultDecisionConfiguration: DecisionConfiguration =
  Object.freeze({
    instructionTemplate: defaultDecisionInstructionTemplate,
    includeReadyWeapon: false,
    includeAmmo: false,
  });

type StateTelemetry = Pick<NativeObservation, 'readyWeapon' | 'ammo'>;

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
  return (['bullets', 'shells', 'cells', 'rockets'] as const)
    .map(
      (type) =>
        `${type} ${quantity(ammo?.[type]?.current)}/${quantity(ammo?.[type]?.max)}`,
    )
    .join('; ');
}

export function resolveDecisionInstructions(
  tics: number,
  template = defaultDecisionInstructionTemplate,
): string {
  return template.replace(/\{\{tics\}\}/g, String(tics));
}

export function buildDefaultDecisionRequest(
  verifiedTic: number,
  tics: number,
  png: string,
  permittedActions: readonly ActionName[] = Object.keys(masks) as ActionName[],
  configuration = defaultDecisionConfiguration,
  telemetry?: StateTelemetry,
): DecisionRequest {
  const context = [
    `Current rendered Doom E1M1 frame at verified tic ${verifiedTic}.`,
  ];
  if (configuration.includeReadyWeapon)
    context.push(
      `Ready weapon: ${formatReadyWeapon(telemetry?.readyWeapon ?? null)}`,
    );
  if (configuration.includeAmmo)
    context.push(`Ammo: ${formatAmmo(telemetry?.ammo ?? null)}`);
  return Object.freeze({
    instructions: resolveDecisionInstructions(
      tics,
      configuration.instructionTemplate,
    ),
    context: context.join('\n'),
    png,
    permittedActions: Object.freeze([...permittedActions]),
  });
}
