import type { ActionName } from './decision.ts';
import { masks } from './decision.ts';
import type { DecisionRequest } from './decision-provider.ts';
import type { NativeObservation } from './worker-shared.ts';

export const defaultDecisionInstructionTemplate =
  'Explore the level and progress toward the exit while surviving. Choose one useful action from the screenshot; moving or turning to explore is generally preferable to standing still. Choose neutral when waiting has a tactical benefit. The human selected exactly {{tics}} gameplay tics for this action. Choose only the action, never its duration. The game advances only through verified actions admitted by manual steps or explicitly started continuous mode; API waits do not advance gameplay. Do not assume unseen game state.';

type PromptTelemetry = Pick<NativeObservation, 'readyWeapon' | 'ammo'>;

const quantity = (value: number | undefined): string =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : 'unavailable';

function formatReadyWeapon(weapon: PromptTelemetry['readyWeapon']): string {
  if (!weapon) return 'unavailable';
  const name = weapon.name === 'unknown' ? 'unavailable' : weapon.name;
  const ammoType =
    weapon.ammoType === 'unknown' ? 'unavailable' : weapon.ammoType;
  return `${name} (id: ${quantity(weapon.id)}; ammo type: ${ammoType})`;
}

function formatAmmo(ammo: PromptTelemetry['ammo']): string {
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
  telemetry?: PromptTelemetry,
): string {
  const values = {
    tics: String(tics),
    readyWeapon: formatReadyWeapon(telemetry?.readyWeapon ?? null),
    ammo: formatAmmo(telemetry?.ammo ?? null),
  };
  return template.replace(
    /\{\{(tics|readyWeapon|ammo)\}\}/g,
    (_token, key: keyof typeof values) => values[key],
  );
}

export function buildDefaultDecisionRequest(
  verifiedTic: number,
  tics: number,
  png: string,
  permittedActions: readonly ActionName[] = Object.keys(masks) as ActionName[],
  template = defaultDecisionInstructionTemplate,
  telemetry?: PromptTelemetry,
): DecisionRequest {
  return Object.freeze({
    instructions: resolveDecisionInstructions(tics, template, telemetry),
    context: `This is the currently rendered Doom E1M1 frame at verified tic ${verifiedTic}. You have only this image, not full game state.`,
    png,
    permittedActions: Object.freeze([...permittedActions]),
  });
}
