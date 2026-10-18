import type { ActionName } from './decision.ts';
import { masks } from './decision.ts';
import type { DecisionRequest } from './decision-provider.ts';

export const defaultDecisionInstructionTemplate =
  'Explore the level and progress toward the exit while surviving. Choose one useful action from the screenshot; moving or turning to explore is generally preferable to standing still. Choose neutral when waiting has a tactical benefit. The human selected exactly {{tics}} gameplay tics for this action. Choose only the action, never its duration. The game advances only through verified actions admitted by manual steps or explicitly started continuous mode; API waits do not advance gameplay. Do not assume unseen game state.';

export function resolveDecisionInstructions(
  tics: number,
  template = defaultDecisionInstructionTemplate,
): string {
  return template.replaceAll('{{tics}}', String(tics));
}

export function buildDefaultDecisionRequest(
  verifiedTic: number,
  tics: number,
  png: string,
  permittedActions: readonly ActionName[] = Object.keys(masks) as ActionName[],
  template = defaultDecisionInstructionTemplate,
): DecisionRequest {
  return Object.freeze({
    instructions: resolveDecisionInstructions(tics, template),
    context: `This is the currently rendered Doom E1M1 frame at verified tic ${verifiedTic}. You have only this image, not full game state.`,
    png,
    permittedActions: Object.freeze([...permittedActions]),
  });
}
