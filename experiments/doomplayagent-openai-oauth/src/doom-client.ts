import {
  executeAgentOperation,
  type AgentClientOptions,
  type AttachedLease,
  type DetachedLease,
  type MaterializedObserve,
} from '../../../scripts/doom-agent-client.ts';

export type DoomClient = Readonly<{
  observe(): Promise<MaterializedObserve>;
  detach(): Promise<DetachedLease>;
}>;

const recovery = 'Use Stop Agent in the browser before another attach. No retry was made.';

// Importing this module is inert. Only this call acquires browser ownership.
export async function initializeDoomClient(options: AgentClientOptions = {}): Promise<DoomClient> {
  const clientOptions = { ...options };
  let lease: AttachedLease;
  try {
    lease = await executeAgentOperation({ op: 'attach' }, clientOptions);
  } catch {
    throw new Error(`Doom attach unconfirmed; ownership may be held. ${recovery}`);
  }

  let state: 'ready' | 'observing' | 'detaching' | 'detached' | 'detach-failed' = 'ready';

  function requireReady() {
    if (state === 'detach-failed')
      throw new Error(`Doom detach unconfirmed; client is closed. ${recovery}`);
    if (state !== 'ready') throw new Error('Doom client is busy or closed.');
  }

  return Object.freeze({
    async observe(): Promise<MaterializedObserve> {
      requireReady();
      state = 'observing';
      try {
        return await executeAgentOperation({ op: 'observe', leaseFile: lease.leaseFile }, clientOptions);
      } catch {
        throw new Error('Doom observation unconfirmed. No retry was made.');
      } finally {
        state = 'ready';
      }
    },
    async detach(): Promise<DetachedLease> {
      requireReady();
      state = 'detaching';
      try {
        const released = await executeAgentOperation({ op: 'detach', leaseFile: lease.leaseFile }, clientOptions);
        state = 'detached';
        return released;
      } catch {
        state = 'detach-failed';
        throw new Error(`Doom detach unconfirmed; client is closed. ${recovery}`);
      }
    },
  });
}
