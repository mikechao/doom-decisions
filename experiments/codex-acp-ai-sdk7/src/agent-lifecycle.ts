type DoomOwner = { cleanup(): void; getSessionId(): string | null };
export type DoomInitialization = {
  owner: DoomOwner; pending: boolean; cleanupRequested: boolean;
  lateCleanup: string | null; settled: Promise<unknown>;
};

// Keep ownership of lazy-auth continuations even when cancellation wins the race.
// No wait is added to the 120s deadline. Pending startup is reported unverified;
// resolution AND rejection run one final cleanup after all provider retries settle.
export function fenceDoomInitialization(owner: DoomOwner, initialize: () => Promise<unknown>, signal: AbortSignal): DoomInitialization {
  const startup: DoomInitialization = { owner, pending: true, cleanupRequested: false, lateCleanup: null,
    settled: Promise.resolve() };
  startup.settled = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return initialize();
  }).finally(() => {
    startup.pending = false;
    if (startup.cleanupRequested) startup.lateCleanup = cleanupDoomProviders([owner])[0];
  }).then(value => { signal.throwIfAborted(); return value; });
  return startup;
}

// Initial shutdown stays in finally; only pending initialization needs a later pass.
export function cleanupDoomProviders(owners: DoomOwner[], startups: DoomInitialization[] = []) {
  return owners.map(owner => {
    const startup = startups.find(value => value.owner === owner);
    if (startup) startup.cleanupRequested = true;
    try {
      owner.cleanup();
      if (startup?.pending) return 'initialization-pending; cleanup-unverified; child-exit-unverified';
      return owner.getSessionId() === null ? 'returned-session-cleared; child-exit-unverified' : 'session-not-cleared';
    } catch { return 'cleanup-failed; child-exit-unverified'; }
  });
}
