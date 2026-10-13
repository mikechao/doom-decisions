// Pure request construction only; no SDK execution or network.
import assert from 'node:assert/strict';
import { buildDefaultDecisionRequest } from '../src/decision-request.ts';

// Independent whole-body oracle, including the literal prompt and choice order.
function expected(tic, n, png) {
  return {
    model: 'gpt-6-luna',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: `This is the currently rendered Doom E1M1 frame at verified tic ${tic}. You have only this image, not full game state.` },
        { type: 'input_image', image_url: png },
      ],
    }],
    questions: [{
      type: 'choice',
      name: 'next_action',
      instructions: `Explore the level and progress toward the exit while surviving. Choose one useful action from the screenshot; moving or turning to explore is generally preferable to standing still. Choose neutral when waiting has a tactical benefit. The human selected exactly ${n} gameplay tics for this action. Choose only the action, never its duration. The game advances only through verified actions admitted by manual steps or explicitly started continuous mode; API waits do not advance gameplay. Do not assume unseen game state.`,
      choices: [
        { value: 'neutral' }, { value: 'forward' }, { value: 'turn_right' },
        { value: 'backward' }, { value: 'turn_left' }, { value: 'fire' }, { value: 'use' },
      ],
    }],
  };
}
function assertFreshTree(first, second) {
  if (!first || typeof first !== 'object') return;
  assert.notEqual(first, second, 'Every nested object/array is fresh');
  for (const key of Object.keys(first)) assertFreshTree(first[key], second[key]);
}
for (const [tic, n, png] of [
  [1, 6, 'data:image/png;base64,first'],
  [73, 2, 'data:image/png;base64,second'],
  [999, Number.MAX_SAFE_INTEGER, 'data:image/png;base64,third'],
]) {
  const first = buildDefaultDecisionRequest(tic, n, png);
  const second = buildDefaultDecisionRequest(tic, n, png);
  assert.deepEqual(first, expected(tic, n, png));
  assert.deepEqual(second, first);
  assertFreshTree(first, second);
  first.input[0].content[0].text = 'mutated';
  first.questions[0].choices[0].value = 'mutated';
  assert.deepEqual(second, expected(tic, n, png));
  assert.deepEqual(buildDefaultDecisionRequest(tic, n, png), second);
}
console.log('Default whole-body fidelity, substitutions, choice order and fresh request trees passed.');
