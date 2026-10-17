import type { SessionPresentation } from './session-controller';

type DecisionReadiness = Pick<
  NonNullable<SessionPresentation['session']>,
  'phase' | 'prepared' | 'hasClient' | 'controls'
>;

export type DecisionControlsPresentation = Readonly<{
  bannerText: string | null;
  buttonsEnabled: boolean;
}>;

const selectIwad =
  'Use included Freedoom or choose a local IWAD to prepare the game.';
const preparing = 'Preparing Doom from the selected IWAD…';

export function deriveDecisionControls(
  session: DecisionReadiness | undefined,
  keyPresent: boolean,
  providerName = 'OpenAI',
): DecisionControlsPresentation {
  if (!session) {
    return { bannerText: selectIwad, buttonsEnabled: false };
  }

  if (
    session.phase === 'preparing' ||
    (!session.prepared && session.phase === 'busy')
  ) {
    return { bannerText: preparing, buttonsEnabled: false };
  }

  if (session.phase === 'terminal') {
    return {
      bannerText: 'The Doom session has ended. Reload to prepare a new game.',
      buttonsEnabled: false,
    };
  }

  if (session.phase === 'error') {
    return {
      bannerText:
        'The Doom session is unavailable. Reload to prepare a new game.',
      buttonsEnabled: false,
    };
  }

  if (!session.prepared) {
    return { bannerText: selectIwad, buttonsEnabled: false };
  }

  const credentialAvailable = session.hasClient || keyPresent;
  return {
    bannerText: credentialAvailable
      ? null
      : `Enter a temporary ${providerName} API key to request decisions.`,
    buttonsEnabled: session.controls.ready && credentialAvailable,
  };
}
