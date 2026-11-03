import type { createLandmarksAgent } from './landmarks-tool-loop-agent.ts';
import { validateSelection, type LandmarkReceipt } from './landmarks-tool.ts';

export async function inspectLandmarksCompletion(
  result: Awaited<ReturnType<ReturnType<typeof createLandmarksAgent>['stream']>>,
  receipts: LandmarkReceipt[],
) {
  const [text, steps, finish, rawFinish] = await Promise.allSettled([
    result.text, result.steps, result.finishReason, result.rawFinishReason,
  ]);
  const validation = text.status === 'fulfilled' ? validateSelection(text.value, receipts) : null;
  return {
    output: { nonempty: text.status === 'fulfilled' && text.value.trim().length > 0,
      characters: text.status === 'fulfilled' ? text.value.length : null },
    sdkSteps: steps.status === 'fulfilled' ? steps.value.length : 0,
    finishReason: finish.status === 'fulfilled' ? finish.value : null,
    // Raw provider reasons are arbitrary strings; retain only known safe enums.
    rawFinishReason: rawFinish.status === 'fulfilled' &&
      ['completed', 'end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'].includes(rawFinish.value ?? '') ? rawFinish.value ?? null : null,
    metadataUnavailable: [text, steps, finish, rawFinish].flatMap((value, index) =>
      value.status === 'rejected' ? [['text', 'steps', 'finishReason', 'rawFinishReason'][index]] : []),
    validation,
    modelFinalJSON: validation?.ok ? JSON.stringify(validation.selection) : null,
    error: text.status === 'rejected' ? 'TEXT_UNAVAILABLE' : validation && !validation.ok ? validation.error :
      [steps, finish, rawFinish].some(value => value.status === 'rejected') ? 'SDK_METADATA_UNAVAILABLE' : null,
  };
}
