import { describe, expect, it } from 'vitest';
import { buildDefaultDecisionRequest } from '../src/decision-request.ts';

describe('buildDefaultDecisionRequest', () => {
  it.each([
    { tic: 1, n: 6, png: 'data:image/png;base64,first' },
    { tic: 73, n: 2, png: 'data:image/png;base64,second' },
    { tic: 999, n: Number.MAX_SAFE_INTEGER, png: 'data:image/png;base64,third' },
  ])(
    'preserves the whole request and isolates mutable trees (tic $tic, N $n)',
    ({ tic, n, png }) => {
      // Independent oracle: literal prompt, model, and ordered action choices.
      const expected = {
        model: 'gpt-6-luna',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `This is the currently rendered Doom E1M1 frame at verified tic ${tic}. You have only this image, not full game state.`,
              },
              { type: 'input_image', image_url: png },
            ],
          },
        ],
        questions: [
          {
            type: 'choice',
            name: 'next_action',
            instructions: `Explore the level and progress toward the exit while surviving. Choose one useful action from the screenshot; moving or turning to explore is generally preferable to standing still. Choose neutral when waiting has a tactical benefit. The human selected exactly ${n} gameplay tics for this action. Choose only the action, never its duration. The game advances only through verified actions admitted by manual steps or explicitly started continuous mode; API waits do not advance gameplay. Do not assume unseen game state.`,
            choices: [
              { value: 'neutral' },
              { value: 'forward' },
              { value: 'turn_right' },
              { value: 'backward' },
              { value: 'turn_left' },
              { value: 'fire' },
              { value: 'use' },
            ],
          },
        ],
      };
      const first = buildDefaultDecisionRequest(tic, n, png);
      const second = buildDefaultDecisionRequest(tic, n, png);
      expect(first).toStrictEqual(expected);
      expect(second).toStrictEqual(first);

      // Whole-body equality above establishes this shape within the SDK unions.
      const mutable = first as typeof expected;
      const untouched = second as typeof expected;
      expect(first).not.toBe(second);
      expect(mutable.input).not.toBe(untouched.input);
      expect(mutable.input[0]).not.toBe(untouched.input[0]);
      expect(mutable.input[0].content).not.toBe(untouched.input[0].content);
      for (const [index, part] of mutable.input[0].content.entries()) {
        expect(part).not.toBe(untouched.input[0].content[index]);
      }
      expect(mutable.questions).not.toBe(untouched.questions);
      expect(mutable.questions[0]).not.toBe(untouched.questions[0]);
      expect(mutable.questions[0].choices).not.toBe(
        untouched.questions[0].choices,
      );
      for (const [index, choice] of mutable.questions[0].choices.entries()) {
        expect(choice).not.toBe(untouched.questions[0].choices[index]);
      }

      mutable.input[0].content[0].text = 'mutated';
      mutable.questions[0].choices[0].value = 'mutated';
      expect(second).toStrictEqual(expected);
      expect(buildDefaultDecisionRequest(tic, n, png)).toStrictEqual(expected);
    },
  );
});
