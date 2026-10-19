import { describe, expect, it, vi } from 'vitest';
import {
  buildDefaultDecisionRequest,
  defaultDecisionConfiguration,
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
                text: `Current rendered Doom E1M1 frame at verified tic ${tic}.`,
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
      const input = buildDefaultDecisionRequest(73, n, 'data:image/png;base64,local', undefined, { ...defaultDecisionConfiguration, instructionTemplate: template });
      expect(input.instructions).toBe(expected);
      const wire = encodeOpenAIDecisionRequest(input);
      expect(wire.questions[0].instructions).toBe(expected);
      expect(wire.questions[0].choices).toEqual(input.permittedActions.map(value => ({ value })));
    }
  }
});

it('keeps obsolete telemetry placeholders literal, even when state telemetry is enabled', () => {
  const instructionTemplate = '{{tics}} {{readyWeapon}} {{ammo}} {{tics}}';
  const input = buildDefaultDecisionRequest(73, 6, 'data:image/png;base64,local', undefined, {
    instructionTemplate, includeReadyWeapon: true, includeAmmo: true, includeHealth: true,
  });
  expect(input.instructions).toBe('6 {{readyWeapon}} {{ammo}} 6');
  expect(encodeOpenAIDecisionRequest(input).questions[0].instructions).toBe(input.instructions);
});

it.each([
  { health: 100, expected: '100' },
  { health: 0, expected: '0' },
  { health: 200, expected: '200' },
  { health: -1, expected: 'unavailable' },
  { health: undefined, expected: 'unavailable' },
])('includes optional health without changing instructions ($health)', ({ health, expected }) => {
  const telemetry = health === undefined ? undefined : { health, readyWeapon: null, ammo: null };
  const context = 'Current rendered Doom E1M1 frame at verified tic 73.';
  expect(defaultDecisionConfiguration.includeHealth).toBe(false);
  const disabled = buildDefaultDecisionRequest(73, 6, 'png', undefined, defaultDecisionConfiguration, telemetry);
  expect(disabled.context).toBe(context);
  const enabled = buildDefaultDecisionRequest(73, 6, 'png', undefined, { ...defaultDecisionConfiguration, includeHealth: true }, telemetry);
  expect(enabled.context).toBe(`${context}\nHealth: ${expected}`);
  expect(enabled.instructions).toBe(disabled.instructions);
});

it('reports unavailable state telemetry explicitly without inventing weapon or ammo values', () => {
  const configuration = { ...defaultDecisionConfiguration, includeReadyWeapon: true, includeAmmo: true };
  const request = telemetry => buildDefaultDecisionRequest(73, 6, 'data:image/png;base64,local', undefined, configuration, telemetry);
  expect(request(undefined).context).toBe(
    'Current rendered Doom E1M1 frame at verified tic 73.\nReady weapon: unavailable\nAmmo: unavailable',
  );
  expect(request({
    health: 100, readyWeapon: { id: -1, name: 'unknown', ammoType: 'unknown' }, ammo: null,
  }).context).toContain('Ready weapon: unavailable (id: unavailable; ammo type: unavailable)');
  expect(request({
    health: 100, readyWeapon: { id: 0, name: 'fist', ammoType: 'none' }, ammo: null,
  }).context).toContain('Ready weapon: fist (id: 0; ammo type: none)');
});

it.each([
  { counts: [49, 0, 0, 0], expected: 'Ammo: bullets 49/200' },
  { counts: [0, 4, 0, 0], expected: 'Ammo: shells 4/50' },
  { counts: [0, 4, 0, 2], expected: 'Ammo: shells 4/50; rockets 2/50' },
  { counts: [0, 0, 0, 0], expected: 'Ammo: none' },
  { counts: null, expected: 'Ammo: unavailable' },
  { counts: undefined, expected: 'Ammo: unavailable' },
])('includes only positive current ammo in outgoing state: $expected ($counts)', ({ counts, expected }) => {
  const telemetry = counts === undefined ? undefined : {
    health: 100,
    readyWeapon: null,
    ammo: counts === null ? null : {
      bullets: { current: counts[0], max: 200 },
      shells: { current: counts[1], max: 50 },
      cells: { current: counts[2], max: 300 },
      rockets: { current: counts[3], max: 50 },
    },
  };
  const input = buildDefaultDecisionRequest(73, 6, 'data:image/png;base64,local', undefined, {
    ...defaultDecisionConfiguration, includeAmmo: true,
  }, telemetry);
  const context = `Current rendered Doom E1M1 frame at verified tic 73.\n${expected}`;
  expect(input.context).toBe(context);
  const wire = encodeOpenAIDecisionRequest(input);
  expect(wire.input).toEqual([{ role: 'user', content: [
    { type: 'input_text', text: context },
    { type: 'input_image', image_url: input.png },
  ] }]);
  expect(wire.questions[0].instructions).toBe(resolveDecisionInstructions(6));
});

it('forwards optional state and exact resolved instructions through the real OpenAI SDK to fake-fetch JSON', async () => {
  const telemetry = {
    health: 87,
    readyWeapon: { id: 2, name: 'shotgun', ammoType: 'shells' },
    ammo: {
      bullets: { current: 13, max: 201 }, shells: { current: 7, max: 51 },
      cells: { current: 123, max: 301 }, rockets: { current: 9, max: 52 },
    },
  } as const;
  const png = 'data:image/png;base64,local';
  try {
    for (const includeReadyWeapon of [false, true]) {
      for (const includeAmmo of [false, true]) {
        const configuration = { instructionTemplate: '  Use {{tics}} tics. Again {{tics}}.  ', includeReadyWeapon, includeAmmo, includeHealth: includeAmmo };
        const fetch = vi.fn(async (_url, init) => {
          const wire = JSON.parse(init.body);
          const expected = ['Current rendered Doom E1M1 frame at verified tic 73.'];
          if (includeReadyWeapon) expected.push('Ready weapon: shotgun (id: 2; ammo type: shells)');
          if (includeAmmo) expected.push('Ammo: bullets 13/201; shells 7/51; cells 123/301; rockets 9/52');
          if (configuration.includeHealth) expected.push('Health: 87');
          expect(wire.input).toEqual([{ role: 'user', content: [
            { type: 'input_text', text: expected.join('\n') },
            { type: 'input_image', image_url: png },
          ] }]);
          expect(wire.questions[0].instructions).toBe('  Use 6 tics. Again 6.  ');
          expect(wire.questions[0].choices).toEqual(['neutral', 'forward', 'turn_right', 'backward', 'turn_left', 'fire', 'use'].map(value => ({ value })));
          return new Response(JSON.stringify({ answers: [{ type: 'choice', name: 'next_action', choice: 'neutral' }] }), { headers: { 'content-type': 'application/json' } });
        });
        vi.stubGlobal('fetch', fetch);
        const provider = openAiDecisionProviderFactory.create('offline-not-a-credential');
        const lifecycle = {};
        await provider.request(buildDefaultDecisionRequest(73, 6, png, undefined, configuration, telemetry), lifecycle, { requestId: null, http: null, latencyMs: null },
          { assertFresh() {}, beforeCreate() {}, onReadStateChange() {} }, performance.now());
        await lifecycle.sdkRead;
        expect(fetch).toHaveBeenCalledTimes(1);
      }
    }
  } finally { vi.unstubAllGlobals(); }
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
