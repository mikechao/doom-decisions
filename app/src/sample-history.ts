// Synthetic presentation data only. Never submit these requests or use these
// entries as controller/native evidence. No screenshot or API call was made.
import type { ActionName } from './decision';
import type { DecisionHistoryElement } from './decision-history';

type HistoryDisplay = Parameters<DecisionHistoryElement['display']>;
const actions: readonly ActionName[] = [
  'neutral',
  'forward',
  'turn_right',
  'backward',
  'turn_left',
  'fire',
  'use',
];
const samples: readonly {
  action: ActionName;
  latencyMs: number;
  context: string;
}[] = [
  { action: 'forward', latencyMs: 342, context: 'Explore an open passage.' },
  {
    action: 'turn_right',
    latencyMs: 1280,
    context: 'Compare two possible routes at an illustrative junction.',
  },
  { action: 'fire', latencyMs: 96, context: 'Respond to an imagined threat.' },
  {
    action: 'backward',
    latencyMs: 4912,
    context:
      'Create room to maneuver in a hypothetical narrow passage. Favor a short retreat before reassessing the route and deciding whether to turn or continue exploring.',
  },
  {
    action: 'turn_left',
    latencyMs: 760,
    context: 'Inspect an illustrative side passage before moving ahead.',
  },
  {
    action: 'use',
    latencyMs: 2184,
    context:
      'Try a hypothetical nearby door. Choose a single interaction without combining it with movement or assuming the door will open.',
  },
  {
    action: 'neutral',
    latencyMs: 587,
    context: 'Wait briefly for an imagined moving obstacle to clear.',
  },
  {
    action: 'turn_left',
    latencyMs: 20460,
    context:
      'Reassess a hypothetical route after reaching a dead end. Compare turning toward a side passage with retreating along the previous route. The next observation would determine whether the new route is useful; no unseen state is assumed.',
  },
  {
    action: 'forward',
    latencyMs: 13542,
    context: 'Continue along an illustrative corridor toward a junction.',
  },
  {
    action: 'fire',
    latencyMs: 1703,
    context:
      'Hold position and address a hypothetical threat before advancing.',
  },
  {
    action: 'use',
    latencyMs: 8060,
    context:
      'Interact with an imagined switch beside a closed passage. A later observation would be needed to determine whether this affects a door, lift or another part of the hypothetical route.',
  },
  {
    action: 'forward',
    latencyMs: 2356,
    context:
      'Proceed through an illustrative open doorway. Keep the next movement bounded so the route can be reassessed from a new observation before choosing another action.',
  },
];
// Percent weights, rotated so the selected action always has the largest share.
const probabilityWeights = [
  [64, 18, 8, 4, 3, 2, 1],
  [43, 24, 14, 8, 6, 4, 1],
  [89, 4, 3, 2, 1, 0.75, 0.25],
];
const models = [
  'sample/ui-preview-scout',
  'sample/ui-preview-tactical-long-context',
  'sample/ui-preview-pathfinder',
];

let tic = 1;
export const entries: HistoryDisplay[0] = samples.map((sample, index) => {
  const number = index + 1;
  const selectedTics = number % 3 === 0 ? 20 : 6;
  const observation = { tic };
  tic += selectedTics;
  const weights = probabilityWeights[index % probabilityWeights.length];
  const selectedIndex = actions.indexOf(sample.action);
  const model = models[index % models.length];
  const inputTokens = 900 + number * 37 + sample.context.length * 3;
  const outputTokens = 14 + number * 2;
  return {
    number,
    selectedTics,
    stage: 'completed',
    status:
      'Sample: synthetic completion for UI preview only; no native or API proof',
    action: sample.action,
    observation,
    result: { tic },
    execution: {
      complete: true,
      requestedTics: selectedTics,
      reportedCompletedTics: selectedTics,
      independentlyVerifiedTics: selectedTics,
      completionUncertain: false,
    },
    cumulativeVerifiedTics: tic,
    requestId: `sample-ui-preview-${number}`,
    latencyMs: sample.latencyMs,
    http: 200,
    sdkInvoked: true,
    requestIdentity: { provider: 'OpenRouter', requestedModel: model },
    responseMetadata: {
      reportedModel: `${model}-response`,
      usage: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
    },
    choice: {
      confidence: weights[0] / 100,
      probabilities: actions.map((value, actionIndex) => ({
        value,
        probability:
          weights[
            (actionIndex - selectedIndex + actions.length) % actions.length
          ] / 100,
      })),
    },
  };
});

export const requests: HistoryDisplay[1] = Object.fromEntries(
  entries.map((entry, index) => [
    entry.number,
    {
      instructions: `SAMPLE DATA · UI PREVIEW. Synthetic request #${entry.number}; no request was sent. Choose one of the seven permitted actions for exactly ${entry.selectedTics} human-selected tics. ${samples[index].context} Select only an action, never duration or combined inputs.`,
      context: `Synthetic decision #${entry.number}, illustrative observation tic ${entry.observation?.tic}. Design scenario: ${samples[index].context}\nNo Doom session, observation or screenshot exists for this sample. All completion receipts, model metadata and token counts are synthetic UI data, not native or API proof.`,
      png: '',
      permittedActions: actions,
    },
  ]),
);
