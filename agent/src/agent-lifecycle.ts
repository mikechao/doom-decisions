import type { CliProvider } from './cli-provider.ts';

// Stateless CLI providers own independent processes/clients.
export type CliInitialization = { owner: CliProvider; pending: boolean; cleanupRequested: boolean; settled: Promise<unknown> };
export function fenceCliInitialization(owner: CliProvider, signal: AbortSignal): CliInitialization {
  const startup: CliInitialization = { owner, pending: true, cleanupRequested: false, settled: Promise.resolve() };
  startup.settled = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return owner.initialize();
  }).finally(async () => {
    startup.pending = false;
    if (startup.cleanupRequested) await closeCliProviders([owner]);
  }).then(value => { signal.throwIfAborted(); return value; });
  return startup;
}

export async function closeCliProviders(owners: CliProvider[], startups: CliInitialization[] = []) {
  const results: string[] = [];
  for (const owner of owners) {
    const startup = startups.find(value => value.owner === owner);
    if (startup) startup.cleanupRequested = true;
    try {
      await owner.close();
      results.push(startup?.pending ? 'initialization-pending; cleanup-unverified; child-exit-unverified' :
        `close-returned; ${owner.childExitObserved() ? 'child-exit-observed' : 'child-exit-unverified'}`);
    } catch { results.push('cleanup-failed; child-exit-unverified'); }
  }
  return results;
}
