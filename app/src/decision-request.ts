import type { DecisionCreateParams } from 'openai/resources/decisions';
import { masks } from './decision.ts';

export function buildDefaultDecisionRequest(
  verifiedTic: number,
  tics: number,
  png: string,
): DecisionCreateParams {
  return {
    model: 'gpt-6-luna',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `This is the currently rendered Doom E1M1 frame at verified tic ${verifiedTic}. You have only this image, not full game state.`,
          },
          { type: 'input_image', image_url: png },
        ],
      },
    ],
    questions: [
      {
        type: 'choice',
        name: 'next_action',
        instructions: `Explore the level and progress toward the exit while surviving. Choose one useful action from the screenshot; moving or turning to explore is generally preferable to standing still. Choose neutral when waiting has a tactical benefit. The human selected exactly ${tics} gameplay tics for this action. Choose only the action, never its duration. The game advances only through verified actions admitted by manual steps or explicitly started continuous mode; API waits do not advance gameplay. Do not assume unseen game state.`,
        choices: Object.keys(masks).map((value) => ({ value })),
      },
    ],
  };
}
