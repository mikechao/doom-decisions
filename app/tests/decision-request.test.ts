import { describe, expect, it, vi } from 'vitest';
import {
  buildDefaultDecisionRequest,
  defaultDecisionInstructionTemplate,
  resolveDecisionInstructions,
} from '../src/decision-request.ts';
import { validateChoice } from '../src/decision.ts';
import {
  decodeOpenAIDecision,
  encodeOpenAIDecisionRequest,
  openAiDecisionProviderFactory,
} from '../src/openai-decision-provider.ts';

describe('buildDefaultDecisionRequest', () => {
  it.each([
    { tic: 1, n: 6, png: 'data:image/png;base64,first' },
    { tic: 73, n: 2, png: 'data:image/png;base64,second' },
    { tic: 1, n: 1, png: 'data:image/png;base64,one' },
    { tic: 73, n: 35, png: 'data:image/png;base64,thirty-five' },
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
      const first = encodeOpenAIDecisionRequest(
        buildDefaultDecisionRequest(tic, n, png),
      );
      const second = encodeOpenAIDecisionRequest(
        buildDefaultDecisionRequest(tic, n, png),
      );
      expect(first).toStrictEqual(expected);
      expect(resolveDecisionInstructions(n)).toBe(
        expected.questions[0].instructions,
      );
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
      expect(
        encodeOpenAIDecisionRequest(buildDefaultDecisionRequest(tic, n, png)),
      ).toStrictEqual(expected);
    },
  );
});

it('resolves every literal {{tics}} and preserves other template text', () => {
  expect(defaultDecisionInstructionTemplate).toContain('exactly {{tics}} gameplay tics');
  for (const n of [6, 35]) {
    for (const [template, expected] of [
      ['Use fire', 'Use fire'],
      ['  Follow corridors.\nLook for doors.  ', '  Follow corridors.\nLook for doors.  '],
      ['Fire for {{tics}} tics; choose wisely.', `Fire for ${n} tics; choose wisely.`],
      ['  {{tics}} tics.\nAgain: {{tics}}. {{unknown}}  ', `  ${n} tics.\nAgain: ${n}. {{unknown}}  `],
    ]) {
      const input = buildDefaultDecisionRequest(73, n, 'data:image/png;base64,local', undefined, template);
      expect(input.instructions).toBe(expected);
      const wire = encodeOpenAIDecisionRequest(input);
      expect(wire.questions[0].instructions).toBe(expected);
      expect(wire.questions[0].choices).toEqual(input.permittedActions.map(value => ({ value })));
    }
  }
});

it('resolves only explicitly requested player telemetry in deterministic order', () => {
  const telemetry = {
    readyWeapon: { id: 2, name: 'shotgun', ammoType: 'shells' },
    ammo: {
      bullets: { current: 13, max: 201 }, shells: { current: 7, max: 51 },
      cells: { current: 123, max: 301 }, rockets: { current: 9, max: 52 },
    },
  } as const;
  const weapon = 'shotgun (id: 2; ammo type: shells)';
  const ammo = 'bullets 13/201; shells 7/51; cells 123/301; rockets 9/52';
  for (const [template, expected] of [
    ['Use fire', 'Use fire'],
    ['Ready weapon: {{readyWeapon}}', `Ready weapon: ${weapon}`],
    ['Ammo: {{ammo}}', `Ammo: ${ammo}`],
    ['  {{tics}}: {{readyWeapon}}\n{{ammo}}\n{{readyWeapon}} {{ammo}}  ', `  6: ${weapon}\n${ammo}\n${weapon} ${ammo}  `],
  ]) {
    const input = buildDefaultDecisionRequest(73, 6, 'data:image/png;base64,local', undefined, template, telemetry);
    expect(input.instructions).toBe(expected);
    expect(encodeOpenAIDecisionRequest(input).questions[0].instructions).toBe(expected);
  }
});

it('reports unavailable telemetry explicitly without inventing weapon or ammo values', () => {
  expect(resolveDecisionInstructions(6, 'Ready weapon: {{readyWeapon}}\nAmmo: {{ammo}}')).toBe(
    'Ready weapon: unavailable\nAmmo: bullets unavailable/unavailable; shells unavailable/unavailable; cells unavailable/unavailable; rockets unavailable/unavailable',
  );
  expect(resolveDecisionInstructions(6, '{{readyWeapon}}', {
    readyWeapon: { id: -1, name: 'unknown', ammoType: 'unknown' }, ammo: null,
  })).toBe('unavailable (id: unavailable; ammo type: unavailable)');
  expect(resolveDecisionInstructions(6, '{{readyWeapon}}', {
    readyWeapon: { id: 0, name: 'fist', ammoType: 'none' }, ammo: null,
  })).toBe('fist (id: 0; ammo type: none)');
});

it('builds only immutable domain evidence without telemetry or wire fields', () => {
  const input = buildDefaultDecisionRequest(73, 35, 'data:image/png;base64,local');
  expect(Object.keys(input).sort()).toEqual([
    'context', 'instructions', 'permittedActions', 'png',
  ]);
  expect(input.permittedActions).toEqual([
    'neutral', 'forward', 'turn_right', 'backward', 'turn_left', 'fire', 'use',
  ]);
  expect(Object.isFrozen(input)).toBe(true);
  expect(Object.isFrozen(input.permittedActions)).toBe(true);
  expect(input.permittedActions).not.toBe(
    buildDefaultDecisionRequest(73, 35, input.png).permittedActions,
  );
});

it('decodes OpenAI envelopes and retains refusal and malformed-answer handling', () => {
  const answer = (choice) => ({
    answers: [{ type: 'choice', name: 'next_action', choice }],
  });
  for (const action of ['neutral', 'forward', 'turn_right', 'backward', 'turn_left', 'fire', 'use'])
    expect(validateChoice(decodeOpenAIDecision(answer(action))).action).toBe(action);
  expect(
    decodeOpenAIDecision({ answers: [{ type: 'refusal', name: 'next_action' }] }),
  ).toEqual({ kind: 'refusal' });
  for (const data of [
    answer(true),
    answer('1'),
    answer('forward+fire'),
    answer('__proto__'),
    { answers: [] },
    { answers: [{ type: 'choice', name: 'other', choice: 'neutral' }] },
    { answers: [answer('neutral').answers[0], answer('fire').answers[0]] },
  ])
    expect(() => validateChoice(decodeOpenAIDecision(data))).toThrow();
  const wire = answer('fire');
  Object.assign(wire.answers[0], {
    confidence: 0.7, probabilities: 'untrusted-metric',
  });
  expect(decodeOpenAIDecision(wire)).toEqual({
    kind: 'choice', action: 'fire', confidence: 0.7, probabilities: 'untrusted-metric',
  });
});

it('includes synchronous OpenAI wire encoding in the original deadline without charging expired requests', async () => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  const fetch = vi.fn(async () => { throw Error('Unexpected offline transport'); });
  vi.stubGlobal('fetch', fetch);
  try {
    const provider = openAiDecisionProviderFactory.create('offline-not-a-credential');
    const input = buildDefaultDecisionRequest(1, 6, 'data:image/png;base64,local');
    const lifecycle = {};
    const diagnostics = { requestId: null, http: null, latencyMs: null };
    const beforeCreate = vi.fn();
    const startedAt = performance.now();
    await expect(provider.request(
      {
        ...input,
        get context() {
          vi.advanceTimersByTime(10000); // Synchronous wire construction work.
          return input.context;
        },
      },
      lifecycle,
      diagnostics,
      { assertFresh() {}, beforeCreate, onReadStateChange() {} },
      startedAt,
    )).rejects.toThrow('API deadline exceeded (10 seconds)');
    expect(beforeCreate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(diagnostics.latencyMs).toBe(10000);
    expect(lifecycle).toEqual({ apiController: undefined });
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
