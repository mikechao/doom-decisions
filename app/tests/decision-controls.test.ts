import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { deriveDecisionControls } from '../src/decision-controls.ts';

function session(overrides = {}) {
  return {
    phase: 'ready',
    prepared: true,
    hasClient: false,
    controls: { ready: true, stop: false, tics: true, iwad: false },
    ...overrides,
  };
}

describe('Decision Controls prerequisite presentation', () => {
  it('asks the user to select an IWAD before a session is prepared', () => {
    assert.deepEqual(deriveDecisionControls(undefined, false), {
      bannerText: 'Select a local Doom IWAD to prepare the game.',
      buttonsEnabled: false,
    });
    assert.deepEqual(
      deriveDecisionControls(session({ prepared: false, phase: 'unprepared' }), true),
      {
        bannerText: 'Select a local Doom IWAD to prepare the game.',
        buttonsEnabled: false,
      },
    );
  });

  it('shows preparation guidance and keeps decisions disabled during preparation', () => {
    const result = deriveDecisionControls(
      session({ prepared: false, phase: 'preparing' }),
      true,
    );
    assert.match(result.bannerText ?? '', /Preparing/);
    assert.doesNotMatch(result.bannerText ?? '', /Select a local Doom IWAD/);
    assert.equal(result.buttonsEnabled, false);
  });

  it('asks for a key and disables both decision buttons when no client or key is available', () => {
    assert.deepEqual(deriveDecisionControls(session(), false), {
      bannerText: 'Enter a temporary OpenAI API key to request decisions.',
      buttonsEnabled: false,
    });
  });

  it('enables eligible decisions for a typed key without claiming authentication', () => {
    assert.deepEqual(deriveDecisionControls(session(), true), {
      bannerText: null,
      buttonsEnabled: true,
    });
  });

  it('keeps decisions enabled after the controller consumes the key and retains its client', () => {
    assert.deepEqual(
      deriveDecisionControls(session({ hasClient: true }), false),
      { bannerText: null, buttonsEnabled: true },
    );
  });

  it('does not let a typed key override controller admission locks', () => {
    assert.deepEqual(
      deriveDecisionControls(
        session({ phase: 'busy', controls: { ready: false, stop: false, tics: false, iwad: false } }),
        true,
      ),
      { bannerText: null, buttonsEnabled: false },
    );
    assert.deepEqual(
      deriveDecisionControls(
        session({ controls: { ready: false, stop: true, tics: true, iwad: false } }),
        true,
      ),
      { bannerText: null, buttonsEnabled: false },
    );
  });

  it('restores key guidance after the field is cleared without a retained client', () => {
    const rejectedKeyAttempt = deriveDecisionControls(session(), true);
    assert.equal(rejectedKeyAttempt.buttonsEnabled, true);
    assert.equal(rejectedKeyAttempt.bannerText, null);

    const afterControllerRejection = deriveDecisionControls(session(), false);
    assert.deepEqual(afterControllerRejection, {
      bannerText: 'Enter a temporary OpenAI API key to request decisions.',
      buttonsEnabled: false,
    });
  });

  it('shows reload guidance and disables decisions after readiness is retired', () => {
    assert.deepEqual(
      deriveDecisionControls(
        session({
          phase: 'error',
          prepared: false,
          hasClient: false,
          controls: { ready: false, stop: false, tics: false, iwad: false },
        }),
        true,
      ),
      {
        bannerText: 'The Doom session is unavailable. Reload to prepare a new game.',
        buttonsEnabled: false,
      },
    );
    assert.deepEqual(
      deriveDecisionControls(
        session({
          phase: 'terminal',
          prepared: false,
          controls: { ready: false, stop: false, tics: false, iwad: false },
        }),
        true,
      ),
      {
        bannerText: 'The Doom session has ended. Reload to prepare a new game.',
        buttonsEnabled: false,
      },
    );
  });
});
